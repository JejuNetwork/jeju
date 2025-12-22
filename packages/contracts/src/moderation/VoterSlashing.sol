// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VoterSlashing
 * @author Jeju Network
 * @notice Slashes voters who consistently vote on the wrong side
 * @dev Implements progressive slashing for bad actors in moderation
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              SLASHING MECHANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. TRACKING:
 *    - Track each voter's win/loss record
 *    - Calculate accuracy score over rolling window
 *
 * 2. PENALTIES:
 *    - First 3 losses: warning only
 *    - 4-6 losses: 5% stake slash
 *    - 7-10 losses: 15% stake slash
 *    - 10+ losses: 25% slash + temporary ban from voting
 *
 * 3. RECOVERY:
 *    - Winning votes restore reputation
 *    - 5 consecutive wins reset penalty tier
 *    - Time-based decay (inactive accounts reset after 90 days)
 *
 */
contract VoterSlashing is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct VoterRecord {
        uint256 totalVotes;
        uint256 winningVotes;
        uint256 losingVotes;
        uint256 consecutiveLosses;
        uint256 consecutiveWins;
        uint256 totalSlashed;
        uint256 lastVoteTimestamp;
        uint256 lastSlashTimestamp;
        uint256 penaltyTier;
        bool votingBanned;
        uint256 votingBanExpiry;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    // Slash thresholds
    uint256 public constant TIER_1_LOSSES = 4;   // Start slashing
    uint256 public constant TIER_2_LOSSES = 7;   // Increased slash
    uint256 public constant TIER_3_LOSSES = 10;  // Max slash + ban

    // Slash amounts (basis points)
    uint256 public constant TIER_1_SLASH_BPS = 500;   // 5%
    uint256 public constant TIER_2_SLASH_BPS = 1500;  // 15%
    uint256 public constant TIER_3_SLASH_BPS = 2500;  // 25%

    // Recovery constants
    uint256 public constant WINS_TO_RESET = 5;        // Consecutive wins to reset tier
    uint256 public constant INACTIVITY_RESET = 90 days; // Inactivity period for reset
    uint256 public constant VOTING_BAN_DURATION = 30 days; // Voting ban duration

    // Minimum stake to be subject to slashing
    uint256 public constant MIN_SLASHABLE_STAKE = 0.1 ether;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    mapping(address => VoterRecord) public voterRecords;
    
    // Links to other contracts
    address public moderationMarketplace;
    address public treasury;
    
    // Total slashed for stats
    uint256 public totalSlashedAmount;
    uint256 public totalBannedVoters;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event VoteRecorded(
        address indexed voter,
        bytes32 indexed caseId,
        bool won,
        uint256 consecutiveLosses
    );

    event VoterSlashed(
        address indexed voter,
        uint256 slashAmount,
        uint256 penaltyTier,
        uint256 consecutiveLosses
    );

    event VoterBanned(
        address indexed voter,
        uint256 banExpiry,
        uint256 totalLosses
    );

    event VoterRecovered(
        address indexed voter,
        uint256 newTier,
        uint256 consecutiveWins
    );

    event VoterReset(
        address indexed voter,
        string reason
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error OnlyMarketplace();
    error VoterIsBanned();
    error InsufficientStakeForSlash();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _marketplace,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        moderationMarketplace = _marketplace;
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Record a vote outcome for a voter
     * @param voter The voter address
     * @param caseId The case they voted on
     * @param won Whether they voted on the winning side
     * @param stakeAtRisk The stake they had at risk
     */
    function recordVoteOutcome(
        address voter,
        bytes32 caseId,
        bool won,
        uint256 stakeAtRisk
    ) external nonReentrant returns (uint256 slashAmount) {
        if (msg.sender != moderationMarketplace) revert OnlyMarketplace();

        VoterRecord storage record = voterRecords[voter];
        
        // Check for inactivity reset
        if (record.lastVoteTimestamp > 0 && 
            block.timestamp - record.lastVoteTimestamp > INACTIVITY_RESET) {
            _resetVoter(voter, "inactivity");
        }

        record.totalVotes++;
        record.lastVoteTimestamp = block.timestamp;

        if (won) {
            record.winningVotes++;
            record.consecutiveWins++;
            record.consecutiveLosses = 0;

            // Check for recovery
            if (record.consecutiveWins >= WINS_TO_RESET && record.penaltyTier > 0) {
                _recoverVoter(voter);
            }

            emit VoteRecorded(voter, caseId, true, 0);
            return 0;
        }

        // Loss handling
        record.losingVotes++;
        record.consecutiveLosses++;
        record.consecutiveWins = 0;

        emit VoteRecorded(voter, caseId, false, record.consecutiveLosses);

        // Check if slashing is warranted
        if (record.consecutiveLosses >= TIER_1_LOSSES && stakeAtRisk >= MIN_SLASHABLE_STAKE) {
            slashAmount = _applySlash(voter, stakeAtRisk);
        }

        // Check for voting ban at tier 3
        if (record.consecutiveLosses >= TIER_3_LOSSES && !record.votingBanned) {
            _banVoter(voter);
        }

        return slashAmount;
    }

    /**
     * @notice Check if a voter is allowed to vote
     */
    function canVote(address voter) external view returns (bool, string memory) {
        VoterRecord storage record = voterRecords[voter];
        
        if (record.votingBanned && block.timestamp < record.votingBanExpiry) {
            return (false, "VOTING_BANNED");
        }
        
        return (true, "ALLOWED");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              INTERNAL
    // ═══════════════════════════════════════════════════════════════════════

    function _applySlash(
        address voter,
        uint256 stakeAtRisk
    ) internal returns (uint256 slashAmount) {
        VoterRecord storage record = voterRecords[voter];

        // Calculate slash based on tier
        uint256 slashBps;
        if (record.consecutiveLosses >= TIER_3_LOSSES) {
            slashBps = TIER_3_SLASH_BPS;
            record.penaltyTier = 3;
        } else if (record.consecutiveLosses >= TIER_2_LOSSES) {
            slashBps = TIER_2_SLASH_BPS;
            record.penaltyTier = 2;
        } else {
            slashBps = TIER_1_SLASH_BPS;
            record.penaltyTier = 1;
        }

        slashAmount = (stakeAtRisk * slashBps) / 10000;
        record.totalSlashed += slashAmount;
        record.lastSlashTimestamp = block.timestamp;
        totalSlashedAmount += slashAmount;

        emit VoterSlashed(
            voter,
            slashAmount,
            record.penaltyTier,
            record.consecutiveLosses
        );

        return slashAmount;
    }

    function _banVoter(address voter) internal {
        VoterRecord storage record = voterRecords[voter];
        
        record.votingBanned = true;
        record.votingBanExpiry = block.timestamp + VOTING_BAN_DURATION;
        totalBannedVoters++;

        emit VoterBanned(voter, record.votingBanExpiry, record.losingVotes);
    }

    function _recoverVoter(address voter) internal {
        VoterRecord storage record = voterRecords[voter];
        
        // Reduce tier (but not below 0)
        if (record.penaltyTier > 0) {
            record.penaltyTier--;
        }
        
        // Clear ban if was banned
        if (record.votingBanned && record.penaltyTier == 0) {
            record.votingBanned = false;
            record.votingBanExpiry = 0;
            if (totalBannedVoters > 0) totalBannedVoters--;
        }

        emit VoterRecovered(voter, record.penaltyTier, record.consecutiveWins);
    }

    function _resetVoter(address voter, string memory reason) internal {
        VoterRecord storage record = voterRecords[voter];
        
        // Preserve historical totals but reset penalties
        record.consecutiveLosses = 0;
        record.consecutiveWins = 0;
        record.penaltyTier = 0;
        
        if (record.votingBanned) {
            record.votingBanned = false;
            record.votingBanExpiry = 0;
            if (totalBannedVoters > 0) totalBannedVoters--;
        }

        emit VoterReset(voter, reason);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get voter's accuracy score (basis points)
     */
    function getAccuracyScore(address voter) external view returns (uint256) {
        VoterRecord storage record = voterRecords[voter];
        if (record.totalVotes == 0) return 5000; // 50% default
        return (record.winningVotes * 10000) / record.totalVotes;
    }

    /**
     * @notice Check if a voter is currently banned from voting
     * @param voter The voter address to check
     * @return bool Whether the voter is banned
     */
    function isVotingBanned(address voter) external view returns (bool) {
        VoterRecord storage record = voterRecords[voter];
        return record.votingBanned && block.timestamp < record.votingBanExpiry;
    }
    
    /**
     * @notice Get full voter record
     */
    function getVoterRecord(address voter) external view returns (
        uint256 totalVotes,
        uint256 winningVotes,
        uint256 losingVotes,
        uint256 consecutiveLosses,
        uint256 penaltyTier,
        uint256 totalSlashed,
        bool votingBanned,
        uint256 votingBanExpiry
    ) {
        VoterRecord storage record = voterRecords[voter];
        return (
            record.totalVotes,
            record.winningVotes,
            record.losingVotes,
            record.consecutiveLosses,
            record.penaltyTier,
            record.totalSlashed,
            record.votingBanned,
            record.votingBanExpiry
        );
    }

    /**
     * @notice Get potential slash amount for next loss
     */
    function getPotentialSlash(address voter, uint256 stakeAtRisk) external view returns (uint256) {
        VoterRecord storage record = voterRecords[voter];
        uint256 nextLosses = record.consecutiveLosses + 1;

        if (nextLosses < TIER_1_LOSSES || stakeAtRisk < MIN_SLASHABLE_STAKE) {
            return 0;
        }

        uint256 slashBps;
        if (nextLosses >= TIER_3_LOSSES) {
            slashBps = TIER_3_SLASH_BPS;
        } else if (nextLosses >= TIER_2_LOSSES) {
            slashBps = TIER_2_SLASH_BPS;
        } else {
            slashBps = TIER_1_SLASH_BPS;
        }

        return (stakeAtRisk * slashBps) / 10000;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function setMarketplace(address _marketplace) external onlyOwner {
        moderationMarketplace = _marketplace;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /**
     * @notice Admin can reset a voter (for appeals/corrections)
     */
    function adminResetVoter(address voter) external onlyOwner {
        _resetVoter(voter, "admin_reset");
    }

    receive() external payable {}
}

