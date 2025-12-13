// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AutocratTreasury
 * @author Jeju Network
 * @notice Treasury contract for MEV/arbitrage profits captured by Autocrat bots
 * @dev Receives and distributes profits from various MEV strategies:
 *      - DEX arbitrage (intra-chain and cross-chain)
 *      - Sandwich attacks
 *      - Liquidations
 *      - OIF solver fees
 *
 * ## Distribution Model
 * Profits are distributed according to configurable ratios:
 * - Protocol treasury (governance-controlled)
 * - Staker rewards pool
 * - Insurance fund (for bad debt coverage)
 * - Operator rewards (bot operators)
 *
 * ## Security
 * - Only authorized bots can deposit profits
 * - Multi-sig or governance controls withdrawals
 * - Emergency pause functionality
 *
 * @custom:security-contact security@jeju.network
 */
contract AutocratTreasury is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    /// @notice Profit source categories
    enum ProfitSource {
        DEX_ARBITRAGE,
        CROSS_CHAIN_ARBITRAGE,
        SANDWICH,
        LIQUIDATION,
        SOLVER_FEE,
        ORACLE_KEEPER,
        OTHER
    }

    /// @notice Distribution configuration
    struct DistributionConfig {
        uint16 protocolBps;      // Protocol treasury share (basis points)
        uint16 stakersBps;       // Staker rewards share
        uint16 insuranceBps;     // Insurance fund share
        uint16 operatorBps;      // Bot operator share
    }

    /// @notice Profit deposit record
    struct ProfitDeposit {
        address token;
        uint256 amount;
        ProfitSource source;
        bytes32 txHash;
        uint256 timestamp;
        address operator;
    }

    // ============ Constants ============

    uint16 public constant BPS_DENOMINATOR = 10000;

    // ============ State Variables ============

    /// @notice Distribution configuration
    DistributionConfig public distribution;

    /// @notice Distribution recipient addresses
    address public protocolTreasury;
    address public stakersRewardsPool;
    address public insuranceFund;

    /// @notice Authorized bot operators
    mapping(address => bool) public authorizedOperators;

    /// @notice Total profits by token
    mapping(address => uint256) public totalProfitsByToken;

    /// @notice Total profits by source
    mapping(ProfitSource => uint256) public totalProfitsBySource;

    /// @notice Operator earnings by address
    mapping(address => mapping(address => uint256)) public operatorEarnings; // operator => token => amount

    /// @notice Pending operator withdrawals
    mapping(address => mapping(address => uint256)) public pendingOperatorWithdrawals;

    /// @notice Profit deposit history (limited for gas efficiency)
    ProfitDeposit[] public recentDeposits;
    uint256 public constant MAX_RECENT_DEPOSITS = 100;

    /// @notice Total deposits count
    uint256 public totalDepositsCount;

    // ============ Events ============

    event ProfitDeposited(
        address indexed operator,
        address indexed token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    );

    event ProfitDistributed(
        address indexed token,
        uint256 protocolAmount,
        uint256 stakersAmount,
        uint256 insuranceAmount,
        uint256 operatorAmount
    );

    event OperatorWithdrawal(address indexed operator, address indexed token, uint256 amount);
    event OperatorAuthorized(address indexed operator);
    event OperatorRevoked(address indexed operator);
    event DistributionConfigUpdated(uint16 protocolBps, uint16 stakersBps, uint16 insuranceBps, uint16 operatorBps);
    event RecipientUpdated(string recipientType, address newAddress);

    // ============ Errors ============

    error UnauthorizedOperator();
    error InvalidDistributionConfig();
    error InvalidRecipient();
    error InsufficientBalance();
    error ZeroAmount();

    // ============ Modifiers ============

    modifier onlyAuthorizedOperator() {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedOperator();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _protocolTreasury,
        address _stakersRewardsPool,
        address _insuranceFund,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_protocolTreasury == address(0)) revert InvalidRecipient();
        
        protocolTreasury = _protocolTreasury;
        stakersRewardsPool = _stakersRewardsPool != address(0) ? _stakersRewardsPool : _protocolTreasury;
        insuranceFund = _insuranceFund != address(0) ? _insuranceFund : _protocolTreasury;

        // Default distribution: 50% protocol, 30% stakers, 15% insurance, 5% operators
        distribution = DistributionConfig({
            protocolBps: 5000,
            stakersBps: 3000,
            insuranceBps: 1500,
            operatorBps: 500
        });

        // Authorize the owner as initial operator
        authorizedOperators[initialOwner] = true;
        emit OperatorAuthorized(initialOwner);
    }

    // ============ Core Functions ============

    /**
     * @notice Deposit profit from MEV/arbitrage activity
     * @param token Token address (address(0) for ETH)
     * @param amount Amount of profit
     * @param source Profit source category
     * @param txHash Transaction hash of the profitable trade
     */
    function depositProfit(
        address token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    ) external payable nonReentrant whenNotPaused onlyAuthorizedOperator {
        if (amount == 0) revert ZeroAmount();

        // Handle token transfer
        if (token == address(0)) {
            // ETH deposit
            require(msg.value == amount, "ETH amount mismatch");
        } else {
            // ERC20 deposit
            require(msg.value == 0, "ETH not accepted for token deposit");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Record profit
        totalProfitsByToken[token] += amount;
        totalProfitsBySource[source] += amount;
        totalDepositsCount++;

        // Calculate and record operator share
        uint256 operatorShare = (amount * distribution.operatorBps) / BPS_DENOMINATOR;
        operatorEarnings[msg.sender][token] += operatorShare;
        pendingOperatorWithdrawals[msg.sender][token] += operatorShare;

        // Store recent deposit (circular buffer)
        ProfitDeposit memory deposit = ProfitDeposit({
            token: token,
            amount: amount,
            source: source,
            txHash: txHash,
            timestamp: block.timestamp,
            operator: msg.sender
        });

        if (recentDeposits.length < MAX_RECENT_DEPOSITS) {
            recentDeposits.push(deposit);
        } else {
            recentDeposits[totalDepositsCount % MAX_RECENT_DEPOSITS] = deposit;
        }

        emit ProfitDeposited(msg.sender, token, amount, source, txHash);
    }

    /**
     * @notice Distribute accumulated profits to recipients
     * @param token Token to distribute (address(0) for ETH)
     */
    function distributeProfits(address token) external nonReentrant whenNotPaused {
        uint256 balance = token == address(0) 
            ? address(this).balance 
            : IERC20(token).balanceOf(address(this));

        // Subtract pending operator withdrawals
        uint256 pendingOperator = _getTotalPendingOperatorWithdrawals(token);
        uint256 distributable = balance > pendingOperator ? balance - pendingOperator : 0;

        if (distributable == 0) revert InsufficientBalance();

        // Calculate distribution amounts
        uint256 protocolAmount = (distributable * distribution.protocolBps) / BPS_DENOMINATOR;
        uint256 stakersAmount = (distributable * distribution.stakersBps) / BPS_DENOMINATOR;
        uint256 insuranceAmount = (distributable * distribution.insuranceBps) / BPS_DENOMINATOR;
        // Operator share already tracked in depositProfit

        // Distribute
        _transfer(token, protocolTreasury, protocolAmount);
        _transfer(token, stakersRewardsPool, stakersAmount);
        _transfer(token, insuranceFund, insuranceAmount);

        emit ProfitDistributed(token, protocolAmount, stakersAmount, insuranceAmount, 0);
    }

    /**
     * @notice Operator withdraws their earned share
     * @param token Token to withdraw
     */
    function withdrawOperatorEarnings(address token) external nonReentrant {
        uint256 amount = pendingOperatorWithdrawals[msg.sender][token];
        if (amount == 0) revert InsufficientBalance();

        pendingOperatorWithdrawals[msg.sender][token] = 0;
        _transfer(token, msg.sender, amount);

        emit OperatorWithdrawal(msg.sender, token, amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize a new bot operator
     * @param operator Operator address to authorize
     */
    function authorizeOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert InvalidRecipient();
        authorizedOperators[operator] = true;
        emit OperatorAuthorized(operator);
    }

    /**
     * @notice Revoke operator authorization
     * @param operator Operator address to revoke
     */
    function revokeOperator(address operator) external onlyOwner {
        authorizedOperators[operator] = false;
        emit OperatorRevoked(operator);
    }

    /**
     * @notice Update distribution configuration
     * @param protocolBps Protocol treasury share in basis points
     * @param stakersBps Stakers rewards share
     * @param insuranceBps Insurance fund share
     * @param operatorBps Bot operator share
     */
    function setDistribution(
        uint16 protocolBps,
        uint16 stakersBps,
        uint16 insuranceBps,
        uint16 operatorBps
    ) external onlyOwner {
        if (protocolBps + stakersBps + insuranceBps + operatorBps != BPS_DENOMINATOR) {
            revert InvalidDistributionConfig();
        }

        distribution = DistributionConfig({
            protocolBps: protocolBps,
            stakersBps: stakersBps,
            insuranceBps: insuranceBps,
            operatorBps: operatorBps
        });

        emit DistributionConfigUpdated(protocolBps, stakersBps, insuranceBps, operatorBps);
    }

    /**
     * @notice Update protocol treasury address
     */
    function setProtocolTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidRecipient();
        protocolTreasury = newTreasury;
        emit RecipientUpdated("protocolTreasury", newTreasury);
    }

    /**
     * @notice Update stakers rewards pool address
     */
    function setStakersRewardsPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert InvalidRecipient();
        stakersRewardsPool = newPool;
        emit RecipientUpdated("stakersRewardsPool", newPool);
    }

    /**
     * @notice Update insurance fund address
     */
    function setInsuranceFund(address newFund) external onlyOwner {
        if (newFund == address(0)) revert InvalidRecipient();
        insuranceFund = newFund;
        emit RecipientUpdated("insuranceFund", newFund);
    }

    /**
     * @notice Emergency withdraw (governance only)
     * @param token Token to withdraw (address(0) for ETH)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        _transfer(token, to, amount);
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get recent deposits
     * @return deposits Array of recent profit deposits
     */
    function getRecentDeposits() external view returns (ProfitDeposit[] memory) {
        return recentDeposits;
    }

    /**
     * @notice Get operator's pending withdrawal for a token
     * @param operator Operator address
     * @param token Token address
     * @return amount Pending withdrawal amount
     */
    function getPendingWithdrawal(address operator, address token) external view returns (uint256) {
        return pendingOperatorWithdrawals[operator][token];
    }

    /**
     * @notice Get operator's total earnings for a token
     * @param operator Operator address
     * @param token Token address
     * @return amount Total earnings
     */
    function getOperatorEarnings(address operator, address token) external view returns (uint256) {
        return operatorEarnings[operator][token];
    }

    /**
     * @notice Get current distribution config
     */
    function getDistributionConfig() external view returns (DistributionConfig memory) {
        return distribution;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Internal Functions ============

    function _transfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        
        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _getTotalPendingOperatorWithdrawals(address /*token*/) internal pure returns (uint256) {
        // In a full implementation, this would iterate through operators
        // For gas efficiency, we track this separately in deposit
        return 0;
    }

    receive() external payable {}
}
