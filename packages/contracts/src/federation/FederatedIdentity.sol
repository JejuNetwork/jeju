// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {FederationBase} from "./FederationBase.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title FederatedIdentity
 * @author Jeju Network
 * @notice Cross-network identity attestation layer
 * @dev Works alongside local IdentityRegistry to enable cross-network identity verification
 *
 * Architecture:
 * - Each network has its own IdentityRegistry (ERC-8004)
 * - FederatedIdentity bridges identities across networks
 * - Uses oracle attestations for cross-chain verification
 * - Integrates with governance for dispute resolution
 */
contract FederatedIdentity is FederationBase {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct FederatedAgent {
        uint256 originChainId;
        uint256 originAgentId;
        address originOwner;
        bytes32 originRegistryHash;
        uint256 federatedAt;
        bool isActive;
        uint256 reputationScore;
    }

    struct CrossNetworkAttestation {
        uint256 targetChainId;
        uint256 attestedAt;
        address attester;
        bytes32 attestationHash;
    }

    // ============================================================================
    // State
    // ============================================================================

    address public localIdentityRegistry;

    mapping(bytes32 => FederatedAgent) public federatedAgents;
    mapping(uint256 => mapping(uint256 => bytes32)) public agentToFederatedId;
    mapping(bytes32 => CrossNetworkAttestation[]) public attestations;
    mapping(address => bool) public authorizedAttesters;

    bytes32[] public allFederatedIds;
    uint256 public totalFederatedAgents;

    // ============================================================================
    // Events
    // ============================================================================

    event AgentFederated(
        bytes32 indexed federatedId, uint256 indexed originChainId, uint256 originAgentId, address indexed originOwner
    );
    event CrossNetworkAttested(bytes32 indexed federatedId, uint256 indexed targetChainId, address attester);
    event AgentDefederated(bytes32 indexed federatedId);
    event ReputationUpdated(bytes32 indexed federatedId, uint256 oldScore, uint256 newScore);
    event AttesterUpdated(address indexed attester, bool authorized);

    // ============================================================================
    // Errors
    // ============================================================================

    error InvalidOrigin();
    error AlreadyFederated();
    error NotFederated();
    error UnauthorizedAttester();
    error InvalidAttestation();
    error AgentInactive();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        uint256 _localChainId,
        address _oracle,
        address _governance,
        address _networkRegistry,
        address _localIdentityRegistry
    ) FederationBase(_localChainId, _oracle, _governance, _networkRegistry) {
        localIdentityRegistry = _localIdentityRegistry;
    }

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyAuthorizedAttester() {
        if (!authorizedAttesters[msg.sender] && msg.sender != oracle) {
            revert UnauthorizedAttester();
        }
        _;
    }

    // ============================================================================
    // Federation Functions
    // ============================================================================

    function federateLocalAgent(uint256 localAgentId, bytes calldata ownershipProof) external nonReentrant {
        bytes32 federatedId = computeFederatedId(LOCAL_CHAIN_ID, localAgentId);
        if (federatedAgents[federatedId].federatedAt != 0) revert AlreadyFederated();

        bytes32 messageHash = keccak256(abi.encodePacked(LOCAL_CHAIN_ID, localAgentId, msg.sender));
        if (!_verifySignature(messageHash, ownershipProof, msg.sender)) revert InvalidSignature();

        bytes32 registryHash = keccak256(abi.encodePacked(localIdentityRegistry, localAgentId));

        federatedAgents[federatedId] = FederatedAgent({
            originChainId: LOCAL_CHAIN_ID,
            originAgentId: localAgentId,
            originOwner: msg.sender,
            originRegistryHash: registryHash,
            federatedAt: block.timestamp,
            isActive: true,
            reputationScore: 100
        });

        agentToFederatedId[LOCAL_CHAIN_ID][localAgentId] = federatedId;
        allFederatedIds.push(federatedId);
        totalFederatedAgents++;

        emit AgentFederated(federatedId, LOCAL_CHAIN_ID, localAgentId, msg.sender);
    }

    function registerRemoteAgent(
        uint256 originChainId,
        uint256 originAgentId,
        address originOwner,
        bytes32 originRegistryHash,
        bytes calldata oracleAttestation
    ) external onlyAuthorizedAttester nonReentrant {
        if (originChainId == LOCAL_CHAIN_ID) revert InvalidOrigin();

        bytes32 federatedId = computeFederatedId(originChainId, originAgentId);
        if (federatedAgents[federatedId].federatedAt != 0) revert AlreadyFederated();

        bytes32 attestationHash =
            keccak256(abi.encodePacked(originChainId, originAgentId, originOwner, originRegistryHash));
        bytes32 signedHash = attestationHash.toEthSignedMessageHash();
        address attester = signedHash.recover(oracleAttestation);

        if (!authorizedAttesters[attester] && attester != oracle) {
            revert InvalidAttestation();
        }

        federatedAgents[federatedId] = FederatedAgent({
            originChainId: originChainId,
            originAgentId: originAgentId,
            originOwner: originOwner,
            originRegistryHash: originRegistryHash,
            federatedAt: block.timestamp,
            isActive: true,
            reputationScore: 100
        });

        agentToFederatedId[originChainId][originAgentId] = federatedId;
        allFederatedIds.push(federatedId);
        totalFederatedAgents++;

        attestations[federatedId].push(
            CrossNetworkAttestation({
                targetChainId: LOCAL_CHAIN_ID,
                attestedAt: block.timestamp,
                attester: attester,
                attestationHash: attestationHash
            })
        );

        emit AgentFederated(federatedId, originChainId, originAgentId, originOwner);
        emit CrossNetworkAttested(federatedId, LOCAL_CHAIN_ID, attester);
    }

    function attestCrossNetwork(bytes32 federatedId, uint256 targetChainId, bytes calldata /* proof */ )
        external
        onlyAuthorizedAttester
    {
        FederatedAgent storage agent = federatedAgents[federatedId];
        if (agent.federatedAt == 0) revert NotFederated();
        if (!agent.isActive) revert AgentInactive();

        bytes32 attestationHash = keccak256(abi.encodePacked(federatedId, targetChainId, block.timestamp));

        attestations[federatedId].push(
            CrossNetworkAttestation({
                targetChainId: targetChainId,
                attestedAt: block.timestamp,
                attester: msg.sender,
                attestationHash: attestationHash
            })
        );

        emit CrossNetworkAttested(federatedId, targetChainId, msg.sender);
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function updateReputation(bytes32 federatedId, uint256 newScore) external onlyGovernance {
        FederatedAgent storage agent = federatedAgents[federatedId];
        if (agent.federatedAt == 0) revert NotFederated();

        uint256 oldScore = agent.reputationScore;
        agent.reputationScore = newScore;

        emit ReputationUpdated(federatedId, oldScore, newScore);
    }

    function deactivateAgent(bytes32 federatedId) external onlyGovernance {
        FederatedAgent storage agent = federatedAgents[federatedId];
        if (agent.federatedAt == 0) revert NotFederated();

        agent.isActive = false;
        emit AgentDefederated(federatedId);
    }

    function setAttester(address attester, bool authorized) external onlyGovernance {
        authorizedAttesters[attester] = authorized;
        emit AttesterUpdated(attester, authorized);
    }

    function setLocalIdentityRegistry(address _registry) external onlyGovernance {
        localIdentityRegistry = _registry;
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function computeFederatedId(uint256 chainId, uint256 agentId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("jeju:federated:", chainId, ":", agentId));
    }

    function getFederatedAgent(bytes32 federatedId) external view returns (FederatedAgent memory) {
        return federatedAgents[federatedId];
    }

    function getFederatedIdByOrigin(uint256 chainId, uint256 agentId) external view returns (bytes32) {
        return agentToFederatedId[chainId][agentId];
    }

    function getAttestations(bytes32 federatedId) external view returns (CrossNetworkAttestation[] memory) {
        return attestations[federatedId];
    }

    function isAttestedOn(bytes32 federatedId, uint256 chainId) external view returns (bool) {
        CrossNetworkAttestation[] storage atts = attestations[federatedId];
        for (uint256 i = 0; i < atts.length; i++) {
            if (atts[i].targetChainId == chainId) return true;
        }
        return false;
    }

    function verifyIdentity(uint256 originChainId, uint256 originAgentId)
        external
        view
        returns (bool isValid, bytes32 federatedId, uint256 reputation)
    {
        federatedId = agentToFederatedId[originChainId][originAgentId];
        if (federatedId == bytes32(0)) return (false, bytes32(0), 0);

        FederatedAgent storage agent = federatedAgents[federatedId];
        return (agent.isActive, federatedId, agent.reputationScore);
    }

    function getAllFederatedIds() external view returns (bytes32[] memory) {
        return allFederatedIds;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
