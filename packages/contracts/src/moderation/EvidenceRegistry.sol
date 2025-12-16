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
        EvidenceStatus status;
    }

    struct EvidenceSupport {
        address supporter;
        uint256 stake;
        uint256 reputation;          // Snapshot at support time
        bool isSupporting;           // true = supports evidence, false = opposes
        string comment;              // Optional brief comment
        uint256 timestamp;
        bool claimed;                // Whether rewards/refunds have been claimed
    }

    struct CaseEvidence {
        bytes32[] evidenceIds;
        uint256 totalForStake;       // Total stake on FOR_ACTION evidence
        uint256 totalAgainstStake;   // Total stake on AGAINST_ACTION evidence
        bool resolved;
        bool outcomeWasAction;       // true if action was taken (ban/slash)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MIN_EVIDENCE_STAKE = 0.001 ether;
    uint256 public constant MIN_SUPPORT_STAKE = 0.0005 ether;
    uint256 public constant MAX_SUMMARY_LENGTH = 500;
    uint256 public constant WINNER_SHARE_BPS = 9000;     // 90% to winners
    uint256 public constant PROTOCOL_FEE_BPS = 500;      // 5% protocol fee
    uint256 public constant SUBMITTER_BONUS_BPS = 500;   // 5% bonus to evidence submitter

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

    /// @notice Next evidence ID counter
    uint256 private _nextEvidenceId;

    /// @notice ModerationMarketplace contract (authorized to resolve cases)
    address public moderationMarketplace;

    /// @notice Reputation provider for fetching user reputation
    address public reputationProvider;

    /// @notice Protocol treasury for fees
    address public treasury;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event EvidenceSubmitted(
        bytes32 indexed evidenceId,
        bytes32 indexed caseId,
        address indexed submitter,
        uint256 stake,
        EvidencePosition position,
        string ipfsHash
    );

    event EvidenceSupported(
        bytes32 indexed evidenceId,
        address indexed supporter,
        uint256 stake,
        bool isSupporting,
        string comment
    );

    event CaseResolved(
        bytes32 indexed caseId,
        bool outcomeWasAction,
        uint256 totalForStake,
        uint256 totalAgainstStake
    );

    event RewardsClaimed(
        bytes32 indexed evidenceId,
        address indexed claimer,
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
    error EvidenceNotFound();
    error AlreadySupported();
    error NotAuthorized();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidAddress();
    error CaseNotResolved();

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
        if (ce.resolved) revert CaseAlreadyResolved();

        // Generate unique evidence ID
        evidenceId = keccak256(abi.encodePacked(
            _nextEvidenceId++,
            caseId,
            msg.sender,
            block.timestamp
        ));

        // Get submitter reputation (soft context for AI)
        uint256 reputation = _getReputation(msg.sender);

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
            status: EvidenceStatus.ACTIVE
        });

        // Update case aggregation
        ce.evidenceIds.push(evidenceId);
        if (position == EvidencePosition.FOR_ACTION) {
            ce.totalForStake += msg.value;
        } else {
            ce.totalAgainstStake += msg.value;
        }

        // Track user submissions
        userEvidence[msg.sender].push(evidenceId);

        emit EvidenceSubmitted(evidenceId, caseId, msg.sender, msg.value, position, ipfsHash);
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
        
        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (ce.resolved) revert CaseAlreadyResolved();
        
        if (hasSupported[evidenceId][msg.sender]) revert AlreadySupported();

        uint256 reputation = _getReputation(msg.sender);

        // Store support record
        uint256 supportIndex = evidenceSupport[evidenceId].length;
        evidenceSupport[evidenceId].push(EvidenceSupport({
            supporter: msg.sender,
            stake: msg.value,
            reputation: reputation,
            isSupporting: isSupporting,
            comment: comment,
            timestamp: block.timestamp,
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

        // Update case totals (support adds to evidence's position)
        if (isSupporting) {
            if (e.position == EvidencePosition.FOR_ACTION) {
                ce.totalForStake += msg.value;
            } else {
                ce.totalAgainstStake += msg.value;
            }
        } else {
            // Opposition effectively supports the opposite position
            if (e.position == EvidencePosition.FOR_ACTION) {
                ce.totalAgainstStake += msg.value;
            } else {
                ce.totalForStake += msg.value;
            }
        }

        emit EvidenceSupported(evidenceId, msg.sender, msg.value, isSupporting, comment);
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
        if (ce.resolved) revert CaseAlreadyResolved();

        ce.resolved = true;
        ce.outcomeWasAction = outcomeWasAction;

        // Update all evidence statuses
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage e = evidence[ce.evidenceIds[i]];
            
            bool evidenceAlignedWithOutcome = 
                (e.position == EvidencePosition.FOR_ACTION && outcomeWasAction) ||
                (e.position == EvidencePosition.AGAINST_ACTION && !outcomeWasAction);

            e.status = evidenceAlignedWithOutcome 
                ? EvidenceStatus.REWARDED 
                : EvidenceStatus.SLASHED;
        }

        emit CaseResolved(caseId, outcomeWasAction, ce.totalForStake, ce.totalAgainstStake);
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

        // Check if caller is the submitter
        if (e.submitter == msg.sender && e.stake > 0) {
            totalClaim += _calculateSubmitterClaim(e, ce);
            e.stake = 0; // Mark as claimed
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

        emit RewardsClaimed(evidenceId, msg.sender, totalClaim);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function _calculateSubmitterClaim(
        Evidence storage e,
        CaseEvidence storage ce
    ) internal view returns (uint256) {
        bool evidenceWon = e.status == EvidenceStatus.REWARDED;
        
        if (!evidenceWon) {
            // Evidence lost - stake is slashed, nothing to claim
            return 0;
        }

        // Evidence won - get back stake + share of losing side
        uint256 losingPool = ce.outcomeWasAction 
            ? ce.totalAgainstStake 
            : ce.totalForStake;
        uint256 winningPool = ce.outcomeWasAction 
            ? ce.totalForStake 
            : ce.totalAgainstStake;

        if (winningPool == 0) return e.stake;

        // Calculate share of losing pool
        uint256 shareOfLosing = (losingPool * WINNER_SHARE_BPS * e.stake) / (winningPool * 10000);
        
        // Submitter bonus
        uint256 bonus = (losingPool * SUBMITTER_BONUS_BPS * e.stake) / (winningPool * 10000);

        return e.stake + shareOfLosing + bonus;
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

        // Supporter won - get back stake + share of losing side
        uint256 losingPool = ce.outcomeWasAction 
            ? ce.totalAgainstStake 
            : ce.totalForStake;
        uint256 winningPool = ce.outcomeWasAction 
            ? ce.totalForStake 
            : ce.totalAgainstStake;

        if (winningPool == 0) return support.stake;

        uint256 shareOfLosing = (losingPool * WINNER_SHARE_BPS * support.stake) / (winningPool * 10000);

        return support.stake + shareOfLosing;
    }

    function _getReputation(address user) internal view returns (uint256) {
        if (reputationProvider == address(0)) return 5000; // Default 50%
        
        // Try to get reputation from provider
        // Interface: getReputation(address) returns (uint256)
        (bool success, bytes memory data) = reputationProvider.staticcall(
            abi.encodeWithSignature("getReputation(address)", user)
        );
        
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
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
     * @return totalFor Total stake on FOR_ACTION
     * @return totalAgainst Total stake on AGAINST_ACTION
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
        if (e.submitter == user && e.stake > 0) {
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
     * @notice Withdraw protocol fees accumulated in contract
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success,) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

