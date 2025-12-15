// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CrossChainToken} from "./CrossChainToken.sol";

/**
 * @title IBanManager
 * @notice Interface for ban enforcement from moderation system
 */
interface IBanManager {
    function isAddressBanned(address target) external view returns (bool);
    function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool);
}

/**
 * @title JejuCrossChainToken
 * @author Jeju Network
 * @notice Cross-chain JEJU token with Hyperlane warp route support
 * @dev 
 * - Max supply: 10 billion JEJU
 * - Initial supply: 1 billion (minted to deployer)
 * - Home chain: Jeju Network (420690)
 * - Cross-chain via Hyperlane Warp Routes
 * - Ban enforcement via moderation system
 * - Testnet faucet functionality
 * - DAO-governed fees via FeeConfig
 *
 * This contract extends CrossChainToken to add:
 * - Mintable supply (up to MAX_SUPPLY)
 * - Ban enforcement
 * - Faucet for testnet
 *
 * @custom:security-contact security@jeju.network
 */
contract JejuCrossChainToken is CrossChainToken {
    // ============ Constants ============

    /// @notice Initial supply: 1 billion JEJU
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    /// @notice Maximum supply: 10 billion JEJU
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18;

    /// @notice Faucet amount: 10,000 JEJU
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10 ** 18;

    /// @notice Faucet cooldown: 1 hour
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice App ID for ban enforcement
    bytes32 public constant JEJU_APP_ID = keccak256("jeju.network");

    // ============ State Variables ============

    /// @notice Ban manager for moderation enforcement
    IBanManager public banManager;

    /// @notice Whether ban enforcement is enabled
    bool public banEnforcementEnabled;

    /// @notice Whether faucet is enabled (testnet only)
    bool public faucetEnabled;

    /// @notice Last faucet claim timestamp per address
    mapping(address => uint256) public lastFaucetClaim;

    /// @notice Addresses exempt from bans
    mapping(address => bool) public banExempt;

    // ============ Events ============

    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event BanEnforcementToggled(bool enabled);
    event FaucetToggled(bool enabled);
    event FaucetClaimed(address indexed claimer, uint256 amount);
    event BanExemptUpdated(address indexed account, bool exempt);

    // ============ Errors ============

    error BannedUser(address user);
    error MaxSupplyExceeded();
    error FaucetDisabled();
    error FaucetCooldownActive(uint256 nextClaimTime);
    error FaucetInsufficientBalance();

    // ============ Constructor ============

    /**
     * @notice Deploy JEJU cross-chain token
     * @param initialOwner Owner address
     * @param _banManager Ban manager address (can be address(0))
     * @param _faucetEnabled Whether faucet is enabled
     * @param _mailbox Hyperlane mailbox address
     * @param _igp Interchain gas paymaster address
     * @param _feeConfig Fee configuration address
     * @param _homeChainDomain Hyperlane domain ID for home chain
     * @param _isHomeChain Whether this is the home chain instance
     */
    constructor(
        address initialOwner,
        address _banManager,
        bool _faucetEnabled,
        address _mailbox,
        address _igp,
        address _feeConfig,
        uint32 _homeChainDomain,
        bool _isHomeChain
    ) CrossChainToken("Jeju", "JEJU", initialOwner) {
        // Mint initial supply only on home chain
        if (_isHomeChain) {
            _mint(initialOwner, INITIAL_SUPPLY);
        }

        // Set up ban manager
        if (_banManager != address(0)) {
            banManager = IBanManager(_banManager);
            banEnforcementEnabled = true;
        }

        faucetEnabled = _faucetEnabled;

        // Initialize cross-chain infrastructure
        if (_mailbox != address(0)) {
            _initializeCrossChain(_mailbox, _igp, _feeConfig, _homeChainDomain, _isHomeChain);
        }
    }

    // ============ Transfer Override ============

    /**
     * @notice Override _update to enforce bans
     * @dev Ban checks are applied before the transfer
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        // Ban enforcement (skip for minting/burning)
        if (from != address(0) && to != address(0)) {
            if (banEnforcementEnabled && address(banManager) != address(0)) {
                bool toExempt = banExempt[to];
                if (!toExempt && banManager.isAddressBanned(from)) {
                    revert BannedUser(from);
                }
                if (banManager.isAddressBanned(to)) {
                    revert BannedUser(to);
                }
            }
        }

        super._update(from, to, value);
    }

    // ============ Minting ============

    /**
     * @notice Mint new JEJU tokens (owner only, up to MAX_SUPPLY)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    // ============ Faucet (Testnet) ============

    /**
     * @notice Claim tokens from faucet
     */
    function faucet() external {
        if (!faucetEnabled) revert FaucetDisabled();

        uint256 nextClaim = lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN;
        if (block.timestamp < nextClaim) revert FaucetCooldownActive(nextClaim);
        if (balanceOf(owner()) < FAUCET_AMOUNT) revert FaucetInsufficientBalance();

        lastFaucetClaim[msg.sender] = block.timestamp;
        _transfer(owner(), msg.sender, FAUCET_AMOUNT);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Claim tokens from faucet for another address
     * @param recipient Address to receive tokens
     */
    function faucetTo(address recipient) external {
        if (!faucetEnabled) revert FaucetDisabled();

        uint256 nextClaim = lastFaucetClaim[recipient] + FAUCET_COOLDOWN;
        if (block.timestamp < nextClaim) revert FaucetCooldownActive(nextClaim);
        if (balanceOf(owner()) < FAUCET_AMOUNT) revert FaucetInsufficientBalance();

        lastFaucetClaim[recipient] = block.timestamp;
        _transfer(owner(), recipient, FAUCET_AMOUNT);

        emit FaucetClaimed(recipient, FAUCET_AMOUNT);
    }

    /**
     * @notice Get time remaining until next faucet claim
     * @param account Address to check
     * @return Time in seconds until next claim (0 if can claim now)
     */
    function faucetCooldownRemaining(address account) external view returns (uint256) {
        uint256 nextClaim = lastFaucetClaim[account] + FAUCET_COOLDOWN;
        if (block.timestamp >= nextClaim) return 0;
        return nextClaim - block.timestamp;
    }

    // ============ Ban Management ============

    /**
     * @notice Check if an account is banned
     * @param account Address to check
     */
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

    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
        emit FaucetToggled(enabled);
    }

    // ============ View Functions ============

    /**
     * @notice Get token stats
     */
    function getTokenStats() external view returns (
        uint256 currentSupply,
        uint256 maxSupply,
        uint256 initialSupply,
        uint256 remainingMintable,
        bool faucetActive
    ) {
        currentSupply = totalSupply();
        maxSupply = MAX_SUPPLY;
        initialSupply = INITIAL_SUPPLY;
        remainingMintable = MAX_SUPPLY - currentSupply;
        faucetActive = faucetEnabled;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
