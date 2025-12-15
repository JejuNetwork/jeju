// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IBanManager
 * @notice Interface for ban enforcement from moderation system
 */
interface IBanManager {
    function isAddressBanned(address target) external view returns (bool);
    function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool);
}

/**
 * @title IFeeConfig
 * @notice Interface for DAO-governed fee configuration
 */
interface IFeeConfig {
    struct TokenFees {
        uint16 xlpRewardShareBps;
        uint16 protocolShareBps;
        uint16 burnShareBps;
        uint16 transferFeeBps;
        uint16 bridgeFeeMinBps;
        uint16 bridgeFeeMaxBps;
        uint16 xlpMinStakeBps;
        uint16 zkProofDiscountBps;
    }

    function getTokenFeesFor(address token) external view returns (TokenFees memory fees, bool hasOverride);
    function getTreasury() external view returns (address);
}

/**
 * @title IHyperlaneMailbox
 * @notice Interface for Hyperlane cross-chain messaging
 */
interface IHyperlaneMailbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId);
}

/**
 * @title BBLNToken
 * @author Jeju Network
 * @notice Babylon (BBLN) token - Cross-chain token with deflationary mechanics
 * @dev 
 * - Fixed 1 billion total supply (immutable, no minting after deployment)
 * - Home chain: Ethereum Mainnet (Sepolia for testnet)
 * - Cross-chain via Hyperlane Warp Routes
 * - Ban enforcement via moderation system
 * - DAO-governed fees via FeeConfig
 * - Deflationary: portion of bridge/transfer fees burned
 *
 * Tokenomics:
 * - Total Supply: 1,000,000,000 BBLN
 * - 20% Babylon Labs (4-year vesting, 1-year cliff)
 * - 10% Public Sale (CCA auction, immediate)
 * - 10% Airdrops (drip mechanism)
 * - 10% Liquidity & Market Making
 * - 60% Treasury (10-year gradual unlock)
 *
 * @custom:security-contact security@jeju.network
 */
