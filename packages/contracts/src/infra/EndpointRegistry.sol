// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title EndpointRegistry
 * @notice On-chain registry of network endpoints for decentralized DNS fallback
 * @dev Provides a censorship-resistant way to discover network endpoints when
 *      traditional DNS fails. Endpoints are organized by service type and region.
 * 
 * Services include: RPC, WebSocket, API, Gateway, Storage, CDN, Proxy
 * Each endpoint has priority (0 = highest) and health status
 */
contract EndpointRegistry is Ownable {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ============================================================================
    // Types
    // ============================================================================

    struct Endpoint {
        string url;
        string region;
        uint256 priority;
        bool active;
        uint256 addedAt;
        uint256 lastHealthCheck;
        uint256 uptimeSeconds;
        uint256 responseTimeMs;
    }

    struct ServiceInfo {
        bytes32 serviceId;
        string name;
        string description;
        bool critical;
        uint256 minEndpoints;
    }

    // ============================================================================
    // Storage
    // ============================================================================

    // Service ID => Array of endpoints
    mapping(bytes32 => Endpoint[]) private _endpoints;
    
    // Service ID => URL hash => Index in endpoints array
    mapping(bytes32 => mapping(bytes32 => uint256)) private _endpointIndex;
    
    // Service ID => URL hash => Exists
    mapping(bytes32 => mapping(bytes32 => bool)) private _endpointExists;
    
    // All registered service IDs
    EnumerableSet.Bytes32Set private _serviceIds;
    
    // Service info
    mapping(bytes32 => ServiceInfo) private _serviceInfo;
    
    // Authorized operators who can update health status
    mapping(address => bool) public healthOperators;
    
    // Region list
    string[] private _regions;
    mapping(bytes32 => bool) private _regionExists;

    // ============================================================================
    // Events
    // ============================================================================

    event EndpointAdded(bytes32 indexed serviceId, string url, string region, uint256 priority);
    event EndpointRemoved(bytes32 indexed serviceId, string url);
    event EndpointUpdated(bytes32 indexed serviceId, string url, uint256 priority, bool active);
    event HealthUpdated(bytes32 indexed serviceId, string url, uint256 responseTimeMs, bool healthy);
    event ServiceRegistered(bytes32 indexed serviceId, string name);
    event OperatorUpdated(address indexed operator, bool authorized);
    event RegionAdded(string region);

    // ============================================================================
    // Errors
    // ============================================================================

    error EndpointAlreadyExists();
    error EndpointNotFound();
    error ServiceNotFound();
    error UnauthorizedOperator();
    error InvalidUrl();
    error InvalidPriority();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor() Ownable(msg.sender) {
        // Register default services
        _registerService(keccak256("rpc"), "RPC", "JSON-RPC endpoint", true, 2);
        _registerService(keccak256("ws"), "WebSocket", "WebSocket RPC endpoint", true, 2);
        _registerService(keccak256("api"), "API", "REST API endpoint", true, 1);
        _registerService(keccak256("gateway"), "Gateway", "Application gateway", true, 1);
        _registerService(keccak256("storage"), "Storage", "IPFS/Storage gateway", false, 1);
        _registerService(keccak256("cdn"), "CDN", "CDN edge node", false, 1);
        _registerService(keccak256("proxy"), "Proxy", "Proxy coordinator", false, 1);
        _registerService(keccak256("indexer"), "Indexer", "GraphQL indexer", false, 1);
        _registerService(keccak256("explorer"), "Explorer", "Block explorer", false, 1);
        
        // Register default regions
        _addRegion("aws-us-east-1");
        _addRegion("aws-us-west-2");
        _addRegion("aws-eu-west-1");
        _addRegion("gcp-us-central1");
        _addRegion("gcp-us-east1");
        _addRegion("gcp-europe-west1");
        _addRegion("global");
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    /**
     * @notice Register a new service type
     */
    function registerService(
        bytes32 serviceId,
        string calldata name,
        string calldata description,
        bool critical,
        uint256 minEndpoints
    ) external onlyOwner {
        _registerService(serviceId, name, description, critical, minEndpoints);
    }

    /**
     * @notice Add a new endpoint
     */
    function addEndpoint(
        bytes32 serviceId,
        string calldata url,
        string calldata region,
        uint256 priority
    ) external onlyOwner {
        if (bytes(url).length == 0) revert InvalidUrl();
        if (!_serviceIds.contains(serviceId)) revert ServiceNotFound();
        
        bytes32 urlHash = keccak256(bytes(url));
        if (_endpointExists[serviceId][urlHash]) revert EndpointAlreadyExists();
        
        uint256 index = _endpoints[serviceId].length;
        _endpoints[serviceId].push(Endpoint({
            url: url,
            region: region,
            priority: priority,
            active: true,
            addedAt: block.timestamp,
            lastHealthCheck: 0,
            uptimeSeconds: 0,
            responseTimeMs: 0
        }));
        
        _endpointIndex[serviceId][urlHash] = index;
        _endpointExists[serviceId][urlHash] = true;
        
        emit EndpointAdded(serviceId, url, region, priority);
    }

    /**
     * @notice Remove an endpoint
     */
    function removeEndpoint(bytes32 serviceId, string calldata url) external onlyOwner {
        bytes32 urlHash = keccak256(bytes(url));
        if (!_endpointExists[serviceId][urlHash]) revert EndpointNotFound();
        
        uint256 index = _endpointIndex[serviceId][urlHash];
        uint256 lastIndex = _endpoints[serviceId].length - 1;
        
        if (index != lastIndex) {
            Endpoint storage lastEndpoint = _endpoints[serviceId][lastIndex];
            _endpoints[serviceId][index] = lastEndpoint;
            _endpointIndex[serviceId][keccak256(bytes(lastEndpoint.url))] = index;
        }
        
        _endpoints[serviceId].pop();
        delete _endpointIndex[serviceId][urlHash];
        delete _endpointExists[serviceId][urlHash];
        
        emit EndpointRemoved(serviceId, url);
    }

    /**
     * @notice Update endpoint priority and status
     */
    function updateEndpoint(
        bytes32 serviceId,
        string calldata url,
        uint256 priority,
        bool active
    ) external onlyOwner {
        bytes32 urlHash = keccak256(bytes(url));
        if (!_endpointExists[serviceId][urlHash]) revert EndpointNotFound();
        
        uint256 index = _endpointIndex[serviceId][urlHash];
        _endpoints[serviceId][index].priority = priority;
        _endpoints[serviceId][index].active = active;
        
        emit EndpointUpdated(serviceId, url, priority, active);
    }

    /**
     * @notice Set health check operator
     */
    function setOperator(address operator, bool authorized) external onlyOwner {
        healthOperators[operator] = authorized;
        emit OperatorUpdated(operator, authorized);
    }

    /**
     * @notice Add a new region
     */
    function addRegion(string calldata region) external onlyOwner {
        _addRegion(region);
    }

    // ============================================================================
    // Operator Functions
    // ============================================================================

    /**
     * @notice Update endpoint health metrics
     */
    function updateHealth(
        bytes32 serviceId,
        string calldata url,
        uint256 responseTimeMs,
        bool healthy
    ) external {
        if (!healthOperators[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedOperator();
        }
        
        bytes32 urlHash = keccak256(bytes(url));
        if (!_endpointExists[serviceId][urlHash]) revert EndpointNotFound();
        
        uint256 index = _endpointIndex[serviceId][urlHash];
        Endpoint storage endpoint = _endpoints[serviceId][index];
        
        if (healthy && endpoint.lastHealthCheck > 0) {
            endpoint.uptimeSeconds += block.timestamp - endpoint.lastHealthCheck;
        }
        
        endpoint.lastHealthCheck = block.timestamp;
        endpoint.responseTimeMs = responseTimeMs;
        endpoint.active = healthy;
        
        emit HealthUpdated(serviceId, url, responseTimeMs, healthy);
    }

    /**
     * @notice Batch update health for multiple endpoints
     */
    function batchUpdateHealth(
        bytes32[] calldata serviceIds,
        string[] calldata urls,
        uint256[] calldata responseTimes,
        bool[] calldata healthy
    ) external {
        if (!healthOperators[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedOperator();
        }
        
        uint256 length = serviceIds.length;
        for (uint256 i = 0; i < length; i++) {
            bytes32 urlHash = keccak256(bytes(urls[i]));
            if (!_endpointExists[serviceIds[i]][urlHash]) continue;
            
            uint256 index = _endpointIndex[serviceIds[i]][urlHash];
            Endpoint storage endpoint = _endpoints[serviceIds[i]][index];
            
            if (healthy[i] && endpoint.lastHealthCheck > 0) {
                endpoint.uptimeSeconds += block.timestamp - endpoint.lastHealthCheck;
            }
            
            endpoint.lastHealthCheck = block.timestamp;
            endpoint.responseTimeMs = responseTimes[i];
            endpoint.active = healthy[i];
        }
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Get all endpoints for a service
     */
    function getEndpoints(bytes32 serviceId) external view returns (Endpoint[] memory) {
        return _endpoints[serviceId];
    }

    /**
     * @notice Get active endpoints for a service, sorted by priority
     */
    function getActiveEndpoints(bytes32 serviceId) external view returns (Endpoint[] memory) {
        Endpoint[] storage all = _endpoints[serviceId];
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) activeCount++;
        }
        
        Endpoint[] memory active = new Endpoint[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) {
                active[j++] = all[i];
            }
        }
        
        // Sort by priority (bubble sort for simplicity, arrays are small)
        for (uint256 i = 0; i < active.length; i++) {
            for (uint256 k = i + 1; k < active.length; k++) {
                if (active[k].priority < active[i].priority) {
                    Endpoint memory temp = active[i];
                    active[i] = active[k];
                    active[k] = temp;
                }
            }
        }
        
        return active;
    }

    /**
     * @notice Get endpoints for a specific region
     */
    function getEndpointsByRegion(
        bytes32 serviceId,
        string calldata region
    ) external view returns (Endpoint[] memory) {
        Endpoint[] storage all = _endpoints[serviceId];
        bytes32 regionHash = keccak256(bytes(region));
        uint256 matchCount = 0;
        
        for (uint256 i = 0; i < all.length; i++) {
            if (keccak256(bytes(all[i].region)) == regionHash) matchCount++;
        }
        
        Endpoint[] memory matched = new Endpoint[](matchCount);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (keccak256(bytes(all[i].region)) == regionHash) {
                matched[j++] = all[i];
            }
        }
        
        return matched;
    }

    /**
     * @notice Get best endpoint (active, lowest priority, fastest response)
     */
    function getBestEndpoint(bytes32 serviceId) external view returns (
        string memory url,
        string memory region,
        uint256 responseTimeMs
    ) {
        Endpoint[] storage all = _endpoints[serviceId];
        
        uint256 bestIndex = type(uint256).max;
        uint256 bestScore = type(uint256).max;
        
        for (uint256 i = 0; i < all.length; i++) {
            if (!all[i].active) continue;
            
            // Score = priority * 1000 + responseTime
            uint256 score = all[i].priority * 1000 + all[i].responseTimeMs;
            if (score < bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
        
        if (bestIndex == type(uint256).max) {
            return ("", "", 0);
        }
        
        return (
            all[bestIndex].url,
            all[bestIndex].region,
            all[bestIndex].responseTimeMs
        );
    }

    /**
     * @notice Get service info
     */
    function getServiceInfo(bytes32 serviceId) external view returns (ServiceInfo memory) {
        return _serviceInfo[serviceId];
    }

    /**
     * @notice Get all registered services
     */
    function getServices() external view returns (bytes32[] memory) {
        return _serviceIds.values();
    }

    /**
     * @notice Get all regions
     */
    function getRegions() external view returns (string[] memory) {
        return _regions;
    }

    /**
     * @notice Get endpoint count for a service
     */
    function getEndpointCount(bytes32 serviceId) external view returns (uint256) {
        return _endpoints[serviceId].length;
    }

    /**
     * @notice Check if endpoint exists
     */
    function endpointExists(bytes32 serviceId, string calldata url) external view returns (bool) {
        return _endpointExists[serviceId][keccak256(bytes(url))];
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _registerService(
        bytes32 serviceId,
        string memory name,
        string memory description,
        bool critical,
        uint256 minEndpoints
    ) internal {
        _serviceIds.add(serviceId);
        _serviceInfo[serviceId] = ServiceInfo({
            serviceId: serviceId,
            name: name,
            description: description,
            critical: critical,
            minEndpoints: minEndpoints
        });
        
        emit ServiceRegistered(serviceId, name);
    }

    function _addRegion(string memory region) internal {
        bytes32 regionHash = keccak256(bytes(region));
        if (!_regionExists[regionHash]) {
            _regions.push(region);
            _regionExists[regionHash] = true;
            emit RegionAdded(region);
        }
    }
}

