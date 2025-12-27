// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {ServiceRegistry} from "../services/ServiceRegistry.sol";

/**
 * @title DWSServiceProvisioning
 * @notice On-chain provisioning for DWS services (OAuth3, Farcaster, Messaging, etc.)
 * @dev Services are registered on-chain with their code CID, requirements, and pricing.
 *      DWS nodes discover services and deploy them based on capabilities.
 *
 * Flow:
 * 1. Service owner uploads code to IPFS, gets CID
 * 2. Owner calls provisionService() with CID, requirements, pricing
 * 3. DWS nodes query for services matching their capabilities
 * 4. Nodes pull code, verify hash, deploy worker
 * 5. Nodes call reportDeployment() to register as service provider
 * 6. Users discover service endpoints via getServiceEndpoints()
 */
contract DWSServiceProvisioning is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct ServiceDefinition {
        bytes32 serviceId;
        string serviceName;
        string codeCid; // IPFS CID of service code bundle
        bytes32 codeHash; // Keccak256 of code for verification
        string entrypoint; // Worker entrypoint (e.g., "index.js")
        string runtime; // "workerd", "bun", "docker"
        address owner;
        uint256 ownerAgentId; // ERC-8004 agent ID of owner (optional)
        ServiceRequirements requirements;
        ServicePricing pricing;
        ServiceStatus status;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 version;
    }

    struct ServiceRequirements {
        uint256 minMemoryMb;
        uint256 minCpuMillis;
        uint256 minStorageMb;
        bool teeRequired;
        string teePlatform; // "intel_tdx", "amd_sev", "phala", "" for any
        uint256 minInstances;
        uint256 maxInstances;
        uint256 minNodeStake;
        uint256 minNodeReputation;
        bool mpcRequired; // Needs access to MPC infrastructure
        bytes32 mpcClusterId; // Required MPC cluster (0 for any)
    }

    struct ServicePricing {
        uint256 basePrice; // Base price per request
        uint256 minPrice;
        uint256 maxPrice;
        uint256 pricePerSecond; // For long-running services
        uint256 pricePerMb; // For data transfer
    }

    struct ServiceDeployment {
        bytes32 deploymentId;
        bytes32 serviceId;
        uint256 nodeAgentId; // DWS node running this service
        string endpoint; // HTTP endpoint
        DeploymentStatus status;
        uint256 deployedAt;
        uint256 lastHealthCheck;
        uint256 requestsServed;
        uint256 errorsCount;
    }

    enum ServiceStatus {
        Draft,
        Pending,
        Active,
        Paused,
        Deprecated
    }
    enum DeploymentStatus {
        Deploying,
        Active,
        Draining,
        Stopped,
        Failed
    }

    // ============ State ============

    IIdentityRegistry public identityRegistry;
    ServiceRegistry public serviceRegistry;

    mapping(bytes32 => ServiceDefinition) public services;
    mapping(string => bytes32) public serviceNameToId;
    mapping(bytes32 => bytes32[]) public serviceDeployments; // serviceId => deploymentIds
    mapping(bytes32 => ServiceDeployment) public deployments;
    mapping(uint256 => bytes32[]) public nodeServices; // nodeAgentId => serviceIds

    bytes32[] public allServiceIds;

    // Service categories for discovery
    mapping(string => bytes32[]) public servicesByCategory;

    // ============ Events ============

    event ServiceProvisioned(bytes32 indexed serviceId, string serviceName, string codeCid, address owner);
    event ServiceUpdated(bytes32 indexed serviceId, string codeCid, uint256 version);
    event ServiceStatusChanged(bytes32 indexed serviceId, ServiceStatus oldStatus, ServiceStatus newStatus);

    event DeploymentReported(
        bytes32 indexed deploymentId, bytes32 indexed serviceId, uint256 indexed nodeAgentId, string endpoint
    );
    event DeploymentStatusChanged(bytes32 indexed deploymentId, DeploymentStatus oldStatus, DeploymentStatus newStatus);
    event DeploymentHealthChecked(bytes32 indexed deploymentId, bool healthy);

    // ============ Errors ============

    error ServiceAlreadyExists();
    error ServiceNotFound();
    error ServiceNotActive();
    error DeploymentNotFound();
    error UnauthorizedOwner();
    error InvalidCodeHash();
    error NodeNotRegistered();
    error MaxInstancesReached();
    error MinInstancesNotMet();

    // ============ Constructor ============

    constructor(address _identityRegistry, address _serviceRegistry) Ownable(msg.sender) {
        identityRegistry = IIdentityRegistry(_identityRegistry);
        serviceRegistry = ServiceRegistry(_serviceRegistry);
    }

    // ============ Service Provisioning ============

    /**
     * @notice Provision a new service on DWS
     * @param serviceName Unique service name (e.g., "oauth3", "farcaster-signer")
     * @param category Service category (e.g., "auth", "social", "communication")
     * @param codeCid IPFS CID of the service code bundle
     * @param codeHash Keccak256 hash of the code for verification
     * @param entrypoint Worker entrypoint file
     * @param runtime Runtime environment
     * @param requirements Service requirements
     * @param pricing Service pricing
     */
    function provisionService(
        string calldata serviceName,
        string calldata category,
        string calldata codeCid,
        bytes32 codeHash,
        string calldata entrypoint,
        string calldata runtime,
        ServiceRequirements calldata requirements,
        ServicePricing calldata pricing
    ) external returns (bytes32 serviceId) {
        if (serviceNameToId[serviceName] != bytes32(0)) revert ServiceAlreadyExists();

        serviceId = keccak256(abi.encodePacked(serviceName, msg.sender, block.timestamp));

        services[serviceId] = ServiceDefinition({
            serviceId: serviceId,
            serviceName: serviceName,
            codeCid: codeCid,
            codeHash: codeHash,
            entrypoint: entrypoint,
            runtime: runtime,
            owner: msg.sender,
            ownerAgentId: 0,
            requirements: requirements,
            pricing: pricing,
            status: ServiceStatus.Pending,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            version: 1
        });

        serviceNameToId[serviceName] = serviceId;
        allServiceIds.push(serviceId);
        servicesByCategory[category].push(serviceId);

        // Register in ServiceRegistry for pricing/usage tracking
        serviceRegistry.registerService(
            serviceName, category, pricing.basePrice, pricing.minPrice, pricing.maxPrice, msg.sender
        );

        emit ServiceProvisioned(serviceId, serviceName, codeCid, msg.sender);
    }

    /**
     * @notice Update service code (creates new version)
     */
    function updateServiceCode(bytes32 serviceId, string calldata codeCid, bytes32 codeHash) external {
        ServiceDefinition storage service = services[serviceId];
        if (service.owner == address(0)) revert ServiceNotFound();
        if (service.owner != msg.sender) revert UnauthorizedOwner();

        service.codeCid = codeCid;
        service.codeHash = codeHash;
        service.version++;
        service.updatedAt = block.timestamp;

        emit ServiceUpdated(serviceId, codeCid, service.version);
    }

    /**
     * @notice Activate a service (after initial deployments)
     */
    function activateService(bytes32 serviceId) external {
        ServiceDefinition storage service = services[serviceId];
        if (service.owner == address(0)) revert ServiceNotFound();
        if (service.owner != msg.sender && msg.sender != owner()) revert UnauthorizedOwner();

        // Check minimum instances are deployed
        uint256 activeDeployments = _countActiveDeployments(serviceId);
        if (activeDeployments < service.requirements.minInstances) revert MinInstancesNotMet();

        ServiceStatus oldStatus = service.status;
        service.status = ServiceStatus.Active;

        emit ServiceStatusChanged(serviceId, oldStatus, ServiceStatus.Active);
    }

    /**
     * @notice Pause a service
     */
    function pauseService(bytes32 serviceId) external {
        ServiceDefinition storage service = services[serviceId];
        if (service.owner == address(0)) revert ServiceNotFound();
        if (service.owner != msg.sender && msg.sender != owner()) revert UnauthorizedOwner();

        ServiceStatus oldStatus = service.status;
        service.status = ServiceStatus.Paused;

        emit ServiceStatusChanged(serviceId, oldStatus, ServiceStatus.Paused);
    }

    // ============ Deployment Management ============

    /**
     * @notice Report a service deployment (called by DWS nodes)
     * @param serviceId Service being deployed
     * @param nodeAgentId Node's ERC-8004 agent ID
     * @param endpoint HTTP endpoint for the deployment
     */
    function reportDeployment(bytes32 serviceId, uint256 nodeAgentId, string calldata endpoint)
        external
        returns (bytes32 deploymentId)
    {
        ServiceDefinition storage service = services[serviceId];
        if (service.owner == address(0)) revert ServiceNotFound();

        // Verify node is registered in IdentityRegistry
        address nodeOwner = identityRegistry.ownerOf(nodeAgentId);
        if (nodeOwner == address(0)) revert NodeNotRegistered();

        // Check max instances
        uint256 activeDeployments = _countActiveDeployments(serviceId);
        if (activeDeployments >= service.requirements.maxInstances) revert MaxInstancesReached();

        deploymentId = keccak256(abi.encodePacked(serviceId, nodeAgentId, block.timestamp));

        deployments[deploymentId] = ServiceDeployment({
            deploymentId: deploymentId,
            serviceId: serviceId,
            nodeAgentId: nodeAgentId,
            endpoint: endpoint,
            status: DeploymentStatus.Active,
            deployedAt: block.timestamp,
            lastHealthCheck: block.timestamp,
            requestsServed: 0,
            errorsCount: 0
        });

        serviceDeployments[serviceId].push(deploymentId);
        nodeServices[nodeAgentId].push(serviceId);

        emit DeploymentReported(deploymentId, serviceId, nodeAgentId, endpoint);
    }

    /**
     * @notice Update deployment status
     */
    function updateDeploymentStatus(bytes32 deploymentId, DeploymentStatus newStatus) external {
        ServiceDeployment storage deployment = deployments[deploymentId];
        if (deployment.nodeAgentId == 0) revert DeploymentNotFound();

        // Verify caller owns the node
        address nodeOwner = identityRegistry.ownerOf(deployment.nodeAgentId);
        if (nodeOwner != msg.sender) revert UnauthorizedOwner();

        DeploymentStatus oldStatus = deployment.status;
        deployment.status = newStatus;

        emit DeploymentStatusChanged(deploymentId, oldStatus, newStatus);
    }

    /**
     * @notice Report health check result
     */
    function reportHealthCheck(bytes32 deploymentId, bool healthy, uint256 requestsServed, uint256 errorsCount)
        external
    {
        ServiceDeployment storage deployment = deployments[deploymentId];
        if (deployment.nodeAgentId == 0) revert DeploymentNotFound();

        deployment.lastHealthCheck = block.timestamp;
        deployment.requestsServed = requestsServed;
        deployment.errorsCount = errorsCount;

        if (!healthy && deployment.status == DeploymentStatus.Active) {
            deployment.status = DeploymentStatus.Failed;
            emit DeploymentStatusChanged(deploymentId, DeploymentStatus.Active, DeploymentStatus.Failed);
        }

        emit DeploymentHealthChecked(deploymentId, healthy);
    }

    // ============ Discovery ============

    /**
     * @notice Get all active endpoints for a service
     */
    function getServiceEndpoints(bytes32 serviceId) external view returns (string[] memory endpoints) {
        bytes32[] storage deploys = serviceDeployments[serviceId];
        uint256 activeCount = _countActiveDeployments(serviceId);

        endpoints = new string[](activeCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < deploys.length; i++) {
            ServiceDeployment storage d = deployments[deploys[i]];
            if (d.status == DeploymentStatus.Active) {
                endpoints[idx++] = d.endpoint;
            }
        }
    }

    /**
     * @notice Get services that a node should deploy based on its capabilities
     * @dev Called by DWS nodes to discover services matching their capabilities
     */
    function getServicesToDeploy(
        uint256 nodeAgentId,
        bool hasTee,
        string calldata teePlatform,
        uint256 memoryMb,
        uint256 cpuMillis,
        uint256 nodeStake,
        uint256 nodeReputation
    ) external view returns (bytes32[] memory matchingServices) {
        // Count matching services first
        uint256 matchCount = 0;
        for (uint256 i = 0; i < allServiceIds.length; i++) {
            if (
                _nodeMatchesRequirements(
                    allServiceIds[i], hasTee, teePlatform, memoryMb, cpuMillis, nodeStake, nodeReputation
                )
            ) {
                matchCount++;
            }
        }

        // Collect matching services
        matchingServices = new bytes32[](matchCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allServiceIds.length; i++) {
            if (
                _nodeMatchesRequirements(
                    allServiceIds[i], hasTee, teePlatform, memoryMb, cpuMillis, nodeStake, nodeReputation
                )
            ) {
                matchingServices[idx++] = allServiceIds[i];
            }
        }
    }

    /**
     * @notice Get services by category
     */
    function getServicesByCategory(string calldata category) external view returns (bytes32[] memory) {
        return servicesByCategory[category];
    }

    /**
     * @notice Get service definition
     */
    function getService(bytes32 serviceId)
        external
        view
        returns (
            string memory serviceName,
            string memory codeCid,
            bytes32 codeHash,
            string memory entrypoint,
            string memory runtime,
            address serviceOwner,
            ServiceStatus status,
            uint256 version,
            uint256 activeDeployments
        )
    {
        ServiceDefinition storage service = services[serviceId];
        return (
            service.serviceName,
            service.codeCid,
            service.codeHash,
            service.entrypoint,
            service.runtime,
            service.owner,
            service.status,
            service.version,
            _countActiveDeployments(serviceId)
        );
    }

    /**
     * @notice Get service requirements
     */
    function getServiceRequirements(bytes32 serviceId) external view returns (ServiceRequirements memory) {
        return services[serviceId].requirements;
    }

    // ============ Internal ============

    function _countActiveDeployments(bytes32 serviceId) internal view returns (uint256 count) {
        bytes32[] storage deploys = serviceDeployments[serviceId];
        for (uint256 i = 0; i < deploys.length; i++) {
            if (deployments[deploys[i]].status == DeploymentStatus.Active) {
                count++;
            }
        }
    }

    function _nodeMatchesRequirements(
        bytes32 serviceId,
        bool hasTee,
        string calldata teePlatform,
        uint256 memoryMb,
        uint256 cpuMillis,
        uint256 nodeStake,
        uint256 nodeReputation
    ) internal view returns (bool) {
        ServiceDefinition storage service = services[serviceId];

        // Skip non-active services
        if (service.status != ServiceStatus.Pending && service.status != ServiceStatus.Active) {
            return false;
        }

        ServiceRequirements storage req = service.requirements;

        // Check TEE requirement
        if (req.teeRequired && !hasTee) return false;
        if (bytes(req.teePlatform).length > 0 && keccak256(bytes(teePlatform)) != keccak256(bytes(req.teePlatform))) {
            return false;
        }

        // Check resource requirements
        if (memoryMb < req.minMemoryMb) return false;
        if (cpuMillis < req.minCpuMillis) return false;

        // Check stake and reputation
        if (nodeStake < req.minNodeStake) return false;
        if (nodeReputation < req.minNodeReputation) return false;

        // Check if more instances are needed
        uint256 activeDeployments = _countActiveDeployments(serviceId);
        if (activeDeployments >= req.maxInstances) return false;

        return true;
    }

    // ============ Admin ============

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function setServiceRegistry(address _serviceRegistry) external onlyOwner {
        serviceRegistry = ServiceRegistry(_serviceRegistry);
    }
}
