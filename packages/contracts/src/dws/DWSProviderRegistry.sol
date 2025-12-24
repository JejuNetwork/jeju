// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {IDWSTypes} from "./IDWSTypes.sol";

interface IMultiServiceStakeManager {
    function positions(address user) external view returns (
        uint256 totalStaked,
        uint256 stakedAt,
        uint256 unbondingAmount,
        uint256 unbondingStartTime,
        bool isActive,
        bool isFrozen
    );
}

/**
 * @title DWSProviderRegistry
 * @notice Unified registry for ALL DWS service providers
 * @dev Single registry for Compute, Storage, CDN, Database providers
 */
contract DWSProviderRegistry is IDWSTypes, Ownable, Pausable, ReentrancyGuard {
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;

    // ============================================================================
    // State
    // ============================================================================

    ERC8004ProviderMixin.Data public erc8004;
    ModerationMixin.Data public moderation;
    IMultiServiceStakeManager public stakeManager;

    // Unified provider registry
    mapping(address => ProviderInfo) public providers;
    
    // Providers by service type
    mapping(ServiceType => address[]) public providersByService;
    mapping(address => mapping(ServiceType => bool)) public providesService;

    // Resource assignments
    mapping(bytes32 => ResourceAssignment) public assignments;

    // Configuration per service type
    mapping(ServiceType => uint256) public minStakeByService;
    uint256 public heartbeatTimeout = 5 minutes;

    address public treasury;

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        address _stakeManager,
        address _treasury
    ) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            erc8004.setIdentityRegistry(_identityRegistry);
            moderation.setIdentityRegistry(_identityRegistry);
        }
        if (_banManager != address(0)) {
            moderation.setBanManager(_banManager);
        }
        if (_stakeManager != address(0)) {
            stakeManager = IMultiServiceStakeManager(_stakeManager);
        }
        treasury = _treasury;

        // Default minimum stakes
        minStakeByService[ServiceType.Compute] = 1_000 ether;
        minStakeByService[ServiceType.Storage] = 1_000 ether;
        minStakeByService[ServiceType.CDN] = 500 ether;
        minStakeByService[ServiceType.Database] = 5_000 ether;  // Higher for DB (more responsibility)
        minStakeByService[ServiceType.Inference] = 2_000 ether;
    }

    // ============================================================================
    // Provider Registration
    // ============================================================================

    /**
     * @notice Register as a provider for one or more services
     * @param services Array of service types to provide
     * @param endpoint HTTP/HTTPS endpoint
     * @param attestationHash TEE attestation hash
     */
    function registerProvider(
        ServiceType[] calldata services,
        string calldata endpoint,
        bytes32 attestationHash
    ) external payable nonReentrant whenNotPaused {
        require(services.length > 0, "No services specified");
        require(!providers[msg.sender].active, "Already registered");
        moderation.requireNotBanned(msg.sender);

        // Calculate required stake (max of all services)
        uint256 requiredStake = 0;
        for (uint256 i = 0; i < services.length; i++) {
            if (minStakeByService[services[i]] > requiredStake) {
                requiredStake = minStakeByService[services[i]];
            }
        }

        // Check effective stake (direct + unified staking)
        uint256 effectiveStake = msg.value;
        if (address(stakeManager) != address(0)) {
            (uint256 totalStaked,,,,bool isActive,bool isFrozen) = stakeManager.positions(msg.sender);
            if (isActive && !isFrozen) {
                effectiveStake += totalStaked;
            }
        }
        if (effectiveStake < requiredStake) revert InsufficientStake();

        // Create provider record
        providers[msg.sender] = ProviderInfo({
            provider: msg.sender,
            services: services,
            endpoint: endpoint,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            active: true,
            slashedAmount: 0,
            rewardsClaimed: 0,
            agentId: 0,
            attestationHash: attestationHash
        });

        // Track by service
        for (uint256 i = 0; i < services.length; i++) {
            providersByService[services[i]].push(msg.sender);
            providesService[msg.sender][services[i]] = true;
        }

        emit ProviderRegistered(msg.sender, services, endpoint, effectiveStake, 0);
    }

    /**
     * @notice Register provider with ERC-8004 agent
     */
    function registerProviderWithAgent(
        ServiceType[] calldata services,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId
    ) external payable nonReentrant whenNotPaused {
        require(services.length > 0, "No services specified");
        require(!providers[msg.sender].active, "Already registered");
        
        erc8004.verifyAndLinkAgent(msg.sender, agentId);
        moderation.requireProviderNotBanned(msg.sender, agentId);

        // Calculate required stake
        uint256 requiredStake = 0;
        for (uint256 i = 0; i < services.length; i++) {
            if (minStakeByService[services[i]] > requiredStake) {
                requiredStake = minStakeByService[services[i]];
            }
        }

        uint256 effectiveStake = msg.value;
        if (address(stakeManager) != address(0)) {
            (uint256 totalStaked,,,,bool isActive,bool isFrozen) = stakeManager.positions(msg.sender);
            if (isActive && !isFrozen) {
                effectiveStake += totalStaked;
            }
        }
        if (effectiveStake < requiredStake) revert InsufficientStake();

        providers[msg.sender] = ProviderInfo({
            provider: msg.sender,
            services: services,
            endpoint: endpoint,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            active: true,
            slashedAmount: 0,
            rewardsClaimed: 0,
            agentId: agentId,
            attestationHash: attestationHash
        });

        for (uint256 i = 0; i < services.length; i++) {
            providersByService[services[i]].push(msg.sender);
            providesService[msg.sender][services[i]] = true;
        }

        emit ProviderRegistered(msg.sender, services, endpoint, effectiveStake, agentId);
    }

    /**
     * @notice Add additional services to existing provider
     */
    function addServices(ServiceType[] calldata newServices) external payable {
        require(providers[msg.sender].active, "Not registered");
        
        for (uint256 i = 0; i < newServices.length; i++) {
            if (!providesService[msg.sender][newServices[i]]) {
                providersByService[newServices[i]].push(msg.sender);
                providesService[msg.sender][newServices[i]] = true;
            }
        }

        // Update services array
        ServiceType[] memory allServices = new ServiceType[](providers[msg.sender].services.length + newServices.length);
        for (uint256 i = 0; i < providers[msg.sender].services.length; i++) {
            allServices[i] = providers[msg.sender].services[i];
        }
        for (uint256 i = 0; i < newServices.length; i++) {
            allServices[providers[msg.sender].services.length + i] = newServices[i];
        }
        providers[msg.sender].services = allServices;

        if (msg.value > 0) {
            providers[msg.sender].stakedAmount += msg.value;
        }
    }

    function addStake() external payable {
        if (!providers[msg.sender].active) revert ProviderNotActive();
        providers[msg.sender].stakedAmount += msg.value;
    }

    function heartbeat() external {
        if (!providers[msg.sender].active) revert ProviderNotActive();
        providers[msg.sender].lastHeartbeat = block.timestamp;
    }

    function updateEndpoint(string calldata endpoint) external {
        if (!providers[msg.sender].active) revert ProviderNotActive();
        providers[msg.sender].endpoint = endpoint;
    }

    function deregister() external nonReentrant {
        if (!providers[msg.sender].active) revert ProviderNotActive();
        providers[msg.sender].active = false;

        uint256 toReturn = providers[msg.sender].stakedAmount - providers[msg.sender].slashedAmount;
        if (toReturn > 0) {
            (bool success, ) = payable(msg.sender).call{value: toReturn}("");
            require(success, "Transfer failed");
        }
    }

    function slashProvider(address provider, uint256 amount, bytes32 reason) external onlyOwner {
        if (!providers[provider].active) revert ProviderNotActive();
        uint256 available = providers[provider].stakedAmount - providers[provider].slashedAmount;
        require(amount <= available, "Amount too high");

        providers[provider].slashedAmount += amount;
        (bool success, ) = payable(treasury).call{value: amount}("");
        require(success, "Slash transfer failed");

        emit ProviderSlashed(provider, amount, reason);
    }

    // ============================================================================
    // Resource Assignment
    // ============================================================================

    /**
     * @notice Assign providers to a resource
     * @param resourceId The resource ID
     * @param serviceType The type of service
     * @param count Number of providers needed
     */
    function assignProviders(
        bytes32 resourceId,
        ServiceType serviceType,
        uint256 count
    ) external returns (ResourceAssignment memory) {
        address[] memory active = getActiveProviders(serviceType);
        require(active.length >= count, "Not enough providers");

        // Select providers (simple round-robin - production would use VRF)
        address[] memory selected = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            selected[i] = active[i % active.length];
        }

        // First provider is primary
        address primary = selected[0];

        assignments[resourceId] = ResourceAssignment({
            resourceId: resourceId,
            serviceType: serviceType,
            providers: selected,
            primary: primary,
            assignedAt: block.timestamp,
            lastRotation: block.timestamp
        });

        emit ResourceAssigned(resourceId, selected, primary);
        return assignments[resourceId];
    }

    // ============================================================================
    // Views
    // ============================================================================

    function getProvider(address provider) external view returns (ProviderInfo memory) {
        return providers[provider];
    }

    function getAssignment(bytes32 resourceId) external view returns (ResourceAssignment memory) {
        return assignments[resourceId];
    }

    function getActiveProviders(ServiceType serviceType) public view returns (address[] memory) {
        address[] storage all = providersByService[serviceType];
        uint256 count = 0;
        
        for (uint256 i = 0; i < all.length; i++) {
            if (isProviderHealthy(all[i])) {
                count++;
            }
        }

        address[] memory active = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (isProviderHealthy(all[i])) {
                active[j++] = all[i];
            }
        }
        return active;
    }

    function isProviderHealthy(address provider) public view returns (bool) {
        return providers[provider].active &&
               block.timestamp - providers[provider].lastHeartbeat < heartbeatTimeout;
    }

    function getProviderEffectiveStake(address provider) public view returns (uint256) {
        uint256 stake = providers[provider].stakedAmount;
        if (address(stakeManager) != address(0)) {
            (uint256 totalStaked,,,,bool isActive,bool isFrozen) = stakeManager.positions(provider);
            if (isActive && !isFrozen) {
                stake += totalStaked;
            }
        }
        return stake;
    }

    function getProviderCount(ServiceType serviceType) external view returns (uint256) {
        return providersByService[serviceType].length;
    }

    function canProvide(address provider, ServiceType serviceType) external view returns (bool) {
        return providesService[provider][serviceType] && providers[provider].active;
    }

    // ============================================================================
    // Admin
    // ============================================================================

    function setMinStake(ServiceType serviceType, uint256 stake) external onlyOwner {
        minStakeByService[serviceType] = stake;
    }

    function setHeartbeatTimeout(uint256 timeout) external onlyOwner {
        heartbeatTimeout = timeout;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setStakeManager(address _stakeManager) external onlyOwner {
        stakeManager = IMultiServiceStakeManager(_stakeManager);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
