// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";
import "../registry/ReputationRegistry.sol";

/**
 * @title GuardianRegistry
 * @author Jeju Network
 * @notice Guardian network for code review, bounty validation, and PR assistance
 * @dev Guardians are staked ERC-8004 agents who can:
 *      - Auto-approve/reject PRs based on quality
 *      - Validate bounty submissions
 *      - Suggest improvements
 *      - Flag bad code or security issues
 *      - Earn rewards for successful validations
 *
 * Reputation affects capabilities:
 * - HIGH reputation: Can approve alone, reduced stake
 * - MEDIUM reputation: Needs quorum for approval
 * - LOW reputation: Can only flag, not approve
 * - Malicious guardians can be slashed and banned
 */
contract GuardianRegistry is ReentrancyGuard, Pausable, Ownable {
    // ============ Enums ============

    enum GuardianTier {
        NONE, // Not a guardian
        OBSERVER, // Can flag issues only
        REVIEWER, // Can review, needs quorum
        SENIOR, // Can approve alone for minor changes
        LEAD // Full authority, can override

    }

    enum ReviewAction {
        APPROVE,
        REQUEST_CHANGES,
        REJECT,
        FLAG_SECURITY,
        FLAG_QUALITY,
        SUGGEST_IMPROVEMENT
    }

    enum ReviewStatus {
        PENDING,
        APPROVED,
        REJECTED,
        NEEDS_CHANGES,
        FLAGGED
    }

    // ============ Structs ============

    struct Guardian {
        uint256 agentId; // ERC-8004 agent ID
        address owner;
        GuardianTier tier;
        uint256 stakedAmount;
        string[] specializations; // ["solidity", "typescript", "security", etc.]
        uint256 reviewsCompleted;
        uint256 reviewsApproved; // Successful reviews
        uint256 reviewsDisputed; // Reviews that were disputed and lost
        uint256 rewardsEarned;
        uint256 slashedAmount;
        uint256 registeredAt;
        uint256 lastActiveAt;
        bool isActive;
        bool isBanned;
    }

    struct Review {
        bytes32 reviewId;
        bytes32 subjectId; // PR ID, bounty ID, etc.
        string subjectType; // "pr", "bounty", "package", "model"
        address guardian;
        uint256 guardianAgentId;
        ReviewAction action;
        ReviewStatus status;
        string commentUri; // IPFS URI for review comments
        string[] suggestions;
        uint256 createdAt;
        uint256 resolvedAt;
        bool disputed;
        bytes32 disputeCaseId;
    }

    struct ReviewRequest {
        bytes32 requestId;
        bytes32 subjectId;
        string subjectType;
        address requester;
        string contentUri; // IPFS URI of content to review
        uint256 rewardAmount;
        address rewardToken;
        string[] requiredSpecializations;
        uint256 minGuardianTier;
        uint256 createdAt;
        uint256 deadline;
        bool completed;
        bytes32[] reviewIds;
    }

    // ============ Constants ============

    uint256 public constant MIN_STAKE_OBSERVER = 0.001 ether;
    uint256 public constant MIN_STAKE_REVIEWER = 0.01 ether;
    uint256 public constant MIN_STAKE_SENIOR = 0.05 ether;
    uint256 public constant MIN_STAKE_LEAD = 0.1 ether;

    uint256 public constant SLASH_PERCENTAGE_BPS = 2000; // 20% slash for bad reviews
    uint256 public constant REWARD_PERCENTAGE_BPS = 8000; // 80% of review reward to guardian

    uint256 public constant MIN_REVIEWS_FOR_SENIOR = 50;
    uint256 public constant MIN_APPROVAL_RATE_BPS = 8000; // 80% approval rate needed
    uint256 public constant REVIEW_QUORUM = 3; // Reviews needed for quorum

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    ReputationRegistry public reputationRegistry;
    address public treasury;

    mapping(uint256 => Guardian) public guardians; // agentId => Guardian
    mapping(address => uint256) public addressToAgent; // address => agentId
    mapping(bytes32 => Review) public reviews;
    mapping(bytes32 => ReviewRequest) public reviewRequests;
    mapping(bytes32 => mapping(address => bool)) public hasReviewed; // subjectId => guardian => reviewed

    // Specialization tracking
    mapping(string => uint256[]) public guardiansBySpecialization;
    string[] public allSpecializations;

    uint256[] public activeGuardians;
    uint256 private _nextReviewId = 1;
    uint256 private _nextRequestId = 1;

    // ============ Events ============

    event GuardianRegistered(uint256 indexed agentId, address indexed owner, GuardianTier tier);
    event GuardianUpgraded(uint256 indexed agentId, GuardianTier oldTier, GuardianTier newTier);
    event GuardianSlashed(uint256 indexed agentId, uint256 amount, string reason);
    event GuardianBanned(uint256 indexed agentId, string reason);
    event GuardianUnbanned(uint256 indexed agentId);

    event ReviewSubmitted(
        bytes32 indexed reviewId, bytes32 indexed subjectId, address indexed guardian, ReviewAction action
    );
    event ReviewDisputed(bytes32 indexed reviewId, bytes32 indexed disputeCaseId);
    event ReviewResolved(bytes32 indexed reviewId, ReviewStatus status);

    event ReviewRequestCreated(
        bytes32 indexed requestId, bytes32 indexed subjectId, string subjectType, uint256 reward
    );
    event ReviewRequestCompleted(bytes32 indexed requestId, ReviewStatus finalStatus);

    // ============ Errors ============

    error NotAgent();
    error NotGuardian();
    error InsufficientStake();
    error AlreadyRegistered();
    error InvalidTier();
    error AlreadyReviewed();
    error ReviewNotFound();
    error RequestNotFound();
    error DeadlinePassed();
    error GuardianBannedError();
    error CannotSelfReview();
    error InsufficientTier();

    // ============ Modifiers ============

    modifier onlyGuardian() {
        uint256 agentId = addressToAgent[msg.sender];
        if (agentId == 0 || !guardians[agentId].isActive) revert NotGuardian();
        if (guardians[agentId].isBanned) revert GuardianBannedError();
        _;
    }

    modifier guardianNotBanned(uint256 agentId) {
        if (guardians[agentId].isBanned) revert GuardianBannedError();
        _;
    }

    // ============ Constructor ============

    constructor(address _identityRegistry, address _treasury, address initialOwner) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
    }

    // ============ Registration ============

    /**
     * @notice Register as a guardian (must have ERC-8004 agent with stake)
     * @param agentId Your ERC-8004 agent ID
     * @param specializations Array of specialization tags
     */
    function registerGuardian(uint256 agentId, string[] calldata specializations)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        // Verify agent ownership
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (agentOwner != msg.sender) revert NotAgent();

        // Check not already registered
        if (guardians[agentId].registeredAt != 0) revert AlreadyRegistered();

        // Check agent not banned
        IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        if (agent.isBanned) revert GuardianBannedError();

        // Determine tier based on stake
        uint256 totalStake = agent.stakedAmount + msg.value;
        GuardianTier tier = _calculateTier(totalStake);
        if (tier == GuardianTier.NONE) revert InsufficientStake();

        // Create guardian
        Guardian storage guardian = guardians[agentId];
        guardian.agentId = agentId;
        guardian.owner = msg.sender;
        guardian.tier = tier;
        guardian.stakedAmount = totalStake;
        guardian.specializations = specializations;
        guardian.registeredAt = block.timestamp;
        guardian.lastActiveAt = block.timestamp;
        guardian.isActive = true;

        // Track by address
        addressToAgent[msg.sender] = agentId;
        activeGuardians.push(agentId);

        // Track by specialization
        for (uint256 i = 0; i < specializations.length; i++) {
            guardiansBySpecialization[specializations[i]].push(agentId);
            _addSpecialization(specializations[i]);
        }

        emit GuardianRegistered(agentId, msg.sender, tier);
    }

    /**
     * @notice Increase stake to upgrade tier
     */
    function increaseStake() external payable nonReentrant {
        uint256 agentId = addressToAgent[msg.sender];
        if (agentId == 0) revert NotGuardian();

        Guardian storage guardian = guardians[agentId];
        guardian.stakedAmount += msg.value;

        GuardianTier newTier = _calculateTier(guardian.stakedAmount);
        if (newTier > guardian.tier) {
            GuardianTier oldTier = guardian.tier;
            guardian.tier = newTier;
            emit GuardianUpgraded(agentId, oldTier, newTier);
        }
    }

    // ============ Reviews ============

    /**
     * @notice Submit a review for content
     * @param subjectId ID of the subject being reviewed
     * @param subjectType Type of subject ("pr", "bounty", "package", "model")
     * @param action Review action
     * @param commentUri IPFS URI for detailed comments
     * @param suggestions Array of improvement suggestions
     */
    function submitReview(
        bytes32 subjectId,
        string calldata subjectType,
        ReviewAction action,
        string calldata commentUri,
        string[] calldata suggestions
    ) external nonReentrant whenNotPaused onlyGuardian returns (bytes32 reviewId) {
        uint256 agentId = addressToAgent[msg.sender];
        Guardian storage guardian = guardians[agentId];

        // Check not already reviewed
        if (hasReviewed[subjectId][msg.sender]) revert AlreadyReviewed();

        // Check tier requirements for certain actions
        if (action == ReviewAction.APPROVE || action == ReviewAction.REJECT) {
            if (guardian.tier < GuardianTier.REVIEWER) revert InsufficientTier();
        }

        reviewId = keccak256(abi.encodePacked(_nextReviewId++, subjectId, msg.sender, block.timestamp));

        Review storage review = reviews[reviewId];
        review.reviewId = reviewId;
        review.subjectId = subjectId;
        review.subjectType = subjectType;
        review.guardian = msg.sender;
        review.guardianAgentId = agentId;
        review.action = action;
        review.status = ReviewStatus.PENDING;
        review.commentUri = commentUri;
        review.suggestions = suggestions;
        review.createdAt = block.timestamp;

        hasReviewed[subjectId][msg.sender] = true;
        guardian.reviewsCompleted++;
        guardian.lastActiveAt = block.timestamp;

        emit ReviewSubmitted(reviewId, subjectId, msg.sender, action);
    }

    /**
     * @notice Create a review request with reward
     */
    function createReviewRequest(
        bytes32 subjectId,
        string calldata subjectType,
        string calldata contentUri,
        string[] calldata requiredSpecializations,
        uint256 minTier,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (bytes32 requestId) {
        if (msg.value == 0) revert InsufficientStake();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        requestId = keccak256(abi.encodePacked(_nextRequestId++, subjectId, msg.sender, block.timestamp));

        ReviewRequest storage request = reviewRequests[requestId];
        request.requestId = requestId;
        request.subjectId = subjectId;
        request.subjectType = subjectType;
        request.requester = msg.sender;
        request.contentUri = contentUri;
        request.rewardAmount = msg.value;
        request.rewardToken = address(0); // ETH
        request.requiredSpecializations = requiredSpecializations;
        request.minGuardianTier = minTier;
        request.createdAt = block.timestamp;
        request.deadline = deadline;

        emit ReviewRequestCreated(requestId, subjectId, subjectType, msg.value);
    }

    /**
     * @notice Complete a review request and distribute rewards
     */
    function completeReviewRequest(bytes32 requestId, bytes32[] calldata reviewIds, ReviewStatus finalStatus)
        external
        nonReentrant
    {
        ReviewRequest storage request = reviewRequests[requestId];
        if (request.createdAt == 0) revert RequestNotFound();
        if (request.completed) revert RequestNotFound();
        if (msg.sender != request.requester && msg.sender != owner()) revert NotGuardian();

        request.completed = true;
        request.reviewIds = reviewIds;

        // Distribute rewards to reviewers
        if (reviewIds.length > 0 && request.rewardAmount > 0) {
            uint256 rewardPerReviewer = request.rewardAmount / reviewIds.length;
            uint256 guardianReward = (rewardPerReviewer * REWARD_PERCENTAGE_BPS) / 10000;
            uint256 protocolFee = rewardPerReviewer - guardianReward;

            for (uint256 i = 0; i < reviewIds.length; i++) {
                Review storage review = reviews[reviewIds[i]];
                review.status = finalStatus;
                review.resolvedAt = block.timestamp;

                Guardian storage guardian = guardians[review.guardianAgentId];
                guardian.rewardsEarned += guardianReward;

                // Transfer reward
                (bool success,) = review.guardian.call{value: guardianReward}("");
                if (success) {
                    guardian.reviewsApproved++;
                }
            }

            // Transfer protocol fee
            if (protocolFee > 0) {
                (bool success,) = treasury.call{value: protocolFee}("");
                require(success, "Treasury transfer failed");
            }
        }

        emit ReviewRequestCompleted(requestId, finalStatus);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a guardian for bad behavior (governance only)
     * @param agentId Guardian's agent ID
     * @param reason Reason for slashing
     */
    function slashGuardian(uint256 agentId, string calldata reason) external onlyOwner {
        Guardian storage guardian = guardians[agentId];
        if (!guardian.isActive) revert NotGuardian();

        uint256 slashAmount = (guardian.stakedAmount * SLASH_PERCENTAGE_BPS) / 10000;
        guardian.stakedAmount -= slashAmount;
        guardian.slashedAmount += slashAmount;
        guardian.reviewsDisputed++;

        // Transfer slashed amount to treasury
        (bool success,) = treasury.call{value: slashAmount}("");
        require(success, "Slash transfer failed");

        // Downgrade tier if needed
        GuardianTier newTier = _calculateTier(guardian.stakedAmount);
        if (newTier < guardian.tier) {
            guardian.tier = newTier;
        }

        emit GuardianSlashed(agentId, slashAmount, reason);
    }

    /**
     * @notice Ban a guardian (governance only)
     */
    function banGuardian(uint256 agentId, string calldata reason) external onlyOwner {
        Guardian storage guardian = guardians[agentId];
        guardian.isBanned = true;
        guardian.isActive = false;

        emit GuardianBanned(agentId, reason);
    }

    /**
     * @notice Unban a guardian (governance only)
     */
    function unbanGuardian(uint256 agentId) external onlyOwner {
        Guardian storage guardian = guardians[agentId];
        guardian.isBanned = false;
        guardian.isActive = true;

        emit GuardianUnbanned(agentId);
    }

    // ============ Internal Functions ============

    function _calculateTier(uint256 stake) internal pure returns (GuardianTier) {
        if (stake >= MIN_STAKE_LEAD) return GuardianTier.LEAD;
        if (stake >= MIN_STAKE_SENIOR) return GuardianTier.SENIOR;
        if (stake >= MIN_STAKE_REVIEWER) return GuardianTier.REVIEWER;
        if (stake >= MIN_STAKE_OBSERVER) return GuardianTier.OBSERVER;
        return GuardianTier.NONE;
    }

    function _addSpecialization(string memory spec) internal {
        for (uint256 i = 0; i < allSpecializations.length; i++) {
            if (keccak256(bytes(allSpecializations[i])) == keccak256(bytes(spec))) {
                return; // Already exists
            }
        }
        allSpecializations.push(spec);
    }

    // ============ View Functions ============

    function getGuardian(uint256 agentId) external view returns (Guardian memory) {
        return guardians[agentId];
    }

    function getGuardianByAddress(address addr) external view returns (Guardian memory) {
        uint256 agentId = addressToAgent[addr];
        return guardians[agentId];
    }

    function getReview(bytes32 reviewId) external view returns (Review memory) {
        return reviews[reviewId];
    }

    function getReviewRequest(bytes32 requestId) external view returns (ReviewRequest memory) {
        return reviewRequests[requestId];
    }

    function getActiveGuardianCount() external view returns (uint256) {
        return activeGuardians.length;
    }

    function getGuardiansBySpecialization(string calldata spec) external view returns (uint256[] memory) {
        return guardiansBySpecialization[spec];
    }

    function getAllSpecializations() external view returns (string[] memory) {
        return allSpecializations;
    }

    function getGuardianApprovalRate(uint256 agentId) external view returns (uint256) {
        Guardian storage guardian = guardians[agentId];
        if (guardian.reviewsCompleted == 0) return 0;
        return (guardian.reviewsApproved * 10000) / guardian.reviewsCompleted;
    }

    // ============ Admin ============

    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        reputationRegistry = ReputationRegistry(_reputationRegistry);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
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
