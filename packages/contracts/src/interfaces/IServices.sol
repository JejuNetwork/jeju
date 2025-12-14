// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IServiceRegistry
 * @notice Interface for service cost and availability tracking
 */
interface IServiceRegistry {
    function getServiceCost(string calldata serviceName, address user) external view returns (uint256 cost);
    function isServiceAvailable(string calldata serviceName) external view returns (bool);
}

/**
 * @title ICloudServiceRegistry
 * @notice Extended service registry with usage tracking for cloud services
 */
interface ICloudServiceRegistry {
    function getServiceCost(string calldata serviceName, address user) external view returns (uint256 cost);
    function recordUsage(address user, string calldata serviceName, uint256 cost) external;
    function isServiceAvailable(string calldata serviceName) external view returns (bool);
}

/**
 * @title ICreditManager
 * @notice Interface for prepaid credit balance management
 */
interface ICreditManager {
    function deductCredit(address user, address token, uint256 amount) external;
    function tryDeductCredit(address user, address token, uint256 amount)
        external
        returns (bool success, uint256 remaining);
    function balances(address user, address token) external view returns (uint256);
    function hasSufficientCredit(address user, address token, uint256 amount) external view returns (bool, uint256);
}

/**
 * @title ILedgerManager
 * @notice Interface for ledger-based balance tracking
 */
interface ILedgerManager {
    function deductCredit(address user, address token, uint256 amount) external returns (bool success);
    function addCredit(address user, address token, uint256 amount) external;
    function getBalance(address user, address token) external view returns (uint256);
}
