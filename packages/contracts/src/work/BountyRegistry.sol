// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";
import "../moderation/ModerationMarketplace.sol";

/**
 * @title BountyRegistry
 * @author Jeju Network
 * @notice Multi-token bounty system with milestones, validator network, and dispute resolution
 * @dev Integrated with ERC-8004 IdentityRegistry for guardian validators
 *
 * Key Features:
 * - Multi-token funding (ETH + any ERC20)
 * - 10% stake required to create bounty (returned on proper completion/withdrawal)
 * - Milestone-based bounties (single or multiple completions)
 * - Validator network (guardian agents) for bounty validation
 * - 10% fee split: 5% to validators, 5% to protocol
 * - Dispute resolution via ModerationMarketplace futarchy
 * - Integration with ERC-8004 for identity/reputation
 */
contract BountyRegistry is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum BountyStatus {
        OPEN, // Accepting applications
        IN_PROGRESS, // Work has started
        REVIEW, // Awaiting validation
        DISPUTED, // Under dispute resolution
        COMPLETED, // Successfully completed
        CANCELLED // Cancelled by creator

    }

    enum MilestoneStatus {
        PENDING, // Not started
        IN_PROGRESS, // Work ongoing
        SUBMITTED, // Awaiting review
        APPROVED, // Completed and paid
        REJECTED, // Rejected, needs rework
        DISPUTED // Under dispute

    }

    enum ApplicationStatus {
        PENDING,
        ACCEPTED,
        REJECTED,
        WITHDRAWN
    }

    // ============ Structs ============

    struct TokenAmount {
        address token; // address(0) for ETH
        uint256 amount;
    }

    struct Milestone {
        string title;
        string description;
        uint256 percentage; // Percentage of total reward (basis points, 10000 = 100%)
        MilestoneStatus status;
        string deliverableUri; // IPFS URI of deliverables
        uint256 submittedAt;
        uint256 approvedAt;
    }

    struct Bounty {
        bytes32 bountyId;
        address creator;
        uint256 creatorAgentId; // ERC-8004 agent ID (0 if no agent)
        string title;
        string description;
        string specUri; // IPFS URI for detailed spec
        TokenAmount[] rewards; // Multi-token rewards
        TokenAmount creatorStake; // 10% stake (single token)
        uint256 deadline;
        string[] requiredSkills;
        BountyStatus status;
        address assignee;
        uint256 assigneeAgentId;
        uint256 createdAt;
        uint256 completedAt;
        uint256 currentMilestone;
        bytes32 disputeCaseId; // Moderation case if disputed
    }

    struct BountyApplication {
        address applicant;
        uint256 agentId; // ERC-8004 agent ID
        string proposalUri; // IPFS URI for proposal
        uint256 estimatedDuration; // In seconds
        ApplicationStatus status;
        uint256 appliedAt;
    }

    struct ValidatorVote {
        bool approved;
        string reasonUri; // IPFS URI for validation notes
        uint256 votedAt;
    }

    // ============ Constants ============

    uint256 public constant CREATOR_STAKE_BPS = 1000; // 10% stake
    uint256 public constant VALIDATOR_FEE_BPS = 500; // 5% to validators
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5% to protocol
    uint256 public constant MIN_VALIDATORS = 3; // Minimum validators for approval
    uint256 public constant VALIDATOR_QUORUM_BPS = 6000; // 60% must approve
    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant DISPUTE_PERIOD = 3 days; // Time to dispute after rejection

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    ModerationMarketplace public moderationMarketplace;
    address public treasury;
    address public validatorPool; // Pool for validator rewards

    mapping(bytes32 => Bounty) public bounties;
    mapping(bytes32 => Milestone[]) public milestones;
    mapping(bytes32 => BountyApplication[]) public applications;
    mapping(bytes32 => mapping(uint256 => mapping(address => ValidatorVote))) public validatorVotes;
    mapping(bytes32 => mapping(uint256 => address[])) public milestoneValidators;

    // Validator registry (agents who can validate)
    mapping(uint256 => bool) public isValidator; // agentId => isValidator
    uint256[] public validatorAgentIds;
    uint256 public minValidatorStake = 0.01 ether; // Minimum stake to be validator

    // Token whitelist for rewards
    mapping(address => bool) public whitelistedTokens;
    address[] public tokenList;

    // Counters
    uint256 private _nextBountyId = 1;

    // ============ Events ============

    event BountyCreated(
        bytes32 indexed bountyId,
        address indexed creator,
        uint256 indexed creatorAgentId,
        string title,
        uint256 totalRewardValue
    );
    event BountyUpdated(bytes32 indexed bountyId, string title, string specUri);
    event BountyCancelled(bytes32 indexed bountyId, address indexed creator);
    event ApplicationSubmitted(bytes32 indexed bountyId, address indexed applicant, uint256 indexed agentId);
    event ApplicationAccepted(bytes32 indexed bountyId, address indexed assignee);
    event MilestoneSubmitted(bytes32 indexed bountyId, uint256 indexed milestoneIndex, string deliverableUri);
    event MilestoneApproved(bytes32 indexed bountyId, uint256 indexed milestoneIndex, uint256 payout);
    event MilestoneRejected(bytes32 indexed bountyId, uint256 indexed milestoneIndex, string reason);
    event BountyCompleted(bytes32 indexed bountyId, address indexed assignee, uint256 totalPaid);
    event BountyDisputed(bytes32 indexed bountyId, bytes32 indexed caseId);
    event ValidatorVoted(
        bytes32 indexed bountyId, uint256 indexed milestoneIndex, address indexed validator, bool approved
    );
    event ValidatorRegistered(uint256 indexed agentId, address indexed owner);
    event ValidatorRemoved(uint256 indexed agentId);
    event TokenWhitelisted(address indexed token, bool whitelisted);

    // ============ Errors ============

    error InvalidBounty();
    error NotBountyCreator();
    error NotAssignee();
    error BountyNotOpen();
    error BountyNotInProgress();
    error InvalidMilestone();
    error InsufficientStake();
    error TokenNotWhitelisted();
    error AlreadyApplied();
    error ApplicationNotFound();
    error NotValidator();
    error AlreadyVoted();
    error QuorumNotReached();
    error DisputePeriodActive();
    error DisputePeriodExpired();
    error MilestoneNotSubmitted();
    error TooManyMilestones();
    error MilestonePercentageInvalid();
    error DeadlinePassed();
    error TransferFailed();

    // ============ Modifiers ============

    modifier onlyBountyCreator(bytes32 bountyId) {
        if (bounties[bountyId].creator != msg.sender) revert NotBountyCreator();
        _;
    }

    modifier onlyAssignee(bytes32 bountyId) {
        if (bounties[bountyId].assignee != msg.sender) revert NotAssignee();
        _;
    }

    modifier bountyExists(bytes32 bountyId) {
        if (bounties[bountyId].createdAt == 0) revert InvalidBounty();
        _;
    }

    modifier onlyValidator() {
        uint256 agentId = getAgentIdForAddress(msg.sender);
        if (agentId == 0 || !isValidator[agentId]) revert NotValidator();
        _;
    }

    // ============ Constructor ============

    constructor(address _identityRegistry, address _treasury, address initialOwner) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
        validatorPool = _treasury; // Initially same as treasury

        // Whitelist ETH
        whitelistedTokens[address(0)] = true;
        tokenList.push(address(0));
    }

    // ============ Bounty Creation ============

    /// @dev Packed struct to reduce stack depth in createBounty
    struct CreateBountyParams {
        string title;
        string description;
        string specUri;
        uint256 deadline;
    }

    /**
     * @notice Create a new bounty with multi-token rewards
     * @param params Basic bounty parameters (title, description, specUri, deadline)
     * @param rewards Array of token amounts for rewards
     * @param milestoneTitles Titles for each milestone
     * @param milestoneDescriptions Descriptions for each milestone
     * @param milestonePercentages Percentage of reward for each milestone (must sum to 10000)
     * @param requiredSkills Array of required skill tags
     */
    function createBounty(
        CreateBountyParams calldata params,
        TokenAmount[] calldata rewards,
        string[] calldata milestoneTitles,
        string[] calldata milestoneDescriptions,
        uint256[] calldata milestonePercentages,
        string[] calldata requiredSkills
    ) external payable nonReentrant whenNotPaused returns (bytes32 bountyId) {
        // Validate milestones
        _validateMilestones(milestoneTitles, milestoneDescriptions, milestonePercentages);

        // Validate deadline
        if (params.deadline <= block.timestamp) revert DeadlinePassed();

        // Generate bounty ID
        bountyId = keccak256(abi.encodePacked(_nextBountyId++, msg.sender, block.timestamp));

        // Collect funds and create stake
        TokenAmount memory stakeToken = _collectBountyFunds(rewards);

        // Initialize bounty storage
        _initializeBounty(bountyId, params, stakeToken, rewards, requiredSkills);

        // Create milestones
        _createMilestones(bountyId, milestoneTitles, milestoneDescriptions, milestonePercentages);

        uint256 totalValue = rewards.length > 0 ? rewards[0].amount : 0;
        emit BountyCreated(bountyId, msg.sender, getAgentIdForAddress(msg.sender), params.title, totalValue);
    }

    function _validateMilestones(
        string[] calldata titles,
        string[] calldata descriptions,
        uint256[] calldata percentages
    ) internal pure {
        if (titles.length != descriptions.length || titles.length != percentages.length) {
            revert InvalidMilestone();
        }
        if (titles.length > MAX_MILESTONES || titles.length == 0) revert TooManyMilestones();

        uint256 totalPercentage;
        for (uint256 i = 0; i < percentages.length; i++) {
            totalPercentage += percentages[i];
        }
        if (totalPercentage != 10000) revert MilestonePercentageInvalid();
    }

    function _collectBountyFunds(TokenAmount[] calldata rewards) internal returns (TokenAmount memory stakeToken) {
        if (rewards.length == 0) return stakeToken;

        stakeToken.token = rewards[0].token;
        stakeToken.amount = (rewards[0].amount * CREATOR_STAKE_BPS) / 10000;

        if (stakeToken.token == address(0)) {
            uint256 totalEthNeeded = rewards[0].amount + stakeToken.amount;
            if (msg.value < totalEthNeeded) revert InsufficientStake();
        } else {
            if (!whitelistedTokens[stakeToken.token]) revert TokenNotWhitelisted();
            IERC20(stakeToken.token).safeTransferFrom(msg.sender, address(this), rewards[0].amount + stakeToken.amount);
        }

        // Collect additional reward tokens
        for (uint256 i = 1; i < rewards.length; i++) {
            if (!whitelistedTokens[rewards[i].token]) revert TokenNotWhitelisted();
            if (rewards[i].token != address(0)) {
                IERC20(rewards[i].token).safeTransferFrom(msg.sender, address(this), rewards[i].amount);
            }
        }
    }

    function _initializeBounty(
        bytes32 bountyId,
        CreateBountyParams calldata params,
        TokenAmount memory stakeToken,
        TokenAmount[] calldata rewards,
        string[] calldata requiredSkills
    ) internal {
        Bounty storage bounty = bounties[bountyId];
        bounty.bountyId = bountyId;
        bounty.creator = msg.sender;
        bounty.creatorAgentId = getAgentIdForAddress(msg.sender);
        bounty.title = params.title;
        bounty.description = params.description;
        bounty.specUri = params.specUri;
        bounty.creatorStake = stakeToken;
        bounty.deadline = params.deadline;
        bounty.requiredSkills = requiredSkills;
        bounty.status = BountyStatus.OPEN;
        bounty.createdAt = block.timestamp;

        for (uint256 i = 0; i < rewards.length; i++) {
            bounty.rewards.push(rewards[i]);
        }
    }

    function _createMilestones(
        bytes32 bountyId,
        string[] calldata titles,
        string[] calldata descriptions,
        uint256[] calldata percentages
    ) internal {
        for (uint256 i = 0; i < titles.length; i++) {
            milestones[bountyId].push(
                Milestone({
                    title: titles[i],
                    description: descriptions[i],
                    percentage: percentages[i],
                    status: MilestoneStatus.PENDING,
                    deliverableUri: "",
                    submittedAt: 0,
                    approvedAt: 0
                })
            );
        }
    }

    /**
     * @notice Cancel a bounty and return stake (only if no assignee)
     */
    function cancelBounty(bytes32 bountyId) external nonReentrant bountyExists(bountyId) onlyBountyCreator(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.OPEN) revert BountyNotOpen();

        bounty.status = BountyStatus.CANCELLED;

        // Return stake
        _transferTokens(bounty.creatorStake.token, msg.sender, bounty.creatorStake.amount);

        // Return rewards
        for (uint256 i = 0; i < bounty.rewards.length; i++) {
            _transferTokens(bounty.rewards[i].token, msg.sender, bounty.rewards[i].amount);
        }

        emit BountyCancelled(bountyId, msg.sender);
    }

    // ============ Applications ============

    /**
     * @notice Apply for a bounty
     * @param bountyId Bounty ID
     * @param proposalUri IPFS URI of proposal
     * @param estimatedDuration Estimated time to complete in seconds
     */
    function applyForBounty(bytes32 bountyId, string calldata proposalUri, uint256 estimatedDuration)
        external
        nonReentrant
        bountyExists(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.OPEN) revert BountyNotOpen();
        if (block.timestamp > bounty.deadline) revert DeadlinePassed();

        // Check if already applied
        BountyApplication[] storage apps = applications[bountyId];
        for (uint256 i = 0; i < apps.length; i++) {
            if (apps[i].applicant == msg.sender) revert AlreadyApplied();
        }

        uint256 agentId = getAgentIdForAddress(msg.sender);

        apps.push(
            BountyApplication({
                applicant: msg.sender,
                agentId: agentId,
                proposalUri: proposalUri,
                estimatedDuration: estimatedDuration,
                status: ApplicationStatus.PENDING,
                appliedAt: block.timestamp
            })
        );

        emit ApplicationSubmitted(bountyId, msg.sender, agentId);
    }

    /**
     * @notice Accept an application
     * @param bountyId Bounty ID
     * @param applicantIndex Index of application to accept
     */
    function acceptApplication(bytes32 bountyId, uint256 applicantIndex)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyBountyCreator(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.OPEN) revert BountyNotOpen();

        BountyApplication[] storage apps = applications[bountyId];
        if (applicantIndex >= apps.length) revert ApplicationNotFound();

        BountyApplication storage app = apps[applicantIndex];
        app.status = ApplicationStatus.ACCEPTED;

        // Reject other applications
        for (uint256 i = 0; i < apps.length; i++) {
            if (i != applicantIndex && apps[i].status == ApplicationStatus.PENDING) {
                apps[i].status = ApplicationStatus.REJECTED;
            }
        }

        bounty.assignee = app.applicant;
        bounty.assigneeAgentId = app.agentId;
        bounty.status = BountyStatus.IN_PROGRESS;
        milestones[bountyId][0].status = MilestoneStatus.IN_PROGRESS;

        emit ApplicationAccepted(bountyId, app.applicant);
    }

    // ============ Milestone Submission & Validation ============

    /**
     * @notice Submit work for current milestone
     * @param bountyId Bounty ID
     * @param deliverableUri IPFS URI of deliverables
     */
    function submitMilestone(bytes32 bountyId, string calldata deliverableUri)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyAssignee(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.IN_PROGRESS) revert BountyNotInProgress();

        uint256 currentIdx = bounty.currentMilestone;
        Milestone storage milestone = milestones[bountyId][currentIdx];

        if (milestone.status != MilestoneStatus.IN_PROGRESS && milestone.status != MilestoneStatus.REJECTED) {
            revert InvalidMilestone();
        }

        milestone.deliverableUri = deliverableUri;
        milestone.submittedAt = block.timestamp;
        milestone.status = MilestoneStatus.SUBMITTED;
        bounty.status = BountyStatus.REVIEW;

        emit MilestoneSubmitted(bountyId, currentIdx, deliverableUri);
    }

    /**
     * @notice Validator votes on milestone submission
     * @param bountyId Bounty ID
     * @param approved Whether to approve
     * @param reasonUri IPFS URI for validation notes
     */
    function validateMilestone(bytes32 bountyId, bool approved, string calldata reasonUri)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyValidator
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.REVIEW) revert BountyNotInProgress();

        uint256 currentIdx = bounty.currentMilestone;
        Milestone storage milestone = milestones[bountyId][currentIdx];
        if (milestone.status != MilestoneStatus.SUBMITTED) revert MilestoneNotSubmitted();

        // Check if already voted
        if (validatorVotes[bountyId][currentIdx][msg.sender].votedAt != 0) {
            revert AlreadyVoted();
        }

        // Record vote
        validatorVotes[bountyId][currentIdx][msg.sender] =
            ValidatorVote({approved: approved, reasonUri: reasonUri, votedAt: block.timestamp});
        milestoneValidators[bountyId][currentIdx].push(msg.sender);

        emit ValidatorVoted(bountyId, currentIdx, msg.sender, approved);

        // Check if quorum reached
        _checkValidationQuorum(bountyId, currentIdx);
    }

    /**
     * @notice Creator can directly approve milestone (fallback if no validators)
     */
    function creatorApproveMilestone(bytes32 bountyId)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyBountyCreator(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.REVIEW) revert BountyNotInProgress();

        uint256 currentIdx = bounty.currentMilestone;
        Milestone storage milestone = milestones[bountyId][currentIdx];
        if (milestone.status != MilestoneStatus.SUBMITTED) revert MilestoneNotSubmitted();

        // Only allow if no validators or not enough validators
        if (milestoneValidators[bountyId][currentIdx].length >= MIN_VALIDATORS) {
            revert QuorumNotReached(); // Use validator system
        }

        _approveMilestone(bountyId, currentIdx);
    }

    /**
     * @notice Creator can reject milestone
     */
    function creatorRejectMilestone(bytes32 bountyId, string calldata reason)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyBountyCreator(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.REVIEW) revert BountyNotInProgress();

        uint256 currentIdx = bounty.currentMilestone;
        Milestone storage milestone = milestones[bountyId][currentIdx];
        if (milestone.status != MilestoneStatus.SUBMITTED) revert MilestoneNotSubmitted();

        milestone.status = MilestoneStatus.REJECTED;
        bounty.status = BountyStatus.IN_PROGRESS;

        emit MilestoneRejected(bountyId, currentIdx, reason);
    }

    /**
     * @notice Assignee disputes a rejection
     */
    function disputeMilestone(bytes32 bountyId, string calldata reason, bytes32 evidenceHash)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyAssignee(bountyId)
    {
        Bounty storage bounty = bounties[bountyId];
        uint256 currentIdx = bounty.currentMilestone;
        Milestone storage milestone = milestones[bountyId][currentIdx];

        if (milestone.status != MilestoneStatus.REJECTED) revert InvalidMilestone();
        if (block.timestamp > milestone.submittedAt + DISPUTE_PERIOD) revert DisputePeriodExpired();

        // Open case in ModerationMarketplace
        if (address(moderationMarketplace) != address(0)) {
            bytes32 caseId = moderationMarketplace.openCase(bounty.creator, reason, evidenceHash, "", "DISPUTE");
            bounty.disputeCaseId = caseId;
        }

        milestone.status = MilestoneStatus.DISPUTED;
        bounty.status = BountyStatus.DISPUTED;

        emit BountyDisputed(bountyId, bounty.disputeCaseId);
    }

    // ============ Validator Management ============

    /**
     * @notice Register as a validator (must have staked ERC-8004 agent)
     */
    function registerAsValidator() external nonReentrant {
        uint256 agentId = getAgentIdForAddress(msg.sender);
        if (agentId == 0) revert NotValidator();

        // Check agent has sufficient stake
        IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        if (agent.stakedAmount < minValidatorStake) revert InsufficientStake();
        if (agent.isBanned) revert NotValidator();

        if (!isValidator[agentId]) {
            isValidator[agentId] = true;
            validatorAgentIds.push(agentId);
            emit ValidatorRegistered(agentId, msg.sender);
        }
    }

    /**
     * @notice Remove validator status (governance only)
     */
    function removeValidator(uint256 agentId) external onlyOwner {
        if (!isValidator[agentId]) revert NotValidator();
        isValidator[agentId] = false;

        // Remove from array
        for (uint256 i = 0; i < validatorAgentIds.length; i++) {
            if (validatorAgentIds[i] == agentId) {
                validatorAgentIds[i] = validatorAgentIds[validatorAgentIds.length - 1];
                validatorAgentIds.pop();
                break;
            }
        }

        emit ValidatorRemoved(agentId);
    }

    // ============ Internal Functions ============

    function _checkValidationQuorum(bytes32 bountyId, uint256 milestoneIndex) internal {
        address[] storage validators = milestoneValidators[bountyId][milestoneIndex];
        if (validators.length < MIN_VALIDATORS) return;

        uint256 approvals;
        for (uint256 i = 0; i < validators.length; i++) {
            if (validatorVotes[bountyId][milestoneIndex][validators[i]].approved) {
                approvals++;
            }
        }

        uint256 quorumNeeded = (validators.length * VALIDATOR_QUORUM_BPS) / 10000;

        if (approvals >= quorumNeeded) {
            _approveMilestone(bountyId, milestoneIndex);
        } else if (validators.length - approvals > validators.length - quorumNeeded) {
            // Rejection is certain - enough rejections
            Milestone storage milestone = milestones[bountyId][milestoneIndex];
            milestone.status = MilestoneStatus.REJECTED;
            bounties[bountyId].status = BountyStatus.IN_PROGRESS;
            emit MilestoneRejected(bountyId, milestoneIndex, "Validator consensus: rejected");
        }
    }

    function _approveMilestone(bytes32 bountyId, uint256 milestoneIndex) internal {
        Bounty storage bounty = bounties[bountyId];
        Milestone storage milestone = milestones[bountyId][milestoneIndex];

        milestone.status = MilestoneStatus.APPROVED;
        milestone.approvedAt = block.timestamp;

        // Calculate payout for this milestone
        uint256 payout = _calculateMilestonePayout(bountyId, milestoneIndex);

        // Pay assignee (minus fees)
        uint256 validatorFee = (payout * VALIDATOR_FEE_BPS) / 10000;
        uint256 protocolFee = (payout * PROTOCOL_FEE_BPS) / 10000;
        uint256 assigneePayout = payout - validatorFee - protocolFee;

        // Transfer to assignee
        for (uint256 i = 0; i < bounty.rewards.length; i++) {
            uint256 tokenPayout = (bounty.rewards[i].amount * milestone.percentage) / 10000;
            uint256 tokenValidatorFee = (tokenPayout * VALIDATOR_FEE_BPS) / 10000;
            uint256 tokenProtocolFee = (tokenPayout * PROTOCOL_FEE_BPS) / 10000;
            uint256 tokenAssigneePayout = tokenPayout - tokenValidatorFee - tokenProtocolFee;

            _transferTokens(bounty.rewards[i].token, bounty.assignee, tokenAssigneePayout);
            _transferTokens(bounty.rewards[i].token, validatorPool, tokenValidatorFee);
            _transferTokens(bounty.rewards[i].token, treasury, tokenProtocolFee);
        }

        emit MilestoneApproved(bountyId, milestoneIndex, assigneePayout);

        // Move to next milestone or complete
        if (milestoneIndex + 1 >= milestones[bountyId].length) {
            _completeBounty(bountyId);
        } else {
            bounty.currentMilestone = milestoneIndex + 1;
            milestones[bountyId][milestoneIndex + 1].status = MilestoneStatus.IN_PROGRESS;
            bounty.status = BountyStatus.IN_PROGRESS;
        }
    }

    function _completeBounty(bytes32 bountyId) internal {
        Bounty storage bounty = bounties[bountyId];
        bounty.status = BountyStatus.COMPLETED;
        bounty.completedAt = block.timestamp;

        // Return creator stake
        _transferTokens(bounty.creatorStake.token, bounty.creator, bounty.creatorStake.amount);

        uint256 totalPaid;
        for (uint256 i = 0; i < bounty.rewards.length; i++) {
            totalPaid += bounty.rewards[i].amount;
        }

        emit BountyCompleted(bountyId, bounty.assignee, totalPaid);
    }

    function _calculateMilestonePayout(bytes32 bountyId, uint256 milestoneIndex) internal view returns (uint256) {
        Bounty storage bounty = bounties[bountyId];
        Milestone storage milestone = milestones[bountyId][milestoneIndex];

        if (bounty.rewards.length == 0) return 0;
        return (bounty.rewards[0].amount * milestone.percentage) / 10000;
    }

    function _transferTokens(address token, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ============ View Functions ============

    function getAgentIdForAddress(address addr) public view returns (uint256) {
        // This would need to be implemented via events/indexer in production
        // For now, return 0 (no agent)
        return 0;
    }

    function getBounty(bytes32 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function getMilestones(bytes32 bountyId) external view returns (Milestone[] memory) {
        return milestones[bountyId];
    }

    function getApplications(bytes32 bountyId) external view returns (BountyApplication[] memory) {
        return applications[bountyId];
    }

    function getValidatorCount() external view returns (uint256) {
        return validatorAgentIds.length;
    }

    function getMilestoneVotes(bytes32 bountyId, uint256 milestoneIndex)
        external
        view
        returns (address[] memory validators, bool[] memory approvals)
    {
        validators = milestoneValidators[bountyId][milestoneIndex];
        approvals = new bool[](validators.length);

        for (uint256 i = 0; i < validators.length; i++) {
            approvals[i] = validatorVotes[bountyId][milestoneIndex][validators[i]].approved;
        }
    }

    // ============ Admin Functions ============

    function setModerationMarketplace(address payable _moderationMarketplace) external onlyOwner {
        moderationMarketplace = ModerationMarketplace(_moderationMarketplace);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setValidatorPool(address _validatorPool) external onlyOwner {
        validatorPool = _validatorPool;
    }

    function setMinValidatorStake(uint256 _minStake) external onlyOwner {
        minValidatorStake = _minStake;
    }

    function whitelistToken(address token, bool whitelisted) external onlyOwner {
        if (whitelisted && !whitelistedTokens[token]) {
            tokenList.push(token);
        }
        whitelistedTokens[token] = whitelisted;
        emit TokenWhitelisted(token, whitelisted);
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
