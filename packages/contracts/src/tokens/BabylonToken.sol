// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BabylonToken
 * @notice Cross-chain token with fee distribution, burn/mint for bridging, and anti-whale protection
 * @dev Designed for permissionless deployment across EVM chains via Hyperlane Warp Routes
 *
 * Fee Distribution Model:
 * - Transfer fees are collected and distributed to:
 *   1. Token holders (stakers) - via StakingRewardDistributor contract
 *   2. Creators/team - direct transfer
 *   3. Treasury/DAO - direct transfer
 *   4. Burn - deflationary mechanism
 *
 * Cross-Chain Design:
 * - On home chain (Ethereum): Full supply, Lock/Unlock for bridging
 * - On synthetic chains: Burn/Mint controlled by Warp Route
 */
contract BabylonToken is ERC20, ERC20Burnable, ERC20Permit, Ownable2Step, ReentrancyGuard {
    // =============================================================================
    // ERRORS
    // =============================================================================

    error ZeroAddress();
    error ExceedsMaxWallet(uint256 attempted, uint256 max);
    error ExceedsMaxTransaction(uint256 attempted, uint256 max);
    error InvalidFeePercent(uint256 total);
    error NotAuthorizedMinter();
    error NotAuthorizedBurner();
    error TransfersPaused();
    error AlreadyInitialized();

    // =============================================================================
    // EVENTS
    // =============================================================================

    event FeeDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event CreatorWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event FeesUpdated(uint16 holdersFeeBps, uint16 creatorsFeeBps, uint16 treasuryFeeBps, uint16 burnFeeBps);
    event FeeExemptionUpdated(address indexed account, bool exempt);
    event MinterUpdated(address indexed minter, bool authorized);
    event BurnerUpdated(address indexed burner, bool authorized);
    event MaxWalletUpdated(uint256 oldMax, uint256 newMax);
    event MaxTransactionUpdated(uint256 oldMax, uint256 newMax);
    event FeesCollected(uint256 holdersAmount, uint256 creatorsAmount, uint256 treasuryAmount, uint256 burnAmount);

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Fee distributor contract for holder rewards
    address public feeDistributor;

    /// @notice Treasury/DAO wallet
    address public treasury;

    /// @notice Creator/team wallet
    address public creatorWallet;

    /// @notice Fee to token holders in basis points (100 = 1%)
    uint16 public holdersFeeBps;

    /// @notice Fee to creators in basis points
    uint16 public creatorsFeeBps;

    /// @notice Fee to treasury in basis points
    uint16 public treasuryFeeBps;

    /// @notice Fee to burn in basis points
    uint16 public burnFeeBps;

    /// @notice Maximum wallet balance as percentage of total supply (0 = no limit)
    uint256 public maxWalletPercent;

    /// @notice Maximum transaction as percentage of total supply (0 = no limit)
    uint256 public maxTxPercent;

    /// @notice Addresses exempt from fees
    mapping(address => bool) public isFeeExempt;

    /// @notice Addresses exempt from max wallet/tx limits
    mapping(address => bool) public isLimitExempt;

    /// @notice Authorized minters (Warp Route contracts)
    mapping(address => bool) public authorizedMinters;

    /// @notice Authorized burners (Warp Route contracts)
    mapping(address => bool) public authorizedBurners;

    /// @notice Whether transfers are paused
    bool public transfersPaused;

    /// @notice Whether token has been initialized with distribution
    bool public initialized;

    /// @notice Total fees collected for holders (for tracking)
    uint256 public totalHolderFees;

    /// @notice Is this the home chain (full supply)
    bool public immutable isHomeChain;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _initialSupply Initial supply (only minted on home chain)
     * @param _owner Contract owner
     * @param _isHomeChain Whether this is the home chain
     */
    constructor(string memory _name, string memory _symbol, uint256 _initialSupply, address _owner, bool _isHomeChain)
        ERC20(_name, _symbol)
        ERC20Permit(_name)
        Ownable(_owner)
    {
        if (_owner == address(0)) revert ZeroAddress();

        isHomeChain = _isHomeChain;

        // Only mint initial supply on home chain
        if (_isHomeChain && _initialSupply > 0) {
            _mint(_owner, _initialSupply);
        }

        // Owner is always fee and limit exempt
        isFeeExempt[_owner] = true;
        isLimitExempt[_owner] = true;
    }

    // =============================================================================
    // INITIALIZATION
    // =============================================================================

    /**
     * @notice Initialize fee configuration
     * @param _feeDistributor Address of fee distributor contract
     * @param _treasury Treasury wallet
     * @param _creatorWallet Creator/team wallet
     * @param _holdersFeeBps Fee to holders in bps
     * @param _creatorsFeeBps Fee to creators in bps
     * @param _treasuryFeeBps Fee to treasury in bps
     * @param _burnFeeBps Fee to burn in bps
     * @param _maxWalletPercent Max wallet as % of supply (0 = no limit)
     * @param _maxTxPercent Max tx as % of supply (0 = no limit)
     */
    function initialize(
        address _feeDistributor,
        address _treasury,
        address _creatorWallet,
        uint16 _holdersFeeBps,
        uint16 _creatorsFeeBps,
        uint16 _treasuryFeeBps,
        uint16 _burnFeeBps,
        uint256 _maxWalletPercent,
        uint256 _maxTxPercent
    ) external onlyOwner {
        if (initialized) revert AlreadyInitialized();

        if (_feeDistributor == address(0) && _holdersFeeBps > 0) revert ZeroAddress();
        if (_treasury == address(0) && _treasuryFeeBps > 0) revert ZeroAddress();
        if (_creatorWallet == address(0) && _creatorsFeeBps > 0) revert ZeroAddress();

        uint256 totalFee = uint256(_holdersFeeBps) + _creatorsFeeBps + _treasuryFeeBps + _burnFeeBps;
        if (totalFee > 2500) revert InvalidFeePercent(totalFee); // Max 25% total fee

        feeDistributor = _feeDistributor;
        treasury = _treasury;
        creatorWallet = _creatorWallet;
        holdersFeeBps = _holdersFeeBps;
        creatorsFeeBps = _creatorsFeeBps;
        treasuryFeeBps = _treasuryFeeBps;
        burnFeeBps = _burnFeeBps;
        maxWalletPercent = _maxWalletPercent;
        maxTxPercent = _maxTxPercent;

        // Make fee-receiving addresses exempt
        if (_feeDistributor != address(0)) {
            isFeeExempt[_feeDistributor] = true;
            isLimitExempt[_feeDistributor] = true;
        }
        if (_treasury != address(0)) {
            isFeeExempt[_treasury] = true;
            isLimitExempt[_treasury] = true;
        }
        if (_creatorWallet != address(0)) {
            isFeeExempt[_creatorWallet] = true;
            isLimitExempt[_creatorWallet] = true;
        }

        initialized = true;
    }

    // =============================================================================
    // TRANSFER LOGIC WITH FEES
    // =============================================================================

    /**
     * @dev Override transfer to apply fees and limits
     */
    function _update(address from, address to, uint256 amount) internal virtual override {
        if (transfersPaused && from != address(0) && to != address(0)) {
            revert TransfersPaused();
        }

        // Skip checks for mint/burn
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        // Check max transaction
        if (maxTxPercent > 0 && !isLimitExempt[from] && !isLimitExempt[to]) {
            uint256 maxTx = (totalSupply() * maxTxPercent) / 100;
            if (amount > maxTx) revert ExceedsMaxTransaction(amount, maxTx);
        }

        // Calculate and apply fees
        uint256 feeAmount = 0;
        if (!isFeeExempt[from] && !isFeeExempt[to]) {
            feeAmount = _calculateAndDistributeFees(from, amount);
        }

        uint256 transferAmount = amount - feeAmount;

        // Check max wallet for recipient
        if (maxWalletPercent > 0 && !isLimitExempt[to]) {
            uint256 maxWalletAmount = (totalSupply() * maxWalletPercent) / 100;
            uint256 newBalance = balanceOf(to) + transferAmount;
            if (newBalance > maxWalletAmount) revert ExceedsMaxWallet(newBalance, maxWalletAmount);
        }

        super._update(from, to, transferAmount);
    }

    /**
     * @dev Calculate and distribute fees
     * @return totalFee Total fee deducted
     */
    function _calculateAndDistributeFees(address from, uint256 amount) internal returns (uint256 totalFee) {
        uint256 holdersFee = (amount * holdersFeeBps) / 10000;
        uint256 creatorsFee = (amount * creatorsFeeBps) / 10000;
        uint256 treasuryFee = (amount * treasuryFeeBps) / 10000;
        uint256 burnFee = (amount * burnFeeBps) / 10000;

        totalFee = holdersFee + creatorsFee + treasuryFee + burnFee;

        if (totalFee == 0) return 0;

        // Transfer fees to recipients
        if (holdersFee > 0 && feeDistributor != address(0)) {
            super._update(from, feeDistributor, holdersFee);
            totalHolderFees += holdersFee;
        }

        if (creatorsFee > 0 && creatorWallet != address(0)) {
            super._update(from, creatorWallet, creatorsFee);
        }

        if (treasuryFee > 0 && treasury != address(0)) {
            super._update(from, treasury, treasuryFee);
        }

        if (burnFee > 0) {
            super._update(from, address(0), burnFee);
        }

        emit FeesCollected(holdersFee, creatorsFee, treasuryFee, burnFee);
    }

    // =============================================================================
    // BRIDGE FUNCTIONS (Hyperlane Warp Route)
    // =============================================================================

    /**
     * @notice Mint tokens (only callable by authorized minters - Warp Route)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external {
        if (!authorizedMinters[msg.sender]) revert NotAuthorizedMinter();
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from sender (anyone can burn their own)
     * @param amount Amount to burn
     */
    function burnFrom(address account, uint256 amount) public override {
        if (!authorizedBurners[msg.sender] && msg.sender != account) {
            // Standard ERC20Burnable behavior - check allowance
            _spendAllowance(account, msg.sender, amount);
        }
        _burn(account, amount);
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Update fee distributor
     */
    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        address old = feeDistributor;
        feeDistributor = _feeDistributor;
        if (_feeDistributor != address(0)) {
            isFeeExempt[_feeDistributor] = true;
            isLimitExempt[_feeDistributor] = true;
        }
        emit FeeDistributorUpdated(old, _feeDistributor);
    }

    /**
     * @notice Update treasury
     */
    function setTreasury(address _treasury) external onlyOwner {
        address old = treasury;
        treasury = _treasury;
        if (_treasury != address(0)) {
            isFeeExempt[_treasury] = true;
            isLimitExempt[_treasury] = true;
        }
        emit TreasuryUpdated(old, _treasury);
    }

    /**
     * @notice Update creator wallet
     */
    function setCreatorWallet(address _creatorWallet) external onlyOwner {
        address old = creatorWallet;
        creatorWallet = _creatorWallet;
        if (_creatorWallet != address(0)) {
            isFeeExempt[_creatorWallet] = true;
            isLimitExempt[_creatorWallet] = true;
        }
        emit CreatorWalletUpdated(old, _creatorWallet);
    }

    /**
     * @notice Update fees (cannot exceed 25% total)
     */
    function setFees(uint16 _holdersFeeBps, uint16 _creatorsFeeBps, uint16 _treasuryFeeBps, uint16 _burnFeeBps)
        external
        onlyOwner
    {
        uint256 totalFee = uint256(_holdersFeeBps) + _creatorsFeeBps + _treasuryFeeBps + _burnFeeBps;
        if (totalFee > 2500) revert InvalidFeePercent(totalFee);

        holdersFeeBps = _holdersFeeBps;
        creatorsFeeBps = _creatorsFeeBps;
        treasuryFeeBps = _treasuryFeeBps;
        burnFeeBps = _burnFeeBps;

        emit FeesUpdated(_holdersFeeBps, _creatorsFeeBps, _treasuryFeeBps, _burnFeeBps);
    }

    /**
     * @notice Set fee exemption for an address
     */
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        isFeeExempt[account] = exempt;
        emit FeeExemptionUpdated(account, exempt);
    }

    /**
     * @notice Set limit exemption for an address
     */
    function setLimitExempt(address account, bool exempt) external onlyOwner {
        isLimitExempt[account] = exempt;
    }

    /**
     * @notice Authorize or revoke minter (for Warp Route)
     */
    function setMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
        if (authorized) {
            isLimitExempt[minter] = true;
            isFeeExempt[minter] = true;
        }
        emit MinterUpdated(minter, authorized);
    }

    /**
     * @notice Authorize or revoke burner (for Warp Route)
     */
    function setBurner(address burner, bool authorized) external onlyOwner {
        authorizedBurners[burner] = authorized;
        if (authorized) {
            isLimitExempt[burner] = true;
            isFeeExempt[burner] = true;
        }
        emit BurnerUpdated(burner, authorized);
    }

    /**
     * @notice Update max wallet percent
     */
    function setMaxWalletPercent(uint256 _maxWalletPercent) external onlyOwner {
        uint256 old = maxWalletPercent;
        maxWalletPercent = _maxWalletPercent;
        emit MaxWalletUpdated(old, _maxWalletPercent);
    }

    /**
     * @notice Update max transaction percent
     */
    function setMaxTxPercent(uint256 _maxTxPercent) external onlyOwner {
        uint256 old = maxTxPercent;
        maxTxPercent = _maxTxPercent;
        emit MaxTransactionUpdated(old, _maxTxPercent);
    }

    /**
     * @notice Pause/unpause transfers (emergency only)
     */
    function setPaused(bool paused) external onlyOwner {
        transfersPaused = paused;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get total fee in basis points
     */
    function totalFeeBps() external view returns (uint256) {
        return uint256(holdersFeeBps) + creatorsFeeBps + treasuryFeeBps + burnFeeBps;
    }

    /**
     * @notice Calculate fee for a given amount
     */
    function calculateFee(uint256 amount) external view returns (uint256) {
        uint256 totalFee = uint256(holdersFeeBps) + creatorsFeeBps + treasuryFeeBps + burnFeeBps;
        return (amount * totalFee) / 10000;
    }

    /**
     * @notice Get max wallet amount
     */
    function maxWallet() external view returns (uint256) {
        if (maxWalletPercent == 0) return type(uint256).max;
        return (totalSupply() * maxWalletPercent) / 100;
    }

    /**
     * @notice Get max transaction amount
     */
    function maxTransaction() external view returns (uint256) {
        if (maxTxPercent == 0) return type(uint256).max;
        return (totalSupply() * maxTxPercent) / 100;
    }
}

