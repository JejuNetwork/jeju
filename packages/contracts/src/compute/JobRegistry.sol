// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title JobRegistry
 * @notice On-chain registry for training jobs
 * @dev Manages permissionless training job queue with TEE worker assignment
 *
 * Features:
 * - Submit training jobs with data hashes
 * - TEE workers claim and execute jobs
 * - Verifiable completion with attestation
 * - Job timeout and retry mechanism
 * - Payment handling for compute
 */
contract JobRegistry is Ownable, ReentrancyGuard {
    // =========================================================================
    // Types
    // =========================================================================

    enum JobStatus {
        PENDING, // Waiting for worker
        CLAIMED, // Worker assigned
        RUNNING, // Training in progress
        COMPLETED, // Successfully finished
        FAILED, // Worker reported failure
        TIMEOUT, // Exceeded time limit
        CANCELLED // Cancelled by submitter

    }

    struct Job {
        bytes32 jobId;
        address submitter;
        string archetype; // Model archetype to train
        bytes32 dataHash; // IPFS hash of training data
        uint256 submittedAt;
        uint256 claimedAt;
        uint256 completedAt;
        address worker; // TEE worker address
        bytes32 workerAttestation; // Worker's TEE attestation
        JobStatus status;
        uint256 reward; // Payment for completion
        uint256 timeout; // Max execution time (seconds)
        bytes32 resultModelId; // ModelRegistry ID on completion
        string failureReason;
        uint256 retryCount;
    }

    struct WorkerInfo {
        address workerAddress;
        bytes32 attestationHash;
        uint256 registeredAt;
        uint256 completedJobs;
        uint256 failedJobs;
        bool active;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice All jobs by ID
    mapping(bytes32 => Job) public jobs;

    /// @notice Jobs by submitter
    mapping(address => bytes32[]) public submitterJobs;

    /// @notice Jobs by worker
    mapping(address => bytes32[]) public workerJobs;

    /// @notice Pending job queue (FIFO)
    bytes32[] public pendingJobs;

    /// @notice All job IDs
    bytes32[] public allJobIds;

    /// @notice Registered workers
    mapping(address => WorkerInfo) public workers;

    /// @notice All worker addresses
    address[] public workerList;

    /// @notice Default job timeout (4 hours)
    uint256 public defaultTimeout = 4 hours;

    /// @notice Minimum job reward
    uint256 public minJobReward = 0.01 ether;

    /// @notice Maximum retries per job
    uint256 public maxRetries = 3;

    /// @notice Model registry address for completion
    address public modelRegistry;

    // =========================================================================
    // Events
    // =========================================================================

    event JobSubmitted(
        bytes32 indexed jobId, address indexed submitter, string archetype, bytes32 dataHash, uint256 reward
    );

    event JobClaimed(bytes32 indexed jobId, address indexed worker, bytes32 attestation);

    event JobStarted(bytes32 indexed jobId, address indexed worker);

    event JobCompleted(bytes32 indexed jobId, address indexed worker, bytes32 resultModelId);

    event JobFailed(bytes32 indexed jobId, address indexed worker, string reason);

    event JobTimeout(bytes32 indexed jobId);
    event JobCancelled(bytes32 indexed jobId);
    event JobRetried(bytes32 indexed jobId, uint256 retryCount);

    event WorkerRegistered(address indexed worker, bytes32 attestation);

    event WorkerDeactivated(address indexed worker);
    event RewardWithdrawn(address indexed worker, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error JobNotFound();
    error JobNotPending();
    error JobNotClaimed();
    error JobAlreadyClaimed();
    error NotJobSubmitter();
    error NotJobWorker();
    error WorkerNotRegistered();
    error WorkerNotActive();
    error InsufficientReward();
    error InvalidDataHash();
    error InvalidArchetype();
    error MaxRetriesExceeded();
    error JobNotTimedOut();
    error TransferFailed();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor() Ownable(msg.sender) {}

    // =========================================================================
    // Job Submission
    // =========================================================================

    /**
     * @notice Submit a new training job
     * @param archetype Model archetype to train
     * @param dataHash IPFS hash of training data
     * @param timeout Custom timeout (0 for default)
     */
    function submitJob(string calldata archetype, bytes32 dataHash, uint256 timeout)
        external
        payable
        nonReentrant
        returns (bytes32)
    {
        if (bytes(archetype).length == 0) revert InvalidArchetype();
        if (dataHash == bytes32(0)) revert InvalidDataHash();
        if (msg.value < minJobReward) revert InsufficientReward();

        bytes32 jobId = keccak256(abi.encodePacked(msg.sender, archetype, dataHash, block.timestamp));

        Job storage job = jobs[jobId];
        job.jobId = jobId;
        job.submitter = msg.sender;
        job.archetype = archetype;
        job.dataHash = dataHash;
        job.submittedAt = block.timestamp;
        job.status = JobStatus.PENDING;
        job.reward = msg.value;
        job.timeout = timeout > 0 ? timeout : defaultTimeout;

        submitterJobs[msg.sender].push(jobId);
        pendingJobs.push(jobId);
        allJobIds.push(jobId);

        emit JobSubmitted(jobId, msg.sender, archetype, dataHash, msg.value);

        return jobId;
    }

    /**
     * @notice Cancel a pending job and refund reward
     * @param jobId Job to cancel
     */
    function cancelJob(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.submitter != msg.sender) revert NotJobSubmitter();
        if (job.status != JobStatus.PENDING) revert JobNotPending();

        job.status = JobStatus.CANCELLED;

        // Remove from pending queue
        _removeFromPending(jobId);

        // Refund reward
        (bool sent,) = msg.sender.call{value: job.reward}("");
        if (!sent) revert TransferFailed();

        emit JobCancelled(jobId);
    }

    // =========================================================================
    // Worker Operations
    // =========================================================================

    /**
     * @notice Register as a training worker
     * @param attestationHash TEE attestation proof
     */
    function registerWorker(bytes32 attestationHash) external {
        WorkerInfo storage worker = workers[msg.sender];

        if (worker.registeredAt == 0) {
            workerList.push(msg.sender);
        }

        worker.workerAddress = msg.sender;
        worker.attestationHash = attestationHash;
        worker.registeredAt = block.timestamp;
        worker.active = true;

        emit WorkerRegistered(msg.sender, attestationHash);
    }

    /**
     * @notice Deactivate worker registration
     */
    function deactivateWorker() external {
        WorkerInfo storage worker = workers[msg.sender];
        if (worker.registeredAt == 0) revert WorkerNotRegistered();

        worker.active = false;
        emit WorkerDeactivated(msg.sender);
    }

    /**
     * @notice Claim a pending job
     * @param jobId Job to claim
     * @param attestation Current TEE attestation
     */
    function claimJob(bytes32 jobId, bytes32 attestation) external {
        WorkerInfo storage worker = workers[msg.sender];
        if (worker.registeredAt == 0) revert WorkerNotRegistered();
        if (!worker.active) revert WorkerNotActive();

        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.status != JobStatus.PENDING) revert JobNotPending();

        job.status = JobStatus.CLAIMED;
        job.claimedAt = block.timestamp;
        job.worker = msg.sender;
        job.workerAttestation = attestation;

        workerJobs[msg.sender].push(jobId);
        _removeFromPending(jobId);

        emit JobClaimed(jobId, msg.sender, attestation);
    }

    /**
     * @notice Start execution of a claimed job
     * @param jobId Job to start
     */
    function startJob(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.worker != msg.sender) revert NotJobWorker();
        if (job.status != JobStatus.CLAIMED) revert JobNotClaimed();

        job.status = JobStatus.RUNNING;

        emit JobStarted(jobId, msg.sender);
    }

    /**
     * @notice Complete a job successfully
     * @param jobId Job to complete
     * @param resultModelId Model ID registered in ModelRegistry
     */
    function completeJob(bytes32 jobId, bytes32 resultModelId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.worker != msg.sender) revert NotJobWorker();
        if (job.status != JobStatus.RUNNING && job.status != JobStatus.CLAIMED) {
            revert JobNotClaimed();
        }

        job.status = JobStatus.COMPLETED;
        job.completedAt = block.timestamp;
        job.resultModelId = resultModelId;

        // Update worker stats
        workers[msg.sender].completedJobs++;

        // Pay worker
        (bool sent,) = msg.sender.call{value: job.reward}("");
        if (!sent) revert TransferFailed();

        emit JobCompleted(jobId, msg.sender, resultModelId);
    }

    /**
     * @notice Report job failure
     * @param jobId Job that failed
     * @param reason Failure reason
     */
    function failJob(bytes32 jobId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.worker != msg.sender) revert NotJobWorker();

        job.status = JobStatus.FAILED;
        job.completedAt = block.timestamp;
        job.failureReason = reason;

        // Update worker stats
        workers[msg.sender].failedJobs++;

        emit JobFailed(jobId, msg.sender, reason);

        // Auto-retry if within limit
        if (job.retryCount < maxRetries) {
            _retryJob(jobId);
        }
    }

    /**
     * @notice Mark a job as timed out (anyone can call)
     * @param jobId Job to check
     */
    function timeoutJob(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();

        // Only claimed/running jobs can timeout
        if (job.status != JobStatus.CLAIMED && job.status != JobStatus.RUNNING) {
            revert JobNotClaimed();
        }

        // Check if actually timed out
        if (block.timestamp < job.claimedAt + job.timeout) {
            revert JobNotTimedOut();
        }

        job.status = JobStatus.TIMEOUT;
        job.completedAt = block.timestamp;

        // Update worker stats
        workers[job.worker].failedJobs++;

        emit JobTimeout(jobId);

        // Auto-retry if within limit
        if (job.retryCount < maxRetries) {
            _retryJob(jobId);
        }
    }

    /**
     * @dev Internal retry logic
     */
    function _retryJob(bytes32 jobId) internal {
        Job storage job = jobs[jobId];

        if (job.retryCount >= maxRetries) revert MaxRetriesExceeded();

        job.retryCount++;
        job.status = JobStatus.PENDING;
        job.worker = address(0);
        job.workerAttestation = bytes32(0);
        job.claimedAt = 0;

        pendingJobs.push(jobId);

        emit JobRetried(jobId, job.retryCount);
    }

    /**
     * @dev Remove job from pending queue
     */
    function _removeFromPending(bytes32 jobId) internal {
        for (uint256 i = 0; i < pendingJobs.length; i++) {
            if (pendingJobs[i] == jobId) {
                pendingJobs[i] = pendingJobs[pendingJobs.length - 1];
                pendingJobs.pop();
                break;
            }
        }
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get job details
     */
    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    /**
     * @notice Get pending job count
     */
    function getPendingJobCount() external view returns (uint256) {
        return pendingJobs.length;
    }

    /**
     * @notice Get next pending job
     */
    function getNextPendingJob() external view returns (bytes32) {
        if (pendingJobs.length == 0) return bytes32(0);
        return pendingJobs[0];
    }

    /**
     * @notice Get pending jobs for an archetype
     */
    function getPendingJobsByArchetype(string calldata archetype) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingJobs.length; i++) {
            if (keccak256(bytes(jobs[pendingJobs[i]].archetype)) == keccak256(bytes(archetype))) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < pendingJobs.length; i++) {
            if (keccak256(bytes(jobs[pendingJobs[i]].archetype)) == keccak256(bytes(archetype))) {
                result[idx++] = pendingJobs[i];
            }
        }

        return result;
    }

    /**
     * @notice Get worker info
     */
    function getWorker(address workerAddr) external view returns (WorkerInfo memory) {
        return workers[workerAddr];
    }

    /**
     * @notice Get active worker count
     */
    function getActiveWorkerCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < workerList.length; i++) {
            if (workers[workerList[i]].active) {
                count++;
            }
        }
        return count;
    }

    /**
     * @notice Get jobs by submitter
     */
    function getSubmitterJobs(address submitter) external view returns (bytes32[] memory) {
        return submitterJobs[submitter];
    }

    /**
     * @notice Get jobs by worker
     */
    function getWorkerJobs(address worker) external view returns (bytes32[] memory) {
        return workerJobs[worker];
    }

    /**
     * @notice Get total job count
     */
    function getJobCount() external view returns (uint256) {
        return allJobIds.length;
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Set model registry address
     */
    function setModelRegistry(address _modelRegistry) external onlyOwner {
        modelRegistry = _modelRegistry;
    }

    /**
     * @notice Set default timeout
     */
    function setDefaultTimeout(uint256 timeout) external onlyOwner {
        defaultTimeout = timeout;
    }

    /**
     * @notice Set minimum job reward
     */
    function setMinJobReward(uint256 reward) external onlyOwner {
        minJobReward = reward;
    }

    /**
     * @notice Set max retries
     */
    function setMaxRetries(uint256 retries) external onlyOwner {
        maxRetries = retries;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
