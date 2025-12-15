// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICDNTypes} from "./ICDNTypes.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title CDNRegistry
 * @author Jeju Network
 * @notice Registry for decentralized CDN providers and edge nodes
 * @dev Supports permissionless registration of edge nodes, cloud CDN providers,
 *      and hybrid configurations. Integrates with ERC-8004 for identity verification.
 *
 * Key Features:
 * - Permissionless edge node registration with staking
 * - Support for cloud CDN providers (CloudFront, Cloudflare, etc.)
 * - Support for decentralized CDN networks (Fleek, Pipe, AIOZ)
 * - Geographic region tracking for optimal routing
 * - Usage reporting and billing settlement
 * - Integration with reputation system
 */
contract CDNRegistry is ICDNTypes, Ownable, ReentrancyGuard {
    // ============ State ============

    /// @notice Minimum stake required to register as provider
    uint256 public minProviderStake = 0.01 ether;

    /// @notice Minimum stake required to register an edge node
    uint256 public minNodeStake = 0.001 ether;

    /// @notice Provider data by address
    mapping(address => Provider) private _providers;

    /// @notice Provider capabilities
    mapping(address => ProviderCapabilities) private _capabilities;

    /// @notice Provider pricing
    mapping(address => ProviderPricing) private _pricing;

    /// @notice Provider metrics
    mapping(address => ProviderMetrics) private _metrics;

    /// @notice Provider regions (provider => Region[])
    mapping(address => Region[]) private _providerRegions;

    /// @notice All registered provider addresses
    address[] private _providerList;

    /// @notice Edge nodes by ID
    mapping(bytes32 => EdgeNode) private _edgeNodes;

    /// @notice Edge node metrics
    mapping(bytes32 => EdgeNodeMetrics) private _nodeMetrics;

    /// @notice Operator to node IDs mapping
    mapping(address => bytes32[]) private _operatorNodes;

    /// @notice Nodes by region
    mapping(Region => bytes32[]) private _regionNodes;

    /// @notice All edge node IDs
    bytes32[] private _nodeList;

    /// @notice Sites by ID
    mapping(bytes32 => Site) private _sites;

    /// @notice Owner to site IDs
    mapping(address => bytes32[]) private _ownerSites;

    /// @notice Invalidation requests
    mapping(bytes32 => InvalidationRequest) private _invalidations;

    /// @notice Usage records by node
    mapping(bytes32 => UsageRecord[]) private _usageRecords;

    /// @notice Billing records by user
    mapping(address => BillingRecord[]) private _billingRecords;

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice Whether to require ERC-8004 agent registration
    bool public requireAgentRegistration;

    /// @notice Agent ID to provider mapping
    mapping(uint256 => address) private _agentToProvider;

    /// @notice Provider count
    uint256 public providerCount;

    /// @notice Node count
    uint256 public nodeCount;

    /// @notice Site count
    uint256 public siteCount;

    // ============ Errors ============

    error InvalidAgentId();
    error NotAgentOwner();
    error AgentAlreadyLinked();
    error AgentRequired();
    error InsufficientStake(uint256 provided, uint256 required);
    error ProviderAlreadyRegistered();
    error ProviderNotRegistered();
    error NodeNotFound();
    error SiteNotFound();
    error NotSiteOwner();
    error NotNodeOperator();
    error InvalidEndpoint();
    error InvalidRegion();
    error TransferFailed();

    // ============ Constructor ============

    constructor(address _owner, address _identityRegistry) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    // ============ Provider Registration ============

    /**
     * @notice Register as a CDN provider (without ERC-8004 agent)
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param providerType Type of CDN provider
     * @param attestationHash Hash of attestation/verification data
     */
    function registerProvider(
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash
    ) external payable nonReentrant {
        if (requireAgentRegistration) revert AgentRequired();
        _registerProviderInternal(name, endpoint, providerType, attestationHash, 0);
    }

    /**
     * @notice Register as a CDN provider with ERC-8004 agent verification
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param providerType Type of CDN provider
     * @param attestationHash Hash of attestation data
     * @param agentId ERC-8004 agent ID for identity verification
     */
    function registerProviderWithAgent(
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) external payable nonReentrant {
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (_agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();

        _registerProviderInternal(name, endpoint, providerType, attestationHash, agentId);
        _agentToProvider[agentId] = msg.sender;
    }

    function _registerProviderInternal(
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) internal {
        if (_providers[msg.sender].registeredAt != 0) revert ProviderAlreadyRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (msg.value < minProviderStake) revert InsufficientStake(msg.value, minProviderStake);

        _providers[msg.sender] = Provider({
            owner: msg.sender,
            name: name,
            endpoint: endpoint,
            providerType: providerType,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            active: true,
            verified: false
        });

        _providerList.push(msg.sender);
        providerCount++;

        emit ProviderRegistered(msg.sender, name, providerType, msg.value, agentId);
    }

    // ============ Edge Node Registration ============

    /**
     * @notice Register an edge node
     * @param endpoint Edge node endpoint URL
     * @param region Geographic region
     * @param providerType Type of provider (decentralized, residential, etc.)
     */
    function registerEdgeNode(
        string calldata endpoint,
        Region region,
        ProviderType providerType
    ) external payable nonReentrant returns (bytes32 nodeId) {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (msg.value < minNodeStake) revert InsufficientStake(msg.value, minNodeStake);

        // Generate node ID
        nodeId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp, block.number));

        _edgeNodes[nodeId] = EdgeNode({
            nodeId: nodeId,
            operator: msg.sender,
            endpoint: endpoint,
            region: region,
            providerType: providerType,
            status: NodeStatus.HEALTHY,
            stake: msg.value,
            registeredAt: block.timestamp,
            lastSeen: block.timestamp,
            agentId: 0
        });

        _operatorNodes[msg.sender].push(nodeId);
        _regionNodes[region].push(nodeId);
        _nodeList.push(nodeId);
        nodeCount++;

        emit EdgeNodeRegistered(nodeId, msg.sender, region, providerType, msg.value);

        return nodeId;
    }

    /**
     * @notice Register an edge node with ERC-8004 agent
     */
    function registerEdgeNodeWithAgent(
        string calldata endpoint,
        Region region,
        ProviderType providerType,
        uint256 agentId
    ) external payable nonReentrant returns (bytes32 nodeId) {
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        nodeId = registerEdgeNode(endpoint, region, providerType);
        _edgeNodes[nodeId].agentId = agentId;

        return nodeId;
    }

    // ============ Node Management ============

    /**
     * @notice Update edge node status
     */
    function updateNodeStatus(bytes32 nodeId, NodeStatus status) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender && msg.sender != owner()) revert NotNodeOperator();

        node.status = status;
        node.lastSeen = block.timestamp;

        emit EdgeNodeStatusUpdated(nodeId, status);
    }

    /**
     * @notice Report edge node metrics
     */
    function reportNodeMetrics(
        bytes32 nodeId,
        uint256 currentLoad,
        uint256 bandwidthUsage,
        uint256 activeConnections,
        uint256 requestsPerSecond,
        uint256 bytesServedTotal,
        uint256 requestsTotal,
        uint256 cacheHitRate,
        uint256 avgResponseTime
    ) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();

        _nodeMetrics[nodeId] = EdgeNodeMetrics({
            currentLoad: currentLoad,
            bandwidthUsage: bandwidthUsage,
            activeConnections: activeConnections,
            requestsPerSecond: requestsPerSecond,
            bytesServedTotal: bytesServedTotal,
            requestsTotal: requestsTotal,
            cacheSize: 0, // Can be updated separately
            cacheEntries: 0,
            cacheHitRate: cacheHitRate,
            avgResponseTime: avgResponseTime,
            lastUpdated: block.timestamp
        });

        node.lastSeen = block.timestamp;
    }

    /**
     * @notice Deactivate an edge node
     */
    function deactivateNode(bytes32 nodeId, string calldata reason) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender && msg.sender != owner()) revert NotNodeOperator();

        node.status = NodeStatus.OFFLINE;

        emit EdgeNodeDeactivated(nodeId, node.operator, reason);
    }

    // ============ Site Management ============

    /**
     * @notice Create a CDN site configuration
     */
    function createSite(
        string calldata domain,
        string calldata origin
    ) external returns (bytes32 siteId) {
        siteId = keccak256(abi.encodePacked(msg.sender, domain, block.timestamp));

        _sites[siteId] = Site({
            siteId: siteId,
            owner: msg.sender,
            domain: domain,
            origin: origin,
            contentHash: bytes32(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            active: true
        });

        _ownerSites[msg.sender].push(siteId);
        siteCount++;

        emit SiteCreated(siteId, msg.sender, domain);

        return siteId;
    }

    /**
     * @notice Update site content hash (for cache invalidation)
     */
    function updateSiteContent(bytes32 siteId, bytes32 contentHash) external {
        Site storage site = _sites[siteId];
        if (site.owner != msg.sender) revert NotSiteOwner();

        site.contentHash = contentHash;
        site.updatedAt = block.timestamp;

        emit SiteUpdated(siteId, contentHash);
    }

    // ============ Cache Invalidation ============

    /**
     * @notice Request cache invalidation
     */
    function requestInvalidation(
        bytes32 siteId,
        string[] calldata paths,
        Region[] calldata regions
    ) external returns (bytes32 requestId) {
        Site storage site = _sites[siteId];
        if (site.owner != msg.sender) revert NotSiteOwner();

        requestId = keccak256(abi.encodePacked(siteId, msg.sender, block.timestamp, block.number));

        _invalidations[requestId] = InvalidationRequest({
            requestId: requestId,
            siteId: siteId,
            requestedBy: msg.sender,
            requestedAt: block.timestamp,
            paths: paths,
            regions: regions,
            completed: false,
            completedAt: 0
        });

        emit InvalidationRequested(requestId, siteId, msg.sender, paths.length);

        return requestId;
    }

    /**
     * @notice Mark invalidation as completed (called by nodes or coordinator)
     */
    function completeInvalidation(bytes32 requestId, uint256 nodesProcessed) external onlyOwner {
        InvalidationRequest storage inv = _invalidations[requestId];
        inv.completed = true;
        inv.completedAt = block.timestamp;

        emit InvalidationCompleted(requestId, nodesProcessed);
    }

    // ============ Usage Reporting ============

    /**
     * @notice Report usage from an edge node
     */
    function reportUsage(
        bytes32 nodeId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 bytesEgress,
        uint256 bytesIngress,
        uint256 requests,
        uint256 cacheHits,
        uint256 cacheMisses,
        bytes calldata signature
    ) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();

        bytes32 recordId = keccak256(abi.encodePacked(nodeId, periodStart, periodEnd));

        _usageRecords[nodeId].push(UsageRecord({
            recordId: recordId,
            nodeId: nodeId,
            provider: msg.sender,
            region: node.region,
            timestamp: block.timestamp,
            periodStart: periodStart,
            periodEnd: periodEnd,
            bytesEgress: bytesEgress,
            bytesIngress: bytesIngress,
            requests: requests,
            cacheHits: cacheHits,
            cacheMisses: cacheMisses,
            signature: signature
        }));

        emit UsageReported(nodeId, msg.sender, bytesEgress, requests, periodEnd - periodStart);
    }

    // ============ Staking ============

    /**
     * @notice Add stake to provider
     */
    function addProviderStake() external payable {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        _providers[msg.sender].stake += msg.value;
        emit StakeAdded(msg.sender, msg.value);
    }

    /**
     * @notice Add stake to edge node
     */
    function addNodeStake(bytes32 nodeId) external payable {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw provider stake
     */
    function withdrawProviderStake(uint256 amount) external nonReentrant {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.stake < amount) revert InsufficientStake(provider.stake, amount);
        if (provider.stake - amount < minProviderStake && provider.active) {
            revert InsufficientStake(provider.stake - amount, minProviderStake);
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ View Functions ============

    function getProvider(address provider) external view returns (Provider memory) {
        return _providers[provider];
    }

    function getProviderInfo(address provider) external view returns (ProviderInfo memory) {
        return ProviderInfo({
            provider: _providers[provider],
            capabilities: _capabilities[provider],
            pricing: _pricing[provider],
            metrics: _metrics[provider],
            regions: _providerRegions[provider],
            healthScore: 0, // Calculated off-chain
            reputationScore: 0 // From reputation system
        });
    }

    function getEdgeNode(bytes32 nodeId) external view returns (EdgeNode memory) {
        return _edgeNodes[nodeId];
    }

    function getNodeMetrics(bytes32 nodeId) external view returns (EdgeNodeMetrics memory) {
        return _nodeMetrics[nodeId];
    }

    function getSite(bytes32 siteId) external view returns (Site memory) {
        return _sites[siteId];
    }

    function getActiveProviders() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].active) {
                activeCount++;
            }
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].active) {
                active[j++] = _providerList[i];
            }
        }

        return active;
    }

    function getNodesInRegion(Region region) external view returns (bytes32[] memory) {
        return _regionNodes[region];
    }

    function getActiveNodesInRegion(Region region) external view returns (bytes32[] memory) {
        bytes32[] memory regionNodeList = _regionNodes[region];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < regionNodeList.length; i++) {
            if (_edgeNodes[regionNodeList[i]].status == NodeStatus.HEALTHY) {
                activeCount++;
            }
        }

        bytes32[] memory active = new bytes32[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < regionNodeList.length; i++) {
            if (_edgeNodes[regionNodeList[i]].status == NodeStatus.HEALTHY) {
                active[j++] = regionNodeList[i];
            }
        }

        return active;
    }

    function getOperatorNodes(address operator) external view returns (bytes32[] memory) {
        return _operatorNodes[operator];
    }

    function getOwnerSites(address owner_) external view returns (bytes32[] memory) {
        return _ownerSites[owner_];
    }

    function getProviderByAgent(uint256 agentId) external view returns (address) {
        return _agentToProvider[agentId];
    }

    function getUsageRecords(bytes32 nodeId) external view returns (UsageRecord[] memory) {
        return _usageRecords[nodeId];
    }

    // ============ Admin Functions ============

    function setMinProviderStake(uint256 _minStake) external onlyOwner {
        minProviderStake = _minStake;
    }

    function setMinNodeStake(uint256 _minStake) external onlyOwner {
        minNodeStake = _minStake;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
    }

    function verifyProvider(address provider) external onlyOwner {
        _providers[provider].verified = true;
    }

    function updateProviderMetrics(
        address provider,
        uint256 cacheHitRate,
        uint256 avgLatencyMs,
        uint256 uptime,
        uint256 errorRate
    ) external onlyOwner {
        _metrics[provider] = ProviderMetrics({
            totalBytesServed: _metrics[provider].totalBytesServed,
            totalRequests: _metrics[provider].totalRequests,
            cacheHitRate: cacheHitRate,
            avgLatencyMs: avgLatencyMs,
            p99LatencyMs: _metrics[provider].p99LatencyMs,
            uptime: uptime,
            errorRate: errorRate,
            lastHealthCheck: block.timestamp
        });
    }

    function slashProvider(address provider, uint256 amount, string calldata reason) external onlyOwner {
        Provider storage p = _providers[provider];
        if (p.stake < amount) {
            amount = p.stake;
        }
        p.stake -= amount;

        // Send slashed amount to owner (could be treasury)
        (bool success,) = owner().call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeSlashed(provider, amount, reason);
    }

    function updateProviderCapabilities(
        address provider,
        ProviderCapabilities calldata capabilities
    ) external {
        if (_providers[msg.sender].registeredAt == 0 && msg.sender != owner()) {
            revert ProviderNotRegistered();
        }
        if (msg.sender != provider && msg.sender != owner()) {
            revert ProviderNotRegistered();
        }
        _capabilities[provider] = capabilities;
    }

    function updateProviderPricing(
        address provider,
        ProviderPricing calldata pricing
    ) external {
        if (_providers[msg.sender].registeredAt == 0 && msg.sender != owner()) {
            revert ProviderNotRegistered();
        }
        if (msg.sender != provider && msg.sender != owner()) {
            revert ProviderNotRegistered();
        }
        _pricing[provider] = pricing;
    }

    function updateProviderRegions(Region[] calldata regions) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        delete _providerRegions[msg.sender];
        for (uint256 i = 0; i < regions.length; i++) {
            _providerRegions[msg.sender].push(regions[i]);
        }
    }
}

