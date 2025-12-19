// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IdentityRegistry} from "../registry/IdentityRegistry.sol";
import {EvidenceRegistry} from "../moderation/EvidenceRegistry.sol";

/**
 * @title SecurityBountyRegistry
 * @author Jeju Network
 * @notice Decentralized bug bounty program for security vulnerability submissions
 * @dev Integrated with ERC-8004 for guardian validators and MPC KMS for encrypted reports
 *
 * Key Features:
 * - Encrypted vulnerability submissions (MPC-encrypted via off-chain KMS)
 * - Multi-stage validation: Automated sandbox → Guardian review → CEO decision
 * - Severity-based reward tiers: Critical ($25k-$50k), High ($10k-$25k), Medium ($2.5k-$10k), Low ($500-$2.5k)
 * - Stake-weighted priority (larger stakes get faster review)
 * - Guardian network (staked agents with reputation) for validation
 * - Disclosure timeline management
 */
contract SecurityBountyRegistry is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum Severity {
        LOW,        // $500-$2.5k - Minor bugs, theoretical issues
        MEDIUM,     // $2.5k-$10k - DoS, information disclosure
        HIGH,       // $10k-$25k - 51% attack, MPC exposure, privilege escalation
        CRITICAL    // $25k-$50k - RCE, wallet drain, TEE bypass
    }

    enum VulnerabilityType {
        FUNDS_AT_RISK,          // Direct loss of user funds
        WALLET_DRAIN,           // Unauthorized wallet access
        REMOTE_CODE_EXECUTION,  // RCE on infrastructure
        TEE_BYPASS,             // TEE/enclave manipulation
        CONSENSUS_ATTACK,       // 51% or consensus manipulation
        MPC_KEY_EXPOSURE,       // Key material leakage
        PRIVILEGE_ESCALATION,   // Unauthorized access elevation
        DENIAL_OF_SERVICE,      // Service disruption
        INFORMATION_DISCLOSURE, // Sensitive data exposure
        OTHER                   // Other security issues
    }

    enum SubmissionStatus {
        PENDING,            // Awaiting automated validation
        VALIDATING,         // Sandbox validation in progress
        GUARDIAN_REVIEW,    // Awaiting guardian votes
        CEO_REVIEW,         // Awaiting CEO decision
        APPROVED,           // Accepted and pending payout
        PAID,               // Reward paid
        REJECTED,           // Not valid or not severe enough
        DUPLICATE,          // Already reported
        DISPUTED,           // Under dispute
        WITHDRAWN           // Researcher withdrew
    }

    enum ValidationResult {
        PENDING,
        VERIFIED,           // Exploit confirmed working
        LIKELY_VALID,       // Code analysis suggests valid
        NEEDS_MORE_INFO,    // Researcher should provide more details
        INVALID,            // Not reproducible or not a vulnerability
        SANDBOX_ERROR       // Validation infrastructure issue
    }

    // ============ Structs ============

    struct VulnerabilitySubmission {
        bytes32 submissionId;
        address researcher;
        uint256 researcherAgentId;
        Severity severity;
        VulnerabilityType vulnType;
        bytes32 encryptedReportCid;     // IPFS CID of MPC-encrypted report
        bytes32 encryptionKeyId;         // MPC key ID for decryption
        bytes32 proofOfConceptHash;      // Hash of PoC code (stored encrypted)
        uint256 stake;                   // Researcher's stake (higher = priority)
        uint256 submittedAt;
        uint256 validatedAt;
        uint256 resolvedAt;
        SubmissionStatus status;
        ValidationResult validationResult;
        string validationNotes;
        uint256 rewardAmount;
        uint256 guardianApprovals;
        uint256 guardianRejections;
        bytes32 fixCommitHash;           // Git commit that fixes the issue
        uint256 disclosureDate;          // When public disclosure happens
        bool researcherDisclosed;        // Researcher chose to disclose
    }

    struct GuardianVote {
        address guardian;
        uint256 agentId;
        bool approved;
        uint256 suggestedReward;
        string feedback;
        uint256 votedAt;
    }

    struct SeverityConfig {
        uint256 minReward;
        uint256 maxReward;
        uint256 minGuardianApprovals;
        uint256 validationTimeout;
        uint256 reviewTimeout;
    }

    struct ValidationRequest {
        bytes32 submissionId;
        bytes32 sandboxJobId;
        uint256 requestedAt;
        uint256 completedAt;
        ValidationResult result;
        string executionLogs;
        uint256 computeCost;
    }

    // ============ Constants ============

    uint256 public constant MIN_STAKE = 0.001 ether;
    uint256 public constant PROTOCOL_FEE_BPS = 500;     // 5% protocol fee
    uint256 public constant GUARDIAN_FEE_BPS = 500;     // 5% to guardians
    uint256 public constant MAX_GUARDIANS_PER_REVIEW = 10;
    uint256 public constant DISCLOSURE_GRACE_PERIOD = 7 days;

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    EvidenceRegistry public evidenceRegistry;
    address public treasury;
    address public guardianPool;
    address public ceoAgent;
    address public computeOracle;           // DWS compute for sandbox execution

    mapping(bytes32 => VulnerabilitySubmission) public submissions;
    mapping(bytes32 => GuardianVote[]) public guardianVotes;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => ValidationRequest) public validationRequests;
    
    // Guardian registry
    mapping(uint256 => bool) public isGuardian;
    uint256[] public guardianAgentIds;
    uint256 public minGuardianReputation = 5000;    // Minimum reputation score
    
    // Severity configurations
    mapping(Severity => SeverityConfig) public severityConfigs;
    
    // Duplicate tracking (hash of vulnerability description)
    mapping(bytes32 => bytes32) public vulnerabilityHashes;
    
    // Researcher stats
    mapping(address => uint256) public researcherSubmissions;
    mapping(address => uint256) public researcherApprovedCount;
    mapping(address => uint256) public researcherTotalEarned;

    // Counters
    uint256 private _nextSubmissionId = 1;
    uint256 public totalBountyPool;
    uint256 public totalPaidOut;

    // ============ Events ============

    event VulnerabilitySubmitted(
        bytes32 indexed submissionId,
        address indexed researcher,
        Severity severity,
        VulnerabilityType vulnType,
        uint256 stake
    );
    event ValidationStarted(bytes32 indexed submissionId, bytes32 sandboxJobId);
    event ValidationCompleted(bytes32 indexed submissionId, ValidationResult result);
    event GuardianVoted(bytes32 indexed submissionId, address indexed guardian, bool approved, uint256 suggestedReward);
    event SubmissionApproved(bytes32 indexed submissionId, uint256 rewardAmount);
    event SubmissionRejected(bytes32 indexed submissionId, string reason);
    event RewardPaid(bytes32 indexed submissionId, address indexed researcher, uint256 amount);
    event FixSubmitted(bytes32 indexed submissionId, bytes32 commitHash);
    event DisclosureScheduled(bytes32 indexed submissionId, uint256 disclosureDate);
    event DisclosureCompleted(bytes32 indexed submissionId);
    event GuardianRegistered(uint256 indexed agentId, address indexed owner);
    event GuardianRemoved(uint256 indexed agentId);
    event BountyPoolFunded(address indexed funder, uint256 amount);

    // ============ Errors ============

    error InvalidSubmission();
    error InsufficientStake();
    error NotResearcher();
    error NotGuardian();
    error NotCEO();
    error NotComputeOracle();
    error AlreadyVoted();
    error SubmissionNotInReview();
    error DuplicateVulnerability();
    error InvalidSeverity();
    error ValidationTimeout();
    error ReviewTimeout();
    error SubmissionNotApproved();
    error AlreadyPaid();
    error InsufficientBountyPool();
    error DisclosureTooEarly();
    error InvalidGuardian();
    error TransferFailed();

    // ============ Modifiers ============

    modifier onlyResearcher(bytes32 submissionId) {
        if (submissions[submissionId].researcher != msg.sender) revert NotResearcher();
        _;
    }

    modifier onlyGuardian() {
        uint256 agentId = _getAgentId(msg.sender);
        if (agentId == 0 || !isGuardian[agentId]) revert NotGuardian();
        _;
    }

    modifier onlyCEO() {
        if (msg.sender != ceoAgent) revert NotCEO();
        _;
    }

    modifier onlyComputeOracle() {
        if (msg.sender != computeOracle) revert NotComputeOracle();
        _;
    }

    modifier submissionExists(bytes32 submissionId) {
        if (submissions[submissionId].submittedAt == 0) revert InvalidSubmission();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _treasury,
        address _ceoAgent,
        address initialOwner
    ) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
        guardianPool = _treasury;
        ceoAgent = _ceoAgent;

        // Initialize severity configs (values in wei, will be set via admin)
        _initializeSeverityConfigs();
    }

    function _initializeSeverityConfigs() internal {
        // LOW: $500-$2.5k
        severityConfigs[Severity.LOW] = SeverityConfig({
            minReward: 0.2 ether,
            maxReward: 1 ether,
            minGuardianApprovals: 2,
            validationTimeout: 24 hours,
            reviewTimeout: 7 days
        });

        // MEDIUM: $2.5k-$10k
        severityConfigs[Severity.MEDIUM] = SeverityConfig({
            minReward: 1 ether,
            maxReward: 4 ether,
            minGuardianApprovals: 3,
            validationTimeout: 12 hours,
            reviewTimeout: 5 days
        });

        // HIGH: $10k-$25k
        severityConfigs[Severity.HIGH] = SeverityConfig({
            minReward: 4 ether,
            maxReward: 10 ether,
            minGuardianApprovals: 4,
            validationTimeout: 6 hours,
            reviewTimeout: 3 days
        });

        // CRITICAL: $25k-$50k
        severityConfigs[Severity.CRITICAL] = SeverityConfig({
            minReward: 10 ether,
            maxReward: 20 ether,
            minGuardianApprovals: 5,
            validationTimeout: 2 hours,
            reviewTimeout: 1 days
        });
    }

    // ============ Submission ============

    /**
     * @notice Submit a security vulnerability report
     * @param severity Severity level of the vulnerability
     * @param vulnType Type of vulnerability
     * @param encryptedReportCid IPFS CID of MPC-encrypted vulnerability report
     * @param encryptionKeyId MPC key ID used for encryption
     * @param proofOfConceptHash Hash of the proof of concept code
     * @param vulnerabilityHash Hash of vulnerability description for duplicate detection
     */
    function submitVulnerability(
        Severity severity,
        VulnerabilityType vulnType,
        bytes32 encryptedReportCid,
        bytes32 encryptionKeyId,
        bytes32 proofOfConceptHash,
        bytes32 vulnerabilityHash
    ) external payable nonReentrant whenNotPaused returns (bytes32 submissionId) {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        
        // Check for duplicates
        if (vulnerabilityHashes[vulnerabilityHash] != bytes32(0)) {
            revert DuplicateVulnerability();
        }

        submissionId = keccak256(abi.encodePacked(
            _nextSubmissionId++,
            msg.sender,
            block.timestamp
        ));

        uint256 agentId = _getAgentId(msg.sender);

        submissions[submissionId] = VulnerabilitySubmission({
            submissionId: submissionId,
            researcher: msg.sender,
            researcherAgentId: agentId,
            severity: severity,
            vulnType: vulnType,
            encryptedReportCid: encryptedReportCid,
            encryptionKeyId: encryptionKeyId,
            proofOfConceptHash: proofOfConceptHash,
            stake: msg.value,
            submittedAt: block.timestamp,
            validatedAt: 0,
            resolvedAt: 0,
            status: SubmissionStatus.PENDING,
            validationResult: ValidationResult.PENDING,
            validationNotes: "",
            rewardAmount: 0,
            guardianApprovals: 0,
            guardianRejections: 0,
            fixCommitHash: bytes32(0),
            disclosureDate: 0,
            researcherDisclosed: false
        });

        vulnerabilityHashes[vulnerabilityHash] = submissionId;
        researcherSubmissions[msg.sender]++;

        emit VulnerabilitySubmitted(submissionId, msg.sender, severity, vulnType, msg.value);
    }

    // ============ Validation (Compute Oracle) ============

    /**
     * @notice Start automated sandbox validation
     * @dev Called by the compute oracle after picking up the job
     */
    function startValidation(bytes32 submissionId, bytes32 sandboxJobId)
        external
        onlyComputeOracle
        submissionExists(submissionId)
    {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.PENDING) revert InvalidSubmission();

        sub.status = SubmissionStatus.VALIDATING;

        validationRequests[submissionId] = ValidationRequest({
            submissionId: submissionId,
            sandboxJobId: sandboxJobId,
            requestedAt: block.timestamp,
            completedAt: 0,
            result: ValidationResult.PENDING,
            executionLogs: "",
            computeCost: 0
        });

        emit ValidationStarted(submissionId, sandboxJobId);
    }

    /**
     * @notice Complete automated validation
     * @dev Called by compute oracle with validation results
     */
    function completeValidation(
        bytes32 submissionId,
        ValidationResult result,
        string calldata executionLogs,
        uint256 computeCost
    ) external onlyComputeOracle submissionExists(submissionId) {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VALIDATING) revert InvalidSubmission();

        ValidationRequest storage req = validationRequests[submissionId];
        req.completedAt = block.timestamp;
        req.result = result;
        req.executionLogs = executionLogs;
        req.computeCost = computeCost;

        sub.validatedAt = block.timestamp;
        sub.validationResult = result;

        if (result == ValidationResult.VERIFIED || result == ValidationResult.LIKELY_VALID) {
            sub.status = SubmissionStatus.GUARDIAN_REVIEW;
        } else if (result == ValidationResult.INVALID) {
            sub.status = SubmissionStatus.REJECTED;
            sub.resolvedAt = block.timestamp;
            // Return stake for invalid but honest submissions
            _transferEth(sub.researcher, sub.stake);
        } else if (result == ValidationResult.NEEDS_MORE_INFO) {
            sub.status = SubmissionStatus.PENDING; // Back to pending for more info
        }
        // SANDBOX_ERROR keeps it in VALIDATING for retry

        emit ValidationCompleted(submissionId, result);
    }

    // ============ Guardian Review ============

    /**
     * @notice Guardian votes on vulnerability submission
     * @param submissionId Submission to vote on
     * @param approved Whether to approve
     * @param suggestedReward Suggested reward amount
     * @param feedback Detailed feedback
     */
    function guardianVote(
        bytes32 submissionId,
        bool approved,
        uint256 suggestedReward,
        string calldata feedback
    ) external onlyGuardian submissionExists(submissionId) {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.GUARDIAN_REVIEW) revert SubmissionNotInReview();
        if (hasVoted[submissionId][msg.sender]) revert AlreadyVoted();

        uint256 agentId = _getAgentId(msg.sender);
        SeverityConfig memory config = severityConfigs[sub.severity];

        // Validate suggested reward is within bounds
        if (suggestedReward < config.minReward || suggestedReward > config.maxReward) {
            suggestedReward = approved ? config.minReward : 0;
        }

        guardianVotes[submissionId].push(GuardianVote({
            guardian: msg.sender,
            agentId: agentId,
            approved: approved,
            suggestedReward: suggestedReward,
            feedback: feedback,
            votedAt: block.timestamp
        }));

        hasVoted[submissionId][msg.sender] = true;

        if (approved) {
            sub.guardianApprovals++;
        } else {
            sub.guardianRejections++;
        }

        emit GuardianVoted(submissionId, msg.sender, approved, suggestedReward);

        // Check if we have enough votes for a decision
        _checkGuardianQuorum(submissionId);
    }

    function _checkGuardianQuorum(bytes32 submissionId) internal {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        SeverityConfig memory config = severityConfigs[sub.severity];
        
        uint256 totalVotes = sub.guardianApprovals + sub.guardianRejections;

        // For critical severity, always escalate to CEO
        if (sub.severity == Severity.CRITICAL && sub.guardianApprovals >= config.minGuardianApprovals) {
            sub.status = SubmissionStatus.CEO_REVIEW;
            return;
        }

        // If enough approvals, calculate average reward and approve
        if (sub.guardianApprovals >= config.minGuardianApprovals) {
            uint256 totalSuggested = 0;
            GuardianVote[] storage votes = guardianVotes[submissionId];
            uint256 approvalCount = 0;
            
            for (uint256 i = 0; i < votes.length; i++) {
                if (votes[i].approved) {
                    totalSuggested += votes[i].suggestedReward;
                    approvalCount++;
                }
            }

            sub.rewardAmount = approvalCount > 0 ? totalSuggested / approvalCount : config.minReward;
            
            // High severity also goes to CEO for final approval
            if (sub.severity == Severity.HIGH) {
                sub.status = SubmissionStatus.CEO_REVIEW;
            } else {
                _approveSubmission(submissionId);
            }
        }
        // If majority rejects
        else if (sub.guardianRejections > MAX_GUARDIANS_PER_REVIEW / 2 && 
                 totalVotes >= config.minGuardianApprovals) {
            sub.status = SubmissionStatus.REJECTED;
            sub.resolvedAt = block.timestamp;
            // Return stake for rejected submissions
            _transferEth(sub.researcher, sub.stake);
            emit SubmissionRejected(submissionId, "Guardian consensus: rejected");
        }
    }

    // ============ CEO Decision ============

    /**
     * @notice CEO makes final decision on high/critical severity submissions
     * @param submissionId Submission to decide on
     * @param approved Whether to approve
     * @param rewardAmount Final reward amount
     * @param notes Decision notes
     */
    function ceoDecision(
        bytes32 submissionId,
        bool approved,
        uint256 rewardAmount,
        string calldata notes
    ) external onlyCEO submissionExists(submissionId) {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.CEO_REVIEW) revert SubmissionNotInReview();

        SeverityConfig memory config = severityConfigs[sub.severity];

        if (approved) {
            // Ensure reward is within bounds
            if (rewardAmount < config.minReward) rewardAmount = config.minReward;
            if (rewardAmount > config.maxReward) rewardAmount = config.maxReward;
            
            sub.rewardAmount = rewardAmount;
            sub.validationNotes = notes;
            _approveSubmission(submissionId);
        } else {
            sub.status = SubmissionStatus.REJECTED;
            sub.resolvedAt = block.timestamp;
            sub.validationNotes = notes;
            // Return stake
            _transferEth(sub.researcher, sub.stake);
            emit SubmissionRejected(submissionId, notes);
        }
    }

    function _approveSubmission(bytes32 submissionId) internal {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        sub.status = SubmissionStatus.APPROVED;
        sub.resolvedAt = block.timestamp;
        
        researcherApprovedCount[sub.researcher]++;
        
        emit SubmissionApproved(submissionId, sub.rewardAmount);
    }

    // ============ Fix & Disclosure ============

    /**
     * @notice Record the fix commit for a vulnerability
     * @dev Called by the team after fix is deployed
     */
    function recordFix(bytes32 submissionId, bytes32 commitHash)
        external
        onlyOwner
        submissionExists(submissionId)
    {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.APPROVED && sub.status != SubmissionStatus.PAID) {
            revert SubmissionNotApproved();
        }

        sub.fixCommitHash = commitHash;
        sub.disclosureDate = block.timestamp + DISCLOSURE_GRACE_PERIOD;

        emit FixSubmitted(submissionId, commitHash);
        emit DisclosureScheduled(submissionId, sub.disclosureDate);
    }

    /**
     * @notice Researcher opts to disclose independently
     */
    function researcherDisclose(bytes32 submissionId)
        external
        onlyResearcher(submissionId)
        submissionExists(submissionId)
    {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        sub.researcherDisclosed = true;
        
        // If fix is already in, schedule disclosure immediately
        if (sub.fixCommitHash != bytes32(0)) {
            sub.disclosureDate = block.timestamp;
            emit DisclosureCompleted(submissionId);
        }
    }

    // ============ Payout ============

    /**
     * @notice Pay out reward to researcher
     */
    function payReward(bytes32 submissionId)
        external
        nonReentrant
        submissionExists(submissionId)
    {
        VulnerabilitySubmission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.APPROVED) revert SubmissionNotApproved();
        if (sub.rewardAmount == 0) revert InvalidSubmission();

        uint256 reward = sub.rewardAmount;
        if (address(this).balance < reward) revert InsufficientBountyPool();

        sub.status = SubmissionStatus.PAID;

        // Calculate fees
        uint256 protocolFee = (reward * PROTOCOL_FEE_BPS) / 10000;
        uint256 guardianFee = (reward * GUARDIAN_FEE_BPS) / 10000;
        uint256 researcherPayout = reward - protocolFee - guardianFee;

        // Return stake to researcher
        researcherPayout += sub.stake;

        // Transfer rewards
        _transferEth(sub.researcher, researcherPayout);
        _transferEth(treasury, protocolFee);
        _transferEth(guardianPool, guardianFee);

        researcherTotalEarned[sub.researcher] += researcherPayout - sub.stake;
        totalPaidOut += reward;

        emit RewardPaid(submissionId, sub.researcher, researcherPayout);
    }

    // ============ Guardian Management ============

    /**
     * @notice Register as a security guardian
     * @dev Must have staked ERC-8004 agent with sufficient reputation
     */
    function registerAsGuardian() external nonReentrant {
        uint256 agentId = _getAgentId(msg.sender);
        if (agentId == 0) revert InvalidGuardian();

        IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        if (agent.isBanned) revert InvalidGuardian();
        
        // Check reputation (would come from reputation provider)
        // For now, just require stake
        if (agent.stakedAmount < MIN_STAKE) revert InsufficientStake();

        if (!isGuardian[agentId]) {
            isGuardian[agentId] = true;
            guardianAgentIds.push(agentId);
            emit GuardianRegistered(agentId, msg.sender);
        }
    }

    function removeGuardian(uint256 agentId) external onlyOwner {
        if (!isGuardian[agentId]) revert InvalidGuardian();
        isGuardian[agentId] = false;

        for (uint256 i = 0; i < guardianAgentIds.length; i++) {
            if (guardianAgentIds[i] == agentId) {
                guardianAgentIds[i] = guardianAgentIds[guardianAgentIds.length - 1];
                guardianAgentIds.pop();
                break;
            }
        }

        emit GuardianRemoved(agentId);
    }

    // ============ Funding ============

    /**
     * @notice Fund the bounty pool
     */
    function fundBountyPool() external payable {
        totalBountyPool += msg.value;
        emit BountyPoolFunded(msg.sender, msg.value);
    }

    // ============ Internal ============

    function _getAgentId(address addr) internal view returns (uint256) {
        // Query identity registry for agent ID owned by this address
        uint256 totalAgents = identityRegistry.totalAgents();
        for (uint256 i = 1; i <= totalAgents && i <= 1000; i++) {
            IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(i);
            if (agent.owner == addr && !agent.isBanned) {
                return i;
            }
        }
        return 0;
    }

    function _transferEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============ View Functions ============

    function getSubmission(bytes32 submissionId) external view returns (VulnerabilitySubmission memory) {
        return submissions[submissionId];
    }

    function getGuardianVotes(bytes32 submissionId) external view returns (GuardianVote[] memory) {
        return guardianVotes[submissionId];
    }

    function getValidationRequest(bytes32 submissionId) external view returns (ValidationRequest memory) {
        return validationRequests[submissionId];
    }

    function getSeverityConfig(Severity severity) external view returns (SeverityConfig memory) {
        return severityConfigs[severity];
    }

    function getGuardianCount() external view returns (uint256) {
        return guardianAgentIds.length;
    }

    function getResearcherStats(address researcher) external view returns (
        uint256 totalSubmissions,
        uint256 approvedCount,
        uint256 totalEarned
    ) {
        return (
            researcherSubmissions[researcher],
            researcherApprovedCount[researcher],
            researcherTotalEarned[researcher]
        );
    }

    function getPendingSubmissions() external view returns (bytes32[] memory) {
        // This would be better done via events/indexer in production
        // Placeholder for now
        return new bytes32[](0);
    }

    // ============ Admin ============

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setGuardianPool(address _guardianPool) external onlyOwner {
        guardianPool = _guardianPool;
    }

    function setCEOAgent(address _ceoAgent) external onlyOwner {
        ceoAgent = _ceoAgent;
    }

    function setComputeOracle(address _computeOracle) external onlyOwner {
        computeOracle = _computeOracle;
    }

    function setEvidenceRegistry(address _evidenceRegistry) external onlyOwner {
        evidenceRegistry = EvidenceRegistry(payable(_evidenceRegistry));
    }

    function setSeverityConfig(
        Severity severity,
        uint256 minReward,
        uint256 maxReward,
        uint256 minGuardianApprovals,
        uint256 validationTimeout,
        uint256 reviewTimeout
    ) external onlyOwner {
        severityConfigs[severity] = SeverityConfig({
            minReward: minReward,
            maxReward: maxReward,
            minGuardianApprovals: minGuardianApprovals,
            validationTimeout: validationTimeout,
            reviewTimeout: reviewTimeout
        });
    }

    function setMinGuardianReputation(uint256 _minReputation) external onlyOwner {
        minGuardianReputation = _minReputation;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw() external onlyOwner {
        if (address(this).balance > 0) {
            _transferEth(treasury, address(this).balance);
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {
        totalBountyPool += msg.value;
        emit BountyPoolFunded(msg.sender, msg.value);
    }
}


