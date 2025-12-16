// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title ERC8004ProviderMixin
 * @author Jeju Network
 * @notice Standardized ERC-8004 agent integration for provider registries
 * @dev Provides common functionality for linking providers to ERC-8004 agents
 *
 * This library standardizes:
 * - Agent ownership verification
 * - Agent-to-provider mapping
 * - Ban checking via IdentityRegistry
 * - Standard events and errors
 *
 * Usage:
 * ```solidity
 * contract MyProviderRegistry {
 *     using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
 *     
 *     ERC8004ProviderMixin.Data public erc8004;
 *     
 *     function registerWithAgent(...) external {
 *         erc8004.verifyAndLinkAgent(msg.sender, agentId);
 *         // ... rest of registration
 *     }
 * }
 * ```
 */
library ERC8004ProviderMixin {
    // ============ Structs ============

    struct Data {
        /// @notice ERC-8004 Identity Registry for agent verification
        IIdentityRegistry identityRegistry;
        /// @notice Whether to require ERC-8004 agent registration
        bool requireAgentRegistration;
        /// @notice Mapping of agent ID => provider address
        mapping(uint256 => address) agentToProvider;
        /// @notice Mapping of provider address => agent ID
        mapping(address => uint256) providerToAgent;
    }

    // ============ Errors ============

    error InvalidAgentId();
    error NotAgentOwner();
    error AgentAlreadyLinked();
    error AgentRequired();
    error AgentIsBanned();
    error ProviderAlreadyHasAgent();

    // ============ Events ============

    event AgentLinked(address indexed provider, uint256 indexed agentId);
    event AgentUnlinked(address indexed provider, uint256 indexed agentId);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentRegistrationRequirementUpdated(bool required);

    // ============ Verification Functions ============

    /**
     * @notice Verify agent ownership and check if agent is banned
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @param agentId ERC-8004 agent ID to verify
     * @dev Reverts if agent doesn't exist, provider doesn't own it, or agent is banned
     */
    function verifyAgentOwnership(Data storage self, address provider, uint256 agentId) internal view {
        if (address(self.identityRegistry) == address(0)) revert InvalidAgentId();
        if (!self.identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (self.identityRegistry.ownerOf(agentId) != provider) revert NotAgentOwner();

        // Check if agent is banned
        if (_isAgentBanned(self, agentId)) revert AgentIsBanned();
    }

    /**
     * @notice Verify agent and link it to provider
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @param agentId ERC-8004 agent ID to link
     * @dev Verifies ownership, checks for duplicates, and links agent to provider
     */
    function verifyAndLinkAgent(Data storage self, address provider, uint256 agentId) internal {
        verifyAgentOwnership(self, provider, agentId);

        // Check if agent is already linked to another provider
        if (self.agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();

        // Check if provider already has an agent linked
        if (self.providerToAgent[provider] != 0) revert ProviderAlreadyHasAgent();

        // Link agent to provider
        self.agentToProvider[agentId] = provider;
        self.providerToAgent[provider] = agentId;

        emit AgentLinked(provider, agentId);
    }

    /**
     * @notice Link an existing agent to a provider (for providers registered without agent)
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @param agentId ERC-8004 agent ID to link
     */
    function linkAgent(Data storage self, address provider, uint256 agentId) internal {
        verifyAndLinkAgent(self, provider, agentId);
    }

    /**
     * @notice Unlink agent from provider
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     */
    function unlinkAgent(Data storage self, address provider) internal {
        uint256 agentId = self.providerToAgent[provider];
        if (agentId == 0) return;

        delete self.agentToProvider[agentId];
        delete self.providerToAgent[provider];

        emit AgentUnlinked(provider, agentId);
    }

    /**
     * @notice Check if agent registration is required
     * @param self The ERC8004ProviderMixin data
     * @param agentId Agent ID (0 if not provided)
     * @dev Reverts if agent registration is required but agentId is 0
     */
    function requireAgentIfNeeded(Data storage self, uint256 agentId) internal view {
        if (self.requireAgentRegistration && agentId == 0) revert AgentRequired();
    }

    // ============ View Functions ============

    /**
     * @notice Get provider address for an agent ID
     * @param self The ERC8004ProviderMixin data
     * @param agentId Agent ID
     * @return provider Provider address (address(0) if not linked)
     */
    function getProviderByAgent(Data storage self, uint256 agentId) internal view returns (address provider) {
        return self.agentToProvider[agentId];
    }

    /**
     * @notice Get agent ID for a provider
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @return agentId Agent ID (0 if not linked)
     */
    function getAgentByProvider(Data storage self, address provider) internal view returns (uint256 agentId) {
        return self.providerToAgent[provider];
    }

    /**
     * @notice Check if agent is banned
     * @param self The ERC8004ProviderMixin data
     * @param agentId Agent ID
     * @return banned True if agent is banned
     */
    function isAgentBanned(Data storage self, uint256 agentId) internal view returns (bool banned) {
        return _isAgentBanned(self, agentId);
    }

    /**
     * @notice Check if provider has a valid agent (or agent not required)
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @return valid True if provider has valid agent or agent not required
     */
    function hasValidAgent(Data storage self, address provider) internal view returns (bool valid) {
        uint256 agentId = self.providerToAgent[provider];
        if (agentId == 0) return !self.requireAgentRegistration;
        if (address(self.identityRegistry) == address(0)) return true;
        return self.identityRegistry.agentExists(agentId) && !_isAgentBanned(self, agentId);
    }

    /**
     * @notice Check if a provider is banned (via agent or address)
     * @param self The ERC8004ProviderMixin data
     * @param provider Provider address
     * @return banned True if provider is banned
     */
    function isProviderBanned(Data storage self, address provider) internal view returns (bool banned) {
        uint256 agentId = self.providerToAgent[provider];
        if (agentId > 0) {
            return _isAgentBanned(self, agentId);
        }
        return false;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param self The ERC8004ProviderMixin data
     * @param _identityRegistry New registry address
     */
    function setIdentityRegistry(Data storage self, address _identityRegistry) internal {
        address oldRegistry = address(self.identityRegistry);
        self.identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Set whether agent registration is required
     * @param self The ERC8004ProviderMixin data
     * @param required True to require agent registration
     */
    function setRequireAgentRegistration(Data storage self, bool required) internal {
        self.requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    // ============ Internal Functions ============

    /**
     * @dev Check if agent is banned via IdentityRegistry
     */
    function _isAgentBanned(Data storage self, uint256 agentId) private view returns (bool) {
        if (address(self.identityRegistry) == address(0)) return false;

        // Check if agent exists first
        try self.identityRegistry.agentExists(agentId) returns (bool exists) {
            if (!exists) return false;
        } catch {
            return false;
        }

        // Try to get marketplace info which includes banned status
        (bool success, bytes memory data) = address(self.identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (success && data.length >= 224) {
            // getMarketplaceInfo returns: (string, string, string, string, bool, uint8, bool)
            // banned is the last bool (7th return value)
            (,,,,,, bool banned) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        return false;
    }
}
