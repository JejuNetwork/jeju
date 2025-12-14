// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CircuitBreaker
 * @author Jeju Network
 * @notice Global emergency control system for Jeju DAO
 * @dev Implements:
 *      - Emergency pause triggered by any security council member
 *      - Unpause requires multi-sig Safe approval
 *      - Automatic pause on anomaly detection
 *      - Gradual recovery with partial unpause
 *
 * Security Model:
 * - Any security council member can pause (fast response)
 * - Only Safe multi-sig can unpause (prevents single-point compromise)
 * - Anomaly detection for automated protection
 * - Cooldown between pauses to prevent abuse
 *
 * @custom:security-contact security@jeju.network
 */
interface IPausable {
    function pause() external;
    function unpause() external;
    function paused() external view returns (bool);
}

interface IDelegationRegistry {
    function getSecurityCouncil() external view returns (address[] memory);
    function isSecurityCouncilMember(address) external view returns (bool);
}

contract CircuitBreaker is Ownable, ReentrancyGuard {
    // ============================================================================
    // Structs
    // ============================================================================

    struct ProtectedContract {
        address target;
        string name;
        bool isRegistered;
        bool isPaused;
        uint256 pausedAt;
        address pausedBy;
        string pauseReason;
        uint256 priority; // 1 = critical (pause first), 10 = low priority
    }

    struct PauseEvent {
        bytes32 eventId;
        address target;
        address pauser;
        string reason;
        uint256 pausedAt;
        uint256 unpausedAt;
        bool wasEmergency;
    }

    struct AnomalyConfig {
        uint256 maxTransactionsPerBlock;
        uint256 maxValuePerTransaction;
        uint256 maxValuePerHour;
        bool enabled;
    }

    // ============================================================================
    // State
    // ============================================================================

    address public safe;
    IDelegationRegistry public delegationRegistry;

    mapping(address => ProtectedContract) public protectedContracts;
    address[] public allProtectedContracts;

    mapping(bytes32 => PauseEvent) public pauseEvents;
    bytes32[] public allPauseEventIds;

    mapping(address => bool) public isSecurityCouncil;
    address[] public securityCouncilMembers;

    AnomalyConfig public anomalyConfig;
    mapping(uint256 => uint256) public transactionsPerBlock;
    mapping(uint256 => uint256) public valuePerHour;

    bool public globalPause;
    uint256 public lastPauseTime;
    uint256 public pauseCooldown = 1 hours;

    uint256 public pauseEventCount;

    // ============================================================================
    // Events
    // ============================================================================

    event ContractRegistered(address indexed target, string name, uint256 priority);

    event ContractUnregistered(address indexed target);

    event EmergencyPauseTriggered(
        bytes32 indexed eventId, address indexed target, address indexed pauser, string reason
    );

    event GlobalEmergencyPause(address indexed pauser, string reason);

    event ContractUnpaused(bytes32 indexed eventId, address indexed target, address indexed unpauser);

    event GlobalUnpause(address indexed unpauser);

    event AnomalyDetected(address indexed target, string anomalyType, uint256 value);

    event SecurityCouncilSynced(uint256 memberCount);

    event SafeUpdated(address indexed oldSafe, address indexed newSafe);

    // ============================================================================
    // Errors
    // ============================================================================

    error NotSecurityCouncil();
    error NotSafe();
    error ContractNotRegistered();
    error ContractAlreadyRegistered();
    error AlreadyPaused();
    error NotPaused();
    error PauseCooldown();
    error InvalidPriority();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlySecurityCouncil() {
        if (!isSecurityCouncil[msg.sender]) revert NotSecurityCouncil();
        _;
    }

    modifier onlySafe() {
        if (msg.sender != safe) revert NotSafe();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _safe, address _delegationRegistry, address initialOwner) Ownable(initialOwner) {
        require(_safe != address(0), "Invalid safe");

        safe = _safe;
        delegationRegistry = IDelegationRegistry(_delegationRegistry);

        // Initial security council is owner
        isSecurityCouncil[initialOwner] = true;
        securityCouncilMembers.push(initialOwner);

        // Default anomaly config
        anomalyConfig = AnomalyConfig({
            maxTransactionsPerBlock: 100,
            maxValuePerTransaction: 1000 ether,
            maxValuePerHour: 10000 ether,
            enabled: true
        });
    }

    // ============================================================================
    // Contract Registration
    // ============================================================================

    /**
     * @notice Register a contract for circuit breaker protection
     * @param target Contract address
     * @param name Human-readable name
     * @param priority 1-10, lower = higher priority
     */
    function registerContract(address target, string calldata name, uint256 priority) external onlyOwner {
        if (protectedContracts[target].isRegistered) revert ContractAlreadyRegistered();
        if (priority == 0 || priority > 10) revert InvalidPriority();

        protectedContracts[target] = ProtectedContract({
            target: target,
            name: name,
            isRegistered: true,
            isPaused: false,
            pausedAt: 0,
            pausedBy: address(0),
            pauseReason: "",
            priority: priority
        });

        allProtectedContracts.push(target);

        emit ContractRegistered(target, name, priority);
    }

    /**
     * @notice Unregister a contract
     */
    function unregisterContract(address target) external onlyOwner {
        if (!protectedContracts[target].isRegistered) revert ContractNotRegistered();

        delete protectedContracts[target];

        // Remove from array
        for (uint256 i = 0; i < allProtectedContracts.length; i++) {
            if (allProtectedContracts[i] == target) {
                allProtectedContracts[i] = allProtectedContracts[allProtectedContracts.length - 1];
                allProtectedContracts.pop();
                break;
            }
        }

        emit ContractUnregistered(target);
    }

    // ============================================================================
    // Emergency Pause
    // ============================================================================

    /**
     * @notice Pause a specific contract (security council)
     * @param target Contract to pause
     * @param reason Reason for pause
     */
    function pauseContract(address target, string calldata reason)
        external
        onlySecurityCouncil
        nonReentrant
        returns (bytes32 eventId)
    {
        ProtectedContract storage pc = protectedContracts[target];
        if (!pc.isRegistered) revert ContractNotRegistered();
        if (pc.isPaused) revert AlreadyPaused();

        pc.isPaused = true;
        pc.pausedAt = block.timestamp;
        pc.pausedBy = msg.sender;
        pc.pauseReason = reason;

        eventId = keccak256(abi.encodePacked(target, msg.sender, block.timestamp, pauseEventCount++));

        pauseEvents[eventId] = PauseEvent({
            eventId: eventId,
            target: target,
            pauser: msg.sender,
            reason: reason,
            pausedAt: block.timestamp,
            unpausedAt: 0,
            wasEmergency: true
        });
        allPauseEventIds.push(eventId);

        // Actually pause the contract
        IPausable(target).pause();

        emit EmergencyPauseTriggered(eventId, target, msg.sender, reason);
    }

    /**
     * @notice Global emergency pause - pauses all registered contracts
     * @param reason Reason for global pause
     */
    function globalEmergencyPause(string calldata reason) external onlySecurityCouncil nonReentrant {
        if (globalPause) revert AlreadyPaused();
        if (block.timestamp < lastPauseTime + pauseCooldown) revert PauseCooldown();

        globalPause = true;
        lastPauseTime = block.timestamp;

        // Sort contracts by priority and pause in order
        address[] memory sorted = _sortByPriority();

        for (uint256 i = 0; i < sorted.length; i++) {
            ProtectedContract storage pc = protectedContracts[sorted[i]];
            if (!pc.isPaused) {
                pc.isPaused = true;
                pc.pausedAt = block.timestamp;
                pc.pausedBy = msg.sender;
                pc.pauseReason = reason;

                // Try to pause, continue if fails
                try IPausable(sorted[i]).pause() {} catch {}
            }
        }

        emit GlobalEmergencyPause(msg.sender, reason);
    }

    /**
     * @notice Unpause a specific contract (Safe only)
     * @param target Contract to unpause
     */
    function unpauseContract(address target) external onlySafe nonReentrant {
        ProtectedContract storage pc = protectedContracts[target];
        if (!pc.isRegistered) revert ContractNotRegistered();
        if (!pc.isPaused) revert NotPaused();

        // Find the pause event and update it
        for (uint256 i = allPauseEventIds.length; i > 0; i--) {
            PauseEvent storage pe = pauseEvents[allPauseEventIds[i - 1]];
            if (pe.target == target && pe.unpausedAt == 0) {
                pe.unpausedAt = block.timestamp;
                emit ContractUnpaused(pe.eventId, target, msg.sender);
                break;
            }
        }

        pc.isPaused = false;
        pc.pausedAt = 0;
        pc.pausedBy = address(0);
        pc.pauseReason = "";

        IPausable(target).unpause();
    }

    /**
     * @notice Global unpause (Safe only)
     */
    function globalUnpause() external onlySafe nonReentrant {
        if (!globalPause) revert NotPaused();

        globalPause = false;

        // Unpause all contracts in reverse priority order
        address[] memory sorted = _sortByPriority();

        for (uint256 i = sorted.length; i > 0; i--) {
            ProtectedContract storage pc = protectedContracts[sorted[i - 1]];
            if (pc.isPaused) {
                pc.isPaused = false;
                pc.pausedAt = 0;
                pc.pausedBy = address(0);
                pc.pauseReason = "";

                // Try to unpause, continue if fails
                try IPausable(sorted[i - 1]).unpause() {} catch {}
            }
        }

        emit GlobalUnpause(msg.sender);
    }

    // ============================================================================
    // Anomaly Detection
    // ============================================================================

    /**
     * @notice Check for anomalies before transaction
     * @param target Contract being called
     * @param value Value being transferred
     * @return shouldPause Whether an anomaly was detected
     */
    function checkAnomaly(address target, uint256 value) external returns (bool shouldPause) {
        if (!anomalyConfig.enabled) return false;
        if (!protectedContracts[target].isRegistered) return false;

        uint256 currentHour = block.timestamp / 1 hours;

        // Check transaction count per block
        transactionsPerBlock[block.number]++;
        if (transactionsPerBlock[block.number] > anomalyConfig.maxTransactionsPerBlock) {
            emit AnomalyDetected(target, "HIGH_TX_COUNT", transactionsPerBlock[block.number]);
            return true;
        }

        // Check single transaction value
        if (value > anomalyConfig.maxValuePerTransaction) {
            emit AnomalyDetected(target, "HIGH_TX_VALUE", value);
            return true;
        }

        // Check hourly value
        valuePerHour[currentHour] += value;
        if (valuePerHour[currentHour] > anomalyConfig.maxValuePerHour) {
            emit AnomalyDetected(target, "HIGH_HOURLY_VALUE", valuePerHour[currentHour]);
            return true;
        }

        return false;
    }

    /**
     * @notice Auto-pause on anomaly (callable by anyone)
     */
    function autoPauseOnAnomaly(address target, string calldata anomalyType) external nonReentrant {
        ProtectedContract storage pc = protectedContracts[target];
        if (!pc.isRegistered) revert ContractNotRegistered();
        if (pc.isPaused) return;

        // Verify anomaly conditions are actually met
        bool shouldPause;
        if (keccak256(bytes(anomalyType)) == keccak256("HIGH_TX_COUNT")) {
            shouldPause = transactionsPerBlock[block.number] > anomalyConfig.maxTransactionsPerBlock;
        } else if (keccak256(bytes(anomalyType)) == keccak256("HIGH_HOURLY_VALUE")) {
            uint256 currentHour = block.timestamp / 1 hours;
            shouldPause = valuePerHour[currentHour] > anomalyConfig.maxValuePerHour;
        }

        if (shouldPause) {
            pc.isPaused = true;
            pc.pausedAt = block.timestamp;
            pc.pausedBy = address(0); // Auto-paused
            pc.pauseReason = anomalyType;

            bytes32 eventId = keccak256(abi.encodePacked(target, anomalyType, block.timestamp, pauseEventCount++));

            pauseEvents[eventId] = PauseEvent({
                eventId: eventId,
                target: target,
                pauser: address(0),
                reason: anomalyType,
                pausedAt: block.timestamp,
                unpausedAt: 0,
                wasEmergency: false
            });
            allPauseEventIds.push(eventId);

            try IPausable(target).pause() {} catch {}

            emit EmergencyPauseTriggered(eventId, target, address(0), anomalyType);
        }
    }

    // ============================================================================
    // Security Council Sync
    // ============================================================================

    /**
     * @notice Sync security council from delegation registry
     */
    function syncSecurityCouncil() external {
        if (address(delegationRegistry) == address(0)) return;

        // Clear existing
        for (uint256 i = 0; i < securityCouncilMembers.length; i++) {
            isSecurityCouncil[securityCouncilMembers[i]] = false;
        }
        delete securityCouncilMembers;

        // Always keep owner
        isSecurityCouncil[owner()] = true;
        securityCouncilMembers.push(owner());

        // Get from delegation registry
        try delegationRegistry.getSecurityCouncil() returns (address[] memory council) {
            for (uint256 i = 0; i < council.length; i++) {
                if (!isSecurityCouncil[council[i]]) {
                    isSecurityCouncil[council[i]] = true;
                    securityCouncilMembers.push(council[i]);
                }
            }
        } catch {}

        emit SecurityCouncilSynced(securityCouncilMembers.length);
    }

    /**
     * @notice Manually add security council member
     */
    function addSecurityCouncilMember(address member) external onlyOwner {
        if (!isSecurityCouncil[member]) {
            isSecurityCouncil[member] = true;
            securityCouncilMembers.push(member);
        }
    }

    /**
     * @notice Manually remove security council member
     */
    function removeSecurityCouncilMember(address member) external onlyOwner {
        require(member != owner(), "Cannot remove owner");
        if (isSecurityCouncil[member]) {
            isSecurityCouncil[member] = false;
            for (uint256 i = 0; i < securityCouncilMembers.length; i++) {
                if (securityCouncilMembers[i] == member) {
                    securityCouncilMembers[i] = securityCouncilMembers[securityCouncilMembers.length - 1];
                    securityCouncilMembers.pop();
                    break;
                }
            }
        }
    }

    // ============================================================================
    // Internal Helpers
    // ============================================================================

    function _sortByPriority() internal view returns (address[] memory) {
        address[] memory result = new address[](allProtectedContracts.length);
        for (uint256 i = 0; i < allProtectedContracts.length; i++) {
            result[i] = allProtectedContracts[i];
        }

        // Simple bubble sort by priority
        for (uint256 i = 0; i < result.length; i++) {
            for (uint256 j = i + 1; j < result.length; j++) {
                if (protectedContracts[result[j]].priority < protectedContracts[result[i]].priority) {
                    (result[i], result[j]) = (result[j], result[i]);
                }
            }
        }

        return result;
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getProtectedContract(address target) external view returns (ProtectedContract memory) {
        return protectedContracts[target];
    }

    function getAllProtectedContracts() external view returns (address[] memory) {
        return allProtectedContracts;
    }

    function getPausedContracts() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allProtectedContracts.length; i++) {
            if (protectedContracts[allProtectedContracts[i]].isPaused) count++;
        }

        address[] memory result = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allProtectedContracts.length; i++) {
            if (protectedContracts[allProtectedContracts[i]].isPaused) {
                result[j++] = allProtectedContracts[i];
            }
        }

        return result;
    }

    function getPauseHistory(uint256 limit) external view returns (PauseEvent[] memory) {
        uint256 resultSize = limit < allPauseEventIds.length ? limit : allPauseEventIds.length;
        PauseEvent[] memory result = new PauseEvent[](resultSize);

        for (uint256 i = 0; i < resultSize; i++) {
            uint256 idx = allPauseEventIds.length - 1 - i;
            result[i] = pauseEvents[allPauseEventIds[idx]];
        }

        return result;
    }

    function getSecurityCouncilMembers() external view returns (address[] memory) {
        return securityCouncilMembers;
    }

    function isContractPaused(address target) external view returns (bool) {
        if (globalPause) return true;
        return protectedContracts[target].isPaused;
    }

    // ============================================================================
    // Configuration
    // ============================================================================

    function setSafe(address newSafe) external onlyOwner {
        require(newSafe != address(0), "Invalid safe");
        address old = safe;
        safe = newSafe;
        emit SafeUpdated(old, newSafe);
    }

    function setDelegationRegistry(address newRegistry) external onlyOwner {
        delegationRegistry = IDelegationRegistry(newRegistry);
    }

    function setAnomalyConfig(uint256 maxTxPerBlock, uint256 maxValuePerTx, uint256 maxValuePerHr, bool enabled)
        external
        onlyOwner
    {
        anomalyConfig = AnomalyConfig({
            maxTransactionsPerBlock: maxTxPerBlock,
            maxValuePerTransaction: maxValuePerTx,
            maxValuePerHour: maxValuePerHr,
            enabled: enabled
        });
    }

    function setPauseCooldown(uint256 cooldown) external onlyOwner {
        pauseCooldown = cooldown;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
