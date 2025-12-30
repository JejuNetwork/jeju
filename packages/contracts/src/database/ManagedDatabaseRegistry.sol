// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ManagedDatabaseRegistry
 * @notice On-chain registry for managed database instances (SQLit + PostgreSQL)
 * @dev Supports multiple database engines with unified provisioning, billing, and management
 *
 * Database Engines:
 * - SQLit: Distributed SQLit with edge replication
 * - PostgreSQL: Managed PostgreSQL with read replicas
 * - (Future: MySQL, Redis, etc.)
 *
 * Features:
 * - Automated provisioning and teardown
 * - Connection pooling configuration
 * - Automatic backups with configurable retention
 * - Read replicas for PostgreSQL
 * - Point-in-time recovery
 * - Encryption at rest and in transit
 * - Usage-based billing
 */
contract ManagedDatabaseRegistry is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Types
    // =========================================================================

    enum DatabaseEngine {
        SQLIT,
        POSTGRESQL,
        MYSQL,
        REDIS,
        MONGODB
    }

    enum DatabaseStatus {
        PENDING,
        PROVISIONING,
        RUNNING,
        SCALING,
        BACKING_UP,
        RESTORING,
        MAINTENANCE,
        STOPPED,
        FAILED,
        TERMINATED
    }

    enum BackupStatus {
        PENDING,
        IN_PROGRESS,
        COMPLETED,
        FAILED,
        EXPIRED
    }

    enum ReplicaRole {
        PRIMARY,
        READ_REPLICA,
        STANDBY
    }

    struct DatabaseInstance {
        bytes32 instanceId;
        address owner;
        DatabaseEngine engine;
        string name;
        DatabaseStatus status;
        // Configuration
        DatabaseConfig config;
        // Networking
        string connectionString; // Encrypted connection details
        bytes32 connectionSecretHash; // Hash of connection credentials
        // Timestamps
        uint256 createdAt;
        uint256 updatedAt;
        uint256 lastBackupAt;
        // Billing
        bytes32 planId;
        uint256 totalPaidWei;
        uint256 currentPeriodStart;
        address paymentToken;
        // Metadata
        uint256 agentId; // ERC-8004 agent ID (optional)
        bytes32 region;
    }

    struct DatabaseConfig {
        // Compute
        uint8 vcpus;
        uint32 memoryMb;
        uint64 storageMb;
        // PostgreSQL specific
        uint8 readReplicas;
        uint16 maxConnections;
        uint16 connectionPoolSize;
        // Backup
        uint8 backupRetentionDays;
        bool pointInTimeRecovery;
        // Security
        bool encryptionAtRest;
        bool encryptionInTransit;
        bool publicAccess;
        // SQLit specific
        uint8 replicationFactor;
        uint8 consistencyMode; // 0 = strong, 1 = eventual
    }

    struct DatabasePlan {
        bytes32 planId;
        string name;
        DatabaseEngine engine;
        uint256 pricePerMonthWei;
        DatabaseConfig limits;
        bool active;
    }

    struct Backup {
        bytes32 backupId;
        bytes32 instanceId;
        BackupStatus status;
        uint256 createdAt;
        uint256 completedAt;
        uint256 sizeBytes;
        string storageCid; // IPFS/Arweave CID
        bytes32 checksumHash;
        uint256 expiresAt;
        bool isAutomatic;
    }

    struct Replica {
        bytes32 replicaId;
        bytes32 instanceId;
        ReplicaRole role;
        string endpoint;
        bytes32 region;
        uint256 lagMs;
        uint256 createdAt;
        bool healthy;
    }

    struct ProviderNode {
        address operator;
        bytes32 nodeId;
        DatabaseEngine[] supportedEngines;
        bytes32[] regions;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 instancesHosted;
        bool active;
        bytes32 attestationHash;
    }

    struct UsageMetrics {
        uint64 queriesExecuted;
        uint64 rowsRead;
        uint64 rowsWritten;
        uint64 storageBytesUsed;
        uint64 connectionCount;
        uint64 cpuSecondsUsed;
        uint256 lastUpdatedAt;
    }

    // =========================================================================
    // State
    // =========================================================================

    // Instance storage
    mapping(bytes32 => DatabaseInstance) public instances;
    mapping(address => bytes32[]) public ownerInstances;
    bytes32[] public allInstanceIds;

    // Plans
    mapping(bytes32 => DatabasePlan) public plans;
    bytes32[] public planIds;

    // Backups
    mapping(bytes32 => Backup) public backups;
    mapping(bytes32 => bytes32[]) public instanceBackups;

    // Replicas
    mapping(bytes32 => Replica) public replicas;
    mapping(bytes32 => bytes32[]) public instanceReplicas;

    // Provider nodes
    mapping(address => ProviderNode) public providers;
    mapping(bytes32 => address) public instanceProvider;
    address[] public providerList;

    // Usage tracking
    mapping(bytes32 => UsageMetrics) public usage;

    // Configuration
    uint256 public minProviderStake = 1 ether;
    uint256 public backupFeePerGb = 0.001 ether;
    address public treasury;
    IERC20 public paymentToken;

    // =========================================================================
    // Events
    // =========================================================================

    event DatabaseCreated(
        bytes32 indexed instanceId,
        address indexed owner,
        DatabaseEngine engine,
        string name,
        bytes32 planId
    );
    event DatabaseStatusChanged(bytes32 indexed instanceId, DatabaseStatus oldStatus, DatabaseStatus newStatus);
    event DatabaseConfigUpdated(bytes32 indexed instanceId);
    event DatabaseDeleted(bytes32 indexed instanceId, address indexed owner);

    event BackupCreated(bytes32 indexed backupId, bytes32 indexed instanceId, bool isAutomatic);
    event BackupCompleted(bytes32 indexed backupId, uint256 sizeBytes, string storageCid);
    event BackupRestored(bytes32 indexed instanceId, bytes32 indexed backupId);
    event BackupDeleted(bytes32 indexed backupId);

    event ReplicaCreated(bytes32 indexed replicaId, bytes32 indexed instanceId, bytes32 region);
    event ReplicaDeleted(bytes32 indexed replicaId);
    event ReplicaPromoted(bytes32 indexed replicaId, bytes32 indexed instanceId);

    event ProviderRegistered(address indexed operator, bytes32 nodeId, DatabaseEngine[] engines);
    event ProviderDeactivated(address indexed operator);
    event InstanceAssigned(bytes32 indexed instanceId, address indexed provider);

    event PaymentReceived(bytes32 indexed instanceId, address indexed payer, uint256 amount);
    event UsageReported(bytes32 indexed instanceId, uint64 queries, uint64 storageBytes);

    event PlanCreated(bytes32 indexed planId, string name, DatabaseEngine engine, uint256 pricePerMonth);
    event PlanDeactivated(bytes32 indexed planId);

    // =========================================================================
    // Errors
    // =========================================================================

    error InstanceNotFound();
    error InstanceNotRunning();
    error NotInstanceOwner();
    error PlanNotFound();
    error PlanNotActive();
    error InvalidConfig();
    error InsufficientPayment();
    error ProviderNotRegistered();
    error ProviderNotActive();
    error InsufficientStake();
    error BackupNotFound();
    error BackupNotCompleted();
    error ReplicaNotFound();
    error MaxReplicasReached();
    error EngineNotSupported();
    error TransferFailed();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _owner, address _treasury, address _paymentToken) Ownable(_owner) {
        treasury = _treasury;
        if (_paymentToken != address(0)) {
            paymentToken = IERC20(_paymentToken);
        }
        _initializeDefaultPlans();
    }

    // =========================================================================
    // Database Lifecycle
    // =========================================================================

    /**
     * @notice Create a new managed database instance
     * @param name Database name
     * @param engine Database engine type
     * @param planId Subscription plan
     * @param region Preferred region
     * @param config Custom configuration (optional, uses plan defaults if empty)
     */
    function createDatabase(
        string calldata name,
        DatabaseEngine engine,
        bytes32 planId,
        bytes32 region,
        DatabaseConfig calldata config
    ) external payable nonReentrant whenNotPaused returns (bytes32 instanceId) {
        DatabasePlan storage plan = plans[planId];
        if (plan.pricePerMonthWei == 0) revert PlanNotFound();
        if (!plan.active) revert PlanNotActive();
        if (plan.engine != engine) revert EngineNotSupported();

        // Validate payment
        if (msg.value < plan.pricePerMonthWei) revert InsufficientPayment();

        instanceId = keccak256(abi.encodePacked(msg.sender, name, engine, block.timestamp, block.number));

        // Merge config with plan limits
        DatabaseConfig memory finalConfig = _mergeConfig(config, plan.limits);

        instances[instanceId] = DatabaseInstance({
            instanceId: instanceId,
            owner: msg.sender,
            engine: engine,
            name: name,
            status: DatabaseStatus.PENDING,
            config: finalConfig,
            connectionString: "",
            connectionSecretHash: bytes32(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            lastBackupAt: 0,
            planId: planId,
            totalPaidWei: msg.value,
            currentPeriodStart: block.timestamp,
            paymentToken: address(0),
            agentId: 0,
            region: region
        });

        ownerInstances[msg.sender].push(instanceId);
        allInstanceIds.push(instanceId);

        // Send payment to treasury
        if (msg.value > 0) {
            (bool sent,) = treasury.call{value: msg.value}("");
            if (!sent) revert TransferFailed();
        }

        emit DatabaseCreated(instanceId, msg.sender, engine, name, planId);
        emit PaymentReceived(instanceId, msg.sender, msg.value);

        // Trigger async provisioning (off-chain nodes will pick this up)
        _updateStatus(instanceId, DatabaseStatus.PROVISIONING);

        return instanceId;
    }

    /**
     * @notice Create database with ERC-20 token payment
     */
    function createDatabaseWithToken(
        string calldata name,
        DatabaseEngine engine,
        bytes32 planId,
        bytes32 region,
        DatabaseConfig calldata config,
        uint256 tokenAmount
    ) external nonReentrant whenNotPaused returns (bytes32 instanceId) {
        if (address(paymentToken) == address(0)) revert InsufficientPayment();

        DatabasePlan storage plan = plans[planId];
        if (plan.pricePerMonthWei == 0) revert PlanNotFound();
        if (!plan.active) revert PlanNotActive();
        if (plan.engine != engine) revert EngineNotSupported();

        // For token payments, use 1:1 ratio with wei price (adjust in production)
        if (tokenAmount < plan.pricePerMonthWei) revert InsufficientPayment();

        instanceId = keccak256(abi.encodePacked(msg.sender, name, engine, block.timestamp, block.number));

        DatabaseConfig memory finalConfig = _mergeConfig(config, plan.limits);

        instances[instanceId] = DatabaseInstance({
            instanceId: instanceId,
            owner: msg.sender,
            engine: engine,
            name: name,
            status: DatabaseStatus.PENDING,
            config: finalConfig,
            connectionString: "",
            connectionSecretHash: bytes32(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            lastBackupAt: 0,
            planId: planId,
            totalPaidWei: tokenAmount,
            currentPeriodStart: block.timestamp,
            paymentToken: address(paymentToken),
            agentId: 0,
            region: region
        });

        ownerInstances[msg.sender].push(instanceId);
        allInstanceIds.push(instanceId);

        // Transfer tokens
        paymentToken.safeTransferFrom(msg.sender, treasury, tokenAmount);

        emit DatabaseCreated(instanceId, msg.sender, engine, name, planId);
        emit PaymentReceived(instanceId, msg.sender, tokenAmount);

        _updateStatus(instanceId, DatabaseStatus.PROVISIONING);

        return instanceId;
    }

    /**
     * @notice Update database configuration (scaling)
     */
    function updateDatabaseConfig(bytes32 instanceId, DatabaseConfig calldata newConfig)
        external
        nonReentrant
        whenNotPaused
    {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();
        if (instance.status != DatabaseStatus.RUNNING) revert InstanceNotRunning();

        DatabasePlan storage plan = plans[instance.planId];
        DatabaseConfig memory finalConfig = _mergeConfig(newConfig, plan.limits);

        instance.config = finalConfig;
        instance.updatedAt = block.timestamp;

        _updateStatus(instanceId, DatabaseStatus.SCALING);

        emit DatabaseConfigUpdated(instanceId);
    }

    /**
     * @notice Stop a database instance
     */
    function stopDatabase(bytes32 instanceId) external nonReentrant {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();

        _updateStatus(instanceId, DatabaseStatus.STOPPED);
    }

    /**
     * @notice Start a stopped database
     */
    function startDatabase(bytes32 instanceId) external nonReentrant whenNotPaused {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();
        if (instance.status != DatabaseStatus.STOPPED) revert InstanceNotRunning();

        _updateStatus(instanceId, DatabaseStatus.PROVISIONING);
    }

    /**
     * @notice Permanently delete a database instance
     */
    function deleteDatabase(bytes32 instanceId) external nonReentrant {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();

        _updateStatus(instanceId, DatabaseStatus.TERMINATED);

        emit DatabaseDeleted(instanceId, msg.sender);
    }

    // =========================================================================
    // Backups
    // =========================================================================

    /**
     * @notice Create a manual backup
     */
    function createBackup(bytes32 instanceId) external payable nonReentrant returns (bytes32 backupId) {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();
        if (instance.status != DatabaseStatus.RUNNING) revert InstanceNotRunning();

        backupId = keccak256(abi.encodePacked(instanceId, block.timestamp, block.number));

        uint256 retentionDays = instance.config.backupRetentionDays > 0 ? instance.config.backupRetentionDays : 30;

        backups[backupId] = Backup({
            backupId: backupId,
            instanceId: instanceId,
            status: BackupStatus.PENDING,
            createdAt: block.timestamp,
            completedAt: 0,
            sizeBytes: 0,
            storageCid: "",
            checksumHash: bytes32(0),
            expiresAt: block.timestamp + (retentionDays * 1 days),
            isAutomatic: false
        });

        instanceBackups[instanceId].push(backupId);

        _updateStatus(instanceId, DatabaseStatus.BACKING_UP);

        emit BackupCreated(backupId, instanceId, false);

        return backupId;
    }

    /**
     * @notice Complete a backup (called by provider node)
     */
    function completeBackup(bytes32 backupId, uint256 sizeBytes, string calldata storageCid, bytes32 checksumHash)
        external
    {
        Backup storage backup = backups[backupId];
        if (backup.createdAt == 0) revert BackupNotFound();

        address provider = instanceProvider[backup.instanceId];
        if (msg.sender != provider && msg.sender != owner()) revert ProviderNotRegistered();

        backup.status = BackupStatus.COMPLETED;
        backup.completedAt = block.timestamp;
        backup.sizeBytes = sizeBytes;
        backup.storageCid = storageCid;
        backup.checksumHash = checksumHash;

        instances[backup.instanceId].lastBackupAt = block.timestamp;
        _updateStatus(backup.instanceId, DatabaseStatus.RUNNING);

        emit BackupCompleted(backupId, sizeBytes, storageCid);
    }

    /**
     * @notice Restore from a backup
     */
    function restoreFromBackup(bytes32 instanceId, bytes32 backupId) external nonReentrant {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();

        Backup storage backup = backups[backupId];
        if (backup.createdAt == 0) revert BackupNotFound();
        if (backup.status != BackupStatus.COMPLETED) revert BackupNotCompleted();

        _updateStatus(instanceId, DatabaseStatus.RESTORING);

        emit BackupRestored(instanceId, backupId);
    }

    /**
     * @notice Delete a backup
     */
    function deleteBackup(bytes32 backupId) external {
        Backup storage backup = backups[backupId];
        if (backup.createdAt == 0) revert BackupNotFound();

        DatabaseInstance storage instance = instances[backup.instanceId];
        if (instance.owner != msg.sender && msg.sender != owner()) revert NotInstanceOwner();

        backup.status = BackupStatus.EXPIRED;

        emit BackupDeleted(backupId);
    }

    // =========================================================================
    // Replicas (PostgreSQL)
    // =========================================================================

    /**
     * @notice Create a read replica
     */
    function createReplica(bytes32 instanceId, bytes32 region) external payable nonReentrant returns (bytes32 replicaId) {
        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.owner != msg.sender) revert NotInstanceOwner();
        if (instance.engine != DatabaseEngine.POSTGRESQL) revert EngineNotSupported();
        if (instance.status != DatabaseStatus.RUNNING) revert InstanceNotRunning();

        bytes32[] storage existingReplicas = instanceReplicas[instanceId];
        if (existingReplicas.length >= instance.config.readReplicas) revert MaxReplicasReached();

        replicaId = keccak256(abi.encodePacked(instanceId, region, block.timestamp));

        replicas[replicaId] = Replica({
            replicaId: replicaId,
            instanceId: instanceId,
            role: ReplicaRole.READ_REPLICA,
            endpoint: "",
            region: region,
            lagMs: 0,
            createdAt: block.timestamp,
            healthy: false
        });

        existingReplicas.push(replicaId);

        emit ReplicaCreated(replicaId, instanceId, region);

        return replicaId;
    }

    /**
     * @notice Promote a replica to primary (failover)
     */
    function promoteReplica(bytes32 replicaId) external nonReentrant {
        Replica storage replica = replicas[replicaId];
        if (replica.createdAt == 0) revert ReplicaNotFound();

        DatabaseInstance storage instance = instances[replica.instanceId];
        if (instance.owner != msg.sender) revert NotInstanceOwner();

        replica.role = ReplicaRole.PRIMARY;

        emit ReplicaPromoted(replicaId, replica.instanceId);
    }

    /**
     * @notice Delete a replica
     */
    function deleteReplica(bytes32 replicaId) external nonReentrant {
        Replica storage replica = replicas[replicaId];
        if (replica.createdAt == 0) revert ReplicaNotFound();

        DatabaseInstance storage instance = instances[replica.instanceId];
        if (instance.owner != msg.sender) revert NotInstanceOwner();

        // Remove from array
        bytes32[] storage replicaList = instanceReplicas[replica.instanceId];
        for (uint256 i = 0; i < replicaList.length; i++) {
            if (replicaList[i] == replicaId) {
                replicaList[i] = replicaList[replicaList.length - 1];
                replicaList.pop();
                break;
            }
        }

        delete replicas[replicaId];

        emit ReplicaDeleted(replicaId);
    }

    // =========================================================================
    // Provider Management
    // =========================================================================

    /**
     * @notice Register as a database provider node
     */
    function registerProvider(bytes32 nodeId, DatabaseEngine[] calldata engines, bytes32[] calldata regions, bytes32 attestationHash)
        external
        payable
        nonReentrant
    {
        if (msg.value < minProviderStake) revert InsufficientStake();

        if (providers[msg.sender].registeredAt == 0) {
            providerList.push(msg.sender);
        }

        providers[msg.sender] = ProviderNode({
            operator: msg.sender,
            nodeId: nodeId,
            supportedEngines: engines,
            regions: regions,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            instancesHosted: 0,
            active: true,
            attestationHash: attestationHash
        });

        emit ProviderRegistered(msg.sender, nodeId, engines);
    }

    /**
     * @notice Claim an instance for provisioning (provider calls this)
     */
    function claimInstance(bytes32 instanceId) external {
        ProviderNode storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        DatabaseInstance storage instance = instances[instanceId];
        if (instance.createdAt == 0) revert InstanceNotFound();
        if (instance.status != DatabaseStatus.PROVISIONING) revert InstanceNotRunning();

        // Verify provider supports the engine
        bool supportsEngine = false;
        for (uint256 i = 0; i < provider.supportedEngines.length; i++) {
            if (provider.supportedEngines[i] == instance.engine) {
                supportsEngine = true;
                break;
            }
        }
        if (!supportsEngine) revert EngineNotSupported();

        instanceProvider[instanceId] = msg.sender;
        provider.instancesHosted++;

        emit InstanceAssigned(instanceId, msg.sender);
    }

    /**
     * @notice Mark instance as running (provider calls after provisioning)
     */
    function markInstanceReady(bytes32 instanceId, string calldata connectionString, bytes32 connectionSecretHash)
        external
    {
        if (instanceProvider[instanceId] != msg.sender) revert ProviderNotRegistered();

        DatabaseInstance storage instance = instances[instanceId];
        instance.connectionString = connectionString;
        instance.connectionSecretHash = connectionSecretHash;

        _updateStatus(instanceId, DatabaseStatus.RUNNING);
    }

    /**
     * @notice Report usage metrics
     */
    function reportUsage(
        bytes32 instanceId,
        uint64 queriesExecuted,
        uint64 rowsRead,
        uint64 rowsWritten,
        uint64 storageBytesUsed,
        uint64 connectionCount,
        uint64 cpuSecondsUsed
    ) external {
        if (instanceProvider[instanceId] != msg.sender && msg.sender != owner()) {
            revert ProviderNotRegistered();
        }

        usage[instanceId] = UsageMetrics({
            queriesExecuted: queriesExecuted,
            rowsRead: rowsRead,
            rowsWritten: rowsWritten,
            storageBytesUsed: storageBytesUsed,
            connectionCount: connectionCount,
            cpuSecondsUsed: cpuSecondsUsed,
            lastUpdatedAt: block.timestamp
        });

        emit UsageReported(instanceId, queriesExecuted, storageBytesUsed);
    }

    /**
     * @notice Provider heartbeat
     */
    function providerHeartbeat() external {
        ProviderNode storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        provider.lastHeartbeat = block.timestamp;
    }

    /**
     * @notice Deactivate provider
     */
    function deactivateProvider() external nonReentrant {
        ProviderNode storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.active = false;

        // Return stake
        uint256 stake = provider.stakedAmount;
        provider.stakedAmount = 0;

        if (stake > 0) {
            (bool sent,) = msg.sender.call{value: stake}("");
            if (!sent) revert TransferFailed();
        }

        emit ProviderDeactivated(msg.sender);
    }

    // =========================================================================
    // Views
    // =========================================================================

    function getInstance(bytes32 instanceId) external view returns (DatabaseInstance memory) {
        return instances[instanceId];
    }

    function getInstancesByOwner(address owner_) external view returns (bytes32[] memory) {
        return ownerInstances[owner_];
    }

    function getInstanceBackups(bytes32 instanceId) external view returns (bytes32[] memory) {
        return instanceBackups[instanceId];
    }

    function getInstanceReplicas(bytes32 instanceId) external view returns (bytes32[] memory) {
        return instanceReplicas[instanceId];
    }

    function getBackup(bytes32 backupId) external view returns (Backup memory) {
        return backups[backupId];
    }

    function getReplica(bytes32 replicaId) external view returns (Replica memory) {
        return replicas[replicaId];
    }

    function getProvider(address operator) external view returns (ProviderNode memory) {
        return providers[operator];
    }

    function getUsage(bytes32 instanceId) external view returns (UsageMetrics memory) {
        return usage[instanceId];
    }

    function getPlan(bytes32 planId) external view returns (DatabasePlan memory) {
        return plans[planId];
    }

    function getAllPlans() external view returns (DatabasePlan[] memory) {
        DatabasePlan[] memory result = new DatabasePlan[](planIds.length);
        for (uint256 i = 0; i < planIds.length; i++) {
            result[i] = plans[planIds[i]];
        }
        return result;
    }

    function getPlansByEngine(DatabaseEngine engine) external view returns (DatabasePlan[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < planIds.length; i++) {
            if (plans[planIds[i]].engine == engine && plans[planIds[i]].active) {
                count++;
            }
        }

        DatabasePlan[] memory result = new DatabasePlan[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < planIds.length; i++) {
            if (plans[planIds[i]].engine == engine && plans[planIds[i]].active) {
                result[idx++] = plans[planIds[i]];
            }
        }
        return result;
    }

    function getActiveProviders(DatabaseEngine engine) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            ProviderNode storage p = providers[providerList[i]];
            if (p.active && block.timestamp - p.lastHeartbeat < 5 minutes) {
                for (uint256 j = 0; j < p.supportedEngines.length; j++) {
                    if (p.supportedEngines[j] == engine) {
                        count++;
                        break;
                    }
                }
            }
        }

        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            ProviderNode storage p = providers[providerList[i]];
            if (p.active && block.timestamp - p.lastHeartbeat < 5 minutes) {
                for (uint256 j = 0; j < p.supportedEngines.length; j++) {
                    if (p.supportedEngines[j] == engine) {
                        result[idx++] = providerList[i];
                        break;
                    }
                }
            }
        }
        return result;
    }

    function getTotalInstances() external view returns (uint256) {
        return allInstanceIds.length;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /**
     * @notice Create a new plan
     */
    function createPlan(
        string calldata name,
        DatabaseEngine engine,
        uint256 pricePerMonthWei,
        DatabaseConfig calldata limits
    ) external onlyOwner returns (bytes32 planId) {
        planId = keccak256(abi.encodePacked(name, engine, block.timestamp));

        plans[planId] = DatabasePlan({
            planId: planId,
            name: name,
            engine: engine,
            pricePerMonthWei: pricePerMonthWei,
            limits: limits,
            active: true
        });

        planIds.push(planId);

        emit PlanCreated(planId, name, engine, pricePerMonthWei);

        return planId;
    }

    /**
     * @notice Deactivate a plan
     */
    function deactivatePlan(bytes32 planId) external onlyOwner {
        plans[planId].active = false;
        emit PlanDeactivated(planId);
    }

    function setMinProviderStake(uint256 stake) external onlyOwner {
        minProviderStake = stake;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setPaymentToken(address _token) external onlyOwner {
        paymentToken = IERC20(_token);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _updateStatus(bytes32 instanceId, DatabaseStatus newStatus) internal {
        DatabaseInstance storage instance = instances[instanceId];
        DatabaseStatus oldStatus = instance.status;
        instance.status = newStatus;
        instance.updatedAt = block.timestamp;

        emit DatabaseStatusChanged(instanceId, oldStatus, newStatus);
    }

    function _mergeConfig(DatabaseConfig calldata custom, DatabaseConfig memory limits)
        internal
        pure
        returns (DatabaseConfig memory)
    {
        return DatabaseConfig({
            vcpus: custom.vcpus > 0 && custom.vcpus <= limits.vcpus ? custom.vcpus : limits.vcpus,
            memoryMb: custom.memoryMb > 0 && custom.memoryMb <= limits.memoryMb ? custom.memoryMb : limits.memoryMb,
            storageMb: custom.storageMb > 0 && custom.storageMb <= limits.storageMb ? custom.storageMb : limits.storageMb,
            readReplicas: custom.readReplicas <= limits.readReplicas ? custom.readReplicas : limits.readReplicas,
            maxConnections: custom.maxConnections > 0 && custom.maxConnections <= limits.maxConnections
                ? custom.maxConnections
                : limits.maxConnections,
            connectionPoolSize: custom.connectionPoolSize > 0 && custom.connectionPoolSize <= limits.connectionPoolSize
                ? custom.connectionPoolSize
                : limits.connectionPoolSize,
            backupRetentionDays: custom.backupRetentionDays > 0 ? custom.backupRetentionDays : limits.backupRetentionDays,
            pointInTimeRecovery: custom.pointInTimeRecovery || limits.pointInTimeRecovery,
            encryptionAtRest: true, // Always enabled
            encryptionInTransit: true, // Always enabled
            publicAccess: custom.publicAccess,
            replicationFactor: custom.replicationFactor > 0 && custom.replicationFactor <= limits.replicationFactor
                ? custom.replicationFactor
                : limits.replicationFactor,
            consistencyMode: custom.consistencyMode
        });
    }

    function _initializeDefaultPlans() internal {
        // SQLit Plans
        _createPlan(
            "sqlit-starter",
            DatabaseEngine.SQLIT,
            0.01 ether,
            DatabaseConfig({
                vcpus: 1,
                memoryMb: 512,
                storageMb: 1024,
                readReplicas: 0,
                maxConnections: 100,
                connectionPoolSize: 20,
                backupRetentionDays: 7,
                pointInTimeRecovery: false,
                encryptionAtRest: true,
                encryptionInTransit: true,
                publicAccess: false,
                replicationFactor: 3,
                consistencyMode: 0
            })
        );

        _createPlan(
            "sqlit-pro",
            DatabaseEngine.SQLIT,
            0.05 ether,
            DatabaseConfig({
                vcpus: 2,
                memoryMb: 2048,
                storageMb: 10240,
                readReplicas: 0,
                maxConnections: 500,
                connectionPoolSize: 50,
                backupRetentionDays: 30,
                pointInTimeRecovery: true,
                encryptionAtRest: true,
                encryptionInTransit: true,
                publicAccess: true,
                replicationFactor: 5,
                consistencyMode: 0
            })
        );

        // PostgreSQL Plans
        _createPlan(
            "postgres-starter",
            DatabaseEngine.POSTGRESQL,
            0.05 ether,
            DatabaseConfig({
                vcpus: 1,
                memoryMb: 1024,
                storageMb: 10240,
                readReplicas: 0,
                maxConnections: 100,
                connectionPoolSize: 25,
                backupRetentionDays: 7,
                pointInTimeRecovery: false,
                encryptionAtRest: true,
                encryptionInTransit: true,
                publicAccess: false,
                replicationFactor: 1,
                consistencyMode: 0
            })
        );

        _createPlan(
            "postgres-pro",
            DatabaseEngine.POSTGRESQL,
            0.2 ether,
            DatabaseConfig({
                vcpus: 4,
                memoryMb: 8192,
                storageMb: 102400,
                readReplicas: 2,
                maxConnections: 500,
                connectionPoolSize: 100,
                backupRetentionDays: 30,
                pointInTimeRecovery: true,
                encryptionAtRest: true,
                encryptionInTransit: true,
                publicAccess: true,
                replicationFactor: 1,
                consistencyMode: 0
            })
        );

        _createPlan(
            "postgres-enterprise",
            DatabaseEngine.POSTGRESQL,
            1 ether,
            DatabaseConfig({
                vcpus: 16,
                memoryMb: 65536,
                storageMb: 1024000,
                readReplicas: 5,
                maxConnections: 2000,
                connectionPoolSize: 500,
                backupRetentionDays: 90,
                pointInTimeRecovery: true,
                encryptionAtRest: true,
                encryptionInTransit: true,
                publicAccess: true,
                replicationFactor: 1,
                consistencyMode: 0
            })
        );
    }

    function _createPlan(string memory name, DatabaseEngine engine, uint256 price, DatabaseConfig memory limits)
        internal
        returns (bytes32)
    {
        bytes32 planId = keccak256(abi.encodePacked(name, engine, block.timestamp));

        plans[planId] = DatabasePlan({planId: planId, name: name, engine: engine, pricePerMonthWei: price, limits: limits, active: true});

        planIds.push(planId);
        return planId;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

