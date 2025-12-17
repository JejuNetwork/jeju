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
 * Tier System:
 * - Tiers based on USD value of JEJU stake
 * - Reputation bonus increases effective stake value
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
        uint256 rpcUsed;
        uint256 storageUsed;
        uint256 computeUsed;
        uint256 cdnUsed;
        uint256 lastResetTimestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_BONUS_BPS = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant USD_DECIMALS = 8;
    uint256 public constant ALLOCATION_RESET_PERIOD = 30 days;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable jejuToken;

    IIdentityRegistryStaking public identityRegistry;
    IBanManagerStaking public banManager;
    address public reputationProvider;
    address public priceOracle;
    uint256 public fallbackPrice = 1e7; // $0.10 default (8 decimals)

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
    event ServiceUsageRecorded(
        address indexed user,
        string service,
        uint256 amount
    );
    event TierConfigUpdated(Tier tier);
    event AuthorizedServiceUpdated(address indexed service, bool authorized);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAmount();
    error InsufficientBalance();
    error UserIsBanned();
    error StakeIsFrozen();
    error NotUnbonding();
    error StillUnbonding();
    error AlreadyLinked();
    error AgentNotOwned();
    error InvalidAddress();
    error NotAuthorized();
    error AllocationExceeded();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _priceOracle,
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
        priceOracle = _priceOracle;

        // Initialize tier configs (USD values in 8 decimals)
        // FREE tier
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
     * @notice Get JEJU price in USD (8 decimals)
     */
    function getJejuPrice() public view returns (uint256) {
        if (priceOracle == address(0)) return fallbackPrice;

        try IPriceOracleStaking(priceOracle).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            // Check staleness (max 1 hour)
            if (block.timestamp - updatedAt > 3600) return fallbackPrice;
            if (answer <= 0) return fallbackPrice;
            return uint256(answer);
        } catch {
            return fallbackPrice;
        }
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

        // Reset allocation if period expired
        bool needsReset = block.timestamp > alloc.lastResetTimestamp + ALLOCATION_RESET_PERIOD;

        bytes32 serviceHash = keccak256(bytes(service));
        
        if (serviceHash == keccak256("rpc")) {
            limit = config.rpcRateLimit;
            used = needsReset ? 0 : alloc.rpcUsed;
        } else if (serviceHash == keccak256("storage")) {
            limit = config.storageQuotaMB;
            used = needsReset ? 0 : alloc.storageUsed;
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
     * @notice Record service usage (called by authorized services)
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
        if (block.timestamp > alloc.lastResetTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.storageUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.lastResetTimestamp = block.timestamp;
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

        bool needsReset = block.timestamp > alloc.lastResetTimestamp + ALLOCATION_RESET_PERIOD;

        bytes32 serviceHash = keccak256(bytes(service));
        uint256 limit;
        uint256 used;
        
        if (serviceHash == keccak256("rpc")) {
            limit = config.rpcRateLimit;
            used = needsReset ? 0 : alloc.rpcUsed;
        } else if (serviceHash == keccak256("storage")) {
            limit = config.storageQuotaMB;
            used = needsReset ? 0 : alloc.storageUsed;
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
     */
    function slash(address user, uint256 amount) external nonReentrant {
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

    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = _oracle;
    }

    function setFallbackPrice(uint256 _price) external onlyOwner {
        fallbackPrice = _price;
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
        return "1.0.0";
    }
}
