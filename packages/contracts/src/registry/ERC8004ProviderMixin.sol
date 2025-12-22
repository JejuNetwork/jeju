// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title ERC8004ProviderMixin
 * @notice ERC-8004 agent integration for provider registries
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

    function verifyAgentOwnership(Data storage self, address provider, uint256 agentId) internal view {
        if (address(self.identityRegistry) == address(0)) revert InvalidAgentId();
        if (!self.identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (self.identityRegistry.ownerOf(agentId) != provider) revert NotAgentOwner();
        if (_isAgentBanned(self, agentId)) revert AgentIsBanned();
    }

    function verifyAndLinkAgent(Data storage self, address provider, uint256 agentId) internal {
        verifyAgentOwnership(self, provider, agentId);
        if (self.agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();
        if (self.providerToAgent[provider] != 0) revert ProviderAlreadyHasAgent();
        self.agentToProvider[agentId] = provider;
        self.providerToAgent[provider] = agentId;
        emit AgentLinked(provider, agentId);
    }

    function unlinkAgent(Data storage self, address provider) internal {
        uint256 agentId = self.providerToAgent[provider];
        if (agentId == 0) return;
        delete self.agentToProvider[agentId];
        delete self.providerToAgent[provider];
        emit AgentUnlinked(provider, agentId);
    }

    function requireAgentIfNeeded(Data storage self, uint256 agentId) internal view {
        if (self.requireAgentRegistration && agentId == 0) revert AgentRequired();
    }

    function getProviderByAgent(Data storage self, uint256 agentId) internal view returns (address) {
        return self.agentToProvider[agentId];
    }

    function getAgentByProvider(Data storage self, address provider) internal view returns (uint256) {
        return self.providerToAgent[provider];
    }

    function hasValidAgent(Data storage self, address provider) internal view returns (bool) {
        uint256 agentId = self.providerToAgent[provider];
        if (agentId == 0) return !self.requireAgentRegistration;
        if (address(self.identityRegistry) == address(0)) return true;
        return self.identityRegistry.agentExists(agentId) && !_isAgentBanned(self, agentId);
    }

    function setIdentityRegistry(Data storage self, address _identityRegistry) internal {
        address oldRegistry = address(self.identityRegistry);
        self.identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setRequireAgentRegistration(Data storage self, bool required) internal {
        self.requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    function _isAgentBanned(Data storage self, uint256 agentId) private view returns (bool) {
        if (address(self.identityRegistry) == address(0)) return false;

        try self.identityRegistry.agentExists(agentId) returns (bool exists) {
            if (!exists) return false;
        } catch {
            return false;
        }

        (bool success, bytes memory data) = address(self.identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (success && data.length >= 224) {
            (,,,,,, bool banned) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        return false;
    }
}
