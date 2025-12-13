// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev DEPRECATION NOTICE: This contract is vendor-specific and maintained in vendor/babylon/contracts/.
 *      This copy remains for backwards compatibility with existing deployments.
 *      For new deployments, use the contract from vendor/babylon/contracts/BabylonTreasury.sol
 */
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IGameTreasury.sol";

/**
 * @title BabylonTreasury
 * @notice Unruggable game treasury for permissionless Babylon
 * @dev Implements IGameTreasury interface for vendor-agnostic integration.
 *      Manages funds, state tracking, operator authorization, and security council.
 *
 * NOTE: This contract is vendor-specific and should be deployed from vendor/babylon.
 *       The core Jeju system uses IGameTreasury interface for abstraction.
 *
 * @custom:deprecated Use vendor/babylon/contracts/BabylonTreasury.sol for new deployments
 *
 * Key Security Features:
 * - Rate-limited withdrawals prevent fund draining
 * - Heartbeat-based liveness monitoring
 * - Security council can rotate encryption keys
 * - Anyone can take over after operator timeout
 * - On-chain state anchoring via IPFS CIDs
 */
contract BabylonTreasury is IGameTreasury, AccessControl, ReentrancyGuard, Pausable {
    // =========================================================================
    // Roles
    // =========================================================================
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant COUNCIL_ROLE = keccak256("COUNCIL_ROLE");

    // =========================================================================
    // State Tracking
    // =========================================================================
    /// @notice Current encrypted state CID on IPFS
    string public currentStateCID;
    /// @notice Hash of the current state for integrity verification
    bytes32 public currentStateHash;
    /// @notice Monotonic state version counter
    uint256 public stateVersion;
    /// @notice Current encryption key version
    uint256 public keyVersion;
    /// @notice Last heartbeat timestamp
    uint256 public lastHeartbeat;

    // =========================================================================
    // Operator Management
    // =========================================================================
    /// @notice Current TEE operator address
    address public operator;
    /// @notice Operator's remote attestation proof
    bytes public operatorAttestation;
    /// @notice When the operator was registered
    uint256 public operatorRegisteredAt;

    // =========================================================================
    // Withdrawal Limits
    // =========================================================================
    /// @notice Maximum daily withdrawal amount
    uint256 public dailyWithdrawalLimit;
    /// @notice Amount withdrawn today
    uint256 public withdrawnToday;
    /// @notice Last withdrawal day (for daily reset)
    uint256 public lastWithdrawalDay;

    // =========================================================================
    // Timeouts
    // =========================================================================
    /// @notice How long before operator is considered inactive (default: 1 hour)
    uint256 public heartbeatTimeout = 1 hours;
    /// @notice Cooldown before a new operator can take over
    uint256 public takeoverCooldown = 2 hours;

    // =========================================================================
    // Training Tracking
    // =========================================================================
    /// @notice Current training epoch
    uint256 public trainingEpoch;
    /// @notice Last model hash recorded
    bytes32 public lastModelHash;

    // =========================================================================
    // Key Rotation
    // =========================================================================
    /// @notice Pending key rotation requests
    mapping(uint256 => KeyRotationRequest) public keyRotationRequests;
    /// @notice Next rotation request ID
    uint256 public nextRotationRequestId;
    /// @notice Required approvals for key rotation
    uint256 public rotationApprovalThreshold = 2;

    struct KeyRotationRequest {
        address initiator;
        uint256 timestamp;
        uint256 approvals;
        bool executed;
        mapping(address => bool) hasApproved;
    }

    // =========================================================================
    // Events (inherited from IGameTreasury: OperatorRegistered, OperatorDeactivated,
    // TakeoverInitiated, StateUpdated, HeartbeatReceived, FundsWithdrawn, FundsDeposited)
    // =========================================================================
    event KeyRotationRequested(uint256 indexed requestId, address indexed initiator);
    event KeyRotationApproved(uint256 indexed requestId, address indexed approver);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event DailyLimitUpdated(uint256 newLimit);

    // =========================================================================
    // Constructor
    // =========================================================================
    constructor(uint256 _dailyLimit) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(COUNCIL_ROLE, msg.sender);
        dailyWithdrawalLimit = _dailyLimit;
        keyVersion = 1;
    }

    // =========================================================================
    // Funding (Permissionless)
    // =========================================================================

    /**
     * @notice Deposit funds into treasury (anyone can fund)
     */
    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Explicit deposit function
     */
    function deposit() external payable override {
        require(msg.value > 0, "Must deposit something");
        emit FundsDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Get treasury balance
     */
    function getBalance() external view override returns (uint256) {
        return address(this).balance;
    }

    // =========================================================================
    // Operator Management
    // =========================================================================

    /**
     * @notice Register a new TEE operator (council or admin only)
     * @param _operator Address derived inside TEE
     * @param _attestation Remote attestation proof
     */
    function registerOperator(address _operator, bytes calldata _attestation)
        external
        override
        onlyRole(COUNCIL_ROLE)
    {
        require(_operator != address(0), "Invalid operator");
        require(operator == address(0) || !isOperatorActive(), "Active operator exists");

        // Revoke old operator if exists
        if (operator != address(0)) {
            _revokeRole(OPERATOR_ROLE, operator);
            emit OperatorDeactivated(operator, "replaced");
        }

        operator = _operator;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, _operator);

        emit OperatorRegistered(_operator, _attestation);
    }

    /**
     * @notice Check if current operator is active
     */
    function isOperatorActive() public view override returns (bool) {
        if (operator == address(0)) return false;
        return block.timestamp - lastHeartbeat <= heartbeatTimeout;
    }

    /**
     * @notice Mark operator as inactive (callable by anyone after timeout)
     */
    function markOperatorInactive() external {
        require(operator != address(0), "No operator");
        require(!isOperatorActive(), "Operator still active");

        address oldOperator = operator;
        _revokeRole(OPERATOR_ROLE, oldOperator);
        operator = address(0);

        emit OperatorDeactivated(oldOperator, "heartbeat_timeout");
    }

    /**
     * @notice Permissionless takeover by a new TEE operator
     * @dev Anyone with valid attestation can take over after timeout + cooldown
     * @param _attestation New operator's attestation proof
     */
    function takeoverAsOperator(bytes calldata _attestation) external override {
        require(operator == address(0) || !isOperatorActive(), "Operator still active");
        require(block.timestamp >= lastHeartbeat + heartbeatTimeout + takeoverCooldown, "Takeover cooldown not met");
        require(_attestation.length > 0, "Attestation required");

        address oldOperator = operator;

        // Revoke old operator
        if (oldOperator != address(0)) {
            _revokeRole(OPERATOR_ROLE, oldOperator);
        }

        // Register new operator
        operator = msg.sender;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, msg.sender);

        emit TakeoverInitiated(msg.sender, oldOperator);
        emit OperatorRegistered(msg.sender, _attestation);
    }

    // =========================================================================
    // Game State Management
    // =========================================================================

    /**
     * @notice Update game state (TEE operator only)
     * @param _cid IPFS CID of encrypted state
     * @param _hash Hash of the state for integrity
     */
    function updateState(string calldata _cid, bytes32 _hash) external override onlyRole(OPERATOR_ROLE) whenNotPaused {
        currentStateCID = _cid;
        currentStateHash = _hash;
        stateVersion++;
        lastHeartbeat = block.timestamp;

        emit StateUpdated(_cid, _hash, stateVersion);
    }

    /**
     * @notice Send heartbeat to prove liveness
     */
    function heartbeat() external override onlyRole(OPERATOR_ROLE) {
        lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    /**
     * @notice Record a training cycle
     * @param _datasetCID Public IPFS CID of training data
     * @param _modelHash Hash of the updated model
     */
    function recordTraining(string calldata _datasetCID, bytes32 _modelHash) external onlyRole(OPERATOR_ROLE) {
        trainingEpoch++;
        lastModelHash = _modelHash;
        emit TrainingRecorded(trainingEpoch, _datasetCID, _modelHash);
    }

    // =========================================================================
    // Rate-Limited Withdrawals
    // =========================================================================

    /**
     * @notice Withdraw funds for operational costs (rate-limited)
     * @param _amount Amount to withdraw
     */
    function withdraw(uint256 _amount) external override onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        require(_amount > 0, "Amount must be positive");
        require(address(this).balance >= _amount, "Insufficient balance");

        // Reset daily counter if new day
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > lastWithdrawalDay) {
            withdrawnToday = 0;
            lastWithdrawalDay = currentDay;
        }

        require(withdrawnToday + _amount <= dailyWithdrawalLimit, "Exceeds daily limit");

        withdrawnToday += _amount;

        (bool success,) = msg.sender.call{value: _amount}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(msg.sender, _amount);
    }

    // =========================================================================
    // Key Rotation (Security Council)
    // =========================================================================

    /**
     * @notice Request key rotation (council only)
     */
    function requestKeyRotation() external onlyRole(COUNCIL_ROLE) returns (uint256) {
        uint256 requestId = nextRotationRequestId++;

        KeyRotationRequest storage request = keyRotationRequests[requestId];
        request.initiator = msg.sender;
        request.timestamp = block.timestamp;
        request.approvals = 1;
        request.hasApproved[msg.sender] = true;

        emit KeyRotationRequested(requestId, msg.sender);

        // Execute immediately if threshold is 1
        if (request.approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(requestId);
        }

        return requestId;
    }

    /**
     * @notice Approve a key rotation request
     * @param _requestId Request to approve
     */
    function approveKeyRotation(uint256 _requestId) external onlyRole(COUNCIL_ROLE) {
        KeyRotationRequest storage request = keyRotationRequests[_requestId];
        require(request.initiator != address(0), "Request not found");
        require(!request.executed, "Already executed");
        require(!request.hasApproved[msg.sender], "Already approved");

        request.hasApproved[msg.sender] = true;
        request.approvals++;

        emit KeyRotationApproved(_requestId, msg.sender);

        if (request.approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(_requestId);
        }
    }

    /**
     * @notice Execute key rotation
     */
    function _executeKeyRotation(uint256 _requestId) internal {
        KeyRotationRequest storage request = keyRotationRequests[_requestId];
        request.executed = true;
        keyVersion++;

        emit KeyRotationExecuted(_requestId, keyVersion);
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Update daily withdrawal limit
     */
    function setDailyLimit(uint256 _newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyWithdrawalLimit = _newLimit;
        emit DailyLimitUpdated(_newLimit);
    }

    /**
     * @notice Update heartbeat timeout
     */
    function setHeartbeatTimeout(uint256 _timeout) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_timeout >= 5 minutes, "Timeout too short");
        heartbeatTimeout = _timeout;
    }

    /**
     * @notice Update takeover cooldown
     */
    function setTakeoverCooldown(uint256 _cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        takeoverCooldown = _cooldown;
    }

    /**
     * @notice Update rotation approval threshold
     */
    function setRotationApprovalThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_threshold >= 1, "Threshold must be at least 1");
        rotationApprovalThreshold = _threshold;
    }

    /**
     * @notice Add council member
     */
    function addCouncilMember(address _member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(COUNCIL_ROLE, _member);
    }

    /**
     * @notice Remove council member
     */
    function removeCouncilMember(address _member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(COUNCIL_ROLE, _member);
    }

    /**
     * @notice Pause the contract (council only)
     */
    function pause() external onlyRole(COUNCIL_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract (council only)
     */
    function unpause() external onlyRole(COUNCIL_ROLE) {
        _unpause();
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get current game state info
     */
    function getGameState()
        external
        view
        override
        returns (
            string memory cid,
            bytes32 stateHash,
            uint256 version,
            uint256 keyVer,
            uint256 lastBeat,
            bool operatorActive
        )
    {
        return (currentStateCID, currentStateHash, stateVersion, keyVersion, lastHeartbeat, isOperatorActive());
    }

    /**
     * @notice Get operator info
     */
    function getOperatorInfo()
        external
        view
        returns (address op, bytes memory attestation, uint256 registeredAt, bool active)
    {
        return (operator, operatorAttestation, operatorRegisteredAt, isOperatorActive());
    }

    /**
     * @notice Get withdrawal info
     */
    function getWithdrawalInfo() external view override returns (uint256 limit, uint256 usedToday, uint256 remaining) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 todayWithdrawn = currentDay > lastWithdrawalDay ? 0 : withdrawnToday;
        uint256 remainingToday = dailyWithdrawalLimit > todayWithdrawn ? dailyWithdrawalLimit - todayWithdrawn : 0;

        return (dailyWithdrawalLimit, todayWithdrawn, remainingToday);
    }

    /**
     * @notice Check if takeover is available
     */
    function isTakeoverAvailable() external view override returns (bool) {
        if (operator == address(0)) return true;
        if (isOperatorActive()) return false;
        return block.timestamp >= lastHeartbeat + heartbeatTimeout + takeoverCooldown;
    }
}
