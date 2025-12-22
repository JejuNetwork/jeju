// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IProviderRegistry
 * @notice Standard interface for provider registries
 */
interface IProviderRegistry {
    event ProviderRegistered(address indexed provider, uint256 indexed agentId, uint256 stake, uint256 registeredAt);
    event ProviderUpdated(address indexed provider);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);
    event StakeAdded(address indexed provider, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed provider, uint256 amount);

    error InsufficientStake(uint256 provided, uint256 required);
    error ProviderAlreadyRegistered();
    error ProviderNotRegistered();
    error ProviderNotActive();
    error ProviderStillActive();
    error TransferFailed();
    error WithdrawalWouldBreachMinimum();

    function minProviderStake() external view returns (uint256);
    function providerCount() external view returns (uint256);
    function getActiveProviders() external view returns (address[] memory);
    function getProviderByAgent(uint256 agentId) external view returns (address);
    function getAgentByProvider(address provider) external view returns (uint256);
    function hasValidAgent(address provider) external view returns (bool);
    function isProviderBanned(address provider) external view returns (bool);
}

/**
 * @title IProviderRegistryAdmin
 * @notice Admin functions for provider registries
 */
interface IProviderRegistryAdmin {
    event MinStakeUpdated(uint256 oldStake, uint256 newStake);

    function setMinProviderStake(uint256 newMinStake) external;
    function setIdentityRegistry(address registry) external;
    function setBanManager(address manager) external;
    function setRequireAgentRegistration(bool required) external;
    function pause() external;
    function unpause() external;
}
