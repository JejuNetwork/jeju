// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SQLitRegistry
 * @notice Registry for SQLit block producers and miners on Jeju Network
 * @dev Integrates SQLit node operations with Jeju staking system
 * 
 * SQLit Architecture:
 * - Block Producers: Run the main DPoS chain, validate transactions
 * - Miners: Provide SQL storage and query execution for databases
 * 
 * All nodes must:
 * 1. Stake JEJU tokens through this contract
 * 2. Provide TEE attestation (production only)
 * 3. Maintain uptime requirements
 */
contract SQLitRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum NodeRole {
        BLOCK_PRODUCER,
        MINER
    }

    enum NodeStatus {
        PENDING,      // Registered, awaiting attestation
        ACTIVE,       // Fully operational
        SUSPENDED,    // Temporarily offline
        SLASHED,      // Penalized for misbehavior
        EXITING       // In unbonding period
    }

    struct SQLitNode {
        address operator;
        bytes32 nodeId;           // SQLit NodeID (64 hex chars)
        NodeRole role;
        NodeStatus status;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        string endpoint;          // RPC endpoint for this node
        bytes teeAttestation;     // TEE attestation quote
        bytes32 mrEnclave;        // Measurement of enclave
        uint256 databaseCount;    // Number of databases hosted (miners only)
        uint256 totalQueries;     // Lifetime query count
        uint256 slashedAmount;    // Total amount slashed
    }

    struct DatabaseInfo {
        bytes32 databaseId;       // SQLit DatabaseID
        address owner;
        bytes32[] minerNodeIds;   // Nodes hosting this database
        uint256 createdAt;
        bool active;
    }

    // ============ Constants ============

    uint256 public constant MIN_BP_STAKE = 100_000 ether;   // 100k JEJU for block producers
    uint256 public constant MIN_MINER_STAKE = 10_000 ether; // 10k JEJU for miners
    uint256 public constant UNBONDING_PERIOD = 14 days;
    uint256 public constant HEARTBEAT_INTERVAL = 1 hours;
    uint256 public constant MAX_MISSED_HEARTBEATS = 24;     // 24 hours offline = suspension
    uint256 public constant SLASH_PERCENT_DOWNTIME = 100;   // 1% for extended downtime
    uint256 public constant SLASH_PERCENT_INVALID = 500;    // 5% for invalid blocks
    uint256 public constant BPS = 10000;

    // ============ State ============

    IERC20 public immutable stakingToken;
    
    mapping(bytes32 => SQLitNode) public nodes;
    mapping(address => bytes32[]) public operatorNodes;
    mapping(bytes32 => DatabaseInfo) public databases;
    
    bytes32[] public blockProducers;
    bytes32[] public miners;
    
    uint256 public totalStaked;
    uint256 public totalDatabases;
    
    // Trusted enclave measurements (for TEE verification)
    mapping(bytes32 => bool) public trustedMeasurements;
    
    // Attestation verifier
    address public attestationVerifier;

    // ============ Events ============

    event NodeRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        NodeRole role,
        uint256 stake
    );
    
    event NodeActivated(bytes32 indexed nodeId, bytes32 mrEnclave);
    event NodeSuspended(bytes32 indexed nodeId, string reason);
    event NodeExiting(bytes32 indexed nodeId, uint256 unbondingEnds);
    event NodeSlashed(bytes32 indexed nodeId, uint256 amount, string reason);
    event StakeAdded(bytes32 indexed nodeId, uint256 amount);
    event StakeWithdrawn(bytes32 indexed nodeId, uint256 amount);
    event HeartbeatReceived(bytes32 indexed nodeId, uint256 timestamp);
    event DatabaseCreated(bytes32 indexed databaseId, address indexed owner);
    event DatabaseAssigned(bytes32 indexed databaseId, bytes32 indexed nodeId);
    event TrustedMeasurementAdded(bytes32 indexed mrEnclave);
    event TrustedMeasurementRemoved(bytes32 indexed mrEnclave);

    // ============ Constructor ============

    constructor(address _stakingToken, address _owner) Ownable(_owner) {
        stakingToken = IERC20(_stakingToken);
    }

    // ============ Registration ============

    /**
     * @notice Register a new SQLit node
     * @param nodeId The 32-byte SQLit NodeID
     * @param role BLOCK_PRODUCER or MINER
     * @param endpoint RPC endpoint for this node
     * @param stakeAmount Initial stake amount
     */
    function registerNode(
        bytes32 nodeId,
        NodeRole role,
        string calldata endpoint,
        uint256 stakeAmount
    ) external nonReentrant whenNotPaused {
        if (nodes[nodeId].registeredAt != 0) revert NodeAlreadyRegistered();
        
        uint256 minStake = role == NodeRole.BLOCK_PRODUCER ? MIN_BP_STAKE : MIN_MINER_STAKE;
        if (stakeAmount < minStake) revert InsufficientStake();
        
        // Transfer stake
        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);
        
        nodes[nodeId] = SQLitNode({
            operator: msg.sender,
            nodeId: nodeId,
            role: role,
            status: NodeStatus.PENDING,
            stakedAmount: stakeAmount,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            endpoint: endpoint,
            teeAttestation: "",
            mrEnclave: bytes32(0),
            databaseCount: 0,
            totalQueries: 0,
            slashedAmount: 0
        });
        
        operatorNodes[msg.sender].push(nodeId);
        
        if (role == NodeRole.BLOCK_PRODUCER) {
            blockProducers.push(nodeId);
        } else {
            miners.push(nodeId);
        }
        
        totalStaked += stakeAmount;
        
        emit NodeRegistered(nodeId, msg.sender, role, stakeAmount);
    }

    /**
     * @notice Submit TEE attestation to activate node
     * @param nodeId The node to activate
     * @param attestation Raw TEE attestation quote
     * @param mrEnclave Expected enclave measurement
     */
    function submitAttestation(
        bytes32 nodeId,
        bytes calldata attestation,
        bytes32 mrEnclave
    ) external nonReentrant {
        SQLitNode storage node = nodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        if (node.status != NodeStatus.PENDING) revert InvalidNodeStatus();
        
        // Verify attestation (in production, calls attestation verifier)
        if (attestationVerifier != address(0)) {
            (bool valid,) = attestationVerifier.staticcall(
                abi.encodeWithSignature(
                    "verifyAttestation(bytes,bytes32)",
                    attestation,
                    mrEnclave
                )
            );
            if (!valid) revert AttestationFailed();
        }
        
        // Check if measurement is trusted
        if (!trustedMeasurements[mrEnclave]) revert UntrustedMeasurement();
        
        node.teeAttestation = attestation;
        node.mrEnclave = mrEnclave;
        node.status = NodeStatus.ACTIVE;
        node.lastHeartbeat = block.timestamp;
        
        emit NodeActivated(nodeId, mrEnclave);
    }

    // ============ Operations ============

    /**
     * @notice Send heartbeat to prove node is online
     * @param nodeId The node sending heartbeat
     * @param queryCount Number of queries processed since last heartbeat
     */
    function heartbeat(bytes32 nodeId, uint256 queryCount) external {
        SQLitNode storage node = nodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        if (node.status != NodeStatus.ACTIVE) revert InvalidNodeStatus();
        
        node.lastHeartbeat = block.timestamp;
        node.totalQueries += queryCount;
        
        emit HeartbeatReceived(nodeId, block.timestamp);
    }

    /**
     * @notice Add stake to an existing node
     * @param nodeId The node to add stake to
     * @param amount Amount to add
     */
    function addStake(bytes32 nodeId, uint256 amount) external nonReentrant {
        SQLitNode storage node = nodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        if (node.status == NodeStatus.EXITING) revert NodeIsExiting();
        
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        node.stakedAmount += amount;
        totalStaked += amount;
        
        emit StakeAdded(nodeId, amount);
    }

    /**
     * @notice Begin exit process for a node
     * @param nodeId The node to exit
     */
    function initiateExit(bytes32 nodeId) external nonReentrant {
        SQLitNode storage node = nodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        if (node.status == NodeStatus.EXITING) revert NodeIsExiting();
        
        // Cannot exit if hosting databases
        if (node.databaseCount > 0) revert NodeHasDatabases();
        
        node.status = NodeStatus.EXITING;
        
        emit NodeExiting(nodeId, block.timestamp + UNBONDING_PERIOD);
    }

    /**
     * @notice Complete exit and withdraw stake
     * @param nodeId The node to complete exit for
     */
    function completeExit(bytes32 nodeId) external nonReentrant {
        SQLitNode storage node = nodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        if (node.status != NodeStatus.EXITING) revert InvalidNodeStatus();
        if (block.timestamp < node.registeredAt + UNBONDING_PERIOD) revert UnbondingNotComplete();
        
        uint256 amount = node.stakedAmount;
        node.stakedAmount = 0;
        totalStaked -= amount;
        
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit StakeWithdrawn(nodeId, amount);
    }

    // ============ Database Management ============

    /**
     * @notice Create a new database
     * @param databaseId The SQLit DatabaseID
     * @param minerNodeIds Nodes that will host this database
     */
    function createDatabase(
        bytes32 databaseId,
        bytes32[] calldata minerNodeIds
    ) external nonReentrant whenNotPaused {
        if (databases[databaseId].createdAt != 0) revert DatabaseAlreadyExists();
        if (minerNodeIds.length == 0) revert NoMinersSpecified();
        
        // Verify all miners are active
        for (uint256 i = 0; i < minerNodeIds.length; i++) {
            SQLitNode storage node = nodes[minerNodeIds[i]];
            if (node.status != NodeStatus.ACTIVE) revert InvalidNodeStatus();
            if (node.role != NodeRole.MINER) revert NotMinerNode();
            node.databaseCount++;
        }
        
        databases[databaseId] = DatabaseInfo({
            databaseId: databaseId,
            owner: msg.sender,
            minerNodeIds: minerNodeIds,
            createdAt: block.timestamp,
            active: true
        });
        
        totalDatabases++;
        
        emit DatabaseCreated(databaseId, msg.sender);
        for (uint256 i = 0; i < minerNodeIds.length; i++) {
            emit DatabaseAssigned(databaseId, minerNodeIds[i]);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Add a trusted enclave measurement
     * @param mrEnclave The measurement to trust
     */
    function addTrustedMeasurement(bytes32 mrEnclave) external onlyOwner {
        trustedMeasurements[mrEnclave] = true;
        emit TrustedMeasurementAdded(mrEnclave);
    }

    /**
     * @notice Remove a trusted enclave measurement
     * @param mrEnclave The measurement to remove
     */
    function removeTrustedMeasurement(bytes32 mrEnclave) external onlyOwner {
        trustedMeasurements[mrEnclave] = false;
        emit TrustedMeasurementRemoved(mrEnclave);
    }

    /**
     * @notice Set the attestation verifier contract
     * @param _verifier Address of the verifier contract
     */
    function setAttestationVerifier(address _verifier) external onlyOwner {
        attestationVerifier = _verifier;
    }

    /**
     * @notice Slash a node for misbehavior
     * @param nodeId Node to slash
     * @param bps Slash amount in basis points
     * @param reason Reason for slashing
     */
    function slashNode(
        bytes32 nodeId,
        uint256 bps,
        string calldata reason
    ) external onlyOwner {
        SQLitNode storage node = nodes[nodeId];
        if (node.registeredAt == 0) revert NodeNotFound();
        
        uint256 slashAmount = (node.stakedAmount * bps) / BPS;
        node.stakedAmount -= slashAmount;
        node.slashedAmount += slashAmount;
        node.status = NodeStatus.SLASHED;
        totalStaked -= slashAmount;
        
        // Transfer slashed tokens to treasury (owner for now)
        stakingToken.safeTransfer(owner(), slashAmount);
        
        emit NodeSlashed(nodeId, slashAmount, reason);
    }

    /**
     * @notice Suspend a node for extended downtime
     * @param nodeId Node to suspend
     */
    function suspendNode(bytes32 nodeId, string calldata reason) external onlyOwner {
        SQLitNode storage node = nodes[nodeId];
        if (node.registeredAt == 0) revert NodeNotFound();
        
        node.status = NodeStatus.SUSPENDED;
        emit NodeSuspended(nodeId, reason);
    }

    /**
     * @notice Reactivate a suspended node
     * @param nodeId Node to reactivate
     */
    function reactivateNode(bytes32 nodeId) external onlyOwner {
        SQLitNode storage node = nodes[nodeId];
        if (node.status != NodeStatus.SUSPENDED && node.status != NodeStatus.SLASHED) {
            revert InvalidNodeStatus();
        }
        
        node.status = NodeStatus.ACTIVE;
        node.lastHeartbeat = block.timestamp;
        
        emit NodeActivated(nodeId, node.mrEnclave);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    function getNode(bytes32 nodeId) external view returns (SQLitNode memory) {
        return nodes[nodeId];
    }

    function getOperatorNodes(address operator) external view returns (bytes32[] memory) {
        return operatorNodes[operator];
    }

    function getBlockProducerCount() external view returns (uint256) {
        return blockProducers.length;
    }

    function getMinerCount() external view returns (uint256) {
        return miners.length;
    }

    function getActiveBlockProducers() external view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < blockProducers.length; i++) {
            if (nodes[blockProducers[i]].status == NodeStatus.ACTIVE) {
                activeCount++;
            }
        }
        
        bytes32[] memory active = new bytes32[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < blockProducers.length; i++) {
            if (nodes[blockProducers[i]].status == NodeStatus.ACTIVE) {
                active[j++] = blockProducers[i];
            }
        }
        return active;
    }

    function getActiveMiners() external view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < miners.length; i++) {
            if (nodes[miners[i]].status == NodeStatus.ACTIVE) {
                activeCount++;
            }
        }
        
        bytes32[] memory active = new bytes32[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < miners.length; i++) {
            if (nodes[miners[i]].status == NodeStatus.ACTIVE) {
                active[j++] = miners[i];
            }
        }
        return active;
    }

    function getDatabaseInfo(bytes32 databaseId) external view returns (DatabaseInfo memory) {
        return databases[databaseId];
    }

    function isNodeHealthy(bytes32 nodeId) external view returns (bool) {
        SQLitNode storage node = nodes[nodeId];
        if (node.status != NodeStatus.ACTIVE) return false;
        return block.timestamp - node.lastHeartbeat <= HEARTBEAT_INTERVAL * MAX_MISSED_HEARTBEATS;
    }

    // ============ Errors ============

    error NodeAlreadyRegistered();
    error InsufficientStake();
    error NotNodeOperator();
    error InvalidNodeStatus();
    error AttestationFailed();
    error UntrustedMeasurement();
    error NodeIsExiting();
    error NodeHasDatabases();
    error UnbondingNotComplete();
    error DatabaseAlreadyExists();
    error NoMinersSpecified();
    error NotMinerNode();
    error NodeNotFound();
}

