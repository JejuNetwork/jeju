// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Treasury} from "./Treasury.sol";

/**
 * @title GameTreasury
 * @author Jeju Network
 * @notice Treasury for permissionless games with TEE operator management
 * @dev Extends Treasury with:
 *      - TEE operator attestation
 *      - Heartbeat-based liveness monitoring
 *      - Game state tracking (IPFS CIDs)
 *      - Key rotation with security council
 *      - Permissionless takeover after timeout
 *
 * Key Security Features:
 * - Rate-limited withdrawals prevent fund draining
 * - Heartbeat-based liveness monitoring
 * - Security council can rotate encryption keys
 * - Anyone can take over after operator timeout
 * - On-chain state anchoring via IPFS CIDs
 *
 * @custom:security-contact security@jeju.network
 */
contract GameTreasury is Treasury {
    // =========================================================================
    // State Tracking
    // =========================================================================
    string public currentStateCID;
    bytes32 public currentStateHash;
    uint256 public stateVersion;
    uint256 public keyVersion;
    uint256 public lastHeartbeat;

    // =========================================================================
    // TEE Operator Management
    // =========================================================================
    address public teeOperator;
    bytes public operatorAttestation;
    uint256 public operatorRegisteredAt;

    // =========================================================================
    // Timeouts
    // =========================================================================
    uint256 public heartbeatTimeout = 1 hours;
    uint256 public takeoverCooldown = 2 hours;

    // =========================================================================
    // Training Tracking
    // =========================================================================
    uint256 public trainingEpoch;
    bytes32 public lastModelHash;

    // =========================================================================
    // Key Rotation
    // =========================================================================
    struct KeyRotationRequest {
        address initiator;
        uint256 timestamp;
        uint256 approvals;
        bool executed;
    }

    mapping(uint256 => KeyRotationRequest) public keyRotationRequests;
    mapping(uint256 => mapping(address => bool)) public rotationApprovals;
    uint256 public nextRotationRequestId;
    uint256 public rotationApprovalThreshold = 2;

    // =========================================================================
    // Events
    // =========================================================================
    event TEEOperatorRegistered(address indexed operator, bytes attestation);
    event TEEOperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 stateHash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event KeyRotationRequested(uint256 indexed requestId, address indexed initiator);
    event KeyRotationApproved(uint256 indexed requestId, address indexed approver);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);
    event HeartbeatTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event TakeoverCooldownUpdated(uint256 oldCooldown, uint256 newCooldown);

    // =========================================================================
    // Errors
    // =========================================================================
    error ActiveOperatorExists();
    error NoOperator();
    error OperatorStillActive();
    error TakeoverCooldownNotMet();
    error AttestationRequired();
    error RotationRequestNotFound();
    error RotationAlreadyExecuted();
    error AlreadyApproved();
    error TimeoutTooShort();

    // =========================================================================
    // Modifiers
    // =========================================================================
    modifier onlyTEEOperator() {
        require(msg.sender == teeOperator && isTEEOperatorActive(), "Not active TEE operator");
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================
    constructor(uint256 _dailyLimit, address _admin)
        Treasury(_dailyLimit, _admin)
    {
        keyVersion = 1;
    }

    // =========================================================================
    // TEE Operator Management
    // =========================================================================

    /**
     * @notice Register a new TEE operator
     * @param _operator Address derived inside TEE
     * @param _attestation Remote attestation proof
     */
    function registerTEEOperator(address _operator, bytes calldata _attestation)
        external
        onlyRole(COUNCIL_ROLE)
    {
        if (_operator == address(0)) revert ZeroAddress();
        if (teeOperator != address(0) && isTEEOperatorActive()) {
            revert ActiveOperatorExists();
        }

        // Revoke old operator if exists
        if (teeOperator != address(0)) {
            _revokeRole(OPERATOR_ROLE, teeOperator);
            emit TEEOperatorDeactivated(teeOperator, "replaced");
        }

        teeOperator = _operator;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, _operator);

        emit TEEOperatorRegistered(_operator, _attestation);
    }

    /**
     * @notice Check if TEE operator is active
     */
    function isTEEOperatorActive() public view returns (bool) {
        if (teeOperator == address(0)) return false;
        return block.timestamp - lastHeartbeat <= heartbeatTimeout;
    }

    /**
     * @notice Mark operator as inactive (callable by anyone after timeout)
     */
    function markOperatorInactive() external {
        if (teeOperator == address(0)) revert NoOperator();
        if (isTEEOperatorActive()) revert OperatorStillActive();

        address oldOperator = teeOperator;
        _revokeRole(OPERATOR_ROLE, oldOperator);
        teeOperator = address(0);

        emit TEEOperatorDeactivated(oldOperator, "heartbeat_timeout");
    }

    /**
     * @notice Permissionless takeover by a new TEE operator
     * @param _attestation New operator's attestation proof
     */
    function takeoverAsOperator(bytes calldata _attestation) external {
        if (teeOperator != address(0) && isTEEOperatorActive()) {
            revert OperatorStillActive();
        }
        if (block.timestamp < lastHeartbeat + heartbeatTimeout + takeoverCooldown) {
            revert TakeoverCooldownNotMet();
        }
        if (_attestation.length == 0) revert AttestationRequired();

        address oldOperator = teeOperator;

        if (oldOperator != address(0)) {
            _revokeRole(OPERATOR_ROLE, oldOperator);
        }

        teeOperator = msg.sender;
        operatorAttestation = _attestation;
        operatorRegisteredAt = block.timestamp;
        lastHeartbeat = block.timestamp;

        _grantRole(OPERATOR_ROLE, msg.sender);

        emit TakeoverInitiated(msg.sender, oldOperator);
        emit TEEOperatorRegistered(msg.sender, _attestation);
    }

    /**
     * @notice Check if takeover is available
     */
    function isTakeoverAvailable() external view returns (bool) {
        if (teeOperator == address(0)) return true;
        if (isTEEOperatorActive()) return false;
        return block.timestamp >= lastHeartbeat + heartbeatTimeout + takeoverCooldown;
    }

    // =========================================================================
    // Game State Management
    // =========================================================================

    /**
     * @notice Update game state
     * @param _cid IPFS CID of encrypted state
     * @param _hash Hash of the state for integrity
     */
    function updateState(string calldata _cid, bytes32 _hash)
        external
        onlyTEEOperator
        whenNotPaused
    {
        currentStateCID = _cid;
        currentStateHash = _hash;
        stateVersion++;
        lastHeartbeat = block.timestamp;

        emit StateUpdated(_cid, _hash, stateVersion);
    }

    /**
     * @notice Send heartbeat to prove liveness
     */
    function heartbeat() external onlyTEEOperator {
        lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    /**
     * @notice Record a training cycle
     * @param _datasetCID Public IPFS CID of training data
     * @param _modelHash Hash of the updated model
     */
    function recordTraining(string calldata _datasetCID, bytes32 _modelHash)
        external
        onlyTEEOperator
    {
        trainingEpoch++;
        lastModelHash = _modelHash;
        emit TrainingRecorded(trainingEpoch, _datasetCID, _modelHash);
    }

    // =========================================================================
    // Key Rotation
    // =========================================================================

    /**
     * @notice Request key rotation
     */
    function requestKeyRotation() external onlyRole(COUNCIL_ROLE) returns (uint256) {
        uint256 requestId = nextRotationRequestId++;

        keyRotationRequests[requestId] = KeyRotationRequest({
            initiator: msg.sender,
            timestamp: block.timestamp,
            approvals: 1,
            executed: false
        });
        rotationApprovals[requestId][msg.sender] = true;

        emit KeyRotationRequested(requestId, msg.sender);

        if (keyRotationRequests[requestId].approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(requestId);
        }

        return requestId;
    }

    /**
     * @notice Approve a key rotation request
     */
    function approveKeyRotation(uint256 _requestId) external onlyRole(COUNCIL_ROLE) {
        KeyRotationRequest storage request = keyRotationRequests[_requestId];
        if (request.initiator == address(0)) revert RotationRequestNotFound();
        if (request.executed) revert RotationAlreadyExecuted();
        if (rotationApprovals[_requestId][msg.sender]) revert AlreadyApproved();

        rotationApprovals[_requestId][msg.sender] = true;
        request.approvals++;

        emit KeyRotationApproved(_requestId, msg.sender);

        if (request.approvals >= rotationApprovalThreshold) {
            _executeKeyRotation(_requestId);
        }
    }

    function _executeKeyRotation(uint256 _requestId) internal {
        keyRotationRequests[_requestId].executed = true;
        keyVersion++;
        emit KeyRotationExecuted(_requestId, keyVersion);
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Update heartbeat timeout
     */
    function setHeartbeatTimeout(uint256 _timeout) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_timeout < 5 minutes) revert TimeoutTooShort();
        uint256 oldTimeout = heartbeatTimeout;
        heartbeatTimeout = _timeout;
        emit HeartbeatTimeoutUpdated(oldTimeout, _timeout);
    }

    /**
     * @notice Update takeover cooldown
     */
    function setTakeoverCooldown(uint256 _cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldCooldown = takeoverCooldown;
        takeoverCooldown = _cooldown;
        emit TakeoverCooldownUpdated(oldCooldown, _cooldown);
    }

    /**
     * @notice Update rotation approval threshold
     */
    function setRotationApprovalThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_threshold >= 1, "Threshold must be at least 1");
        rotationApprovalThreshold = _threshold;
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
        returns (
            string memory cid,
            bytes32 stateHash,
            uint256 _stateVersion,
            uint256 _keyVersion,
            uint256 lastBeat,
            bool operatorActive
        )
    {
        return (
            currentStateCID,
            currentStateHash,
            stateVersion,
            keyVersion,
            lastHeartbeat,
            isTEEOperatorActive()
        );
    }

    /**
     * @notice Get TEE operator info
     */
    function getTEEOperatorInfo()
        external
        view
        returns (address op, bytes memory attestation, uint256 registeredAt, bool active)
    {
        return (teeOperator, operatorAttestation, operatorRegisteredAt, isTEEOperatorActive());
    }

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }
}






