// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistryStaking {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IBanManagerStaking {
    function isAddressBanned(address target) external view returns (bool);
}

interface IPriceOracleStaking {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/**
 * @title Staking
 * @author Jeju Network
 * @notice Universal JEJU staking for all DWS services with USD-denominated tiers
 * @dev Single staking position provides access to multiple services:
 *      - RPC rate limits
 *      - Storage quotas
 *      - Compute allocation
 *      - CDN bandwidth
 *      - Oracle access
 *
 * Security Features:
 * - Minimum stake requirement (prevents dust spam)
 * - Oracle manipulation protection (staleness checks, price bounds, fallback)
 * - Usage enforcement (not just tracking)
 * - Circuit breakers for extreme price movements
 * - 7-day unbonding period
 *
 * Tier System:
 * - Tiers based on USD value of JEJU stake
 * - Reputation bonus increases effective stake value (up to 50%)
 * - Each service maps tiers to specific allocations
 *
 * Rate Limit Tiers (USD-denominated):
 * - FREE:      $0    → Basic access (pay-per-use available)
 * - BUILDER:   $10   → 10x free tier limits
 * - PRO:       $100  → 100x free tier, priority access
 * - UNLIMITED: $1000 → No limits, SLA guarantees
 *
 * @custom:security-contact security@jeju.network
 */
contract Staking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum Tier {
        FREE,
        BUILDER,
        PRO,
        UNLIMITED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct StakePosition {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 linkedAgentId;
        uint256 reputationBonus;      // 0-5000 basis points (max 50% bonus)
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        bool isActive;
        bool isFrozen;                // Frozen by moderation
    }

    struct TierConfig {
        uint256 minUsdValue;          // Minimum USD value (8 decimals)
        uint256 rpcRateLimit;         // Requests per minute (0 = unlimited)
        uint256 storageQuotaMB;       // Storage in MB (0 = unlimited)
        uint256 computeCredits;       // Compute credits per month
        uint256 cdnBandwidthGB;       // CDN bandwidth in GB (0 = unlimited)
    }

    struct ServiceAllocation {
        uint256 rpcUsed;              // Requests used this period
        uint256 storageUsed;          // Storage used (persistent)
        uint256 computeUsed;          // Compute used this period
        uint256 cdnUsed;              // CDN used this period
        uint256 periodStartTimestamp; // When current period started
    }

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        bool isValid;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_BONUS_BPS = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant USD_DECIMALS = 8;
    uint256 public constant ALLOCATION_RESET_PERIOD = 30 days;
    
    // Minimum stake to prevent dust attacks
    uint256 public constant MIN_STAKE_AMOUNT = 0.0001 ether; // ~$0.01 at $100/JEJU
    
    // Oracle protection
    uint256 public constant ORACLE_STALENESS_THRESHOLD = 1 hours;
    uint256 public constant PRICE_DEVIATION_THRESHOLD_BPS = 5000; // 50% max deviation from TWAP
    uint256 public constant TWAP_PERIOD = 1 hours;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable jejuToken;

    IIdentityRegistryStaking public identityRegistry;
    IBanManagerStaking public banManager;
    address public reputationProvider;
    
    // Oracle configuration
    address public primaryOracle;
    address public secondaryOracle;
    uint256 public fallbackPrice = 1e8; // $1.00 default (8 decimals) - more conservative
    uint256 public lastKnownGoodPrice;
    uint256 public lastPriceUpdateTime;
    
    // Price bounds (circuit breakers)
    uint256 public minAllowedPrice = 1e6;   // $0.01 minimum
    uint256 public maxAllowedPrice = 1e12;  // $10,000 maximum

    mapping(address => StakePosition) public positions;
    mapping(Tier => TierConfig) public tierConfigs;
    mapping(address => ServiceAllocation) public allocations;
    mapping(address => bool) public whitelisted;
    mapping(address => bool) public authorizedServices;

    address public treasury;
    uint256 public totalStaked;
    uint256 public totalStakers;
    mapping(Tier => uint256) public tierCounts;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Staked(address indexed user, uint256 amount, Tier tier);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);
    event AgentLinked(address indexed user, uint256 agentId);
    event ReputationBonusUpdated(address indexed user, uint256 oldBonus, uint256 newBonus);
    event StakeFrozen(address indexed user, string reason);
    event StakeUnfrozen(address indexed user);
    event Slashed(address indexed user, uint256 amount, string reason);
    event ServiceUsageRecorded(
        address indexed user,
        string service,
        uint256 amount
    );
    event AllocationExceeded(
        address indexed user,
        string service,
        uint256 requested,
        uint256 available
    );
    event TierConfigUpdated(Tier tier);
    event AuthorizedServiceUpdated(address indexed service, bool authorized);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice, address oracle);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle, bool isPrimary);
    event PriceBoundsUpdated(uint256 minPrice, uint256 maxPrice);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAmount();
    error BelowMinimumStake();
    error InsufficientBalance();
    error UserIsBanned();
    error StakeIsFrozen();
    error NotUnbonding();
    error StillUnbonding();
    error AlreadyLinked();
    error AgentNotOwned();
    error InvalidAddress();
    error NotAuthorized();
    error AllocationExceededError();
    error InvalidPriceBounds();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _primaryOracle,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_jejuToken == address(0)) revert InvalidAddress();
        if (_treasury == address(0)) revert InvalidAddress();

        jejuToken = IERC20(_jejuToken);
        treasury = _treasury;

        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistryStaking(_identityRegistry);
        }
        primaryOracle = _primaryOracle;
        
        // Initialize with fallback as last known good
        lastKnownGoodPrice = fallbackPrice;
        lastPriceUpdateTime = block.timestamp;

        // Initialize tier configs (USD values in 8 decimals)
        // FREE tier - requires minimum stake but no USD value
        tierConfigs[Tier.FREE] = TierConfig({
            minUsdValue: 0,
            rpcRateLimit: 10,        // 10 req/min
            storageQuotaMB: 100,     // 100 MB
            computeCredits: 10,      // 10 credits/month
            cdnBandwidthGB: 1        // 1 GB/month
        });

        // BUILDER tier ($10)
        tierConfigs[Tier.BUILDER] = TierConfig({
            minUsdValue: 10e8,
            rpcRateLimit: 100,       // 100 req/min
            storageQuotaMB: 1000,    // 1 GB
            computeCredits: 100,     // 100 credits/month
            cdnBandwidthGB: 10       // 10 GB/month
        });

        // PRO tier ($100)
        tierConfigs[Tier.PRO] = TierConfig({
            minUsdValue: 100e8,
            rpcRateLimit: 1000,      // 1000 req/min
            storageQuotaMB: 10000,   // 10 GB
            computeCredits: 1000,    // 1000 credits/month
            cdnBandwidthGB: 100      // 100 GB/month
        });

        // UNLIMITED tier ($1000)
        tierConfigs[Tier.UNLIMITED] = TierConfig({
            minUsdValue: 1000e8,
            rpcRateLimit: 0,         // Unlimited
            storageQuotaMB: 0,       // Unlimited
            computeCredits: 0,       // Unlimited
            cdnBandwidthGB: 0        // Unlimited
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         STAKING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Stake JEJU tokens
     * @param amount Amount of JEJU to stake
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        _stake(msg.sender, amount, 0);
    }

    /**
     * @notice Stake JEJU tokens and link to an ERC-8004 agent
     * @param amount Amount of JEJU to stake
     * @param agentId ERC-8004 agent ID to link
     */
    function stakeWithAgent(uint256 amount, uint256 agentId) external nonReentrant whenNotPaused {
        _stake(msg.sender, amount, agentId);
    }

    function _stake(address user, uint256 amount, uint256 agentId) internal {
        if (amount == 0) revert InvalidAmount();
        if (amount < MIN_STAKE_AMOUNT) revert BelowMinimumStake();
        if (address(banManager) != address(0) && banManager.isAddressBanned(user)) {
            revert UserIsBanned();
        }

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);
        bool wasActive = pos.isActive;

        jejuToken.safeTransferFrom(user, address(this), amount);

        if (!pos.isActive) {
            pos.isActive = true;
            pos.stakedAt = block.timestamp;
            totalStakers++;
        }
        pos.stakedAmount += amount;
        totalStaked += amount;

        if (agentId > 0 && pos.linkedAgentId == 0) {
            _linkAgent(user, agentId);
        }

        Tier newTier = getTier(user);
        emit Staked(user, amount, newTier);

        if (oldTier != newTier) {
            _updateTierCounts(oldTier, newTier, wasActive);
            emit TierChanged(user, oldTier, newTier);
        } else if (!wasActive) {
            tierCounts[newTier]++;
        }
    }

    /**
     * @notice Link an ERC-8004 agent to stake position
     * @param agentId Agent ID to link
     */
    function linkAgent(uint256 agentId) external nonReentrant {
        _linkAgent(msg.sender, agentId);
    }

    function _linkAgent(address user, uint256 agentId) internal {
        StakePosition storage pos = positions[user];
        if (pos.linkedAgentId != 0) revert AlreadyLinked();

        if (address(identityRegistry) != address(0)) {
            if (identityRegistry.ownerOf(agentId) != user) revert AgentNotOwned();
        }

        pos.linkedAgentId = agentId;
        emit AgentLinked(user, agentId);
    }

    /**
     * @notice Start unbonding stake (7-day waiting period)
     * @param amount Amount to unbond
     */
    function startUnbonding(uint256 amount) external nonReentrant {
        StakePosition storage pos = positions[msg.sender];

        if (pos.isFrozen) revert StakeIsFrozen();
        if (amount == 0) revert InvalidAmount();
        if (amount > pos.stakedAmount) revert InsufficientBalance();
        if (pos.unbondingStartTime > 0) revert StillUnbonding();

        Tier oldTier = getTier(msg.sender);

        pos.unbondingAmount = amount;
        pos.unbondingStartTime = block.timestamp;
        pos.stakedAmount -= amount;
        totalStaked -= amount;

        Tier newTier = getTier(msg.sender);

        emit UnbondingStarted(msg.sender, amount);
        if (oldTier != newTier) {
            _updateTierCounts(oldTier, newTier, true);
            emit TierChanged(msg.sender, oldTier, newTier);
        }
    }

    /**
     * @notice Complete unstaking after unbonding period
     */
    function completeUnstaking() external nonReentrant {
        StakePosition storage pos = positions[msg.sender];

        if (pos.isFrozen) revert StakeIsFrozen();
        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) {
            revert StillUnbonding();
        }

        uint256 amount = pos.unbondingAmount;
        Tier currentTier = getTier(msg.sender);

        pos.unbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.stakedAmount == 0) {
            pos.isActive = false;
            totalStakers--;
            if (tierCounts[currentTier] > 0) {
                tierCounts[currentTier]--;
            }
        }

        jejuToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         TIER & ALLOCATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get user's current tier
     * @param user User address
     */
    function getTier(address user) public view returns (Tier) {
        if (whitelisted[user]) return Tier.UNLIMITED;

        uint256 effectiveUsd = getEffectiveUsdValue(user);

        if (effectiveUsd >= tierConfigs[Tier.UNLIMITED].minUsdValue) {
            return Tier.UNLIMITED;
        } else if (effectiveUsd >= tierConfigs[Tier.PRO].minUsdValue) {
            return Tier.PRO;
        } else if (effectiveUsd >= tierConfigs[Tier.BUILDER].minUsdValue) {
            return Tier.BUILDER;
        }
        return Tier.FREE;
    }

    /**
     * @notice Get effective USD value of stake (includes reputation bonus)
     * @param user User address
     */
    function getEffectiveUsdValue(address user) public view returns (uint256) {
        StakePosition storage pos = positions[user];
        if (!pos.isActive) return 0;

        uint256 jejuPrice = getJejuPrice();
        uint256 baseUsd = (pos.stakedAmount * jejuPrice) / 1e18;

        // Apply reputation bonus
        uint256 bonus = (baseUsd * pos.reputationBonus) / BPS_DENOMINATOR;
        return baseUsd + bonus;
    }

    /**
     * @notice Get JEJU price in USD (8 decimals) with manipulation protection
     * @dev Uses multiple validation layers:
     *      1. Primary oracle with staleness check
     *      2. Secondary oracle fallback
     *      3. Price bounds check (circuit breaker)
     *      4. Deviation check from last known good price
     *      5. Conservative fallback if all fail
     */
    function getJejuPrice() public view returns (uint256) {
        // Try primary oracle
        PriceData memory primaryData = _getOraclePrice(primaryOracle);
        
        if (primaryData.isValid) {
            // Validate against bounds
            if (primaryData.price >= minAllowedPrice && primaryData.price <= maxAllowedPrice) {
                // Check deviation from last known good price (if we have one)
                if (lastKnownGoodPrice > 0) {
                    uint256 deviation = _calculateDeviation(primaryData.price, lastKnownGoodPrice);
                    if (deviation <= PRICE_DEVIATION_THRESHOLD_BPS) {
                        return primaryData.price;
                    }
                    // If deviation too high, try secondary oracle
                } else {
                    return primaryData.price;
                }
            }
        }

        // Try secondary oracle
        if (secondaryOracle != address(0)) {
            PriceData memory secondaryData = _getOraclePrice(secondaryOracle);
            
            if (secondaryData.isValid) {
                if (secondaryData.price >= minAllowedPrice && secondaryData.price <= maxAllowedPrice) {
                    // If primary was valid but deviated, check if secondary agrees with either
                    if (primaryData.isValid) {
                        uint256 oracleDeviation = _calculateDeviation(primaryData.price, secondaryData.price);
                        if (oracleDeviation <= 1000) { // 10% max deviation between oracles
                            // Oracles agree, use average
                            return (primaryData.price + secondaryData.price) / 2;
                        }
                    }
                    return secondaryData.price;
                }
            }
        }

        // Use last known good price if recent enough (within 24 hours)
        if (lastKnownGoodPrice > 0 && block.timestamp - lastPriceUpdateTime < 24 hours) {
            return lastKnownGoodPrice;
        }

        // Final fallback - use conservative fallback price
        return fallbackPrice;
    }

    function _getOraclePrice(address oracle) internal view returns (PriceData memory data) {
        if (oracle == address(0)) {
            return PriceData({price: 0, timestamp: 0, isValid: false});
        }

        try IPriceOracleStaking(oracle).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            // Check staleness
            if (block.timestamp - updatedAt > ORACLE_STALENESS_THRESHOLD) {
                return PriceData({price: 0, timestamp: updatedAt, isValid: false});
            }
            
            // Check for negative or zero price
            if (answer <= 0) {
                return PriceData({price: 0, timestamp: updatedAt, isValid: false});
            }
            
            return PriceData({
                price: uint256(answer),
                timestamp: updatedAt,
                isValid: true
            });
        } catch {
            return PriceData({price: 0, timestamp: 0, isValid: false});
        }
    }

    function _calculateDeviation(uint256 price1, uint256 price2) internal pure returns (uint256) {
        if (price1 == 0 || price2 == 0) return BPS_DENOMINATOR;
        
        uint256 larger = price1 > price2 ? price1 : price2;
        uint256 smaller = price1 > price2 ? price2 : price1;
        
        return ((larger - smaller) * BPS_DENOMINATOR) / larger;
    }

    /**
     * @notice Get allocation for a specific service
     * @param user User address
     * @param service Service name ("rpc", "storage", "compute", "cdn")
     */
    function getAllocation(
        address user,
        string calldata service
    ) external view returns (uint256 limit, uint256 used, uint256 remaining) {
        Tier tier = getTier(user);
        TierConfig storage config = tierConfigs[tier];
        ServiceAllocation storage alloc = allocations[user];

        // Check if period needs reset
        bool needsReset = block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD;

        bytes32 serviceHash = keccak256(bytes(service));
        
        if (serviceHash == keccak256("rpc")) {
            limit = config.rpcRateLimit;
            used = needsReset ? 0 : alloc.rpcUsed;
        } else if (serviceHash == keccak256("storage")) {
            limit = config.storageQuotaMB;
            used = alloc.storageUsed; // Storage is persistent, not reset
        } else if (serviceHash == keccak256("compute")) {
            limit = config.computeCredits;
            used = needsReset ? 0 : alloc.computeUsed;
        } else if (serviceHash == keccak256("cdn")) {
            limit = config.cdnBandwidthGB;
            used = needsReset ? 0 : alloc.cdnUsed;
        }

        // 0 limit means unlimited
        if (limit == 0) {
            remaining = type(uint256).max;
        } else {
            remaining = used >= limit ? 0 : limit - used;
        }
    }

    /**
     * @notice Check and consume allocation (atomic check + record)
     * @dev Called by authorized services. Reverts if insufficient allocation.
     * @param user User address
     * @param service Service name
     * @param amount Usage amount
     * @return success Whether allocation was available and consumed
     */
    function consumeAllocation(
        address user,
        string calldata service,
        uint256 amount
    ) external returns (bool success) {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();

        Tier tier = getTier(user);
        TierConfig storage config = tierConfigs[tier];
        ServiceAllocation storage alloc = allocations[user];

        // Reset if period expired
        if (block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.periodStartTimestamp = block.timestamp;
        }

        bytes32 serviceHash = keccak256(bytes(service));
        uint256 limit;
        uint256 currentUsed;
        
        if (serviceHash == keccak256("rpc")) {
            limit = config.rpcRateLimit;
            currentUsed = alloc.rpcUsed;
        } else if (serviceHash == keccak256("storage")) {
            limit = config.storageQuotaMB;
            currentUsed = alloc.storageUsed;
        } else if (serviceHash == keccak256("compute")) {
            limit = config.computeCredits;
            currentUsed = alloc.computeUsed;
        } else if (serviceHash == keccak256("cdn")) {
            limit = config.cdnBandwidthGB;
            currentUsed = alloc.cdnUsed;
        } else {
            revert InvalidAmount();
        }

        // Check if limit allows (0 = unlimited)
        if (limit != 0 && currentUsed + amount > limit) {
            emit AllocationExceeded(user, service, amount, limit - currentUsed);
            revert AllocationExceededError();
        }

        // Record usage
        if (serviceHash == keccak256("rpc")) {
            alloc.rpcUsed += amount;
        } else if (serviceHash == keccak256("storage")) {
            alloc.storageUsed += amount;
        } else if (serviceHash == keccak256("compute")) {
            alloc.computeUsed += amount;
        } else if (serviceHash == keccak256("cdn")) {
            alloc.cdnUsed += amount;
        }

        emit ServiceUsageRecorded(user, service, amount);
        return true;
    }

    /**
     * @notice Record service usage without enforcement (for tracking only)
     * @dev Use consumeAllocation for enforced limits
     * @param user User address
     * @param service Service name
     * @param amount Usage amount
     */
    function recordUsage(
        address user,
        string calldata service,
        uint256 amount
    ) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();

        ServiceAllocation storage alloc = allocations[user];

        // Reset if period expired
        if (block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.periodStartTimestamp = block.timestamp;
        }

        bytes32 serviceHash = keccak256(bytes(service));
        
        if (serviceHash == keccak256("rpc")) {
            alloc.rpcUsed += amount;
        } else if (serviceHash == keccak256("storage")) {
            alloc.storageUsed += amount;
        } else if (serviceHash == keccak256("compute")) {
            alloc.computeUsed += amount;
        } else if (serviceHash == keccak256("cdn")) {
            alloc.cdnUsed += amount;
        }

        emit ServiceUsageRecorded(user, service, amount);
    }

    /**
     * @notice Reduce storage usage (when user deletes content)
     * @param user User address
     * @param amount Amount to reduce
     */
    function reduceStorageUsage(address user, uint256 amount) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();
        
        ServiceAllocation storage alloc = allocations[user];
        if (alloc.storageUsed >= amount) {
            alloc.storageUsed -= amount;
        } else {
            alloc.storageUsed = 0;
        }
    }

    /**
     * @notice Check if user has sufficient allocation
     * @param user User address
     * @param service Service name
     * @param amount Required amount
     */
    function hasAllocation(
        address user,
        string calldata service,
        uint256 amount
    ) external view returns (bool) {
        Tier tier = getTier(user);
        TierConfig storage config = tierConfigs[tier];
        ServiceAllocation storage alloc = allocations[user];

        bool needsReset = block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD;

        bytes32 serviceHash = keccak256(bytes(service));
        uint256 limit;
        uint256 used;
        
        if (serviceHash == keccak256("rpc")) {
            limit = config.rpcRateLimit;
            used = needsReset ? 0 : alloc.rpcUsed;
        } else if (serviceHash == keccak256("storage")) {
            limit = config.storageQuotaMB;
            used = alloc.storageUsed; // Persistent
        } else if (serviceHash == keccak256("compute")) {
            limit = config.computeCredits;
            used = needsReset ? 0 : alloc.computeUsed;
        } else if (serviceHash == keccak256("cdn")) {
            limit = config.cdnBandwidthGB;
            used = needsReset ? 0 : alloc.cdnUsed;
        }

        // 0 limit means unlimited
        if (limit == 0) return true;
        return used + amount <= limit;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Update user's reputation bonus
     * @dev Called by reputation provider
     * @param user User address
     * @param bonusBps Bonus in basis points (0-5000)
     */
    function updateReputationBonus(address user, uint256 bonusBps) external {
        if (msg.sender != reputationProvider && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (bonusBps > MAX_REPUTATION_BONUS_BPS) {
            bonusBps = MAX_REPUTATION_BONUS_BPS;
        }

        StakePosition storage pos = positions[user];
        uint256 oldBonus = pos.reputationBonus;
        
        if (oldBonus != bonusBps) {
            Tier oldTier = getTier(user);
            pos.reputationBonus = bonusBps;
            Tier newTier = getTier(user);

            emit ReputationBonusUpdated(user, oldBonus, bonusBps);

            if (oldTier != newTier && pos.isActive) {
                _updateTierCounts(oldTier, newTier, true);
                emit TierChanged(user, oldTier, newTier);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         MODERATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Freeze user's stake (moderation action)
     * @param user User to freeze
     * @param reason Reason for freezing
     */
    function freezeStake(address user, string calldata reason) external {
        if (msg.sender != address(banManager) && msg.sender != owner()) {
            revert NotAuthorized();
        }

        StakePosition storage pos = positions[user];
        pos.isFrozen = true;
        emit StakeFrozen(user, reason);
    }

    /**
     * @notice Unfreeze user's stake
     * @param user User to unfreeze
     */
    function unfreezeStake(address user) external {
        if (msg.sender != address(banManager) && msg.sender != owner()) {
            revert NotAuthorized();
        }

        StakePosition storage pos = positions[user];
        pos.isFrozen = false;
        emit StakeUnfrozen(user);
    }

    /**
     * @notice Slash user's stake (moderation action)
     * @param user User to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slash(address user, uint256 amount, string calldata reason) external nonReentrant {
        if (msg.sender != address(banManager) && msg.sender != owner()) {
            revert NotAuthorized();
        }

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);

        uint256 slashAmount = amount > pos.stakedAmount ? pos.stakedAmount : amount;
        pos.stakedAmount -= slashAmount;
        totalStaked -= slashAmount;

        // Send slashed amount to treasury
        jejuToken.safeTransfer(treasury, slashAmount);

        Tier newTier = getTier(user);
        if (oldTier != newTier && pos.isActive) {
            _updateTierCounts(oldTier, newTier, true);
            emit TierChanged(user, oldTier, newTier);
        }

        emit Slashed(user, slashAmount, reason);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL
    // ═══════════════════════════════════════════════════════════════════════

    function _updateTierCounts(Tier oldTier, Tier newTier, bool wasActive) internal {
        if (wasActive && tierCounts[oldTier] > 0) {
            tierCounts[oldTier]--;
        }
        tierCounts[newTier]++;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getPosition(address user) external view returns (StakePosition memory) {
        return positions[user];
    }

    function getTierConfig(Tier tier) external view returns (TierConfig memory) {
        return tierConfigs[tier];
    }

    function getRateLimit(address user) external view returns (uint256) {
        Tier tier = getTier(user);
        return tierConfigs[tier].rpcRateLimit;
    }

    function getStakeRequirement(Tier tier) external view returns (uint256 usdValue, uint256 jejuAmount) {
        usdValue = tierConfigs[tier].minUsdValue;
        uint256 price = getJejuPrice();
        if (price > 0) {
            jejuAmount = (usdValue * 1e18) / price;
        }
    }

    function getServiceAllocation(address user) external view returns (ServiceAllocation memory) {
        return allocations[user];
    }

    function getPriceInfo() external view returns (
        uint256 currentPrice,
        uint256 lastGoodPrice,
        uint256 lastUpdateTime,
        address primary,
        address secondary
    ) {
        currentPrice = getJejuPrice();
        lastGoodPrice = lastKnownGoodPrice;
        lastUpdateTime = lastPriceUpdateTime;
        primary = primaryOracle;
        secondary = secondaryOracle;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function setTierConfig(
        Tier tier,
        uint256 minUsdValue,
        uint256 rpcRateLimit,
        uint256 storageQuotaMB,
        uint256 computeCredits,
        uint256 cdnBandwidthGB
    ) external onlyOwner {
        tierConfigs[tier] = TierConfig({
            minUsdValue: minUsdValue,
            rpcRateLimit: rpcRateLimit,
            storageQuotaMB: storageQuotaMB,
            computeCredits: computeCredits,
            cdnBandwidthGB: cdnBandwidthGB
        });
        emit TierConfigUpdated(tier);
    }

    function setAuthorizedService(address service, bool authorized) external onlyOwner {
        authorizedServices[service] = authorized;
        emit AuthorizedServiceUpdated(service, authorized);
    }

    function setWhitelisted(address user, bool status) external onlyOwner {
        whitelisted[user] = status;
    }

    function setIdentityRegistry(address _registry) external onlyOwner {
        identityRegistry = IIdentityRegistryStaking(_registry);
    }

    function setBanManager(address _banManager) external onlyOwner {
        banManager = IBanManagerStaking(_banManager);
    }

    function setReputationProvider(address _provider) external onlyOwner {
        reputationProvider = _provider;
    }

    function setPrimaryOracle(address _oracle) external onlyOwner {
        address old = primaryOracle;
        primaryOracle = _oracle;
        emit OracleUpdated(old, _oracle, true);
    }

    function setSecondaryOracle(address _oracle) external onlyOwner {
        address old = secondaryOracle;
        secondaryOracle = _oracle;
        emit OracleUpdated(old, _oracle, false);
    }

    function setFallbackPrice(uint256 _price) external onlyOwner {
        if (_price < minAllowedPrice || _price > maxAllowedPrice) revert InvalidPriceBounds();
        uint256 old = fallbackPrice;
        fallbackPrice = _price;
        emit PriceUpdated(old, _price, address(0));
    }

    function setPriceBounds(uint256 _minPrice, uint256 _maxPrice) external onlyOwner {
        if (_minPrice >= _maxPrice) revert InvalidPriceBounds();
        if (_minPrice == 0) revert InvalidPriceBounds();
        minAllowedPrice = _minPrice;
        maxAllowedPrice = _maxPrice;
        emit PriceBoundsUpdated(_minPrice, _maxPrice);
    }

    /**
     * @notice Update the last known good price (should be called by keeper)
     * @dev Only updates if current price is valid and within bounds
     */
    function updateLastKnownGoodPrice() external {
        PriceData memory data = _getOraclePrice(primaryOracle);
        
        if (data.isValid && data.price >= minAllowedPrice && data.price <= maxAllowedPrice) {
            uint256 old = lastKnownGoodPrice;
            lastKnownGoodPrice = data.price;
            lastPriceUpdateTime = block.timestamp;
            emit PriceUpdated(old, data.price, primaryOracle);
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
