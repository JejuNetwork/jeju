// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ModerationMixin
 * @notice Ban checking for provider registries via BanManager and IdentityRegistry
 */
library ModerationMixin {
    // ============ Structs ============

    struct Data {
        /// @notice BanManager contract for address-level bans
        address banManager;
        /// @notice IdentityRegistry for agent-level bans
        IIdentityRegistry identityRegistry;
    }

    // ============ Errors ============

    error AddressIsBanned(address account);
    error AgentIsBanned(uint256 agentId);

    // ============ Events ============

    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    function isAddressBanned(Data storage self, address account) internal view returns (bool) {
        if (self.banManager == address(0)) return false;

        (bool success, bytes memory data) = self.banManager.staticcall(
            abi.encodeWithSignature("isAddressBanned(address)", account)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        return true; // Fail-closed
    }

    function isAgentBanned(Data storage self, uint256 agentId) internal view returns (bool) {
        if (address(self.identityRegistry) == address(0)) return false;
        if (!self.identityRegistry.agentExists(agentId)) return false;

        if (self.banManager != address(0)) {
            (bool banSuccess, bytes memory banData) = self.banManager.staticcall(
                abi.encodeWithSignature("isNetworkBanned(uint256)", agentId)
            );
            if (banSuccess && banData.length >= 32) {
                if (abi.decode(banData, (bool))) return true;
            }
        }

        (bool regSuccess, bytes memory regData) = address(self.identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (regSuccess && regData.length >= 224) {
            (,,,,,, bool banned) = abi.decode(regData, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        return false;
    }

    function isProviderBanned(Data storage self, address provider, uint256 agentId) internal view returns (bool) {
        if (isAddressBanned(self, provider)) return true;
        if (agentId > 0 && isAgentBanned(self, agentId)) return true;
        return false;
    }

    function requireNotBanned(Data storage self, address account) internal view {
        if (isAddressBanned(self, account)) revert AddressIsBanned(account);
    }

    function requireAgentNotBanned(Data storage self, uint256 agentId) internal view {
        if (isAgentBanned(self, agentId)) revert AgentIsBanned(agentId);
    }

    function requireProviderNotBanned(Data storage self, address provider, uint256 agentId) internal view {
        requireNotBanned(self, provider);
        if (agentId > 0) requireAgentNotBanned(self, agentId);
    }

    function setBanManager(Data storage self, address _banManager) internal {
        address oldManager = self.banManager;
        self.banManager = _banManager;
        emit BanManagerUpdated(oldManager, _banManager);
    }

    function setIdentityRegistry(Data storage self, address _identityRegistry) internal {
        address oldRegistry = address(self.identityRegistry);
        self.identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }
}
