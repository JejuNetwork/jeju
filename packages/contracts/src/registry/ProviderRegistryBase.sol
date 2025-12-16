// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC8004ProviderMixin} from "./ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";

/**
 * @title ProviderRegistryBase
 * @author Jeju Network
 * @notice Base contract for provider registries with standardized ERC-8004 and moderation integration
 * @dev Provides common functionality for all provider registries:
 *      - Provider registration with optional ERC-8004 agent linking
 *      - Staking management
 *      - Active/inactive status management
 *      - Standardized ban checking
 *      - Standardized agent discovery
 *
 * Child contracts should:
 * 1. Define their Provider struct (must include: owner, registeredAt, agentId, active, stake)
 * 2. Implement _registerInternal() to create provider-specific data
 * 3. Override _validateRegistration() for provider-specific validation
 * 4. Override _onProviderRegistered() for provider-specific logic
 *
 * Usage:
 * ```solidity
 * contract ComputeProviderRegistry is ProviderRegistryBase {
 *     struct Provider {
 *         address owner;
 *         string name;
 *         string endpoint;
 *         bytes32 attestationHash;
 *         uint256 stake;
 *         uint256 registeredAt;
 *         uint256 agentId;
 *         bool active;
 *     }
 *
 *     mapping(address => Provider) public providers;
 *
 *     function register(...) external payable {
 *         _registerProvider(msg.sender, ...);
 *     }
 * }
 * ```
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
        }
        if (_banManager != address(0)) {
            moderation.setBanManager(_banManager);
        }
        minProviderStake = _minProviderStake;
    }

    // ============ Registration Functions ============

    /**
     * @notice Register as a provider (without ERC-8004 agent)
     * @dev Child contracts should call this from their register() function
     */
    function _registerProviderWithoutAgent(address provider) internal {
        erc8004.requireAgentIfNeeded(0);
        moderation.requireNotBanned(provider);
        _registerProviderInternal(provider, 0);
    }

    /**
     * @notice Register as a provider with ERC-8004 agent verification
     * @param provider Provider address
     * @param agentId ERC-8004 agent ID
     * @dev Child contracts should call this from their registerWithAgent() function
     */
    function _registerProviderWithAgent(address provider, uint256 agentId) internal {
        erc8004.verifyAndLinkAgent(provider, agentId);
        moderation.requireProviderNotBanned(provider, agentId);
        _registerProviderInternal(provider, agentId);
    }

    /**
     * @dev Internal registration logic - validates stake and calls child hook
     */
    function _registerProviderInternal(address provider, uint256 agentId) internal {
        // Validate stake
        if (msg.value < minProviderStake) {
            revert InsufficientStake(msg.value, minProviderStake);
        }

        // Call child contract hook to store provider data
        // Child contract should check for duplicates and store provider struct
        _onProviderRegistered(provider, agentId, msg.value);

        // Add to provider list (only if not already registered)
        // Child contract's _onProviderRegistered should revert if already registered
        providerList.push(provider);
        providerCount++;

        emit ProviderRegistered(provider, agentId, msg.value, block.timestamp);
    }

    /**
     * @dev Hook for child contracts to store provider data and validate
     * @param provider Provider address
     * @param agentId Agent ID (0 if not linked)
     * @param stake Stake amount
     * @dev Child contracts must:
     *      - Check if provider already registered (revert if yes)
     *      - Store provider struct with all provider-specific fields
     *      - Set agentId in provider struct
     */
    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal virtual;

    /**
     * @dev Validate registration parameters - override in child contracts
     * @dev Currently unused - kept for future extensibility
     * @dev Child contracts can override for provider-specific validation
     */
    function _validateRegistration(address provider, uint256 agentId) internal view virtual {
        // Child contracts can override for provider-specific validation
        // Currently not called - validation happens in child contract register() functions
    }

    // ============ Provider Management ============

    /**
     * @notice Deactivate provider (can reactivate later)
     * @dev Child contracts should override to update their provider struct
     * @dev Base provides moderation check - child should call super and update active status
     */
    function deactivateProvider(address provider) external virtual {
        // Child contracts must implement
        // Should check: provider exists, is active, caller is provider or owner
        // Should update: provider.active = false
        // Should emit: ProviderDeactivated(provider)
    }

    /**
     * @notice Reactivate a deactivated provider
     * @dev Child contracts should override to update their provider struct
     * @dev Base provides moderation check - child should call super and update active status
     */
    function reactivateProvider(address provider) external virtual {
        // Child contracts must implement
        // Should check: provider exists, is not active, stake >= minProviderStake
        // Should update: provider.active = true
        // Should emit: ProviderReactivated(provider)
    }

    // ============ Staking Management ============

    /**
     * @notice Add more stake to provider
     * @dev Child contracts should override to update their provider struct
     * @dev Base validates - child should update provider.stake
     */
    function addStake(address provider) external payable virtual {
        // Child contracts must implement
        // Should check: provider exists, caller is provider
        // Should update: provider.stake += msg.value
        // Should emit: StakeAdded(provider, msg.value, provider.stake)
    }

    /**
     * @notice Withdraw stake (provider must be deactivated and stake above minimum)
     * @param provider Provider address
     * @param amount Amount to withdraw
     * @dev Child contracts should override to update their provider struct
     * @dev Base validates minimum - child should update provider.stake and transfer
     */
    function withdrawStake(address provider, uint256 amount) external virtual {
        // Child contracts must implement
        // Should check: provider exists, caller is provider, amount <= provider.stake
        // Should check: if active, (provider.stake - amount) >= minProviderStake
        // Should update: provider.stake -= amount
        // Should transfer: amount to provider
        // Should emit: StakeWithdrawn(provider, amount)
    }

    // ============ View Functions ============

    /**
     * @notice Get provider address for an agent ID
     * @param agentId Agent ID
     * @return provider Provider address (address(0) if not linked)
     */
    function getProviderByAgent(uint256 agentId) external view returns (address provider) {
        return erc8004.getProviderByAgent(agentId);
    }

    /**
     * @notice Get agent ID for a provider
     * @param provider Provider address
     * @return agentId Agent ID (0 if not linked)
     */
    function getAgentByProvider(address provider) external view returns (uint256 agentId) {
        return erc8004.getAgentByProvider(provider);
    }

    /**
     * @notice Check if provider has a valid agent (or agent not required)
     * @param provider Provider address
     * @return valid True if provider has valid agent or agent not required
     */
    function hasValidAgent(address provider) external view returns (bool valid) {
        return erc8004.hasValidAgent(provider);
    }

    /**
     * @notice Check if provider is banned
     * @param provider Provider address
     * @return banned True if provider is banned
     */
    function isProviderBanned(address provider) external view returns (bool banned) {
        uint256 agentId = erc8004.getAgentByProvider(provider);
        return moderation.isProviderBanned(provider, agentId);
    }

    /**
     * @notice Get all active providers
     * @return activeProviders Array of active provider addresses
     * @dev Child contracts should override to filter by their active status
     */
    function getActiveProviders() external view virtual returns (address[] memory activeProviders) {
        // Default implementation returns all providers
        // Child contracts should override to filter by active status
        return providerList;
    }

    /**
     * @notice Get total provider count
     * @return count Total number of registered providers
     */
    function getProviderCount() external view returns (uint256 count) {
        return providerCount;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update minimum provider stake
     * @param newMinStake New minimum stake amount
     */
    function setMinProviderStake(uint256 newMinStake) external onlyOwner {
        uint256 oldStake = minProviderStake;
        minProviderStake = newMinStake;
        emit MinStakeUpdated(oldStake, newMinStake);
    }

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry New registry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        erc8004.setIdentityRegistry(_identityRegistry);
        moderation.setIdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Set whether agent registration is required
     * @param required True to require agent registration
     */
    function setRequireAgentRegistration(bool required) external onlyOwner {
        erc8004.setRequireAgentRegistration(required);
    }

    /**
     * @notice Set the BanManager contract
     * @param _banManager New BanManager address
     */
    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    /**
     * @notice Pause/unpause the registry
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
