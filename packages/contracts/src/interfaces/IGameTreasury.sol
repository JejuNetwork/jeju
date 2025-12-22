// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IGameTreasury
 * @notice Interface for game treasuries with TEE operator management
 * @dev Implemented by GameTreasury, deployable via TreasuryFactory
 *
 * Features:
 * - TEE operator attestation and heartbeat monitoring
 * - Game state tracking via IPFS CIDs
 * - Permissionless takeover after operator timeout
 * - Key rotation with security council approval
 */
interface IGameTreasury {
    // Events
    event TEEOperatorRegistered(address indexed operator, bytes attestation);
    event TEEOperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 stateHash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);

    // TEE Operator Management
    function registerTEEOperator(address _operator, bytes calldata _attestation) external;
    function isTEEOperatorActive() external view returns (bool);
    function takeoverAsOperator(bytes calldata _attestation) external;
    function isTakeoverAvailable() external view returns (bool);
    function markOperatorInactive() external;

    // State Management
    function updateState(string calldata _cid, bytes32 _hash) external;
    function heartbeat() external;
    function recordTraining(string calldata _datasetCID, bytes32 _modelHash) external;

    // Key Rotation
    function requestKeyRotation() external returns (uint256);
    function approveKeyRotation(uint256 _requestId) external;

    // View Functions
    function teeOperator() external view returns (address);
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
        );
    function getTEEOperatorInfo()
        external
        view
        returns (address op, bytes memory attestation, uint256 registeredAt, bool active);

    // Inherited from Treasury (partial)
    function deposit() external payable;
    function getBalance() external view returns (uint256);
    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedToday, uint256 remaining);
}
