// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {ICDNTypes} from "./ICDNTypes.sol";

/**
 * @title CDNRegistry
 * @notice Registry for decentralized CDN providers and edge nodes
 */
contract CDNRegistry is ICDNTypes, ProviderRegistryBase {
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;

    uint256 public minNodeStake = 0.001 ether;
    mapping(address => Provider) private _providers;

    mapping(address => ProviderCapabilities) private _capabilities;
    mapping(address => ProviderPricing) private _pricing;
    mapping(address => ProviderMetrics) private _metrics;
    mapping(address => Region[]) private _providerRegions;
    mapping(bytes32 => EdgeNode) private _edgeNodes;
    mapping(bytes32 => EdgeNodeMetrics) private _nodeMetrics;
    mapping(address => bytes32[]) private _operatorNodes;
    mapping(Region => bytes32[]) private _regionNodes;
    bytes32[] private _nodeList;
    mapping(bytes32 => Site) private _sites;
    mapping(address => bytes32[]) private _ownerSites;
    mapping(bytes32 => InvalidationRequest) private _invalidations;
    mapping(bytes32 => UsageRecord[]) private _usageRecords;
    mapping(address => BillingRecord[]) private _billingRecords;
    uint256 public nodeCount;
    uint256 public siteCount;

    event CDNProviderUpdated(address indexed provider);

    error NodeNotFound();
    error SiteNotFound();
    error NotSiteOwner();
    error NotNodeOperator();
    error InvalidEndpoint();
    error InvalidRegion();
    error InvalidProviderType();
    error InvalidName();


    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake) {}

    function registerProvider(
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash
    ) external payable nonReentrant whenNotPaused {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (uint8(providerType) > uint8(ProviderType.RESIDENTIAL)) revert InvalidProviderType();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, name, endpoint, providerType, attestationHash, 0);
    }

    function registerProviderWithAgent(
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) external payable nonReentrant whenNotPaused {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (uint8(providerType) > uint8(ProviderType.RESIDENTIAL)) revert InvalidProviderType();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, name, endpoint, providerType, attestationHash, agentId);
    }

    function _storeProviderData(
        address provider,
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) internal {
        _providers[provider] = Provider({
            owner: provider,
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
    }

    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal override {
        if (_providers[provider].registeredAt != 0) {
            revert ProviderAlreadyRegistered();
        }
    }

    function registerEdgeNode(
        string calldata endpoint,
        Region region,
        ProviderType providerType
    ) external payable nonReentrant returns (bytes32 nodeId) {
        return _registerEdgeNodeInternal(endpoint, region, providerType, 0);
    }

    function registerEdgeNodeWithAgent(
        string calldata endpoint,
        Region region,
        ProviderType providerType,
        uint256 agentId
    ) external payable nonReentrant returns (bytes32 nodeId) {
        ERC8004ProviderMixin.verifyAgentOwnership(erc8004, msg.sender, agentId);
        moderation.requireAgentNotBanned(agentId);
        return _registerEdgeNodeInternal(endpoint, region, providerType, agentId);
    }

    function _registerEdgeNodeInternal(
        string calldata endpoint,
        Region region,
        ProviderType providerType,
        uint256 agentId
    ) internal returns (bytes32 nodeId) {
        moderation.requireNotBanned(msg.sender);

        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (msg.value < minNodeStake) revert InsufficientStake(msg.value, minNodeStake);

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
            agentId: agentId
        });

        _operatorNodes[msg.sender].push(nodeId);
        _regionNodes[region].push(nodeId);
        _nodeList.push(nodeId);
        nodeCount++;

        emit EdgeNodeRegistered(nodeId, msg.sender, region, providerType, msg.value);

        return nodeId;
    }

    function updateNodeStatus(bytes32 nodeId, NodeStatus status) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender && msg.sender != owner()) revert NotNodeOperator();

        node.status = status;
        node.lastSeen = block.timestamp;

        emit EdgeNodeStatusUpdated(nodeId, status);
    }

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
            cacheSize: 0,
            cacheEntries: 0,
            cacheHitRate: cacheHitRate,
            avgResponseTime: avgResponseTime,
            lastUpdated: block.timestamp
        });

        node.lastSeen = block.timestamp;
    }

    function deactivateNode(bytes32 nodeId, string calldata reason) external {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender && msg.sender != owner()) revert NotNodeOperator();

        node.status = NodeStatus.OFFLINE;

        emit EdgeNodeDeactivated(nodeId, node.operator, reason);
    }


    function deactivateProvider() external {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    function reactivateProvider() external {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }

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

    function updateSiteContent(bytes32 siteId, bytes32 contentHash) external {
        Site storage site = _sites[siteId];
        if (site.owner != msg.sender) revert NotSiteOwner();

        site.contentHash = contentHash;
        site.updatedAt = block.timestamp;

        emit SiteUpdated(siteId, contentHash);
    }

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

    function completeInvalidation(bytes32 requestId, uint256 nodesProcessed) external onlyOwner {
        InvalidationRequest storage inv = _invalidations[requestId];
        inv.completed = true;
        inv.completedAt = block.timestamp;

        emit InvalidationCompleted(requestId, nodesProcessed);
    }

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

    function addProviderStake() external payable nonReentrant {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    function addNodeStake(bytes32 nodeId) external payable {
        EdgeNode storage node = _edgeNodes[nodeId];
        if (node.operator != msg.sender) revert NotNodeOperator();
        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, node.stake);
    }

    function withdrawProviderStake(uint256 amount) external nonReentrant {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.stake < amount) revert InsufficientStake(provider.stake, amount);
        if (provider.stake - amount < minProviderStake && provider.active) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }


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
            healthScore: 0,
            reputationScore: 0
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

    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].active) {
                activeCount++;
            }
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].active) {
                active[j++] = providerList[i];
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

    function getUsageRecords(bytes32 nodeId) external view returns (UsageRecord[] memory) {
        return _usageRecords[nodeId];
    }


    function setMinNodeStake(uint256 _minStake) external onlyOwner {
        minNodeStake = _minStake;
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
        emit CDNProviderUpdated(provider);
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
        emit CDNProviderUpdated(provider);
    }

    function updateProviderRegions(Region[] calldata regions) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        delete _providerRegions[msg.sender];
        for (uint256 i = 0; i < regions.length; i++) {
            _providerRegions[msg.sender].push(regions[i]);
        }
        emit CDNProviderUpdated(msg.sender);
    }
}
