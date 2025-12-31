// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TreasuryDirectorModule
 * @author Jeju Network
 * @notice Safe Module that allows Directors (AI or human) to execute pre-approved operations
 * @dev This module is installed on a Gnosis Safe and allows the Director to execute
 *      specific operations without requiring additional Safe owner signatures.
 *
 * Pre-approved operations:
 * - Execute recurring payments that have been approved by Safe owners
 * - Top up approved accounts within defined limits
 * - Execute approved swaps
 *
 * All approvals are controlled by Safe owners through the Safe itself.
 * The Director can only execute what has been explicitly approved.
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract TreasuryDirectorModule is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Types
    // =========================================================================

    struct TopUpConfig {
        address account;
        address token; // address(0) for ETH
        uint256 dailyLimit;
        uint256 usedToday;
        uint256 lastReset;
        bool active;
    }

    struct RecurringPaymentApproval {
        bytes32 paymentId;
        address treasury;
        bool approved;
        uint256 approvedAt;
    }

    struct SwapApproval {
        address tokenIn;
        address tokenOut;
        uint256 maxSlippageBps;
        uint256 dailyLimit;
        uint256 usedToday;
        uint256 lastReset;
        bool active;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice The Gnosis Safe this module is installed on
    address public immutable safe;

    /// @notice The Director (AI agent or human) authorized to execute operations
    address public director;

    /// @notice Treasury contract address
    address public treasury;

    /// @notice Approved top-up accounts
    mapping(bytes32 => TopUpConfig) public topUpConfigs;
    bytes32[] public topUpIds;

    /// @notice Approved recurring payments
    mapping(bytes32 => RecurringPaymentApproval) public recurringApprovals;
    bytes32[] public approvedPaymentIds;

    /// @notice Approved swaps
    mapping(bytes32 => SwapApproval) public swapApprovals;
    bytes32[] public swapIds;

    /// @notice Daily operation count for rate limiting
    uint256 public dailyOperationLimit = 100;
    uint256 public operationsToday;
    uint256 public lastOperationReset;

    // =========================================================================
    // Events
    // =========================================================================

    event DirectorSet(address indexed oldDirector, address indexed newDirector);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event TopUpApproved(bytes32 indexed configId, address indexed account, address token, uint256 dailyLimit);
    event TopUpRevoked(bytes32 indexed configId);
    event TopUpExecuted(bytes32 indexed configId, address indexed account, address token, uint256 amount);
    event RecurringPaymentApproved(bytes32 indexed paymentId, address indexed treasury);
    event RecurringPaymentRevoked(bytes32 indexed paymentId);
    event RecurringPaymentExecuted(bytes32 indexed paymentId);
    event SwapApproved(bytes32 indexed swapId, address tokenIn, address tokenOut, uint256 dailyLimit);
    event SwapRevoked(bytes32 indexed swapId);
    event SwapExecuted(bytes32 indexed swapId, uint256 amountIn, uint256 amountOut);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotSafe();
    error NotDirector();
    error NotApproved();
    error ExceedsDailyLimit();
    error TransferFailed();
    error ZeroAddress();
    error AlreadyApproved();
    error InsufficientBalance();
    error RateLimitExceeded();

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlySafe() {
        if (msg.sender != safe) revert NotSafe();
        _;
    }

    modifier onlyDirector() {
        if (msg.sender != director) revert NotDirector();
        _;
    }

    modifier checkRateLimit() {
        _resetDailyCounterIfNeeded();
        if (operationsToday >= dailyOperationLimit) revert RateLimitExceeded();
        operationsToday++;
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _safe, address _director, address _treasury) Ownable(msg.sender) {
        if (_safe == address(0)) revert ZeroAddress();
        if (_director == address(0)) revert ZeroAddress();

        safe = _safe;
        director = _director;
        treasury = _treasury;
        lastOperationReset = block.timestamp;
    }

    // =========================================================================
    // Configuration (Safe-only)
    // =========================================================================

    /**
     * @notice Set the Director address
     * @param _director New director address
     */
    function setDirector(address _director) external onlySafe {
        if (_director == address(0)) revert ZeroAddress();
        address oldDirector = director;
        director = _director;
        emit DirectorSet(oldDirector, _director);
    }

    /**
     * @notice Set the Treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlySafe {
        if (_treasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasurySet(oldTreasury, _treasury);
    }

    /**
     * @notice Approve a top-up configuration
     * @param account Account that can be topped up
     * @param token Token to use (address(0) for ETH)
     * @param dailyLimit Maximum daily amount
     */
    function approveTopUp(address account, address token, uint256 dailyLimit) external onlySafe returns (bytes32 configId) {
        if (account == address(0)) revert ZeroAddress();
        if (dailyLimit == 0) revert ZeroAddress(); // Use as zero-check for limit

        configId = keccak256(abi.encodePacked(account, token));

        topUpConfigs[configId] = TopUpConfig({
            account: account,
            token: token,
            dailyLimit: dailyLimit,
            usedToday: 0,
            lastReset: block.timestamp,
            active: true
        });

        topUpIds.push(configId);

        emit TopUpApproved(configId, account, token, dailyLimit);
    }

    /**
     * @notice Revoke a top-up configuration
     * @param configId Configuration ID to revoke
     */
    function revokeTopUp(bytes32 configId) external onlySafe {
        if (!topUpConfigs[configId].active) revert NotApproved();
        topUpConfigs[configId].active = false;
        emit TopUpRevoked(configId);
    }

    /**
     * @notice Approve a recurring payment for Director execution
     * @param paymentId Payment ID from Treasury contract
     * @param _treasury Treasury contract address
     */
    function approveRecurringPayment(bytes32 paymentId, address _treasury) external onlySafe {
        if (recurringApprovals[paymentId].approved) revert AlreadyApproved();

        recurringApprovals[paymentId] = RecurringPaymentApproval({
            paymentId: paymentId,
            treasury: _treasury,
            approved: true,
            approvedAt: block.timestamp
        });

        approvedPaymentIds.push(paymentId);

        emit RecurringPaymentApproved(paymentId, _treasury);
    }

    /**
     * @notice Revoke a recurring payment approval
     * @param paymentId Payment ID to revoke
     */
    function revokeRecurringPayment(bytes32 paymentId) external onlySafe {
        if (!recurringApprovals[paymentId].approved) revert NotApproved();
        recurringApprovals[paymentId].approved = false;
        emit RecurringPaymentRevoked(paymentId);
    }

    /**
     * @notice Set daily operation limit
     * @param newLimit New daily operation limit
     */
    function setDailyOperationLimit(uint256 newLimit) external onlySafe {
        uint256 oldLimit = dailyOperationLimit;
        dailyOperationLimit = newLimit;
        emit DailyLimitUpdated(oldLimit, newLimit);
    }

    // =========================================================================
    // Director Operations
    // =========================================================================

    /**
     * @notice Execute a top-up for an approved account
     * @param configId Top-up configuration ID
     * @param amount Amount to transfer
     */
    function executeTopUp(bytes32 configId, uint256 amount) external onlyDirector nonReentrant checkRateLimit {
        TopUpConfig storage config = topUpConfigs[configId];
        if (!config.active) revert NotApproved();

        // Reset daily counter if needed
        if (block.timestamp >= config.lastReset + 1 days) {
            config.usedToday = 0;
            config.lastReset = block.timestamp;
        }

        // Check daily limit
        if (config.usedToday + amount > config.dailyLimit) revert ExceedsDailyLimit();

        // Update used amount
        config.usedToday += amount;

        // Execute transfer from Safe
        if (config.token == address(0)) {
            // ETH transfer
            _executeFromSafe(config.account, amount, "");
        } else {
            // ERC20 transfer
            bytes memory data = abi.encodeWithSelector(
                IERC20.transfer.selector,
                config.account,
                amount
            );
            _executeFromSafe(config.token, 0, data);
        }

        emit TopUpExecuted(configId, config.account, config.token, amount);
    }

    /**
     * @notice Execute a recurring payment from Treasury
     * @param paymentId Payment ID to execute
     */
    function executeRecurringPayment(bytes32 paymentId) external onlyDirector nonReentrant checkRateLimit {
        RecurringPaymentApproval storage approval = recurringApprovals[paymentId];
        if (!approval.approved) revert NotApproved();

        // Call Treasury.executeRecurringPayment through the Safe
        bytes memory data = abi.encodeWithSignature("executeRecurringPayment(bytes32)", paymentId);
        _executeFromSafe(approval.treasury, 0, data);

        emit RecurringPaymentExecuted(paymentId);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    /**
     * @notice Execute a transaction from the Safe
     * @param to Target address
     * @param value ETH value
     * @param data Call data
     */
    function _executeFromSafe(address to, uint256 value, bytes memory data) internal {
        // Call Safe's execTransactionFromModule
        // This requires the module to be enabled on the Safe
        (bool success,) = safe.call(
            abi.encodeWithSignature(
                "execTransactionFromModule(address,uint256,bytes,uint8)",
                to,
                value,
                data,
                0 // Call operation
            )
        );
        if (!success) revert TransferFailed();
    }

    function _resetDailyCounterIfNeeded() internal {
        if (block.timestamp >= lastOperationReset + 1 days) {
            operationsToday = 0;
            lastOperationReset = block.timestamp;
        }
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get all active top-up configurations
     */
    function getActiveTopUps() external view returns (TopUpConfig[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < topUpIds.length; i++) {
            if (topUpConfigs[topUpIds[i]].active) activeCount++;
        }

        TopUpConfig[] memory active = new TopUpConfig[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < topUpIds.length; i++) {
            if (topUpConfigs[topUpIds[i]].active) {
                active[index] = topUpConfigs[topUpIds[i]];
                index++;
            }
        }

        return active;
    }

    /**
     * @notice Get all approved recurring payments
     */
    function getApprovedRecurringPayments() external view returns (RecurringPaymentApproval[] memory) {
        uint256 approvedCount = 0;
        for (uint256 i = 0; i < approvedPaymentIds.length; i++) {
            if (recurringApprovals[approvedPaymentIds[i]].approved) approvedCount++;
        }

        RecurringPaymentApproval[] memory approved = new RecurringPaymentApproval[](approvedCount);
        uint256 index = 0;
        for (uint256 i = 0; i < approvedPaymentIds.length; i++) {
            if (recurringApprovals[approvedPaymentIds[i]].approved) {
                approved[index] = recurringApprovals[approvedPaymentIds[i]];
                index++;
            }
        }

        return approved;
    }

    /**
     * @notice Check if a recurring payment is approved
     */
    function isRecurringPaymentApproved(bytes32 paymentId) external view returns (bool) {
        return recurringApprovals[paymentId].approved;
    }

    /**
     * @notice Get remaining daily allowance for a top-up
     */
    function getRemainingTopUpAllowance(bytes32 configId) external view returns (uint256) {
        TopUpConfig storage config = topUpConfigs[configId];
        if (!config.active) return 0;

        // Would reset tomorrow
        if (block.timestamp >= config.lastReset + 1 days) {
            return config.dailyLimit;
        }

        return config.dailyLimit > config.usedToday ? config.dailyLimit - config.usedToday : 0;
    }

    /**
     * @notice Get remaining operations for today
     */
    function getRemainingOperations() external view returns (uint256) {
        if (block.timestamp >= lastOperationReset + 1 days) {
            return dailyOperationLimit;
        }
        return dailyOperationLimit > operationsToday ? dailyOperationLimit - operationsToday : 0;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
