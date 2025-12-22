// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WorkerRegistry
 * @notice On-chain registry for serverless worker deployments
 * @dev Permissionless worker registration similar to Cloudflare Workers
 *
 * Features:
 * - Deploy workers with code hash verification
 * - Route workers by path pattern
 * - TEE provider attestation for secure execution
 * - Per-invocation billing with x402 or prepaid
 * - Worker versioning and rollback
 */
contract WorkerRegistry is Ownable, ReentrancyGuard {
    // =========================================================================
    // Types
    // =========================================================================

    enum WorkerStatus {
        ACTIVE,
        PAUSED,
        TERMINATED
    }

    enum PaymentMode {
        FREE,
        X402,
        PREPAID
    }

    struct Worker {
        bytes32 workerId;
        address owner;
        string name;
        bytes32 codeHash;
        string[] routes;
        string cronSchedule;
        WorkerStatus status;
        PaymentMode paymentMode;
        uint256 pricePerInvocation;
        uint256 createdAt;
        uint256 updatedAt;
        uint32 currentVersion;
        uint64 totalInvocations;
        uint64 totalErrors;
    }

    struct WorkerVersion {
        uint32 version;
        bytes32 codeHash;
        uint256 deployedAt;
        address deployedBy;
        bool active;
    }

    struct WorkerEndpoint {
        bytes32 workerId;
        address providerAddress;
        string endpoint;
        bytes32 attestationHash;
        uint8 teeType;
        bool active;
        uint64 invocations;
        uint64 errors;
        uint256 avgLatencyMs;
    }

    // =========================================================================
    // State
    // =========================================================================

    mapping(bytes32 => Worker) public workers;
    mapping(bytes32 => WorkerVersion[]) public workerVersions;
    mapping(bytes32 => WorkerEndpoint[]) public workerEndpoints;
    mapping(address => bytes32[]) public ownerWorkers;
    mapping(string => bytes32) public routeToWorker;
    bytes32[] public allWorkerIds;
    mapping(address => uint256) public prepaidBalances;
    uint256 public minPricePerInvocation = 0;
    uint256 public platformFeePercent = 5;

    // =========================================================================
    // Events
    // =========================================================================

    event WorkerDeployed(bytes32 indexed workerId, address indexed owner, string name, bytes32 codeHash);
    event WorkerUpdated(bytes32 indexed workerId, uint32 version, bytes32 codeHash);
    event WorkerStatusChanged(bytes32 indexed workerId, WorkerStatus status);
    event EndpointAdded(bytes32 indexed workerId, address indexed provider, string endpoint, bytes32 attestation);
    event EndpointRemoved(bytes32 indexed workerId, address indexed provider);
    event WorkerInvoked(bytes32 indexed workerId, address indexed provider, address indexed caller, bool success);
    event RouteRegistered(bytes32 indexed workerId, string route);
    event PrepaidDeposit(address indexed account, uint256 amount);
    event PrepaidWithdraw(address indexed account, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error WorkerNotFound();
    error WorkerNotActive();
    error NotWorkerOwner();
    error InvalidCodeHash();
    error InvalidName();
    error RouteAlreadyRegistered();
    error EndpointNotFound();
    error InsufficientPrepaid();
    error TransferFailed();
    error InvalidVersion();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor() Ownable(msg.sender) {}

    // =========================================================================
    // Worker Deployment
    // =========================================================================

    /**
     * @notice Deploy a new worker
     * @param name Worker display name
     * @param codeHash Hash of the worker code
     * @param routes URL patterns this worker handles
     * @param cronSchedule Cron expression for scheduled execution (empty if none)
     * @param paymentMode Payment method
     * @param pricePerInvocation Price per invocation in wei
     */
    function deployWorker(
        string calldata name,
        bytes32 codeHash,
        string[] calldata routes,
        string calldata cronSchedule,
        PaymentMode paymentMode,
        uint256 pricePerInvocation
    ) external returns (bytes32) {
        if (bytes(name).length == 0) revert InvalidName();
        if (codeHash == bytes32(0)) revert InvalidCodeHash();

        bytes32 workerId = keccak256(abi.encodePacked(msg.sender, name, codeHash, block.timestamp));

        Worker storage worker = workers[workerId];
        worker.workerId = workerId;
        worker.owner = msg.sender;
        worker.name = name;
        worker.codeHash = codeHash;
        worker.routes = routes;
        worker.cronSchedule = cronSchedule;
        worker.status = WorkerStatus.ACTIVE;
        worker.paymentMode = paymentMode;
        worker.pricePerInvocation = pricePerInvocation;
        worker.createdAt = block.timestamp;
        worker.updatedAt = block.timestamp;
        worker.currentVersion = 1;

        workerVersions[workerId].push(
            WorkerVersion({version: 1, codeHash: codeHash, deployedAt: block.timestamp, deployedBy: msg.sender, active: true})
        );

        ownerWorkers[msg.sender].push(workerId);
        allWorkerIds.push(workerId);

        // Register routes
        for (uint256 i = 0; i < routes.length; i++) {
            if (routeToWorker[routes[i]] != bytes32(0)) revert RouteAlreadyRegistered();
            routeToWorker[routes[i]] = workerId;
            emit RouteRegistered(workerId, routes[i]);
        }

        emit WorkerDeployed(workerId, msg.sender, name, codeHash);

        return workerId;
    }

    /**
     * @notice Update worker code (creates new version)
     * @param workerId Worker to update
     * @param newCodeHash New code hash
     */
    function updateWorker(bytes32 workerId, bytes32 newCodeHash) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();
        if (worker.owner != msg.sender) revert NotWorkerOwner();
        if (newCodeHash == bytes32(0)) revert InvalidCodeHash();

        // Deactivate current version
        WorkerVersion[] storage versions = workerVersions[workerId];
        for (uint256 i = 0; i < versions.length; i++) {
            if (versions[i].active) {
                versions[i].active = false;
            }
        }

        // Create new version
        uint32 newVersion = worker.currentVersion + 1;
        versions.push(
            WorkerVersion({
                version: newVersion,
                codeHash: newCodeHash,
                deployedAt: block.timestamp,
                deployedBy: msg.sender,
                active: true
            })
        );

        worker.codeHash = newCodeHash;
        worker.currentVersion = newVersion;
        worker.updatedAt = block.timestamp;

        emit WorkerUpdated(workerId, newVersion, newCodeHash);
    }

    /**
     * @notice Rollback to a previous version
     * @param workerId Worker to rollback
     * @param targetVersion Version number to rollback to
     */
    function rollbackWorker(bytes32 workerId, uint32 targetVersion) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();
        if (worker.owner != msg.sender) revert NotWorkerOwner();

        WorkerVersion[] storage versions = workerVersions[workerId];
        bool found = false;
        bytes32 targetCodeHash;

        for (uint256 i = 0; i < versions.length; i++) {
            if (versions[i].version == targetVersion) {
                found = true;
                targetCodeHash = versions[i].codeHash;
                versions[i].active = true;
            } else {
                versions[i].active = false;
            }
        }

        if (!found) revert InvalidVersion();

        worker.codeHash = targetCodeHash;
        worker.currentVersion = targetVersion;
        worker.updatedAt = block.timestamp;

        emit WorkerUpdated(workerId, targetVersion, targetCodeHash);
    }

    /**
     * @notice Pause a worker
     */
    function pauseWorker(bytes32 workerId) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();
        if (worker.owner != msg.sender) revert NotWorkerOwner();

        worker.status = WorkerStatus.PAUSED;
        emit WorkerStatusChanged(workerId, WorkerStatus.PAUSED);
    }

    /**
     * @notice Resume a paused worker
     */
    function resumeWorker(bytes32 workerId) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();
        if (worker.owner != msg.sender) revert NotWorkerOwner();

        worker.status = WorkerStatus.ACTIVE;
        emit WorkerStatusChanged(workerId, WorkerStatus.ACTIVE);
    }

    /**
     * @notice Terminate a worker (permanent)
     */
    function terminateWorker(bytes32 workerId) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();
        if (worker.owner != msg.sender) revert NotWorkerOwner();

        worker.status = WorkerStatus.TERMINATED;

        // Clear routes
        for (uint256 i = 0; i < worker.routes.length; i++) {
            delete routeToWorker[worker.routes[i]];
        }

        emit WorkerStatusChanged(workerId, WorkerStatus.TERMINATED);
    }

    // =========================================================================
    // Endpoint Management
    // =========================================================================

    /**
     * @notice Add an execution endpoint for a worker (providers call this)
     * @param workerId Worker to serve
     * @param endpoint API endpoint URL
     * @param attestationHash TEE attestation proving code integrity
     * @param teeType TEE type (0=none, 1=sgx, 2=tdx, 3=sev, 4=nitro)
     */
    function addEndpoint(bytes32 workerId, string calldata endpoint, bytes32 attestationHash, uint8 teeType) external {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();

        WorkerEndpoint[] storage endpoints = workerEndpoints[workerId];
        endpoints.push(
            WorkerEndpoint({
                workerId: workerId,
                providerAddress: msg.sender,
                endpoint: endpoint,
                attestationHash: attestationHash,
                teeType: teeType,
                active: true,
                invocations: 0,
                errors: 0,
                avgLatencyMs: 0
            })
        );

        emit EndpointAdded(workerId, msg.sender, endpoint, attestationHash);
    }

    /**
     * @notice Remove an endpoint
     */
    function removeEndpoint(bytes32 workerId) external {
        WorkerEndpoint[] storage endpoints = workerEndpoints[workerId];
        for (uint256 i = 0; i < endpoints.length; i++) {
            if (endpoints[i].providerAddress == msg.sender) {
                endpoints[i].active = false;
                emit EndpointRemoved(workerId, msg.sender);
                return;
            }
        }
        revert EndpointNotFound();
    }

    // =========================================================================
    // Invocation Tracking
    // =========================================================================

    /**
     * @notice Record a worker invocation (called by providers)
     * @param workerId Worker that was invoked
     * @param success Whether invocation succeeded
     * @param latencyMs Execution latency
     */
    function recordInvocation(bytes32 workerId, bool success, uint256 latencyMs) external nonReentrant {
        Worker storage worker = workers[workerId];
        if (worker.createdAt == 0) revert WorkerNotFound();

        // Find provider's endpoint
        WorkerEndpoint[] storage endpoints = workerEndpoints[workerId];
        for (uint256 i = 0; i < endpoints.length; i++) {
            if (endpoints[i].providerAddress == msg.sender && endpoints[i].active) {
                endpoints[i].invocations++;
                if (!success) endpoints[i].errors++;

                // Update rolling average latency
                uint256 oldAvg = endpoints[i].avgLatencyMs;
                uint256 n = endpoints[i].invocations;
                endpoints[i].avgLatencyMs = ((oldAvg * (n - 1)) + latencyMs) / n;
                break;
            }
        }

        worker.totalInvocations++;
        if (!success) worker.totalErrors++;

        // Handle prepaid payment - deduct from caller's prepaid balance
        if (worker.paymentMode == PaymentMode.PREPAID && worker.pricePerInvocation > 0) {
            uint256 price = worker.pricePerInvocation;
            if (prepaidBalances[msg.sender] < price) revert InsufficientPrepaid();
            
            // Deduct from caller and credit to worker owner
            prepaidBalances[msg.sender] -= price;
            prepaidBalances[worker.owner] += price;
        }

        emit WorkerInvoked(workerId, msg.sender, msg.sender, success);
    }

    // =========================================================================
    // Prepaid Balance
    // =========================================================================

    function depositPrepaid() external payable {
        prepaidBalances[msg.sender] += msg.value;
        emit PrepaidDeposit(msg.sender, msg.value);
    }

    function withdrawPrepaid(uint256 amount) external nonReentrant {
        if (prepaidBalances[msg.sender] < amount) revert InsufficientPrepaid();
        prepaidBalances[msg.sender] -= amount;

        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit PrepaidWithdraw(msg.sender, amount);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getWorker(bytes32 workerId)
        external
        view
        returns (
            address owner,
            string memory name,
            bytes32 codeHash,
            WorkerStatus status,
            uint32 currentVersion,
            uint64 totalInvocations,
            uint256 pricePerInvocation
        )
    {
        Worker storage w = workers[workerId];
        return (w.owner, w.name, w.codeHash, w.status, w.currentVersion, w.totalInvocations, w.pricePerInvocation);
    }

    function getWorkerRoutes(bytes32 workerId) external view returns (string[] memory) {
        return workers[workerId].routes;
    }

    function getWorkerVersions(bytes32 workerId) external view returns (WorkerVersion[] memory) {
        return workerVersions[workerId];
    }

    function getWorkerEndpoints(bytes32 workerId) external view returns (WorkerEndpoint[] memory) {
        return workerEndpoints[workerId];
    }

    function getActiveEndpoints(bytes32 workerId) external view returns (WorkerEndpoint[] memory) {
        WorkerEndpoint[] storage all = workerEndpoints[workerId];
        uint256 count = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) count++;
        }

        WorkerEndpoint[] memory active = new WorkerEndpoint[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) active[j++] = all[i];
        }
        return active;
    }

    function getWorkerByRoute(string calldata route) external view returns (bytes32) {
        return routeToWorker[route];
    }

    function getOwnerWorkers(address owner) external view returns (bytes32[] memory) {
        return ownerWorkers[owner];
    }

    function getActiveWorkers() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allWorkerIds.length; i++) {
            if (workers[allWorkerIds[i]].status == WorkerStatus.ACTIVE) count++;
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allWorkerIds.length; i++) {
            if (workers[allWorkerIds[i]].status == WorkerStatus.ACTIVE) active[j++] = allWorkerIds[i];
        }
        return active;
    }

    function getWorkerCount() external view returns (uint256) {
        return allWorkerIds.length;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setMinPricePerInvocation(uint256 price) external onlyOwner {
        minPricePerInvocation = price;
    }

    function setPlatformFeePercent(uint256 percent) external onlyOwner {
        require(percent <= 20, "Fee too high");
        platformFeePercent = percent;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
