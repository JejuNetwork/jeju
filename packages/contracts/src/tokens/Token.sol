// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {EIP3009} from "./EIP3009Token.sol";

/**
 * @title IBanManager
 * @notice Interface for moderation system
 */
interface IBanManager {
    function isAddressBanned(address target) external view returns (bool);
}

/**
 * @title IUserBlockRegistry
 * @notice Interface for user-to-user blocking
 */
interface IUserBlockRegistry {
    function isInteractionBlocked(address source, address target) external view returns (bool);
}

/**
 * @title IHyperlaneMailbox
 * @notice Interface for cross-chain messaging
 */
interface IHyperlaneMailbox {
    function dispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes calldata messageBody)
        external payable returns (bytes32);
    function localDomain() external view returns (uint32);
}

/**
 * @title IInterchainGasPaymaster
 * @notice Interface for gas payment
 */
interface IInterchainGasPaymaster {
    function payForGas(bytes32 messageId, uint32 destinationDomain, uint256 gasAmount, address refundAddress)
        external payable;
    function quoteGasPayment(uint32 destinationDomain, uint256 gasAmount) external view returns (uint256);
}

/**
 * @title Token
 * @author Jeju Network
 * @notice Universal token with trading fees, cross-chain support, and moderation
 * @dev 
 * Combines best features:
 * - ERC20 with Permit (EIP-2612) for gasless approvals
 * - EIP-3009 for gasless transfers
 * - Trading fees: creator fees, holder rewards, treasury, burn (like Clanker/Skycloud)
 * - LP fees configurable at creation
 * - Cross-chain via Hyperlane (lock/unlock on home, burn/mint on synthetic)
 * - Ban enforcement via moderation system
 * - Anti-whale: max wallet and transaction limits
 * - Faucet for testnet
 */
