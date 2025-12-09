// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INodeStakingManager} from "./INodeStakingManager.sol";

/**
 * @title AutoSlasher
 * @notice V2 Feature: Automated slashing for chronic poor performance
 * @dev Monitors node performance and automatically slashes underperformers
 *
 * Rules:
 * - Track performance over 3 consecutive months
 * - If uptime <95% for 3 months → 10% slash
 * - If uptime <90% for 2 months → 25% slash
 * - If uptime <80% for 1 month → 50% slash
 * - Grace period: First 30 days exempt
 * - Appeal mechanism: Can dispute via governance
 *
 * Safety:
 * - Owner can pause automated slashing
 * - Slashing requires confirmation period (7 days)
 * - Appeals pause execution
 */
contract AutoSlasher is Ownable {
    INodeStakingManager public immutable stakingManager;

    // Performance tracking
    struct PerformanceHistory {
        uint256[3] monthlyUptimeScores; // Last 3 months
        uint256 monthsTracked;
        uint256 lastCheckTime;
        bool hasActiveSlashProposal;
    }

    struct SlashProposal {
        bytes32 nodeId;
        uint256 slashPercentageBPS;
        string reason;
        uint256 proposedAt;
        uint256 executesAt;
        bool executed;
        bool appealed;
    }

    mapping(bytes32 => PerformanceHistory) public performanceHistory;
    mapping(bytes32 => SlashProposal) public slashProposals;

    uint256 public constant GRACE_PERIOD = 30 days;
    uint256 public constant CONFIRMATION_PERIOD = 7 days;
    uint256 public constant MONTH_DURATION = 30 days;

    bool public autoSlashingEnabled = false;

    event SlashProposed(bytes32 indexed nodeId, uint256 slashPercentage, string reason);
    event SlashExecuted(bytes32 indexed nodeId, uint256 slashAmount);
    event SlashAppealed(bytes32 indexed nodeId, address appealer);
    event SlashCancelled(bytes32 indexed nodeId, string reason);

    constructor(address _stakingManager, address initialOwner) Ownable(initialOwner) {
        stakingManager = INodeStakingManager(_stakingManager);
    }

    /**
     * @notice Check node performance and propose slashing if warranted
     * @dev Called periodically by keeper/cron
     */
    function checkAndProposeSlashing(bytes32 nodeId) external {
        if (!autoSlashingEnabled) return;

        (INodeStakingManager.NodeStake memory node, INodeStakingManager.PerformanceMetrics memory perf,) =
            stakingManager.getNodeInfo(nodeId);

        // Skip if within grace period
        if (block.timestamp < node.registrationTime + GRACE_PERIOD) return;

        // Skip if already has active proposal
        if (performanceHistory[nodeId].hasActiveSlashProposal) return;

        // Update monthly performance history
        PerformanceHistory storage history = performanceHistory[nodeId];

        if (block.timestamp >= history.lastCheckTime + MONTH_DURATION) {
            // Shift history (move months back)
            history.monthlyUptimeScores[2] = history.monthlyUptimeScores[1];
            history.monthlyUptimeScores[1] = history.monthlyUptimeScores[0];
            history.monthlyUptimeScores[0] = perf.uptimeScore;

            if (history.monthsTracked < 3) {
                history.monthsTracked++;
            }

            history.lastCheckTime = block.timestamp;
        }

        // Check slashing conditions
        if (history.monthsTracked >= 3) {
            // 3 consecutive months <95% → 10% slash
            if (
                history.monthlyUptimeScores[0] < 9500 && history.monthlyUptimeScores[1] < 9500
                    && history.monthlyUptimeScores[2] < 9500
            ) {
                _proposeSlash(nodeId, 1000, "3 months below 95% uptime");
            }
        }

        if (history.monthsTracked >= 2) {
            // 2 consecutive months <90% → 25% slash
            if (history.monthlyUptimeScores[0] < 9000 && history.monthlyUptimeScores[1] < 9000) {
                _proposeSlash(nodeId, 2500, "2 months below 90% uptime");
            }
        }

        // 1 month <80% → 50% slash (severe)
        if (history.monthlyUptimeScores[0] < 8000) {
            _proposeSlash(nodeId, 5000, "Critical: 1 month below 80% uptime");
        }
    }

    function _proposeSlash(bytes32 nodeId, uint256 slashPercentageBPS, string memory reason) internal {
        slashProposals[nodeId] = SlashProposal({
            nodeId: nodeId,
            slashPercentageBPS: slashPercentageBPS,
            reason: reason,
            proposedAt: block.timestamp,
            executesAt: block.timestamp + CONFIRMATION_PERIOD,
            executed: false,
            appealed: false
        });

        performanceHistory[nodeId].hasActiveSlashProposal = true;

        emit SlashProposed(nodeId, slashPercentageBPS, reason);
    }

    /**
     * @notice Execute slashing after confirmation period
     * @custom:security CEI pattern: Update state before external calls
     */
    function executeSlashing(bytes32 nodeId) external {
        SlashProposal storage proposal = slashProposals[nodeId];

        require(!proposal.executed, "Already executed");
        require(!proposal.appealed, "Under appeal");
        require(block.timestamp >= proposal.executesAt, "Confirmation period not passed");

        // Cache values
        uint256 slashPercentageBPS = proposal.slashPercentageBPS;
        string memory reason = proposal.reason;

        // EFFECTS: Update state BEFORE external calls (CEI pattern)
        proposal.executed = true;
        performanceHistory[nodeId].hasActiveSlashProposal = false;

        // Emit event before external call
        emit SlashExecuted(nodeId, slashPercentageBPS);

        // INTERACTIONS: Execute slash via staking manager LAST
        stakingManager.slashNode(nodeId, slashPercentageBPS, reason);
    }

    /**
     * @notice Appeal slashing (operator can dispute)
     */
    function appealSlashing(bytes32 nodeId) external {
        SlashProposal storage proposal = slashProposals[nodeId];

        (INodeStakingManager.NodeStake memory node,,) = stakingManager.getNodeInfo(nodeId);
        require(node.operator == msg.sender, "Not operator");
        require(!proposal.executed, "Already executed");

        proposal.appealed = true;

        emit SlashAppealed(nodeId, msg.sender);
    }

    /**
     * @notice Cancel slash proposal (owner decision)
     */
    function cancelSlashing(bytes32 nodeId, string calldata reason) external onlyOwner {
        slashProposals[nodeId].executed = true; // Mark as handled
        performanceHistory[nodeId].hasActiveSlashProposal = false;

        emit SlashCancelled(nodeId, reason);
    }

    /**
     * @notice Enable/disable automated slashing
     */
    function setAutoSlashingEnabled(bool enabled) external onlyOwner {
        autoSlashingEnabled = enabled;
    }
}
