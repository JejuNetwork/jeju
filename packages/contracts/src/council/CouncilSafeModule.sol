// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CouncilSafeModule
 * @author Jeju Network
 * @notice Safe module that enables AI CEO to participate in multi-sig transactions
 * @dev Implements a 3/4 signing policy: 3 human signers + 1 AI CEO module
 *
 * The AI CEO signs transactions through TEE-attested decisions. This module:
 * - Acts as a virtual signer on the Safe
 * - Validates TEE attestations before signing
 * - Provides emergency pause capability for security council
 * - Routes approved proposals through the Safe for execution
 *
 * Security:
 * - AI signatures require valid TEE attestation
 * - Emergency pause by any security council member
 * - Unpause requires full multi-sig approval
 * - Nonce tracking prevents replay attacks
 *
 * @custom:security-contact security@jeju.network
 */
interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success);

    function isOwner(address owner) external view returns (bool);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function nonce() external view returns (uint256);
    function domainSeparator() external view returns (bytes32);
}

interface ICouncil {
    enum ProposalStatus {
        SUBMITTED, COUNCIL_REVIEW, RESEARCH_PENDING, COUNCIL_FINAL,
        CEO_QUEUE, APPROVED, EXECUTING, COMPLETED, REJECTED, VETOED,
        FUTARCHY_PENDING, FUTARCHY_APPROVED, FUTARCHY_REJECTED, DUPLICATE, SPAM
    }

    struct Proposal {
        bytes32 proposalId;
        address proposer;
        uint256 proposerAgentId;
        uint8 proposalType;
        ProposalStatus status;
        uint8 qualityScore;
        uint256 createdAt;
        uint256 councilVoteEnd;
        uint256 gracePeriodEnd;
        bytes32 contentHash;
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

    function getProposal(bytes32 proposalId) external view returns (Proposal memory);
}

contract CouncilSafeModule is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ============================================================================
    // Structs
    // ============================================================================

    struct TEEAttestation {
        bytes32 proposalId;
        bool approved;
        bytes32 decisionHash;
        bytes quote;           // DCAP attestation quote
        bytes32 measurement;   // Enclave measurement
        uint256 timestamp;
        bytes signature;       // TEE operator signature
    }

    struct PendingExecution {
        bytes32 proposalId;
        address target;
        uint256 value;
        bytes data;
        uint8 operation;       // 0 = call, 1 = delegatecall
        uint256 createdAt;
        uint256 humanApprovals;
        bool aiApproved;
        bool executed;
        bool cancelled;
    }

    // ============================================================================
    // State
    // ============================================================================

    ISafe public safe;
    ICouncil public council;

    address public teeOperator;
    bytes32 public trustedMeasurement;

    bool public paused;
    uint256 public executionNonce;

    mapping(bytes32 => PendingExecution) public pendingExecutions;
    bytes32[] public allPendingIds;

    mapping(bytes32 => mapping(address => bool)) public humanApprovals;
    mapping(address => bool) public isSecurityCouncil;
    address[] public securityCouncilMembers;

    uint256 public requiredHumanApprovals = 2;
    uint256 public executionDelay = 1 hours;
    uint256 public attestationMaxAge = 1 hours;

    // ============================================================================
    // Events
    // ============================================================================

    event ExecutionQueued(
        bytes32 indexed executionId,
        bytes32 indexed proposalId,
        address target,
        uint256 value
    );

    event HumanApproval(
        bytes32 indexed executionId,
        address indexed approver,
        uint256 approvalCount
    );

    event AIApproval(
        bytes32 indexed executionId,
        bytes32 indexed proposalId,
        bytes32 decisionHash
    );

    event ExecutionCompleted(
        bytes32 indexed executionId,
        bytes32 indexed proposalId,
        bool success
    );

    event ExecutionCancelled(
        bytes32 indexed executionId,
        address indexed canceller,
        string reason
    );

    event EmergencyPause(
        address indexed pauser,
        string reason
    );

    event EmergencyUnpause(
        address indexed unpauser
    );

