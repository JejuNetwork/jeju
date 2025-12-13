// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IGameTreasury
 * @notice Interface for game treasuries with TEE operator management. Implemented by BabylonTreasury.
 */
interface IGameTreasury {
    event OperatorRegistered(address indexed operator, bytes attestation);
    event OperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 hash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event FundsWithdrawn(address indexed operator, uint256 amount);
    event FundsDeposited(address indexed depositor, uint256 amount);

    function deposit() external payable;
    function getBalance() external view returns (uint256);
    function registerOperator(address _operator, bytes calldata _attestation) external;
    function isOperatorActive() external view returns (bool);
    function takeoverAsOperator(bytes calldata _attestation) external;
    function operator() external view returns (address);
    function updateState(string calldata _cid, bytes32 _hash) external;
    function heartbeat() external;
    function getGameState() external view returns (string memory cid, bytes32 stateHash, uint256 version, uint256 keyVer, uint256 lastBeat, bool operatorActive);
    function withdraw(uint256 _amount) external;
    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedToday, uint256 remaining);
    function isTakeoverAvailable() external view returns (bool);
}
