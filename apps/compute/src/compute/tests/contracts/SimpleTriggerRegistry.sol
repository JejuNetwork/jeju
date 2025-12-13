// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SimpleTriggerRegistry - Minimal version for SDK testing
 * @dev Simplified to avoid stack-too-deep errors in production contract
 */
contract SimpleTriggerRegistry {
    enum TriggerType { CRON, WEBHOOK, EVENT }
    enum PaymentMode { FREE, X402, PREPAID }

    struct TriggerCore {
        address owner;
        TriggerType triggerType;
        string name;
        string endpoint;
        bool active;
        uint256 executionCount;
        uint256 lastExecutedAt;
        uint256 agentId;
    }

    mapping(bytes32 => TriggerCore) public triggers;
    mapping(address => uint256) public prepaidBalances;
    bytes32[] public allTriggerIds;

    // Cron data stored separately to reduce stack
    mapping(bytes32 => string) public cronExpressions;

    event TriggerRegistered(bytes32 indexed triggerId, address indexed owner, string name);
    event TriggerExecuted(bytes32 indexed triggerId, bytes32 indexed executionId, address indexed executor, bool success);
    event PrepaidDeposit(address indexed account, uint256 amount);
    event PrepaidWithdraw(address indexed account, uint256 amount);

    function registerCronTrigger(
        string calldata name,
        string calldata cronExpression,
        string calldata endpoint
    ) external returns (bytes32) {
        bytes32 triggerId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp));

        triggers[triggerId] = TriggerCore({
            owner: msg.sender,
            triggerType: TriggerType.CRON,
            name: name,
            endpoint: endpoint,
            active: true,
            executionCount: 0,
            lastExecutedAt: 0,
            agentId: 0
        });

        cronExpressions[triggerId] = cronExpression;
        allTriggerIds.push(triggerId);

        emit TriggerRegistered(triggerId, msg.sender, name);
        return triggerId;
    }

    function registerEventTrigger(
        string calldata name,
        string calldata endpoint
    ) external returns (bytes32) {
        bytes32 triggerId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp));

        triggers[triggerId] = TriggerCore({
            owner: msg.sender,
            triggerType: TriggerType.EVENT,
            name: name,
            endpoint: endpoint,
            active: true,
            executionCount: 0,
            lastExecutedAt: 0,
            agentId: 0
        });

        allTriggerIds.push(triggerId);

        emit TriggerRegistered(triggerId, msg.sender, name);
        return triggerId;
    }

    function setTriggerActive(bytes32 triggerId, bool active) external {
        require(triggers[triggerId].owner == msg.sender, "Not owner");
        triggers[triggerId].active = active;
    }

    function recordExecution(
        bytes32 triggerId,
        bool success,
        bytes32 /* outputHash */
    ) external returns (bytes32) {
        require(triggers[triggerId].owner != address(0), "Trigger not found");

        bytes32 executionId = keccak256(abi.encodePacked(triggerId, msg.sender, block.timestamp));

        triggers[triggerId].lastExecutedAt = block.timestamp;
        triggers[triggerId].executionCount++;

        emit TriggerExecuted(triggerId, executionId, msg.sender, success);
        return executionId;
    }

    function depositPrepaid() external payable {
        require(msg.value > 0, "No value");
        prepaidBalances[msg.sender] += msg.value;
        emit PrepaidDeposit(msg.sender, msg.value);
    }

    function withdrawPrepaid(uint256 amount) external {
        require(prepaidBalances[msg.sender] >= amount, "Insufficient balance");
        prepaidBalances[msg.sender] -= amount;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");
        emit PrepaidWithdraw(msg.sender, amount);
    }

    function getTrigger(bytes32 triggerId) external view returns (
        address owner,
        TriggerType triggerType,
        string memory name,
        string memory endpoint,
        bool active,
        uint256 executionCount,
        uint256 lastExecutedAt,
        uint256 agentId
    ) {
        TriggerCore storage t = triggers[triggerId];
        return (t.owner, t.triggerType, t.name, t.endpoint, t.active, t.executionCount, t.lastExecutedAt, t.agentId);
    }

    function getCronTriggers() external view returns (
        bytes32[] memory triggerIds,
        string[] memory expressions,
        string[] memory endpoints
    ) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            if (triggers[allTriggerIds[i]].active && triggers[allTriggerIds[i]].triggerType == TriggerType.CRON) {
                count++;
            }
        }

        triggerIds = new bytes32[](count);
        expressions = new string[](count);
        endpoints = new string[](count);

        uint256 idx = 0;
        for (uint256 i = 0; i < allTriggerIds.length; i++) {
            bytes32 id = allTriggerIds[i];
            if (triggers[id].active && triggers[id].triggerType == TriggerType.CRON) {
                triggerIds[idx] = id;
                expressions[idx] = cronExpressions[id];
                endpoints[idx] = triggers[id].endpoint;
                idx++;
            }
        }
    }

    function getTriggerCount() external view returns (uint256) {
        return allTriggerIds.length;
    }
}
