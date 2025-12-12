// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Council
 * @author Jeju Network
 * @notice AI Council DAO - Autonomous governance with AI CEO and council agents
 * @dev Implements a multi-stage proposal system with:
 *      - Quality-gated submission (90%+ score required)
 *      - AI council deliberation with role-based voting
 *      - Deep research integration via compute marketplace
 *      - AI CEO final decision making
 *      - Reputation and stake-weighted veto period
 *      - Prediction market dispute resolution
 *
 * Flow:
 * 1. User crafts proposal with Proposal Agent (off-chain)
 * 2. Quality score >= 90% enables on-chain submission
 * 3. Council agents deliberate and vote
 * 4. If approved, deep research conducted
 * 5. Council re-deliberates with research
 * 6. If approved, goes to CEO queue
 * 7. CEO makes final decision
 * 8. Grace period for veto votes
 * 9. Execution if no successful veto
 *
 * @custom:security-contact security@jeju.network
 */
contract Council is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // Enums
    // ============================================================================

    enum ProposalStatus {
        SUBMITTED,           // Submitted on-chain
        COUNCIL_REVIEW,      // Council deliberating
        RESEARCH_PENDING,    // Awaiting deep research
        COUNCIL_FINAL,       // Final council review with research
        CEO_QUEUE,           // Awaiting CEO decision
        APPROVED,            // CEO approved, in grace period
        EXECUTING,           // Being executed
        COMPLETED,           // Fully executed
        REJECTED,            // Rejected by council or CEO
        VETOED,              // Vetoed during grace period
        DUPLICATE,           // Marked as duplicate
        SPAM                 // Marked as spam
    }

    enum ProposalType {
        PARAMETER_CHANGE,
        TREASURY_ALLOCATION,
        CODE_UPGRADE,
        HIRE_CONTRACTOR,
        FIRE_CONTRACTOR,
        BOUNTY,
        GRANT,
        PARTNERSHIP,
        POLICY,
        EMERGENCY
    }

    enum CouncilRole {
        TREASURY,    // Reviews financial impact
        CODE,        // Reviews technical changes
        COMMUNITY,   // Reviews community impact
        SECURITY     // Reviews security implications
    }

    enum VoteType {
        APPROVE,
        REJECT,
        ABSTAIN,
        REQUEST_CHANGES
    }

    enum VetoCategory {
        ALREADY_DONE,
        DUPLICATE,
        IMPOSSIBLE,
        HARMFUL,
        MISALIGNED,
        INSUFFICIENT_INFO,
        OTHER
    }

    // ============================================================================
    // Structs
    // ============================================================================

    struct Proposal {
        bytes32 proposalId;
        address proposer;
        uint256 proposerAgentId;
        ProposalType proposalType;
        ProposalStatus status;
        uint8 qualityScore;              // 0-100
        uint256 createdAt;
        uint256 councilVoteEnd;
        uint256 gracePeriodEnd;
        bytes32 contentHash;             // IPFS hash of full content
        address targetContract;
        bytes callData;
        uint256 value;
        uint256 totalStaked;
        uint256 totalReputation;
        uint256 backerCount;
        bool hasResearch;
        bytes32 researchHash;
        bool ceoApproved;
        bytes32 ceoDecisionHash;
    }

    struct CouncilVote {
        bytes32 proposalId;
        address councilAgent;
        CouncilRole role;
        VoteType vote;
        bytes32 reasoningHash;
        uint256 votedAt;
        uint256 weight;
    }

    struct BackerInfo {
        address backer;
        uint256 agentId;
        uint256 stakedAmount;
        uint256 reputationWeight;
        uint256 backedAt;
    }

    struct VetoVote {
        address voter;
        uint256 agentId;
        VetoCategory category;
        bytes32 reasonHash;
        uint256 stakedAmount;
        uint256 reputationWeight;
        uint256 votedAt;
    }

    struct CouncilAgent {
        address agentAddress;
        uint256 agentId;
        CouncilRole role;
        uint256 votingWeight;
        bool isActive;
        uint256 proposalsReviewed;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice Governance token for staking
    IERC20 public immutable governanceToken;

    /// @notice Identity registry for agent verification
    address public identityRegistry;

    /// @notice Reputation registry for score lookups
    address public reputationRegistry;

    /// @notice Staking manager for stake lookups
    address public stakingManager;

    /// @notice Predimarket for veto prediction markets
    address public predimarket;

    /// @notice CEO agent address
    address public ceoAgent;

    /// @notice CEO agent ID
    uint256 public ceoAgentId;

    /// @notice All proposals
    mapping(bytes32 => Proposal) public proposals;

    /// @notice Proposal IDs in order
    bytes32[] public allProposalIds;

    /// @notice Council agents by role
    mapping(CouncilRole => CouncilAgent) public councilAgents;

    /// @notice Council votes per proposal
    mapping(bytes32 => CouncilVote[]) public councilVotes;

    /// @notice Backers per proposal
    mapping(bytes32 => BackerInfo[]) public proposalBackers;

    /// @notice Has address backed proposal
    mapping(bytes32 => mapping(address => bool)) public hasBacked;

    /// @notice Veto votes per proposal
    mapping(bytes32 => VetoVote[]) public vetoVotes;

    /// @notice Has address vetoed proposal
    mapping(bytes32 => mapping(address => bool)) public hasVetoed;

    /// @notice Proposals by proposer
    mapping(address => bytes32[]) public proposerProposals;

    /// @notice Research operators (can submit research reports)
    mapping(address => bool) public isResearchOperator;

    /// @notice Proposal count
    uint256 public proposalCount;

    // ============================================================================
    // Parameters
    // ============================================================================

    uint8 public minQualityScore = 90;
    uint256 public councilVotingPeriod = 3 days;
    uint256 public gracePeriod = 24 hours;
    uint256 public minBackers = 0;
    uint256 public minStakeForVeto = 0.01 ether;
    uint256 public vetoThresholdBPS = 3000;  // 30% of total stake to veto
    uint256 public proposalBond = 0.001 ether;

    // ============================================================================
    // Events
    // ============================================================================

    event ProposalSubmitted(
        bytes32 indexed proposalId,
        address indexed proposer,
        uint256 proposerAgentId,
        ProposalType proposalType,
        uint8 qualityScore,
        bytes32 contentHash
    );

    event ProposalBacked(
        bytes32 indexed proposalId,
        address indexed backer,
        uint256 agentId,
        uint256 stakedAmount,
        uint256 reputationWeight
    );

    event CouncilVoteCast(
        bytes32 indexed proposalId,
        address indexed councilAgent,
        CouncilRole role,
        VoteType vote,
        uint256 weight
    );

    event CouncilDeliberationComplete(
        bytes32 indexed proposalId,
        bool approved,
        uint256 approveVotes,
        uint256 rejectVotes
    );

    event ResearchSubmitted(
        bytes32 indexed proposalId,
        bytes32 researchHash,
        bool recommendProceed
    );

    event CEODecision(
        bytes32 indexed proposalId,
        bool approved,
        bytes32 decisionHash
    );

    event VetoVoteCast(
        bytes32 indexed proposalId,
        address indexed voter,
        VetoCategory category,
        uint256 stakedAmount
    );

    event ProposalVetoed(
        bytes32 indexed proposalId,
        uint256 totalVetoStake,
        uint256 threshold
    );

    event ProposalExecuted(
        bytes32 indexed proposalId,
        address targetContract,
        bool success
    );

    event ProposalStatusChanged(
        bytes32 indexed proposalId,
        ProposalStatus oldStatus,
        ProposalStatus newStatus
    );

    event CouncilAgentUpdated(
        CouncilRole role,
        address agentAddress,
        uint256 agentId
    );

    event CEOAgentUpdated(
        address oldCEO,
        address newCEO,
        uint256 agentId
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error InsufficientQualityScore(uint8 provided, uint8 required);
    error InsufficientBond();
    error ProposalNotFound();
    error InvalidStatus(ProposalStatus current, ProposalStatus required);
    error NotCouncilAgent();
    error AlreadyVoted();
    error VotingPeriodEnded();
    error VotingPeriodNotEnded();
    error NotCEOAgent();
    error GracePeriodNotEnded();
    error GracePeriodEnded();
    error AlreadyBacked();
    error AlreadyVetoed();
    error InsufficientVetoStake();
    error NotResearchOperator();
    error VetoSucceeded();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyCEO() {
        if (msg.sender != ceoAgent) revert NotCEOAgent();
        _;
    }

    modifier onlyCouncil() {
        bool isCouncil = false;
        for (uint8 i = 0; i <= uint8(CouncilRole.SECURITY); i++) {
            if (councilAgents[CouncilRole(i)].agentAddress == msg.sender && 
                councilAgents[CouncilRole(i)].isActive) {
                isCouncil = true;
                break;
            }
        }
        if (!isCouncil) revert NotCouncilAgent();
        _;
    }

    modifier onlyResearchOperator() {
        if (!isResearchOperator[msg.sender]) revert NotResearchOperator();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _governanceToken,
        address _identityRegistry,
        address _reputationRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_governanceToken != address(0), "Invalid token");
        require(_identityRegistry != address(0), "Invalid identity registry");
        require(_reputationRegistry != address(0), "Invalid reputation registry");

        governanceToken = IERC20(_governanceToken);
        identityRegistry = _identityRegistry;
        reputationRegistry = _reputationRegistry;
    }

    // ============================================================================
    // Proposal Submission
    // ============================================================================

    /**
     * @notice Submit a proposal on-chain
     * @param proposalType Type of proposal
     * @param qualityScore Quality score from proposal agent (0-100)
     * @param contentHash IPFS hash of full proposal content
     * @param targetContract Contract to execute on (if applicable)
     * @param callData Execution calldata
     * @param value ETH value for execution
     * @return proposalId Unique proposal identifier
     */
    function submitProposal(
        ProposalType proposalType,
        uint8 qualityScore,
        bytes32 contentHash,
        address targetContract,
        bytes calldata callData,
        uint256 value
    ) external payable nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (qualityScore < minQualityScore) {
            revert InsufficientQualityScore(qualityScore, minQualityScore);
        }
        if (msg.value < proposalBond) {
            revert InsufficientBond();
        }

        proposalId = keccak256(abi.encodePacked(
            msg.sender,
            contentHash,
            block.timestamp,
            proposalCount
        ));

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            proposer: msg.sender,
            proposerAgentId: 0, // Can be set via separate call if registered
            proposalType: proposalType,
            status: ProposalStatus.SUBMITTED,
            qualityScore: qualityScore,
            createdAt: block.timestamp,
            councilVoteEnd: block.timestamp + councilVotingPeriod,
            gracePeriodEnd: 0,
            contentHash: contentHash,
            targetContract: targetContract,
            callData: callData,
            value: value,
            totalStaked: 0,
            totalReputation: 0,
            backerCount: 0,
            hasResearch: false,
            researchHash: bytes32(0),
            ceoApproved: false,
            ceoDecisionHash: bytes32(0)
        });

        allProposalIds.push(proposalId);
        proposerProposals[msg.sender].push(proposalId);
        proposalCount++;

        emit ProposalSubmitted(
            proposalId,
            msg.sender,
            0,
            proposalType,
            qualityScore,
            contentHash
        );

        // Transition to council review
        _transitionStatus(proposalId, ProposalStatus.COUNCIL_REVIEW);
    }

    /**
     * @notice Back a proposal with stake and reputation
     * @param proposalId Proposal to back
     * @param stakeAmount Amount of governance tokens to stake
     * @param reputationWeight Reputation weight (verified off-chain)
     */
    function backProposal(
        bytes32 proposalId,
        uint256 stakeAmount,
        uint256 reputationWeight
    ) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (hasBacked[proposalId][msg.sender]) revert AlreadyBacked();

        // Transfer stake
        if (stakeAmount > 0) {
            governanceToken.safeTransferFrom(msg.sender, address(this), stakeAmount);
        }

        proposalBackers[proposalId].push(BackerInfo({
            backer: msg.sender,
            agentId: 0,
            stakedAmount: stakeAmount,
            reputationWeight: reputationWeight,
            backedAt: block.timestamp
        }));

        hasBacked[proposalId][msg.sender] = true;
        proposal.totalStaked += stakeAmount;
        proposal.totalReputation += reputationWeight;
        proposal.backerCount++;

        emit ProposalBacked(
            proposalId,
            msg.sender,
            0,
            stakeAmount,
            reputationWeight
        );
    }

    // ============================================================================
    // Council Voting
    // ============================================================================

    /**
     * @notice Cast council vote on proposal
     * @param proposalId Proposal to vote on
     * @param vote Vote type
     * @param reasoningHash IPFS hash of reasoning
     */
    function castCouncilVote(
        bytes32 proposalId,
        VoteType vote,
        bytes32 reasoningHash
    ) external onlyCouncil {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.COUNCIL_REVIEW &&
            proposal.status != ProposalStatus.COUNCIL_FINAL) {
            revert InvalidStatus(proposal.status, ProposalStatus.COUNCIL_REVIEW);
        }
        if (block.timestamp > proposal.councilVoteEnd) {
            revert VotingPeriodEnded();
        }

        // Check if already voted
        CouncilVote[] storage votes = councilVotes[proposalId];
        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i].councilAgent == msg.sender) revert AlreadyVoted();
        }

        // Get council role
        CouncilRole role;
        uint256 weight;
        for (uint8 i = 0; i <= uint8(CouncilRole.SECURITY); i++) {
            if (councilAgents[CouncilRole(i)].agentAddress == msg.sender) {
                role = CouncilRole(i);
                weight = councilAgents[CouncilRole(i)].votingWeight;
                break;
            }
        }

        votes.push(CouncilVote({
            proposalId: proposalId,
            councilAgent: msg.sender,
            role: role,
            vote: vote,
            reasoningHash: reasoningHash,
            votedAt: block.timestamp,
            weight: weight
        }));

        // Update council agent stats
        councilAgents[role].proposalsReviewed++;

        emit CouncilVoteCast(proposalId, msg.sender, role, vote, weight);
    }

    /**
     * @notice Finalize council deliberation
     * @param proposalId Proposal to finalize
     */
    function finalizeCouncilVote(bytes32 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.COUNCIL_REVIEW &&
            proposal.status != ProposalStatus.COUNCIL_FINAL) {
            revert InvalidStatus(proposal.status, ProposalStatus.COUNCIL_REVIEW);
        }
        if (block.timestamp < proposal.councilVoteEnd) {
            revert VotingPeriodNotEnded();
        }

        // Tally votes
        CouncilVote[] storage votes = councilVotes[proposalId];
        uint256 approveWeight = 0;
        uint256 rejectWeight = 0;

        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i].vote == VoteType.APPROVE) {
                approveWeight += votes[i].weight;
            } else if (votes[i].vote == VoteType.REJECT) {
                rejectWeight += votes[i].weight;
            }
        }

        bool approved = approveWeight > rejectWeight;

        emit CouncilDeliberationComplete(
            proposalId,
            approved,
            approveWeight,
            rejectWeight
        );

        if (approved) {
            if (proposal.status == ProposalStatus.COUNCIL_REVIEW) {
                // First council vote - send to research
                _transitionStatus(proposalId, ProposalStatus.RESEARCH_PENDING);
            } else {
                // Final council vote - send to CEO
                _transitionStatus(proposalId, ProposalStatus.CEO_QUEUE);
            }
        } else {
            _transitionStatus(proposalId, ProposalStatus.REJECTED);
        }
    }

    // ============================================================================
    // Research Integration
    // ============================================================================

    /**
     * @notice Submit research report for proposal
     * @param proposalId Proposal researched
     * @param researchHash IPFS hash of research report
     * @param recommendProceed Research recommendation
     */
    function submitResearch(
        bytes32 proposalId,
        bytes32 researchHash,
        bool recommendProceed
    ) external onlyResearchOperator {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.RESEARCH_PENDING) {
            revert InvalidStatus(proposal.status, ProposalStatus.RESEARCH_PENDING);
        }

        proposal.hasResearch = true;
        proposal.researchHash = researchHash;

        emit ResearchSubmitted(proposalId, researchHash, recommendProceed);

        if (recommendProceed) {
            // Reset voting period for final council review
            proposal.councilVoteEnd = block.timestamp + councilVotingPeriod;
            // Clear previous council votes for fresh deliberation
            delete councilVotes[proposalId];
            _transitionStatus(proposalId, ProposalStatus.COUNCIL_FINAL);
        } else {
            _transitionStatus(proposalId, ProposalStatus.REJECTED);
        }
    }

    // ============================================================================
    // CEO Decision
    // ============================================================================

    /**
     * @notice CEO makes final decision on proposal
     * @param proposalId Proposal to decide
     * @param approved Whether to approve
     * @param decisionHash IPFS hash of decision reasoning
     */
    function ceoDecide(
        bytes32 proposalId,
        bool approved,
        bytes32 decisionHash
    ) external onlyCEO {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.CEO_QUEUE) {
            revert InvalidStatus(proposal.status, ProposalStatus.CEO_QUEUE);
        }

        proposal.ceoApproved = approved;
        proposal.ceoDecisionHash = decisionHash;

        emit CEODecision(proposalId, approved, decisionHash);

        if (approved) {
            proposal.gracePeriodEnd = block.timestamp + gracePeriod;
            _transitionStatus(proposalId, ProposalStatus.APPROVED);
        } else {
            _transitionStatus(proposalId, ProposalStatus.REJECTED);
        }
    }

    // ============================================================================
    // Veto Voting
    // ============================================================================

    /**
     * @notice Cast veto vote during grace period
     * @param proposalId Proposal to veto
     * @param category Veto reason category
     * @param reasonHash IPFS hash of reason
     */
    function castVetoVote(
        bytes32 proposalId,
        VetoCategory category,
        bytes32 reasonHash
    ) external payable nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.APPROVED) {
            revert InvalidStatus(proposal.status, ProposalStatus.APPROVED);
        }
        if (block.timestamp > proposal.gracePeriodEnd) {
            revert GracePeriodEnded();
        }
        if (hasVetoed[proposalId][msg.sender]) revert AlreadyVetoed();
        if (msg.value < minStakeForVeto) revert InsufficientVetoStake();

        vetoVotes[proposalId].push(VetoVote({
            voter: msg.sender,
            agentId: 0,
            category: category,
            reasonHash: reasonHash,
            stakedAmount: msg.value,
            reputationWeight: 0, // Set off-chain
            votedAt: block.timestamp
        }));

        hasVetoed[proposalId][msg.sender] = true;

        emit VetoVoteCast(proposalId, msg.sender, category, msg.value);

        // Check if veto threshold reached
        uint256 totalVetoStake = 0;
        VetoVote[] storage vetos = vetoVotes[proposalId];
        for (uint256 i = 0; i < vetos.length; i++) {
            totalVetoStake += vetos[i].stakedAmount;
        }

        uint256 threshold = (proposal.totalStaked * vetoThresholdBPS) / 10000;
        if (threshold == 0) {
            threshold = minStakeForVeto * 10; // Default threshold
        }

        if (totalVetoStake >= threshold) {
            emit ProposalVetoed(proposalId, totalVetoStake, threshold);
            _transitionStatus(proposalId, ProposalStatus.VETOED);
        }
    }

    // ============================================================================
    // Execution
    // ============================================================================

    /**
     * @notice Execute approved proposal after grace period
     * @param proposalId Proposal to execute
     */
    function executeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposalId == bytes32(0)) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.APPROVED) {
            revert InvalidStatus(proposal.status, ProposalStatus.APPROVED);
        }
        if (block.timestamp < proposal.gracePeriodEnd) {
            revert GracePeriodNotEnded();
        }

        // Check no successful veto
        uint256 totalVetoStake = 0;
        VetoVote[] storage vetos = vetoVotes[proposalId];
        for (uint256 i = 0; i < vetos.length; i++) {
            totalVetoStake += vetos[i].stakedAmount;
        }

        uint256 threshold = (proposal.totalStaked * vetoThresholdBPS) / 10000;
        if (threshold == 0) {
            threshold = minStakeForVeto * 10;
        }

        if (totalVetoStake >= threshold) {
            revert VetoSucceeded();
        }

        _transitionStatus(proposalId, ProposalStatus.EXECUTING);

        // Execute if target contract specified
        bool success = true;
        if (proposal.targetContract != address(0) && proposal.callData.length > 0) {
            (success,) = proposal.targetContract.call{value: proposal.value}(proposal.callData);
        }

        emit ProposalExecuted(proposalId, proposal.targetContract, success);

        if (success) {
            _transitionStatus(proposalId, ProposalStatus.COMPLETED);
        } else {
            _transitionStatus(proposalId, ProposalStatus.REJECTED);
        }
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _transitionStatus(bytes32 proposalId, ProposalStatus newStatus) internal {
        ProposalStatus oldStatus = proposals[proposalId].status;
        proposals[proposalId].status = newStatus;
        emit ProposalStatusChanged(proposalId, oldStatus, newStatus);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getCouncilVotes(bytes32 proposalId) external view returns (CouncilVote[] memory) {
        return councilVotes[proposalId];
    }

    function getProposalBackers(bytes32 proposalId) external view returns (BackerInfo[] memory) {
        return proposalBackers[proposalId];
    }

    function getVetoVotes(bytes32 proposalId) external view returns (VetoVote[] memory) {
        return vetoVotes[proposalId];
    }

    function getProposerProposals(address proposer) external view returns (bytes32[] memory) {
        return proposerProposals[proposer];
    }

    function getAllProposals() external view returns (bytes32[] memory) {
        return allProposalIds;
    }

    function getActiveProposals() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allProposalIds.length; i++) {
            ProposalStatus status = proposals[allProposalIds[i]].status;
            if (status != ProposalStatus.COMPLETED &&
                status != ProposalStatus.REJECTED &&
                status != ProposalStatus.VETOED &&
                status != ProposalStatus.DUPLICATE &&
                status != ProposalStatus.SPAM) {
                count++;
            }
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allProposalIds.length; i++) {
            ProposalStatus status = proposals[allProposalIds[i]].status;
            if (status != ProposalStatus.COMPLETED &&
                status != ProposalStatus.REJECTED &&
                status != ProposalStatus.VETOED &&
                status != ProposalStatus.DUPLICATE &&
                status != ProposalStatus.SPAM) {
                active[j] = allProposalIds[i];
                j++;
            }
        }

        return active;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function setCouncilAgent(
        CouncilRole role,
        address agentAddress,
        uint256 agentId,
        uint256 votingWeight
    ) external onlyOwner {
        councilAgents[role] = CouncilAgent({
            agentAddress: agentAddress,
            agentId: agentId,
            role: role,
            votingWeight: votingWeight,
            isActive: true,
            proposalsReviewed: 0
        });

        emit CouncilAgentUpdated(role, agentAddress, agentId);
    }

    function setCEOAgent(address _ceoAgent, uint256 _agentId) external onlyOwner {
        address oldCEO = ceoAgent;
        ceoAgent = _ceoAgent;
        ceoAgentId = _agentId;
        emit CEOAgentUpdated(oldCEO, _ceoAgent, _agentId);
    }

    function setResearchOperator(address operator, bool authorized) external onlyOwner {
        isResearchOperator[operator] = authorized;
    }

    function setStakingManager(address _stakingManager) external onlyOwner {
        stakingManager = _stakingManager;
    }

    function setPredimarket(address _predimarket) external onlyOwner {
        predimarket = _predimarket;
    }

    function setParameters(
        uint8 _minQualityScore,
        uint256 _councilVotingPeriod,
        uint256 _gracePeriod,
        uint256 _minBackers,
        uint256 _minStakeForVeto,
        uint256 _vetoThresholdBPS,
        uint256 _proposalBond
    ) external onlyOwner {
        minQualityScore = _minQualityScore;
        councilVotingPeriod = _councilVotingPeriod;
        gracePeriod = _gracePeriod;
        minBackers = _minBackers;
        minStakeForVeto = _minStakeForVeto;
        vetoThresholdBPS = _vetoThresholdBPS;
        proposalBond = _proposalBond;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
