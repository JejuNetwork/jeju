// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IComputeRegistry
 * @notice Interface for ComputeRegistry interactions
 */
interface IComputeRegistry {
    function isActive(address provider) external view returns (bool);
    function getProviderStake(address provider) external view returns (uint256);
    function getProviderAgentId(address provider) external view returns (uint256);
}
