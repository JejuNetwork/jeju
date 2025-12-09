// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStorageTypes} from "./IStorageTypes.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title StorageProviderRegistry
 * @author Jeju Network
 * @notice Registry for decentralized storage providers with ERC-8004 agent integration
 * @dev Providers stake ETH, set pricing, and manage capacity. Optional agent linking.
 * 
 * ERC-8004 Integration:
 * - Providers can link to an ERC-8004 agent for identity verification
 * - Agent ownership is verified on-chain via IdentityRegistry
 * - Consumers can discover providers by agentId
 * - Agent reputation feeds into provider trust scores
 */
contract StorageProviderRegistry is IStorageTypes, Ownable, ReentrancyGuard {
    
    // ============ State ============
    
    mapping(address => Provider) private _providers;
    mapping(address => ProviderCapacity) private _capacities;
    mapping(address => ProviderPricing) private _pricing;
    mapping(address => StorageTier[]) private _supportedTiers;
    mapping(address => uint256) private _replicationFactors;
    mapping(address => string) private _ipfsGateways;
    mapping(address => uint256) private _healthScores;
    mapping(address => uint256) private _avgLatencies;
    mapping(uint256 => address) private _agentToProvider;
    
    address[] private _providerList;
    
    /// @notice ERC-8004 Identity Registry for agent verification
    IIdentityRegistry public identityRegistry;
    
    /// @notice Whether to require ERC-8004 agent registration
    bool public requireAgentRegistration;
    
    uint256 public minProviderStake = 0.1 ether;
    uint256 public providerCount;
    
    // ============ Errors ============
    
    error InvalidAgentId();
    error NotAgentOwner();
    error AgentAlreadyLinked();
    error AgentRequired();
    
    // ============ Events ============
    
    event ProviderRegistered(address indexed provider, string name, string endpoint, ProviderType providerType, uint256 agentId);
    event ProviderUpdated(address indexed provider);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);
    event StakeAdded(address indexed provider, uint256 amount);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentLinked(address indexed provider, uint256 indexed agentId);
    
    // ============ Constructor ============
    
    constructor(address _owner, address _identityRegistry) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }
    
    // ============ Registration ============
    
    /**
     * @notice Register as a storage provider (without ERC-8004 agent)
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param providerType Storage backend type (IPFS, Cloud, etc.)
     * @param attestationHash Hash of hardware/TEE attestation
     */
    function register(
        string calldata name,
        string calldata endpoint,
        uint8 providerType,
        bytes32 attestationHash
    ) external payable nonReentrant {
        if (requireAgentRegistration) revert AgentRequired();
        
        _registerInternal(name, endpoint, providerType, attestationHash, 0);
    }
    
    /**
     * @notice Register as a storage provider with ERC-8004 agent verification
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param providerType Storage backend type
     * @param attestationHash Hash of hardware attestation
     * @param agentId ERC-8004 agent ID for identity verification
     * @dev Verifies agent ownership via IdentityRegistry
     */
    function registerWithAgent(
        string calldata name,
        string calldata endpoint,
        uint8 providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) external payable nonReentrant {
        // Verify ERC-8004 agent ownership
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (_agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();
        
        _registerInternal(name, endpoint, providerType, attestationHash, agentId);
        _agentToProvider[agentId] = msg.sender;
        
        emit AgentLinked(msg.sender, agentId);
    }
    
    /**
     * @dev Internal registration logic
     */
    function _registerInternal(
        string calldata name,
        string calldata endpoint,
        uint8 providerType,
        bytes32 attestationHash,
        uint256 agentId
    ) internal {
        require(msg.value >= minProviderStake, "Insufficient stake");
        require(_providers[msg.sender].registeredAt == 0, "Already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(endpoint).length > 0, "Endpoint required");
        
        _providers[msg.sender] = Provider({
            owner: msg.sender,
            name: name,
            endpoint: endpoint,
            providerType: ProviderType(providerType),
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            active: true,
            verified: false
        });
        
        _providerList.push(msg.sender);
        providerCount++;
        
        // Default supported tiers
        _supportedTiers[msg.sender].push(StorageTier.HOT);
        _supportedTiers[msg.sender].push(StorageTier.WARM);
        _supportedTiers[msg.sender].push(StorageTier.COLD);
        
        _replicationFactors[msg.sender] = 1;
        
        emit ProviderRegistered(msg.sender, name, endpoint, ProviderType(providerType), agentId);
    }
    
    /**
     * @notice Link an existing provider to an ERC-8004 agent
     * @param agentId ERC-8004 agent ID to link
     */
    function linkAgent(uint256 agentId) external {
        require(_providers[msg.sender].registeredAt > 0, "Not registered");
        require(_providers[msg.sender].agentId == 0, "Already linked to agent");
        
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (_agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();
        
        _providers[msg.sender].agentId = agentId;
        _agentToProvider[agentId] = msg.sender;
        
        emit AgentLinked(msg.sender, agentId);
    }
    
    // ============ Updates ============
    
    function updateEndpoint(string calldata endpoint) external {
        require(_providers[msg.sender].registeredAt > 0, "Not registered");
        _providers[msg.sender].endpoint = endpoint;
        emit ProviderUpdated(msg.sender);
    }
    
    function updateCapacity(uint256 totalCapacityGB, uint256 usedCapacityGB) external {
        require(_providers[msg.sender].registeredAt > 0, "Not registered");
        require(totalCapacityGB >= usedCapacityGB, "Invalid capacity");
        
        _capacities[msg.sender] = ProviderCapacity({
            totalCapacityGB: totalCapacityGB,
            usedCapacityGB: usedCapacityGB,
            availableCapacityGB: totalCapacityGB - usedCapacityGB,
            reservedCapacityGB: 0
        });
        
        emit ProviderUpdated(msg.sender);
    }
    
    function updatePricing(
        uint256 pricePerGBMonth,
        uint256 retrievalPricePerGB,
        uint256 uploadPricePerGB
    ) external {
        require(_providers[msg.sender].registeredAt > 0, "Not registered");
        
        _pricing[msg.sender] = ProviderPricing({
            pricePerGBMonth: pricePerGBMonth,
            minStoragePeriodDays: 1,
            maxStoragePeriodDays: 365,
            retrievalPricePerGB: retrievalPricePerGB,
            uploadPricePerGB: uploadPricePerGB
        });
        
        emit ProviderUpdated(msg.sender);
    }
    
    function deactivate() external {
        require(_providers[msg.sender].active, "Not active");
        _providers[msg.sender].active = false;
        emit ProviderDeactivated(msg.sender);
    }
    
    function reactivate() external {
        require(!_providers[msg.sender].active, "Already active");
        require(_providers[msg.sender].stake >= minProviderStake, "Insufficient stake");
        _providers[msg.sender].active = true;
        emit ProviderReactivated(msg.sender);
    }
    
    // ============ Staking ============
    
    function addStake() external payable {
        require(_providers[msg.sender].registeredAt > 0, "Not registered");
        _providers[msg.sender].stake += msg.value;
        emit StakeAdded(msg.sender, msg.value);
    }
    
    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = _providers[msg.sender];
        require(provider.stake >= amount, "Insufficient stake");
        require(provider.stake - amount >= minProviderStake || !provider.active, "Would fall below minimum");
        
        provider.stake -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit StakeWithdrawn(msg.sender, amount);
    }
    
    // ============ View Functions ============
    
    function getProvider(address provider) external view returns (Provider memory) {
        return _providers[provider];
    }
    
    function getProviderInfo(address provider) external view returns (ProviderInfo memory) {
        return ProviderInfo({
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
    
    function getActiveProviders() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].active) {
                activeCount++;
            }
        }
        
        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].active) {
                active[j++] = _providerList[i];
            }
        }
        
        return active;
    }
    
    function getProviderStake(address provider) external view returns (uint256) {
        return _providers[provider].stake;
    }
    
    function getProviderCount() external view returns (uint256) {
        return providerCount;
    }
    
    function getProviderByAgent(uint256 agentId) external view returns (address) {
        return _agentToProvider[agentId];
    }
    
    // ============ Admin ============
    
    function setMinProviderStake(uint256 _minStake) external onlyOwner {
        minProviderStake = _minStake;
    }
    
    function verifyProvider(address provider) external onlyOwner {
        _providers[provider].verified = true;
    }
    
    function setHealthScore(address provider, uint256 score) external onlyOwner {
        require(score <= 100, "Score must be <= 100");
        _healthScores[provider] = score;
    }

    function setAvgLatency(address provider, uint256 latencyMs) external onlyOwner {
        _avgLatencies[provider] = latencyMs;
    }
    
    function setIpfsGateway(address provider, string calldata gateway) external {
        require(msg.sender == provider || msg.sender == owner(), "Not authorized");
        _ipfsGateways[provider] = gateway;
    }
    
    /**
     * @notice Set the ERC-8004 Identity Registry address
     * @param _identityRegistry New registry address (address(0) to disable)
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }
    
    /**
     * @notice Set whether agent registration is required
     * @param required True to require ERC-8004 agent for registration
     */
    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
    }
    
    /**
     * @notice Check if a provider is linked to a valid agent
     * @param provider Provider address to check
     * @return valid True if provider has valid agent or agent not required
     */
    function hasValidAgent(address provider) external view returns (bool valid) {
        uint256 agentId = _providers[provider].agentId;
        if (agentId == 0) return !requireAgentRegistration;
        if (address(identityRegistry) == address(0)) return true;
        
        // Check agent exists (ownerOf returns address(0) if not)
        return identityRegistry.agentExists(agentId);
    }
    
    /**
     * @notice Get all providers linked to ERC-8004 agents
     * @return providers Array of provider addresses with linked agents
     */
    function getAgentLinkedProviders() external view returns (address[] memory) {
        uint256 linkedCount = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].agentId > 0) {
                linkedCount++;
            }
        }
        
        address[] memory linked = new address[](linkedCount);
        uint256 j = 0;
        for (uint256 i = 0; i < _providerList.length; i++) {
            if (_providers[_providerList[i]].agentId > 0) {
                linked[j++] = _providerList[i];
            }
        }
        
        return linked;
    }
}

