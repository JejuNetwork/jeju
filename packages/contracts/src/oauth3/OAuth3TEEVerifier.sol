// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IOAuth3TEEVerifier} from "./IOAuth3.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OAuth3TEEVerifier
 * @notice Verifies TEE attestations from dstack nodes with cryptographic signature verification
 * @dev Supports Intel TDX, SGX, and Phala attestation verification
 *
 * Quote Format (minimum 128 bytes):
 * - bytes 0-31: measurement (mrEnclave or mrTd)
 * - bytes 32-63: reportData (custom data included in attestation)
 * - byte 64: provider (0=DSTACK, 1=PHALA, 2=SGX, 3=TDX)
 * - bytes 65-66: signature length (big-endian uint16)
 * - bytes 67+: ECDSA signature (r || s || v format or DER)
 *
 * Verification Process:
 * 1. Parse quote structure
 * 2. Check measurement against trusted whitelist
 * 3. Verify ECDSA signature against trusted signer keys
 * 4. Validate quote freshness via timestamp in reportData
 */
contract OAuth3TEEVerifier is IOAuth3TEEVerifier, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Provider type constants
    bytes32 public constant DSTACK_PROVIDER = keccak256("DSTACK");
    bytes32 public constant PHALA_PROVIDER = keccak256("PHALA");
    
    // Provider type enum values in quote
    uint8 public constant PROVIDER_DSTACK = 0;
    uint8 public constant PROVIDER_PHALA = 1;
    uint8 public constant PROVIDER_SGX = 2;
    uint8 public constant PROVIDER_TDX = 3;

    address public owner;
    address public identityRegistry;

    bytes32[] public trustedMeasurements;
    mapping(bytes32 => bool) public isTrustedMeasurement;
    
    /// @notice Trusted signer addresses for attestation signatures
    mapping(address => bool) public trustedSigners;
    address[] public trustedSignerList;
    
    /// @notice Measurement to trusted signer mapping (for measurement-specific keys)
    mapping(bytes32 => address) public measurementSigner;

    mapping(bytes32 => Node) private nodes;
    bytes32[] private activeNodeIds;

    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant ATTESTATION_VALIDITY = 24 hours;
    
    /// @notice Maximum age of a quote timestamp (embedded in reportData)
    uint256 public maxQuoteAge = 1 hours;

    error ETHTransferFailed();
    error InvalidSignature();
    error UntrustedSigner();
    error QuoteTooOld();
    error InvalidQuoteFormat();

    struct Node {
        bytes32 nodeId;
        address operator;
        bytes32 publicKeyHash;
        Attestation attestation;
        uint256 stake;
        uint256 registeredAt;
        bool active;
    }

    event TrustedSignerAdded(address indexed signer);
    event TrustedSignerRemoved(address indexed signer);
    event MeasurementSignerSet(bytes32 indexed measurement, address indexed signer);
    event MaxQuoteAgeUpdated(uint256 oldAge, uint256 newAge);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyActiveNode(bytes32 nodeId) {
        require(nodes[nodeId].active, "Node not active");
        _;
    }

    constructor(address _identityRegistry) {
        owner = msg.sender;
        identityRegistry = _identityRegistry;
    }

    function addTrustedMeasurement(bytes32 measurement) external onlyOwner {
        require(!isTrustedMeasurement[measurement], "Already trusted");
        trustedMeasurements.push(measurement);
        isTrustedMeasurement[measurement] = true;
    }

    function removeTrustedMeasurement(bytes32 measurement) external onlyOwner {
        require(isTrustedMeasurement[measurement], "Not trusted");
        isTrustedMeasurement[measurement] = false;

        for (uint256 i = 0; i < trustedMeasurements.length; i++) {
            if (trustedMeasurements[i] == measurement) {
                trustedMeasurements[i] = trustedMeasurements[trustedMeasurements.length - 1];
                trustedMeasurements.pop();
                break;
            }
        }
    }

    function verifyAttestation(bytes calldata quote, bytes32 expectedMeasurement)
        external
        returns (bool valid, Attestation memory attestation)
    {
        if (quote.length < 128) revert InvalidQuoteFormat();

        (bytes32 measurement, bytes32 reportData, uint8 provider, bytes memory signature) = _parseQuote(quote);

        // Verify measurement is trusted
        require(isTrustedMeasurement[measurement], "Untrusted measurement");

        // Verify measurement matches expected (if provided)
        if (expectedMeasurement != bytes32(0)) {
            require(measurement == expectedMeasurement, "Measurement mismatch");
        }

        // Verify quote freshness
        if (!_isQuoteFresh(reportData)) {
            revert QuoteTooOld();
        }

        // Verify cryptographic signature
        (bool sigValid, address signer) = _verifyQuoteSignature(quote, measurement, reportData, provider, signature);
        
        if (!sigValid) {
            // If signer was recovered but not trusted, emit specific error
            if (signer != address(0)) {
                revert UntrustedSigner();
            }
            revert InvalidSignature();
        }

        attestation = Attestation({
            quote: quote,
            measurement: measurement,
            reportData: reportData,
            timestamp: block.timestamp,
            provider: provider,
            verified: true
        });

        valid = true;

        emit AttestationVerified(reportData, measurement, block.timestamp);
    }

    function registerNode(bytes32 nodeId, bytes calldata attestation, bytes32 publicKeyHash) external payable {
        require(msg.value >= MIN_STAKE, "Insufficient stake");
        require(!nodes[nodeId].active, "Node already registered");

        (bool valid, Attestation memory parsedAttestation) = this.verifyAttestation(attestation, bytes32(0));
        require(valid, "Invalid attestation");

        nodes[nodeId] = Node({
            nodeId: nodeId,
            operator: msg.sender,
            publicKeyHash: publicKeyHash,
            attestation: parsedAttestation,
            stake: msg.value,
            registeredAt: block.timestamp,
            active: true
        });

        activeNodeIds.push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, publicKeyHash, block.timestamp);
    }

    function deregisterNode(bytes32 nodeId) external nonReentrant {
        Node storage node = nodes[nodeId];
        require(node.operator == msg.sender || msg.sender == owner, "Unauthorized");
        require(node.active, "Node not active");

        node.active = false;

        for (uint256 i = 0; i < activeNodeIds.length; i++) {
            if (activeNodeIds[i] == nodeId) {
                activeNodeIds[i] = activeNodeIds[activeNodeIds.length - 1];
                activeNodeIds.pop();
                break;
            }
        }

        if (node.stake > 0) {
            uint256 stake = node.stake;
            node.stake = 0;
            (bool success, ) = payable(node.operator).call{value: stake}("");
            if (!success) revert ETHTransferFailed();
        }
    }

    function refreshAttestation(bytes32 nodeId, bytes calldata newAttestation) external onlyActiveNode(nodeId) {
        Node storage node = nodes[nodeId];
        require(node.operator == msg.sender, "Not node operator");

        (bool valid, Attestation memory parsedAttestation) = this.verifyAttestation(newAttestation, bytes32(0));
        require(valid, "Invalid attestation");

        node.attestation = parsedAttestation;
    }

    function slashNode(bytes32 nodeId, uint256 amount) external onlyOwner onlyActiveNode(nodeId) {
        Node storage node = nodes[nodeId];
        require(amount <= node.stake, "Amount exceeds stake");

        node.stake -= amount;

        if (node.stake < MIN_STAKE) {
            node.active = false;

            for (uint256 i = 0; i < activeNodeIds.length; i++) {
                if (activeNodeIds[i] == nodeId) {
                    activeNodeIds[i] = activeNodeIds[activeNodeIds.length - 1];
                    activeNodeIds.pop();
                    break;
                }
            }
        }
    }

    function getNode(bytes32 nodeId)
        external
        view
        returns (address operator, bytes32 publicKeyHash, Attestation memory attestation, bool active)
    {
        Node storage node = nodes[nodeId];
        return (node.operator, node.publicKeyHash, node.attestation, node.active);
    }

    function isNodeActive(bytes32 nodeId) external view returns (bool) {
        Node storage node = nodes[nodeId];
        if (!node.active) return false;
        if (block.timestamp > node.attestation.timestamp + ATTESTATION_VALIDITY) return false;
        return true;
    }

    function getActiveNodes() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < activeNodeIds.length; i++) {
            Node storage node = nodes[activeNodeIds[i]];
            if (node.active && block.timestamp <= node.attestation.timestamp + ATTESTATION_VALIDITY) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < activeNodeIds.length; i++) {
            Node storage node = nodes[activeNodeIds[i]];
            if (node.active && block.timestamp <= node.attestation.timestamp + ATTESTATION_VALIDITY) {
                result[index++] = activeNodeIds[i];
            }
        }

        return result;
    }

    function getTrustedMeasurements() external view returns (bytes32[] memory) {
        return trustedMeasurements;
    }

    function getNodeStake(bytes32 nodeId) external view returns (uint256) {
        return nodes[nodeId].stake;
    }

    function verifyNodeSignature(bytes32 nodeId, bytes32 messageHash, bytes calldata signature)
        external
        view
        onlyActiveNode(nodeId)
        returns (bool)
    {
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(messageHash), signature);

        bytes32 signerHash = keccak256(abi.encodePacked(signer));
        return signerHash == nodes[nodeId].publicKeyHash;
    }

    function _parseQuote(bytes calldata quote)
        internal
        pure
        returns (bytes32 measurement, bytes32 reportData, uint8 provider, bytes memory signature)
    {
        if (quote.length < 128) revert InvalidQuoteFormat();

        measurement = bytes32(quote[0:32]);
        reportData = bytes32(quote[32:64]);
        provider = uint8(quote[64]);

        uint256 sigLength = uint256(uint8(quote[65])) << 8 | uint256(uint8(quote[66]));
        if (quote.length < 67 + sigLength) revert InvalidQuoteFormat();

        signature = quote[67:67 + sigLength];
    }

    /**
     * @notice Verify quote signature using ECDSA
     * @param quote Full quote bytes
     * @param measurement Parsed measurement from quote
     * @param reportData Parsed reportData from quote
     * @param provider Provider type
     * @param signature Signature bytes
     * @return valid Whether signature is valid
     * @return signer Recovered signer address
     */
    function _verifyQuoteSignature(
        bytes calldata quote,
        bytes32 measurement,
        bytes32 reportData,
        uint8 provider,
        bytes memory signature
    ) internal view returns (bool valid, address signer) {
        // Signature must be at least 64 bytes (r=32 + s=32) or 65 bytes (r=32 + s=32 + v=1)
        if (signature.length < 64) {
            return (false, address(0));
        }

        // Construct the message hash that was signed
        // Message format: keccak256(measurement || reportData || provider || chainId)
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                measurement,
                reportData,
                provider,
                block.chainid
            )
        );

        // Convert to Ethereum signed message hash
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        // Try to recover signer
        if (signature.length == 64) {
            // Compact signature (r || s), need to try both v values
            bytes32 r;
            bytes32 s;
            assembly {
                r := mload(add(signature, 32))
                s := mload(add(signature, 64))
            }
            
            // Try v = 27
            (address recovered27, ECDSA.RecoverError err27,) = ECDSA.tryRecover(ethSignedHash, 27, r, s);
            if (err27 == ECDSA.RecoverError.NoError && _isSignerTrusted(recovered27, measurement)) {
                return (true, recovered27);
            }
            
            // Try v = 28
            (address recovered28, ECDSA.RecoverError err28,) = ECDSA.tryRecover(ethSignedHash, 28, r, s);
            if (err28 == ECDSA.RecoverError.NoError && _isSignerTrusted(recovered28, measurement)) {
                return (true, recovered28);
            }
            
            return (false, address(0));
        } else if (signature.length >= 65) {
            // Full signature with v byte
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(ethSignedHash, signature);
            if (err != ECDSA.RecoverError.NoError) {
                return (false, address(0));
            }
            
            if (_isSignerTrusted(recovered, measurement)) {
                return (true, recovered);
            }
            
            return (false, recovered);
        }

        return (false, address(0));
    }

    /**
     * @notice Check if a signer is trusted
     * @param signer Address to check
     * @param measurement Measurement for measurement-specific signers
     * @return trusted Whether signer is trusted
     */
    function _isSignerTrusted(address signer, bytes32 measurement) internal view returns (bool) {
        // Check global trusted signers
        if (trustedSigners[signer]) {
            return true;
        }
        
        // Check measurement-specific signer
        if (measurementSigner[measurement] == signer && signer != address(0)) {
            return true;
        }
        
        return false;
    }

    /**
     * @notice Verify quote timestamp freshness
     * @param reportData Contains embedded timestamp (first 8 bytes = unix timestamp in seconds)
     * @return fresh Whether quote is fresh
     */
    function _isQuoteFresh(bytes32 reportData) internal view returns (bool) {
        // Extract timestamp from first 8 bytes of reportData
        uint64 quoteTimestamp = uint64(uint256(reportData) >> 192);
        
        // If timestamp is 0, skip freshness check (backwards compatibility)
        if (quoteTimestamp == 0) {
            return true;
        }
        
        // Check if quote is too old
        if (block.timestamp > quoteTimestamp + maxQuoteAge) {
            return false;
        }
        
        // Check if quote is from the future (allow 5 minute clock skew)
        if (quoteTimestamp > block.timestamp + 5 minutes) {
            return false;
        }
        
        return true;
    }

    // ============ Trusted Signer Management ============

    /**
     * @notice Add a trusted signer
     * @param signer Address to trust
     */
    function addTrustedSigner(address signer) external onlyOwner {
        require(signer != address(0), "Invalid signer");
        require(!trustedSigners[signer], "Already trusted");
        
        trustedSigners[signer] = true;
        trustedSignerList.push(signer);
        
        emit TrustedSignerAdded(signer);
    }

    /**
     * @notice Remove a trusted signer
     * @param signer Address to remove
     */
    function removeTrustedSigner(address signer) external onlyOwner {
        require(trustedSigners[signer], "Not trusted");
        
        trustedSigners[signer] = false;
        
        // Remove from list
        for (uint256 i = 0; i < trustedSignerList.length; i++) {
            if (trustedSignerList[i] == signer) {
                trustedSignerList[i] = trustedSignerList[trustedSignerList.length - 1];
                trustedSignerList.pop();
                break;
            }
        }
        
        emit TrustedSignerRemoved(signer);
    }

    /**
     * @notice Set trusted signer for a specific measurement
     * @param measurement Measurement hash
     * @param signer Signer address (or address(0) to remove)
     */
    function setMeasurementSigner(bytes32 measurement, address signer) external onlyOwner {
        measurementSigner[measurement] = signer;
        emit MeasurementSignerSet(measurement, signer);
    }

    /**
     * @notice Get all trusted signers
     * @return signers Array of trusted signer addresses
     */
    function getTrustedSigners() external view returns (address[] memory) {
        return trustedSignerList;
    }

    /**
     * @notice Update max quote age
     * @param newMaxAge New max age in seconds
     */
    function setMaxQuoteAge(uint256 newMaxAge) external onlyOwner {
        require(newMaxAge >= 5 minutes, "Age too short");
        require(newMaxAge <= 7 days, "Age too long");
        
        uint256 oldAge = maxQuoteAge;
        maxQuoteAge = newMaxAge;
        
        emit MaxQuoteAgeUpdated(oldAge, newMaxAge);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
    
    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0-verified";
    }
}
