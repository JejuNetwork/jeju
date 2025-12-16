// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";

/**
 * @title ComputeRegistry
 * @author Jeju Network
 * @notice Provider registry for decentralized AI compute marketplace
 * @dev Integrates with ERC-8004 IdentityRegistry for agent verification
 *      Inherits from ProviderRegistryBase for standardized ERC-8004 and moderation integration
 *
 * Key Features:
 * - Provider registration with staking
 * - Hardware attestation support (TEE, GPU)
 * - Capability declaration (models, pricing)
 * - ERC-8004 agent integration for identity verification
 * - Endpoint management and discovery
 *
 * Providers can register with:
 * - ETH stake (minimum required for security)
 * - Hardware attestation hash (TEE/GPU verification)
 * - Service endpoint URL
 * - Model capabilities with pricing
 *
 * @custom:security-contact security@jeju.network
 */
contract ComputeRegistry is ProviderRegistryBase {
    // ============ Structs ============

    struct Provider {
        address owner;
        string name;
        string endpoint;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        bool active;
    }

    struct Capability {
        string model;
        uint256 pricePerInputToken;
        uint256 pricePerOutputToken;
        uint256 maxContextLength;
        bool active;
    }

    // ============ State Variables ============

    /// @notice Provider data by address
    mapping(address => Provider) public providers;

    /// @notice Provider capabilities (provider => capability[])
    mapping(address => Capability[]) private _capabilities;

    // ============ Events ============

    event ProviderRegistered(
        address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId
    );
    event ProviderUpdated(address indexed provider, string endpoint, bytes32 attestationHash);
    event CapabilityAdded(
        address indexed provider,
        string model,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken,
        uint256 maxContextLength
    );
    event CapabilityUpdated(address indexed provider, uint256 index, bool active);

    // ============ Errors ============

    error InvalidEndpoint();
    error InvalidName();
    error InvalidCapabilityIndex();

    // ============ Constructor ============

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake) {}

    // ============ Registration ============

    /**
     * @notice Register as a compute provider
     * @param name Provider display name
     * @param endpoint API endpoint URL (e.g., https://provider.example.com)
     * @param attestationHash Hash of hardware attestation (TEE/GPU proof)
     */
    function register(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, 0);
    }

    /**
     * @notice Register as a compute provider with ERC-8004 agent verification
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param attestationHash Hash of hardware attestation
     * @param agentId ERC-8004 agent ID for identity verification
     */
    function registerWithAgent(string calldata name, string calldata endpoint, bytes32 attestationHash, uint256 agentId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, agentId);
    }

    /**
     * @dev Store provider-specific data after base registration
     */
    function _storeProviderData(
        address provider,
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId
    ) internal {
        providers[provider] = Provider({
            owner: provider,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            active: true
        });

        emit ProviderRegistered(provider, name, endpoint, attestationHash, msg.value, agentId);
    }

    /**
     * @dev Hook called by base contract during registration
     */
    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal override {
        if (providers[provider].registeredAt != 0) {
            revert ProviderAlreadyRegistered();
        }
        // Provider data will be stored by _storeProviderData after this hook
    }

    // ============ Provider Management ============

    /**
     * @notice Update provider endpoint and attestation
     * @param endpoint New API endpoint URL
     * @param attestationHash New attestation hash (or 0x0 to keep current)
     */
    function updateEndpoint(string calldata endpoint, bytes32 attestationHash) external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        provider.endpoint = endpoint;
        if (attestationHash != bytes32(0)) {
            provider.attestationHash = attestationHash;
        }

        emit ProviderUpdated(msg.sender, endpoint, attestationHash);
    }

    /**
     * @notice Deactivate provider (can reactivate later)
     */
    function deactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate a deactivated provider
     */
    function reactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }

    // ============ Staking ============

    /**
     * @notice Add more stake to provider
     */
    function addStake() external payable nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    /**
     * @notice Withdraw stake (provider must be deactivated and stake above minimum)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        // If active, must maintain minimum stake
        if (provider.active && provider.stake - amount < minProviderStake) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Capabilities ============

    /**
     * @notice Add a model capability
     * @param model Model identifier (e.g., "llama-3.1-8b")
     * @param pricePerInputToken Price per input token in wei
     * @param pricePerOutputToken Price per output token in wei
     * @param maxContextLength Maximum context length supported
     */
    function addCapability(
        string calldata model,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken,
        uint256 maxContextLength
    ) external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        _capabilities[msg.sender].push(
            Capability({
                model: model,
                pricePerInputToken: pricePerInputToken,
                pricePerOutputToken: pricePerOutputToken,
                maxContextLength: maxContextLength,
                active: true
            })
        );

        emit CapabilityAdded(msg.sender, model, pricePerInputToken, pricePerOutputToken, maxContextLength);
    }

    /**
     * @notice Update capability active status
     * @param index Capability index
     * @param active New active status
     */
    function setCapabilityActive(uint256 index, bool active) external {
        if (index >= _capabilities[msg.sender].length) revert InvalidCapabilityIndex();
        _capabilities[msg.sender][index].active = active;
        emit CapabilityUpdated(msg.sender, index, active);
    }

    // ============ View Functions ============

    /**
     * @notice Get provider info
     */
    function getProvider(address addr) external view returns (Provider memory) {
        return providers[addr];
    }

    /**
     * @notice Get provider capabilities
     */
    function getCapabilities(address addr) external view returns (Capability[] memory) {
        return _capabilities[addr];
    }

    /**
     * @notice Check if provider is active
     */
    function isActive(address addr) external view returns (bool) {
        Provider storage provider = providers[addr];
        return provider.registeredAt != 0 && provider.active;
    }

    /**
     * @notice Get all active providers
     */
    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].active) {
                activeProviders[idx++] = providerList[i];
            }
        }

        return activeProviders;
    }

    /**
     * @notice Get provider stake
     */
    function getProviderStake(address addr) external view returns (uint256) {
        return providers[addr].stake;
    }

    /**
     * @notice Check if provider is a verified ERC-8004 agent
     */
    function isVerifiedAgent(address addr) external view returns (bool) {
        uint256 agentId = providers[addr].agentId;
        if (agentId == 0) return false;
        // Use inherited function from base contract (external, so use this.)
        return this.hasValidAgent(addr);
    }

    /**
     * @notice Get agent ID for a provider
     */
    function getProviderAgentId(address provider) external view returns (uint256) {
        return providers[provider].agentId;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0-base";
    }
}
