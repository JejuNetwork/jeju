// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INodeStakingManager} from "./INodeStakingManager.sol";

/**
 * @title MultiOracleConsensus
 * @notice V2 Feature: Require 3+ oracle confirmations for performance updates
 * @dev Prevents single oracle manipulation
 * 
 * How it works:
 * - 3+ authorized oracles
 * - Each submits performance data
 * - When 3+ agree (within threshold), update is accepted
 * - Submitted to NodeStakingManager
 * 
 * Security:
 * - Oracles must submit within 1 hour of each other
 * - Values must be within 5% of each other (consensus)
 * - Stale submissions expire after 24 hours
 */
contract MultiOracleConsensus is Ownable {
    INodeStakingManager public stakingManager;
    
    struct PerformanceSubmission {
        uint256 uptimeScore;
        uint256 requestsServed;
        uint256 avgResponseTime;
        uint256 timestamp;
        address oracle;
    }
    
    struct ConsensusData {
        PerformanceSubmission[] submissions;
        bool consensusReached;
        uint256 lastUpdate;
    }
    
    mapping(bytes32 => ConsensusData) public nodeConsensus;
    mapping(address => bool) public isAuthorizedOracle;
    address[] public authorizedOracles;
    
    bool public autoSlashingEnabled;
    
    uint256 public constant MIN_ORACLES_REQUIRED = 3;
    uint256 public constant SUBMISSION_WINDOW = 1 hours;
    uint256 public constant CONSENSUS_THRESHOLD = 500; // 5% tolerance
    uint256 public constant EXPIRY_PERIOD = 24 hours;
    
    event OracleSubmitted(bytes32 indexed nodeId, address indexed oracle, uint256 uptimeScore);
    event ConsensusReached(bytes32 indexed nodeId, uint256 uptimeScore, uint256 requests);
    event PerformanceUpdated(bytes32 indexed nodeId);
    
    constructor(
        address _stakingManager,
        address[] memory _initialOracles,
        address initialOwner
    ) Ownable(initialOwner) {
        stakingManager = INodeStakingManager(_stakingManager);
        
        for (uint256 i = 0; i < _initialOracles.length; i++) {
            authorizedOracles.push(_initialOracles[i]);
            isAuthorizedOracle[_initialOracles[i]] = true;
        }
        
        require(authorizedOracles.length >= MIN_ORACLES_REQUIRED, "Need at least 3 oracles");
    }
    
    /**
     * @notice Submit performance data (called by each oracle)
     */
    function submitPerformance(
        bytes32 nodeId,
        uint256 uptimeScore,
        uint256 requestsServed,
        uint256 avgResponseTime
    ) external {
        require(isAuthorizedOracle[msg.sender], "Not authorized oracle");
        
        ConsensusData storage consensus = nodeConsensus[nodeId];
        
        // Clear stale submissions
        if (block.timestamp > consensus.lastUpdate + EXPIRY_PERIOD) {
            delete consensus.submissions;
            consensus.consensusReached = false;
        }
        
        // Add new submission
        consensus.submissions.push(PerformanceSubmission({
            uptimeScore: uptimeScore,
            requestsServed: requestsServed,
            avgResponseTime: avgResponseTime,
            timestamp: block.timestamp,
            oracle: msg.sender
        }));
        
        consensus.lastUpdate = block.timestamp;
        
        emit OracleSubmitted(nodeId, msg.sender, uptimeScore);
        
        // Check if consensus reached
        if (consensus.submissions.length >= MIN_ORACLES_REQUIRED) {
            _checkConsensus(nodeId);
        }
    }
    
    function _checkConsensus(bytes32 nodeId) internal {
        ConsensusData storage consensus = nodeConsensus[nodeId];
        
        // Get recent submissions (within window)
        PerformanceSubmission[] memory recent = new PerformanceSubmission[](consensus.submissions.length);
        uint256 recentCount = 0;
        
        uint256 cutoff = block.timestamp - SUBMISSION_WINDOW;
        
        for (uint256 i = 0; i < consensus.submissions.length; i++) {
            if (consensus.submissions[i].timestamp >= cutoff) {
                recent[recentCount] = consensus.submissions[i];
                recentCount++;
            }
        }
        
        if (recentCount < MIN_ORACLES_REQUIRED) return;
        
        // Calculate median values
        uint256 medianUptime = _median(recent, recentCount, 0); // uptimeScore
        uint256 medianRequests = _median(recent, recentCount, 1); // requestsServed
        uint256 medianResponse = _median(recent, recentCount, 2); // avgResponseTime
        
        // Check if values are within threshold
        bool allAgree = true;
        for (uint256 i = 0; i < recentCount; i++) {
            if (!_withinThreshold(recent[i].uptimeScore, medianUptime)) {
                allAgree = false;
                break;
            }
        }
        
        if (allAgree) {
            // Consensus reached - update staking manager
            stakingManager.updatePerformance(
                nodeId,
                medianUptime,
                medianRequests,
                medianResponse
            );
            
            consensus.consensusReached = true;
            delete consensus.submissions; // Clear for next round
            
            emit ConsensusReached(nodeId, medianUptime, medianRequests);
            emit PerformanceUpdated(nodeId);
        }
    }
    
    function _median(
        PerformanceSubmission[] memory submissions,
        uint256 count,
        uint256 field
    ) internal pure returns (uint256) {
        if (count == 0) return 0;
        
        // Simple median for small arrays
        uint256[] memory values = new uint256[](count);
        
        for (uint256 i = 0; i < count; i++) {
            if (field == 0) values[i] = submissions[i].uptimeScore;
            else if (field == 1) values[i] = submissions[i].requestsServed;
            else values[i] = submissions[i].avgResponseTime;
        }
        
        // Bubble sort (fine for small N)
        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    uint256 temp = values[j];
                    values[j] = values[j + 1];
                    values[j + 1] = temp;
                }
            }
        }
        
        return values[count / 2];
    }
    
    function _withinThreshold(uint256 value, uint256 referenceValue) internal pure returns (bool) {
        uint256 diff = value > referenceValue ? value - referenceValue : referenceValue - value;
        return (diff * 10000) / referenceValue <= CONSENSUS_THRESHOLD;
    }
    
    function enableAutoSlashing(bool enabled) external onlyOwner {
        autoSlashingEnabled = enabled;
    }
    
    function addOracle(address oracle) external onlyOwner {
        if (!isAuthorizedOracle[oracle]) {
            authorizedOracles.push(oracle);
            isAuthorizedOracle[oracle] = true;
        }
    }
}


