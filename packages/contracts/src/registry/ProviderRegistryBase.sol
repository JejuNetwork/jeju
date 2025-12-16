// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC8004ProviderMixin} from "./ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";

/**
 * @title ProviderRegistryBase
 * @notice Base contract for provider registries with ERC-8004 and moderation
 */
abstract contract ProviderRegistryBase is Ownable, Pausable, ReentrancyGuard {
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;

    // ============ State Variables ============

    /// @notice ERC-8004 integration data
    ERC8004ProviderMixin.Data public erc8004;

    /// @notice Moderation integration data
    ModerationMixin.Data public moderation;

    /// @notice Minimum stake required to register as provider
    uint256 public minProviderStake;

    /// @notice All registered provider addresses
    address[] public providerList;

    /// @notice Provider count
    uint256 public providerCount;

    // ============ Events ============

    event ProviderRegistered(
        address indexed provider, uint256 indexed agentId, uint256 stake, uint256 registeredAt
    );
    event ProviderUpdated(address indexed provider);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);
    event StakeAdded(address indexed provider, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event MinStakeUpdated(uint256 oldStake, uint256 newStake);

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error ProviderAlreadyRegistered();
    error ProviderNotRegistered();
    error ProviderNotActive();
    error ProviderStillActive();
    error TransferFailed();
    error WithdrawalWouldBreachMinimum();

    // ============ Constructor ============

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            erc8004.setIdentityRegistry(_identityRegistry);
            moderation.setIdentityRegistry(_identityRegistry);
        }
        if (_banManager != address(0)) {
            moderation.setBanManager(_banManager);
        }
        minProviderStake = _minProviderStake;
    }

    function _registerProviderWithoutAgent(address provider) internal {
        erc8004.requireAgentIfNeeded(0);
        moderation.requireNotBanned(provider);
        _registerProviderInternal(provider, 0);
    }

    function _registerProviderWithAgent(address provider, uint256 agentId) internal {
        erc8004.verifyAndLinkAgent(provider, agentId);
        moderation.requireProviderNotBanned(provider, agentId);
        _registerProviderInternal(provider, agentId);
    }

    function _registerProviderInternal(address provider, uint256 agentId) internal {
        if (msg.value < minProviderStake) {
            revert InsufficientStake(msg.value, minProviderStake);
        }
        _onProviderRegistered(provider, agentId, msg.value);
        providerList.push(provider);
        providerCount++;
        emit ProviderRegistered(provider, agentId, msg.value, block.timestamp);
    }

    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal virtual;

    function deactivateProvider(address provider) external virtual {}
    function reactivateProvider(address provider) external virtual {}
    function addStake(address provider) external payable virtual {}
    function withdrawStake(address provider, uint256 amount) external virtual {}

    function getProviderByAgent(uint256 agentId) external view returns (address) {
        return erc8004.getProviderByAgent(agentId);
    }

    function getAgentByProvider(address provider) external view returns (uint256) {
        return erc8004.getAgentByProvider(provider);
    }

    function hasValidAgent(address provider) external view returns (bool) {
        return erc8004.hasValidAgent(provider);
    }

    function isProviderBanned(address provider) external view returns (bool) {
        uint256 agentId = erc8004.getAgentByProvider(provider);
        return moderation.isProviderBanned(provider, agentId);
    }

    function getActiveProviders() external view virtual returns (address[] memory) {
        return providerList;
    }

    function getProviderCount() external view returns (uint256) {
        return providerCount;
    }

    function setMinProviderStake(uint256 newMinStake) external onlyOwner {
        uint256 oldStake = minProviderStake;
        minProviderStake = newMinStake;
        emit MinStakeUpdated(oldStake, newMinStake);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        erc8004.setIdentityRegistry(_identityRegistry);
        moderation.setIdentityRegistry(_identityRegistry);
    }

    function setRequireAgentRegistration(bool required) external onlyOwner {
        erc8004.setRequireAgentRegistration(required);
    }

    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
