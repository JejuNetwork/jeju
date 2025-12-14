// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";
import {ICommitteeManager} from "./interfaces/ICommitteeManager.sol";
import {IOracleStakingManager} from "../oracle-marketplace/interfaces/IOracleStakingManager.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "../registry/interfaces/IReputationRegistry.sol";

/// @title OracleNetworkConnector
/// @notice Connects JON contracts with OracleStakingManager and ERC-8004
contract OracleNetworkConnector is Ownable, ReentrancyGuard {
    IFeedRegistry public feedRegistry;
    ICommitteeManager public committeeManager;
    IOracleStakingManager public stakingManager;
    IIdentityRegistry public identityRegistry;
    IReputationRegistry public reputationRegistry;

    mapping(bytes32 => bytes32) public jonToStakingId;
    mapping(bytes32 => bytes32) public stakingToJonId;
    mapping(address => bytes32) public workerToOperator;

    struct OperatorInfo {
        bytes32 operatorId;
        bytes32 stakingOracleId;
        uint256 agentId;
        address workerKey;
        uint256 registeredAt;
        bool isActive;
    }

    mapping(bytes32 => OperatorInfo) public operators;
    bytes32[] public operatorIds;

    struct EpochPerformance {
        uint256 reportsSubmitted;
        uint256 reportsAccepted;
        uint256 disputesRaised;
        uint256 disputesLost;
        uint256 uptimeBlocks;
        uint256 totalBlocks;
    }

    mapping(bytes32 => mapping(uint256 => EpochPerformance)) public operatorPerformance;

    uint256 public currentEpoch;
    uint256 public epochStartBlock;
    uint256 public constant BLOCKS_PER_EPOCH = 7200;

    bytes32 public constant TAG_ORACLE_UPTIME = keccak256("oracle:uptime");
    bytes32 public constant TAG_ORACLE_ACCURACY = keccak256("oracle:accuracy");
    bytes32 public constant TAG_ORACLE_PARTICIPATION = keccak256("oracle:participation");

    event OperatorRegistered(
        bytes32 indexed operatorId, bytes32 indexed stakingOracleId, uint256 agentId, address workerKey
    );
    event OperatorDeactivated(bytes32 indexed operatorId, string reason);
    event PerformanceRecorded(
        bytes32 indexed operatorId, uint256 indexed epoch, uint256 reportsSubmitted, uint256 reportsAccepted
    );
    event AttestationWritten(bytes32 indexed operatorId, uint256 indexed agentId, bytes32 tag, int8 score);
    event EpochAdvanced(uint256 indexed oldEpoch, uint256 indexed newEpoch);

    error InvalidDependency();
    error OperatorAlreadyRegistered();
    error OperatorNotFound();
    error NotOperator();
    error InvalidStakingOracle();
    error InvalidWorkerKey();
    error EpochNotComplete();

    constructor(
        address _feedRegistry,
        address _committeeManager,
        address _stakingManager,
        address _identityRegistry,
        address _reputationRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_feedRegistry == address(0) || _committeeManager == address(0)) revert InvalidDependency();
        feedRegistry = IFeedRegistry(_feedRegistry);
        committeeManager = ICommitteeManager(_committeeManager);
        if (_stakingManager != address(0)) stakingManager = IOracleStakingManager(_stakingManager);
        if (_identityRegistry != address(0)) identityRegistry = IIdentityRegistry(_identityRegistry);
        if (_reputationRegistry != address(0)) reputationRegistry = IReputationRegistry(_reputationRegistry);
        currentEpoch = 1;
        epochStartBlock = block.number;
    }

    function registerOperator(bytes32 stakingOracleId, uint256 agentId, address workerKey)
        external
        nonReentrant
        returns (bytes32 operatorId)
    {
        if (workerKey == address(0)) revert InvalidWorkerKey();

        if (address(stakingManager) != address(0)) {
            IOracleStakingManager.OracleNode memory node = stakingManager.getOracleInfo(stakingOracleId);
            if (node.operator != msg.sender) revert NotOperator();
            if (node.status != IOracleStakingManager.OracleStatus.Active) revert InvalidStakingOracle();
        }

        if (address(identityRegistry) != address(0) && agentId > 0) {
            if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotOperator();
        }

        operatorId = keccak256(abi.encodePacked(msg.sender, stakingOracleId, agentId, block.timestamp));
        if (operators[operatorId].operatorId != bytes32(0)) revert OperatorAlreadyRegistered();
        if (stakingOracleId != bytes32(0) && stakingToJonId[stakingOracleId] != bytes32(0)) {
            revert OperatorAlreadyRegistered();
        }

        operators[operatorId] = OperatorInfo({
            operatorId: operatorId,
            stakingOracleId: stakingOracleId,
            agentId: agentId,
            workerKey: workerKey,
            registeredAt: block.timestamp,
            isActive: true
        });
        operatorIds.push(operatorId);

        if (stakingOracleId != bytes32(0)) {
            jonToStakingId[operatorId] = stakingOracleId;
            stakingToJonId[stakingOracleId] = operatorId;
        }
        workerToOperator[workerKey] = operatorId;
        emit OperatorRegistered(operatorId, stakingOracleId, agentId, workerKey);
    }

    function deactivateOperator(bytes32 operatorId, string calldata reason) external {
        OperatorInfo storage op = operators[operatorId];
        if (op.operatorId == bytes32(0)) revert OperatorNotFound();

        if (msg.sender != owner()) {
            if (address(stakingManager) != address(0) && op.stakingOracleId != bytes32(0)) {
                if (stakingManager.getOracleInfo(op.stakingOracleId).operator != msg.sender) revert NotOperator();
            } else {
                revert NotOperator();
            }
        }
        op.isActive = false;
        delete workerToOperator[op.workerKey];
        emit OperatorDeactivated(operatorId, reason);
    }

    function recordReportSubmission(bytes32 operatorId, bool accepted) external {
        if (msg.sender != owner()) revert NotOperator();
        EpochPerformance storage perf = operatorPerformance[operatorId][currentEpoch];
        perf.reportsSubmitted++;
        if (accepted) perf.reportsAccepted++;
        emit PerformanceRecorded(operatorId, currentEpoch, perf.reportsSubmitted, perf.reportsAccepted);
    }

    function recordDisputeOutcome(bytes32 operatorId, bool lost) external {
        if (msg.sender != owner()) revert NotOperator();
        EpochPerformance storage perf = operatorPerformance[operatorId][currentEpoch];
        perf.disputesRaised++;
        if (lost) perf.disputesLost++;
    }

    function recordHeartbeat(bytes32 operatorId) external {
        OperatorInfo storage op = operators[operatorId];
        if (op.operatorId == bytes32(0)) revert OperatorNotFound();
        if (op.workerKey != msg.sender && msg.sender != owner()) revert NotOperator();
        operatorPerformance[operatorId][currentEpoch].uptimeBlocks++;
    }

    function advanceEpoch() external nonReentrant {
        if (block.number < epochStartBlock + BLOCKS_PER_EPOCH) revert EpochNotComplete();
        uint256 oldEpoch = currentEpoch;
        for (uint256 i = 0; i < operatorIds.length; i++) {
            _writeEpochAttestations(operatorIds[i], oldEpoch);
        }
        currentEpoch++;
        epochStartBlock = block.number;
        emit EpochAdvanced(oldEpoch, currentEpoch);
    }

    function _writeEpochAttestations(bytes32 operatorId, uint256 epoch) internal {
        OperatorInfo storage op = operators[operatorId];
        if (op.agentId == 0 || address(reputationRegistry) == address(0)) return;

        EpochPerformance storage perf = operatorPerformance[operatorId][epoch];
        int8 participationScore = _calcParticipation(perf);
        int8 accuracyScore = _calcAccuracy(perf);
        int8 uptimeScore = _calcUptime(perf);

        if (participationScore != 0) {
            _writeFeedback(op.agentId, participationScore, TAG_ORACLE_PARTICIPATION);
            emit AttestationWritten(operatorId, op.agentId, TAG_ORACLE_PARTICIPATION, participationScore);
        }
        if (accuracyScore != 0) {
            _writeFeedback(op.agentId, accuracyScore, TAG_ORACLE_ACCURACY);
            emit AttestationWritten(operatorId, op.agentId, TAG_ORACLE_ACCURACY, accuracyScore);
        }
        if (uptimeScore != 0) {
            _writeFeedback(op.agentId, uptimeScore, TAG_ORACLE_UPTIME);
            emit AttestationWritten(operatorId, op.agentId, TAG_ORACLE_UPTIME, uptimeScore);
        }
    }

    function _writeFeedback(uint256 agentId, int8 score, bytes32 tag) internal {
        uint8 normalized = uint8(int8(50) + (score / 2));
        reputationRegistry.giveFeedback(agentId, normalized, tag, bytes32(0), "", bytes32(0), "");
    }

    function _calcParticipation(EpochPerformance storage p) internal view returns (int8) {
        if (p.reportsSubmitted == 0) return -50;
        if (p.reportsSubmitted >= 100) return 50;
        return int8(int256(p.reportsSubmitted / 2));
    }

    function _calcAccuracy(EpochPerformance storage p) internal view returns (int8) {
        if (p.reportsSubmitted == 0) return 0;
        uint256 pct = (p.reportsAccepted * 100) / p.reportsSubmitted;
        if (pct >= 99) return 50;
        if (pct >= 95) return 30;
        if (pct >= 90) return 10;
        if (pct >= 80) return 0;
        return -30;
    }

    function _calcUptime(EpochPerformance storage p) internal view returns (int8) {
        uint256 total = p.totalBlocks == 0 ? BLOCKS_PER_EPOCH : p.totalBlocks;
        uint256 pct = (p.uptimeBlocks * 100) / total;
        if (pct >= 99) return 50;
        if (pct >= 95) return 30;
        if (pct >= 90) return 10;
        if (pct >= 80) return 0;
        return -30;
    }

    function getEligibleOperatorsForFeed(bytes32 feedId) external view returns (address[] memory eligible) {
        uint256 count;
        for (uint256 i = 0; i < operatorIds.length; i++) {
            if (_isEligible(operatorIds[i])) count++;
        }
        eligible = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < operatorIds.length; i++) {
            if (_isEligible(operatorIds[i])) eligible[idx++] = operators[operatorIds[i]].workerKey;
        }
    }

    function _isEligible(bytes32 operatorId) internal view returns (bool) {
        OperatorInfo storage op = operators[operatorId];
        if (!op.isActive) return false;
        if (address(stakingManager) != address(0) && op.stakingOracleId != bytes32(0)) {
            if (stakingManager.getOracleInfo(op.stakingOracleId).status != IOracleStakingManager.OracleStatus.Active) {
                return false;
            }
        }
        return true;
    }

    function getOperator(bytes32 operatorId) external view returns (OperatorInfo memory) {
        return operators[operatorId];
    }

    function getOperatorByWorker(address workerKey) external view returns (OperatorInfo memory) {
        return operators[workerToOperator[workerKey]];
    }

    function getOperatorPerformance(bytes32 operatorId, uint256 epoch)
        external
        view
        returns (EpochPerformance memory)
    {
        return operatorPerformance[operatorId][epoch];
    }

    function getTotalOperators() external view returns (uint256) {
        return operatorIds.length;
    }

    function getActiveOperatorCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < operatorIds.length; i++) {
            if (operators[operatorIds[i]].isActive) count++;
        }
    }

    function setFeedRegistry(address r) external onlyOwner {
        feedRegistry = IFeedRegistry(r);
    }

    function setCommitteeManager(address c) external onlyOwner {
        committeeManager = ICommitteeManager(c);
    }

    function setStakingManager(address s) external onlyOwner {
        stakingManager = IOracleStakingManager(s);
    }

    function setIdentityRegistry(address i) external onlyOwner {
        identityRegistry = IIdentityRegistry(i);
    }

    function setReputationRegistry(address r) external onlyOwner {
        reputationRegistry = IReputationRegistry(r);
    }
}
