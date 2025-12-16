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
 */
contract MessageNodeRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct NodeInfo {
        bytes32 nodeId;
        address operator;
        string endpoint;
        string region;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 messagesRelayed;
        uint256 feesEarned;
        bool isActive;
        bool isSlashed;
    }

    struct PerformanceMetrics {
        uint256 uptimeScore; // 0-10000 (100.00%)
        uint256 deliveryRate; // 0-10000 (100.00%)
        uint256 avgLatencyMs;
        uint256 lastUpdated;
    }

    struct OracleInfo {
        uint256 stakedAmount;
        uint256 feesCredited; // Track fees credited this period
        uint256 periodStart;
        bool isActive;
    }

    uint256 public constant MIN_STAKE_FLOOR = 100 ether;
    uint256 public constant MAX_STAKE_CEILING = 1_000_000 ether;
    uint256 public constant MIN_HEARTBEAT_INTERVAL = 1 minutes;
    uint256 public constant MAX_HEARTBEAT_INTERVAL = 1 days;
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 2000; // 20%
    uint256 public constant MAX_SCORE = 10000;
    uint256 public constant ORACLE_FEE_PERIOD = 1 days;
    uint256 public constant SLASH_COOLDOWN = 30 days;

    IERC20 public immutable stakingToken;

    uint256 public minStake = 1000 ether;
    uint256 public heartbeatInterval = 5 minutes;
    uint256 public slashPenaltyBPS = 5000;
    uint256 public minStakingPeriod = 7 days;

    uint256 public baseFeePerMessage = 0.0001 ether;
    uint256 public protocolFeeBPS = 500;
    uint256 public oracleMinStake = 10000 ether;
    uint256 public maxFeesPerOraclePeriod = 100000 ether;

    mapping(bytes32 => NodeInfo) public nodes;
    mapping(bytes32 => PerformanceMetrics) public performance;
    mapping(address => bytes32[]) public operatorNodes;
    bytes32[] public activeNodeIds;

    mapping(string => bytes32[]) public nodesByRegion;

    mapping(bytes32 => uint256) public pendingFees;
    uint256 public protocolFees;

    // Oracles with stake
    mapping(address => OracleInfo) public oracles;

    // Slashed node recovery
    mapping(bytes32 => uint256) public slashTimestamp;


    event NodeRegistered(
        bytes32 indexed nodeId, address indexed operator, string endpoint, string region, uint256 stakedAmount
    );
    event NodeDeregistered(bytes32 indexed nodeId, address indexed operator);
    event NodeHeartbeat(bytes32 indexed nodeId, uint256 timestamp);
    event NodeSlashed(bytes32 indexed nodeId, uint256 slashAmount, string reason);
    event PerformanceUpdated(bytes32 indexed nodeId, uint256 uptimeScore, uint256 deliveryRate);
    event FeesAccrued(bytes32 indexed nodeId, uint256 amount);
    event FeesClaimed(bytes32 indexed nodeId, address indexed operator, uint256 amount);
    event ProtocolFeesClaimed(address indexed recipient, uint256 amount);
    event EndpointUpdated(bytes32 indexed nodeId, string newEndpoint);
    event OracleRegistered(address indexed oracle, uint256 stake);
    event OracleDeregistered(address indexed oracle);
    event SlashedStakeRecovered(bytes32 indexed nodeId, address indexed operator, uint256 amount);

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
    error InvalidParameter();
    error OracleFeeLimitExceeded();
    error SlashCooldownNotMet();
    error OracleNotActive();


    constructor(address _stakingToken, address _initialOwner) Ownable(_initialOwner) {
        stakingToken = IERC20(_stakingToken);
    }

    function registerOracle(uint256 stakeAmount) external nonReentrant {
        if (stakeAmount < oracleMinStake) revert InsufficientStake(stakeAmount, oracleMinStake);
        if (oracles[msg.sender].isActive) revert Unauthorized();

        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        oracles[msg.sender] =
            OracleInfo({stakedAmount: stakeAmount, feesCredited: 0, periodStart: block.timestamp, isActive: true});

        emit OracleRegistered(msg.sender, stakeAmount);
    }

    function deregisterOracle() external nonReentrant {
        OracleInfo storage oracle = oracles[msg.sender];
        if (!oracle.isActive) revert OracleNotActive();

        uint256 stakeToReturn = oracle.stakedAmount;
        oracle.isActive = false;
        oracle.stakedAmount = 0;

        stakingToken.safeTransfer(msg.sender, stakeToReturn);

        emit OracleDeregistered(msg.sender);
    }


    function registerNode(string calldata endpoint, string calldata region, uint256 stakeAmount)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 nodeId)
    {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (bytes(region).length == 0) revert InvalidRegion();
        if (stakeAmount < minStake) revert InsufficientStake(stakeAmount, minStake);

        stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        nodeId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp, block.prevrandao));

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

        performance[nodeId] = PerformanceMetrics({
            uptimeScore: MAX_SCORE,
            deliveryRate: MAX_SCORE,
            avgLatencyMs: 0,
            lastUpdated: block.timestamp
        });

        operatorNodes[msg.sender].push(nodeId);
        activeNodeIds.push(nodeId);
        nodesByRegion[region].push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, endpoint, region, stakeAmount);
    }

    /// @notice Deregister node and return stake (after minimum staking period)
    /// @dev Timestamp comparison intentional for minimum staking enforcement
    // slither-disable-next-line timestamp
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

        node.isActive = false;
        node.stakedAmount = 0;
        pendingFees[nodeId] = 0;

        _removeFromActiveList(nodeId);
        _removeFromRegionList(nodeId, node.region);

        emit NodeDeregistered(nodeId, msg.sender);

        if (stakeToReturn > 0) {
            stakingToken.safeTransfer(msg.sender, stakeToReturn);
        }
        if (feesToClaim > 0) {
            stakingToken.safeTransfer(msg.sender, feesToClaim);
            emit FeesClaimed(nodeId, msg.sender, feesToClaim);
        }
    }

    function updateEndpoint(bytes32 nodeId, string calldata newEndpoint) external nonReentrant {
        NodeInfo storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (bytes(newEndpoint).length == 0) revert InvalidEndpoint();

        node.endpoint = newEndpoint;

        emit EndpointUpdated(nodeId, newEndpoint);
    }

    function heartbeat(bytes32 nodeId) external nonReentrant {
        NodeInfo storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (!node.isActive) revert NodeNotActive();

        if (block.timestamp - node.lastHeartbeat < heartbeatInterval / 2) {
            revert HeartbeatTooFrequent();
        }

        node.lastHeartbeat = block.timestamp;

        emit NodeHeartbeat(nodeId, block.timestamp);
    }

    function recordMessageRelay(bytes32 nodeId, uint256 messageCount) external nonReentrant {
        OracleInfo storage oracle = oracles[msg.sender];
        if (!oracle.isActive) revert OracleNotActive();

        if (block.timestamp - oracle.periodStart >= ORACLE_FEE_PERIOD) {
            oracle.feesCredited = 0;
            oracle.periodStart = block.timestamp;
        }

        NodeInfo storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (!node.isActive) revert NodeNotActive();

        uint256 totalFee = baseFeePerMessage * messageCount;
        uint256 protocolCut = (totalFee * protocolFeeBPS) / 10000;
        uint256 nodeFee = totalFee - protocolCut;

        if (oracle.feesCredited + totalFee > maxFeesPerOraclePeriod) {
            revert OracleFeeLimitExceeded();
        }
        oracle.feesCredited += totalFee;

        node.messagesRelayed += messageCount;
        node.feesEarned += nodeFee;
        pendingFees[nodeId] += nodeFee;
        protocolFees += protocolCut;

        emit FeesAccrued(nodeId, nodeFee);
    }

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

    function updatePerformance(bytes32 nodeId, uint256 uptimeScore, uint256 deliveryRate, uint256 avgLatencyMs)
        external
        nonReentrant
    {
        OracleInfo storage oracle = oracles[msg.sender];
        if (!oracle.isActive) revert OracleNotActive();

        NodeInfo storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);

        if (uptimeScore > MAX_SCORE) uptimeScore = MAX_SCORE;
        if (deliveryRate > MAX_SCORE) deliveryRate = MAX_SCORE;

        PerformanceMetrics storage perf = performance[nodeId];
        perf.uptimeScore = (perf.uptimeScore * 8 + uptimeScore * 2) / 10;
        perf.deliveryRate = (perf.deliveryRate * 8 + deliveryRate * 2) / 10;
        perf.avgLatencyMs = avgLatencyMs;
        perf.lastUpdated = block.timestamp;

        emit PerformanceUpdated(nodeId, perf.uptimeScore, perf.deliveryRate);
    }

    function slashNode(bytes32 nodeId, string calldata reason) external onlyOwner {
        NodeInfo storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.isSlashed) revert NodeAlreadySlashed();

        uint256 slashAmount = (node.stakedAmount * slashPenaltyBPS) / 10000;

        node.stakedAmount -= slashAmount;
        node.isSlashed = true;
        node.isActive = false;
        slashTimestamp[nodeId] = block.timestamp;

        _removeFromActiveList(nodeId);
        _removeFromRegionList(nodeId, node.region);

        protocolFees += slashAmount;

        // Transfer pending fees to protocol as well
        uint256 pendingNodeFees = pendingFees[nodeId];
        if (pendingNodeFees > 0) {
            protocolFees += pendingNodeFees;
            pendingFees[nodeId] = 0;
        }

        emit NodeSlashed(nodeId, slashAmount, reason);
    }

    function recoverSlashedStake(bytes32 nodeId) external nonReentrant {
        NodeInfo storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (!node.isSlashed) revert Unauthorized();

        uint256 slashedAt = slashTimestamp[nodeId];
        if (block.timestamp < slashedAt + SLASH_COOLDOWN) {
            revert SlashCooldownNotMet();
        }

        uint256 remaining = node.stakedAmount;
        if (remaining == 0) return;

        node.stakedAmount = 0;
        stakingToken.safeTransfer(msg.sender, remaining);

        emit SlashedStakeRecovered(nodeId, msg.sender, remaining);
    }


    function getNodesByRegion(string calldata region) external view returns (bytes32[] memory) {
        return nodesByRegion[region];
    }

    function getActiveNodes() external view returns (bytes32[] memory) {
        return activeNodeIds;
    }

    function getNode(bytes32 nodeId) external view returns (NodeInfo memory) {
        return nodes[nodeId];
    }

    function getPerformance(bytes32 nodeId) external view returns (PerformanceMetrics memory) {
        return performance[nodeId];
    }

    function getOperatorNodes(address operator) external view returns (bytes32[] memory) {
        return operatorNodes[operator];
    }

    function isNodeHealthy(bytes32 nodeId) external view returns (bool) {
        NodeInfo storage node = nodes[nodeId];
        PerformanceMetrics storage perf = performance[nodeId];

        if (!node.isActive || node.isSlashed) return false;
        if (block.timestamp - node.lastHeartbeat > heartbeatInterval * 3) return false;
        if (perf.uptimeScore < 9000) return false;
        if (perf.deliveryRate < 9500) return false;

        return true;
    }

    function getRandomHealthyNode(string calldata region)
        external
        view
        returns (bytes32 nodeId, string memory endpoint)
    {
        bytes32[] memory candidates;

        if (bytes(region).length > 0) {
            candidates = nodesByRegion[region];
        } else {
            candidates = activeNodeIds;
        }

        if (candidates.length == 0) return (bytes32(0), "");

        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao)));
        uint256 startIdx = seed % candidates.length;

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

    function getOracleInfo(address oracle) external view returns (OracleInfo memory) {
        return oracles[oracle];
    }


    function setMinStake(uint256 _minStake) external onlyOwner {
        if (_minStake < MIN_STAKE_FLOOR || _minStake > MAX_STAKE_CEILING) {
            revert InvalidParameter();
        }
        minStake = _minStake;
    }

    function setBaseFeePerMessage(uint256 _fee) external onlyOwner {
        baseFeePerMessage = _fee;
    }

    function setProtocolFeeBPS(uint256 _feeBPS) external onlyOwner {
        if (_feeBPS > MAX_PROTOCOL_FEE_BPS) revert InvalidParameter();
        protocolFeeBPS = _feeBPS;
    }

    function setHeartbeatInterval(uint256 _interval) external onlyOwner {
        if (_interval < MIN_HEARTBEAT_INTERVAL || _interval > MAX_HEARTBEAT_INTERVAL) {
            revert InvalidParameter();
        }
        heartbeatInterval = _interval;
    }

    function setOracleMinStake(uint256 _stake) external onlyOwner {
        if (_stake < MIN_STAKE_FLOOR) revert InvalidParameter();
        oracleMinStake = _stake;
    }

    function setMaxFeesPerOraclePeriod(uint256 _maxFees) external onlyOwner {
        maxFeesPerOraclePeriod = _maxFees;
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

    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}
