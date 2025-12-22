// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ServiceRegistry
 * @notice Generic registry for service pricing, usage tracking, and volume discounts
 */
contract ServiceRegistry is Ownable, Pausable, ReentrancyGuard {
    struct ServiceConfig {
        string category; // Service category (e.g., "ai", "compute", "storage", "game")
        uint256 basePrice; // Base price in payment tokens (18 decimals)
        uint256 demandMultiplier; // Current demand multiplier (basis points)
        uint256 totalUsageCount; // Total times this service has been used
        uint256 totalRevenue; // Total revenue generated in payment tokens
        bool isActive; // Whether service is accepting requests
        uint256 minPrice; // Minimum price floor
        uint256 maxPrice; // Maximum price ceiling
        address provider; // Service provider address
        uint256 providerAgentId; // ERC-8004 agent ID (0 if not linked)
        uint256 registeredAt; // Block timestamp when registered
    }

    struct UserUsage {
        uint256 totalSpent;
        uint256 requestCount;
        uint256 lastUsedBlock;
        uint256 volumeDiscount;
    }

    struct UsageRecord {
        address user;
        string serviceName;
        uint256 cost;
        bytes32 sessionId;
        uint256 timestamp;
        uint256 blockNumber;
    }

    mapping(string => ServiceConfig) public services;
    mapping(address => mapping(string => UserUsage)) public userUsage;
    mapping(bytes32 => UsageRecord) public usageRecords;
    string[] public serviceNames;
    mapping(string => string[]) public servicesByCategory;
    uint256 public constant BASIS_POINTS = 10000;
    uint256[] public volumeTiers = [0, 1000 * 1e18, 5000 * 1e18, 10000 * 1e18, 50000 * 1e18];
    uint256[] public volumeDiscounts = [0, 500, 1000, 1500, 2000];
    address public treasury;
    IIdentityRegistry public identityRegistry;
    bool public requireAgentRegistration;
    mapping(uint256 => string[]) public agentServices;
    mapping(address => bool) public authorizedCallers;

    event ServiceRegistered(
        string indexed serviceName,
        string category,
        uint256 basePrice,
        uint256 minPrice,
        uint256 maxPrice,
        address provider
    );

    event ServicePriceUpdated(string indexed serviceName, uint256 oldPrice, uint256 newPrice);

    event ServiceUsageRecorded(
        address indexed user, string serviceName, uint256 cost, bytes32 sessionId, uint256 volumeDiscount
    );

    event DemandMultiplierUpdated(string indexed serviceName, uint256 oldMultiplier, uint256 newMultiplier);

    event VolumeTiersUpdated(uint256[] newTiers, uint256[] newDiscounts);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentRegistrationRequirementUpdated(bool required);


    error ServiceNotFound(string serviceName);
    error ServiceAlreadyExists(string serviceName);
    error ServiceNotActive(string serviceName);
    error InvalidPrice(uint256 price);
    error InvalidMultiplier(uint256 multiplier);
    error InvalidTierArrays();
    error UnauthorizedCaller();
    error InvalidTreasuryAddress();
    error InvalidCategory();
    error AgentRequired();
    error InvalidAgentId();

    constructor(address _treasury) Ownable(msg.sender) {
        if (_treasury == address(0)) revert InvalidTreasuryAddress();
        treasury = _treasury;
    }

    // ============ Service Management ============

    /**
     * @notice Register a new service type
     * @param serviceName Unique service name (e.g., "chat-completion", "game-server-hosting")
     * @param category Service category (e.g., "ai", "compute", "storage", "game", "api")
     * @param basePrice Base price in payment tokens
     * @param minPrice Minimum price floor
     * @param maxPrice Maximum price ceiling
     * @param provider Service provider address
     */
    function registerService(
        string calldata serviceName,
        string calldata category,
        uint256 basePrice,
        uint256 minPrice,
        uint256 maxPrice,
        address provider
    ) external onlyOwner {
        _registerServiceInternal(serviceName, category, basePrice, minPrice, maxPrice, provider, 0);
    }

    function registerServiceWithAgent(
        string calldata serviceName,
        string calldata category,
        uint256 basePrice,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 providerAgentId
    ) external onlyOwner {
        if (address(identityRegistry) == address(0)) revert InvalidTreasuryAddress();
        if (!identityRegistry.agentExists(providerAgentId)) revert InvalidAgentId();

        address provider = identityRegistry.ownerOf(providerAgentId);
        _registerServiceInternal(serviceName, category, basePrice, minPrice, maxPrice, provider, providerAgentId);

        // Track services by agent
        agentServices[providerAgentId].push(serviceName);
    }

    /**
     * @dev Internal function to register a service
     */
    function _registerServiceInternal(
        string calldata serviceName,
        string calldata category,
        uint256 basePrice,
        uint256 minPrice,
        uint256 maxPrice,
        address provider,
        uint256 providerAgentId
    ) internal {
        if (services[serviceName].basePrice != 0) revert ServiceAlreadyExists(serviceName);
        if (basePrice == 0 || minPrice == 0 || maxPrice == 0) revert InvalidPrice(0);
        if (basePrice < minPrice || basePrice > maxPrice) revert InvalidPrice(basePrice);
        if (bytes(category).length == 0) revert InvalidCategory();

        if (requireAgentRegistration && providerAgentId == 0) revert AgentRequired();

        services[serviceName] = ServiceConfig({
            category: category,
            basePrice: basePrice,
            demandMultiplier: BASIS_POINTS, // 100% = no multiplier
            totalUsageCount: 0,
            totalRevenue: 0,
            isActive: true,
            minPrice: minPrice,
            maxPrice: maxPrice,
            provider: provider,
            providerAgentId: providerAgentId,
            registeredAt: block.timestamp
        });

        serviceNames.push(serviceName);
        servicesByCategory[category].push(serviceName);

        emit ServiceRegistered(serviceName, category, basePrice, minPrice, maxPrice, provider);
    }

    /**
     * @notice Update service pricing
     * @param serviceName Service to update
     * @param newPrice New base price
     */
    function updateServicePrice(string calldata serviceName, uint256 newPrice) external onlyOwner {
        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        if (newPrice < service.minPrice || newPrice > service.maxPrice) revert InvalidPrice(newPrice);

        uint256 oldPrice = service.basePrice;
        service.basePrice = newPrice;

        emit ServicePriceUpdated(serviceName, oldPrice, newPrice);
    }

    function updateDemandMultiplier(string calldata serviceName, uint256 newMultiplier) external onlyOwner {
        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        if (newMultiplier < BASIS_POINTS / 2 || newMultiplier > BASIS_POINTS * 3) {
            revert InvalidMultiplier(newMultiplier); // 50%-300%
        }

        uint256 oldMultiplier = service.demandMultiplier;
        service.demandMultiplier = newMultiplier;

        emit DemandMultiplierUpdated(serviceName, oldMultiplier, newMultiplier);
    }

    function setServiceActive(string calldata serviceName, bool isActive) external onlyOwner {
        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        service.isActive = isActive;
    }

    function recordUsage(address user, string calldata serviceName, uint256 cost) external nonReentrant whenNotPaused {
        if (!authorizedCallers[msg.sender]) revert UnauthorizedCaller();

        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        if (!service.isActive) revert ServiceNotActive(serviceName);

        // Update service stats
        service.totalUsageCount++;
        service.totalRevenue += cost;

        // Update user stats
        UserUsage storage usage = userUsage[user][serviceName];
        usage.totalSpent += cost;
        usage.requestCount++;
        usage.lastUsedBlock = block.number;

        // Calculate and update volume discount
        usage.volumeDiscount = _calculateVolumeDiscount(usage.totalSpent);

        // Record for audit trail
        bytes32 sessionId =
            keccak256(abi.encodePacked(user, serviceName, block.timestamp, block.number, usage.requestCount));

        usageRecords[sessionId] = UsageRecord({
            user: user,
            serviceName: serviceName,
            cost: cost,
            sessionId: sessionId,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        emit ServiceUsageRecorded(user, serviceName, cost, sessionId, usage.volumeDiscount);
    }

    function getServiceCost(string calldata serviceName, address user) external view returns (uint256 cost) {
        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        if (!service.isActive) revert ServiceNotActive(serviceName);

        // Base price * demand multiplier
        uint256 baseCost = (service.basePrice * service.demandMultiplier) / BASIS_POINTS;

        // Apply volume discount
        UserUsage storage usage = userUsage[user][serviceName];
        uint256 discount = _calculateVolumeDiscount(usage.totalSpent);

        if (discount > 0) {
            baseCost = baseCost - (baseCost * discount / BASIS_POINTS);
        }

        // Enforce min/max bounds
        if (baseCost < service.minPrice) baseCost = service.minPrice;
        if (baseCost > service.maxPrice) baseCost = service.maxPrice;

        return baseCost;
    }

    function isServiceAvailable(string calldata serviceName) external view returns (bool available) {
        ServiceConfig storage service = services[serviceName];
        return service.basePrice != 0 && service.isActive;
    }

    function getServicesByCategory(string calldata category) external view returns (string[] memory) {
        return servicesByCategory[category];
    }

    function getUserTotalUsage(address user) external view returns (uint256 totalSpent, uint256 totalRequests) {
        for (uint256 i = 0; i < serviceNames.length; i++) {
            UserUsage storage usage = userUsage[user][serviceNames[i]];
            totalSpent += usage.totalSpent;
            totalRequests += usage.requestCount;
        }
        return (totalSpent, totalRequests);
    }

    function updateVolumeTiers(uint256[] calldata newTiers, uint256[] calldata newDiscounts) external onlyOwner {
        if (newTiers.length != newDiscounts.length) revert InvalidTierArrays();
        if (newTiers.length == 0) revert InvalidTierArrays();

        volumeTiers = newTiers;
        volumeDiscounts = newDiscounts;

        emit VolumeTiersUpdated(newTiers, newDiscounts);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasuryAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _calculateVolumeDiscount(uint256 totalSpent) internal view returns (uint256 discount) {
        for (uint256 i = volumeTiers.length - 1; i > 0; i--) {
            if (totalSpent >= volumeTiers[i]) {
                return volumeDiscounts[i];
            }
        }
        return 0;
    }

    function getServiceCount() external view returns (uint256) {
        return serviceNames.length;
    }

    /**
     * @notice Get service at index
     */
    function getServiceAt(uint256 index) external view returns (string memory) {
        return serviceNames[index];
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    function getServicesByAgent(uint256 agentId) external view returns (string[] memory) {
        return agentServices[agentId];
    }

    function getServiceProviderAgent(string calldata serviceName) external view returns (uint256 agentId) {
        return services[serviceName].providerAgentId;
    }

    function isVerifiedAgent(string calldata serviceName) external view returns (bool) {
        uint256 agentId = services[serviceName].providerAgentId;
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }
}
