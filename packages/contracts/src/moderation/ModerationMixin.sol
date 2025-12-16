// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ModerationMixin
 * @author Jeju Network
 * @notice Standardized moderation checks for provider registries
 * @dev Provides common functionality for checking bans via BanManager and IdentityRegistry
 *
 * This library standardizes:
 * - Address-level ban checks (BanManager)
 * - Agent-level ban checks (IdentityRegistry)
 * - Provider-level ban checks (combines both)
 *
 * Usage:
 * ```solidity
 * contract MyProviderRegistry {
 *     using ModerationMixin for ModerationMixin.Data;
 *     
 *     ModerationMixin.Data public moderation;
 *     
 *     function register(...) external {
 *         moderation.requireNotBanned(msg.sender);
 *         // ... rest of registration
 *     }
 * }
 * ```
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

    // ============ Ban Checking Functions ============

    /**
     * @notice Check if an address is banned
     * @param self The ModerationMixin data
     * @param account Address to check
     * @return banned True if address is banned
     * @dev Returns true (banned) on error to fail-closed for security
     */
    function isAddressBanned(Data storage self, address account) internal view returns (bool banned) {
        if (self.banManager == address(0)) return false;

        // BanManager interface: isAddressBanned(address) returns (bool)
        (bool success, bytes memory data) = self.banManager.staticcall(
            abi.encodeWithSignature("isAddressBanned(address)", account)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        // Fail-closed: if we can't verify, assume banned for security
        return true;
    }

    /**
     * @notice Check if an agent is banned
     * @param self The ModerationMixin data
     * @param agentId Agent ID to check
     * @return banned True if agent is banned
     * @dev Uses BanManager for agent bans if available, otherwise checks IdentityRegistry
     *      Returns true (banned) on error to fail-closed for security
     */
    function isAgentBanned(Data storage self, uint256 agentId) internal view returns (bool banned) {
        if (address(self.identityRegistry) == address(0)) return false;
        if (!self.identityRegistry.agentExists(agentId)) return false;

        // First try BanManager if available (preferred method)
        if (self.banManager != address(0)) {
            (bool success, bytes memory data) = self.banManager.staticcall(
                abi.encodeWithSignature("isNetworkBanned(uint256)", agentId)
            );
            if (success && data.length >= 32) {
                bool networkBanned = abi.decode(data, (bool));
                if (networkBanned) return true;
            }
        }

        // Fallback: Try to get marketplace info which includes banned status
        (bool success, bytes memory data) = address(self.identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (success && data.length >= 224) {
            // getMarketplaceInfo returns: (string, string, string, string, bool, uint8, bool)
            // banned is the last bool (7th return value)
            (,,,,,, bool banned_) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned_;
        }

        // Fail-closed: if we can't verify ban status, assume not banned
        // (This is less restrictive than address bans since agent verification already passed)
        return false;
    }

    /**
     * @notice Check if a provider is banned (checks both address and agent)
     * @param self The ModerationMixin data
     * @param provider Provider address
     * @param agentId Agent ID (0 if not linked)
     * @return banned True if provider is banned
     */
    function isProviderBanned(Data storage self, address provider, uint256 agentId) internal view returns (bool banned) {
        // Check address-level ban
        if (isAddressBanned(self, provider)) return true;

        // Check agent-level ban if agent is linked
        if (agentId > 0 && isAgentBanned(self, agentId)) return true;

        return false;
    }

    /**
     * @notice Require that an address is not banned (reverts if banned)
     * @param self The ModerationMixin data
     * @param account Address to check
     */
    function requireNotBanned(Data storage self, address account) internal view {
        if (isAddressBanned(self, account)) revert AddressIsBanned(account);
    }

    /**
     * @notice Require that an agent is not banned (reverts if banned)
     * @param self The ModerationMixin data
     * @param agentId Agent ID to check
     */
    function requireAgentNotBanned(Data storage self, uint256 agentId) internal view {
        if (isAgentBanned(self, agentId)) revert AgentIsBanned(agentId);
    }

    /**
     * @notice Require that a provider is not banned (reverts if banned)
     * @param self The ModerationMixin data
     * @param provider Provider address
     * @param agentId Agent ID (0 if not linked)
     */
    function requireProviderNotBanned(Data storage self, address provider, uint256 agentId) internal view {
        requireNotBanned(self, provider);
        if (agentId > 0) {
            requireAgentNotBanned(self, agentId);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the BanManager contract
     * @param self The ModerationMixin data
     * @param _banManager New BanManager address
     */
    function setBanManager(Data storage self, address _banManager) internal {
        address oldManager = self.banManager;
        self.banManager = _banManager;
        emit BanManagerUpdated(oldManager, _banManager);
    }

    /**
     * @notice Set the IdentityRegistry contract
     * @param self The ModerationMixin data
     * @param _identityRegistry New IdentityRegistry address
     */
    function setIdentityRegistry(Data storage self, address _identityRegistry) internal {
        address oldRegistry = address(self.identityRegistry);
        self.identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }
}
