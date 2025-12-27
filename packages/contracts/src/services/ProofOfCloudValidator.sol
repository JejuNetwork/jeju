// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title ProofOfCloudValidator
 * @author Jeju Network
 * @notice Validates TEE attestations against Proof-of-Cloud registry
 * @dev Acts as an ERC-8004 validation provider for PoC verification
 *
 * This contract enables:
 * - Multi-sig oracle for PoC verification responses
 * - Recording verification status on-chain via ValidationRegistry
 * - Tracking hardware IDs and their verification levels
 * - Revocation of compromised hardware
 *
 * Verification Levels:
 * - Level 1: Human-supervised verification
 * - Level 2: Automated cryptographic proofs
 * - Level 3: Continuous monitoring
 */
contract ProofOfCloudValidator is Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ============================================================================
    // Constants
    // ============================================================================

    /// @notice Tag for PoC validation requests
    bytes32 public constant POC_TAG = keccak256("ProofOfCloud");

    /// @notice Tag for Level 1 verification
    bytes32 public constant LEVEL_1_TAG = keccak256("Level1");

    /// @notice Tag for Level 2 verification
    bytes32 public constant LEVEL_2_TAG = keccak256("Level2");

    /// @notice Tag for Level 3 verification
    bytes32 public constant LEVEL_3_TAG = keccak256("Level3");

    /// @notice Tag for revoked hardware
    bytes32 public constant REVOKED_TAG = keccak256("Revoked");

    /// @notice Maximum number of oracle signers
    uint256 public constant MAX_SIGNERS = 10;

    /// @notice Verification expiry time (24 hours)
    uint256 public constant VERIFICATION_VALIDITY = 24 hours;

    /// @notice Re-verification interval (7 days)
    uint256 public constant REVERIFICATION_INTERVAL = 7 days;

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice Identity registry for agent lookup
    IdentityRegistry public immutable identityRegistry;

    /// @notice Oracle signers (multisig)
    address[] public signers;
    mapping(address => bool) public isSigner;

    /// @notice Required signature threshold
    uint256 public threshold;

    /// @notice Hardware verification records
    struct HardwareRecord {
        bytes32 hardwareIdHash;
        uint8 level;
        uint256 agentId;
        uint256 verifiedAt;
        uint256 expiresAt;
        bool revoked;
        string cloudProvider;
        string region;
    }

    /// @notice Mapping from hardware ID hash to record
    mapping(bytes32 => HardwareRecord) public hardwareRecords;

    /// @notice Mapping from agent ID to hardware ID hash
    mapping(uint256 => bytes32) public agentHardware;

    /// @notice Mapping from agent ID to validation request hash
    mapping(uint256 => bytes32) public agentValidationRequest;

    /// @notice Pending verification signatures
    struct PendingVerification {
        uint256 agentId;
        bytes32 hardwareIdHash;
        uint8 level;
        string cloudProvider;
        string region;
        bytes32 evidenceHash;
        uint256 timestamp;
        address[] signatories;
        bool executed;
    }

    mapping(bytes32 => PendingVerification) public pendingVerifications;

    /// @notice Nonces for signature replay prevention
    mapping(address => uint256) public nonces;

    // ============================================================================
    // Events
    // ============================================================================

    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event VerificationRequested(
        uint256 indexed agentId, bytes32 indexed requestHash, bytes32 hardwareIdHash, address indexed requester
    );
    event VerificationSubmitted(
        bytes32 indexed requestHash, address indexed signer, uint256 signaturesCount, uint256 threshold
    );
    event VerificationCompleted(
        uint256 indexed agentId, bytes32 indexed hardwareIdHash, uint8 level, string cloudProvider, string region
    );
    event HardwareRevocationEvent(bytes32 indexed hardwareIdHash, uint256 indexed agentId, string reason);
    event VerificationExpiredEvent(uint256 indexed agentId, bytes32 indexed hardwareIdHash);

    // ============================================================================
    // Errors
    // ============================================================================

    error InvalidSigner();
    error SignerAlreadyExists();
    error SignerNotFound();
    error InvalidThreshold();
    error TooManySigners();
    error AgentNotFound();
    error HardwareAlreadyRegistered();
    error HardwareNotRegistered();
    error HardwareRevoked();
    error VerificationExpired();
    error InvalidSignature();
    error SignatureAlreadySubmitted();
    error InsufficientSignatures();
    error VerificationNotFound();
    error VerificationAlreadyExecuted();
    error InvalidLevel();
    error SelfVerificationNotAllowed();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert InvalidSigner();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address payable _identityRegistry, address[] memory _initialSigners, uint256 _threshold, address _owner)
        Ownable(_owner)
    {
        if (_identityRegistry == address(0)) revert InvalidSigner();
        if (_initialSigners.length == 0) revert InvalidThreshold();
        if (_threshold == 0 || _threshold > _initialSigners.length) revert InvalidThreshold();
        if (_initialSigners.length > MAX_SIGNERS) revert TooManySigners();

        identityRegistry = IdentityRegistry(_identityRegistry);
        threshold = _threshold;

        for (uint256 i = 0; i < _initialSigners.length; i++) {
            address signer = _initialSigners[i];
            if (signer == address(0)) revert InvalidSigner();
            if (isSigner[signer]) revert SignerAlreadyExists();

            signers.push(signer);
            isSigner[signer] = true;
            emit SignerAdded(signer);
        }
    }

    // ============================================================================
    // Signer Management
    // ============================================================================

    /**
     * @notice Add a new oracle signer
     * @param signer Address of the new signer
     */
    function addSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidSigner();
        if (isSigner[signer]) revert SignerAlreadyExists();
        if (signers.length >= MAX_SIGNERS) revert TooManySigners();

        signers.push(signer);
        isSigner[signer] = true;
        emit SignerAdded(signer);
    }

    /**
     * @notice Remove an oracle signer
     * @param signer Address of the signer to remove
     */
    function removeSigner(address signer) external onlyOwner {
        if (!isSigner[signer]) revert SignerNotFound();
        if (signers.length <= threshold) revert InvalidThreshold();

        isSigner[signer] = false;

        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }

        emit SignerRemoved(signer);
    }

    /**
     * @notice Update signature threshold
     * @param newThreshold New threshold value
     */
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > signers.length) revert InvalidThreshold();

        uint256 oldThreshold = threshold;
        threshold = newThreshold;
        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    // ============================================================================
    // Verification Request
    // ============================================================================

    /**
     * @notice Request PoC verification for an agent
     * @param agentId Agent ID in IdentityRegistry
     * @param hardwareIdHash Salted hash of hardware ID
     * @param requestUri URI containing attestation quote and metadata
     * @return requestHash Hash of the validation request
     */
    function requestVerification(uint256 agentId, bytes32 hardwareIdHash, string calldata requestUri)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 requestHash)
    {
        if (!identityRegistry.agentExists(agentId)) revert AgentNotFound();

        address agentOwner = identityRegistry.ownerOf(agentId);
        if (
            msg.sender != agentOwner && !identityRegistry.isApprovedForAll(agentOwner, msg.sender)
                && identityRegistry.getApproved(agentId) != msg.sender
        ) {
            revert InvalidSigner();
        }

        // Check if hardware is already verified for another agent
        HardwareRecord storage existingRecord = hardwareRecords[hardwareIdHash];
        if (
            existingRecord.agentId != 0 && existingRecord.agentId != agentId && !existingRecord.revoked
                && block.timestamp < existingRecord.expiresAt
        ) {
            revert HardwareAlreadyRegistered();
        }

        // Create request hash - stored internally, not via ValidationRegistry
        // (ValidationRegistry's self-validation check prevents validators from requesting)
        requestHash =
            keccak256(abi.encodePacked(address(this), agentId, hardwareIdHash, requestUri, block.timestamp, msg.sender));

        agentValidationRequest[agentId] = requestHash;

        emit VerificationRequested(agentId, requestHash, hardwareIdHash, msg.sender);
    }

    // ============================================================================
    // Verification Submission (Multi-sig)
    // ============================================================================

    /**
     * @notice Submit verification result (oracle signer only)
     * @param requestHash Hash of the validation request
     * @param agentId Agent ID
     * @param hardwareIdHash Salted hash of hardware ID
     * @param level Verification level (1, 2, or 3)
     * @param cloudProvider Cloud provider name
     * @param region Data center region
     * @param evidenceHash Hash of verification evidence
     * @param signature Signer's signature over the verification data
     */
    function submitVerification(
        bytes32 requestHash,
        uint256 agentId,
        bytes32 hardwareIdHash,
        uint8 level,
        string calldata cloudProvider,
        string calldata region,
        bytes32 evidenceHash,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (level == 0 || level > 3) revert InvalidLevel();
        if (!identityRegistry.agentExists(agentId)) revert AgentNotFound();

        // Verify signature (using abi.encode to prevent hash collisions with dynamic types)
        bytes32 messageHash = keccak256(
            abi.encode(
                requestHash,
                agentId,
                hardwareIdHash,
                level,
                cloudProvider,
                region,
                evidenceHash,
                block.chainid,
                address(this),
                nonces[msg.sender]
            )
        );

        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethSignedHash, signature);

        if (!isSigner[recovered]) revert InvalidSigner();
        if (recovered != msg.sender) revert InvalidSignature();

        // Increment nonce
        nonces[msg.sender]++;

        // Get or create pending verification
        PendingVerification storage pending = pendingVerifications[requestHash];

        if (pending.executed) revert VerificationAlreadyExecuted();

        // Initialize if new
        if (pending.agentId == 0) {
            pending.agentId = agentId;
            pending.hardwareIdHash = hardwareIdHash;
            pending.level = level;
            pending.cloudProvider = cloudProvider;
            pending.region = region;
            pending.evidenceHash = evidenceHash;
            pending.timestamp = block.timestamp;
        }

        // Check if already signed
        for (uint256 i = 0; i < pending.signatories.length; i++) {
            if (pending.signatories[i] == recovered) {
                revert SignatureAlreadySubmitted();
            }
        }

        pending.signatories.push(recovered);

        emit VerificationSubmitted(requestHash, recovered, pending.signatories.length, threshold);

        // Execute if threshold reached
        if (pending.signatories.length >= threshold) {
            _executeVerification(requestHash, pending);
        }
    }

    /**
     * @dev Execute verification after threshold signatures collected
     */
    function _executeVerification(bytes32 requestHash, PendingVerification storage pending) internal {
        pending.executed = true;

        // Store hardware record
        hardwareRecords[pending.hardwareIdHash] = HardwareRecord({
            hardwareIdHash: pending.hardwareIdHash,
            level: pending.level,
            agentId: pending.agentId,
            verifiedAt: block.timestamp,
            expiresAt: block.timestamp + REVERIFICATION_INTERVAL,
            revoked: false,
            cloudProvider: pending.cloudProvider,
            region: pending.region
        });

        agentHardware[pending.agentId] = pending.hardwareIdHash;

        emit VerificationCompleted(
            pending.agentId, pending.hardwareIdHash, pending.level, pending.cloudProvider, pending.region
        );
    }

    // ============================================================================
    // Revocation
    // ============================================================================

    /**
     * @notice Revoke a hardware verification
     * @param hardwareIdHash Hardware ID hash to revoke
     * @param reason Reason for revocation
     */
    function revokeHardware(bytes32 hardwareIdHash, string calldata reason) external onlySigner nonReentrant {
        HardwareRecord storage record = hardwareRecords[hardwareIdHash];
        if (record.agentId == 0) revert HardwareNotRegistered();
        if (record.revoked) revert HardwareRevoked();

        record.revoked = true;

        emit HardwareRevocationEvent(hardwareIdHash, record.agentId, reason);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Get hardware record
     * @param hardwareIdHash Hardware ID hash
     * @return record Hardware record
     */
    function getHardwareRecord(bytes32 hardwareIdHash) external view returns (HardwareRecord memory record) {
        return hardwareRecords[hardwareIdHash];
    }

    /**
     * @notice Get agent's hardware verification status
     * @param agentId Agent ID
     * @return verified Whether agent has verified hardware
     * @return level Verification level (0 if not verified)
     * @return hardwareIdHash Hardware ID hash
     * @return expiresAt Verification expiry timestamp
     */
    function getAgentStatus(uint256 agentId)
        external
        view
        returns (bool verified, uint8 level, bytes32 hardwareIdHash, uint256 expiresAt)
    {
        hardwareIdHash = agentHardware[agentId];
        if (hardwareIdHash == bytes32(0)) {
            return (false, 0, bytes32(0), 0);
        }

        HardwareRecord storage record = hardwareRecords[hardwareIdHash];

        verified = !record.revoked && block.timestamp < record.expiresAt;
        level = verified ? record.level : 0;
        expiresAt = record.expiresAt;
    }

    /**
     * @notice Check if agent requires re-verification
     * @param agentId Agent ID
     * @return needsReverification True if re-verification needed
     */
    function needsReverification(uint256 agentId) external view returns (bool) {
        bytes32 hardwareIdHash = agentHardware[agentId];
        if (hardwareIdHash == bytes32(0)) return true;

        HardwareRecord storage record = hardwareRecords[hardwareIdHash];
        return record.revoked || block.timestamp >= record.expiresAt;
    }

    /**
     * @notice Get all signers
     * @return signersList List of signer addresses
     */
    function getSigners() external view returns (address[] memory signersList) {
        return signers;
    }

    /**
     * @notice Get pending verification info
     * @param requestHash Request hash
     * @return agentId Agent ID
     * @return signaturesCount Number of signatures collected
     * @return executed Whether verification was executed
     */
    function getPendingVerification(bytes32 requestHash)
        external
        view
        returns (uint256 agentId, uint256 signaturesCount, bool executed)
    {
        PendingVerification storage pending = pendingVerifications[requestHash];
        return (pending.agentId, pending.signatories.length, pending.executed);
    }

    /**
     * @notice Get signer's current nonce
     * @param signer Signer address
     * @return nonce Current nonce
     */
    function getNonce(address signer) external view returns (uint256) {
        return nonces[signer];
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