contract Token is ERC20, ERC20Burnable, ERC20Permit, Ownable2Step, ReentrancyGuard, EIP3009 {
    using ECDSA for bytes32;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_TOTAL_FEE_BPS = 2500; // 25% max
    uint256 public constant BRIDGE_GAS_LIMIT = 300_000;

    struct TokenConfig {
        uint256 maxSupply;           // 0 = unlimited
        uint256 maxWalletBps;        // Max wallet as % of supply (0 = no limit)
        uint256 maxTxBps;            // Max tx as % of supply (0 = no limit)
        bool isHomeChain;            // Lock/unlock vs burn/mint
        bool banEnforcementEnabled;
        bool transfersPaused;
        bool faucetEnabled;
    }

    struct FeeConfig {
        uint16 creatorFeeBps;        // Fee to creator wallet
        uint16 holderFeeBps;         // Fee to holder reward pool
        uint16 treasuryFeeBps;       // Fee to treasury
        uint16 burnFeeBps;           // Burn (deflationary)
        uint16 lpFeeBps;             // Fee on LP operations
        address creatorWallet;
        address holderRewardPool;
        address treasury;
    }

    TokenConfig public config;
    FeeConfig public fees;

    IBanManager public banManager;
    IUserBlockRegistry public blockRegistry;
    IHyperlaneMailbox public mailbox;
    IInterchainGasPaymaster public igp;
    uint32 public homeChainDomain;
    mapping(uint32 => bytes32) public remoteRouters;
    mapping(address => bool) public feeExempt;
    mapping(address => bool) public limitExempt;
    mapping(address => bool) public banExempt;
    // authorizationState inherited from EIP3009
    mapping(address => uint256) public lastFaucetClaim;
    mapping(bytes32 => bool) public processedMessages;
    uint256 public totalLocked;
    uint256 public totalBurned;
    uint256 public totalFeesCollected;
    uint256 public faucetAmount = 10_000 * 10 ** 18;
    uint256 public faucetCooldown = 1 hours;

    event FeesCollected(uint256 creator, uint256 holder, uint256 treasury, uint256 burned);
    event CrossChainTransfer(bytes32 indexed messageId, address indexed sender, uint32 destination, uint256 amount);
    event CrossChainReceive(bytes32 indexed messageId, uint32 origin, address indexed recipient, uint256 amount);
    event FaucetClaimed(address indexed recipient, uint256 amount);
    event ConfigUpdated();
    event FeesUpdated();

    error BannedUser(address user);
    error ExceedsMaxSupply();
    error ExceedsMaxWallet(uint256 amount, uint256 max);
    error ExceedsMaxTx(uint256 amount, uint256 max);
    error InvalidFeeConfig();
    error TransfersPaused();
    error FaucetDisabled();
    error FaucetCooldown(uint256 nextClaim);
    error FaucetInsufficientBalance();
    error UnsupportedDomain(uint32 domain);
    error OnlyMailbox();
    error MessageAlreadyProcessed();
    error InsufficientBalance();
    error InsufficientGas(uint256 required, uint256 provided);
    error UserBlocked(address from, address to);

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deploy token
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply Initial supply to mint to owner
     * @param owner_ Owner address
     * @param maxSupply_ Maximum supply (0 = unlimited)
     * @param isHomeChain_ Whether this is the home chain
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_,
        uint256 maxSupply_,
        bool isHomeChain_
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(owner_) {
        config.maxSupply = maxSupply_;
        config.isHomeChain = isHomeChain_;

        if (initialSupply > 0 && (maxSupply_ == 0 || initialSupply <= maxSupply_)) {
            _mint(owner_, initialSupply);
        }

        // Owner is always exempt
        feeExempt[owner_] = true;
        limitExempt[owner_] = true;
        banExempt[owner_] = true;
    }

    function _update(address from, address to, uint256 amount) internal virtual override(ERC20) {
        if (config.transfersPaused && from != address(0) && to != address(0)) {
            revert TransfersPaused();
        }

        // Skip all checks for mint/burn
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        if (config.banEnforcementEnabled && address(banManager) != address(0)) {
            if (!banExempt[to] && banManager.isAddressBanned(from)) revert BannedUser(from);
            if (banManager.isAddressBanned(to)) revert BannedUser(to);
        }

        // Check user-to-user blocks: if recipient has blocked sender, transfer fails
        if (address(blockRegistry) != address(0) && !banExempt[from]) {
            if (blockRegistry.isInteractionBlocked(from, to)) revert UserBlocked(from, to);
        }

        if (config.maxTxBps > 0 && !limitExempt[from] && !limitExempt[to]) {
            uint256 maxTx = (totalSupply() * config.maxTxBps) / BPS_DENOMINATOR;
            if (amount > maxTx) revert ExceedsMaxTx(amount, maxTx);
        }

        // Calculate fees
        uint256 feeAmount = 0;
        if (!feeExempt[from] && !feeExempt[to]) {
            feeAmount = _collectFees(from, amount);
        }

        uint256 transferAmount = amount - feeAmount;

        if (config.maxWalletBps > 0 && !limitExempt[to]) {
            uint256 maxWalletLimit = (totalSupply() * config.maxWalletBps) / BPS_DENOMINATOR;
            uint256 newBalance = balanceOf(to) + transferAmount;
            if (newBalance > maxWalletLimit) revert ExceedsMaxWallet(newBalance, maxWalletLimit);
        }

        super._update(from, to, transferAmount);
    }

    function _collectFees(address from, uint256 amount) internal returns (uint256 totalFee) {
        uint256 creatorFee = (amount * fees.creatorFeeBps) / BPS_DENOMINATOR;
        uint256 holderFee = (amount * fees.holderFeeBps) / BPS_DENOMINATOR;
        uint256 treasuryFee = (amount * fees.treasuryFeeBps) / BPS_DENOMINATOR;
        uint256 burnFee = (amount * fees.burnFeeBps) / BPS_DENOMINATOR;

        totalFee = creatorFee + holderFee + treasuryFee + burnFee;
        if (totalFee == 0) return 0;

        totalFeesCollected += totalFee;

        if (creatorFee > 0 && fees.creatorWallet != address(0)) {
            super._update(from, fees.creatorWallet, creatorFee);
        }
        if (holderFee > 0 && fees.holderRewardPool != address(0)) {
            super._update(from, fees.holderRewardPool, holderFee);
        }
        if (treasuryFee > 0 && fees.treasury != address(0)) {
            super._update(from, fees.treasury, treasuryFee);
        }
        if (burnFee > 0) {
            super._update(from, address(0), burnFee);
            totalBurned += burnFee;
        }

        emit FeesCollected(creatorFee, holderFee, treasuryFee, burnFee);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (config.maxSupply > 0 && totalSupply() + amount > config.maxSupply) {
            revert ExceedsMaxSupply();
        }
        _mint(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CROSS-CHAIN (HYPERLANE)
    // ═══════════════════════════════════════════════════════════════════════════

    function bridgeTransfer(uint32 destination, bytes32 recipient, uint256 amount)
        external payable nonReentrant returns (bytes32 messageId)
    {
        if (remoteRouters[destination] == bytes32(0)) revert UnsupportedDomain(destination);

        if (config.isHomeChain) {
            _transfer(msg.sender, address(this), amount);
            totalLocked += amount;
        } else {
            _burn(msg.sender, amount);
        }

        bytes memory message = abi.encodePacked(recipient, amount);
        messageId = mailbox.dispatch(destination, remoteRouters[destination], message);

        uint256 gasRequired = igp.quoteGasPayment(destination, BRIDGE_GAS_LIMIT);
        if (msg.value < gasRequired) revert InsufficientGas(gasRequired, msg.value);
        igp.payForGas{value: msg.value}(messageId, destination, BRIDGE_GAS_LIMIT, msg.sender);

        emit CrossChainTransfer(messageId, msg.sender, destination, amount);
    }

    function handle(uint32 origin, bytes32 sender, bytes calldata body) external {
        if (msg.sender != address(mailbox)) revert OnlyMailbox();
        if (remoteRouters[origin] != sender) revert UnsupportedDomain(origin);

        bytes32 messageId = keccak256(abi.encodePacked(origin, sender, body, block.number));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();
        processedMessages[messageId] = true;

        bytes32 recipientBytes = bytes32(body[:32]);
        uint256 amount = abi.decode(body[32:], (uint256));
        address recipient = address(uint160(uint256(recipientBytes)));

        if (config.isHomeChain) {
            if (totalLocked < amount) revert InsufficientBalance();
            totalLocked -= amount;
            _transfer(address(this), recipient, amount);
        } else {
            _mint(recipient, amount);
        }

        emit CrossChainReceive(messageId, origin, recipient, amount);
    }

    function quoteBridge(uint32 destination, uint256 amount) external view returns (uint256 fee, uint256 gasPayment) {
        fee = (amount * fees.lpFeeBps) / BPS_DENOMINATOR; // Bridge uses LP fee
        gasPayment = igp.quoteGasPayment(destination, BRIDGE_GAS_LIMIT);
    }

    function faucet() external {
        _claimFaucet(msg.sender);
    }

    function faucetTo(address recipient) external {
        _claimFaucet(recipient);
    }

    function _claimFaucet(address recipient) internal {
        if (!config.faucetEnabled) revert FaucetDisabled();
        uint256 nextClaim = lastFaucetClaim[recipient] + faucetCooldown;
        if (block.timestamp < nextClaim) revert FaucetCooldown(nextClaim);
        if (balanceOf(owner()) < faucetAmount) revert FaucetInsufficientBalance();

        lastFaucetClaim[recipient] = block.timestamp;
        _transfer(owner(), recipient, faucetAmount);
        emit FaucetClaimed(recipient, faucetAmount);
    }

    function faucetCooldownRemaining(address account) external view returns (uint256) {
        uint256 nextClaim = lastFaucetClaim[account] + faucetCooldown;
        return block.timestamp >= nextClaim ? 0 : nextClaim - block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════════

    function setFees(
        uint16 creatorFeeBps_,
        uint16 holderFeeBps_,
        uint16 treasuryFeeBps_,
        uint16 burnFeeBps_,
        uint16 lpFeeBps_,
        address creatorWallet_,
        address holderRewardPool_,
        address treasury_
    ) external onlyOwner {
        uint256 total = uint256(creatorFeeBps_) + holderFeeBps_ + treasuryFeeBps_ + burnFeeBps_;
        if (total > MAX_TOTAL_FEE_BPS) revert InvalidFeeConfig();

        fees = FeeConfig({
            creatorFeeBps: creatorFeeBps_,
            holderFeeBps: holderFeeBps_,
            treasuryFeeBps: treasuryFeeBps_,
            burnFeeBps: burnFeeBps_,
            lpFeeBps: lpFeeBps_,
            creatorWallet: creatorWallet_,
            holderRewardPool: holderRewardPool_,
            treasury: treasury_
        });

        if (creatorWallet_ != address(0)) { feeExempt[creatorWallet_] = true; limitExempt[creatorWallet_] = true; }
        if (holderRewardPool_ != address(0)) { feeExempt[holderRewardPool_] = true; limitExempt[holderRewardPool_] = true; }
        if (treasury_ != address(0)) { feeExempt[treasury_] = true; limitExempt[treasury_] = true; }

        emit FeesUpdated();
    }

    function setConfig(uint256 maxWalletBps_, uint256 maxTxBps_, bool banEnabled_, bool paused_, bool faucetEnabled_)
        external onlyOwner
    {
        config.maxWalletBps = maxWalletBps_;
        config.maxTxBps = maxTxBps_;
        config.banEnforcementEnabled = banEnabled_;
        config.transfersPaused = paused_;
        config.faucetEnabled = faucetEnabled_;
        emit ConfigUpdated();
    }

    function setBanManager(address _banManager) external onlyOwner {
        banManager = IBanManager(_banManager);
    }

    function setBlockRegistry(address _blockRegistry) external onlyOwner {
        blockRegistry = IUserBlockRegistry(_blockRegistry);
    }

    function setHyperlane(address _mailbox, address _igp, uint32 _homeChainDomain) external onlyOwner {
        mailbox = IHyperlaneMailbox(_mailbox);
        igp = IInterchainGasPaymaster(_igp);
        homeChainDomain = _homeChainDomain;
    }

    function setRouter(uint32 domain, bytes32 router) external onlyOwner {
        remoteRouters[domain] = router;
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        feeExempt[account] = exempt;
    }

    function setLimitExempt(address account, bool exempt) external onlyOwner {
        limitExempt[account] = exempt;
    }

    function setBanExempt(address account, bool exempt) external onlyOwner {
        banExempt[account] = exempt;
    }

    function setFaucetParams(uint256 _amount, uint256 _cooldown) external onlyOwner {
        faucetAmount = _amount;
        faucetCooldown = _cooldown;
    }

    function totalFeeBps() external view returns (uint256) {
        return uint256(fees.creatorFeeBps) + fees.holderFeeBps + fees.treasuryFeeBps + fees.burnFeeBps;
    }

    function calculateFee(uint256 amount) external view returns (uint256) {
        uint256 total = uint256(fees.creatorFeeBps) + fees.holderFeeBps + fees.treasuryFeeBps + fees.burnFeeBps;
        return (amount * total) / BPS_DENOMINATOR;
    }

    function maxWallet() external view returns (uint256) {
        return config.maxWalletBps == 0 ? type(uint256).max : (totalSupply() * config.maxWalletBps) / BPS_DENOMINATOR;
    }

    function maxTransaction() external view returns (uint256) {
        return config.maxTxBps == 0 ? type(uint256).max : (totalSupply() * config.maxTxBps) / BPS_DENOMINATOR;
    }

    function circulatingSupply() external view returns (uint256) {
        return totalSupply() - totalBurned - totalLocked;
    }

    function isBanned(address account) external view returns (bool) {
        if (!config.banEnforcementEnabled || address(banManager) == address(0)) return false;
        return banManager.isAddressBanned(account);
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
