// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDAORegistry} from "../governance/interfaces/IDAORegistry.sol";

/**
 * @title PaymentRequestRegistry
 * @author Jeju Network
 * @notice Registry for non-bounty payment requests (marketing, ops, community, etc.)
 * @dev Supports retroactive funding with supermajority council approval
 *
 * Key Features:
 * - Multiple payment categories for non-technical work
 * - Council review with supermajority requirement
 * - CEO can approve/modify for amounts below threshold
 * - Dispute escalation to futarchy markets
 * - Retroactive funding support with strong evidence requirements
 * - Payments in DAO treasury tokens (own token preferred)
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract PaymentRequestRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum PaymentCategory {
        MARKETING,
        COMMUNITY_MANAGEMENT,
        OPERATIONS,
        DOCUMENTATION,
        DESIGN,
        SUPPORT,
        RESEARCH,
        PARTNERSHIP,
        EVENTS,
        INFRASTRUCTURE,
        OTHER
    }

    enum PaymentRequestStatus {
        SUBMITTED,
        COUNCIL_REVIEW,
        CEO_REVIEW,
        APPROVED,
        REJECTED,
        PAID,
        DISPUTED,
        CANCELLED
    }

    enum VoteType {
        APPROVE,
        REJECT,
        ABSTAIN
    }

    // ============ Structs ============

    struct PaymentRequest {
        bytes32 requestId;
        bytes32 daoId;
        address requester;
        bytes32 contributorId; // From ContributorRegistry
        PaymentCategory category;
        string title;
        string description;
        string evidenceUri; // IPFS URI with work evidence
        address paymentToken; // address(0) for native token
        uint256 requestedAmount;
        uint256 approvedAmount; // May differ from requested
        PaymentRequestStatus status;
        bool isRetroactive; // Retroactive funding request
        uint256 workStartDate; // When work started (for retroactive)
        uint256 workEndDate; // When work ended (for retroactive)
        uint256 submittedAt;
        uint256 reviewedAt;
        uint256 paidAt;
        string rejectionReason;
        bytes32 disputeCaseId; // Futarchy case if disputed
    }

    struct CouncilVote {
        address voter;
        VoteType vote;
        string reason;
        uint256 votedAt;
    }

    struct CEODecision {
        bool approved;
        uint256 modifiedAmount;
        string reason;
        uint256 decidedAt;
    }

    struct DAOPaymentConfig {
        bool requiresCouncilApproval;
        uint256 minCouncilVotes;
        uint256 councilSupermajorityBps; // e.g., 6700 = 67% supermajority
        bool ceoCanOverride;
        uint256 maxAutoApproveAmount; // CEO can auto-approve below this
        uint256 reviewPeriod; // Time for council review
        uint256 disputePeriod; // Time to file dispute after rejection
        address treasuryToken; // Preferred payment token
        bool allowRetroactive;
        uint256 retroactiveMaxAge; // Max age for retroactive claims
    }

    // ============ Constants ============

    uint256 public constant DEFAULT_SUPERMAJORITY_BPS = 6700; // 67%
    uint256 public constant DEFAULT_REVIEW_PERIOD = 7 days;
    uint256 public constant DEFAULT_DISPUTE_PERIOD = 3 days;
    uint256 public constant DEFAULT_RETROACTIVE_MAX_AGE = 90 days;

    // ============ State ============

    IDAORegistry public daoRegistry;
    address public futarchyContract; // For dispute escalation

    mapping(bytes32 => PaymentRequest) private _requests;
    mapping(bytes32 => CouncilVote[]) private _councilVotes;
    mapping(bytes32 => CEODecision) private _ceoDecisions;
    mapping(bytes32 => mapping(address => bool)) private _hasVoted;

    mapping(bytes32 => bytes32[]) private _daoRequests;
    mapping(address => bytes32[]) private _requesterRequests;
    mapping(bytes32 => bytes32[]) private _contributorRequests;

    mapping(bytes32 => DAOPaymentConfig) private _daoConfigs;

    bytes32[] private _allRequestIds;
    uint256 private _nextRequestNonce = 1;

    // ============ Events ============

    event PaymentRequestSubmitted(
        bytes32 indexed requestId,
        bytes32 indexed daoId,
        address indexed requester,
        PaymentCategory category,
        uint256 amount,
        bool isRetroactive
    );

    event PaymentRequestUpdated(bytes32 indexed requestId, string evidenceUri);

    event CouncilVoteCast(
        bytes32 indexed requestId,
        address indexed voter,
        VoteType vote
    );

    event CEODecisionMade(
        bytes32 indexed requestId,
        bool approved,
        uint256 modifiedAmount
    );

    event PaymentRequestApproved(
        bytes32 indexed requestId,
        uint256 approvedAmount
    );

    event PaymentRequestRejected(
        bytes32 indexed requestId,
        string reason
    );

    event PaymentRequestPaid(
        bytes32 indexed requestId,
        uint256 amount,
        address token
    );

    event PaymentRequestDisputed(
        bytes32 indexed requestId,
        bytes32 indexed caseId
    );

    event PaymentRequestCancelled(bytes32 indexed requestId);

    event DAOConfigUpdated(bytes32 indexed daoId);

    // ============ Errors ============

    error RequestNotFound();
    error NotRequester();
    error InvalidAmount();
    error InvalidEvidence();
    error DAONotActive();
    error NotCouncilMember();
    error AlreadyVoted();
    error NotCEO();
    error RequestNotInReview();
    error ReviewPeriodNotEnded();
    error DisputePeriodExpired();
    error AlreadyPaid();
    error AlreadyDisputed();
    error TransferFailed();
    error RetroactiveNotAllowed();
    error RetroactiveTooOld();
    error InsufficientEvidence();
    error SupermajorityNotReached();
    error RequestNotApproved();
    error NotAuthorized();

    // ============ Modifiers ============

    modifier onlyRequester(bytes32 requestId) {
        if (_requests[requestId].requester != msg.sender) revert NotRequester();
        _;
    }

    modifier requestExists(bytes32 requestId) {
        if (_requests[requestId].submittedAt == 0) revert RequestNotFound();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _daoRegistry,
        address _futarchyContract,
        address _owner
    ) Ownable(_owner) {
        daoRegistry = IDAORegistry(_daoRegistry);
        futarchyContract = _futarchyContract;
    }

    // ============ Submission ============

    /**
     * @notice Submit a payment request
     */
    function submitRequest(
        bytes32 daoId,
        bytes32 contributorId,
        PaymentCategory category,
        string calldata title,
        string calldata description,
        string calldata evidenceUri,
        uint256 requestedAmount,
        bool isRetroactive,
        uint256 workStartDate,
        uint256 workEndDate
    ) external whenNotPaused nonReentrant returns (bytes32 requestId) {
        IDAORegistry.DAO memory dao = daoRegistry.getDAO(daoId);
        if (dao.status != IDAORegistry.DAOStatus.ACTIVE) revert DAONotActive();
        if (requestedAmount == 0) revert InvalidAmount();
        if (bytes(evidenceUri).length == 0) revert InvalidEvidence();

        DAOPaymentConfig memory config = _getConfig(daoId);

        if (isRetroactive) {
            if (!config.allowRetroactive) revert RetroactiveNotAllowed();
            if (block.timestamp - workEndDate > config.retroactiveMaxAge) {
                revert RetroactiveTooOld();
            }
        }

        requestId = keccak256(
            abi.encodePacked(daoId, msg.sender, block.timestamp, _nextRequestNonce++)
        );

        _requests[requestId] = PaymentRequest({
            requestId: requestId,
            daoId: daoId,
            requester: msg.sender,
            contributorId: contributorId,
            category: category,
            title: title,
            description: description,
            evidenceUri: evidenceUri,
            paymentToken: config.treasuryToken,
            requestedAmount: requestedAmount,
            approvedAmount: 0,
            status: PaymentRequestStatus.SUBMITTED,
            isRetroactive: isRetroactive,
            workStartDate: workStartDate,
            workEndDate: workEndDate,
            submittedAt: block.timestamp,
            reviewedAt: 0,
            paidAt: 0,
            rejectionReason: "",
            disputeCaseId: bytes32(0)
        });

        _daoRequests[daoId].push(requestId);
        _requesterRequests[msg.sender].push(requestId);
        if (contributorId != bytes32(0)) {
            _contributorRequests[contributorId].push(requestId);
        }
        _allRequestIds.push(requestId);

        // Determine initial status
        if (config.requiresCouncilApproval || isRetroactive) {
            _requests[requestId].status = PaymentRequestStatus.COUNCIL_REVIEW;
        } else if (requestedAmount <= config.maxAutoApproveAmount) {
            _requests[requestId].status = PaymentRequestStatus.CEO_REVIEW;
        } else {
            _requests[requestId].status = PaymentRequestStatus.COUNCIL_REVIEW;
        }

        emit PaymentRequestSubmitted(
            requestId,
            daoId,
            msg.sender,
            category,
            requestedAmount,
            isRetroactive
        );
    }

    /**
     * @notice Update evidence for a pending request
     */
    function updateEvidence(
        bytes32 requestId,
        string calldata evidenceUri
    ) external onlyRequester(requestId) requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        if (req.status == PaymentRequestStatus.PAID ||
            req.status == PaymentRequestStatus.CANCELLED) {
            revert RequestNotInReview();
        }

        req.evidenceUri = evidenceUri;

        emit PaymentRequestUpdated(requestId, evidenceUri);
    }

    /**
     * @notice Cancel a request (only before approval)
     */
    function cancelRequest(
        bytes32 requestId
    ) external onlyRequester(requestId) requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        if (req.status == PaymentRequestStatus.PAID ||
            req.status == PaymentRequestStatus.APPROVED) {
            revert RequestNotInReview();
        }

        req.status = PaymentRequestStatus.CANCELLED;

        emit PaymentRequestCancelled(requestId);
    }

    // ============ Council Review ============

    /**
     * @notice Cast a council vote on a payment request
     */
    function councilVote(
        bytes32 requestId,
        VoteType vote,
        string calldata reason
    ) external requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        if (req.status != PaymentRequestStatus.COUNCIL_REVIEW) {
            revert RequestNotInReview();
        }

        // Verify caller is council member
        if (!daoRegistry.isCouncilMember(req.daoId, msg.sender)) {
            revert NotCouncilMember();
        }

        if (_hasVoted[requestId][msg.sender]) revert AlreadyVoted();

        _councilVotes[requestId].push(CouncilVote({
            voter: msg.sender,
            vote: vote,
            reason: reason,
            votedAt: block.timestamp
        }));

        _hasVoted[requestId][msg.sender] = true;

        emit CouncilVoteCast(requestId, msg.sender, vote);

        // Check if we have enough votes for decision
        _checkCouncilQuorum(requestId);
    }

    /**
     * @notice Check if council has reached quorum and process result
     */
    function _checkCouncilQuorum(bytes32 requestId) internal {
        PaymentRequest storage req = _requests[requestId];
        DAOPaymentConfig memory config = _getConfig(req.daoId);
        CouncilVote[] storage votes = _councilVotes[requestId];

        if (votes.length < config.minCouncilVotes) return;

        uint256 approveCount = 0;
        uint256 rejectCount = 0;
        uint256 totalVotes = 0;

        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i].vote == VoteType.APPROVE) {
                approveCount++;
                totalVotes++;
            } else if (votes[i].vote == VoteType.REJECT) {
                rejectCount++;
                totalVotes++;
            }
            // Abstains don't count toward quorum
        }

        uint256 supermajorityThreshold = (totalVotes * config.councilSupermajorityBps) / 10000;

        if (approveCount > supermajorityThreshold) {
            // Supermajority approved
            if (req.isRetroactive) {
                // Retroactive needs CEO sign-off
                req.status = PaymentRequestStatus.CEO_REVIEW;
            } else {
                req.status = PaymentRequestStatus.APPROVED;
                req.approvedAmount = req.requestedAmount;
                req.reviewedAt = block.timestamp;
                emit PaymentRequestApproved(requestId, req.approvedAmount);
            }
        } else if (rejectCount > supermajorityThreshold) {
            // Supermajority rejected
            req.status = PaymentRequestStatus.REJECTED;
            req.reviewedAt = block.timestamp;
            req.rejectionReason = "Council supermajority rejected";
            emit PaymentRequestRejected(requestId, req.rejectionReason);
        }
        // Otherwise, more votes needed or escalate to CEO
    }

    /**
     * @notice Force escalation to CEO after review period
     */
    function escalateToCEO(bytes32 requestId) external requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        DAOPaymentConfig memory config = _getConfig(req.daoId);

        if (req.status != PaymentRequestStatus.COUNCIL_REVIEW) {
            revert RequestNotInReview();
        }

        if (block.timestamp < req.submittedAt + config.reviewPeriod) {
            revert ReviewPeriodNotEnded();
        }

        // No supermajority reached, escalate to CEO
        req.status = PaymentRequestStatus.CEO_REVIEW;
    }

    // ============ CEO Review ============

    /**
     * @notice CEO makes decision on payment request
     */
    function ceoDecision(
        bytes32 requestId,
        bool approved,
        uint256 modifiedAmount,
        string calldata reason
    ) external requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        IDAORegistry.DAO memory dao = daoRegistry.getDAO(req.daoId);

        // Verify caller is CEO agent or DAO admin
        if (msg.sender != dao.ceoAgent && !daoRegistry.isDAOAdmin(req.daoId, msg.sender)) {
            revert NotCEO();
        }

        if (req.status != PaymentRequestStatus.CEO_REVIEW) {
            revert RequestNotInReview();
        }

        _ceoDecisions[requestId] = CEODecision({
            approved: approved,
            modifiedAmount: modifiedAmount,
            reason: reason,
            decidedAt: block.timestamp
        });

        if (approved) {
            req.status = PaymentRequestStatus.APPROVED;
            req.approvedAmount = modifiedAmount > 0 ? modifiedAmount : req.requestedAmount;
            emit PaymentRequestApproved(requestId, req.approvedAmount);
        } else {
            req.status = PaymentRequestStatus.REJECTED;
            req.rejectionReason = reason;
            emit PaymentRequestRejected(requestId, reason);
        }

        req.reviewedAt = block.timestamp;

        emit CEODecisionMade(requestId, approved, modifiedAmount);
    }

    // ============ Dispute ============

    /**
     * @notice File a dispute after rejection
     */
    function fileDispute(
        bytes32 requestId,
        string calldata evidenceUri
    ) external onlyRequester(requestId) requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];
        DAOPaymentConfig memory config = _getConfig(req.daoId);

        if (req.status != PaymentRequestStatus.REJECTED) {
            revert RequestNotInReview();
        }

        if (block.timestamp > req.reviewedAt + config.disputePeriod) {
            revert DisputePeriodExpired();
        }

        if (req.disputeCaseId != bytes32(0)) revert AlreadyDisputed();

        // Create futarchy case (integration with futarchy contract)
        // For now, just mark as disputed
        req.status = PaymentRequestStatus.DISPUTED;
        req.disputeCaseId = keccak256(abi.encodePacked(requestId, block.timestamp));

        emit PaymentRequestDisputed(requestId, req.disputeCaseId);
    }

    /**
     * @notice Resolve dispute (called by futarchy contract)
     */
    function resolveDispute(
        bytes32 requestId,
        bool inFavorOfRequester,
        uint256 awardedAmount
    ) external {
        // Only futarchy contract can resolve
        if (msg.sender != futarchyContract && msg.sender != owner()) {
            revert NotAuthorized();
        }

        PaymentRequest storage req = _requests[requestId];
        if (req.status != PaymentRequestStatus.DISPUTED) {
            revert RequestNotInReview();
        }

        if (inFavorOfRequester) {
            req.status = PaymentRequestStatus.APPROVED;
            req.approvedAmount = awardedAmount;
            emit PaymentRequestApproved(requestId, awardedAmount);
        } else {
            req.status = PaymentRequestStatus.REJECTED;
            req.rejectionReason = "Dispute resolved against requester";
            emit PaymentRequestRejected(requestId, req.rejectionReason);
        }

        req.reviewedAt = block.timestamp;
    }

    // ============ Payment ============

    /**
     * @notice Execute payment for approved request
     */
    function executePayment(
        bytes32 requestId
    ) external nonReentrant requestExists(requestId) {
        PaymentRequest storage req = _requests[requestId];

        if (req.status != PaymentRequestStatus.APPROVED) {
            revert RequestNotApproved();
        }

        IDAORegistry.DAO memory dao = daoRegistry.getDAO(req.daoId);

        req.status = PaymentRequestStatus.PAID;
        req.paidAt = block.timestamp;

        // Transfer from treasury
        if (req.paymentToken == address(0)) {
            // Native token
            (bool success,) = req.requester.call{value: req.approvedAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20
            IERC20(req.paymentToken).safeTransferFrom(
                dao.treasury,
                req.requester,
                req.approvedAmount
            );
        }

        emit PaymentRequestPaid(requestId, req.approvedAmount, req.paymentToken);
    }

    // ============ Configuration ============

    /**
     * @notice Set payment configuration for a DAO
     */
    function setDAOConfig(
        bytes32 daoId,
        DAOPaymentConfig calldata config
    ) external {
        if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotAuthorized();

        _daoConfigs[daoId] = config;

        emit DAOConfigUpdated(daoId);
    }

    function _getConfig(bytes32 daoId) internal view returns (DAOPaymentConfig memory) {
        DAOPaymentConfig memory config = _daoConfigs[daoId];

        // Apply defaults if not configured
        if (config.councilSupermajorityBps == 0) {
            config.councilSupermajorityBps = DEFAULT_SUPERMAJORITY_BPS;
        }
        if (config.reviewPeriod == 0) {
            config.reviewPeriod = DEFAULT_REVIEW_PERIOD;
        }
        if (config.disputePeriod == 0) {
            config.disputePeriod = DEFAULT_DISPUTE_PERIOD;
        }
        if (config.retroactiveMaxAge == 0) {
            config.retroactiveMaxAge = DEFAULT_RETROACTIVE_MAX_AGE;
        }
        if (config.minCouncilVotes == 0) {
            config.minCouncilVotes = 3;
        }

        return config;
    }

    // ============ View Functions ============

    function getRequest(bytes32 requestId) external view returns (PaymentRequest memory) {
        return _requests[requestId];
    }

    function getCouncilVotes(bytes32 requestId) external view returns (CouncilVote[] memory) {
        return _councilVotes[requestId];
    }

    function getCEODecision(bytes32 requestId) external view returns (CEODecision memory) {
        return _ceoDecisions[requestId];
    }

    function getDAORequests(bytes32 daoId) external view returns (bytes32[] memory) {
        return _daoRequests[daoId];
    }

    function getRequesterRequests(address requester) external view returns (bytes32[] memory) {
        return _requesterRequests[requester];
    }

    function getContributorRequests(bytes32 contributorId) external view returns (bytes32[] memory) {
        return _contributorRequests[contributorId];
    }

    function getDAOConfig(bytes32 daoId) external view returns (DAOPaymentConfig memory) {
        return _getConfig(daoId);
    }

    function getPendingRequests(bytes32 daoId) external view returns (PaymentRequest[] memory) {
        bytes32[] memory requestIds = _daoRequests[daoId];
        uint256 pendingCount = 0;

        for (uint256 i = 0; i < requestIds.length; i++) {
            PaymentRequestStatus status = _requests[requestIds[i]].status;
            if (status == PaymentRequestStatus.SUBMITTED ||
                status == PaymentRequestStatus.COUNCIL_REVIEW ||
                status == PaymentRequestStatus.CEO_REVIEW) {
                pendingCount++;
            }
        }

        PaymentRequest[] memory pending = new PaymentRequest[](pendingCount);
        uint256 index = 0;

        for (uint256 i = 0; i < requestIds.length; i++) {
            PaymentRequestStatus status = _requests[requestIds[i]].status;
            if (status == PaymentRequestStatus.SUBMITTED ||
                status == PaymentRequestStatus.COUNCIL_REVIEW ||
                status == PaymentRequestStatus.CEO_REVIEW) {
                pending[index] = _requests[requestIds[i]];
                index++;
            }
        }

        return pending;
    }

    // ============ Admin Functions ============

    function setDAORegistry(address _daoRegistry) external onlyOwner {
        daoRegistry = IDAORegistry(_daoRegistry);
    }

    function setFutarchyContract(address _futarchyContract) external onlyOwner {
        futarchyContract = _futarchyContract;
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

