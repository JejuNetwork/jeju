// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AgentGated} from "./AgentGated.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";

/**
 * @title Moderated
 * @notice Base contract combining AgentGated + ModerationMixin for full access control
 */
abstract contract Moderated is AgentGated {
    using ModerationMixin for ModerationMixin.Data;

    // ============ State ============

    /// @notice Moderation data (ban checking)
    ModerationMixin.Data public moderation;

    // ============ Errors ============

    error AddressIsBanned(address account);
    error AgentIdIsBanned(uint256 agentId);


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

    modifier notBanned(address account) {
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        _;
    }

    modifier agentNotBanned(uint256 agentId) {
        if (moderation.isAgentBanned(agentId)) revert AgentIdIsBanned(agentId);
        _;
    }

    modifier fullAccessCheck(address account) {
        _requireAgent(account);
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        
        uint256 agentId = _findAgentForAddress(account);
        if (agentId > 0 && moderation.isAgentBanned(agentId)) {
            revert AgentIdIsBanned(agentId);
        }
        _;
    }

    modifier fullAccessCheckWithAgent(address account, uint256 agentId) {
        _requireAgentId(account, agentId);
        if (moderation.isAddressBanned(account)) revert AddressIsBanned(account);
        if (moderation.isAgentBanned(agentId)) revert AgentIdIsBanned(agentId);
        _;
    }

    function isAddressBanned(address account) external view returns (bool) {
        return moderation.isAddressBanned(account);
    }

    function isAgentIdBanned(uint256 agentId) external view returns (bool) {
        return moderation.isAgentBanned(agentId);
    }

    function isBanned(address account, uint256 agentId) external view returns (bool) {
        return moderation.isProviderBanned(account, agentId);
    }

    function checkAccess(address account) external view returns (bool canAccess, string memory reason) {
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

        if (moderation.isAddressBanned(account)) {
            return (false, "Address is banned");
        }

        return (true, "");
    }

    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    function setIdentityRegistry(address _identityRegistry) external virtual override onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistrySet(oldRegistry, _identityRegistry);
        moderation.setIdentityRegistry(_identityRegistry);
    }

    function getBanManager() external view returns (address) {
        return moderation.banManager;
    }
}
