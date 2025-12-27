// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title MPCPartyRegistry
 * @notice Registry for MPC (Multi-Party Computation) parties that provide threshold signing
 * @dev MPC parties are dedicated TEE nodes that hold key shares for distributed signing.
 *      They are separate from application services and provide signing-as-a-service.
 *
 * Architecture:
 * - MPC parties register with TEE attestation proof
 * - Parties form clusters for threshold signing (t-of-n)
 * - Application services (OAuth3, Farcaster, etc.) request signatures from clusters
 * - Slashing for misbehavior (failed attestation, signing invalid messages)
 */
contract MPCPartyRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct MPCParty {
        uint256 agentId; // ERC-8004 IdentityRegistry agent ID
        address partyAddress; // EOA that controls this party
        string endpoint; // HTTP endpoint for MPC protocol
        bytes32 attestationHash; // Hash of TEE attestation quote
        uint256 attestationExpiry; // When attestation expires
        string teePlatform; // "intel_tdx", "amd_sev", "phala"
        uint256 stakedAmount; // Staked tokens for slashing
        PartyStatus status;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 signaturesProvided; // Total signatures this party contributed to
        uint256 slashCount; // Number of times slashed
    }

    struct MPCCluster {
        bytes32 clusterId;
        string name; // Human-readable name
        uint256 threshold; // Minimum parties needed to sign (t)
        uint256 totalParties; // Total parties in cluster (n)
        uint256[] partyAgentIds; // Agent IDs of parties in this cluster
        bytes groupPublicKey; // Aggregated public key
        address derivedAddress; // Ethereum address derived from public key
        address owner; // Who created/owns this cluster
        uint256 createdAt;
        ClusterStatus status;
        uint256 signaturesCompleted; // Total signatures produced
    }

    struct SigningSession {
        bytes32 sessionId;
        bytes32 clusterId;
        bytes32 messageHash;
        address requester;
        uint256 createdAt;
        uint256 expiresAt;
        SessionStatus status;
        uint256 sharesCollected;
    }

    enum PartyStatus {
        Inactive,
        Active,
        Slashed,
        Exiting
    }
    enum ClusterStatus {
        Pending,
        Active,
        Rotating,
        Dissolved
    }
    enum SessionStatus {
        Pending,
        Signing,
        Complete,
        Expired,
        Failed
    }

    // ============ State ============

    IIdentityRegistry public identityRegistry;
    IERC20 public stakeToken;

    mapping(uint256 => MPCParty) public parties; // agentId => Party
    mapping(bytes32 => MPCCluster) public clusters; // clusterId => Cluster
    mapping(bytes32 => SigningSession) public sessions; // sessionId => Session
    mapping(address => uint256) public addressToAgentId; // party address => agentId

    uint256[] public activePartyIds;
    bytes32[] public activeClusterIds;

    // Configuration
    uint256 public minPartyStake;
    uint256 public attestationValidity;
    uint256 public sessionTimeout;
    uint256 public heartbeatInterval;
    uint256 public slashPercentage;

    // Authorized services that can request signatures
    mapping(address => bool) public authorizedServices;
    mapping(uint256 => bool) public authorizedServiceAgents; // ERC-8004 agent IDs

    // ============ Events ============

    event PartyRegistered(uint256 indexed agentId, address indexed partyAddress, string endpoint, string teePlatform);
    event PartyStatusChanged(uint256 indexed agentId, PartyStatus oldStatus, PartyStatus newStatus);
    event AttestationRefreshed(uint256 indexed agentId, bytes32 attestationHash, uint256 expiresAt);
    event PartySlashed(uint256 indexed agentId, uint256 amount, string reason);
    event PartyExiting(uint256 indexed agentId, uint256 exitableAt);

    event ClusterCreated(
        bytes32 indexed clusterId, string name, uint256 threshold, uint256 totalParties, address owner
    );
    event ClusterKeyGenerated(bytes32 indexed clusterId, bytes groupPublicKey, address derivedAddress);
    event ClusterStatusChanged(bytes32 indexed clusterId, ClusterStatus oldStatus, ClusterStatus newStatus);
    event ClusterDissolved(bytes32 indexed clusterId);

    event SigningSessionCreated(
        bytes32 indexed sessionId, bytes32 indexed clusterId, bytes32 messageHash, address requester
    );
    event SigningSessionCompleted(bytes32 indexed sessionId, bytes signature);
    event SigningSessionFailed(bytes32 indexed sessionId, string reason);

    event ServiceAuthorized(address indexed service, bool authorized);
    event ServiceAgentAuthorized(uint256 indexed agentId, bool authorized);

    // ============ Errors ============

    error PartyAlreadyRegistered();
    error PartyNotFound();
    error PartyNotActive();
    error InsufficientStake();
    error InvalidAttestation();
    error AttestationExpired();
    error ClusterNotFound();
    error ClusterNotActive();
    error InvalidThreshold();
    error PartyNotInCluster();
    error SessionNotFound();
    error SessionExpired();
    error UnauthorizedService();
    error HeartbeatTooFrequent();
    error InvalidPartyCount();

    // ============ Constructor ============

    constructor(address _identityRegistry, address _stakeToken, uint256 _minPartyStake) Ownable(msg.sender) {
        identityRegistry = IIdentityRegistry(_identityRegistry);
        stakeToken = IERC20(_stakeToken);
        minPartyStake = _minPartyStake;
        attestationValidity = 24 hours;
        sessionTimeout = 5 minutes;
        heartbeatInterval = 1 minutes;
        slashPercentage = 1000; // 10% in basis points
    }

    // ============ Party Management ============

    /**
     * @notice Register as an MPC party
     * @param agentId ERC-8004 agent ID (must be owned by msg.sender)
     * @param endpoint HTTP endpoint for MPC protocol
     * @param teePlatform TEE platform identifier
     * @param attestation TEE attestation quote
     * @param stakeAmount Amount to stake
     */
    function registerParty(
        uint256 agentId,
        string calldata endpoint,
        string calldata teePlatform,
        bytes calldata attestation,
        uint256 stakeAmount
    ) external nonReentrant {
        if (parties[agentId].partyAddress != address(0)) revert PartyAlreadyRegistered();
        if (stakeAmount < minPartyStake) revert InsufficientStake();

        // Verify caller owns the agent
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (agentOwner != msg.sender) revert UnauthorizedService();

        // Verify attestation (basic hash check - real impl would verify quote)
        bytes32 attestationHash = keccak256(attestation);
        if (attestationHash == bytes32(0)) revert InvalidAttestation();

        // Transfer stake
        stakeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        parties[agentId] = MPCParty({
            agentId: agentId,
            partyAddress: msg.sender,
            endpoint: endpoint,
            attestationHash: attestationHash,
            attestationExpiry: block.timestamp + attestationValidity,
            teePlatform: teePlatform,
            stakedAmount: stakeAmount,
            status: PartyStatus.Active,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            signaturesProvided: 0,
            slashCount: 0
        });

        addressToAgentId[msg.sender] = agentId;
        activePartyIds.push(agentId);

        emit PartyRegistered(agentId, msg.sender, endpoint, teePlatform);
    }

    /**
     * @notice Refresh TEE attestation
     */
    function refreshAttestation(uint256 agentId, bytes calldata attestation) external {
        MPCParty storage party = parties[agentId];
        if (party.partyAddress == address(0)) revert PartyNotFound();
        if (party.partyAddress != msg.sender) revert UnauthorizedService();

        bytes32 attestationHash = keccak256(attestation);
        if (attestationHash == bytes32(0)) revert InvalidAttestation();

        party.attestationHash = attestationHash;
        party.attestationExpiry = block.timestamp + attestationValidity;

        // Reactivate if was inactive due to expired attestation
        if (party.status == PartyStatus.Inactive) {
            party.status = PartyStatus.Active;
            emit PartyStatusChanged(agentId, PartyStatus.Inactive, PartyStatus.Active);
        }

        emit AttestationRefreshed(agentId, attestationHash, party.attestationExpiry);
    }

    /**
     * @notice Send heartbeat to prove party is online
     */
    function heartbeat(uint256 agentId) external {
        MPCParty storage party = parties[agentId];
        if (party.partyAddress == address(0)) revert PartyNotFound();
        if (party.partyAddress != msg.sender) revert UnauthorizedService();

        // Rate limit heartbeats
        if (block.timestamp - party.lastHeartbeat < heartbeatInterval) {
            revert HeartbeatTooFrequent();
        }

        party.lastHeartbeat = block.timestamp;

        // Check attestation expiry
        if (party.attestationExpiry < block.timestamp && party.status == PartyStatus.Active) {
            party.status = PartyStatus.Inactive;
            emit PartyStatusChanged(agentId, PartyStatus.Active, PartyStatus.Inactive);
        }
    }

    /**
     * @notice Begin exit process to withdraw stake
     */
    function initiateExit(uint256 agentId) external {
        MPCParty storage party = parties[agentId];
        if (party.partyAddress == address(0)) revert PartyNotFound();
        if (party.partyAddress != msg.sender) revert UnauthorizedService();

        PartyStatus oldStatus = party.status;
        party.status = PartyStatus.Exiting;

        emit PartyStatusChanged(agentId, oldStatus, PartyStatus.Exiting);
        emit PartyExiting(agentId, block.timestamp + 7 days);
    }

    /**
     * @notice Complete exit and withdraw stake (after cooldown)
     */
    function completeExit(uint256 agentId) external nonReentrant {
        MPCParty storage party = parties[agentId];
        if (party.partyAddress == address(0)) revert PartyNotFound();
        if (party.partyAddress != msg.sender) revert UnauthorizedService();
        if (party.status != PartyStatus.Exiting) revert PartyNotActive();

        uint256 stake = party.stakedAmount;
        party.stakedAmount = 0;
        party.status = PartyStatus.Inactive;

        // Remove from active parties
        _removeFromActiveParties(agentId);

        stakeToken.safeTransfer(msg.sender, stake);
    }

    // ============ Cluster Management ============

    /**
     * @notice Create a new MPC cluster for threshold signing
     * @param name Human-readable cluster name
     * @param threshold Minimum parties needed to sign (t)
     * @param partyAgentIds Agent IDs of parties to include
     */
    function createCluster(string calldata name, uint256 threshold, uint256[] calldata partyAgentIds)
        external
        returns (bytes32 clusterId)
    {
        uint256 totalParties = partyAgentIds.length;

        if (threshold < 2) revert InvalidThreshold();
        if (threshold > totalParties) revert InvalidThreshold();
        if (totalParties < 2) revert InvalidPartyCount();

        // Verify all parties are active
        for (uint256 i = 0; i < totalParties; i++) {
            MPCParty storage party = parties[partyAgentIds[i]];
            if (party.status != PartyStatus.Active) revert PartyNotActive();
            if (party.attestationExpiry < block.timestamp) revert AttestationExpired();
        }

        clusterId = keccak256(abi.encodePacked(name, block.timestamp, msg.sender, partyAgentIds));

        clusters[clusterId] = MPCCluster({
            clusterId: clusterId,
            name: name,
            threshold: threshold,
            totalParties: totalParties,
            partyAgentIds: partyAgentIds,
            groupPublicKey: "",
            derivedAddress: address(0),
            owner: msg.sender,
            createdAt: block.timestamp,
            status: ClusterStatus.Pending,
            signaturesCompleted: 0
        });

        activeClusterIds.push(clusterId);

        emit ClusterCreated(clusterId, name, threshold, totalParties, msg.sender);
    }

    /**
     * @notice Set the group public key after distributed key generation
     * @dev Called by cluster owner after off-chain DKG completes
     */
    function setClusterPublicKey(bytes32 clusterId, bytes calldata groupPublicKey, address derivedAddress) external {
        MPCCluster storage cluster = clusters[clusterId];
        if (cluster.owner == address(0)) revert ClusterNotFound();
        if (cluster.owner != msg.sender) revert UnauthorizedService();

        cluster.groupPublicKey = groupPublicKey;
        cluster.derivedAddress = derivedAddress;
        cluster.status = ClusterStatus.Active;

        emit ClusterKeyGenerated(clusterId, groupPublicKey, derivedAddress);
        emit ClusterStatusChanged(clusterId, ClusterStatus.Pending, ClusterStatus.Active);
    }

    /**
     * @notice Dissolve a cluster
     */
    function dissolveCluster(bytes32 clusterId) external {
        MPCCluster storage cluster = clusters[clusterId];
        if (cluster.owner == address(0)) revert ClusterNotFound();
        if (cluster.owner != msg.sender && msg.sender != owner()) revert UnauthorizedService();

        ClusterStatus oldStatus = cluster.status;
        cluster.status = ClusterStatus.Dissolved;

        _removeFromActiveClusters(clusterId);

        emit ClusterStatusChanged(clusterId, oldStatus, ClusterStatus.Dissolved);
        emit ClusterDissolved(clusterId);
    }

    // ============ Signing Sessions ============

    /**
     * @notice Request a signature from a cluster
     * @dev Only authorized services can request signatures
     */
    function requestSignature(bytes32 clusterId, bytes32 messageHash) external returns (bytes32 sessionId) {
        if (!authorizedServices[msg.sender] && !authorizedServiceAgents[addressToAgentId[msg.sender]]) {
            revert UnauthorizedService();
        }

        MPCCluster storage cluster = clusters[clusterId];
        if (cluster.status != ClusterStatus.Active) revert ClusterNotActive();

        sessionId = keccak256(abi.encodePacked(clusterId, messageHash, block.timestamp, msg.sender));

        sessions[sessionId] = SigningSession({
            sessionId: sessionId,
            clusterId: clusterId,
            messageHash: messageHash,
            requester: msg.sender,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + sessionTimeout,
            status: SessionStatus.Pending,
            sharesCollected: 0
        });

        emit SigningSessionCreated(sessionId, clusterId, messageHash, msg.sender);
    }

    /**
     * @notice Report signing session complete (called by coordinator)
     */
    function reportSessionComplete(bytes32 sessionId, bytes calldata signature) external {
        SigningSession storage session = sessions[sessionId];
        if (session.requester == address(0)) revert SessionNotFound();
        if (session.status != SessionStatus.Pending && session.status != SessionStatus.Signing) {
            revert SessionExpired();
        }

        session.status = SessionStatus.Complete;

        // Update cluster stats
        MPCCluster storage cluster = clusters[session.clusterId];
        cluster.signaturesCompleted++;

        // Update party stats
        for (uint256 i = 0; i < cluster.partyAgentIds.length; i++) {
            parties[cluster.partyAgentIds[i]].signaturesProvided++;
        }

        emit SigningSessionCompleted(sessionId, signature);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a party for misbehavior
     * @dev Only owner can slash (governance in future)
     */
    function slashParty(uint256 agentId, string calldata reason) external onlyOwner {
        MPCParty storage party = parties[agentId];
        if (party.partyAddress == address(0)) revert PartyNotFound();

        uint256 slashAmount = (party.stakedAmount * slashPercentage) / 10000;
        party.stakedAmount -= slashAmount;
        party.slashCount++;

        if (party.slashCount >= 3) {
            party.status = PartyStatus.Slashed;
            _removeFromActiveParties(agentId);
        }

        // Transfer slashed amount to treasury (owner for now)
        stakeToken.safeTransfer(owner(), slashAmount);

        emit PartySlashed(agentId, slashAmount, reason);
    }

    // ============ Authorization ============

    function setServiceAuthorized(address service, bool authorized) external onlyOwner {
        authorizedServices[service] = authorized;
        emit ServiceAuthorized(service, authorized);
    }

    function setServiceAgentAuthorized(uint256 agentId, bool authorized) external onlyOwner {
        authorizedServiceAgents[agentId] = authorized;
        emit ServiceAgentAuthorized(agentId, authorized);
    }

    // ============ View Functions ============

    function getActiveParties() external view returns (uint256[] memory) {
        return activePartyIds;
    }

    function getActiveClusters() external view returns (bytes32[] memory) {
        return activeClusterIds;
    }

    function getClusterParties(bytes32 clusterId) external view returns (uint256[] memory) {
        return clusters[clusterId].partyAgentIds;
    }

    function isPartyActive(uint256 agentId) external view returns (bool) {
        MPCParty storage party = parties[agentId];
        return party.status == PartyStatus.Active && party.attestationExpiry >= block.timestamp;
    }

    function getPartyEndpoint(uint256 agentId) external view returns (string memory) {
        return parties[agentId].endpoint;
    }

    // ============ Admin ============

    function setMinPartyStake(uint256 _minPartyStake) external onlyOwner {
        minPartyStake = _minPartyStake;
    }

    function setAttestationValidity(uint256 _attestationValidity) external onlyOwner {
        attestationValidity = _attestationValidity;
    }

    function setSessionTimeout(uint256 _sessionTimeout) external onlyOwner {
        sessionTimeout = _sessionTimeout;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    // ============ Internal ============

    function _removeFromActiveParties(uint256 agentId) internal {
        for (uint256 i = 0; i < activePartyIds.length; i++) {
            if (activePartyIds[i] == agentId) {
                activePartyIds[i] = activePartyIds[activePartyIds.length - 1];
                activePartyIds.pop();
                break;
            }
        }
    }

    function _removeFromActiveClusters(bytes32 clusterId) internal {
        for (uint256 i = 0; i < activeClusterIds.length; i++) {
            if (activeClusterIds[i] == clusterId) {
                activeClusterIds[i] = activeClusterIds[activeClusterIds.length - 1];
                activeClusterIds.pop();
                break;
            }
        }
    }
}
