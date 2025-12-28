// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {PerformanceMetrics} from "../registry/PerformanceMetrics.sol";

/**
 * @title MultiChainRPCRegistry
 * @author Jeju Network
 * @notice Permissionless multi-chain RPC provider registry with reputation-based selection
 * @dev No cryptographic proofs - uses ERC-8004 identity, reputation, and moderation instead
 *
 * Design Philosophy:
 * - Permissionless: Any provider can register
 * - Reputation-based: Quality emerges from QoS monitoring, not proofs
 * - Multi-chain: Providers declare which chains they support
 * - Usage-metered: Off-chain relayer reports usage, provider can dispute
 *
 * Unlike Pocket Network which needs trustless proofs for cross-party settlement,
 * Jeju uses:
 * - ERC-8004 identity for persistent node identity
 * - Reputation scores from actual performance monitoring
 * - Moderation/banning for bad actors
 * - Slashing for economic accountability
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract MultiChainRPCRegistry is ProviderRegistryBase {
    using SafeERC20 for IERC20;
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;
    using PerformanceMetrics for PerformanceMetrics.Metrics;

    // ============ Structs ============

    struct ChainEndpoint {
        uint64 chainId;
        string endpoint;
        bool isActive;
        bool isArchive;      // Supports archival queries
        bool isWebSocket;    // Has websocket support
        uint64 blockHeight;  // Last reported block height
        uint64 lastUpdated;  // Last heartbeat
    }

    struct RPCNode {
        address operator;
        string region;             // Geographic region
        uint256 stake;             // ETH stake
        uint256 jejuStake;         // JEJU stake
        uint256 registeredAt;
        uint256 agentId;           // ERC-8004 identity
        bool isActive;
        bool isFrozen;
        // Usage tracking (reported by relayer)
        uint256 totalRequests;
        uint256 totalComputeUnits;
        uint256 totalErrors;
        uint64 lastSeen;
    }

    struct NodePerformance {
        uint256 uptimeScore;       // 0-10000 basis points
        uint256 successRate;       // 0-10000 basis points
        uint256 avgLatencyMs;
        uint256 lastUpdated;
    }

    // ============ State ============

    IERC20 public immutable jejuToken;

    // Node registry
    mapping(address => RPCNode) private _nodes;
    mapping(address => NodePerformance) public nodePerformance;

    // Chain support: node -> chainId -> endpoint
    mapping(address => mapping(uint64 => ChainEndpoint)) public chainEndpoints;
    mapping(address => uint64[]) public supportedChains;

    // Chain discovery
    mapping(uint64 => address[]) public chainProviders;  // chainId -> providers
    uint64[] public allSupportedChains;
    mapping(uint64 => bool) private _chainExists;

    // Authorized relayers that can report usage
    mapping(address => bool) public authorizedRelayers;

    // Reputation thresholds
    uint256 public minReputationForSelection = 5000;  // 50% uptime/success

    address public treasury;
    address public priceOracle;
    uint256 public fallbackPrice = 1e7;  // Fallback JEJU/USD price

    // ============ Events ============

    event NodeRegistered(address indexed node, string region, uint256 stake, uint256 agentId);
    event ChainEndpointAdded(address indexed node, uint64 indexed chainId, string endpoint);
    event ChainEndpointRemoved(address indexed node, uint64 indexed chainId);
    event ChainEndpointUpdated(address indexed node, uint64 indexed chainId, uint64 blockHeight);
    event UsageReported(address indexed node, uint256 requests, uint256 computeUnits, uint256 errors);
    event PerformanceUpdated(address indexed node, uint256 uptime, uint256 successRate, uint256 latency);
    event RelayerAuthorized(address indexed relayer, bool authorized);
    event NodeSlashed(address indexed node, uint256 amount, string reason);

    // ============ Errors ============

    error InvalidEndpoint();
    error InvalidRegion();
    error ChainNotSupported(uint64 chainId);
    error NodeNotActive();
    error NotAuthorizedRelayer();
    error InsufficientReputation();

    // ============ Modifiers ============

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedRelayer();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _banManager,
        address _owner
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, 0.1 ether) {
        jejuToken = IERC20(_jejuToken);
        authorizedRelayers[_owner] = true;
    }

    // ============ Registration ============

    /**
     * @notice Register as an RPC node provider
     * @param region Geographic region (e.g., "us-east", "eu-west")
     */
    function registerNode(string calldata region) external payable nonReentrant whenNotPaused {
        if (bytes(region).length == 0) revert InvalidRegion();

        _registerProviderWithoutAgent(msg.sender);

        _nodes[msg.sender] = RPCNode({
            operator: msg.sender,
            region: region,
            stake: msg.value,
            jejuStake: 0,
            registeredAt: block.timestamp,
            agentId: 0,
            isActive: true,
            isFrozen: false,
            totalRequests: 0,
            totalComputeUnits: 0,
            totalErrors: 0,
            lastSeen: uint64(block.timestamp)
        });

        emit NodeRegistered(msg.sender, region, msg.value, 0);
    }

    /**
     * @notice Register with ERC-8004 agent identity
     * @param region Geographic region
     * @param agentId ERC-8004 agent token ID
     */
    function registerNodeWithAgent(string calldata region, uint256 agentId) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        if (bytes(region).length == 0) revert InvalidRegion();

        _registerProviderWithAgent(msg.sender, agentId);

        _nodes[msg.sender] = RPCNode({
            operator: msg.sender,
            region: region,
            stake: msg.value,
            jejuStake: 0,
            registeredAt: block.timestamp,
            agentId: agentId,
            isActive: true,
            isFrozen: false,
            totalRequests: 0,
            totalComputeUnits: 0,
            totalErrors: 0,
            lastSeen: uint64(block.timestamp)
        });

        emit NodeRegistered(msg.sender, region, msg.value, agentId);
    }

    // ============ Chain Endpoints ============

    /**
     * @notice Add support for a blockchain
     * @param chainId EVM chain ID
     * @param endpoint RPC endpoint URL
     * @param isArchive Whether endpoint supports archival queries
     * @param isWebSocket Whether endpoint has websocket support
     */
    function addChainEndpoint(
        uint64 chainId,
        string calldata endpoint,
        bool isArchive,
        bool isWebSocket
    ) external nonReentrant {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (!_nodes[msg.sender].isActive) revert NodeNotActive();

        ChainEndpoint storage ce = chainEndpoints[msg.sender][chainId];

        // New chain for this node
        if (!ce.isActive) {
            supportedChains[msg.sender].push(chainId);
            chainProviders[chainId].push(msg.sender);

            if (!_chainExists[chainId]) {
                allSupportedChains.push(chainId);
                _chainExists[chainId] = true;
            }
        }

        ce.chainId = chainId;
        ce.endpoint = endpoint;
        ce.isActive = true;
        ce.isArchive = isArchive;
        ce.isWebSocket = isWebSocket;
        ce.lastUpdated = uint64(block.timestamp);

        emit ChainEndpointAdded(msg.sender, chainId, endpoint);
    }

    /**
     * @notice Remove support for a blockchain
     * @param chainId EVM chain ID to remove
     */
    function removeChainEndpoint(uint64 chainId) external nonReentrant {
        ChainEndpoint storage ce = chainEndpoints[msg.sender][chainId];
        if (!ce.isActive) revert ChainNotSupported(chainId);

        ce.isActive = false;

        // Note: We don't remove from arrays to avoid expensive array manipulation
        // Inactive chains are filtered in queries

        emit ChainEndpointRemoved(msg.sender, chainId);
    }

    /**
     * @notice Heartbeat with block height update
     * @param chainId Chain to update
     * @param blockHeight Latest block height
     */
    function heartbeat(uint64 chainId, uint64 blockHeight) external {
        ChainEndpoint storage ce = chainEndpoints[msg.sender][chainId];
        if (!ce.isActive) revert ChainNotSupported(chainId);

        ce.blockHeight = blockHeight;
        ce.lastUpdated = uint64(block.timestamp);
        _nodes[msg.sender].lastSeen = uint64(block.timestamp);

        emit ChainEndpointUpdated(msg.sender, chainId, blockHeight);
    }

    // ============ Usage Reporting ============

    /**
     * @notice Report usage for a node (called by authorized relayer)
     * @param node Node address
     * @param requests Number of requests served
     * @param computeUnits Compute units consumed
     * @param errors Number of errors
     */
    function reportUsage(
        address node,
        uint256 requests,
        uint256 computeUnits,
        uint256 errors
    ) external onlyRelayer {
        RPCNode storage n = _nodes[node];
        if (!n.isActive) revert NodeNotActive();

        n.totalRequests += requests;
        n.totalComputeUnits += computeUnits;
        n.totalErrors += errors;

        emit UsageReported(node, requests, computeUnits, errors);
    }

    /**
     * @notice Update performance metrics for a node (called by QoS monitor)
     * @param node Node address
     * @param uptimeScore 0-10000 uptime score
     * @param successRate 0-10000 success rate
     * @param avgLatencyMs Average latency in milliseconds
     */
    function reportPerformance(
        address node,
        uint256 uptimeScore,
        uint256 successRate,
        uint256 avgLatencyMs
    ) external onlyRelayer {
        if (uptimeScore > 10000 || successRate > 10000) revert InvalidScore();

        nodePerformance[node] = NodePerformance({
            uptimeScore: uptimeScore,
            successRate: successRate,
            avgLatencyMs: avgLatencyMs,
            lastUpdated: block.timestamp
        });

        emit PerformanceUpdated(node, uptimeScore, successRate, avgLatencyMs);
    }

    // ============ Queries ============

    /**
     * @notice Get node info
     */
    function getNode(address node) external view returns (RPCNode memory) {
        return _nodes[node];
    }

    /**
     * @notice Get all active providers for a chain
     * @param chainId Chain to query
     * @return Active providers supporting this chain
     */
    function getProvidersForChain(uint64 chainId) external view returns (address[] memory) {
        address[] storage all = chainProviders[chainId];
        uint256 activeCount = 0;

        // Count active
        for (uint256 i = 0; i < all.length; i++) {
            if (_nodes[all[i]].isActive && chainEndpoints[all[i]][chainId].isActive) {
                activeCount++;
            }
        }

        // Collect active
        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (_nodes[all[i]].isActive && chainEndpoints[all[i]][chainId].isActive) {
                active[j++] = all[i];
            }
        }

        return active;
    }

    /**
     * @notice Get providers for a chain, filtered by reputation
     * @param chainId Chain ID
     * @param minUptime Minimum uptime score (0-10000)
     * @param requireArchive Only return archive nodes
     * @param maxCount Maximum providers to return
     */
    function getQualifiedProviders(
        uint64 chainId,
        uint256 minUptime,
        bool requireArchive,
        uint16 maxCount
    ) external view returns (address[] memory providers, uint256[] memory scores) {
        address[] storage all = chainProviders[chainId];
        uint256 qualifiedCount = 0;

        // Count qualified
        for (uint256 i = 0; i < all.length; i++) {
            address node = all[i];
            if (_isQualified(node, chainId, minUptime, requireArchive)) {
                qualifiedCount++;
            }
        }

        if (qualifiedCount == 0) {
            return (new address[](0), new uint256[](0));
        }

        // Collect and sort by reputation score
        address[] memory qualified = new address[](qualifiedCount);
        uint256[] memory qualifiedScores = new uint256[](qualifiedCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < all.length; i++) {
            address node = all[i];
            if (_isQualified(node, chainId, minUptime, requireArchive)) {
                qualified[idx] = node;
                qualifiedScores[idx] = _getReputationScore(node);
                idx++;
            }
        }

        // Sort by score descending (insertion sort for small arrays)
        for (uint256 i = 1; i < qualifiedCount; i++) {
            uint256 j = i;
            while (j > 0 && qualifiedScores[j - 1] < qualifiedScores[j]) {
                (qualifiedScores[j - 1], qualifiedScores[j]) = (qualifiedScores[j], qualifiedScores[j - 1]);
                (qualified[j - 1], qualified[j]) = (qualified[j], qualified[j - 1]);
                j--;
            }
        }

        // Return top N
        uint256 resultCount = maxCount > qualifiedCount ? qualifiedCount : maxCount;
        providers = new address[](resultCount);
        scores = new uint256[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            providers[i] = qualified[i];
            scores[i] = qualifiedScores[i];
        }
    }

    /**
     * @notice Get all supported chain IDs
     */
    function getSupportedChains() external view returns (uint64[] memory) {
        return allSupportedChains;
    }

    /**
     * @notice Get chain endpoint for a node
     */
    function getChainEndpoint(address node, uint64 chainId) external view returns (ChainEndpoint memory) {
        return chainEndpoints[node][chainId];
    }

    /**
     * @notice Get all chains supported by a node
     */
    function getNodeChains(address node) external view returns (uint64[] memory) {
        return supportedChains[node];
    }

    /**
     * @notice Get active providers (ProviderRegistryBase interface)
     */
    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_nodes[providerList[i]].isActive) activeCount++;
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_nodes[providerList[i]].isActive) active[j++] = providerList[i];
        }

        return active;
    }

    // ============ Admin ============

    /**
     * @notice Authorize/deauthorize a relayer
     */
    function setRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorized(relayer, authorized);
    }

    /**
     * @notice Slash a node's stake
     * @param node Node to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashNode(address node, uint256 amount, string calldata reason) external onlyOwner {
        RPCNode storage n = _nodes[node];
        uint256 slashable = n.stake + n.jejuStake;
        uint256 toSlash = amount > slashable ? slashable : amount;

        if (toSlash <= n.stake) {
            n.stake -= toSlash;
        } else {
            uint256 remainder = toSlash - n.stake;
            n.stake = 0;
            n.jejuStake -= remainder;
        }

        if (treasury != address(0) && toSlash > 0) {
            // Send ETH portion to treasury
            if (toSlash <= address(this).balance) {
                (bool success, ) = treasury.call{value: toSlash}("");
                require(success, "Transfer failed");
            }
        }

        emit NodeSlashed(node, toSlash, reason);
    }

    /**
     * @notice Freeze/unfreeze a node
     */
    function setNodeFrozen(address node, bool frozen) external onlyOwner {
        _nodes[node].isFrozen = frozen;
    }

    /**
     * @notice Set minimum reputation for selection
     */
    function setMinReputation(uint256 minScore) external onlyOwner {
        minReputationForSelection = minScore;
    }

    /**
     * @notice Set treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function _onProviderRegistered(address, uint256, uint256) internal override {}

    // ============ Internal ============

    function _isQualified(
        address node,
        uint64 chainId,
        uint256 minUptime,
        bool requireArchive
    ) internal view returns (bool) {
        RPCNode storage n = _nodes[node];
        if (!n.isActive || n.isFrozen) return false;

        ChainEndpoint storage ce = chainEndpoints[node][chainId];
        if (!ce.isActive) return false;
        if (requireArchive && !ce.isArchive) return false;

        // Check staleness (24 hour max)
        if (block.timestamp - ce.lastUpdated > 24 hours) return false;

        // Check performance
        NodePerformance storage perf = nodePerformance[node];
        if (perf.uptimeScore < minUptime) return false;

        // Check moderation
        if (moderation.isAddressBanned(node)) return false;
        if (n.agentId > 0 && moderation.isAgentBanned(n.agentId)) return false;

        return true;
    }

    function _getReputationScore(address node) internal view returns (uint256) {
        NodePerformance storage perf = nodePerformance[node];
        // Weighted: 40% uptime, 40% success rate, 20% inverse latency
        uint256 latencyScore = perf.avgLatencyMs > 0 ? 10000 * 100 / (perf.avgLatencyMs + 100) : 5000;
        return (perf.uptimeScore * 40 + perf.successRate * 40 + latencyScore * 20) / 100;
    }

    error InvalidScore();

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
