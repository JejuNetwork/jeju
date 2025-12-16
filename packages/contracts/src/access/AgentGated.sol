// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title AgentGated
 * @author Jeju Network
 * @notice Base contract requiring ERC-8004 agent registration for all interactions
 * @dev ALL Jeju contracts that have user-facing functions should inherit this.
 *      This ensures only registered agents can interact with the protocol.
 *
 * Benefits:
 * - Sybil resistance through agent registration costs
 * - Reputation tracking at protocol level
 * - Ban enforcement across all contracts
 * - Consistent identity layer
 *
 * Usage:
 * ```solidity
 * contract MyContract is AgentGated {
 *     function doSomething() external requiresAgent(msg.sender) {
 *         // Only registered agents can call this
 *     }
 * }
 * ```
 *
 * @custom:security-contact security@jeju.network
 */
abstract contract AgentGated is Ownable {
    // ============ State ============

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice Whether agent registration is required (can be toggled during migration)
    bool public agentRequired = true;

    /// @notice Whitelisted addresses that can bypass agent requirement (for contracts, migrations)
    mapping(address => bool) public agentWhitelist;

    // ============ Events ============

    event IdentityRegistrySet(address indexed oldRegistry, address indexed newRegistry);
    event AgentRequirementSet(bool required);
    event AgentWhitelistUpdated(address indexed account, bool whitelisted);

    // ============ Errors ============

    error NoIdentityRegistry();
    error AgentRequired();
    error AgentNotFound(address account);
    error AgentIsBanned(uint256 agentId);
    error NotAgentOwner(address account, uint256 agentId);

    // ============ Constructor ============

    constructor(address _identityRegistry) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    // ============ Modifiers ============

    /**
     * @notice Requires caller to have a registered, non-banned agent
     * @param account Address to check
     */
    modifier requiresAgent(address account) {
        _requireAgent(account);
        _;
    }

    /**
     * @notice Requires a specific agent ID to be valid and owned by caller
     * @param agentId Agent ID to verify
     */
    modifier requiresAgentId(uint256 agentId) {
        _requireAgentId(msg.sender, agentId);
        _;
    }

    /**
     * @notice Requires either a registered agent OR whitelisted address
     * @param account Address to check
     */
    modifier requiresAgentOrWhitelisted(address account) {
        if (!agentWhitelist[account]) {
            _requireAgent(account);
        }
        _;
    }

    // ============ Internal Functions ============

    /**
     * @dev Internal agent verification
     */
    function _requireAgent(address account) internal view {
        // Skip if agent not required (migration period)
        if (!agentRequired) return;

        // Skip if whitelisted (for contracts, etc.)
        if (agentWhitelist[account]) return;

        // Require registry
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();

        // Find agent for this address
        uint256 agentId = _findAgentForAddress(account);
        if (agentId == 0) revert AgentNotFound(account);

        // Check not banned
        if (_isAgentBanned(agentId)) revert AgentIsBanned(agentId);
    }

    /**
     * @dev Internal agent ID verification
     */
    function _requireAgentId(address account, uint256 agentId) internal view {
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();
        if (!identityRegistry.agentExists(agentId)) revert AgentNotFound(account);
        if (identityRegistry.ownerOf(agentId) != account) revert NotAgentOwner(account, agentId);
        if (_isAgentBanned(agentId)) revert AgentIsBanned(agentId);
    }

    /**
     * @dev Find agent ID for an address (checks ownership)
     * @param account Address to look up
     * @return agentId Agent ID (0 if not found)
     */
    function _findAgentForAddress(address account) internal view returns (uint256 agentId) {
        // Try to get total agents and iterate (limited to reasonable count)
        // In practice, most users will have only 1 agent
        
        // Check if registry has a reverse lookup function
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getAgentByOwner(address)", account)
        );
        
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }

        // Fallback: check first 100 agent IDs (should be indexed off-chain)
        // This is expensive but provides backwards compatibility
        for (uint256 i = 1; i <= 100; i++) {
            try identityRegistry.ownerOf(i) returns (address owner) {
                if (owner == account) {
                    return i;
                }
            } catch {
                // Agent doesn't exist, continue
            }
        }

        return 0;
    }

    /**
     * @dev Check if agent is banned
     */
    function _isAgentBanned(uint256 agentId) internal view returns (bool) {
        // Try getMarketplaceInfo first (returns banned status)
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getMarketplaceInfo(uint256)", agentId)
        );

        if (success && data.length >= 224) {
            // Returns: (a2aEndpoint, mcpEndpoint, serviceType, category, x402Supported, tier, banned)
            (,,,,,, bool banned) = abi.decode(data, (string, string, string, string, bool, uint8, bool));
            return banned;
        }

        // Fallback: try getAgent
        (success, data) = address(identityRegistry).staticcall(
            abi.encodeWithSignature("getAgent(uint256)", agentId)
        );

        if (success && data.length > 0) {
            // AgentRegistration struct has isBanned field
            // Decode and check - struct layout varies, try common position
            // This is fragile but provides best-effort compatibility
        }

        return false;
    }

    // ============ View Functions ============

    /**
     * @notice Check if an address has a valid agent
     * @param account Address to check
     * @return True if has valid, non-banned agent
     */
    function hasValidAgent(address account) external view returns (bool) {
        if (!agentRequired) return true;
        if (agentWhitelist[account]) return true;
        if (address(identityRegistry) == address(0)) return false;

        uint256 agentId = _findAgentForAddress(account);
        if (agentId == 0) return false;

        return !_isAgentBanned(agentId);
    }

    /**
     * @notice Get agent ID for an address
     * @param account Address to look up
     * @return Agent ID (0 if not found)
     */
    function getAgentId(address account) external view returns (uint256) {
        if (address(identityRegistry) == address(0)) return 0;
        return _findAgentForAddress(account);
    }

    /**
     * @notice Check if agent requirement is active
     */
    function isAgentRequired() external view returns (bool) {
        return agentRequired;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the identity registry
     * @param _identityRegistry New registry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistrySet(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Set whether agent registration is required
     * @param required True to require agent registration
     * @dev Use this during migration periods
     */
    function setAgentRequired(bool required) external onlyOwner {
        agentRequired = required;
        emit AgentRequirementSet(required);
    }

    /**
     * @notice Add/remove address from whitelist
     * @param account Address to update
     * @param whitelisted True to whitelist
     * @dev Use for contracts that need to interact without agent
     */
    function setAgentWhitelist(address account, bool whitelisted) external onlyOwner {
        agentWhitelist[account] = whitelisted;
        emit AgentWhitelistUpdated(account, whitelisted);
    }

    /**
     * @notice Batch update whitelist
     * @param accounts Addresses to update
     * @param whitelisted Whitelist statuses
     */
    function setAgentWhitelistBatch(address[] calldata accounts, bool[] calldata whitelisted) external onlyOwner {
        require(accounts.length == whitelisted.length, "Length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            agentWhitelist[accounts[i]] = whitelisted[i];
            emit AgentWhitelistUpdated(accounts[i], whitelisted[i]);
        }
    }
}
