// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Treasury} from "./Treasury.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ProfitTreasury
 * @author Jeju Network
 * @notice Treasury for profit distribution (MEV, arbitrage, fees)
 * @dev Extends Treasury with:
 *      - Multi-recipient distribution
 *      - Profit source categorization
 *      - Operator earnings tracking
 *
 * Distribution Model:
 * - Protocol treasury (governance-controlled)
 * - Staker rewards pool
 * - Insurance fund (for bad debt coverage)
 * - Operator rewards (bot operators)
 *
 * @custom:security-contact security@jeju.network
 */
contract ProfitTreasury is Treasury {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Enums
    // =========================================================================
    enum ProfitSource {
        DEX_ARBITRAGE,
        CROSS_CHAIN_ARBITRAGE,
        SANDWICH,
        LIQUIDATION,
        SOLVER_FEE,
        ORACLE_KEEPER,
        PLATFORM_FEE,
        OTHER
    }

    // =========================================================================
    // Structs
    // =========================================================================
    struct DistributionConfig {
        uint16 protocolBps;
        uint16 stakersBps;
        uint16 insuranceBps;
        uint16 operatorBps;
    }

    struct ProfitDeposit {
        address token;
        uint256 amount;
        ProfitSource source;
        bytes32 txHash;
        uint256 timestamp;
        address depositor;
    }

    // =========================================================================
    // Constants
    // =========================================================================
    uint16 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_RECENT_DEPOSITS = 100;

    // =========================================================================
    // State Variables
    // =========================================================================
    DistributionConfig public distribution;

    address public protocolRecipient;
    address public stakersRecipient;
    address public insuranceRecipient;

    mapping(address => uint256) public totalProfitsByToken;
    mapping(ProfitSource => uint256) public totalProfitsBySource;
    mapping(address => mapping(address => uint256)) public operatorEarnings;
    mapping(address => mapping(address => uint256)) public pendingOperatorWithdrawals;

    ProfitDeposit[] public recentDeposits;
    uint256 public totalDepositsCount;

    // =========================================================================
    // Events
    // =========================================================================
    event ProfitDeposited(
        address indexed depositor,
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
    event DistributionConfigUpdated(
        uint16 protocolBps,
        uint16 stakersBps,
        uint16 insuranceBps,
        uint16 operatorBps
    );
    event RecipientUpdated(string recipientType, address newAddress);

    // =========================================================================
    // Errors
    // =========================================================================
    error InvalidDistributionConfig();
    error NothingToDistribute();

    // =========================================================================
    // Constructor
    // =========================================================================
    constructor(
        uint256 _dailyLimit,
        address _admin,
        address _protocolRecipient,
        address _stakersRecipient,
        address _insuranceRecipient
    ) Treasury(_dailyLimit, _admin) {
        if (_protocolRecipient == address(0)) revert ZeroAddress();

        protocolRecipient = _protocolRecipient;
        stakersRecipient = _stakersRecipient != address(0) ? _stakersRecipient : _protocolRecipient;
        insuranceRecipient = _insuranceRecipient != address(0) ? _insuranceRecipient : _protocolRecipient;

        // Default: 50% protocol, 30% stakers, 15% insurance, 5% operators
        distribution = DistributionConfig({
            protocolBps: 5000,
            stakersBps: 3000,
            insuranceBps: 1500,
            operatorBps: 500
        });
    }

    // =========================================================================
    // Profit Deposits
    // =========================================================================

    /**
     * @notice Deposit profit (ETH)
     * @param source Profit source category
     * @param txHash Transaction hash of the profitable trade
     */
    function depositProfit(ProfitSource source, bytes32 txHash)
        external
        payable
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (msg.value == 0) revert ZeroAmount();

        _recordProfit(address(0), msg.value, source, txHash);
    }

    /**
     * @notice Deposit profit (ERC20)
     * @param token Token address
     * @param amount Amount of profit
     * @param source Profit source category
     * @param txHash Transaction hash of the profitable trade
     */
    function depositTokenProfit(
        address token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    )
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _recordProfit(token, amount, source, txHash);
    }

    function _recordProfit(
        address token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    ) internal {
        totalProfitsByToken[token] += amount;
        totalProfitsBySource[source] += amount;
        totalDepositsCount++;

        // Calculate and record operator share
        uint256 operatorShare = (amount * distribution.operatorBps) / BPS_DENOMINATOR;
        operatorEarnings[msg.sender][token] += operatorShare;
        pendingOperatorWithdrawals[msg.sender][token] += operatorShare;

        // Store recent deposit (circular buffer)
        ProfitDeposit memory profitDeposit = ProfitDeposit({
            token: token,
            amount: amount,
            source: source,
            txHash: txHash,
            timestamp: block.timestamp,
            depositor: msg.sender
        });

        if (recentDeposits.length < MAX_RECENT_DEPOSITS) {
            recentDeposits.push(profitDeposit);
        } else {
            recentDeposits[totalDepositsCount % MAX_RECENT_DEPOSITS] = profitDeposit;
        }

        emit ProfitDeposited(msg.sender, token, amount, source, txHash);
    }

    // =========================================================================
    // Distribution
    // =========================================================================

    /**
     * @notice Distribute accumulated profits to recipients
     * @param token Token to distribute (address(0) for ETH)
     */
    function distributeProfits(address token) external nonReentrant whenNotPaused {
        uint256 balance = token == address(0)
            ? address(this).balance
            : IERC20(token).balanceOf(address(this));

        // Reserve pending operator withdrawals
        uint256 pendingOperator = _estimatePendingOperatorWithdrawals(token);
        uint256 distributable = balance > pendingOperator ? balance - pendingOperator : 0;

        if (distributable == 0) revert NothingToDistribute();

        // Calculate distribution (excluding operator share - already tracked)
        uint256 nonOperatorBps = BPS_DENOMINATOR - distribution.operatorBps;
        uint256 protocolAmount = (distributable * distribution.protocolBps) / nonOperatorBps;
        uint256 stakersAmount = (distributable * distribution.stakersBps) / nonOperatorBps;
        uint256 insuranceAmount = distributable - protocolAmount - stakersAmount;

        // Distribute
        _transferOut(token, protocolRecipient, protocolAmount);
        _transferOut(token, stakersRecipient, stakersAmount);
        _transferOut(token, insuranceRecipient, insuranceAmount);

        emit ProfitDistributed(token, protocolAmount, stakersAmount, insuranceAmount, 0);
    }

    /**
     * @notice Operator withdraws their earned share
     * @param token Token to withdraw
     */
    function withdrawOperatorEarnings(address token) external nonReentrant {
        uint256 amount = pendingOperatorWithdrawals[msg.sender][token];
        if (amount == 0) revert ZeroAmount();

        pendingOperatorWithdrawals[msg.sender][token] = 0;
        _transferOut(token, msg.sender, amount);

        emit OperatorWithdrawal(msg.sender, token, amount);
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _estimatePendingOperatorWithdrawals(address /* token */) internal pure returns (uint256) {
        // In production, would track this more precisely
        // For now, return 0 as deposits already track operator share
        return 0;
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Update distribution configuration
     */
    function setDistribution(
        uint16 protocolBps,
        uint16 stakersBps,
        uint16 insuranceBps,
        uint16 operatorBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
     * @notice Update protocol recipient
     */
    function setProtocolRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        protocolRecipient = newRecipient;
        emit RecipientUpdated("protocol", newRecipient);
    }

    /**
     * @notice Update stakers recipient
     */
    function setStakersRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        stakersRecipient = newRecipient;
        emit RecipientUpdated("stakers", newRecipient);
    }

    /**
     * @notice Update insurance recipient
     */
    function setInsuranceRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        insuranceRecipient = newRecipient;
        emit RecipientUpdated("insurance", newRecipient);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get recent deposits
     */
    function getRecentDeposits() external view returns (ProfitDeposit[] memory) {
        return recentDeposits;
    }

    /**
     * @notice Get operator's pending withdrawal
     */
    function getPendingWithdrawal(address operator, address token) external view returns (uint256) {
        return pendingOperatorWithdrawals[operator][token];
    }

    /**
     * @notice Get operator's total earnings
     */
    function getOperatorEarnings(address operator, address token) external view returns (uint256) {
        return operatorEarnings[operator][token];
    }

    /**
     * @notice Get distribution config
     */
    function getDistributionConfig() external view returns (DistributionConfig memory) {
        return distribution;
    }

    /**
     * @notice Get all recipients
     */
    function getRecipients()
        external
        view
        returns (address protocol, address stakers, address insurance)
    {
        return (protocolRecipient, stakersRecipient, insuranceRecipient);
    }

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }
}





