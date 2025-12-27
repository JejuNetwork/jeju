// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDAORegistry} from "../governance/interfaces/IDAORegistry.sol";

/**
 * @title WorkAgreementRegistry
 * @author Jeju Network
 * @notice Formal work agreements between contributors and DAOs with clear dispute paths
 * @dev Supports various agreement types with milestone-based or recurring payments
 *
 * Key Features:
 * - Full-time, part-time, contract, bounty-based, and retainer agreements
 * - Clear scope definition with IPFS-stored details
 * - Dispute escalation: Council (7 days) -> Futarchy market
 * - Linked bounties and payment requests
 * - Milestone tracking and payment schedules
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract WorkAgreementRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum AgreementType {
        FULL_TIME, // Ongoing full-time employment
        PART_TIME, // Ongoing part-time work
        CONTRACT, // Fixed-term contract
        BOUNTY_BASED, // Per-bounty work
        RETAINER // Monthly retainer

    }

    enum AgreementStatus {
        DRAFT,
        PENDING_SIGNATURE,
        ACTIVE,
        PAUSED,
        COMPLETED,
        TERMINATED,
        DISPUTED
    }

    enum DisputeStatus {
        NONE,
        COUNCIL_REVIEW,
        FUTARCHY_PENDING,
        RESOLVED
    }

    // ============ Structs ============

    struct TokenAmount {
        address token;
        uint256 amount;
    }

    struct Agreement {
        bytes32 agreementId;
        bytes32 daoId;
        address contributor;
        bytes32 contributorId; // From ContributorRegistry
        AgreementType agreementType;
        string title;
        string scopeUri; // IPFS URI with detailed scope
        TokenAmount compensation; // Per period or total
        uint256 paymentPeriod; // In seconds (0 = one-time)
        uint256 duration; // Total duration in seconds (0 = ongoing)
        uint256 startDate;
        uint256 endDate;
        AgreementStatus status;
        uint256 lastPaymentAt;
        uint256 totalPaid;
        uint256 paymentsCompleted;
        uint256 createdAt;
        uint256 signedAt;
    }

    struct Milestone {
        bytes32 milestoneId;
        bytes32 agreementId;
        string title;
        string description;
        uint256 dueDate;
        uint256 payment;
        bool completed;
        uint256 completedAt;
        string deliverableUri;
    }

    struct Dispute {
        bytes32 disputeId;
        bytes32 agreementId;
        address initiator;
        string reason;
        string evidenceUri;
        DisputeStatus status;
        uint256 councilDeadline;
        uint256 councilApprovals;
        uint256 councilRejections;
        bytes32 futarchyCaseId;
        uint256 createdAt;
        uint256 resolvedAt;
        bool inFavorOfContributor;
    }

    // ============ Constants ============

    uint256 public constant COUNCIL_REVIEW_PERIOD = 7 days;
    uint256 public constant MIN_COUNCIL_VOTES = 3;
    uint256 public constant SUPERMAJORITY_BPS = 6700; // 67%

    // ============ State ============

    IDAORegistry public daoRegistry;
    address public futarchyContract;
    address public contributorRegistry;

    mapping(bytes32 => Agreement) private _agreements;
    mapping(bytes32 => Milestone[]) private _milestones;
    mapping(bytes32 => bytes32[]) private _linkedBounties;
    mapping(bytes32 => bytes32[]) private _linkedPaymentRequests;

    mapping(bytes32 => Dispute) private _disputes;
    mapping(bytes32 => mapping(address => bool)) private _councilVoted;

    mapping(bytes32 => bytes32[]) private _daoAgreements;
    mapping(address => bytes32[]) private _contributorAgreements;

    bytes32[] private _allAgreementIds;
    uint256 private _nextNonce = 1;

    // ============ Events ============

    event AgreementCreated(
        bytes32 indexed agreementId, bytes32 indexed daoId, address indexed contributor, AgreementType agreementType
    );

    event AgreementSigned(bytes32 indexed agreementId, uint256 signedAt);
    event AgreementPaused(bytes32 indexed agreementId);
    event AgreementResumed(bytes32 indexed agreementId);
    event AgreementCompleted(bytes32 indexed agreementId);
    event AgreementTerminated(bytes32 indexed agreementId, string reason);

    event MilestoneAdded(bytes32 indexed agreementId, bytes32 indexed milestoneId, string title);

    event MilestoneCompleted(bytes32 indexed agreementId, bytes32 indexed milestoneId);

    event PaymentMade(bytes32 indexed agreementId, uint256 amount, address token);

    event DisputeRaised(bytes32 indexed disputeId, bytes32 indexed agreementId, address indexed initiator);

    event DisputeCouncilVote(bytes32 indexed disputeId, address indexed voter, bool inFavorOfContributor);

    event DisputeEscalated(bytes32 indexed disputeId, bytes32 indexed futarchyCaseId);

    event DisputeResolved(bytes32 indexed disputeId, bool inFavorOfContributor);

    event BountyLinked(bytes32 indexed agreementId, bytes32 indexed bountyId);
    event PaymentRequestLinked(bytes32 indexed agreementId, bytes32 indexed requestId);

    // ============ Errors ============

    error AgreementNotFound();
    error NotContributor();
    error NotDAOAdmin();
    error InvalidStatus();
    error AgreementNotActive();
    error MilestoneNotFound();
    error AlreadyCompleted();
    error PaymentNotDue();
    error TransferFailed();
    error DisputeExists();
    error DisputeNotFound();
    error NotDisputeParty();
    error NotCouncilMember();
    error AlreadyVoted();
    error CouncilPeriodNotEnded();
    error NotFutarchyContract();
    error InvalidDuration();

    // ============ Modifiers ============

    modifier agreementExists(bytes32 agreementId) {
        if (_agreements[agreementId].createdAt == 0) revert AgreementNotFound();
        _;
    }

    modifier onlyContributor(bytes32 agreementId) {
        if (_agreements[agreementId].contributor != msg.sender) revert NotContributor();
        _;
    }

    modifier onlyDAOAdmin(bytes32 daoId) {
        if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotDAOAdmin();
        _;
    }

    modifier onlyParty(bytes32 agreementId) {
        Agreement memory a = _agreements[agreementId];
        if (a.contributor != msg.sender && !daoRegistry.isDAOAdmin(a.daoId, msg.sender)) {
            revert NotDisputeParty();
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _daoRegistry, address _futarchyContract, address _contributorRegistry, address _owner)
        Ownable(_owner)
    {
        daoRegistry = IDAORegistry(_daoRegistry);
        futarchyContract = _futarchyContract;
        contributorRegistry = _contributorRegistry;
    }

    // ============ Agreement Creation ============

    /**
     * @notice Create a new work agreement (DAO initiates)
     */
    function createAgreement(
        bytes32 daoId,
        address contributor,
        bytes32 contributorId,
        AgreementType agreementType,
        string calldata title,
        string calldata scopeUri,
        address paymentToken,
        uint256 compensationAmount,
        uint256 paymentPeriod,
        uint256 duration,
        uint256 startDate
    ) external onlyDAOAdmin(daoId) whenNotPaused returns (bytes32 agreementId) {
        if (duration == 0 && agreementType == AgreementType.CONTRACT) {
            revert InvalidDuration();
        }

        agreementId = keccak256(abi.encodePacked(daoId, contributor, block.timestamp, _nextNonce++));

        _agreements[agreementId] = Agreement({
            agreementId: agreementId,
            daoId: daoId,
            contributor: contributor,
            contributorId: contributorId,
            agreementType: agreementType,
            title: title,
            scopeUri: scopeUri,
            compensation: TokenAmount({token: paymentToken, amount: compensationAmount}),
            paymentPeriod: paymentPeriod,
            duration: duration,
            startDate: startDate > 0 ? startDate : block.timestamp,
            endDate: duration > 0 ? (startDate > 0 ? startDate : block.timestamp) + duration : 0,
            status: AgreementStatus.PENDING_SIGNATURE,
            lastPaymentAt: 0,
            totalPaid: 0,
            paymentsCompleted: 0,
            createdAt: block.timestamp,
            signedAt: 0
        });

        _daoAgreements[daoId].push(agreementId);
        _contributorAgreements[contributor].push(agreementId);
        _allAgreementIds.push(agreementId);

        emit AgreementCreated(agreementId, daoId, contributor, agreementType);
    }

    /**
     * @notice Contributor signs the agreement
     */
    function signAgreement(bytes32 agreementId) external agreementExists(agreementId) onlyContributor(agreementId) {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.PENDING_SIGNATURE) revert InvalidStatus();

        a.status = AgreementStatus.ACTIVE;
        a.signedAt = block.timestamp;

        emit AgreementSigned(agreementId, block.timestamp);
    }

    /**
     * @notice Add a milestone to an agreement
     */
    function addMilestone(
        bytes32 agreementId,
        string calldata title,
        string calldata description,
        uint256 dueDate,
        uint256 payment
    ) external agreementExists(agreementId) returns (bytes32 milestoneId) {
        Agreement memory a = _agreements[agreementId];
        if (!daoRegistry.isDAOAdmin(a.daoId, msg.sender)) revert NotDAOAdmin();

        milestoneId = keccak256(abi.encodePacked(agreementId, _milestones[agreementId].length, block.timestamp));

        _milestones[agreementId].push(
            Milestone({
                milestoneId: milestoneId,
                agreementId: agreementId,
                title: title,
                description: description,
                dueDate: dueDate,
                payment: payment,
                completed: false,
                completedAt: 0,
                deliverableUri: ""
            })
        );

        emit MilestoneAdded(agreementId, milestoneId, title);
    }

    /**
     * @notice Complete a milestone
     */
    function completeMilestone(bytes32 agreementId, uint256 milestoneIndex, string calldata deliverableUri)
        external
        agreementExists(agreementId)
        onlyContributor(agreementId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.ACTIVE) revert AgreementNotActive();

        Milestone[] storage milestones = _milestones[agreementId];
        if (milestoneIndex >= milestones.length) revert MilestoneNotFound();
        if (milestones[milestoneIndex].completed) revert AlreadyCompleted();

        milestones[milestoneIndex].completed = true;
        milestones[milestoneIndex].completedAt = block.timestamp;
        milestones[milestoneIndex].deliverableUri = deliverableUri;

        emit MilestoneCompleted(agreementId, milestones[milestoneIndex].milestoneId);
    }

    /**
     * @notice Approve milestone and release payment
     */
    function approveMilestone(bytes32 agreementId, uint256 milestoneIndex)
        external
        nonReentrant
        agreementExists(agreementId)
    {
        Agreement storage a = _agreements[agreementId];
        if (!daoRegistry.isDAOAdmin(a.daoId, msg.sender)) revert NotDAOAdmin();

        Milestone storage milestone = _milestones[agreementId][milestoneIndex];
        if (!milestone.completed) revert MilestoneNotFound();

        IDAORegistry.DAO memory dao = daoRegistry.getDAO(a.daoId);

        // Transfer payment
        if (a.compensation.token == address(0)) {
            (bool success,) = a.contributor.call{value: milestone.payment}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(a.compensation.token).safeTransferFrom(dao.treasury, a.contributor, milestone.payment);
        }

        a.totalPaid += milestone.payment;
        a.paymentsCompleted++;

        emit PaymentMade(agreementId, milestone.payment, a.compensation.token);
    }

    // ============ Recurring Payments ============

    /**
     * @notice Process recurring payment for active agreement
     */
    function processPayment(bytes32 agreementId) external nonReentrant agreementExists(agreementId) {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.ACTIVE) revert AgreementNotActive();
        if (a.paymentPeriod == 0) revert PaymentNotDue();

        uint256 lastPayment = a.lastPaymentAt > 0 ? a.lastPaymentAt : a.startDate;
        if (block.timestamp < lastPayment + a.paymentPeriod) revert PaymentNotDue();

        // Check if agreement has ended
        if (a.endDate > 0 && block.timestamp > a.endDate) {
            a.status = AgreementStatus.COMPLETED;
            emit AgreementCompleted(agreementId);
            return;
        }

        IDAORegistry.DAO memory dao = daoRegistry.getDAO(a.daoId);

        // Transfer payment
        if (a.compensation.token == address(0)) {
            (bool success,) = a.contributor.call{value: a.compensation.amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(a.compensation.token).safeTransferFrom(dao.treasury, a.contributor, a.compensation.amount);
        }

        a.lastPaymentAt = block.timestamp;
        a.totalPaid += a.compensation.amount;
        a.paymentsCompleted++;

        emit PaymentMade(agreementId, a.compensation.amount, a.compensation.token);
    }

    // ============ Agreement Lifecycle ============

    /**
     * @notice Pause an agreement
     */
    function pauseAgreement(bytes32 agreementId)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.ACTIVE) revert InvalidStatus();

        a.status = AgreementStatus.PAUSED;
        emit AgreementPaused(agreementId);
    }

    /**
     * @notice Resume a paused agreement
     */
    function resumeAgreement(bytes32 agreementId)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.PAUSED) revert InvalidStatus();

        a.status = AgreementStatus.ACTIVE;
        emit AgreementResumed(agreementId);
    }

    /**
     * @notice Terminate an agreement
     */
    function terminateAgreement(bytes32 agreementId, string calldata reason)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status == AgreementStatus.COMPLETED || a.status == AgreementStatus.TERMINATED) {
            revert InvalidStatus();
        }

        a.status = AgreementStatus.TERMINATED;
        emit AgreementTerminated(agreementId, reason);
    }

    /**
     * @notice Complete an agreement
     */
    function completeAgreement(bytes32 agreementId)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status != AgreementStatus.ACTIVE) revert InvalidStatus();

        a.status = AgreementStatus.COMPLETED;
        emit AgreementCompleted(agreementId);
    }

    // ============ Linking ============

    /**
     * @notice Link a bounty to this agreement
     */
    function linkBounty(bytes32 agreementId, bytes32 bountyId)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        _linkedBounties[agreementId].push(bountyId);
        emit BountyLinked(agreementId, bountyId);
    }

    /**
     * @notice Link a payment request to this agreement
     */
    function linkPaymentRequest(bytes32 agreementId, bytes32 requestId)
        external
        agreementExists(agreementId)
        onlyDAOAdmin(_agreements[agreementId].daoId)
    {
        _linkedPaymentRequests[agreementId].push(requestId);
        emit PaymentRequestLinked(agreementId, requestId);
    }

    // ============ Disputes ============

    /**
     * @notice Raise a dispute on an agreement
     */
    function raiseDispute(bytes32 agreementId, string calldata reason, string calldata evidenceUri)
        external
        agreementExists(agreementId)
        onlyParty(agreementId)
        returns (bytes32 disputeId)
    {
        Agreement storage a = _agreements[agreementId];
        if (a.status == AgreementStatus.DISPUTED) revert DisputeExists();

        disputeId = keccak256(abi.encodePacked(agreementId, block.timestamp));

        _disputes[disputeId] = Dispute({
            disputeId: disputeId,
            agreementId: agreementId,
            initiator: msg.sender,
            reason: reason,
            evidenceUri: evidenceUri,
            status: DisputeStatus.COUNCIL_REVIEW,
            councilDeadline: block.timestamp + COUNCIL_REVIEW_PERIOD,
            councilApprovals: 0,
            councilRejections: 0,
            futarchyCaseId: bytes32(0),
            createdAt: block.timestamp,
            resolvedAt: 0,
            inFavorOfContributor: false
        });

        a.status = AgreementStatus.DISPUTED;

        emit DisputeRaised(disputeId, agreementId, msg.sender);
    }

    /**
     * @notice Council votes on dispute
     */
    function voteOnDispute(bytes32 disputeId, bool inFavorOfContributor) external {
        Dispute storage d = _disputes[disputeId];
        if (d.createdAt == 0) revert DisputeNotFound();
        if (d.status != DisputeStatus.COUNCIL_REVIEW) revert InvalidStatus();

        Agreement memory a = _agreements[d.agreementId];
        if (!daoRegistry.isCouncilMember(a.daoId, msg.sender)) revert NotCouncilMember();
        if (_councilVoted[disputeId][msg.sender]) revert AlreadyVoted();

        _councilVoted[disputeId][msg.sender] = true;

        if (inFavorOfContributor) {
            d.councilApprovals++;
        } else {
            d.councilRejections++;
        }

        emit DisputeCouncilVote(disputeId, msg.sender, inFavorOfContributor);

        // Check for supermajority
        _checkDisputeQuorum(disputeId);
    }

    function _checkDisputeQuorum(bytes32 disputeId) internal {
        Dispute storage d = _disputes[disputeId];
        uint256 totalVotes = d.councilApprovals + d.councilRejections;

        if (totalVotes < MIN_COUNCIL_VOTES) return;

        uint256 threshold = (totalVotes * SUPERMAJORITY_BPS) / 10000;

        if (d.councilApprovals > threshold) {
            // Supermajority in favor of contributor
            d.status = DisputeStatus.RESOLVED;
            d.resolvedAt = block.timestamp;
            d.inFavorOfContributor = true;

            _agreements[d.agreementId].status = AgreementStatus.ACTIVE;

            emit DisputeResolved(disputeId, true);
        } else if (d.councilRejections > threshold) {
            // Supermajority against contributor
            d.status = DisputeStatus.RESOLVED;
            d.resolvedAt = block.timestamp;
            d.inFavorOfContributor = false;

            emit DisputeResolved(disputeId, false);
        }
    }

    /**
     * @notice Escalate dispute to futarchy after council period
     */
    function escalateToFutarchy(bytes32 disputeId) external {
        Dispute storage d = _disputes[disputeId];
        if (d.createdAt == 0) revert DisputeNotFound();
        if (d.status != DisputeStatus.COUNCIL_REVIEW) revert InvalidStatus();
        if (block.timestamp < d.councilDeadline) revert CouncilPeriodNotEnded();

        // No supermajority reached, escalate to futarchy
        d.status = DisputeStatus.FUTARCHY_PENDING;
        d.futarchyCaseId = keccak256(abi.encodePacked(disputeId, "futarchy"));

        emit DisputeEscalated(disputeId, d.futarchyCaseId);
    }

    /**
     * @notice Resolve dispute from futarchy (called by futarchy contract)
     */
    function resolveFutarchyDispute(bytes32 disputeId, bool inFavorOfContributor) external {
        if (msg.sender != futarchyContract && msg.sender != owner()) {
            revert NotFutarchyContract();
        }

        Dispute storage d = _disputes[disputeId];
        if (d.status != DisputeStatus.FUTARCHY_PENDING) revert InvalidStatus();

        d.status = DisputeStatus.RESOLVED;
        d.resolvedAt = block.timestamp;
        d.inFavorOfContributor = inFavorOfContributor;

        if (inFavorOfContributor) {
            _agreements[d.agreementId].status = AgreementStatus.ACTIVE;
        } else {
            _agreements[d.agreementId].status = AgreementStatus.TERMINATED;
        }

        emit DisputeResolved(disputeId, inFavorOfContributor);
    }

    // ============ View Functions ============

    function getAgreement(bytes32 agreementId) external view returns (Agreement memory) {
        return _agreements[agreementId];
    }

    function getMilestones(bytes32 agreementId) external view returns (Milestone[] memory) {
        return _milestones[agreementId];
    }

    function getLinkedBounties(bytes32 agreementId) external view returns (bytes32[] memory) {
        return _linkedBounties[agreementId];
    }

    function getLinkedPaymentRequests(bytes32 agreementId) external view returns (bytes32[] memory) {
        return _linkedPaymentRequests[agreementId];
    }

    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return _disputes[disputeId];
    }

    function getDAOAgreements(bytes32 daoId) external view returns (bytes32[] memory) {
        return _daoAgreements[daoId];
    }

    function getContributorAgreements(address contributor) external view returns (bytes32[] memory) {
        return _contributorAgreements[contributor];
    }

    function getActiveAgreements(bytes32 daoId) external view returns (Agreement[] memory) {
        bytes32[] memory ids = _daoAgreements[daoId];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            if (_agreements[ids[i]].status == AgreementStatus.ACTIVE) {
                activeCount++;
            }
        }

        Agreement[] memory active = new Agreement[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            if (_agreements[ids[i]].status == AgreementStatus.ACTIVE) {
                active[index] = _agreements[ids[i]];
                index++;
            }
        }

        return active;
    }

    // ============ Admin Functions ============

    function setDAORegistry(address _daoRegistry) external onlyOwner {
        daoRegistry = IDAORegistry(_daoRegistry);
    }

    function setFutarchyContract(address _futarchyContract) external onlyOwner {
        futarchyContract = _futarchyContract;
    }

    function setContributorRegistry(address _contributorRegistry) external onlyOwner {
        contributorRegistry = _contributorRegistry;
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
