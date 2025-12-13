// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title KeepaliveRegistry
 * @author Jeju Network
 * @notice Manages keepalive configurations for decentralized apps
 * @dev Tracks health check endpoints, funding status, and auto-recovery rules.
 *      Integrates with TriggerRegistry for scheduled health checks and
 *      AgentVault for automated funding.
 *
 * Apps register their keepalive configuration including:
 * - JNS name (for frontend serving)
 * - Health check endpoints (standardized API)
 * - Funding requirements (minimum balance, vault address)
 * - Dependencies (other keepalives this app depends on)
 *
 * The executor network periodically runs health checks and can:
 * - Mark apps as unhealthy
 * - Trigger auto-funding from vault
 * - Re-provision resources (re-pin IPFS, restart triggers)
 */
contract KeepaliveRegistry is Ownable, ReentrancyGuard, Pausable {
    // ============ Enums ============

    enum ResourceType {
        IPFS_CONTENT, // Frontend/static content on IPFS
        COMPUTE_ENDPOINT, // API/backend compute
        TRIGGER, // TriggerRegistry trigger
        STORAGE, // StorageProviderRegistry
        AGENT, // ERC-8004 agent
        CUSTOM // Custom endpoint

    }

    enum HealthStatus {
        UNKNOWN,
        HEALTHY,
        DEGRADED,
        UNHEALTHY,
        UNFUNDED
    }

    // ============ Structs ============

    struct Resource {
        ResourceType resourceType;
        string identifier; // CID, endpoint URL, trigger ID, etc.
        string healthEndpoint; // Standard health check URL
        uint256 minBalance; // Min balance required (0 if N/A)
        bool required; // If false, degraded not unhealthy
    }

    struct KeepaliveConfig {
        bytes32 keepaliveId;
        address owner;
        bytes32 jnsNode; // JNS name node
        uint256 agentId; // ERC-8004 agent (0 if none)
        address vaultAddress; // Funding source
        uint256 globalMinBalance; // Min total balance
        uint256 checkInterval; // Seconds between health checks
        uint256 autoFundAmount; // Amount to auto-fund when low
        bool autoFundEnabled; // Enable auto-funding
        bool active;
        uint256 createdAt;
        uint256 lastCheckAt;
        HealthStatus lastStatus;
    }

    struct HealthCheckResult {
        bytes32 keepaliveId;
        HealthStatus status;
        uint256 timestamp;
        uint256 balance;
        uint8 healthyResources;
        uint8 totalResources;
        string[] failedResources;
    }

    // ============ State Variables ============

    mapping(bytes32 => KeepaliveConfig) public keepalives;
    mapping(bytes32 => Resource[]) public keepaliveResources;
    mapping(bytes32 => bytes32[]) public keepaliveDependencies;
    mapping(bytes32 => HealthCheckResult) public lastHealthCheck;

    mapping(address => bytes32[]) public ownerKeepalives;
    mapping(bytes32 => bytes32) public jnsToKeepalive;
    mapping(uint256 => bytes32) public agentToKeepalive;

    bytes32[] public allKeepaliveIds;

    mapping(address => bool) public authorizedExecutors;
    bool public requireExecutorAuth;

    address public triggerRegistry;
    address public agentVault;
    address public jnsRegistry;

    // ============ Events ============

    event KeepaliveRegistered(
        bytes32 indexed keepaliveId, address indexed owner, bytes32 indexed jnsNode, uint256 agentId
    );
    event KeepaliveUpdated(bytes32 indexed keepaliveId);
    event ResourceAdded(bytes32 indexed keepaliveId, ResourceType resourceType, string identifier);
    event ResourceRemoved(bytes32 indexed keepaliveId, uint256 index);
    event HealthChecked(
        bytes32 indexed keepaliveId, HealthStatus status, uint256 balance, uint8 healthyResources, uint8 totalResources
    );
    event AutoFunded(bytes32 indexed keepaliveId, uint256 amount, address vault);
    event StatusChanged(bytes32 indexed keepaliveId, HealthStatus oldStatus, HealthStatus newStatus);
    event ExecutorAuthorized(address indexed executor, bool authorized);

    // ============ Errors ============

    error KeepaliveNotFound(bytes32 keepaliveId);
    error KeepaliveAlreadyExists(bytes32 keepaliveId);
    error NotKeepaliveOwner(bytes32 keepaliveId, address caller);
    error NotAuthorizedExecutor(address caller);
    error InvalidResource();
    error ResourceNotFound(uint256 index);
    error AutoFundFailed(bytes32 keepaliveId, string reason);

    // ============ Modifiers ============

    modifier keepaliveExists(bytes32 keepaliveId) {
        if (keepalives[keepaliveId].createdAt == 0) {
            revert KeepaliveNotFound(keepaliveId);
        }
        _;
    }

    modifier onlyKeepaliveOwner(bytes32 keepaliveId) {
        if (keepalives[keepaliveId].owner != msg.sender) {
            revert NotKeepaliveOwner(keepaliveId, msg.sender);
        }
        _;
    }

    modifier onlyExecutor() {
        if (requireExecutorAuth && !authorizedExecutors[msg.sender]) {
            revert NotAuthorizedExecutor(msg.sender);
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _triggerRegistry, address _agentVault, address _jnsRegistry) Ownable(msg.sender) {
        triggerRegistry = _triggerRegistry;
        agentVault = _agentVault;
        jnsRegistry = _jnsRegistry;
    }

    // ============ Registration ============

    /**
     * @notice Register a new keepalive configuration
     * @param jnsNode JNS name node (0 if none)
     * @param agentId ERC-8004 agent ID (0 if none)
     * @param vaultAddress Address to fund from
     * @param globalMinBalance Minimum total balance required
     * @param checkInterval Seconds between health checks
     * @param autoFundAmount Amount to auto-fund when low
     * @param autoFundEnabled Enable auto-funding
     * @return keepaliveId The unique identifier
     */
    function registerKeepalive(
        bytes32 jnsNode,
        uint256 agentId,
        address vaultAddress,
        uint256 globalMinBalance,
        uint256 checkInterval,
        uint256 autoFundAmount,
        bool autoFundEnabled
    ) external whenNotPaused returns (bytes32 keepaliveId) {
        keepaliveId = keccak256(abi.encodePacked(msg.sender, jnsNode, agentId, block.timestamp));

        if (keepalives[keepaliveId].createdAt != 0) {
            revert KeepaliveAlreadyExists(keepaliveId);
        }

        KeepaliveConfig storage config = keepalives[keepaliveId];
        config.keepaliveId = keepaliveId;
        config.owner = msg.sender;
        config.jnsNode = jnsNode;
        config.agentId = agentId;
        config.vaultAddress = vaultAddress;
        config.globalMinBalance = globalMinBalance;
        config.checkInterval = checkInterval > 0 ? checkInterval : 3600;
        config.autoFundAmount = autoFundAmount;
        config.autoFundEnabled = autoFundEnabled;
        config.active = true;
        config.createdAt = block.timestamp;
        config.lastStatus = HealthStatus.UNKNOWN;

        ownerKeepalives[msg.sender].push(keepaliveId);
        allKeepaliveIds.push(keepaliveId);

        if (jnsNode != bytes32(0)) {
            jnsToKeepalive[jnsNode] = keepaliveId;
        }
        if (agentId > 0) {
            agentToKeepalive[agentId] = keepaliveId;
        }

        emit KeepaliveRegistered(keepaliveId, msg.sender, jnsNode, agentId);
    }

    /**
     * @notice Add a resource to monitor
     */
    function addResource(
        bytes32 keepaliveId,
        ResourceType resourceType,
        string calldata identifier,
        string calldata healthEndpoint,
        uint256 minBalance,
        bool required
    ) external keepaliveExists(keepaliveId) onlyKeepaliveOwner(keepaliveId) {
        if (bytes(identifier).length == 0) {
            revert InvalidResource();
        }

        keepaliveResources[keepaliveId].push(
            Resource({
                resourceType: resourceType,
                identifier: identifier,
                healthEndpoint: healthEndpoint,
                minBalance: minBalance,
                required: required
            })
        );

        emit ResourceAdded(keepaliveId, resourceType, identifier);
    }

    /**
     * @notice Remove a resource
     */
    function removeResource(bytes32 keepaliveId, uint256 index)
        external
        keepaliveExists(keepaliveId)
        onlyKeepaliveOwner(keepaliveId)
    {
        Resource[] storage resources = keepaliveResources[keepaliveId];
        if (index >= resources.length) {
            revert ResourceNotFound(index);
        }

        resources[index] = resources[resources.length - 1];
        resources.pop();

        emit ResourceRemoved(keepaliveId, index);
    }

    /**
     * @notice Add a dependency
     */
    function addDependency(bytes32 keepaliveId, bytes32 dependencyId)
        external
        keepaliveExists(keepaliveId)
        keepaliveExists(dependencyId)
        onlyKeepaliveOwner(keepaliveId)
    {
        keepaliveDependencies[keepaliveId].push(dependencyId);
    }

    // ============ Health Checking ============

    /**
     * @notice Record a health check result (called by executors)
     * @dev Off-chain executors perform the actual health checks and report results
     */
    function recordHealthCheck(
        bytes32 keepaliveId,
        HealthStatus status,
        uint256 balance,
        uint8 healthyResources,
        uint8 totalResources,
        string[] calldata failedResources
    ) external onlyExecutor keepaliveExists(keepaliveId) nonReentrant {
        KeepaliveConfig storage config = keepalives[keepaliveId];
        HealthStatus oldStatus = config.lastStatus;

        lastHealthCheck[keepaliveId] = HealthCheckResult({
            keepaliveId: keepaliveId,
            status: status,
            timestamp: block.timestamp,
            balance: balance,
            healthyResources: healthyResources,
            totalResources: totalResources,
            failedResources: failedResources
        });

        config.lastCheckAt = block.timestamp;
        config.lastStatus = status;

        emit HealthChecked(keepaliveId, status, balance, healthyResources, totalResources);

        if (oldStatus != status) {
            emit StatusChanged(keepaliveId, oldStatus, status);
        }

        // Auto-fund if enabled and unfunded
        if (status == HealthStatus.UNFUNDED && config.autoFundEnabled && config.autoFundAmount > 0) {
            _tryAutoFund(keepaliveId);
        }
    }

    /**
     * @notice Check if a keepalive is funded
     */
    function isFunded(bytes32 keepaliveId) external view returns (bool) {
        KeepaliveConfig storage config = keepalives[keepaliveId];
        if (config.createdAt == 0) return false;
        return config.lastStatus != HealthStatus.UNFUNDED;
    }

    /**
     * @notice Get full status for a keepalive
     */
    function getStatus(bytes32 keepaliveId)
        external
        view
        returns (bool funded, HealthStatus status, uint256 lastCheck, uint256 balance)
    {
        KeepaliveConfig storage config = keepalives[keepaliveId];
        HealthCheckResult storage result = lastHealthCheck[keepaliveId];

        funded = config.lastStatus != HealthStatus.UNFUNDED;
        status = config.lastStatus;
        lastCheck = config.lastCheckAt;
        balance = result.balance;
    }

    /**
     * @notice Get status by JNS node
     */
    function getStatusByJNS(bytes32 jnsNode)
        external
        view
        returns (bool exists, bool funded, HealthStatus status, bytes32 keepaliveId)
    {
        keepaliveId = jnsToKeepalive[jnsNode];
        exists = keepaliveId != bytes32(0);

        if (exists) {
            KeepaliveConfig storage config = keepalives[keepaliveId];
            funded = config.lastStatus != HealthStatus.UNFUNDED;
            status = config.lastStatus;
        }
    }

    // ============ Auto-Funding ============

    /**
     * @notice Attempt to auto-fund a keepalive from its associated AgentVault
     * @dev If the keepalive has an agentId and AgentVault is configured,
     *      calls AgentVault.spend() to transfer funds to the vault address.
     *      The KeepaliveRegistry must be an approved spender on the AgentVault.
     */
    function _tryAutoFund(bytes32 keepaliveId) internal {
        KeepaliveConfig storage config = keepalives[keepaliveId];

        if (agentVault == address(0) || config.agentId == 0) {
            emit AutoFunded(keepaliveId, 0, config.vaultAddress);
            return;
        }

        (bool success,) = agentVault.call(
            abi.encodeWithSignature(
                "spend(uint256,address,uint256,string)",
                config.agentId,
                config.vaultAddress,
                config.autoFundAmount,
                "Keepalive auto-fund"
            )
        );

        emit AutoFunded(keepaliveId, success ? config.autoFundAmount : 0, config.vaultAddress);
    }

    function manualFund(bytes32 keepaliveId) external payable keepaliveExists(keepaliveId) nonReentrant {
        KeepaliveConfig storage config = keepalives[keepaliveId];

        (bool success,) = config.vaultAddress.call{value: msg.value}("");
        if (!success) {
            revert AutoFundFailed(keepaliveId, "Transfer to vault failed");
        }

        emit AutoFunded(keepaliveId, msg.value, msg.sender);
    }

    // ============ View Functions ============

    function getResources(bytes32 keepaliveId) external view returns (Resource[] memory) {
        return keepaliveResources[keepaliveId];
    }

    function getDependencies(bytes32 keepaliveId) external view returns (bytes32[] memory) {
        return keepaliveDependencies[keepaliveId];
    }

    function getKeepalivesByOwner(address owner) external view returns (bytes32[] memory) {
        return ownerKeepalives[owner];
    }

    function getAllKeepalives() external view returns (bytes32[] memory) {
        return allKeepaliveIds;
    }

    function getKeepalivesNeedingCheck(uint256 maxResults) external view returns (bytes32[] memory) {
        bytes32[] memory result = new bytes32[](maxResults);
        uint256 count = 0;

        for (uint256 i = 0; i < allKeepaliveIds.length && count < maxResults; i++) {
            bytes32 id = allKeepaliveIds[i];
            KeepaliveConfig storage config = keepalives[id];

            bool needsCheck = config.lastCheckAt == 0 || block.timestamp >= config.lastCheckAt + config.checkInterval;
            if (config.active && needsCheck) {
                result[count++] = id;
            }
        }

        assembly {
            mstore(result, count)
        }

        return result;
    }

    // ============ Admin ============

    function setActive(bytes32 keepaliveId, bool active)
        external
        keepaliveExists(keepaliveId)
        onlyKeepaliveOwner(keepaliveId)
    {
        keepalives[keepaliveId].active = active;
        emit KeepaliveUpdated(keepaliveId);
    }

    function updateConfig(
        bytes32 keepaliveId,
        uint256 globalMinBalance,
        uint256 checkInterval,
        uint256 autoFundAmount,
        bool autoFundEnabled
    ) external keepaliveExists(keepaliveId) onlyKeepaliveOwner(keepaliveId) {
        KeepaliveConfig storage config = keepalives[keepaliveId];
        config.globalMinBalance = globalMinBalance;
        config.checkInterval = checkInterval;
        config.autoFundAmount = autoFundAmount;
        config.autoFundEnabled = autoFundEnabled;
        emit KeepaliveUpdated(keepaliveId);
    }

    function setExecutorAuthorized(address executor, bool authorized) external onlyOwner {
        authorizedExecutors[executor] = authorized;
        emit ExecutorAuthorized(executor, authorized);
    }

    function setRequireExecutorAuth(bool required) external onlyOwner {
        requireExecutorAuth = required;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
