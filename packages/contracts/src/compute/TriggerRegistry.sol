// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TriggerRegistry
 * @notice On-chain registry for permissionless trigger execution
 * @dev Allows apps to register cron/webhook/event triggers for decentralized execution
 *
 * Features:
 * - Register triggers with cron schedules or event types
 * - Executors can claim and execute triggers
 * - Payment via x402 or prepaid credits
 * - Execution history for accountability
 */
contract TriggerRegistry is Ownable, ReentrancyGuard {
    // =========================================================================
    // Types
    // =========================================================================

    enum TriggerType {
        CRON,
        WEBHOOK,
        EVENT
    }
    enum PaymentMode {
        FREE,
        X402,
        PREPAID
    }

    struct Trigger {
        bytes32 triggerId;
        address owner;
        uint256 agentId; // ERC-8004 agent identity (0 if none)
        TriggerType triggerType;
        string name;
        string description;
        string cronExpression; // For CRON type
        string webhookPath; // For WEBHOOK type
        string[] eventTypes; // For EVENT type
        string endpoint;
        string method; // GET, POST, etc.
        uint256 timeout; // seconds
        PaymentMode paymentMode;
        uint256 pricePerExecution; // wei
        bool active;
        uint256 createdAt;
        uint256 lastExecutedAt;
        uint256 executionCount;
    }

    struct Execution {
        bytes32 executionId;
        bytes32 triggerId;
        address executor;
        uint256 startedAt;
        uint256 finishedAt;
        bool success;
        bytes32 outputHash; // Hash of output for verification
        uint256 cost;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice All registered triggers
    mapping(bytes32 => Trigger) public triggers;

    /// @notice Trigger IDs by owner
    mapping(address => bytes32[]) public ownerTriggers;

    /// @notice Trigger IDs by ERC-8004 agent ID
    mapping(uint256 => bytes32[]) public agentTriggers;

    /// @notice All trigger IDs
    bytes32[] public allTriggerIds;

    /// @notice Execution history
    mapping(bytes32 => Execution) public executions;

    /// @notice Executions by trigger
    mapping(bytes32 => bytes32[]) public triggerExecutions;

    /// @notice Prepaid balances for trigger execution
    mapping(address => uint256) public prepaidBalances;

    /// @notice Authorized executors (can be anyone if empty)
    mapping(address => bool) public authorizedExecutors;
    bool public requireAuthorization;

    /// @notice Execution fee for executors
    uint256 public executorFeePercent = 10; // 10% to executor

    // =========================================================================
    // Events
    // =========================================================================

    event TriggerRegistered(bytes32 indexed triggerId, address indexed owner, string name, TriggerType triggerType);
    event TriggerRegisteredWithAgent(
        bytes32 indexed triggerId, address indexed owner, uint256 indexed agentId, string name
    );
    event TriggerUpdated(bytes32 indexed triggerId, bool active);
    event TriggerExecuted(
        bytes32 indexed triggerId, bytes32 indexed executionId, address indexed executor, bool success
    );
    event PrepaidDeposit(address indexed account, uint256 amount);
    event PrepaidWithdraw(address indexed account, uint256 amount);
    event ExecutorAuthorized(address indexed executor, bool authorized);

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor() Ownable(msg.sender) {}

    // =========================================================================
    // Trigger Registration
    // =========================================================================

    /**
     * @notice Register a new trigger
     */
    function registerTrigger(
        string calldata name,
        string calldata description,
        TriggerType triggerType,
        string calldata cronExpression,
        string calldata webhookPath,
        string[] calldata eventTypes,
        string calldata endpoint,
        string calldata method,
        uint256 timeout,
        PaymentMode paymentMode,
        uint256 pricePerExecution
    ) external returns (bytes32) {
        bytes32 triggerId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp));

        require(triggers[triggerId].createdAt == 0, "Trigger exists");
        require(bytes(name).length > 0, "Name required");
        require(bytes(endpoint).length > 0, "Endpoint required");
        require(timeout > 0 && timeout <= 3600, "Invalid timeout");

        Trigger storage trigger = triggers[triggerId];
        trigger.triggerId = triggerId;
        trigger.owner = msg.sender;
        trigger.triggerType = triggerType;
        trigger.name = name;
        trigger.description = description;
        trigger.cronExpression = cronExpression;
        trigger.webhookPath = webhookPath;
        trigger.eventTypes = eventTypes;
        trigger.endpoint = endpoint;
        trigger.method = method;
        trigger.timeout = timeout;
        trigger.paymentMode = paymentMode;
        trigger.pricePerExecution = pricePerExecution;
        trigger.active = true;
        trigger.createdAt = block.timestamp;

        ownerTriggers[msg.sender].push(triggerId);
        allTriggerIds.push(triggerId);

        emit TriggerRegistered(triggerId, msg.sender, name, triggerType);

        return triggerId;
    }

    /**
     * @notice Register a trigger with ERC-8004 agent identity
     * @dev Links the trigger to an agent for cross-protocol discovery
     */
    function registerTriggerWithAgent(
        string calldata name,
        string calldata description,
        TriggerType triggerType,
        string calldata cronExpression,
        string calldata endpoint,
        uint256 timeout,
        PaymentMode paymentMode,
        uint256 pricePerExecution,
        uint256 agentId
    ) external returns (bytes32) {
        require(agentId > 0, "Agent ID required");

        bytes32 triggerId = keccak256(abi.encodePacked(msg.sender, name, agentId, block.timestamp));

        require(triggers[triggerId].createdAt == 0, "Trigger exists");
        require(bytes(name).length > 0, "Name required");
        require(bytes(endpoint).length > 0, "Endpoint required");
        require(timeout > 0 && timeout <= 3600, "Invalid timeout");

        Trigger storage trigger = triggers[triggerId];
        trigger.triggerId = triggerId;
        trigger.owner = msg.sender;
        trigger.agentId = agentId;
        trigger.triggerType = triggerType;
        trigger.name = name;
        trigger.description = description;
        trigger.cronExpression = cronExpression;
        trigger.endpoint = endpoint;
        trigger.method = "POST";
        trigger.timeout = timeout;
        trigger.paymentMode = paymentMode;
        trigger.pricePerExecution = pricePerExecution;
        trigger.active = true;
        trigger.createdAt = block.timestamp;

        ownerTriggers[msg.sender].push(triggerId);
        agentTriggers[agentId].push(triggerId);
        allTriggerIds.push(triggerId);

        emit TriggerRegisteredWithAgent(triggerId, msg.sender, agentId, name);

        return triggerId;
    }

    /**
     * @notice Update trigger status
     */
    function setTriggerActive(bytes32 triggerId, bool active) external {
        Trigger storage trigger = triggers[triggerId];
        require(trigger.owner == msg.sender, "Not owner");
        trigger.active = active;
        emit TriggerUpdated(triggerId, active);
    }

    /**
     * @notice Update trigger endpoint
     */
    function updateTriggerEndpoint(bytes32 triggerId, string calldata endpoint) external {
        Trigger storage trigger = triggers[triggerId];
        require(trigger.owner == msg.sender, "Not owner");
        require(bytes(endpoint).length > 0, "Endpoint required");
        trigger.endpoint = endpoint;
    }

    /**
     * @notice Update trigger pricing
     */
    function updateTriggerPricing(bytes32 triggerId, PaymentMode paymentMode, uint256 pricePerExecution) external {
        Trigger storage trigger = triggers[triggerId];
        require(trigger.owner == msg.sender, "Not owner");
        trigger.paymentMode = paymentMode;
        trigger.pricePerExecution = pricePerExecution;
    }

    // =========================================================================
    // Execution
    // =========================================================================

    /**
     * @notice Record trigger execution
     * @dev Called by authorized executors after executing the trigger
     */
    function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash)
        external
        nonReentrant
        returns (bytes32)
    {
        if (requireAuthorization) {
            require(authorizedExecutors[msg.sender], "Not authorized");
        }

        Trigger storage trigger = triggers[triggerId];
        require(trigger.createdAt > 0, "Trigger not found");
        require(trigger.active, "Trigger not active");

        bytes32 executionId = keccak256(abi.encodePacked(triggerId, msg.sender, block.timestamp));

        // Handle payment
        uint256 cost = 0;
        if (trigger.paymentMode == PaymentMode.PREPAID) {
            cost = trigger.pricePerExecution;
            require(prepaidBalances[trigger.owner] >= cost, "Insufficient prepaid balance");

            // Deduct from owner, pay executor fee
            prepaidBalances[trigger.owner] -= cost;
            uint256 executorFee = (cost * executorFeePercent) / 100;

            (bool sent,) = msg.sender.call{value: executorFee}("");
            require(sent, "Fee transfer failed");
        }

        // Record execution
        Execution storage exec = executions[executionId];
        exec.executionId = executionId;
        exec.triggerId = triggerId;
        exec.executor = msg.sender;
        exec.startedAt = block.timestamp;
        exec.finishedAt = block.timestamp;
        exec.success = success;
        exec.outputHash = outputHash;
        exec.cost = cost;

        triggerExecutions[triggerId].push(executionId);

        // Update trigger stats
        trigger.lastExecutedAt = block.timestamp;
        trigger.executionCount++;

        emit TriggerExecuted(triggerId, executionId, msg.sender, success);

        return executionId;
    }

    // =========================================================================
    // Prepaid Balance
    // =========================================================================

    /**
     * @notice Deposit prepaid balance for trigger execution
     */
    function depositPrepaid() external payable {
        require(msg.value > 0, "No value");
        prepaidBalances[msg.sender] += msg.value;
        emit PrepaidDeposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw prepaid balance
     */
    function withdrawPrepaid(uint256 amount) external nonReentrant {
        require(prepaidBalances[msg.sender] >= amount, "Insufficient balance");
        prepaidBalances[msg.sender] -= amount;

        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        emit PrepaidWithdraw(msg.sender, amount);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /**
     * @notice Authorize or deauthorize an executor
     */
    function setExecutorAuthorized(address executor, bool authorized) external onlyOwner {
        authorizedExecutors[executor] = authorized;
        emit ExecutorAuthorized(executor, authorized);
    }

    /**
     * @notice Set whether authorization is required for executors
     */
    function setRequireAuthorization(bool required) external onlyOwner {
        requireAuthorization = required;
    }

    /**
     * @notice Set executor fee percentage
     */
    function setExecutorFeePercent(uint256 percent) external onlyOwner {
        require(percent <= 50, "Fee too high");
        executorFeePercent = percent;
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get trigger info
     */
    function getTrigger(bytes32 triggerId)
        external
        view
        returns (
            address owner,
            TriggerType triggerType,
            string memory name,
            string memory endpoint,
            bool active,
            uint256 executionCount,
            uint256 lastExecutedAt,
            uint256 agentId
        )
    {
        Trigger storage trigger = triggers[triggerId];
        return (
            trigger.owner,
            trigger.triggerType,
            trigger.name,
            trigger.endpoint,
            trigger.active,
            trigger.executionCount,
            trigger.lastExecutedAt,
            trigger.agentId
        );
    }

    /**
     * @notice Get triggers by ERC-8004 agent ID
     */
    function getAgentTriggers(uint256 agentId) external view returns (bytes32[] memory) {
        return agentTriggers[agentId];
    }

    /**
     * @notice Get all active triggers of a type
     */
    function getActiveTriggers(TriggerType triggerType) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            Trigger storage t = triggers[allTriggerIds[i]];
            if (t.active && t.triggerType == triggerType) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            Trigger storage t = triggers[allTriggerIds[i]];
            if (t.active && t.triggerType == triggerType) {
                result[idx++] = allTriggerIds[i];
            }
        }

        return result;
    }

    /**
     * @notice Get cron triggers (for off-chain executor)
     */
    function getCronTriggers()
        external
        view
        returns (bytes32[] memory triggerIds, string[] memory cronExpressions, string[] memory endpoints)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            Trigger storage t = triggers[allTriggerIds[i]];
            if (t.active && t.triggerType == TriggerType.CRON) {
                count++;
            }
        }

        triggerIds = new bytes32[](count);
        cronExpressions = new string[](count);
        endpoints = new string[](count);

        uint256 idx = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            Trigger storage t = triggers[allTriggerIds[i]];
            if (t.active && t.triggerType == TriggerType.CRON) {
                triggerIds[idx] = allTriggerIds[i];
                cronExpressions[idx] = t.cronExpression;
                endpoints[idx] = t.endpoint;
                idx++;
            }
        }
    }

    /**
     * @notice Get execution history for a trigger
     */
    function getExecutionHistory(bytes32 triggerId, uint256 limit) external view returns (bytes32[] memory) {
        bytes32[] storage history = triggerExecutions[triggerId];
        uint256 start = history.length > limit ? history.length - limit : 0;
        uint256 count = history.length - start;

        bytes32[] memory result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = history[start + i];
        }

        return result;
    }

    /**
     * @notice Get owner's triggers
     */
    function getOwnerTriggers(address owner) external view returns (bytes32[] memory) {
        return ownerTriggers[owner];
    }

    /**
     * @notice Get total trigger count
     */
    function getTriggerCount() external view returns (uint256) {
        return allTriggerIds.length;
    }
}
