// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AgentGated} from "./AgentGated.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title Moderated
 * @author Jeju Network
 * @notice Base contract combining AgentGated + ModerationMixin for full access control
 * @dev ALL user-facing Jeju contracts should inherit this for:
 *      1. Mandatory agent registration (AgentGated)
 *      2. Ban enforcement (ModerationMixin)
 *
 * This is the primary base contract for new Jeju contracts.
 *
 * Usage:
 * ```solidity
 * contract MyContract is Moderated {
 *     constructor(address registry, address banManager, address owner)
 *         Moderated(registry, banManager, owner) {}
 *
 *     function doSomething() external requiresAgent(msg.sender) notBanned(msg.sender) {
 *         // Only registered, non-banned agents can call this
 *     }
 * }
 * ```
 *
 * @custom:security-contact security@jeju.network
 */
abstract contract Moderated is AgentGated {
    using ModerationMixin for ModerationMixin.Data;

    // ============ State ============

    /// @notice Moderation data (ban checking)
    ModerationMixin.Data public moderation;

    // ============ Errors ============

    error AddressIsBanned(address account);
    error AgentIdIsBanned(uint256 agentId);

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _banManager,
        address _owner
    ) AgentGated(_identityRegistry, _owner) {
        if (_banManager != address(0)) {
            moderation.setBanManager(_banManager);
        }
        if (_identityRegistry != address(0)) {
            moderation.setIdentityRegistry(_identityRegistry);
        }
    }

    // ============ Modifiers ============

    /**
     * @notice Requires address is not banned
     * @param account Address to check
     */
    modifier notBanned(address account) {
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        _;
    }

    /**
     * @notice Requires agent is not banned
     * @param agentId Agent ID to check
     */
    modifier agentNotBanned(uint256 agentId) {
        if (moderation.isAgentBanned(agentId)) revert AgentIdIsBanned(agentId);
        _;
    }

    /**
     * @notice Full access check: requires agent AND not banned
     * @param account Address to check
     */
    modifier fullAccessCheck(address account) {
        _requireAgent(account);
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        
        uint256 agentId = _findAgentForAddress(account);
        if (agentId > 0 && moderation.isAgentBanned(agentId)) {
            revert AgentIdIsBanned(agentId);
        }
        _;
    }

    /**
     * @notice Combined check with specific agent ID
     * @param account Address to check
     * @param agentId Agent ID to verify and check ban
     */
    modifier fullAccessCheckWithAgent(address account, uint256 agentId) {
        _requireAgentId(account, agentId);
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        if (moderation.isAgentBanned(agentId)) revert AgentIdIsBanned(agentId);
        _;
    }

    // ============ View Functions ============

    /**
     * @notice Check if address is banned
     * @param account Address to check
     * @return True if banned
     */
    function isAddressBanned(address account) external view returns (bool) {
        return moderation.isAddressBanned(account);
    }

    /**
     * @notice Check if agent is banned
     * @param agentId Agent ID to check
     * @return True if banned
     */
    function isAgentIdBanned(uint256 agentId) external view returns (bool) {
        return moderation.isAgentBanned(agentId);
    }

    /**
     * @notice Check if address/agent combo is banned
     * @param account Address to check
     * @param agentId Agent ID (0 if not linked)
     * @return True if either is banned
     */
    function isBanned(address account, uint256 agentId) external view returns (bool) {
        return moderation.isProviderBanned(account, agentId);
    }

    /**
     * @notice Full access check - has agent and not banned
     * @param account Address to check
     * @return canAccess True if can access
     * @return reason Reason if cannot access
     */
    function checkAccess(address account) external view returns (bool canAccess, string memory reason) {
        // Check agent requirement
        if (agentRequired && !agentWhitelist[account]) {
            if (address(identityRegistry) == address(0)) {
                return (false, "No identity registry");
            }
            
            uint256 agentId = _findAgentForAddress(account);
            if (agentId == 0) {
                return (false, "Agent registration required");
            }
            
            if (_isAgentBanned(agentId)) {
                return (false, "Agent is banned");
            }
        }

        // Check address ban
        if (moderation.isAddressBanned(account)) {
            return (false, "Address is banned");
        }

        return (true, "");
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the BanManager contract
     * @param _banManager New BanManager address
     */
    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    /**
     * @notice Update identity registry (updates both AgentGated and ModerationMixin)
     * @param _identityRegistry New registry address
     */
    function setIdentityRegistry(address _identityRegistry) external virtual override onlyOwner {
        // Update AgentGated
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistrySet(oldRegistry, _identityRegistry);
        
        // Update ModerationMixin
        moderation.setIdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Get BanManager address
     */
    function getBanManager() external view returns (address) {
        return moderation.banManager;
    }
}
