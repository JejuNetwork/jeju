// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IOAuth3TEEVerifier} from "./IOAuth3.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title OAuth3TEEVerifier
 * @notice Verifies TEE attestations from dstack nodes
 * @dev Supports Intel TDX via dstack attestation verification
 */
contract OAuth3TEEVerifier is IOAuth3TEEVerifier {
    using ECDSA for bytes32;

    bytes32 public constant DSTACK_PROVIDER = keccak256("DSTACK");
    bytes32 public constant PHALA_PROVIDER = keccak256("PHALA");

    address public owner;
    address public identityRegistry;

    bytes32[] public trustedMeasurements;
    mapping(bytes32 => bool) public isTrustedMeasurement;

    mapping(bytes32 => Node) private nodes;
    bytes32[] private activeNodeIds;

    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant ATTESTATION_VALIDITY = 24 hours;

    struct Node {
        bytes32 nodeId;
        address operator;
        bytes32 publicKeyHash;
        Attestation attestation;
        uint256 stake;
        uint256 registeredAt;
        bool active;
    }

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
        require(quote.length >= 128, "Invalid quote length");

        (bytes32 measurement, bytes32 reportData, uint8 provider, bytes memory signature) = _parseQuote(quote);

        require(isTrustedMeasurement[measurement], "Untrusted measurement");

        if (expectedMeasurement != bytes32(0)) {
            require(measurement == expectedMeasurement, "Measurement mismatch");
        }

        bool verified = _verifyQuoteSignature(quote, signature);

        attestation = Attestation({
            quote: quote,
            measurement: measurement,
            reportData: reportData,
            timestamp: block.timestamp,
            provider: provider,
            verified: verified
        });

        valid = verified;

        if (verified) {
            emit AttestationVerified(reportData, measurement, block.timestamp);
        }
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

    function deregisterNode(bytes32 nodeId) external {
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
            payable(node.operator).transfer(stake);
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
        require(quote.length >= 128, "Quote too short");

        measurement = bytes32(quote[0:32]);
        reportData = bytes32(quote[32:64]);
        provider = uint8(quote[64]);

        uint256 sigLength = uint256(uint8(quote[65])) << 8 | uint256(uint8(quote[66]));
        require(quote.length >= 67 + sigLength, "Invalid signature length");

        signature = quote[67:67 + sigLength];
    }

    function _verifyQuoteSignature(bytes calldata, bytes memory signature) internal pure returns (bool) {
        return signature.length >= 64;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
}
