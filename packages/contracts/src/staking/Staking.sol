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
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/**
 * @title Staking
 * @notice Universal JEJU staking for DWS services with USD-denominated tiers
 * @dev Single stake provides access to RPC, storage, compute, CDN, and oracle services.
 *      Tiers: FREE ($0), BUILDER ($10), PRO ($100), UNLIMITED ($1000)
 */
contract Staking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier { FREE, BUILDER, PRO, UNLIMITED }
    enum Service { RPC, STORAGE, COMPUTE, CDN }

    struct StakePosition {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 linkedAgentId;
        uint256 reputationBonus;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        bool isActive;
        bool isFrozen;
    }

    struct TierConfig {
        uint256 minUsdValue;
        uint256 rpcRateLimit;
        uint256 storageQuotaMB;
        uint256 computeCredits;
        uint256 cdnBandwidthGB;
    }

    struct ServiceAllocation {
        uint256 rpcUsed;
        uint256 storageUsed;
        uint256 computeUsed;
        uint256 cdnUsed;
        uint256 periodStartTimestamp;
    }

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        bool isValid;
    }

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_BONUS_BPS = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant ALLOCATION_RESET_PERIOD = 30 days;
    uint256 public constant MIN_STAKE_AMOUNT = 0.0001 ether;
    uint256 public constant ORACLE_STALENESS_THRESHOLD = 1 hours;
    uint256 public constant PRICE_DEVIATION_THRESHOLD_BPS = 5000;

    IERC20 public immutable jejuToken;
    IIdentityRegistryStaking public identityRegistry;
    IBanManagerStaking public banManager;
    address public reputationProvider;
    address public primaryOracle;
    address public secondaryOracle;
    address public treasury;

    uint256 public fallbackPrice = 1e8;
    uint256 public lastKnownGoodPrice;
    uint256 public lastPriceUpdateTime;
    uint256 public minAllowedPrice = 1e6;
    uint256 public maxAllowedPrice = 1e12;
    uint256 public totalStaked;
    uint256 public totalStakers;

    mapping(address => StakePosition) public positions;
    mapping(Tier => TierConfig) public tierConfigs;
    mapping(address => ServiceAllocation) public allocations;
    mapping(address => bool) public whitelisted;
    mapping(address => bool) public authorizedServices;
    mapping(Tier => uint256) public tierCounts;

    event Staked(address indexed user, uint256 amount, Tier tier);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);
    event AgentLinked(address indexed user, uint256 agentId);
    event ReputationBonusUpdated(address indexed user, uint256 oldBonus, uint256 newBonus);
    event StakeFrozen(address indexed user, string reason);
    event StakeUnfrozen(address indexed user);
    event Slashed(address indexed user, uint256 amount, string reason);
    event ServiceUsageRecorded(address indexed user, Service service, uint256 amount);
    event AllocationExceeded(address indexed user, Service service, uint256 requested, uint256 available);
    event TierConfigUpdated(Tier tier);
    event AuthorizedServiceUpdated(address indexed service, bool authorized);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice, address oracle);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle, bool isPrimary);
    event PriceBoundsUpdated(uint256 minPrice, uint256 maxPrice);

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
    error InvalidService();

    constructor(address _jejuToken, address _identityRegistry, address _primaryOracle, address _treasury, address _owner) Ownable(_owner) {
        if (_jejuToken == address(0) || _treasury == address(0)) revert InvalidAddress();

        jejuToken = IERC20(_jejuToken);
        treasury = _treasury;
        if (_identityRegistry != address(0)) identityRegistry = IIdentityRegistryStaking(_identityRegistry);
        primaryOracle = _primaryOracle;
        lastKnownGoodPrice = fallbackPrice;
        lastPriceUpdateTime = block.timestamp;

        tierConfigs[Tier.FREE] = TierConfig(0, 10, 100, 10, 1);
        tierConfigs[Tier.BUILDER] = TierConfig(10e8, 100, 1000, 100, 10);
        tierConfigs[Tier.PRO] = TierConfig(100e8, 1000, 10000, 1000, 100);
        tierConfigs[Tier.UNLIMITED] = TierConfig(1000e8, 0, 0, 0, 0);
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        _stake(msg.sender, amount, 0);
    }

    function stakeWithAgent(uint256 amount, uint256 agentId) external nonReentrant whenNotPaused {
        _stake(msg.sender, amount, agentId);
    }

    function _stake(address user, uint256 amount, uint256 agentId) internal {
        if (amount == 0) revert InvalidAmount();
        if (amount < MIN_STAKE_AMOUNT) revert BelowMinimumStake();
        if (address(banManager) != address(0) && banManager.isAddressBanned(user)) revert UserIsBanned();

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

        if (agentId > 0 && pos.linkedAgentId == 0) _linkAgent(user, agentId);

        Tier newTier = getTier(user);
        emit Staked(user, amount, newTier);

        if (oldTier != newTier) {
            _updateTierCounts(oldTier, newTier, wasActive);
            emit TierChanged(user, oldTier, newTier);
        } else if (!wasActive) {
            tierCounts[newTier]++;
        }
    }

    function linkAgent(uint256 agentId) external nonReentrant {
        _linkAgent(msg.sender, agentId);
    }

    function _linkAgent(address user, uint256 agentId) internal {
        StakePosition storage pos = positions[user];
        if (pos.linkedAgentId != 0) revert AlreadyLinked();
        if (address(identityRegistry) != address(0) && identityRegistry.ownerOf(agentId) != user) revert AgentNotOwned();
        pos.linkedAgentId = agentId;
        emit AgentLinked(user, agentId);
    }

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

    function completeUnstaking() external nonReentrant {
        StakePosition storage pos = positions[msg.sender];
        if (pos.isFrozen) revert StakeIsFrozen();
        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) revert StillUnbonding();

        uint256 amount = pos.unbondingAmount;
        Tier currentTier = getTier(msg.sender);

        pos.unbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.stakedAmount == 0) {
            pos.isActive = false;
            totalStakers--;
            if (tierCounts[currentTier] > 0) tierCounts[currentTier]--;
        }

        jejuToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function getTier(address user) public view returns (Tier) {
        if (whitelisted[user]) return Tier.UNLIMITED;
        uint256 effectiveUsd = getEffectiveUsdValue(user);
        if (effectiveUsd >= tierConfigs[Tier.UNLIMITED].minUsdValue) return Tier.UNLIMITED;
        if (effectiveUsd >= tierConfigs[Tier.PRO].minUsdValue) return Tier.PRO;
        if (effectiveUsd >= tierConfigs[Tier.BUILDER].minUsdValue) return Tier.BUILDER;
        return Tier.FREE;
    }

    function getEffectiveUsdValue(address user) public view returns (uint256) {
        StakePosition storage pos = positions[user];
        if (!pos.isActive) return 0;
        uint256 baseUsd = (pos.stakedAmount * getJejuPrice()) / 1e18;
        return baseUsd + (baseUsd * pos.reputationBonus) / BPS_DENOMINATOR;
    }

    function getJejuPrice() public view returns (uint256) {
        PriceData memory primaryData = _getOraclePrice(primaryOracle);
        
        if (primaryData.isValid && primaryData.price >= minAllowedPrice && primaryData.price <= maxAllowedPrice) {
            if (lastKnownGoodPrice == 0 || _calculateDeviation(primaryData.price, lastKnownGoodPrice) <= PRICE_DEVIATION_THRESHOLD_BPS) {
                return primaryData.price;
            }
        }

        if (secondaryOracle != address(0)) {
            PriceData memory secondaryData = _getOraclePrice(secondaryOracle);
            if (secondaryData.isValid && secondaryData.price >= minAllowedPrice && secondaryData.price <= maxAllowedPrice) {
                if (primaryData.isValid && _calculateDeviation(primaryData.price, secondaryData.price) <= 1000) {
                    return (primaryData.price + secondaryData.price) / 2;
                }
                return secondaryData.price;
            }
        }

        if (lastKnownGoodPrice > 0 && block.timestamp - lastPriceUpdateTime < 24 hours) {
            return lastKnownGoodPrice;
        }
        return fallbackPrice;
    }

    function _getOraclePrice(address oracle) internal view returns (PriceData memory) {
        if (oracle == address(0)) return PriceData(0, 0, false);

        try IPriceOracleStaking(oracle).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (block.timestamp - updatedAt > ORACLE_STALENESS_THRESHOLD || answer <= 0) {
                return PriceData(0, updatedAt, false);
            }
            return PriceData(uint256(answer), updatedAt, true);
        } catch {
            return PriceData(0, 0, false);
        }
    }

    function _calculateDeviation(uint256 price1, uint256 price2) internal pure returns (uint256) {
        if (price1 == 0 || price2 == 0) return BPS_DENOMINATOR;
        uint256 larger = price1 > price2 ? price1 : price2;
        uint256 smaller = price1 > price2 ? price2 : price1;
        return ((larger - smaller) * BPS_DENOMINATOR) / larger;
    }

    function _getServiceData(Service service, TierConfig storage config, ServiceAllocation storage alloc, bool needsReset) internal view returns (uint256 limit, uint256 used) {
        if (service == Service.RPC) return (config.rpcRateLimit, needsReset ? 0 : alloc.rpcUsed);
        if (service == Service.STORAGE) return (config.storageQuotaMB, alloc.storageUsed);
        if (service == Service.COMPUTE) return (config.computeCredits, needsReset ? 0 : alloc.computeUsed);
        if (service == Service.CDN) return (config.cdnBandwidthGB, needsReset ? 0 : alloc.cdnUsed);
        revert InvalidService();
    }

    function _recordServiceUsage(Service service, ServiceAllocation storage alloc, uint256 amount) internal {
        if (service == Service.RPC) alloc.rpcUsed += amount;
        else if (service == Service.STORAGE) alloc.storageUsed += amount;
        else if (service == Service.COMPUTE) alloc.computeUsed += amount;
        else if (service == Service.CDN) alloc.cdnUsed += amount;
    }

    function getAllocation(address user, Service service) external view returns (uint256 limit, uint256 used, uint256 remaining) {
        TierConfig storage config = tierConfigs[getTier(user)];
        ServiceAllocation storage alloc = allocations[user];
        bool needsReset = block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD;
        (limit, used) = _getServiceData(service, config, alloc, needsReset);
        remaining = limit == 0 ? type(uint256).max : (used >= limit ? 0 : limit - used);
    }

    function consumeAllocation(address user, Service service, uint256 amount) external returns (bool) {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();

        ServiceAllocation storage alloc = allocations[user];
        if (block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.periodStartTimestamp = block.timestamp;
        }

        TierConfig storage config = tierConfigs[getTier(user)];
        (uint256 limit, uint256 currentUsed) = _getServiceData(service, config, alloc, false);

        if (limit != 0 && currentUsed + amount > limit) {
            emit AllocationExceeded(user, service, amount, limit - currentUsed);
            revert AllocationExceededError();
        }

        _recordServiceUsage(service, alloc, amount);
        emit ServiceUsageRecorded(user, service, amount);
        return true;
    }

    function recordUsage(address user, Service service, uint256 amount) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();

        ServiceAllocation storage alloc = allocations[user];
        if (block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.periodStartTimestamp = block.timestamp;
        }

        _recordServiceUsage(service, alloc, amount);
        emit ServiceUsageRecorded(user, service, amount);
    }

    function reduceStorageUsage(address user, uint256 amount) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();
        ServiceAllocation storage alloc = allocations[user];
        alloc.storageUsed = alloc.storageUsed >= amount ? alloc.storageUsed - amount : 0;
    }

    function hasAllocation(address user, Service service, uint256 amount) external view returns (bool) {
        TierConfig storage config = tierConfigs[getTier(user)];
        ServiceAllocation storage alloc = allocations[user];
        bool needsReset = block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD;
        (uint256 limit, uint256 used) = _getServiceData(service, config, alloc, needsReset);
        return limit == 0 || used + amount <= limit;
    }

    function updateReputationBonus(address user, uint256 bonusBps) external {
        if (msg.sender != reputationProvider && msg.sender != owner()) revert NotAuthorized();
        if (bonusBps > MAX_REPUTATION_BONUS_BPS) bonusBps = MAX_REPUTATION_BONUS_BPS;

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

    function freezeStake(address user, string calldata reason) external {
        if (msg.sender != address(banManager) && msg.sender != owner()) revert NotAuthorized();
        positions[user].isFrozen = true;
        emit StakeFrozen(user, reason);
    }

    function unfreezeStake(address user) external {
        if (msg.sender != address(banManager) && msg.sender != owner()) revert NotAuthorized();
        positions[user].isFrozen = false;
        emit StakeUnfrozen(user);
    }

    function slash(address user, uint256 amount, string calldata reason) external nonReentrant {
        if (msg.sender != address(banManager) && msg.sender != owner()) revert NotAuthorized();

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);

        uint256 slashAmount = amount > pos.stakedAmount ? pos.stakedAmount : amount;
        pos.stakedAmount -= slashAmount;
        totalStaked -= slashAmount;

        jejuToken.safeTransfer(treasury, slashAmount);

        Tier newTier = getTier(user);
        if (oldTier != newTier && pos.isActive) {
            _updateTierCounts(oldTier, newTier, true);
            emit TierChanged(user, oldTier, newTier);
        }
        emit Slashed(user, slashAmount, reason);
    }

    function _updateTierCounts(Tier oldTier, Tier newTier, bool wasActive) internal {
        if (wasActive && tierCounts[oldTier] > 0) tierCounts[oldTier]--;
        tierCounts[newTier]++;
    }

    function getPosition(address user) external view returns (StakePosition memory) { return positions[user]; }
    function getTierConfig(Tier tier) external view returns (TierConfig memory) { return tierConfigs[tier]; }
    function getRateLimit(address user) external view returns (uint256) { return tierConfigs[getTier(user)].rpcRateLimit; }
    function getServiceAllocation(address user) external view returns (ServiceAllocation memory) { return allocations[user]; }

    function getStakeRequirement(Tier tier) external view returns (uint256 usdValue, uint256 jejuAmount) {
        usdValue = tierConfigs[tier].minUsdValue;
        uint256 price = getJejuPrice();
        if (price > 0) jejuAmount = (usdValue * 1e18) / price;
    }

    function getPriceInfo() external view returns (uint256 currentPrice, uint256 lastGoodPrice, uint256 lastUpdateTime, address primary, address secondary) {
        return (getJejuPrice(), lastKnownGoodPrice, lastPriceUpdateTime, primaryOracle, secondaryOracle);
    }

    function setTierConfig(Tier tier, uint256 minUsdValue, uint256 rpcRateLimit, uint256 storageQuotaMB, uint256 computeCredits, uint256 cdnBandwidthGB) external onlyOwner {
        tierConfigs[tier] = TierConfig(minUsdValue, rpcRateLimit, storageQuotaMB, computeCredits, cdnBandwidthGB);
        emit TierConfigUpdated(tier);
    }

    function setAuthorizedService(address service, bool authorized) external onlyOwner {
        authorizedServices[service] = authorized;
        emit AuthorizedServiceUpdated(service, authorized);
    }

    function setWhitelisted(address user, bool status) external onlyOwner { whitelisted[user] = status; }
    function setIdentityRegistry(address _registry) external onlyOwner { identityRegistry = IIdentityRegistryStaking(_registry); }
    function setBanManager(address _banManager) external onlyOwner { banManager = IBanManagerStaking(_banManager); }
    function setReputationProvider(address _provider) external onlyOwner { reputationProvider = _provider; }

    function setPrimaryOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(primaryOracle, _oracle, true);
        primaryOracle = _oracle;
    }

    function setSecondaryOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(secondaryOracle, _oracle, false);
        secondaryOracle = _oracle;
    }

    function setFallbackPrice(uint256 _price) external onlyOwner {
        if (_price < minAllowedPrice || _price > maxAllowedPrice) revert InvalidPriceBounds();
        emit PriceUpdated(fallbackPrice, _price, address(0));
        fallbackPrice = _price;
    }

    function setPriceBounds(uint256 _minPrice, uint256 _maxPrice) external onlyOwner {
        if (_minPrice >= _maxPrice || _minPrice == 0) revert InvalidPriceBounds();
        minAllowedPrice = _minPrice;
        maxAllowedPrice = _maxPrice;
        emit PriceBoundsUpdated(_minPrice, _maxPrice);
    }

    function updateLastKnownGoodPrice() external {
        PriceData memory data = _getOraclePrice(primaryOracle);
        if (data.isValid && data.price >= minAllowedPrice && data.price <= maxAllowedPrice) {
            emit PriceUpdated(lastKnownGoodPrice, data.price, primaryOracle);
            lastKnownGoodPrice = data.price;
            lastPriceUpdateTime = block.timestamp;
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function version() external pure returns (string memory) { return "2.0.0"; }
}