    event SecurityCouncilUpdated(
        address indexed member,
        bool added
    );

    event TEEOperatorUpdated(
        address indexed oldOperator,
        address indexed newOperator
    );

    event TrustedMeasurementUpdated(
        bytes32 oldMeasurement,
        bytes32 newMeasurement
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error NotSafe();
    error NotSafeOwner();
    error NotSecurityCouncil();
    error ModulePaused();
    error ExecutionNotFound();
    error ExecutionAlreadyProcessed();
    error ExecutionNotReady();
    error AlreadyApproved();
    error InvalidAttestation();
    error AttestationExpired();
    error InvalidMeasurement();
    error ProposalNotApproved();
    error InsufficientApprovals();
    error DelayNotPassed();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlySafe() {
        if (msg.sender != address(safe)) revert NotSafe();
        _;
    }

    modifier onlySafeOwner() {
        if (!safe.isOwner(msg.sender)) revert NotSafeOwner();
        _;
    }

    modifier onlySecurityCouncil() {
        if (!isSecurityCouncil[msg.sender]) revert NotSecurityCouncil();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ModulePaused();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _safe,
        address _council,
        address _teeOperator,
        bytes32 _trustedMeasurement,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_safe != address(0), "Invalid safe");
        require(_council != address(0), "Invalid council");

        safe = ISafe(_safe);
        council = ICouncil(_council);
        teeOperator = _teeOperator;
        trustedMeasurement = _trustedMeasurement;

        isSecurityCouncil[initialOwner] = true;
        securityCouncilMembers.push(initialOwner);
    }

    // ============================================================================
    // Execution Queue
    // ============================================================================

