// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ServiceRegistry
 * @author Jeju Network
 * @notice Generic registry for service pricing, usage tracking, and volume discounts
 * @dev Manages pricing for ANY type of service with dynamic pricing and volume discounts.
 *
 * Supports Multiple Service Categories:
 * - AI Services: chat-completion, image-generation, video-generation, embeddings
 * - Compute: container hosting, serverless functions, GPU compute
 * - Storage: file storage, IPFS pinning, database hosting
 * - Game Services: game servers, matchmaking, leaderboards
 * - API Services: custom APIs, webhooks, data feeds
 *
 * Pricing Model:
 * - Base price per service (in payment token, typically 18 decimals)
 * - Volume discounts for high-usage users
 * - Demand multipliers during peak usage
 * - Multi-currency support (not hardcoded to elizaOS)
 *
 * Generic Design:
 * - No hardcoded service types - services are registered dynamically
 * - No hardcoded payment token - works with any ERC-20
 * - Category-based organization for discovery
 * - Extensible for future service types
 *
 * @custom:security-contact security@jeju.network
 */
contract ServiceRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    struct ServiceConfig {
        string category;                // Service category (e.g., "ai", "compute", "storage", "game")
        uint256 basePrice;              // Base price in payment tokens (18 decimals)
        uint256 demandMultiplier;       // Current demand multiplier (basis points)
        uint256 totalUsageCount;        // Total times this service has been used
        uint256 totalRevenue;           // Total revenue generated in payment tokens
        bool isActive;                  // Whether service is accepting requests
        uint256 minPrice;               // Minimum price floor
        uint256 maxPrice;               // Maximum price ceiling
        address provider;               // Service provider address
        uint256 registeredAt;           // Block timestamp when registered
    }

    struct UserUsage {
        uint256 totalSpent;             // Total tokens spent by user
        uint256 requestCount;           // Total requests made
        uint256 lastUsedBlock;          // Last block user used service
        uint256 volumeDiscount;         // User's volume discount (basis points)
    }

    struct UsageRecord {
        address user;
        string serviceName;
        uint256 cost;
        bytes32 sessionId;
        uint256 timestamp;
        uint256 blockNumber;
    }

    // ============ State Variables ============

    /// @notice Mapping of service name => service configuration
    mapping(string => ServiceConfig) public services;

    /// @notice Mapping of user => service => usage stats
    mapping(address => mapping(string => UserUsage)) public userUsage;

    /// @notice Mapping of session ID => usage record for audit trail
    mapping(bytes32 => UsageRecord) public usageRecords;

    /// @notice List of all registered service names
    string[] public serviceNames;

    /// @notice Mapping of category => list of services
    mapping(string => string[]) public servicesByCategory;

    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Volume discount tiers (spending thresholds in tokens)
    uint256[] public volumeTiers = [
        0,                  // 0%    - 0 spent
        1000 * 1e18,       // 5%    - 1,000 tokens
        5000 * 1e18,       // 10%   - 5,000 tokens
        10000 * 1e18,      // 15%   - 10,000 tokens
        50000 * 1e18       // 20%   - 50,000 tokens
    ];

    /// @notice Volume discount rates (basis points)
    uint256[] public volumeDiscounts = [
        0,      // 0% discount
        500,    // 5% discount
        1000,   // 10% discount
        1500,   // 15% discount
        2000    // 20% discount
    ];

    /// @notice Treasury address for revenue collection
    address public treasury;

    /// @notice Authorized callers (paymasters) that can record usage
    mapping(address => bool) public authorizedCallers;

    // ============ Events ============

    event ServiceRegistered(
        string indexed serviceName,
        string category,
        uint256 basePrice,
        uint256 minPrice,
        uint256 maxPrice,
        address provider
    );

    event ServicePriceUpdated(
        string indexed serviceName,
        uint256 oldPrice,
        uint256 newPrice
    );

    event ServiceUsageRecorded(
        address indexed user,
        string serviceName,
        uint256 cost,
        bytes32 sessionId,
        uint256 volumeDiscount
    );

    event DemandMultiplierUpdated(
        string indexed serviceName,
        uint256 oldMultiplier,
        uint256 newMultiplier
    );

    event VolumeTiersUpdated(uint256[] newTiers, uint256[] newDiscounts);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);

    // ============ Errors ============

    error ServiceNotFound(string serviceName);
    error ServiceAlreadyExists(string serviceName);
    error ServiceNotActive(string serviceName);
    error InvalidPrice(uint256 price);
    error InvalidMultiplier(uint256 multiplier);
    error InvalidTierArrays();
    error UnauthorizedCaller();
    error InvalidTreasuryAddress();
    error InvalidCategory();

    // ============ Constructor ============

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
        if (services[serviceName].basePrice != 0) revert ServiceAlreadyExists(serviceName);
        if (basePrice == 0 || minPrice == 0 || maxPrice == 0) revert InvalidPrice(0);
        if (basePrice < minPrice || basePrice > maxPrice) revert InvalidPrice(basePrice);
        if (bytes(category).length == 0) revert InvalidCategory();

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

    /**
     * @notice Update demand multiplier for dynamic pricing
     * @param serviceName Service to update
     * @param newMultiplier New multiplier in basis points
     */
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

    /**
     * @notice Activate or deactivate a service
     * @param serviceName Service to update
     * @param isActive New active status
     */
    function setServiceActive(string calldata serviceName, bool isActive) external onlyOwner {
        ServiceConfig storage service = services[serviceName];
        if (service.basePrice == 0) revert ServiceNotFound(serviceName);
        service.isActive = isActive;
    }

    // ============ Usage Tracking ============

    /**
     * @notice Record service usage (called by authorized paymaster)
     * @param user User who used the service
     * @param serviceName Service that was used
     * @param cost Cost charged to user
     */
    function recordUsage(
        address user,
        string calldata serviceName,
        uint256 cost
    ) external nonReentrant whenNotPaused {
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
        bytes32 sessionId = keccak256(abi.encodePacked(
            user,
            serviceName,
            block.timestamp,
            block.number,
            usage.requestCount
        ));

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

    // ============ Pricing Queries ============

    /**
     * @notice Get current cost for a service including user discounts
     * @param serviceName Service to check
     * @param user User requesting the service
     * @return cost Final cost in payment tokens
     */
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

    /**
     * @notice Check if service is available
     * @param serviceName Service to check
     * @return available True if service exists and is active
     */
    function isServiceAvailable(string calldata serviceName) external view returns (bool available) {
        ServiceConfig storage service = services[serviceName];
        return service.basePrice != 0 && service.isActive;
    }

    /**
     * @notice Get all services in a category
     * @param category Category to query
     * @return services Array of service names
     */
    function getServicesByCategory(string calldata category) external view returns (string[] memory) {
        return servicesByCategory[category];
    }

    /**
     * @notice Get user's total usage across all services
     * @param user User to query
     * @return totalSpent Total tokens spent
     * @return totalRequests Total service requests
     */
    function getUserTotalUsage(address user) external view returns (uint256 totalSpent, uint256 totalRequests) {
        for (uint256 i = 0; i < serviceNames.length; i++) {
            UserUsage storage usage = userUsage[user][serviceNames[i]];
            totalSpent += usage.totalSpent;
            totalRequests += usage.requestCount;
        }
        return (totalSpent, totalRequests);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update volume discount tiers
     * @param newTiers New spending thresholds
     * @param newDiscounts New discount rates (basis points)
     */
    function updateVolumeTiers(
        uint256[] calldata newTiers,
        uint256[] calldata newDiscounts
    ) external onlyOwner {
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

    /**
     * @notice Authorize or deauthorize a caller (paymaster)
     * @param caller Address to update
     * @param authorized New authorization status
     */
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
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

    // ============ Internal Functions ============

    /**
     * @notice Calculate volume discount based on total spent
     * @param totalSpent Total amount spent by user
     * @return discount Discount rate in basis points
     */
    function _calculateVolumeDiscount(uint256 totalSpent) internal view returns (uint256 discount) {
        for (uint256 i = volumeTiers.length - 1; i > 0; i--) {
            if (totalSpent >= volumeTiers[i]) {
                return volumeDiscounts[i];
            }
        }
        return 0;
    }

    // ============ View Functions ============

    /**
     * @notice Get total number of registered services
     */
    function getServiceCount() external view returns (uint256) {
        return serviceNames.length;
    }

    /**
     * @notice Get service at index
     */
    function getServiceAt(uint256 index) external view returns (string memory) {
        return serviceNames[index];
    }
}
