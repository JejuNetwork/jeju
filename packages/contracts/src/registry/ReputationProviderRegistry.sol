// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReputationProviderRegistry
 * @author Jeju Network
 * @notice Permissionless registry for reputation providers with governance
 * @dev Allows community to propose adding/removing/updating reputation providers.
 *      Proposals use staked challenges with community input.
 *      AI Council/CEO makes final decisions based on all inputs.
 *
 * Provider System:
 * - Each provider has an individual weight (0-10000 basis points)
 * - Aggregate reputation = weighted sum of individual provider scores
 * - Weights are normalized to sum to 10000 when calculating
 * - Weights can be updated via governance
 *
 * Governance Flow:
 * 1. Anyone can propose changes by staking (min 0.01 ETH)
 * 2. Challenge period (7 days) for community to stake FOR/AGAINST
 * 3. Community can add opinions with stake (also claimable)
 * 4. Minimum quorum required for proposal to proceed
 * 5. AI Council receives all input and makes decision
 * 6. Timelock before execution (2 days)
 * 7. Stakes redistributed based on outcome:
 *    - Winners: stake + share of loser pool
 *    - Losers: stake slashed (proposers slashed extra)
 *
 * @custom:security-contact security@jeju.network
 */
contract ReputationProviderRegistry is Ownable, Pausable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum ProposalType {
        ADD_PROVIDER,      // Add new reputation provider
        REMOVE_PROVIDER,   // Remove existing provider
        UPDATE_WEIGHT,     // Change provider weight
        SUSPEND_PROVIDER,  // Temporarily suspend provider
        UNSUSPEND_PROVIDER // Reinstate suspended provider
    }

    enum ProposalStatus {
        PENDING,           // Challenge period active
        COUNCIL_REVIEW,    // Awaiting AI Council decision
        APPROVED,          // Council approved, in timelock
        REJECTED,          // Council rejected
        EXECUTED,          // Successfully executed
        CANCELLED          // Cancelled by proposer (with penalty)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct ReputationProvider {
        address providerContract;
        string name;
        string description;
        uint256 weight;              // 0-10000 basis points (raw weight)
        uint256 addedAt;
        bool isActive;
        bool isSuspended;
        uint256 totalFeedbackCount;  // Times this provider submitted feedback
        uint256 accuracyScore;       // 0-10000, correlation with final outcomes
        uint256 lastFeedbackAt;
    }

    struct Proposal {
        bytes32 proposalId;
        ProposalType proposalType;
        address targetProvider;      // For ADD: new provider, others: existing
        string providerName;         // For ADD proposals
        string providerDescription;
        uint256 proposedWeight;      // For ADD/UPDATE_WEIGHT
        address proposer;
        uint256 stake;
        uint256 forStake;            // Total stake supporting proposal (excluding proposer)
        uint256 againstStake;        // Total stake opposing proposal
        uint256 forCount;
        uint256 againstCount;
        uint256 createdAt;
        uint256 challengeEnds;
        uint256 timelockEnds;
        ProposalStatus status;
        bytes32 councilDecisionHash; // IPFS hash of AI Council reasoning
        string councilReason;        // Brief reason from council
        bool proposerClaimed;        // Whether proposer has claimed
    }

    struct Opinion {
        address author;
        uint256 stake;
        uint256 reputation;
        bool inFavor;                // true = supports proposal
        string ipfsHash;             // Detailed opinion on IPFS
        string summary;              // Brief summary
        uint256 timestamp;
        bool claimed;                // Whether rewards have been claimed
    }

    struct Vote {
        address voter;
        uint256 stake;
        uint256 reputation;
        bool inFavor;
        uint256 timestamp;
        bool claimed;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MIN_PROPOSAL_STAKE = 0.01 ether;   // Higher to prevent spam
    uint256 public constant MIN_VOTE_STAKE = 0.001 ether;
    uint256 public constant MIN_OPINION_STAKE = 0.0005 ether;
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant TIMELOCK_PERIOD = 2 days;
    uint256 public constant MAX_WEIGHT = 10000;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_DESCRIPTION_LENGTH = 256;
    uint256 public constant MAX_SUMMARY_LENGTH = 280;

    // Reward distribution
    uint256 public constant WINNER_SHARE_BPS = 8500;           // 85% to winners
    uint256 public constant PROTOCOL_FEE_BPS = 500;            // 5% protocol fee
    uint256 public constant PROPOSER_SLASH_MULTIPLIER = 2;     // Failed proposers lose 2x
    uint256 public constant CANCEL_PENALTY_BPS = 5000;         // 50% penalty for cancellation

    // Quorum requirements
    uint256 public constant MIN_QUORUM_STAKE = 0.1 ether;      // Minimum total stake for quorum
    uint256 public constant MIN_QUORUM_VOTERS = 3;             // Minimum voters for quorum

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice All registered providers by address
    mapping(address => ReputationProvider) public providers;

    /// @notice Provider addresses list
    address[] public providerList;

    /// @notice Active provider count
    uint256 public activeProviderCount;

    /// @notice Total raw weight of all active providers
    uint256 public totalWeight;

    /// @notice Proposals by ID
    mapping(bytes32 => Proposal) public proposals;

    /// @notice All proposal IDs
    bytes32[] public allProposalIds;

    /// @notice Votes on proposals
    mapping(bytes32 => Vote[]) public proposalVotes;

    /// @notice User vote index (for claiming)
    mapping(bytes32 => mapping(address => uint256)) public userVoteIndex;

    /// @notice Whether user has voted on proposal
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    /// @notice Opinions on proposals
    mapping(bytes32 => Opinion[]) public proposalOpinions;

    /// @notice User opinion index (for claiming)
    mapping(bytes32 => mapping(address => uint256)) public userOpinionIndex;

    /// @notice Whether user has submitted opinion on proposal
    mapping(bytes32 => mapping(address => bool)) public hasOpined;

    /// @notice Council governance contract (authorized to make decisions)
    address public councilGovernance;

    /// @notice Treasury for protocol fees
    address public treasury;

    /// @notice Total protocol fees collected
    uint256 public totalProtocolFees;

    /// @notice Next proposal ID counter
    uint256 private _nextProposalId;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event ProviderAdded(
        address indexed provider,
        string name,
        uint256 weight
    );

    event ProviderRemoved(address indexed provider);

    event ProviderWeightUpdated(
        address indexed provider,
        uint256 oldWeight,
        uint256 newWeight
    );

    event ProviderSuspended(address indexed provider);
    event ProviderUnsuspended(address indexed provider);

    event ProposalCreated(
        bytes32 indexed proposalId,
        ProposalType proposalType,
        address indexed targetProvider,
        address indexed proposer,
        uint256 stake
    );

    event ProposalVoted(
        bytes32 indexed proposalId,
        address indexed voter,
        bool inFavor,
        uint256 stake
    );

    event OpinionAdded(
        bytes32 indexed proposalId,
        address indexed author,
        bool inFavor,
        uint256 stake,
        string ipfsHash
    );

    event ProposalStatusChanged(
        bytes32 indexed proposalId,
        ProposalStatus oldStatus,
        ProposalStatus newStatus
    );

    event CouncilDecision(
        bytes32 indexed proposalId,
        bool approved,
        bytes32 decisionHash,
        string reason
    );

    event RewardsClaimed(
        bytes32 indexed proposalId,
        address indexed claimer,
        uint256 amount,
        string claimType
    );

    event ProposalCancelled(
        bytes32 indexed proposalId,
        address indexed proposer,
        uint256 penaltyAmount
    );

    event ProviderFeedbackRecorded(
        address indexed provider,
        uint256 agentId,
        uint8 score
    );

    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event CouncilGovernanceUpdated(address oldAddress, address newAddress);
    event TreasuryUpdated(address oldAddress, address newAddress);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InsufficientStake();
    error InvalidAddress();
    error ProviderExists();
    error ProviderNotFound();
    error ProviderNotActive();
    error ProviderSuspendedError();
    error ProposalNotFound();
    error ChallengePeriodActive();
    error ChallengePeriodEnded();
    error TimelockNotComplete();
    error NotAuthorized();
    error AlreadyVoted();
    error AlreadyOpined();
    error InvalidWeight();
    error NameTooLong();
    error DescriptionTooLong();
    error SummaryTooLong();
    error ProposalNotPending();
    error ProposalNotApproved();
    error ProposalNotInReview();
    error NothingToClaim();
    error AlreadyClaimed();
    error QuorumNotReached();
    error NotProposer();
    error CannotCancelAfterReview();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _councilGovernance,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        
        councilGovernance = _councilGovernance;
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PROPOSAL CREATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Propose adding a new reputation provider
     * @param providerContract Address of the provider contract
     * @param name Provider name
     * @param description Provider description
     * @param proposedWeight Initial weight (0-10000)
     */
    function proposeAddProvider(
        address providerContract,
        string calldata name,
        string calldata description,
        uint256 proposedWeight
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providerContract == address(0)) revert InvalidAddress();
        if (providers[providerContract].addedAt != 0) revert ProviderExists();
        if (proposedWeight > MAX_WEIGHT) revert InvalidWeight();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();

        proposalId = _createProposal(
            ProposalType.ADD_PROVIDER,
            providerContract,
            name,
            description,
            proposedWeight
        );
    }

    /**
     * @notice Propose removing an existing provider
     * @param providerContract Address of provider to remove
     */
    function proposeRemoveProvider(
        address providerContract
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providers[providerContract].addedAt == 0) revert ProviderNotFound();

        proposalId = _createProposal(
            ProposalType.REMOVE_PROVIDER,
            providerContract,
            "",
            "",
            0
        );
    }

    /**
     * @notice Propose updating a provider's weight
     * @param providerContract Address of provider
     * @param newWeight New weight (0-10000)
     */
    function proposeUpdateWeight(
        address providerContract,
        uint256 newWeight
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providers[providerContract].addedAt == 0) revert ProviderNotFound();
        if (newWeight > MAX_WEIGHT) revert InvalidWeight();

        proposalId = _createProposal(
            ProposalType.UPDATE_WEIGHT,
            providerContract,
            "",
            "",
            newWeight
        );
    }

    /**
     * @notice Propose suspending a provider
     * @param providerContract Address of provider to suspend
     */
    function proposeSuspendProvider(
        address providerContract
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        ReputationProvider storage p = providers[providerContract];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (p.isSuspended) revert ProviderSuspendedError();

        proposalId = _createProposal(
            ProposalType.SUSPEND_PROVIDER,
            providerContract,
            "",
            "",
            0
        );
    }

    /**
     * @notice Propose unsuspending a provider
     * @param providerContract Address of provider to unsuspend
     */
    function proposeUnsuspendProvider(
        address providerContract
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        ReputationProvider storage p = providers[providerContract];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (!p.isSuspended) revert ProviderNotActive();

        proposalId = _createProposal(
            ProposalType.UNSUSPEND_PROVIDER,
            providerContract,
            "",
            "",
            0
        );
    }

    function _createProposal(
        ProposalType proposalType,
        address targetProvider,
        string memory name,
        string memory description,
        uint256 proposedWeight
    ) internal returns (bytes32 proposalId) {
        proposalId = keccak256(abi.encodePacked(
            _nextProposalId++,
            proposalType,
            targetProvider,
            msg.sender,
            block.timestamp
        ));

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            proposalType: proposalType,
            targetProvider: targetProvider,
            providerName: name,
            providerDescription: description,
            proposedWeight: proposedWeight,
            proposer: msg.sender,
            stake: msg.value,
            forStake: 0,        // Proposer stake tracked separately
            againstStake: 0,
            forCount: 0,        // Proposer not counted in voter count
            againstCount: 0,
            createdAt: block.timestamp,
            challengeEnds: block.timestamp + CHALLENGE_PERIOD,
            timelockEnds: 0,
            status: ProposalStatus.PENDING,
            councilDecisionHash: bytes32(0),
            councilReason: "",
            proposerClaimed: false
        });

        allProposalIds.push(proposalId);

        emit ProposalCreated(proposalId, proposalType, targetProvider, msg.sender, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VOTING & OPINIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Vote on a proposal
     * @param proposalId The proposal to vote on
     * @param inFavor true = support proposal, false = oppose
     */
    function vote(
        bytes32 proposalId,
        bool inFavor
    ) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_VOTE_STAKE) revert InsufficientStake();
        
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp > p.challengeEnds) revert ChallengePeriodEnded();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();
        if (msg.sender == p.proposer) revert AlreadyVoted(); // Proposer cannot vote separately

        // Record vote
        uint256 voteIndex = proposalVotes[proposalId].length;
        proposalVotes[proposalId].push(Vote({
            voter: msg.sender,
            stake: msg.value,
            reputation: 0,
            inFavor: inFavor,
            timestamp: block.timestamp,
            claimed: false
        }));
        userVoteIndex[proposalId][msg.sender] = voteIndex;
        hasVoted[proposalId][msg.sender] = true;

        if (inFavor) {
            p.forStake += msg.value;
            p.forCount++;
        } else {
            p.againstStake += msg.value;
            p.againstCount++;
        }

        emit ProposalVoted(proposalId, msg.sender, inFavor, msg.value);
    }

    /**
     * @notice Add an opinion to a proposal with stake
     * @param proposalId The proposal
     * @param inFavor Whether opinion supports proposal
     * @param ipfsHash IPFS hash of detailed opinion
     * @param summary Brief summary
     */
    function addOpinion(
        bytes32 proposalId,
        bool inFavor,
        string calldata ipfsHash,
        string calldata summary
    ) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_OPINION_STAKE) revert InsufficientStake();
        
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp > p.challengeEnds) revert ChallengePeriodEnded();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();
        if (hasOpined[proposalId][msg.sender]) revert AlreadyOpined();

        uint256 opinionIndex = proposalOpinions[proposalId].length;
        proposalOpinions[proposalId].push(Opinion({
            author: msg.sender,
            stake: msg.value,
            reputation: 0,
            inFavor: inFavor,
            ipfsHash: ipfsHash,
            summary: summary,
            timestamp: block.timestamp,
            claimed: false
        }));

        userOpinionIndex[proposalId][msg.sender] = opinionIndex;
        hasOpined[proposalId][msg.sender] = true;

        // Opinions with stake count toward vote totals
        if (inFavor) {
            p.forStake += msg.value;
        } else {
            p.againstStake += msg.value;
        }

        emit OpinionAdded(proposalId, msg.sender, inFavor, msg.value, ipfsHash);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PROPOSAL CANCELLATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Cancel a proposal (only proposer, only during challenge period)
     * @dev Proposer loses 50% of stake as penalty, rest returned
     * @param proposalId The proposal to cancel
     */
    function cancelProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (msg.sender != p.proposer) revert NotProposer();
        if (p.status != ProposalStatus.PENDING) revert CannotCancelAfterReview();

        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.CANCELLED;

        // Calculate penalty
        uint256 penalty = (p.stake * CANCEL_PENALTY_BPS) / 10000;
        uint256 refund = p.stake - penalty;

        // Add penalty to protocol fees
        totalProtocolFees += penalty;
        p.proposerClaimed = true;

        // Return refund to proposer
        if (refund > 0) {
            (bool success,) = msg.sender.call{value: refund}("");
            require(success, "Transfer failed");
        }

        emit ProposalCancelled(proposalId, msg.sender, penalty);
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         COUNCIL DECISION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Move proposal to council review after challenge period
     * @param proposalId The proposal to advance
     */
    function advanceToCouncilReview(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp <= p.challengeEnds) revert ChallengePeriodActive();

        // Check quorum requirements
        uint256 totalVoteStake = p.forStake + p.againstStake;
        uint256 totalVoters = p.forCount + p.againstCount;
        
        if (totalVoteStake < MIN_QUORUM_STAKE || totalVoters < MIN_QUORUM_VOTERS) {
            // Quorum not reached - auto-reject
            ProposalStatus oldStatus = p.status;
            p.status = ProposalStatus.REJECTED;
            emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.REJECTED);
            return;
        }

        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.COUNCIL_REVIEW;
        
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.COUNCIL_REVIEW);
    }

    /**
     * @notice Submit council decision on a proposal
     * @dev Only callable by council governance contract
     * @param proposalId The proposal
     * @param approved Whether council approved
     * @param decisionHash IPFS hash of full reasoning
     * @param reason Brief reason
     */
    function submitCouncilDecision(
        bytes32 proposalId,
        bool approved,
        bytes32 decisionHash,
        string calldata reason
    ) external {
        // Only council can submit decisions (no owner bypass)
        if (msg.sender != councilGovernance) revert NotAuthorized();

        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.COUNCIL_REVIEW) revert ProposalNotInReview();

        p.councilDecisionHash = decisionHash;
        p.councilReason = reason;

        ProposalStatus oldStatus = p.status;

        if (approved) {
            p.status = ProposalStatus.APPROVED;
            p.timelockEnds = block.timestamp + TIMELOCK_PERIOD;
        } else {
            p.status = ProposalStatus.REJECTED;
        }

        emit CouncilDecision(proposalId, approved, decisionHash, reason);
        emit ProposalStatusChanged(proposalId, oldStatus, p.status);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         EXECUTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute an approved proposal after timelock
     * @param proposalId The proposal to execute
     */
    function executeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.APPROVED) revert ProposalNotApproved();
        if (block.timestamp < p.timelockEnds) revert TimelockNotComplete();

        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.EXECUTED;

        _executeProposalAction(p);

        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.EXECUTED);
    }

    function _executeProposalAction(Proposal storage p) internal {
        if (p.proposalType == ProposalType.ADD_PROVIDER) {
            _addProvider(
                p.targetProvider,
                p.providerName,
                p.providerDescription,
                p.proposedWeight
            );
        } else if (p.proposalType == ProposalType.REMOVE_PROVIDER) {
            _removeProvider(p.targetProvider);
        } else if (p.proposalType == ProposalType.UPDATE_WEIGHT) {
            _updateWeight(p.targetProvider, p.proposedWeight);
        } else if (p.proposalType == ProposalType.SUSPEND_PROVIDER) {
            _suspendProvider(p.targetProvider);
        } else if (p.proposalType == ProposalType.UNSUSPEND_PROVIDER) {
            _unsuspendProvider(p.targetProvider);
        }
    }

    function _addProvider(
        address providerContract,
        string memory name,
        string memory description,
        uint256 weight
    ) internal {
        providers[providerContract] = ReputationProvider({
            providerContract: providerContract,
            name: name,
            description: description,
            weight: weight,
            addedAt: block.timestamp,
            isActive: true,
            isSuspended: false,
            totalFeedbackCount: 0,
            accuracyScore: 5000, // Start at 50%
            lastFeedbackAt: 0
        });

        providerList.push(providerContract);
        activeProviderCount++;
        totalWeight += weight;

        emit ProviderAdded(providerContract, name, weight);
    }

    function _removeProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        
        if (p.isActive && !p.isSuspended) {
            activeProviderCount--;
            totalWeight -= p.weight;
        } else if (p.isActive && p.isSuspended) {
            activeProviderCount--;
            // Weight already removed when suspended
        }
        
        p.isActive = false;
        
        emit ProviderRemoved(providerContract);
    }

    function _updateWeight(address providerContract, uint256 newWeight) internal {
        ReputationProvider storage p = providers[providerContract];
        uint256 oldWeight = p.weight;
        
        if (p.isActive && !p.isSuspended) {
            totalWeight = totalWeight - oldWeight + newWeight;
        }
        
        p.weight = newWeight;
        
        emit ProviderWeightUpdated(providerContract, oldWeight, newWeight);
    }

    function _suspendProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        p.isSuspended = true;
        if (p.isActive) {
            totalWeight -= p.weight;
        }
        
        emit ProviderSuspended(providerContract);
    }

    function _unsuspendProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        p.isSuspended = false;
        if (p.isActive) {
            totalWeight += p.weight;
        }
        
        emit ProviderUnsuspended(providerContract);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM REWARDS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim rewards after proposal is resolved
     * @param proposalId The proposal to claim from
     */
    function claimRewards(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        
        // Can only claim from executed, rejected, or cancelled proposals
        if (p.status != ProposalStatus.EXECUTED && 
            p.status != ProposalStatus.REJECTED &&
            p.status != ProposalStatus.CANCELLED) {
            revert ProposalNotApproved();
        }

        uint256 totalClaim = 0;
        string memory claimType = "";

        // Check if caller is proposer
        if (msg.sender == p.proposer && !p.proposerClaimed) {
            uint256 proposerClaim = _calculateProposerClaim(p);
            if (proposerClaim > 0) {
                totalClaim += proposerClaim;
                p.proposerClaimed = true;
                claimType = "proposer";
            }
        }

        // Check if caller voted
        if (hasVoted[proposalId][msg.sender]) {
            uint256 voteIndex = userVoteIndex[proposalId][msg.sender];
            Vote storage v = proposalVotes[proposalId][voteIndex];
            
            if (!v.claimed) {
                uint256 voteClaim = _calculateVoteClaim(p, v);
                if (voteClaim > 0) {
                    totalClaim += voteClaim;
                    v.claimed = true;
                    claimType = bytes(claimType).length > 0 ? "proposer+vote" : "vote";
                }
            }
        }

        // Check if caller submitted opinion with stake
        if (hasOpined[proposalId][msg.sender]) {
            uint256 opinionIndex = userOpinionIndex[proposalId][msg.sender];
            Opinion storage o = proposalOpinions[proposalId][opinionIndex];
            
            if (!o.claimed && o.stake > 0) {
                uint256 opinionClaim = _calculateOpinionClaim(p, o);
                if (opinionClaim > 0) {
                    totalClaim += opinionClaim;
                    o.claimed = true;
                    claimType = bytes(claimType).length > 0 ? string(abi.encodePacked(claimType, "+opinion")) : "opinion";
                }
            }
        }

        if (totalClaim == 0) revert NothingToClaim();

        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");
        
        emit RewardsClaimed(proposalId, msg.sender, totalClaim, claimType);
    }

    function _calculateProposerClaim(Proposal storage p) internal view returns (uint256) {
        if (p.status == ProposalStatus.CANCELLED) {
            return 0; // Already handled in cancelProposal
        }

        bool proposalPassed = p.status == ProposalStatus.EXECUTED;
        
        if (proposalPassed) {
            // Proposer won - get back stake + share of opposing pool
            uint256 losingPool = p.againstStake;
            uint256 winningPool = p.forStake + p.stake; // Include proposer stake
            
            if (winningPool == 0) return p.stake;
            
            uint256 feeDeducted = (losingPool * PROTOCOL_FEE_BPS) / 10000;
            uint256 distributablePool = losingPool - feeDeducted;
            
            uint256 share = (distributablePool * WINNER_SHARE_BPS * p.stake) / (winningPool * 10000);
            return p.stake + share;
        } else {
            // Proposer lost - stake is slashed (with multiplier)
            // But we still need to check if there's any remainder
            return 0;
        }
    }

    function _calculateVoteClaim(Proposal storage p, Vote storage v) internal view returns (uint256) {
        bool proposalPassed = p.status == ProposalStatus.EXECUTED;
        bool voterWon = (v.inFavor && proposalPassed) || (!v.inFavor && !proposalPassed);

        if (!voterWon) {
            return 0; // Stake slashed
        }

        // Voter won
        uint256 losingPool = proposalPassed ? p.againstStake : (p.forStake + p.stake);
        uint256 winningPool = proposalPassed ? (p.forStake + p.stake) : p.againstStake;
        
        if (winningPool == 0) return v.stake;
        
        uint256 feeDeducted = (losingPool * PROTOCOL_FEE_BPS) / 10000;
        uint256 distributablePool = losingPool - feeDeducted;
        
        uint256 share = (distributablePool * WINNER_SHARE_BPS * v.stake) / (winningPool * 10000);
        return v.stake + share;
    }

    function _calculateOpinionClaim(Proposal storage p, Opinion storage o) internal view returns (uint256) {
        bool proposalPassed = p.status == ProposalStatus.EXECUTED;
        bool opinerWon = (o.inFavor && proposalPassed) || (!o.inFavor && !proposalPassed);

        if (!opinerWon) {
            return 0; // Stake slashed
        }

        // Opiner won
        uint256 losingPool = proposalPassed ? p.againstStake : (p.forStake + p.stake);
        uint256 winningPool = proposalPassed ? (p.forStake + p.stake) : p.againstStake;
        
        if (winningPool == 0) return o.stake;
        
        uint256 feeDeducted = (losingPool * PROTOCOL_FEE_BPS) / 10000;
        uint256 distributablePool = losingPool - feeDeducted;
        
        uint256 share = (distributablePool * WINNER_SHARE_BPS * o.stake) / (winningPool * 10000);
        return o.stake + share;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION QUERIES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get aggregated reputation score for an agent
     * @dev Queries all active providers and returns weighted average
     *      Weights are normalized to sum to 10000 for calculation
     * @param agentId The agent ID to query
     * @return weightedScore Weighted reputation score (0-10000)
     * @return providerScores Individual scores from each provider
     * @return providerWeights Normalized weights used for each provider
     */
    function getAggregatedReputation(uint256 agentId) external view returns (
        uint256 weightedScore,
        uint256[] memory providerScores,
        uint256[] memory providerWeights
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            ReputationProvider storage p = providers[providerList[i]];
            if (p.isActive && !p.isSuspended) {
                activeCount++;
            }
        }

        providerScores = new uint256[](activeCount);
        providerWeights = new uint256[](activeCount);

        uint256 totalWeightedScore = 0;
        uint256 idx = 0;

        for (uint256 i = 0; i < providerList.length; i++) {
            ReputationProvider storage p = providers[providerList[i]];
            if (!p.isActive || p.isSuspended) continue;

            // Get score from provider
            uint256 score = _getProviderScore(p.providerContract, agentId);
            
            // Calculate normalized weight
            uint256 normalizedWeight = totalWeight > 0 
                ? (p.weight * 10000) / totalWeight 
                : 10000 / activeCount;
            
            providerScores[idx] = score;
            providerWeights[idx] = normalizedWeight;
            totalWeightedScore += score * normalizedWeight;
            idx++;
        }

        // Divide by 10000 to get final score in 0-10000 range
        weightedScore = totalWeightedScore / 10000;
        
        // Cap at 10000
        if (weightedScore > 10000) {
            weightedScore = 10000;
        }
    }

    function _getProviderScore(address provider, uint256 agentId) internal view returns (uint256) {
        // Try IReputationProvider interface
        (bool success, bytes memory data) = provider.staticcall(
            abi.encodeWithSignature("getReputationScore(uint256)", agentId)
        );
        
        if (success && data.length >= 32) {
            uint256 score = abi.decode(data, (uint256));
            return score > 10000 ? 10000 : score;
        }
        
        return 5000; // Default 50% if provider doesn't respond
    }

    /**
     * @notice Record that a provider submitted feedback
     * @dev Called by moderation system to track provider activity
     */
    function recordProviderFeedback(
        address provider,
        uint256 agentId,
        uint8 score
    ) external {
        ReputationProvider storage p = providers[provider];
        if (p.addedAt == 0) return;

        p.totalFeedbackCount++;
        p.lastFeedbackAt = block.timestamp;

        emit ProviderFeedbackRecorded(provider, agentId, score);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getProvider(address providerContract) external view returns (ReputationProvider memory) {
        return providers[providerContract];
    }

    function getAllProviders() external view returns (address[] memory) {
        return providerList;
    }

    function getActiveProviders() external view returns (address[] memory activeProviders) {
        uint256 count = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) {
                count++;
            }
        }

        activeProviders = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) {
                activeProviders[idx++] = providerList[i];
            }
        }
    }

    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getProposalVotes(bytes32 proposalId) external view returns (Vote[] memory) {
        return proposalVotes[proposalId];
    }

    function getProposalOpinions(bytes32 proposalId) external view returns (Opinion[] memory) {
        return proposalOpinions[proposalId];
    }

    function getAllProposals() external view returns (bytes32[] memory) {
        return allProposalIds;
    }

    /**
     * @notice Check if quorum is reached for a proposal
     */
    function isQuorumReached(bytes32 proposalId) external view returns (bool reached, uint256 currentStake, uint256 currentVoters) {
        Proposal storage p = proposals[proposalId];
        currentStake = p.forStake + p.againstStake;
        currentVoters = p.forCount + p.againstCount;
        reached = currentStake >= MIN_QUORUM_STAKE && currentVoters >= MIN_QUORUM_VOTERS;
    }

    /**
     * @notice Get claimable amount for a user on a proposal
     */
    function getClaimableAmount(bytes32 proposalId, address user) external view returns (uint256) {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.EXECUTED && 
            p.status != ProposalStatus.REJECTED &&
            p.status != ProposalStatus.CANCELLED) {
            return 0;
        }

        uint256 total = 0;

        // Proposer claim
        if (user == p.proposer && !p.proposerClaimed) {
            total += _calculateProposerClaim(p);
        }

        // Vote claim
        if (hasVoted[proposalId][user]) {
            uint256 voteIndex = userVoteIndex[proposalId][user];
            Vote storage v = proposalVotes[proposalId][voteIndex];
            if (!v.claimed) {
                total += _calculateVoteClaim(p, v);
            }
        }

        // Opinion claim
        if (hasOpined[proposalId][user]) {
            uint256 opinionIndex = userOpinionIndex[proposalId][user];
            Opinion storage o = proposalOpinions[proposalId][opinionIndex];
            if (!o.claimed && o.stake > 0) {
                total += _calculateOpinionClaim(p, o);
            }
        }

        return total;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize providers (owner only, for bootstrap)
     * @dev Used to set up initial providers without governance
     */
    function initializeProvider(
        address providerContract,
        string calldata name,
        string calldata description,
        uint256 weight
    ) external onlyOwner {
        if (providers[providerContract].addedAt != 0) revert ProviderExists();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        
        _addProvider(providerContract, name, description, weight);
    }

    function setCouncilGovernance(address _councilGovernance) external onlyOwner {
        address old = councilGovernance;
        councilGovernance = _councilGovernance;
        emit CouncilGovernanceUpdated(old, _councilGovernance);
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

    function withdrawProtocolFees() external onlyOwner {
        uint256 amount = totalProtocolFees;
        if (amount == 0) revert NothingToClaim();
        
        totalProtocolFees = 0;
        
        (bool success,) = treasury.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit ProtocolFeesWithdrawn(treasury, amount);
    }

    /**
     * @notice Emergency function for council to reject stuck proposals
     * @dev Only for proposals stuck in COUNCIL_REVIEW for too long
     */
    function emergencyRejectProposal(bytes32 proposalId, string calldata reason) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.COUNCIL_REVIEW) revert ProposalNotInReview();
        
        // Must be stuck for at least 30 days
        require(block.timestamp > p.challengeEnds + 30 days, "Not stuck long enough");

        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.REJECTED;
        p.councilReason = reason;
        
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.REJECTED);
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    receive() external payable {}
}
