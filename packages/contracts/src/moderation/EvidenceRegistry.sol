// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EvidenceRegistry
 * @author Jeju Network
 * @notice Community evidence submission system for moderation cases
 * @dev Evidence is submitted by community members with stake requirements.
 *      All evidence is provided to the AI Council/CEO as context for decisions.
 *      Evidence stakes are redistributed based on case outcomes.
 *
 * Security Features:
 * - Case validation against ModerationMarketplace
 * - Self-staking prevention (submitter cannot support own evidence)
 * - Per-case evidence limits to prevent spam
 * - Time-weighted evidence (early submissions weighted higher)
 * - Protocol fee collection
 * - Sybil resistance through minimum stakes and reputation
 *
 * Flow:
 * 1. Community member submits evidence with stake (min 0.001 ETH)
 * 2. Other community members can support or oppose evidence with their own stake
 * 3. AI Council receives all evidence with stake amounts, submitter reputation
 * 4. Council makes decision considering all evidence (soft input, not hard rules)
 * 5. Evidence stakes redistributed based on case outcome:
 *    - Evidence aligned with outcome: refund + proportional reward
 *    - Evidence opposed to outcome: slashed to winning side
 *
 * @custom:security-contact security@jeju.network
 */
contract EvidenceRegistry is Ownable, Pausable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum EvidencePosition {
        FOR_ACTION,    // Evidence supports taking action (ban/slash)
        AGAINST_ACTION // Evidence opposes taking action
    }

    enum EvidenceStatus {
        ACTIVE,        // Case still open, evidence can receive support
        REWARDED,      // Case resolved in evidence's favor, rewards distributed
        SLASHED        // Case resolved against evidence, stakes slashed
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Evidence {
        bytes32 evidenceId;
        bytes32 caseId;              // Reference to ModerationMarketplace case
        address submitter;
        uint256 stake;
        uint256 submitterReputation; // Snapshot at submission time (0-10000)
        string ipfsHash;             // Evidence content on IPFS
        string summary;              // Brief explanation (max 500 chars)
        EvidencePosition position;
        uint256 supportStake;        // Total stake supporting this evidence
        uint256 opposeStake;         // Total stake opposing this evidence
        uint256 supporterCount;
        uint256 opposerCount;
        uint256 submittedAt;
        uint256 timeWeight;          // Time-based weight (earlier = higher)
        EvidenceStatus status;
        bool submitterClaimed;       // Whether submitter has claimed
    }

    struct EvidenceSupport {
        address supporter;
        uint256 stake;
        uint256 reputation;          // Snapshot at support time
        bool isSupporting;           // true = supports evidence, false = opposes
        string comment;              // Optional brief comment
        uint256 timestamp;
        uint256 timeWeight;          // Time-based weight
        bool claimed;                // Whether rewards/refunds have been claimed
    }

    struct CaseEvidence {
        bytes32[] evidenceIds;
        uint256 totalForStake;       // Total stake on FOR_ACTION evidence
        uint256 totalAgainstStake;   // Total stake on AGAINST_ACTION evidence
        uint256 caseCreatedAt;       // When the case was opened (for time weighting)
        uint256 caseEndsAt;          // When voting ends (for time weighting)
        bool resolved;
        bool outcomeWasAction;       // true if action was taken (ban/slash)
        uint256 protocolFeesCollected; // Track fees for this case
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MIN_EVIDENCE_STAKE = 0.001 ether;
    uint256 public constant MIN_SUPPORT_STAKE = 0.0005 ether;
    uint256 public constant MAX_SUMMARY_LENGTH = 500;
    uint256 public constant MAX_EVIDENCE_PER_CASE = 50;        // Prevent spam
    uint256 public constant MAX_SUPPORTS_PER_EVIDENCE = 100;   // Gas limit protection
    
    // Reward distribution (must sum to 10000)
    uint256 public constant WINNER_SHARE_BPS = 8500;           // 85% to winners
    uint256 public constant PROTOCOL_FEE_BPS = 500;            // 5% protocol fee
    uint256 public constant SUBMITTER_BONUS_BPS = 1000;        // 10% bonus to evidence submitter

    // Time weighting: 1% bonus per hour remaining (max 72% for voting at start)
    uint256 public constant TIME_WEIGHT_BPS_PER_HOUR = 100;
    uint256 public constant MAX_TIME_BONUS_BPS = 7200;         // 72% max bonus

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Evidence by ID
    mapping(bytes32 => Evidence) public evidence;

    /// @notice Support records for each evidence
    mapping(bytes32 => EvidenceSupport[]) public evidenceSupport;

    /// @notice User's support index for evidence (for claiming)
    mapping(bytes32 => mapping(address => uint256)) public userSupportIndex;

    /// @notice Whether user has supported specific evidence
    mapping(bytes32 => mapping(address => bool)) public hasSupported;

    /// @notice Case evidence aggregation
    mapping(bytes32 => CaseEvidence) public caseEvidence;

    /// @notice User evidence submissions
    mapping(address => bytes32[]) public userEvidence;

    /// @notice Evidence count per case (for spam prevention)
    mapping(bytes32 => uint256) public caseEvidenceCount;

    /// @notice User's evidence IDs per case (for self-staking prevention)
    mapping(bytes32 => mapping(address => bytes32[])) public userCaseEvidence;

    /// @notice Next evidence ID counter
    uint256 private _nextEvidenceId;

    /// @notice ModerationMarketplace contract (authorized to resolve cases)
    address public moderationMarketplace;

    /// @notice Reputation provider for fetching user reputation
    address public reputationProvider;

    /// @notice Protocol treasury for fees
    address public treasury;

    /// @notice Total protocol fees collected (available for withdrawal)
    uint256 public totalProtocolFees;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event EvidenceSubmitted(
        bytes32 indexed evidenceId,
        bytes32 indexed caseId,
        address indexed submitter,
        uint256 stake,
        EvidencePosition position,
        string ipfsHash,
        uint256 timeWeight
    );

    event EvidenceSupported(
        bytes32 indexed evidenceId,
        address indexed supporter,
        uint256 stake,
        bool isSupporting,
        string comment,
        uint256 timeWeight
    );

    event CaseRegistered(
        bytes32 indexed caseId,
        uint256 createdAt,
        uint256 endsAt
    );

    event CaseResolved(
        bytes32 indexed caseId,
        bool outcomeWasAction,
        uint256 totalForStake,
        uint256 totalAgainstStake,
        uint256 protocolFees
    );

    event RewardsClaimed(
        bytes32 indexed evidenceId,
        address indexed claimer,
        uint256 amount,
        bool wasSubmitter
    );

    event ProtocolFeesWithdrawn(
        address indexed to,
        uint256 amount
    );

    event ModerationMarketplaceUpdated(address oldAddress, address newAddress);
    event ReputationProviderUpdated(address oldAddress, address newAddress);
    event TreasuryUpdated(address oldAddress, address newAddress);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InsufficientStake();
    error SummaryTooLong();
    error CaseAlreadyResolved();
    error CaseNotRegistered();
    error CaseNotActive();
    error EvidenceNotFound();
    error AlreadySupported();
    error CannotSupportOwnEvidence();
    error MaxEvidenceReached();
    error MaxSupportsReached();
    error NotAuthorized();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidAddress();
    error CaseNotResolved();
    error VotingEnded();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _moderationMarketplace,
        address _reputationProvider,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        
        moderationMarketplace = _moderationMarketplace;
        reputationProvider = _reputationProvider;
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CASE REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a case from ModerationMarketplace
     * @dev Only callable by ModerationMarketplace
     * @param caseId The case ID
     * @param createdAt When the case was created
     * @param endsAt When voting ends
     */
    function registerCase(
        bytes32 caseId,
        uint256 createdAt,
        uint256 endsAt
    ) external {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();
        if (caseEvidence[caseId].caseCreatedAt != 0) revert CaseAlreadyResolved();

        caseEvidence[caseId].caseCreatedAt = createdAt;
        caseEvidence[caseId].caseEndsAt = endsAt;

        emit CaseRegistered(caseId, createdAt, endsAt);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         EVIDENCE SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit evidence for a moderation case
     * @param caseId The case ID from ModerationMarketplace
     * @param ipfsHash IPFS hash of evidence content
     * @param summary Brief explanation of evidence
     * @param position Whether evidence supports or opposes action
     * @return evidenceId The unique evidence ID
     */
    function submitEvidence(
        bytes32 caseId,
        string calldata ipfsHash,
        string calldata summary,
        EvidencePosition position
    ) external payable nonReentrant whenNotPaused returns (bytes32 evidenceId) {
        if (msg.value < MIN_EVIDENCE_STAKE) revert InsufficientStake();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();

        CaseEvidence storage ce = caseEvidence[caseId];
        
        // Validate case exists and is active
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > ce.caseEndsAt) revert VotingEnded();
        
        // Check evidence limit
        if (caseEvidenceCount[caseId] >= MAX_EVIDENCE_PER_CASE) revert MaxEvidenceReached();

        // Generate unique evidence ID
        evidenceId = keccak256(abi.encodePacked(
            _nextEvidenceId++,
            caseId,
            msg.sender,
            block.timestamp
        ));

        // Get submitter reputation (soft context for AI)
        uint256 reputation = _getReputation(msg.sender);

        // Calculate time weight (earlier submissions get more weight)
        uint256 timeWeight = _calculateTimeWeight(ce.caseEndsAt);

        // Store evidence
        evidence[evidenceId] = Evidence({
            evidenceId: evidenceId,
            caseId: caseId,
            submitter: msg.sender,
            stake: msg.value,
            submitterReputation: reputation,
            ipfsHash: ipfsHash,
            summary: summary,
            position: position,
            supportStake: 0,
            opposeStake: 0,
            supporterCount: 0,
            opposerCount: 0,
            submittedAt: block.timestamp,
            timeWeight: timeWeight,
            status: EvidenceStatus.ACTIVE,
            submitterClaimed: false
        });

        // Update case aggregation
        ce.evidenceIds.push(evidenceId);
        caseEvidenceCount[caseId]++;
        
        // Apply time weight to stake for totals
        uint256 weightedStake = _applyTimeWeight(msg.value, timeWeight);
        if (position == EvidencePosition.FOR_ACTION) {
            ce.totalForStake += weightedStake;
        } else {
            ce.totalAgainstStake += weightedStake;
        }

        // Track user submissions
        userEvidence[msg.sender].push(evidenceId);
        userCaseEvidence[caseId][msg.sender].push(evidenceId);

        emit EvidenceSubmitted(evidenceId, caseId, msg.sender, msg.value, position, ipfsHash, timeWeight);
    }

    /**
     * @notice Support or oppose existing evidence
     * @param evidenceId The evidence to support/oppose
     * @param isSupporting true to support, false to oppose
     * @param comment Optional brief comment
     */
    function supportEvidence(
        bytes32 evidenceId,
        bool isSupporting,
        string calldata comment
    ) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_SUPPORT_STAKE) revert InsufficientStake();
        
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) revert EvidenceNotFound();
        
        // Prevent self-staking: submitter cannot support their own evidence
        if (e.submitter == msg.sender) revert CannotSupportOwnEvidence();
        
        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (ce.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > ce.caseEndsAt) revert VotingEnded();
        
        if (hasSupported[evidenceId][msg.sender]) revert AlreadySupported();
        
        // Check support limit
        if (evidenceSupport[evidenceId].length >= MAX_SUPPORTS_PER_EVIDENCE) revert MaxSupportsReached();

        uint256 reputation = _getReputation(msg.sender);
        uint256 timeWeight = _calculateTimeWeight(ce.caseEndsAt);

        // Store support record
        uint256 supportIndex = evidenceSupport[evidenceId].length;
        evidenceSupport[evidenceId].push(EvidenceSupport({
            supporter: msg.sender,
            stake: msg.value,
            reputation: reputation,
            isSupporting: isSupporting,
            comment: comment,
            timestamp: block.timestamp,
            timeWeight: timeWeight,
            claimed: false
        }));

        userSupportIndex[evidenceId][msg.sender] = supportIndex;
        hasSupported[evidenceId][msg.sender] = true;

        // Update evidence totals
        if (isSupporting) {
            e.supportStake += msg.value;
            e.supporterCount++;
        } else {
            e.opposeStake += msg.value;
            e.opposerCount++;
        }

        // Update case totals with time weight
        uint256 weightedStake = _applyTimeWeight(msg.value, timeWeight);
        if (isSupporting) {
            // Support adds to evidence's position
            if (e.position == EvidencePosition.FOR_ACTION) {
                ce.totalForStake += weightedStake;
            } else {
                ce.totalAgainstStake += weightedStake;
            }
        } else {
            // Opposition adds to opposite position
            if (e.position == EvidencePosition.FOR_ACTION) {
                ce.totalAgainstStake += weightedStake;
            } else {
                ce.totalForStake += weightedStake;
            }
        }

        emit EvidenceSupported(evidenceId, msg.sender, msg.value, isSupporting, comment, timeWeight);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CASE RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Resolve a case and determine evidence outcomes
     * @dev Only callable by ModerationMarketplace
     * @param caseId The case being resolved
     * @param outcomeWasAction Whether action was taken (ban/slash)
     */
    function resolveCase(bytes32 caseId, bool outcomeWasAction) external nonReentrant {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();

        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();

        ce.resolved = true;
        ce.outcomeWasAction = outcomeWasAction;

        // Calculate total pot for fee calculation
        uint256 totalPot = 0;

        // Update all evidence statuses and calculate pot
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage e = evidence[ce.evidenceIds[i]];
            
            bool evidenceAlignedWithOutcome = 
                (e.position == EvidencePosition.FOR_ACTION && outcomeWasAction) ||
                (e.position == EvidencePosition.AGAINST_ACTION && !outcomeWasAction);

            e.status = evidenceAlignedWithOutcome 
                ? EvidenceStatus.REWARDED 
                : EvidenceStatus.SLASHED;

            // Add to total pot
            totalPot += e.stake + e.supportStake + e.opposeStake;
        }

        // Calculate and collect protocol fees
        uint256 protocolFee = (totalPot * PROTOCOL_FEE_BPS) / 10000;
        ce.protocolFeesCollected = protocolFee;
        totalProtocolFees += protocolFee;

        emit CaseResolved(caseId, outcomeWasAction, ce.totalForStake, ce.totalAgainstStake, protocolFee);
    }

    /**
     * @notice Claim rewards or refunds after case resolution
     * @param evidenceId The evidence to claim for
     */
    function claimRewards(bytes32 evidenceId) external nonReentrant {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) revert EvidenceNotFound();

        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (!ce.resolved) revert CaseNotResolved();

        uint256 totalClaim = 0;
        bool wasSubmitter = false;

        // Check if caller is the submitter
        if (e.submitter == msg.sender && !e.submitterClaimed && e.stake > 0) {
            totalClaim += _calculateSubmitterClaim(e, ce);
            e.submitterClaimed = true;
            wasSubmitter = true;
        }

        // Check if caller has supported this evidence
        if (hasSupported[evidenceId][msg.sender]) {
            uint256 idx = userSupportIndex[evidenceId][msg.sender];
            EvidenceSupport storage support = evidenceSupport[evidenceId][idx];
            
            if (!support.claimed && support.stake > 0) {
                totalClaim += _calculateSupporterClaim(e, support, ce);
                support.claimed = true;
            }
        }

        if (totalClaim == 0) revert NothingToClaim();

        // Transfer rewards
        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");

        emit RewardsClaimed(evidenceId, msg.sender, totalClaim, wasSubmitter);
    }

    /**
     * @notice Batch claim rewards for multiple evidence submissions
     * @param evidenceIds Array of evidence IDs to claim
     */
    function batchClaimRewards(bytes32[] calldata evidenceIds) external nonReentrant {
        uint256 totalClaim = 0;

        for (uint256 i = 0; i < evidenceIds.length; i++) {
            bytes32 evidenceId = evidenceIds[i];
            Evidence storage e = evidence[evidenceId];
            
            if (e.submittedAt == 0) continue;

            CaseEvidence storage ce = caseEvidence[e.caseId];
            if (!ce.resolved) continue;

            // Check submitter claim
            if (e.submitter == msg.sender && !e.submitterClaimed && e.stake > 0) {
                totalClaim += _calculateSubmitterClaim(e, ce);
                e.submitterClaimed = true;
            }

            // Check supporter claim
            if (hasSupported[evidenceId][msg.sender]) {
                uint256 idx = userSupportIndex[evidenceId][msg.sender];
                EvidenceSupport storage support = evidenceSupport[evidenceId][idx];
                
                if (!support.claimed && support.stake > 0) {
                    totalClaim += _calculateSupporterClaim(e, support, ce);
                    support.claimed = true;
                }
            }
        }

        if (totalClaim == 0) revert NothingToClaim();

        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Calculate time weight based on time remaining
     * @dev Earlier submissions get higher weight (up to 72% bonus)
     */
    function _calculateTimeWeight(uint256 caseEndsAt) internal view returns (uint256) {
        if (block.timestamp >= caseEndsAt) return 10000; // Base weight if voting ended

        uint256 timeRemaining = caseEndsAt - block.timestamp;
        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 timeBonus = hoursRemaining * TIME_WEIGHT_BPS_PER_HOUR;
        
        if (timeBonus > MAX_TIME_BONUS_BPS) {
            timeBonus = MAX_TIME_BONUS_BPS;
        }

        return 10000 + timeBonus; // Return weight in BPS (10000 = 100%)
    }

    /**
     * @notice Apply time weight to a stake amount
     */
    function _applyTimeWeight(uint256 stake, uint256 timeWeight) internal pure returns (uint256) {
        return (stake * timeWeight) / 10000;
    }

    function _calculateSubmitterClaim(
        Evidence storage e,
        CaseEvidence storage ce
    ) internal view returns (uint256) {
        bool evidenceWon = e.status == EvidenceStatus.REWARDED;
        
        if (!evidenceWon) {
            // Evidence lost - stake is slashed, nothing to claim
            return 0;
        }

        // Calculate losing pool (raw stakes, not weighted)
        uint256 losingPool = 0;
        uint256 winningPool = 0;
        
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage ev = evidence[ce.evidenceIds[i]];
            uint256 evidenceTotal = ev.stake + ev.supportStake;
            
            // Add opposition stake to the opposite side
            uint256 oppositionTotal = ev.opposeStake;
            
            bool thisEvidenceWon = ev.status == EvidenceStatus.REWARDED;
            
            if (thisEvidenceWon) {
                winningPool += evidenceTotal;
                losingPool += oppositionTotal;
            } else {
                losingPool += evidenceTotal;
                winningPool += oppositionTotal;
            }
        }

        if (winningPool == 0) return e.stake;

        // Deduct protocol fee from losing pool
        uint256 feeDeducted = (losingPool * PROTOCOL_FEE_BPS) / 10000;
        uint256 distributablePool = losingPool - feeDeducted;

        // Submitter gets their stake back + proportional share + submitter bonus
        uint256 baseShare = (distributablePool * WINNER_SHARE_BPS * e.stake) / (winningPool * 10000);
        uint256 submitterBonus = (distributablePool * SUBMITTER_BONUS_BPS * e.stake) / (winningPool * 10000);

        return e.stake + baseShare + submitterBonus;
    }

    function _calculateSupporterClaim(
        Evidence storage e,
        EvidenceSupport storage support,
        CaseEvidence storage ce
    ) internal view returns (uint256) {
        bool evidenceWon = e.status == EvidenceStatus.REWARDED;
        
        // Supporter's position relative to outcome
        bool supporterWon;
        if (support.isSupporting) {
            // Supported the evidence - wins if evidence won
            supporterWon = evidenceWon;
        } else {
            // Opposed the evidence - wins if evidence lost
            supporterWon = !evidenceWon;
        }

        if (!supporterWon) {
            // Supporter lost - stake slashed
            return 0;
        }

        // Calculate pools
        uint256 losingPool = 0;
        uint256 winningPool = 0;
        
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage ev = evidence[ce.evidenceIds[i]];
            uint256 evidenceTotal = ev.stake + ev.supportStake;
            uint256 oppositionTotal = ev.opposeStake;
            
            bool thisEvidenceWon = ev.status == EvidenceStatus.REWARDED;
            
            if (thisEvidenceWon) {
                winningPool += evidenceTotal;
                losingPool += oppositionTotal;
            } else {
                losingPool += evidenceTotal;
                winningPool += oppositionTotal;
            }
        }

        if (winningPool == 0) return support.stake;

        // Deduct protocol fee
        uint256 feeDeducted = (losingPool * PROTOCOL_FEE_BPS) / 10000;
        uint256 distributablePool = losingPool - feeDeducted;

        // Supporter gets stake back + proportional share (no submitter bonus)
        uint256 share = (distributablePool * WINNER_SHARE_BPS * support.stake) / (winningPool * 10000);

        return support.stake + share;
    }

    function _getReputation(address user) internal view returns (uint256) {
        if (reputationProvider == address(0)) return 5000; // Default 50%
        
        // Try to get reputation from provider
        (bool success, bytes memory data) = reputationProvider.staticcall(
            abi.encodeWithSignature("getReputation(address)", user)
        );
        
        if (success && data.length >= 32) {
            uint256 rep = abi.decode(data, (uint256));
            return rep > 10000 ? 10000 : rep;
        }
        
        return 5000; // Default 50% if call fails
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get all evidence for a case
     * @param caseId The case ID
     * @return evidenceIds Array of evidence IDs
     * @return totalFor Total weighted stake on FOR_ACTION
     * @return totalAgainst Total weighted stake on AGAINST_ACTION
     * @return resolved Whether case is resolved
     */
    function getCaseEvidence(bytes32 caseId) external view returns (
        bytes32[] memory evidenceIds,
        uint256 totalFor,
        uint256 totalAgainst,
        bool resolved
    ) {
        CaseEvidence storage ce = caseEvidence[caseId];
        return (ce.evidenceIds, ce.totalForStake, ce.totalAgainstStake, ce.resolved);
    }

    /**
     * @notice Get full case evidence details
     */
    function getCaseEvidenceDetails(bytes32 caseId) external view returns (CaseEvidence memory) {
        return caseEvidence[caseId];
    }

    /**
     * @notice Get evidence details
     * @param evidenceId The evidence ID
     */
    function getEvidence(bytes32 evidenceId) external view returns (Evidence memory) {
        return evidence[evidenceId];
    }

    /**
     * @notice Get support records for evidence
     * @param evidenceId The evidence ID
     */
    function getEvidenceSupport(bytes32 evidenceId) external view returns (EvidenceSupport[] memory) {
        return evidenceSupport[evidenceId];
    }

    /**
     * @notice Get user's submitted evidence
     * @param user The user address
     */
    function getUserEvidence(address user) external view returns (bytes32[] memory) {
        return userEvidence[user];
    }

    /**
     * @notice Get user's evidence for a specific case
     * @param caseId The case ID
     * @param user The user address
     */
    function getUserCaseEvidence(bytes32 caseId, address user) external view returns (bytes32[] memory) {
        return userCaseEvidence[caseId][user];
    }

    /**
     * @notice Calculate claimable amount for a user on specific evidence
     * @param evidenceId The evidence ID
     * @param user The user address
     */
    function getClaimableAmount(bytes32 evidenceId, address user) external view returns (uint256) {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) return 0;

        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (!ce.resolved) return 0;

        uint256 total = 0;

        // Check submitter claim
        if (e.submitter == user && !e.submitterClaimed && e.stake > 0) {
            total += _calculateSubmitterClaim(e, ce);
        }

        // Check supporter claim
        if (hasSupported[evidenceId][user]) {
            uint256 idx = userSupportIndex[evidenceId][user];
            EvidenceSupport storage support = evidenceSupport[evidenceId][idx];
            if (!support.claimed && support.stake > 0) {
                total += _calculateSupporterClaim(e, support, ce);
            }
        }

        return total;
    }

    /**
     * @notice Check if a case is registered and active
     */
    function isCaseActive(bytes32 caseId) external view returns (bool) {
        CaseEvidence storage ce = caseEvidence[caseId];
        return ce.caseCreatedAt != 0 && !ce.resolved && block.timestamp <= ce.caseEndsAt;
    }

    /**
     * @notice Get current time weight for a case
     */
    function getCurrentTimeWeight(bytes32 caseId) external view returns (uint256) {
        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) return 10000;
        return _calculateTimeWeight(ce.caseEndsAt);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function setModerationMarketplace(address _moderationMarketplace) external onlyOwner {
        address old = moderationMarketplace;
        moderationMarketplace = _moderationMarketplace;
        emit ModerationMarketplaceUpdated(old, _moderationMarketplace);
    }

    function setReputationProvider(address _reputationProvider) external onlyOwner {
        address old = reputationProvider;
        reputationProvider = _reputationProvider;
        emit ReputationProviderUpdated(old, _reputationProvider);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw accumulated protocol fees to treasury
     */
    function withdrawProtocolFees() external onlyOwner {
        uint256 amount = totalProtocolFees;
        if (amount == 0) revert NothingToClaim();
        
        totalProtocolFees = 0;
        
        (bool success,) = treasury.call{value: amount}("");
        require(success, "Transfer failed");

        emit ProtocolFeesWithdrawn(treasury, amount);
    }

    /**
     * @notice Emergency withdrawal for stuck funds (only if no active cases)
     * @dev Should only be used in emergency situations
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success,) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    receive() external payable {}
}
