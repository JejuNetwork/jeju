// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title TEERegistry
 * @notice On-chain registry for Trusted Execution Environment nodes
 * @dev Manages TEE node registration, attestation verification, and status tracking.
 *
 * Supported TEE Platforms:
 * - Intel TDX (Trust Domain Extensions)
 * - Intel SGX (Software Guard Extensions)
 * - AMD SEV-SNP (Secure Encrypted Virtualization)
 * - NVIDIA Confidential Computing
 */
contract TEERegistry is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // TEE Platform types
    enum TEEPlatform {
        NONE,
        INTEL_TDX,
        INTEL_SGX,
        AMD_SEV_SNP,
        NVIDIA_CC
    }

    // Attestation status
    enum AttestationStatus {
        UNVERIFIED,
        VERIFIED,
        EXPIRED,
        REVOKED
    }

    // TEE Node registration
    struct TEENode {
        address owner;
        string nodeId;
        TEEPlatform platform;
        bytes32 mrEnclave; // Measurement of enclave code
        bytes32 mrSigner; // Measurement of enclave signer
        string endpoint; // DWS API endpoint
        uint256 registeredAt;
        uint256 lastAttestation;
        AttestationStatus status;
        uint256 reputation;
        string[] capabilities;
    }

    // Attestation record
    struct Attestation {
        bytes32 nodeHash;
        TEEPlatform platform;
        bytes quote;
        bytes32 reportData;
        uint256 timestamp;
        address verifier;
        bool valid;
    }

    // State
    mapping(bytes32 => TEENode) public nodes;
    mapping(bytes32 => Attestation[]) public attestations;
    mapping(TEEPlatform => uint256) public attestationValidity; // seconds
    bytes32[] public nodeList;

    // Minimum attestation validity period
    uint256 public constant MIN_ATTESTATION_VALIDITY = 1 hours;
    uint256 public constant DEFAULT_ATTESTATION_VALIDITY = 24 hours;

    // Events
    event NodeRegistered(
        bytes32 indexed nodeHash, address indexed owner, string nodeId, TEEPlatform platform, string endpoint
    );

    event AttestationSubmitted(bytes32 indexed nodeHash, TEEPlatform platform, bytes32 reportData, address verifier);

    event AttestationVerified(bytes32 indexed nodeHash, address indexed verifier, bool valid);

    event NodeStatusUpdated(bytes32 indexed nodeHash, AttestationStatus oldStatus, AttestationStatus newStatus);

    event NodeRevoked(bytes32 indexed nodeHash, address indexed revoker, string reason);

    // Errors
    error NodeAlreadyRegistered();
    error NodeNotFound();
    error InvalidPlatform();
    error InvalidAttestation();
    error AttestationExpired();
    error Unauthorized();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);

        // Set default attestation validity periods
        attestationValidity[TEEPlatform.INTEL_TDX] = DEFAULT_ATTESTATION_VALIDITY;
        attestationValidity[TEEPlatform.INTEL_SGX] = DEFAULT_ATTESTATION_VALIDITY;
        attestationValidity[TEEPlatform.AMD_SEV_SNP] = DEFAULT_ATTESTATION_VALIDITY;
        attestationValidity[TEEPlatform.NVIDIA_CC] = DEFAULT_ATTESTATION_VALIDITY;
    }

    /**
     * @notice Register a new TEE node
     * @param nodeId Unique node identifier
     * @param platform TEE platform type
     * @param mrEnclave Enclave measurement
     * @param mrSigner Signer measurement
     * @param endpoint DWS API endpoint
     * @param capabilities Node capabilities
     */
    function registerNode(
        string calldata nodeId,
        TEEPlatform platform,
        bytes32 mrEnclave,
        bytes32 mrSigner,
        string calldata endpoint,
        string[] calldata capabilities
    ) external returns (bytes32 nodeHash) {
        if (platform == TEEPlatform.NONE) revert InvalidPlatform();

        nodeHash = keccak256(abi.encodePacked(msg.sender, nodeId));

        if (nodes[nodeHash].registeredAt != 0) revert NodeAlreadyRegistered();

        nodes[nodeHash] = TEENode({
            owner: msg.sender,
            nodeId: nodeId,
            platform: platform,
            mrEnclave: mrEnclave,
            mrSigner: mrSigner,
            endpoint: endpoint,
            registeredAt: block.timestamp,
            lastAttestation: 0,
            status: AttestationStatus.UNVERIFIED,
            reputation: 100,
            capabilities: capabilities
        });

        nodeList.push(nodeHash);

        emit NodeRegistered(nodeHash, msg.sender, nodeId, platform, endpoint);

        return nodeHash;
    }

    /**
     * @notice Submit attestation for verification
     * @param nodeHash Node identifier
     * @param quote TEE attestation quote
     * @param reportData Custom report data
     */
    function submitAttestation(bytes32 nodeHash, bytes calldata quote, bytes32 reportData) external {
        TEENode storage node = nodes[nodeHash];
        if (node.registeredAt == 0) revert NodeNotFound();
        if (msg.sender != node.owner) revert Unauthorized();

        Attestation memory attestation = Attestation({
            nodeHash: nodeHash,
            platform: node.platform,
            quote: quote,
            reportData: reportData,
            timestamp: block.timestamp,
            verifier: address(0),
            valid: false
        });

        attestations[nodeHash].push(attestation);

        emit AttestationSubmitted(nodeHash, node.platform, reportData, address(0));
    }

    /**
     * @notice Verify a submitted attestation (verifier only)
     * @param nodeHash Node identifier
     * @param attestationIndex Index of attestation to verify
     * @param valid Whether attestation is valid
     */
    function verifyAttestation(bytes32 nodeHash, uint256 attestationIndex, bool valid)
        external
        onlyRole(VERIFIER_ROLE)
    {
        TEENode storage node = nodes[nodeHash];
        if (node.registeredAt == 0) revert NodeNotFound();

        Attestation storage attestation = attestations[nodeHash][attestationIndex];
        attestation.verifier = msg.sender;
        attestation.valid = valid;

        AttestationStatus oldStatus = node.status;

        if (valid) {
            node.lastAttestation = block.timestamp;
            node.status = AttestationStatus.VERIFIED;
            // Increase reputation for successful attestation
            if (node.reputation < 1000) {
                node.reputation += 10;
            }
        } else {
            node.status = AttestationStatus.UNVERIFIED;
            // Decrease reputation for failed attestation
            if (node.reputation > 10) {
                node.reputation -= 10;
            }
        }

        emit AttestationVerified(nodeHash, msg.sender, valid);

        if (oldStatus != node.status) {
            emit NodeStatusUpdated(nodeHash, oldStatus, node.status);
        }
    }

    /**
     * @notice Check if a node's attestation is currently valid
     * @param nodeHash Node identifier
     * @return isValid Whether attestation is valid
     * @return expiresAt When attestation expires
     */
    function isAttestationValid(bytes32 nodeHash) external view returns (bool isValid, uint256 expiresAt) {
        TEENode storage node = nodes[nodeHash];
        if (node.registeredAt == 0) return (false, 0);
        if (node.status != AttestationStatus.VERIFIED) return (false, 0);

        uint256 validity = attestationValidity[node.platform];
        expiresAt = node.lastAttestation + validity;

        isValid = block.timestamp < expiresAt;
        return (isValid, expiresAt);
    }

    /**
     * @notice Revoke a node's attestation
     * @param nodeHash Node identifier
     * @param reason Revocation reason
     */
    function revokeNode(bytes32 nodeHash, string calldata reason) external onlyRole(ADMIN_ROLE) {
        TEENode storage node = nodes[nodeHash];
        if (node.registeredAt == 0) revert NodeNotFound();

        AttestationStatus oldStatus = node.status;
        node.status = AttestationStatus.REVOKED;

        emit NodeStatusUpdated(nodeHash, oldStatus, AttestationStatus.REVOKED);
        emit NodeRevoked(nodeHash, msg.sender, reason);
    }

    /**
     * @notice Update attestation validity period for a platform
     * @param platform TEE platform
     * @param validitySeconds New validity period in seconds
     */
    function setAttestationValidity(TEEPlatform platform, uint256 validitySeconds) external onlyRole(ADMIN_ROLE) {
        require(validitySeconds >= MIN_ATTESTATION_VALIDITY, "Validity too short");
        attestationValidity[platform] = validitySeconds;
    }

    /**
     * @notice Get node details
     * @param nodeHash Node identifier
     * @return node TEE node details
     */
    function getNode(bytes32 nodeHash) external view returns (TEENode memory node) {
        return nodes[nodeHash];
    }

    /**
     * @notice Get all registered nodes
     * @return hashes Array of node hashes
     */
    function getAllNodes() external view returns (bytes32[] memory hashes) {
        return nodeList;
    }

    /**
     * @notice Get nodes by platform
     * @param platform TEE platform to filter by
     * @return hashes Array of matching node hashes
     */
    function getNodesByPlatform(TEEPlatform platform) external view returns (bytes32[] memory hashes) {
        uint256 count = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].platform == platform) {
                count++;
            }
        }

        hashes = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].platform == platform) {
                hashes[index] = nodeList[i];
                index++;
            }
        }

        return hashes;
    }

    /**
     * @notice Get verified nodes with valid attestations
     * @return hashes Array of verified node hashes
     */
    function getVerifiedNodes() external view returns (bytes32[] memory hashes) {
        uint256 count = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            TEENode storage node = nodes[nodeList[i]];
            if (node.status == AttestationStatus.VERIFIED) {
                uint256 validity = attestationValidity[node.platform];
                if (block.timestamp < node.lastAttestation + validity) {
                    count++;
                }
            }
        }

        hashes = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            TEENode storage node = nodes[nodeList[i]];
            if (node.status == AttestationStatus.VERIFIED) {
                uint256 validity = attestationValidity[node.platform];
                if (block.timestamp < node.lastAttestation + validity) {
                    hashes[index] = nodeList[i];
                    index++;
                }
            }
        }

        return hashes;
    }

    /**
     * @notice Get attestation count for a node
     * @param nodeHash Node identifier
     * @return count Number of attestations
     */
    function getAttestationCount(bytes32 nodeHash) external view returns (uint256 count) {
        return attestations[nodeHash].length;
    }

    /**
     * @notice Get specific attestation
     * @param nodeHash Node identifier
     * @param index Attestation index
     * @return attestation Attestation details
     */
    function getAttestation(bytes32 nodeHash, uint256 index) external view returns (Attestation memory attestation) {
        return attestations[nodeHash][index];
    }
}
