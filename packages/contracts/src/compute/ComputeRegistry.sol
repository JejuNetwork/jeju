// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

/**
 * @title ComputeRegistry
 * @notice Provider registry for all compute services (AI, database, training, etc.)
 *
 * Service Types:
 * - inference: AI model inference (LLM, vision, etc.)
 * - database: Decentralized SQL (CQL/CovenantSQL)
 * - training: Model training/fine-tuning
 * - storage: Compute-adjacent storage
 * - custom: User-defined compute services
 */
contract ComputeRegistry is ProviderRegistryBase, IComputeRegistry {
    /// @notice Service type constants
    bytes32 public constant SERVICE_INFERENCE = keccak256("inference");
    bytes32 public constant SERVICE_DATABASE = keccak256("database");
    bytes32 public constant SERVICE_TRAINING = keccak256("training");
    bytes32 public constant SERVICE_STORAGE = keccak256("storage");

    struct Provider {
        address owner;
        string name;
        string endpoint;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        bytes32 serviceType; // Primary service type
        bool active;
    }

    struct Capability {
        string model; // Model name or database type (e.g., "gpt-4", "covenantql")
        uint256 pricePerInputToken; // For inference: per token. For database: per query
        uint256 pricePerOutputToken; // For inference: per token. For database: per result row
        uint256 maxContextLength; // For inference: context. For database: max result size
        bool active;
    }

    mapping(address => Provider) public providers;
    mapping(address => Capability[]) private _capabilities;
    mapping(bytes32 => address[]) private _providersByService; // service type => providers

    event ProviderRegistered(
        address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId, bytes32 serviceType
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
    event ServiceTypeUpdated(address indexed provider, bytes32 oldType, bytes32 newType);

    error InvalidEndpoint();
    error InvalidName();
    error InvalidCapabilityIndex();
    error InvalidServiceType();

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake) {}

    /// @notice Register as an inference provider (default service type)
    function register(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        _registerWithService(name, endpoint, attestationHash, 0, SERVICE_INFERENCE);
    }

    /// @notice Register with specific service type (database, training, etc.)
    function registerWithService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        _registerWithService(name, endpoint, attestationHash, 0, serviceType);
    }

    /// @notice Register as database provider (CQL/CovenantSQL)
    function registerDatabaseProvider(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        _registerWithService(name, endpoint, attestationHash, 0, SERVICE_DATABASE);
    }

    function registerWithAgent(string calldata name, string calldata endpoint, bytes32 attestationHash, uint256 agentId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        _registerWithAgentAndService(name, endpoint, attestationHash, agentId, SERVICE_INFERENCE);
    }

    /// @notice Register with agent and specific service type
    function registerWithAgentAndService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        _registerWithAgentAndService(name, endpoint, attestationHash, agentId, serviceType);
    }

    function _registerWithService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (serviceType == bytes32(0)) revert InvalidServiceType();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, agentId, serviceType);
    }

    function _registerWithAgentAndService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (serviceType == bytes32(0)) revert InvalidServiceType();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, agentId, serviceType);
    }

    function _storeProviderData(
        address provider,
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        providers[provider] = Provider({
            owner: provider,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            serviceType: serviceType,
            active: true
        });

        _providersByService[serviceType].push(provider);
        emit ProviderRegistered(provider, name, endpoint, attestationHash, msg.value, agentId, serviceType);
    }

    function _onProviderRegistered(address provider, uint256, uint256) internal view override {
        if (providers[provider].registeredAt != 0) {
            revert ProviderAlreadyRegistered();
        }
    }

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

    function deactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    function reactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }

    function addStake() external payable nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        if (provider.active && provider.stake - amount < minProviderStake) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

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

    function setCapabilityActive(uint256 index, bool active) external {
        if (index >= _capabilities[msg.sender].length) revert InvalidCapabilityIndex();
        _capabilities[msg.sender][index].active = active;
        emit CapabilityUpdated(msg.sender, index, active);
    }

    function getProvider(address addr) external view returns (Provider memory) {
        return providers[addr];
    }

    function getCapabilities(address addr) external view returns (Capability[] memory) {
        return _capabilities[addr];
    }

    function isActive(address addr) external view returns (bool) {
        Provider storage provider = providers[addr];
        return provider.registeredAt != 0 && provider.active;
    }

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

    function getProviderStake(address addr) external view returns (uint256) {
        return providers[addr].stake;
    }

    function isVerifiedAgent(address addr) external view returns (bool) {
        uint256 agentId = providers[addr].agentId;
        if (agentId == 0) return false;
        return this.hasValidAgent(addr);
    }

    function getProviderAgentId(address provider) external view returns (uint256) {
        return providers[provider].agentId;
    }

    function getProviderServiceType(address provider) external view returns (bytes32) {
        return providers[provider].serviceType;
    }

    /// @notice Get all providers of a specific service type
    function getProvidersByService(bytes32 serviceType) external view returns (address[] memory) {
        return _providersByService[serviceType];
    }

    /// @notice Get active providers of a specific service type
    function getActiveProvidersByService(bytes32 serviceType) external view returns (address[] memory) {
        address[] storage allProviders = _providersByService[serviceType];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeProviders[idx++] = allProviders[i];
            }
        }
        return activeProviders;
    }

    /// @notice Get all database providers (CQL operators)
    function getDatabaseProviders() external view returns (address[] memory) {
        return _providersByService[SERVICE_DATABASE];
    }

    /// @notice Get active database providers
    function getActiveDatabaseProviders() external view returns (address[] memory) {
        address[] storage allProviders = _providersByService[SERVICE_DATABASE];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeProviders[idx++] = allProviders[i];
            }
        }
        return activeProviders;
    }

    /// @notice Check if provider offers a specific service
    function isServiceProvider(address provider, bytes32 serviceType) external view returns (bool) {
        return providers[provider].serviceType == serviceType && providers[provider].active;
    }

    /// @notice Check if provider is a database provider
    function isDatabaseProvider(address provider) external view returns (bool) {
        return providers[provider].serviceType == SERVICE_DATABASE && providers[provider].active;
    }

    function version() external pure returns (string memory) {
        return "3.0.0-unified";
    }
}
