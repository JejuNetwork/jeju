// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MessageNodeRegistry
 * @notice Registry for decentralized messaging relay node operators
 * @dev Operators stake tokens to run relay nodes and earn fees from message delivery
 *
 * Key Features:
 * - Permissionless node registration with stake
 * - Performance-based rewards distribution
 * - Slashing for misbehavior (censorship, data leaks)
 * - Geographic diversity tracking
 * - x402 micropayment integration
 *
 * @custom:security-contact security@jeju.network
 */
contract MessageNodeRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct NodeInfo {
        bytes32 nodeId;
        address operator;
        string endpoint;           // HTTP/WebSocket endpoint
        string region;             // Geographic region (us-east, eu-west, etc.)
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 messagesRelayed;
        uint256 feesEarned;
        bool isActive;
        bool isSlashed;
    }

    struct PerformanceMetrics {
        uint256 uptimeScore;       // 0-10000 (100.00%)
        uint256 deliveryRate;      // 0-10000 (successful deliveries)
        uint256 avgLatencyMs;      // Average delivery latency
        uint256 lastUpdated;
    }

    // ============ State Variables ============

    IERC20 public immutable stakingToken;
    
    uint256 public minStake = 1000 ether;          // 1000 JEJU minimum
    uint256 public heartbeatInterval = 5 minutes;
    uint256 public slashPenaltyBPS = 5000;         // 50% slash
    uint256 public minStakingPeriod = 7 days;
    
    // Fee distribution
    uint256 public baseFeePerMessage = 0.0001 ether;  // ~$0.0001 per message
    uint256 public protocolFeeBPS = 500;              // 5% to protocol
    
    // Node tracking
    mapping(bytes32 => NodeInfo) public nodes;
    mapping(bytes32 => PerformanceMetrics) public performance;
    mapping(address => bytes32[]) public operatorNodes;
    bytes32[] public activeNodeIds;
    
    // Region tracking for load balancing
    mapping(string => bytes32[]) public nodesByRegion;
    
    // Fee accumulation
    mapping(bytes32 => uint256) public pendingFees;
    uint256 public protocolFees;
    
    // Performance oracles
    mapping(address => bool) public isPerformanceOracle;

    // ============ Events ============

    event NodeRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        string endpoint,
        string region,
        uint256 stakedAmount
    );
    event NodeDeregistered(bytes32 indexed nodeId, address indexed operator);
    event NodeHeartbeat(bytes32 indexed nodeId, uint256 timestamp);
    event NodeSlashed(bytes32 indexed nodeId, uint256 slashAmount, string reason);
    event PerformanceUpdated(bytes32 indexed nodeId, uint256 uptimeScore, uint256 deliveryRate);
    event FeesAccrued(bytes32 indexed nodeId, uint256 amount);
    event FeesClaimed(bytes32 indexed nodeId, address indexed operator, uint256 amount);
    event ProtocolFeesClaimed(address indexed recipient, uint256 amount);
    event EndpointUpdated(bytes32 indexed nodeId, string newEndpoint);

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error NodeNotFound(bytes32 nodeId);
    error Unauthorized();
    error NodeNotActive();
    error NodeAlreadySlashed();
    error MinimumPeriodNotMet(uint256 elapsed, uint256 required);
    error HeartbeatTooFrequent();
    error InvalidEndpoint();
    error InvalidRegion();

    // ============ Constructor ============

    constructor(address _stakingToken, address _initialOwner) Ownable(_initialOwner) {
        stakingToken = IERC20(_stakingToken);
        isPerformanceOracle[_initialOwner] = true;
    }

    // ============ Node Registration ============

    /**
     * @notice Register a new relay node
     * @param endpoint HTTP/WebSocket endpoint URL
     * @param region Geographic region identifier
     * @param stakeAmount Amount of tokens to stake
     * @return nodeId Unique identifier for the node
     */
    function registerNode(
        string calldata endpoint,
        string calldata region,
        uint256 stakeAmount
    ) external whenNotPaused nonReentrant returns (bytes32 nodeId) {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (bytes(region).length == 0) revert InvalidRegion();
        if (stakeAmount < minStake) revert InsufficientStake(stakeAmount, minStake);

        // Transfer stake
        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        // Generate node ID
        nodeId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp));
        
        // Collision check
        if (nodes[nodeId].operator != address(0)) {
            nodeId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp, gasleft()));
        }

        // Create node record
        nodes[nodeId] = NodeInfo({
            nodeId: nodeId,
            operator: msg.sender,
            endpoint: endpoint,
            region: region,
            stakedAmount: stakeAmount,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            messagesRelayed: 0,
            feesEarned: 0,
            isActive: true,
            isSlashed: false
        });

        // Initialize performance
        performance[nodeId] = PerformanceMetrics({
            uptimeScore: 10000,    // Start at 100%
            deliveryRate: 10000,   // Start at 100%
            avgLatencyMs: 0,
            lastUpdated: block.timestamp
        });

        // Track node
        operatorNodes[msg.sender].push(nodeId);
        activeNodeIds.push(nodeId);
        nodesByRegion[region].push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, endpoint, region, stakeAmount);
    }

    /**
     * @notice Deregister a node and withdraw stake
     * @param nodeId Node to deregister
     */
    function deregisterNode(bytes32 nodeId) external nonReentrant {
        NodeInfo storage node = nodes[nodeId];
        
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (node.isSlashed) revert NodeAlreadySlashed();
        
        uint256 elapsed = block.timestamp - node.registeredAt;
        if (elapsed < minStakingPeriod) {
            revert MinimumPeriodNotMet(elapsed, minStakingPeriod);
        }

        uint256 stakeToReturn = node.stakedAmount;
        uint256 feesToClaim = pendingFees[nodeId];
        
        // Update state
        node.isActive = false;
        node.stakedAmount = 0;
        pendingFees[nodeId] = 0;
        
        // Remove from active list
        _removeFromActiveList(nodeId);
        _removeFromRegionList(nodeId, node.region);

        emit NodeDeregistered(nodeId, msg.sender);

        // Transfer stake and fees
        if (stakeToReturn > 0) {
            stakingToken.safeTransfer(msg.sender, stakeToReturn);
        }
        if (feesToClaim > 0) {
            stakingToken.safeTransfer(msg.sender, feesToClaim);
            emit FeesClaimed(nodeId, msg.sender, feesToClaim);
        }
    }

    /**
     * @notice Update node endpoint
     * @param nodeId Node to update
     * @param newEndpoint New endpoint URL
     */
    function updateEndpoint(bytes32 nodeId, string calldata newEndpoint) external {
        NodeInfo storage node = nodes[nodeId];
        
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (bytes(newEndpoint).length == 0) revert InvalidEndpoint();
        
        node.endpoint = newEndpoint;
        
        emit EndpointUpdated(nodeId, newEndpoint);
    }

    // ============ Heartbeat & Liveness ============

    /**
     * @notice Send heartbeat to prove node is alive
     * @param nodeId Node sending heartbeat
     */
    function heartbeat(bytes32 nodeId) external {
        NodeInfo storage node = nodes[nodeId];
        
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (!node.isActive) revert NodeNotActive();
        
        // Rate limit heartbeats
        if (block.timestamp - node.lastHeartbeat < heartbeatInterval / 2) {
            revert HeartbeatTooFrequent();
        }
        
        node.lastHeartbeat = block.timestamp;
        
        emit NodeHeartbeat(nodeId, block.timestamp);
    }

    // ============ Fee Accrual ============

    /**
     * @notice Record message relay and accrue fees
     * @param nodeId Node that relayed the message
     * @param messageCount Number of messages relayed
     * @dev Called by authorized relayers or via proof submission
     */
    function recordMessageRelay(bytes32 nodeId, uint256 messageCount) external {
        // Only performance oracles can record (prevents gaming)
        if (!isPerformanceOracle[msg.sender]) revert Unauthorized();
        
        NodeInfo storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (!node.isActive) revert NodeNotActive();
        
        uint256 totalFee = baseFeePerMessage * messageCount;
        uint256 protocolCut = (totalFee * protocolFeeBPS) / 10000;
        uint256 nodeFee = totalFee - protocolCut;
        
        node.messagesRelayed += messageCount;
        node.feesEarned += nodeFee;
        pendingFees[nodeId] += nodeFee;
        protocolFees += protocolCut;
        
        emit FeesAccrued(nodeId, nodeFee);
    }

    /**
     * @notice Claim accumulated fees
     * @param nodeId Node to claim fees for
     */
    function claimFees(bytes32 nodeId) external nonReentrant {
        NodeInfo storage node = nodes[nodeId];
        
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        
        uint256 feesToClaim = pendingFees[nodeId];
        if (feesToClaim == 0) return;
        
        pendingFees[nodeId] = 0;
        
        stakingToken.safeTransfer(msg.sender, feesToClaim);
        
        emit FeesClaimed(nodeId, msg.sender, feesToClaim);
    }

    // ============ Performance Updates ============

    /**
     * @notice Update node performance metrics
     * @param nodeId Node to update
     * @param uptimeScore Uptime score (0-10000)
     * @param deliveryRate Delivery success rate (0-10000)
     * @param avgLatencyMs Average latency in milliseconds
     */
    function updatePerformance(
        bytes32 nodeId,
        uint256 uptimeScore,
        uint256 deliveryRate,
        uint256 avgLatencyMs
    ) external {
        if (!isPerformanceOracle[msg.sender]) revert Unauthorized();
        
        NodeInfo storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        
        PerformanceMetrics storage perf = performance[nodeId];
        
        // EWMA: 80% old, 20% new
        perf.uptimeScore = (perf.uptimeScore * 8 + uptimeScore * 2) / 10;
        perf.deliveryRate = (perf.deliveryRate * 8 + deliveryRate * 2) / 10;
        perf.avgLatencyMs = avgLatencyMs;
        perf.lastUpdated = block.timestamp;
        
        emit PerformanceUpdated(nodeId, perf.uptimeScore, perf.deliveryRate);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a node for misbehavior
     * @param nodeId Node to slash
     * @param reason Reason for slashing
     */
    function slashNode(bytes32 nodeId, string calldata reason) external onlyOwner {
        NodeInfo storage node = nodes[nodeId];
        
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.isSlashed) revert NodeAlreadySlashed();
        
        uint256 slashAmount = (node.stakedAmount * slashPenaltyBPS) / 10000;
        
        node.stakedAmount -= slashAmount;
        node.isSlashed = true;
        node.isActive = false;
        
        // Remove from active list
        _removeFromActiveList(nodeId);
        _removeFromRegionList(nodeId, node.region);
        
        // Slashed amount goes to protocol
        protocolFees += slashAmount;
        
        emit NodeSlashed(nodeId, slashAmount, reason);
    }

    // ============ View Functions ============

    /**
     * @notice Get active nodes for a region
     * @param region Region to query
     * @return Array of node IDs
     */
    function getNodesByRegion(string calldata region) external view returns (bytes32[] memory) {
        return nodesByRegion[region];
    }

    /**
     * @notice Get all active node IDs
     * @return Array of active node IDs
     */
    function getActiveNodes() external view returns (bytes32[] memory) {
        return activeNodeIds;
    }

    /**
     * @notice Get node info
     * @param nodeId Node to query
     * @return Node info struct
     */
    function getNode(bytes32 nodeId) external view returns (NodeInfo memory) {
        return nodes[nodeId];
    }

    /**
     * @notice Get node performance
     * @param nodeId Node to query
     * @return Performance metrics
     */
    function getPerformance(bytes32 nodeId) external view returns (PerformanceMetrics memory) {
        return performance[nodeId];
    }

    /**
     * @notice Get operator's nodes
     * @param operator Operator address
     * @return Array of node IDs
     */
    function getOperatorNodes(address operator) external view returns (bytes32[] memory) {
        return operatorNodes[operator];
    }

    /**
     * @notice Check if node is healthy (recent heartbeat, good performance)
     * @param nodeId Node to check
     * @return healthy True if node is healthy
     */
    function isNodeHealthy(bytes32 nodeId) external view returns (bool healthy) {
        NodeInfo storage node = nodes[nodeId];
        PerformanceMetrics storage perf = performance[nodeId];
        
        if (!node.isActive || node.isSlashed) return false;
        if (block.timestamp - node.lastHeartbeat > heartbeatInterval * 3) return false;
        if (perf.uptimeScore < 9000) return false;  // < 90% uptime
        if (perf.deliveryRate < 9500) return false; // < 95% delivery
        
        return true;
    }

    /**
     * @notice Get random healthy node for load balancing
     * @param region Preferred region (empty for any)
     * @return nodeId Selected node ID
     * @return endpoint Node endpoint
     */
    function getRandomHealthyNode(string calldata region) external view returns (bytes32 nodeId, string memory endpoint) {
        bytes32[] memory candidates;
        
        if (bytes(region).length > 0) {
            candidates = nodesByRegion[region];
        } else {
            candidates = activeNodeIds;
        }
        
        if (candidates.length == 0) return (bytes32(0), "");
        
        // Simple random selection (can be improved with VRF)
        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao)));
        uint256 startIdx = seed % candidates.length;
        
        // Find first healthy node
        for (uint256 i = 0; i < candidates.length; i++) {
            uint256 idx = (startIdx + i) % candidates.length;
            bytes32 candidateId = candidates[idx];
            
            NodeInfo storage node = nodes[candidateId];
            if (node.isActive && !node.isSlashed) {
                if (block.timestamp - node.lastHeartbeat <= heartbeatInterval * 3) {
                    return (candidateId, node.endpoint);
                }
            }
        }
        
        return (bytes32(0), "");
    }

    // ============ Admin Functions ============

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    function setBaseFeePerMessage(uint256 _fee) external onlyOwner {
        baseFeePerMessage = _fee;
    }

    function setProtocolFeeBPS(uint256 _feeBPS) external onlyOwner {
        require(_feeBPS <= 2000, "Fee too high"); // Max 20%
        protocolFeeBPS = _feeBPS;
    }

    function setHeartbeatInterval(uint256 _interval) external onlyOwner {
        heartbeatInterval = _interval;
    }

    function addPerformanceOracle(address oracle) external onlyOwner {
        isPerformanceOracle[oracle] = true;
    }

    function removePerformanceOracle(address oracle) external onlyOwner {
        isPerformanceOracle[oracle] = false;
    }

    function claimProtocolFees(address recipient) external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        stakingToken.safeTransfer(recipient, amount);
        emit ProtocolFeesClaimed(recipient, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    function _removeFromActiveList(bytes32 nodeId) internal {
        uint256 length = activeNodeIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (activeNodeIds[i] == nodeId) {
                activeNodeIds[i] = activeNodeIds[length - 1];
                activeNodeIds.pop();
                break;
            }
        }
    }

    function _removeFromRegionList(bytes32 nodeId, string memory region) internal {
        bytes32[] storage regionNodes = nodesByRegion[region];
        uint256 length = regionNodes.length;
        for (uint256 i = 0; i < length; i++) {
            if (regionNodes[i] == nodeId) {
                regionNodes[i] = regionNodes[length - 1];
                regionNodes.pop();
                break;
            }
        }
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

