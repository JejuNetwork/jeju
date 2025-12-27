// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ComputeAMM
 * @notice Automated Market Maker for decentralized compute resources
 * @dev Implements dynamic pricing based on supply/demand using a bonding curve.
 *
 * Pricing Model:
 *   price = basePrice * (1 + utilization^2)
 *
 * Where:
 *   - utilization = usedCapacity / totalCapacity
 *   - basePrice is set per resource type
 *
 * This creates a quadratic price increase as utilization approaches 100%,
 * incentivizing providers to add capacity and users to balance load.
 *
 * Features:
 * - Per-region, per-resource-type pricing
 * - Spot and reserved capacity markets
 * - Provider capacity registration
 * - Order matching and settlement
 * - x402 payment integration support
 */
contract ComputeAMM is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // Types
    // ============================================================================

    enum ResourceType {
        CPU, // vCPU hours
        MEMORY, // GB-hours
        GPU_H100, // H100 GPU hours
        GPU_A100, // A100 GPU hours
        GPU_L4, // L4 GPU hours
        STORAGE, // GB-months
        BANDWIDTH, // GB transfer
        INFERENCE // Token units

    }

    enum Region {
        GLOBAL,
        NA_EAST,
        NA_WEST,
        EU_WEST,
        EU_CENTRAL,
        APAC_EAST,
        APAC_SOUTH
    }

    enum OrderType {
        SPOT, // Immediate execution at current price
        LIMIT, // Execute if price <= maxPrice
        RESERVED // Pre-purchased capacity at locked price

    }

    enum OrderStatus {
        PENDING,
        FILLED,
        PARTIAL,
        CANCELLED,
        EXPIRED
    }

    struct ResourcePool {
        ResourceType resourceType;
        Region region;
        uint256 totalCapacity; // Total available units
        uint256 usedCapacity; // Currently allocated units
        uint256 basePrice; // Base price per unit in wei
        uint256 minPrice; // Floor price
        uint256 maxPrice; // Ceiling price
        bool active;
    }

    struct Provider {
        address addr;
        uint256 stake;
        bool active;
        uint256 reputation;
        uint256 totalCapacity;
        uint256 allocatedCapacity;
        uint256 revenue;
    }

    struct Order {
        bytes32 orderId;
        address user;
        ResourceType resourceType;
        Region region;
        OrderType orderType;
        uint256 quantity; // Units requested
        uint256 maxPrice; // Max price per unit (for limit orders)
        uint256 filledQuantity;
        uint256 filledPrice; // Average fill price
        address paymentToken;
        uint256 duration; // Duration in seconds (for reserved)
        uint256 expiresAt;
        OrderStatus status;
    }

    struct Reservation {
        bytes32 reservationId;
        address user;
        ResourceType resourceType;
        Region region;
        uint256 quantity;
        uint256 pricePerUnit; // Locked price
        uint256 startTime;
        uint256 endTime;
        bool active;
    }

    // ============================================================================
    // State
    // ============================================================================

    // Resource pools: keccak256(resourceType, region) => Pool
    mapping(bytes32 => ResourcePool) public pools;
    bytes32[] public poolIds;

    // Providers
    mapping(address => Provider) public providers;
    address[] public providerList;

    // Provider capacity per pool: poolId => provider => capacity
    mapping(bytes32 => mapping(address => uint256)) public providerPoolCapacity;

    // Orders
    mapping(bytes32 => Order) public orders;
    bytes32[] public orderIds;
    mapping(address => bytes32[]) public userOrders;

    // Reservations
    mapping(bytes32 => Reservation) public reservations;
    bytes32[] public reservationIds;
    mapping(address => bytes32[]) public userReservations;

    // Payment
    mapping(address => bool) public acceptedTokens;
    address[] public tokenList;
    address public defaultToken;

    // Revenue
    mapping(address => uint256) public protocolRevenue;
    uint256 public protocolFeeBps = 300; // 3%
    address public treasury;

    // Min stake for providers
    uint256 public minProviderStake = 0.1 ether;

    // ============================================================================
    // Events
    // ============================================================================

    event PoolCreated(bytes32 indexed poolId, ResourceType resourceType, Region region, uint256 basePrice);

    event PoolUpdated(bytes32 indexed poolId, uint256 totalCapacity, uint256 usedCapacity, uint256 currentPrice);

    event ProviderRegistered(address indexed provider, uint256 stake);

    event ProviderDeactivated(address indexed provider);

    event CapacityAdded(bytes32 indexed poolId, address indexed provider, uint256 capacity);

    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed user,
        ResourceType resourceType,
        Region region,
        OrderType orderType,
        uint256 quantity,
        uint256 maxPrice
    );

    event OrderFilled(
        bytes32 indexed orderId, address indexed user, uint256 quantity, uint256 totalCost, uint256 averagePrice
    );

    event OrderCancelled(bytes32 indexed orderId, address indexed user);

    event ReservationCreated(
        bytes32 indexed reservationId,
        address indexed user,
        ResourceType resourceType,
        Region region,
        uint256 quantity,
        uint256 pricePerUnit,
        uint256 duration
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error PoolNotFound();
    error InsufficientCapacity();
    error InsufficientStake();
    error PriceExceedsMax();
    error InvalidQuantity();
    error OrderNotFound();
    error NotOrderOwner();
    error OrderAlreadyFilled();
    error TokenNotAccepted();
    error InvalidDuration();
    error ProviderNotActive();
    error ProviderHasActiveCapacity();
    error NoStakeToWithdraw();
    error StakeWithdrawFailed();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _treasury, address _defaultToken) Ownable(msg.sender) {
        treasury = _treasury;
        defaultToken = _defaultToken;
        acceptedTokens[_defaultToken] = true;
        tokenList.push(_defaultToken);
    }

    // ============================================================================
    // Pool Management
    // ============================================================================

    /**
     * @notice Create a new resource pool
     * @param resourceType Type of resource
     * @param region Geographic region
     * @param basePrice Base price per unit in wei
     * @param minPrice Minimum price floor
     * @param maxPrice Maximum price ceiling
     */
    function createPool(ResourceType resourceType, Region region, uint256 basePrice, uint256 minPrice, uint256 maxPrice)
        external
        onlyOwner
        returns (bytes32 poolId)
    {
        poolId = keccak256(abi.encodePacked(resourceType, region));

        pools[poolId] = ResourcePool({
            resourceType: resourceType,
            region: region,
            totalCapacity: 0,
            usedCapacity: 0,
            basePrice: basePrice,
            minPrice: minPrice,
            maxPrice: maxPrice,
            active: true
        });

        poolIds.push(poolId);
        emit PoolCreated(poolId, resourceType, region, basePrice);
        return poolId;
    }

    /**
     * @notice Update pool pricing parameters
     */
    function updatePoolPricing(bytes32 poolId, uint256 basePrice, uint256 minPrice, uint256 maxPrice)
        external
        onlyOwner
    {
        ResourcePool storage pool = pools[poolId];
        if (!pool.active) revert PoolNotFound();

        pool.basePrice = basePrice;
        pool.minPrice = minPrice;
        pool.maxPrice = maxPrice;
    }

    // ============================================================================
    // Provider Management
    // ============================================================================

    /**
     * @notice Register as a compute provider
     */
    function registerProvider() external payable nonReentrant {
        if (msg.value < minProviderStake) revert InsufficientStake();

        Provider storage provider = providers[msg.sender];
        if (provider.addr == address(0)) {
            providerList.push(msg.sender);
        }

        provider.addr = msg.sender;
        provider.stake += msg.value;
        provider.active = true;
        provider.reputation = 100;

        emit ProviderRegistered(msg.sender, provider.stake);
    }

    /**
     * @notice Withdraw provider stake
     * @dev Provider must have no active capacity and be deactivated
     */
    function withdrawStake() external nonReentrant {
        Provider storage provider = providers[msg.sender];
        uint256 stake = provider.stake;
        if (stake == 0) revert NoStakeToWithdraw();

        // Deactivate and clear stake
        provider.active = false;
        provider.stake = 0;

        (bool success,) = payable(msg.sender).call{value: stake}("");
        if (!success) revert StakeWithdrawFailed();

        emit ProviderDeactivated(msg.sender);
    }

    /**
     * @notice Add capacity to a resource pool
     * @param resourceType Resource type
     * @param region Region
     * @param capacity Units of capacity to add
     */
    function addCapacity(ResourceType resourceType, Region region, uint256 capacity) external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (!provider.active) revert ProviderNotActive();

        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        ResourcePool storage pool = pools[poolId];

        if (!pool.active) {
            // Auto-create pool with default pricing
            pool.resourceType = resourceType;
            pool.region = region;
            pool.basePrice = getDefaultBasePrice(resourceType);
            pool.minPrice = pool.basePrice / 10;
            pool.maxPrice = pool.basePrice * 10;
            pool.active = true;
            poolIds.push(poolId);
        }

        pool.totalCapacity += capacity;
        provider.totalCapacity += capacity;
        providerPoolCapacity[poolId][msg.sender] += capacity;

        emit CapacityAdded(poolId, msg.sender, capacity);
        emit PoolUpdated(poolId, pool.totalCapacity, pool.usedCapacity, getSpotPrice(resourceType, region));
    }

    // ============================================================================
    // Pricing Functions
    // ============================================================================

    /**
     * @notice Get current spot price for a resource
     * @param resourceType Resource type
     * @param region Region
     * @return price Current price per unit in wei
     */
    function getSpotPrice(ResourceType resourceType, Region region) public view returns (uint256 price) {
        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        ResourcePool storage pool = pools[poolId];

        if (pool.totalCapacity == 0) {
            return pool.maxPrice > 0 ? pool.maxPrice : getDefaultBasePrice(resourceType);
        }

        // Calculate utilization (scaled by 1e18 for precision)
        uint256 utilization = (pool.usedCapacity * 1e18) / pool.totalCapacity;

        // Apply bonding curve: price = basePrice * (1 + utilization^2)
        // utilization^2 scaled: (utilization * utilization) / 1e18
        uint256 utilizationSquared = (utilization * utilization) / 1e18;
        uint256 multiplier = 1e18 + utilizationSquared;

        price = (pool.basePrice * multiplier) / 1e18;

        // Apply bounds
        if (price < pool.minPrice) price = pool.minPrice;
        if (price > pool.maxPrice) price = pool.maxPrice;

        return price;
    }

    /**
     * @notice Get price for a specific quantity (with slippage)
     * @param resourceType Resource type
     * @param region Region
     * @param quantity Number of units
     * @return totalCost Total cost in wei
     * @return averagePrice Average price per unit
     */
    function getQuote(ResourceType resourceType, Region region, uint256 quantity)
        public
        view
        returns (uint256 totalCost, uint256 averagePrice)
    {
        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        ResourcePool storage pool = pools[poolId];

        if (pool.totalCapacity == 0 || quantity > pool.totalCapacity - pool.usedCapacity) {
            revert InsufficientCapacity();
        }

        // Simulate filling the order unit by unit
        uint256 used = pool.usedCapacity;
        uint256 total = pool.totalCapacity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 utilization = ((used + i) * 1e18) / total;
            uint256 utilizationSquared = (utilization * utilization) / 1e18;
            uint256 multiplier = 1e18 + utilizationSquared;
            uint256 unitPrice = (pool.basePrice * multiplier) / 1e18;

            if (unitPrice < pool.minPrice) unitPrice = pool.minPrice;
            if (unitPrice > pool.maxPrice) unitPrice = pool.maxPrice;

            totalCost += unitPrice;
        }

        averagePrice = totalCost / quantity;
        return (totalCost, averagePrice);
    }

    /**
     * @notice Get default base price for resource type
     */
    function getDefaultBasePrice(ResourceType resourceType) public pure returns (uint256) {
        if (resourceType == ResourceType.CPU) return 0.0001 ether; // per vCPU-hour
        if (resourceType == ResourceType.MEMORY) return 0.00005 ether; // per GB-hour
        if (resourceType == ResourceType.GPU_H100) return 0.01 ether; // per GPU-hour
        if (resourceType == ResourceType.GPU_A100) return 0.005 ether;
        if (resourceType == ResourceType.GPU_L4) return 0.002 ether;
        if (resourceType == ResourceType.STORAGE) return 0.00001 ether; // per GB-month
        if (resourceType == ResourceType.BANDWIDTH) return 0.000001 ether; // per GB
        if (resourceType == ResourceType.INFERENCE) return 0.000001 ether; // per 1k tokens
        return 0.0001 ether;
    }

    // ============================================================================
    // Order Functions
    // ============================================================================

    /**
     * @notice Place a spot order (immediate execution)
     * @param resourceType Resource type
     * @param region Region
     * @param quantity Number of units
     * @param maxPrice Maximum price per unit willing to pay
     * @param paymentToken Token to pay with
     */
    function placeSpotOrder(
        ResourceType resourceType,
        Region region,
        uint256 quantity,
        uint256 maxPrice,
        address paymentToken
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        if (quantity == 0) revert InvalidQuantity();
        if (!acceptedTokens[paymentToken]) revert TokenNotAccepted();

        // Get quote
        (uint256 totalCost, uint256 avgPrice) = getQuote(resourceType, region, quantity);

        // Check max price
        if (avgPrice > maxPrice) revert PriceExceedsMax();

        // Add protocol fee
        uint256 fee = (totalCost * protocolFeeBps) / 10000;
        uint256 totalWithFee = totalCost + fee;

        // Transfer payment
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), totalWithFee);

        // Create and fill order
        orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, quantity));

        orders[orderId] = Order({
            orderId: orderId,
            user: msg.sender,
            resourceType: resourceType,
            region: region,
            orderType: OrderType.SPOT,
            quantity: quantity,
            maxPrice: maxPrice,
            filledQuantity: quantity,
            filledPrice: avgPrice,
            paymentToken: paymentToken,
            duration: 0,
            expiresAt: 0,
            status: OrderStatus.FILLED
        });

        orderIds.push(orderId);
        userOrders[msg.sender].push(orderId);

        // Update pool utilization
        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        pools[poolId].usedCapacity += quantity;

        // Record revenue
        protocolRevenue[paymentToken] += fee;

        emit OrderPlaced(orderId, msg.sender, resourceType, region, OrderType.SPOT, quantity, maxPrice);
        emit OrderFilled(orderId, msg.sender, quantity, totalCost, avgPrice);

        return orderId;
    }

    /**
     * @notice Place a limit order
     * @param resourceType Resource type
     * @param region Region
     * @param quantity Number of units
     * @param maxPrice Maximum price per unit
     * @param paymentToken Token to pay with
     * @param expiresIn Seconds until order expires
     */
    function placeLimitOrder(
        ResourceType resourceType,
        Region region,
        uint256 quantity,
        uint256 maxPrice,
        address paymentToken,
        uint256 expiresIn
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        if (quantity == 0) revert InvalidQuantity();
        if (!acceptedTokens[paymentToken]) revert TokenNotAccepted();

        // Pre-authorize payment (max possible cost + fee)
        uint256 maxCost = quantity * maxPrice;
        uint256 maxFee = (maxCost * protocolFeeBps) / 10000;
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), maxCost + maxFee);

        orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, quantity, maxPrice));

        orders[orderId] = Order({
            orderId: orderId,
            user: msg.sender,
            resourceType: resourceType,
            region: region,
            orderType: OrderType.LIMIT,
            quantity: quantity,
            maxPrice: maxPrice,
            filledQuantity: 0,
            filledPrice: 0,
            paymentToken: paymentToken,
            duration: 0,
            expiresAt: block.timestamp + expiresIn,
            status: OrderStatus.PENDING
        });

        orderIds.push(orderId);
        userOrders[msg.sender].push(orderId);

        emit OrderPlaced(orderId, msg.sender, resourceType, region, OrderType.LIMIT, quantity, maxPrice);

        // Try to fill immediately
        _tryFillLimitOrder(orderId);

        return orderId;
    }

    /**
     * @notice Create a reserved capacity position
     * @param resourceType Resource type
     * @param region Region
     * @param quantity Number of units
     * @param duration Duration in seconds
     * @param paymentToken Token to pay with
     */
    function createReservation(
        ResourceType resourceType,
        Region region,
        uint256 quantity,
        uint256 duration,
        address paymentToken
    ) external nonReentrant whenNotPaused returns (bytes32 reservationId) {
        if (quantity == 0) revert InvalidQuantity();
        if (duration < 1 hours) revert InvalidDuration();
        if (!acceptedTokens[paymentToken]) revert TokenNotAccepted();

        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        ResourcePool storage pool = pools[poolId];

        if (quantity > pool.totalCapacity - pool.usedCapacity) {
            revert InsufficientCapacity();
        }

        // Reserved capacity gets a 20% discount from spot price
        uint256 spotPrice = getSpotPrice(resourceType, region);
        uint256 reservedPrice = (spotPrice * 80) / 100;

        // Calculate total cost based on duration (price per hour * hours)
        uint256 hours_ = duration / 1 hours;
        if (hours_ == 0) hours_ = 1;
        uint256 totalCost = reservedPrice * quantity * hours_;
        uint256 fee = (totalCost * protocolFeeBps) / 10000;

        // Transfer payment
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), totalCost + fee);

        // Create reservation
        reservationId = keccak256(abi.encodePacked(msg.sender, block.timestamp, quantity, duration));

        reservations[reservationId] = Reservation({
            reservationId: reservationId,
            user: msg.sender,
            resourceType: resourceType,
            region: region,
            quantity: quantity,
            pricePerUnit: reservedPrice,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            active: true
        });

        reservationIds.push(reservationId);
        userReservations[msg.sender].push(reservationId);

        // Reserve capacity
        pool.usedCapacity += quantity;

        // Record revenue
        protocolRevenue[paymentToken] += fee;

        emit ReservationCreated(reservationId, msg.sender, resourceType, region, quantity, reservedPrice, duration);

        return reservationId;
    }

    /**
     * @notice Cancel a pending order
     */
    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound();
        if (order.user != msg.sender) revert NotOrderOwner();
        if (order.status != OrderStatus.PENDING) revert OrderAlreadyFilled();

        // Refund escrowed funds
        uint256 refund = (order.quantity - order.filledQuantity) * order.maxPrice;
        uint256 feeRefund = (refund * protocolFeeBps) / 10000;
        IERC20(order.paymentToken).safeTransfer(msg.sender, refund + feeRefund);

        order.status = OrderStatus.CANCELLED;
        emit OrderCancelled(orderId, msg.sender);
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _tryFillLimitOrder(bytes32 orderId) internal {
        Order storage order = orders[orderId];
        uint256 currentPrice = getSpotPrice(order.resourceType, order.region);

        if (currentPrice <= order.maxPrice) {
            bytes32 poolId = keccak256(abi.encodePacked(order.resourceType, order.region));
            ResourcePool storage pool = pools[poolId];

            uint256 availableToFill = pool.totalCapacity - pool.usedCapacity;
            uint256 toFill = order.quantity - order.filledQuantity;
            if (toFill > availableToFill) toFill = availableToFill;

            if (toFill > 0) {
                order.filledQuantity += toFill;
                order.filledPrice = currentPrice;
                pool.usedCapacity += toFill;

                if (order.filledQuantity == order.quantity) {
                    order.status = OrderStatus.FILLED;

                    // Refund excess payment
                    uint256 actualCost = order.filledQuantity * order.filledPrice;
                    uint256 maxCost = order.quantity * order.maxPrice;
                    uint256 fee = (actualCost * protocolFeeBps) / 10000;
                    uint256 refund = maxCost + ((maxCost * protocolFeeBps) / 10000) - actualCost - fee;

                    if (refund > 0) {
                        IERC20(order.paymentToken).safeTransfer(order.user, refund);
                    }

                    protocolRevenue[order.paymentToken] += fee;
                } else {
                    order.status = OrderStatus.PARTIAL;
                }

                emit OrderFilled(orderId, order.user, toFill, toFill * currentPrice, currentPrice);
            }
        }
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function addAcceptedToken(address token) external onlyOwner {
        if (!acceptedTokens[token]) {
            acceptedTokens[token] = true;
            tokenList.push(token);
        }
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Fee too high"); // Max 10%
        protocolFeeBps = feeBps;
    }

    function setMinProviderStake(uint256 stake) external onlyOwner {
        minProviderStake = stake;
    }

    function withdrawRevenue(address token, address to) external onlyOwner {
        uint256 amount = protocolRevenue[token];
        protocolRevenue[token] = 0;
        IERC20(token).safeTransfer(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getPoolInfo(ResourceType resourceType, Region region) external view returns (ResourcePool memory) {
        bytes32 poolId = keccak256(abi.encodePacked(resourceType, region));
        return pools[poolId];
    }

    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }

    function getUserReservations(address user) external view returns (bytes32[] memory) {
        return userReservations[user];
    }

    function getAllPools() external view returns (bytes32[] memory) {
        return poolIds;
    }

    function getProviderCount() external view returns (uint256) {
        return providerList.length;
    }
}
