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
        uint256 qualityVotes; // SECURITY: Votes on high-quality cases only
        uint256 qualityLosses; // SECURITY: Losses on high-quality cases only
    }

    // ============ SECURITY: Case Quality Tracking ============
    // Prevents griefing where attackers create frivolous cases to slash honest voters
    
    enum CaseQuality {
        UNKNOWN,      // Not yet assessed
        LOW,          // Frivolous or spam case - losses don't count
        MEDIUM,       // Borderline case - 50% weight on losses
        HIGH          // Legitimate case - full loss weight
    }

    struct CaseQualityRecord {
        CaseQuality quality;
        uint256 assessedAt;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 totalStake;
        bool hasEvidence;
        address assessor;
    }

    // caseId => quality record
    mapping(bytes32 => CaseQualityRecord) public caseQuality;

    // Minimum total stake for a case to be considered "high quality"
    uint256 public constant MIN_QUALITY_STAKE = 1 ether;
    
    // Minimum vote margin for quality assessment (prevents 50/50 cases from being "low")
    uint256 public constant MIN_QUALITY_MARGIN_BPS = 2000; // 20%

    // Addresses authorized to assess case quality (moderation council)
    mapping(address => bool) public qualityAssessors;

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

    event CaseQualityAssessed(
        bytes32 indexed caseId,
        CaseQuality quality,
        address assessor
    );

    event QualityAssessorUpdated(
        address indexed assessor,
        bool authorized
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
     * @dev SECURITY: Only considers losses on HIGH quality cases for slashing
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
        CaseQualityRecord storage quality = caseQuality[caseId];
        
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
        record.consecutiveWins = 0;

        // SECURITY: Only count losses on high-quality cases for slashing
        // This prevents griefing where attackers create frivolous cases
        bool countForSlashing = false;
        
        if (quality.quality == CaseQuality.HIGH) {
            // High quality case - full weight
            record.consecutiveLosses++;
            record.qualityLosses++;
            countForSlashing = true;
        } else if (quality.quality == CaseQuality.MEDIUM) {
            // Medium quality - only count every other loss
            if (record.losingVotes % 2 == 0) {
                record.consecutiveLosses++;
            }
            countForSlashing = record.consecutiveLosses >= TIER_1_LOSSES;
        } else {
            // LOW or UNKNOWN quality - auto-assess based on stake
            if (quality.totalStake >= MIN_QUALITY_STAKE) {
                // Looks legitimate - assess as medium and count
                quality.quality = CaseQuality.MEDIUM;
                quality.assessedAt = block.timestamp;
                if (record.losingVotes % 2 == 0) {
                    record.consecutiveLosses++;
                }
            }
            // LOW quality cases don't count toward slashing at all
        }

        emit VoteRecorded(voter, caseId, false, record.consecutiveLosses);

        // Check if slashing is warranted (only for quality cases)
        if (countForSlashing && record.consecutiveLosses >= TIER_1_LOSSES && stakeAtRisk >= MIN_SLASHABLE_STAKE) {
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
    //                         CASE QUALITY ASSESSMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Assess the quality of a case (determines if losses count for slashing)
     * @dev Only callable by authorized assessors or marketplace
     * @param caseId The case to assess
     * @param quality The quality level to assign
     * @param yesVotes Total YES votes on the case
     * @param noVotes Total NO votes on the case
     * @param totalStake Total stake involved in the case
     * @param hasEvidence Whether the case has verified evidence
     */
    function assessCaseQuality(
        bytes32 caseId,
        CaseQuality quality,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalStake,
        bool hasEvidence
    ) external {
        if (msg.sender != moderationMarketplace && !qualityAssessors[msg.sender]) {
            revert OnlyMarketplace();
        }

        CaseQualityRecord storage record = caseQuality[caseId];
        
        record.quality = quality;
        record.assessedAt = block.timestamp;
        record.yesVotes = yesVotes;
        record.noVotes = noVotes;
        record.totalStake = totalStake;
        record.hasEvidence = hasEvidence;
        record.assessor = msg.sender;

        emit CaseQualityAssessed(caseId, quality, msg.sender);
    }

    /**
     * @notice Auto-assess case quality based on metrics
     * @dev Called by marketplace when case resolves
     */
    function autoAssessCaseQuality(
        bytes32 caseId,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalStake,
        bool hasEvidence
    ) external {
        if (msg.sender != moderationMarketplace) revert OnlyMarketplace();

        CaseQualityRecord storage record = caseQuality[caseId];
        
        record.yesVotes = yesVotes;
        record.noVotes = noVotes;
        record.totalStake = totalStake;
        record.hasEvidence = hasEvidence;
        record.assessedAt = block.timestamp;
        record.assessor = msg.sender;

        // Auto-assessment logic
        uint256 totalVotes = yesVotes + noVotes;
        
        if (totalStake < MIN_QUALITY_STAKE || totalVotes < 3) {
            // Low stake or few voters = low quality (likely spam/griefing)
            record.quality = CaseQuality.LOW;
        } else if (!hasEvidence) {
            // No evidence = medium quality at best
            record.quality = CaseQuality.MEDIUM;
        } else {
            // Check vote margin - controversial cases (close votes) are medium quality
            uint256 larger = yesVotes > noVotes ? yesVotes : noVotes;
            uint256 marginBps = ((larger - (totalVotes - larger)) * 10000) / totalVotes;
            
            if (marginBps >= MIN_QUALITY_MARGIN_BPS) {
                // Clear consensus + evidence = high quality
                record.quality = CaseQuality.HIGH;
            } else {
                // Controversial = medium quality
                record.quality = CaseQuality.MEDIUM;
            }
        }

        emit CaseQualityAssessed(caseId, record.quality, msg.sender);
    }

    /**
     * @notice Get case quality info
     */
    function getCaseQuality(bytes32 caseId) external view returns (
        CaseQuality quality,
        uint256 assessedAt,
        uint256 totalStake,
        bool hasEvidence,
        address assessor
    ) {
        CaseQualityRecord storage record = caseQuality[caseId];
        return (
            record.quality,
            record.assessedAt,
            record.totalStake,
            record.hasEvidence,
            record.assessor
        );
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
     * @notice Add or remove a quality assessor
     */
    function setQualityAssessor(address assessor, bool authorized) external onlyOwner {
        qualityAssessors[assessor] = authorized;
        emit QualityAssessorUpdated(assessor, authorized);
    }

    /**
     * @notice Admin can reset a voter (for appeals/corrections)
     */
    function adminResetVoter(address voter) external onlyOwner {
        _resetVoter(voter, "admin_reset");
    }
}

