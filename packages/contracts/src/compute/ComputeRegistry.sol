// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";

/**
 * @title ComputeRegistry
 * @notice Provider registry for decentralized AI compute marketplace
 */
contract ComputeRegistry is ProviderRegistryBase {
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

    mapping(address => Provider) public providers;
    mapping(address => Capability[]) private _capabilities;

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

    error InvalidEndpoint();
    error InvalidName();
    error InvalidCapabilityIndex();

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake) {}

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

    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal override {
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

    function version() external pure returns (string memory) {
        return "2.0.0-base";
    }
}