contract BBLNToken is ERC20, ERC20Burnable, Ownable, ReentrancyGuard {
    // ============ Constants ============

    /// @notice Total supply: 1 billion tokens (fixed, immutable)
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    /// @notice App ID for ban enforcement
    bytes32 public constant BBLN_APP_ID = keccak256("babylon.network");

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ Allocation Constants ============

    /// @notice Babylon Labs allocation (20%)
    uint256 public constant BABYLON_LABS_ALLOCATION = 200_000_000 * 10 ** 18;

    /// @notice Public sale allocation (10%)
    uint256 public constant PUBLIC_SALE_ALLOCATION = 100_000_000 * 10 ** 18;

    /// @notice Airdrop allocation (10%)
    uint256 public constant AIRDROP_ALLOCATION = 100_000_000 * 10 ** 18;

    /// @notice Liquidity allocation (10%)
    uint256 public constant LIQUIDITY_ALLOCATION = 100_000_000 * 10 ** 18;

    /// @notice Treasury allocation (60%)
    uint256 public constant TREASURY_ALLOCATION = 600_000_000 * 10 ** 18;

    // ============ State Variables ============

    /// @notice Ban manager for moderation enforcement
    IBanManager public banManager;

    /// @notice Fee configuration contract (DAO-governed)
    IFeeConfig public feeConfig;

    /// @notice Hyperlane mailbox for cross-chain messaging
    IHyperlaneMailbox public hyperlaneMailbox;

    /// @notice Whether ban enforcement is enabled
    bool public banEnforcementEnabled;

    /// @notice Whether transfer fees are enabled
    bool public transferFeesEnabled;

    /// @notice Addresses exempt from bans (pools, vesting contracts, etc.)
    mapping(address => bool) public banExempt;

    /// @notice Addresses exempt from transfer fees
    mapping(address => bool) public feeExempt;

    /// @notice Total tokens burned (deflationary tracking)
    uint256 public totalBurned;

    /// @notice Total fees collected for XLP rewards
    uint256 public totalXlpFees;

    /// @notice Total fees collected for protocol treasury
    uint256 public totalProtocolFees;

    /// @notice XLP reward pool address
    address public xlpRewardPool;

    // ============ Allocation Tracking ============

    /// @notice Babylon Labs wallet address
    address public babylonLabsWallet;

    /// @notice Public sale contract address
    address public publicSaleContract;

    /// @notice Airdrop contract address
    address public airdropContract;

    /// @notice Liquidity wallet address
    address public liquidityWallet;

    /// @notice Treasury wallet address
    address public treasuryWallet;

    /// @notice Whether initial distribution has occurred
    bool public initialDistributionComplete;

    // ============ Events ============

    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event FeeConfigUpdated(address indexed oldConfig, address indexed newConfig);
    event HyperlaneMailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event BanEnforcementToggled(bool enabled);
    event TransferFeesToggled(bool enabled);
    event BanExemptUpdated(address indexed account, bool exempt);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event FeesCollected(uint256 xlpAmount, uint256 protocolAmount, uint256 burnAmount);
    event XlpRewardPoolUpdated(address indexed oldPool, address indexed newPool);
    event InitialDistributionCompleted(
        address babylonLabs,
        address publicSale,
        address airdrop,
        address liquidity,
        address treasury
    );

    // ============ Errors ============

    error BannedUser(address user);
    error AlreadyDistributed();
    error InvalidAddress();
    error InvalidAllocation();

    // ============ Constructor ============

    /**
     * @notice Deploy BBLN token with fixed supply
     * @param initialOwner Owner address (for governance)
     * @param _banManager Ban manager address (can be address(0) initially)
     * @param _feeConfig Fee configuration address (can be address(0) initially)
     */
    constructor(
        address initialOwner,
        address _banManager,
        address _feeConfig
    ) ERC20("Babylon", "BBLN") Ownable(initialOwner) {
        // Mint total supply to deployer (for distribution)
        _mint(initialOwner, TOTAL_SUPPLY);

        if (_banManager != address(0)) {
            banManager = IBanManager(_banManager);
            banEnforcementEnabled = true;
        }

        if (_feeConfig != address(0)) {
            feeConfig = IFeeConfig(_feeConfig);
        }
    }

    // ============ Initial Distribution ============

    /**
     * @notice Perform initial token distribution to allocation wallets
     * @dev Can only be called once. All allocations transferred atomically.
     * @param _babylonLabs Babylon Labs wallet (20%)
     * @param _publicSale Public sale contract (10%)
     * @param _airdrop Airdrop contract (10%)
     * @param _liquidity Liquidity wallet (10%)
     * @param _treasury Treasury wallet (60%)
     */
    function distributeInitialAllocation(
        address _babylonLabs,
        address _publicSale,
        address _airdrop,
        address _liquidity,
        address _treasury
    ) external onlyOwner {
        if (initialDistributionComplete) revert AlreadyDistributed();
        if (_babylonLabs == address(0) || _publicSale == address(0) || 
            _airdrop == address(0) || _liquidity == address(0) || 
            _treasury == address(0)) revert InvalidAddress();

        initialDistributionComplete = true;

        babylonLabsWallet = _babylonLabs;
        publicSaleContract = _publicSale;
        airdropContract = _airdrop;
        liquidityWallet = _liquidity;
        treasuryWallet = _treasury;

        // Mark allocation addresses as fee exempt
        feeExempt[_babylonLabs] = true;
        feeExempt[_publicSale] = true;
        feeExempt[_airdrop] = true;
        feeExempt[_liquidity] = true;
        feeExempt[_treasury] = true;

        // Transfer allocations from owner
        _transfer(owner(), _babylonLabs, BABYLON_LABS_ALLOCATION);
        _transfer(owner(), _publicSale, PUBLIC_SALE_ALLOCATION);
        _transfer(owner(), _airdrop, AIRDROP_ALLOCATION);
        _transfer(owner(), _liquidity, LIQUIDITY_ALLOCATION);
        _transfer(owner(), _treasury, TREASURY_ALLOCATION);

        emit InitialDistributionCompleted(_babylonLabs, _publicSale, _airdrop, _liquidity, _treasury);
    }

    // ============ Transfer Override ============

    /**
     * @notice Override _update to enforce bans and apply transfer fees
     * @dev Implements:
     *      1. Ban enforcement (if enabled)
     *      2. Transfer fees with distribution (if enabled)
     *      3. Deflationary burn mechanism
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        // Skip checks for minting/burning
        if (from != address(0) && to != address(0)) {
            // Ban enforcement
            if (banEnforcementEnabled && address(banManager) != address(0)) {
                if (!banExempt[to] && banManager.isAddressBanned(from)) {
                    revert BannedUser(from);
                }
                if (banManager.isAddressBanned(to)) {
                    revert BannedUser(to);
                }
            }

            // Transfer fee logic
            if (transferFeesEnabled && !feeExempt[from] && !feeExempt[to]) {
                uint256 feeAmount = _calculateAndDistributeFees(from, value);
                value -= feeAmount;
            }
        }

        super._update(from, to, value);
    }

    /**
     * @notice Calculate and distribute transfer fees
     * @param from Sender address (for context)
     * @param amount Transfer amount
     * @return totalFee Total fee deducted
     */
    function _calculateAndDistributeFees(address from, uint256 amount) internal returns (uint256 totalFee) {
        if (address(feeConfig) == address(0)) return 0;

        (IFeeConfig.TokenFees memory fees,) = feeConfig.getTokenFeesFor(address(this));
        
        if (fees.transferFeeBps == 0) return 0;

        totalFee = (amount * fees.transferFeeBps) / BPS_DENOMINATOR;
        if (totalFee == 0) return 0;

        // Calculate distribution
        uint256 xlpAmount = (totalFee * fees.xlpRewardShareBps) / BPS_DENOMINATOR;
        uint256 protocolAmount = (totalFee * fees.protocolShareBps) / BPS_DENOMINATOR;
        uint256 burnAmount = totalFee - xlpAmount - protocolAmount; // Remainder to burn

        // Distribute fees
        if (xlpAmount > 0 && xlpRewardPool != address(0)) {
            super._update(from, xlpRewardPool, xlpAmount);
            totalXlpFees += xlpAmount;
        }

        if (protocolAmount > 0) {
            address treasury = feeConfig.getTreasury();
            if (treasury != address(0)) {
                super._update(from, treasury, protocolAmount);
                totalProtocolFees += protocolAmount;
            }
        }

        if (burnAmount > 0) {
            super._update(from, address(0), burnAmount); // Burn
            totalBurned += burnAmount;
        }

        emit FeesCollected(xlpAmount, protocolAmount, burnAmount);
    }

    // ============ Ban Management ============

    function isBanned(address account) public view returns (bool) {
        if (!banEnforcementEnabled || address(banManager) == address(0)) {
            return false;
        }
        return banManager.isAddressBanned(account);
    }

    function setBanManager(address _banManager) external onlyOwner {
        address oldManager = address(banManager);
        banManager = IBanManager(_banManager);
        emit BanManagerUpdated(oldManager, _banManager);
    }

    function setBanEnforcement(bool enabled) external onlyOwner {
        banEnforcementEnabled = enabled;
        emit BanEnforcementToggled(enabled);
    }

    function setBanExempt(address account, bool exempt) external onlyOwner {
        banExempt[account] = exempt;
        emit BanExemptUpdated(account, exempt);
    }

    // ============ Fee Management ============

    function setFeeConfig(address _feeConfig) external onlyOwner {
        address oldConfig = address(feeConfig);
        feeConfig = IFeeConfig(_feeConfig);
        emit FeeConfigUpdated(oldConfig, _feeConfig);
    }

    function setTransferFeesEnabled(bool enabled) external onlyOwner {
        transferFeesEnabled = enabled;
        emit TransferFeesToggled(enabled);
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    function setXlpRewardPool(address _xlpRewardPool) external onlyOwner {
        address oldPool = xlpRewardPool;
        xlpRewardPool = _xlpRewardPool;
        emit XlpRewardPoolUpdated(oldPool, _xlpRewardPool);
    }

    // ============ Hyperlane Integration ============

    function setHyperlaneMailbox(address _mailbox) external onlyOwner {
        address oldMailbox = address(hyperlaneMailbox);
        hyperlaneMailbox = IHyperlaneMailbox(_mailbox);
        emit HyperlaneMailboxUpdated(oldMailbox, _mailbox);
    }

    // ============ View Functions ============

    /**
     * @notice Get circulating supply (total - burned)
     */
    function circulatingSupply() external view returns (uint256) {
        return TOTAL_SUPPLY - totalBurned;
    }

    /**
     * @notice Get current transfer fee for this token
     */
    function getCurrentTransferFee() external view returns (uint16 feeBps) {
        if (address(feeConfig) == address(0)) return 0;
        (IFeeConfig.TokenFees memory fees,) = feeConfig.getTokenFeesFor(address(this));
        return fees.transferFeeBps;
    }

    /**
     * @notice Get fee breakdown for a transfer amount
     * @param amount Transfer amount
     * @return totalFee Total fee
     * @return xlpAmount XLP reward portion
     * @return protocolAmount Protocol treasury portion
     * @return burnAmount Burn portion
     */
    function previewTransferFees(uint256 amount) external view returns (
        uint256 totalFee,
        uint256 xlpAmount,
        uint256 protocolAmount,
        uint256 burnAmount
    ) {
        if (address(feeConfig) == address(0)) return (0, 0, 0, 0);

        (IFeeConfig.TokenFees memory fees,) = feeConfig.getTokenFeesFor(address(this));
        
        if (fees.transferFeeBps == 0) return (0, 0, 0, 0);

        totalFee = (amount * fees.transferFeeBps) / BPS_DENOMINATOR;
        xlpAmount = (totalFee * fees.xlpRewardShareBps) / BPS_DENOMINATOR;
        protocolAmount = (totalFee * fees.protocolShareBps) / BPS_DENOMINATOR;
        burnAmount = totalFee - xlpAmount - protocolAmount;
    }

    /**
     * @notice Get allocation status
     */
    function getAllocationStatus() external view returns (
        bool distributed,
        address babylonLabs,
        address publicSale,
        address airdrop,
        address liquidity,
        address treasury
    ) {
        return (
            initialDistributionComplete,
            babylonLabsWallet,
            publicSaleContract,
            airdropContract,
            liquidityWallet,
            treasuryWallet
        );
    }

    /**
     * @notice Get deflationary stats
     */
    function getDeflationaryStats() external view returns (
        uint256 burned,
        uint256 xlpFees,
        uint256 protocolFees,
        uint256 burnRate // Per 10000 of total supply
    ) {
        burned = totalBurned;
        xlpFees = totalXlpFees;
        protocolFees = totalProtocolFees;
        burnRate = (totalBurned * BPS_DENOMINATOR) / TOTAL_SUPPLY;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