    /**
     * @notice Queue an approved proposal for execution through Safe
     * @param proposalId The approved proposal ID
     * @return executionId Unique execution identifier
     */
    function queueProposalExecution(bytes32 proposalId)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 executionId)
    {
        ICouncil.Proposal memory proposal = council.getProposal(proposalId);

        if (proposal.status != ICouncil.ProposalStatus.APPROVED &&
            proposal.status != ICouncil.ProposalStatus.FUTARCHY_APPROVED) {
            revert ProposalNotApproved();
        }

        executionId = keccak256(abi.encodePacked(
            proposalId,
            executionNonce++,
            block.timestamp
        ));

        pendingExecutions[executionId] = PendingExecution({
            proposalId: proposalId,
            target: proposal.targetContract,
            value: proposal.value,
            data: proposal.callData,
            operation: 0,
            createdAt: block.timestamp,
            humanApprovals: 0,
            aiApproved: false,
            executed: false,
            cancelled: false
        });

        allPendingIds.push(executionId);

        emit ExecutionQueued(executionId, proposalId, proposal.targetContract, proposal.value);
    }

    /**
     * @notice Human signer approves execution
     * @param executionId Execution to approve
     */
    function approveExecution(bytes32 executionId)
        external
        onlySafeOwner
        whenNotPaused
    {
        PendingExecution storage execution = pendingExecutions[executionId];
        if (execution.createdAt == 0) revert ExecutionNotFound();
        if (execution.executed || execution.cancelled) revert ExecutionAlreadyProcessed();
        if (humanApprovals[executionId][msg.sender]) revert AlreadyApproved();

        humanApprovals[executionId][msg.sender] = true;
        execution.humanApprovals++;

        emit HumanApproval(executionId, msg.sender, execution.humanApprovals);

        _tryExecute(executionId);
    }

    /**
     * @notice AI CEO approves execution via TEE attestation
     * @param executionId Execution to approve
     * @param attestation TEE attestation proving AI decision
     */
    function aiApproveExecution(
        bytes32 executionId,
        TEEAttestation calldata attestation
    )
        external
        whenNotPaused
        nonReentrant
    {
        PendingExecution storage execution = pendingExecutions[executionId];
        if (execution.createdAt == 0) revert ExecutionNotFound();
        if (execution.executed || execution.cancelled) revert ExecutionAlreadyProcessed();
        if (execution.aiApproved) revert AlreadyApproved();

        _validateAttestation(attestation, execution.proposalId);

        execution.aiApproved = true;

        emit AIApproval(executionId, execution.proposalId, attestation.decisionHash);

        _tryExecute(executionId);
    }

    /**
     * @notice Try to execute if all conditions are met
     */
    function _tryExecute(bytes32 executionId) internal {
        PendingExecution storage execution = pendingExecutions[executionId];

        if (execution.humanApprovals < requiredHumanApprovals) return;
        if (!execution.aiApproved) return;
        if (block.timestamp < execution.createdAt + executionDelay) return;

        execution.executed = true;

        bool success = safe.execTransactionFromModule(
            execution.target,
            execution.value,
            execution.data,
            execution.operation
        );

        emit ExecutionCompleted(executionId, execution.proposalId, success);
    }

    /**
     * @notice Force execute if ready (anyone can call)
     */
    function executeIfReady(bytes32 executionId) external whenNotPaused nonReentrant {
        PendingExecution storage execution = pendingExecutions[executionId];
        if (execution.createdAt == 0) revert ExecutionNotFound();
        if (execution.executed || execution.cancelled) revert ExecutionAlreadyProcessed();
        if (execution.humanApprovals < requiredHumanApprovals) revert InsufficientApprovals();
        if (!execution.aiApproved) revert InsufficientApprovals();
        if (block.timestamp < execution.createdAt + executionDelay) revert DelayNotPassed();

        execution.executed = true;

        bool success = safe.execTransactionFromModule(
            execution.target,
            execution.value,
            execution.data,
            execution.operation
        );

        emit ExecutionCompleted(executionId, execution.proposalId, success);
    }

    /**
     * @notice Cancel a pending execution
     */
    function cancelExecution(bytes32 executionId, string calldata reason)
        external
        onlySafeOwner
    {
        PendingExecution storage execution = pendingExecutions[executionId];
        if (execution.createdAt == 0) revert ExecutionNotFound();
        if (execution.executed || execution.cancelled) revert ExecutionAlreadyProcessed();

        execution.cancelled = true;

        emit ExecutionCancelled(executionId, msg.sender, reason);
    }

    // ============================================================================
    // Attestation Validation
    // ============================================================================

    function _validateAttestation(
        TEEAttestation calldata attestation,
        bytes32 expectedProposalId
    ) internal view {
        if (attestation.proposalId != expectedProposalId) revert InvalidAttestation();
        if (!attestation.approved) revert InvalidAttestation();
        if (block.timestamp > attestation.timestamp + attestationMaxAge) revert AttestationExpired();

        if (trustedMeasurement != bytes32(0)) {
            if (attestation.measurement != trustedMeasurement) revert InvalidMeasurement();
        }

        bytes32 messageHash = keccak256(abi.encodePacked(
            attestation.proposalId,
            attestation.approved,
            attestation.decisionHash,
            attestation.measurement,
            attestation.timestamp
        ));

        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address signer = ECDSA.recover(ethSignedHash, attestation.signature);

        if (signer != teeOperator) revert InvalidAttestation();
    }

    // ============================================================================
    // Emergency Controls
    // ============================================================================

    /**
     * @notice Emergency pause - any security council member can trigger
     * @param reason Reason for pause
     */
    function emergencyPause(string calldata reason) external onlySecurityCouncil {
        paused = true;
        emit EmergencyPause(msg.sender, reason);
    }

    /**
     * @notice Unpause - requires Safe owner (full multi-sig)
     */
    function emergencyUnpause() external onlySafe {
        paused = false;
        emit EmergencyUnpause(msg.sender);
    }

    // ============================================================================
    // Security Council Management
    // ============================================================================

    function addSecurityCouncilMember(address member) external onlyOwner {
        require(!isSecurityCouncil[member], "Already member");
        isSecurityCouncil[member] = true;
        securityCouncilMembers.push(member);
        emit SecurityCouncilUpdated(member, true);
    }

    function removeSecurityCouncilMember(address member) external onlyOwner {
        require(isSecurityCouncil[member], "Not member");
        require(securityCouncilMembers.length > 1, "Cannot remove last member");

        isSecurityCouncil[member] = false;

        for (uint256 i = 0; i < securityCouncilMembers.length; i++) {
            if (securityCouncilMembers[i] == member) {
                securityCouncilMembers[i] = securityCouncilMembers[securityCouncilMembers.length - 1];
                securityCouncilMembers.pop();
                break;
            }
        }

        emit SecurityCouncilUpdated(member, false);
    }

    function syncSecurityCouncilFromDelegation(address delegationRegistry) external onlyOwner {
        // Clear existing non-owner members
        for (uint256 i = securityCouncilMembers.length; i > 0; i--) {
            address member = securityCouncilMembers[i - 1];
            if (member != owner()) {
                isSecurityCouncil[member] = false;
                securityCouncilMembers[i - 1] = securityCouncilMembers[securityCouncilMembers.length - 1];
                securityCouncilMembers.pop();
            }
        }

        // Get new council from delegation registry
        (bool success, bytes memory data) = delegationRegistry.staticcall(
            abi.encodeWithSignature("getSecurityCouncil()")
        );

        if (success && data.length > 0) {
            address[] memory newCouncil = abi.decode(data, (address[]));
            for (uint256 i = 0; i < newCouncil.length; i++) {
                if (!isSecurityCouncil[newCouncil[i]]) {
                    isSecurityCouncil[newCouncil[i]] = true;
                    securityCouncilMembers.push(newCouncil[i]);
                    emit SecurityCouncilUpdated(newCouncil[i], true);
                }
            }
        }
    }

    // ============================================================================
    // Configuration
    // ============================================================================

    function setTEEOperator(address newOperator) external onlyOwner {
        address old = teeOperator;
        teeOperator = newOperator;
        emit TEEOperatorUpdated(old, newOperator);
    }

    function setTrustedMeasurement(bytes32 newMeasurement) external onlyOwner {
        bytes32 old = trustedMeasurement;
        trustedMeasurement = newMeasurement;
        emit TrustedMeasurementUpdated(old, newMeasurement);
    }

    function setRequiredHumanApprovals(uint256 count) external onlyOwner {
        require(count > 0, "Must require at least 1");
        requiredHumanApprovals = count;
    }

    function setExecutionDelay(uint256 delay) external onlyOwner {
        executionDelay = delay;
    }

    function setAttestationMaxAge(uint256 maxAge) external onlyOwner {
        require(maxAge >= 5 minutes, "Too short");
        attestationMaxAge = maxAge;
    }

    function setSafe(address newSafe) external onlyOwner {
        require(newSafe != address(0), "Invalid safe");
        safe = ISafe(newSafe);
    }

    function setCouncil(address newCouncil) external onlyOwner {
        require(newCouncil != address(0), "Invalid council");
        council = ICouncil(newCouncil);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getPendingExecution(bytes32 executionId)
        external
        view
        returns (PendingExecution memory)
    {
        return pendingExecutions[executionId];
    }

    function getAllPendingExecutions() external view returns (bytes32[] memory) {
        return allPendingIds;
    }

    function getActivePendingExecutions() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allPendingIds.length; i++) {
            PendingExecution storage e = pendingExecutions[allPendingIds[i]];
            if (!e.executed && !e.cancelled) count++;
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allPendingIds.length; i++) {
            PendingExecution storage e = pendingExecutions[allPendingIds[i]];
            if (!e.executed && !e.cancelled) {
                active[j++] = allPendingIds[i];
            }
        }

        return active;
    }

    function getSecurityCouncilMembers() external view returns (address[] memory) {
        return securityCouncilMembers;
    }

    function isExecutionReady(bytes32 executionId) external view returns (bool) {
        PendingExecution storage e = pendingExecutions[executionId];
        return !e.executed &&
               !e.cancelled &&
               e.humanApprovals >= requiredHumanApprovals &&
               e.aiApproved &&
               block.timestamp >= e.createdAt + executionDelay;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

