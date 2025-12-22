// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/// @title AgentGated
/// @notice Base contract requiring ERC-8004 agent registration for interactions
abstract contract AgentGated is Ownable {
    IIdentityRegistry public identityRegistry;
    bool public agentRequired = true;
    mapping(address => bool) public agentWhitelist;

    event IdentityRegistrySet(address indexed oldRegistry, address indexed newRegistry);
    event AgentRequirementSet(bool required);
    event AgentWhitelistUpdated(address indexed account, bool whitelisted);

    error NoIdentityRegistry();
    error AgentRequired();
    error AgentNotFound(address account);
    error AgentIsBanned(uint256 agentId);
    error NotAgentOwner(address account, uint256 agentId);

    constructor(address _identityRegistry, address _owner) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    modifier requiresAgent(address account) {
        _requireAgent(account);
        _;
    }

    modifier requiresAgentId(uint256 agentId) {
        _requireAgentId(msg.sender, agentId);
        _;
    }

    modifier requiresAgentOrWhitelisted(address account) {
        if (!agentWhitelist[account]) {
            _requireAgent(account);
        }
        _;
    }

    function _requireAgent(address account) internal view {
        if (!agentRequired) return;
        if (agentWhitelist[account]) return;
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();

        uint256 agentId = _findAgentForAddress(account);
        if (agentId == 0) revert AgentNotFound(account);
        if (_isAgentBanned(agentId)) revert AgentIsBanned(agentId);
    }

    function _requireAgentId(address account, uint256 agentId) internal view {
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();
        if (!identityRegistry.agentExists(agentId)) revert AgentNotFound(account);
        if (identityRegistry.ownerOf(agentId) != account) revert NotAgentOwner(account, agentId);
        if (_isAgentBanned(agentId)) revert AgentIsBanned(agentId);
    }

    function _findAgentForAddress(address account) internal view returns (uint256 agentId) {
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getAgentByOwner(address)", account)
        );
        
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }

        for (uint256 i = 1; i <= 100; i++) {
            try identityRegistry.ownerOf(i) returns (address owner) {
                if (owner == account) return i;
            } catch {}
        }

        return 0;
    }

    function _isAgentBanned(uint256 agentId) internal view returns (bool) {
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (success && data.length >= 224) {
            (,,,,,, bool banned) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        return false;
    }

    function hasValidAgent(address account) external view returns (bool) {
        if (!agentRequired) return true;
        if (agentWhitelist[account]) return true;
        if (address(identityRegistry) == address(0)) return false;

        uint256 agentId = _findAgentForAddress(account);
        if (agentId == 0) return false;

        return !_isAgentBanned(agentId);
    }

    function getAgentId(address account) external view returns (uint256) {
        if (address(identityRegistry) == address(0)) return 0;
        return _findAgentForAddress(account);
    }

    function isAgentRequired() external view returns (bool) {
        return agentRequired;
    }

    function setIdentityRegistry(address _identityRegistry) external virtual onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistrySet(oldRegistry, _identityRegistry);
    }

    function setAgentRequired(bool required) external onlyOwner {
        agentRequired = required;
        emit AgentRequirementSet(required);
    }

    function setAgentWhitelist(address account, bool whitelisted) external onlyOwner {
        agentWhitelist[account] = whitelisted;
        emit AgentWhitelistUpdated(account, whitelisted);
    }

    function setAgentWhitelistBatch(address[] calldata accounts, bool[] calldata whitelisted) external onlyOwner {
        require(accounts.length == whitelisted.length, "Length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            agentWhitelist[accounts[i]] = whitelisted[i];
            emit AgentWhitelistUpdated(accounts[i], whitelisted[i]);
        }
    }
}
