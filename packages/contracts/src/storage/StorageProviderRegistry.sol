// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {IStorageTypes} from "./IStorageTypes.sol";

/**
 * @title StorageProviderRegistry
 * @notice Registry for decentralized storage providers with ERC-8004 agent integration
 */
contract StorageProviderRegistry is IStorageTypes, ProviderRegistryBase {
    mapping(address => Provider) private _providers;
    mapping(address => ProviderCapacity) private _capacities;
    mapping(address => ProviderPricing) private _pricing;
    mapping(address => StorageTier[]) private _supportedTiers;
    mapping(address => uint256) private _replicationFactors;
    mapping(address => string) private _ipfsGateways;
    mapping(address => uint256) private _healthScores;
    mapping(address => uint256) private _avgLatencies;

    event ProviderRegistered(
        address indexed provider, string name, string endpoint, ProviderType providerType, uint256 agentId
    );
    event StorageProviderUpdated(address indexed provider);


    error InvalidProviderType();
    error InvalidEndpoint();
    error InvalidName();

    // ============ Constructor ============

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minProviderStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake) {}

    function register(string calldata name, string calldata endpoint, uint8 providerType, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (providerType > uint8(ProviderType.HYBRID)) revert InvalidProviderType();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, name, endpoint, ProviderType(providerType), attestationHash, 0);
    }

    function registerWithAgent(
        string calldata name,
        string calldata endpoint,
        uint8 providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) external payable nonReentrant whenNotPaused {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (providerType > uint8(ProviderType.HYBRID)) revert InvalidProviderType();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, name, endpoint, ProviderType(providerType), attestationHash, agentId);
    }

    function _storeProviderData(
        address provider,
        string calldata name,
        string calldata endpoint,
        ProviderType providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) internal {
        _providers[provider] = Provider({
            owner: provider,
            name: name,
            endpoint: endpoint,
            providerType: providerType,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            active: true,
            verified: false
        });

        _supportedTiers[provider].push(StorageTier.HOT);
        _supportedTiers[provider].push(StorageTier.WARM);
        _supportedTiers[provider].push(StorageTier.COLD);
        _replicationFactors[provider] = 1;

        emit ProviderRegistered(provider, name, endpoint, providerType, agentId);
    }

    /**
     * @dev Hook called by base contract during registration
     */
    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal override {
        if (_providers[provider].registeredAt != 0) {
            revert ProviderAlreadyRegistered();
        }
        // Provider data will be stored by _storeProviderData after this hook
    }

    /**
     * @notice Link an existing provider to an ERC-8004 agent
     * @param agentId ERC-8004 agent ID to link
     */
    function linkAgent(uint256 agentId) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        if (_providers[msg.sender].agentId != 0) revert ProviderAlreadyRegistered(); // Already linked

        // Use library function to verify and link agent
        ERC8004ProviderMixin.verifyAndLinkAgent(erc8004, msg.sender, agentId);
        _providers[msg.sender].agentId = agentId;
    }

    // ============ Updates ============

    function updateEndpoint(string calldata endpoint) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        _providers[msg.sender].endpoint = endpoint;
        emit StorageProviderUpdated(msg.sender);
    }

    function updateCapacity(uint256 totalCapacityGB, uint256 usedCapacityGB) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();
        if (totalCapacityGB < usedCapacityGB) revert InvalidProviderType();

        _capacities[msg.sender] = ProviderCapacity({
            totalCapacityGB: totalCapacityGB,
            usedCapacityGB: usedCapacityGB,
            availableCapacityGB: totalCapacityGB - usedCapacityGB,
            reservedCapacityGB: 0
        });

        emit StorageProviderUpdated(msg.sender);
    }

    function updatePricing(uint256 pricePerGBMonth, uint256 retrievalPricePerGB, uint256 uploadPricePerGB) external {
        if (_providers[msg.sender].registeredAt == 0) revert ProviderNotRegistered();

        _pricing[msg.sender] = ProviderPricing({
            pricePerGBMonth: pricePerGBMonth,
            minStoragePeriodDays: 1,
            maxStoragePeriodDays: 365,
            retrievalPricePerGB: retrievalPricePerGB,
            uploadPricePerGB: uploadPricePerGB
        });

        emit StorageProviderUpdated(msg.sender);
    }

    function deactivate() external {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    function reactivate() external {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }


    function addStake() external payable nonReentrant {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = _providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.stake < amount) revert InsufficientStake(provider.stake, amount);
        if (provider.stake - amount < minProviderStake && provider.active) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }


    function getProvider(address provider) external view returns (Provider memory) {
        return _providers[provider];
    }

    function getStorageProviderInfo(address provider) external view returns (IStorageTypes.StorageProviderInfo memory) {
        return IStorageTypes.StorageProviderInfo({
            provider: _providers[provider],
            capacity: _capacities[provider],
            pricing: _pricing[provider],
            supportedTiers: _supportedTiers[provider],
            replicationFactor: _replicationFactors[provider],
            ipfsGateway: _ipfsGateways[provider],
            healthScore: _healthScores[provider],
            avgLatencyMs: _avgLatencies[provider]
        });
    }

    function isActive(address provider) external view returns (bool) {
        return _providers[provider].active;
    }

    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].active) {
                activeCount++;
            }
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].active) {
                active[j++] = providerList[i];
            }
        }

        return active;
    }

    function getProviderStake(address provider) external view returns (uint256) {
        return _providers[provider].stake;
    }

    function getSupportedTiers(address provider) external view returns (StorageTier[] memory) {
        return _supportedTiers[provider];
    }

    function getProviderCapacity(address provider) external view returns (ProviderCapacity memory) {
        return _capacities[provider];
    }

    function getProviderPricing(address provider) external view returns (ProviderPricing memory) {
        return _pricing[provider];
    }


    function verifyProvider(address provider) external onlyOwner {
        _providers[provider].verified = true;
    }

    function setHealthScore(address provider, uint256 score) external onlyOwner {
        if (score > 100) revert InvalidProviderType();
        _healthScores[provider] = score;
    }

    function setAvgLatency(address provider, uint256 latencyMs) external onlyOwner {
        _avgLatencies[provider] = latencyMs;
    }

    function setIpfsGateway(address provider, string calldata gateway) external {
        if (msg.sender != provider && msg.sender != owner()) revert ProviderNotRegistered();
        _ipfsGateways[provider] = gateway;
    }

    function getAgentLinkedProviders() external view returns (address[] memory) {
        uint256 linkedCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].agentId > 0) {
                linkedCount++;
            }
        }

        address[] memory linked = new address[](linkedCount);
        uint256 j = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].agentId > 0) {
                linked[j++] = providerList[i];
            }
        }

        return linked;
    }
}
