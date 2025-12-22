// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry { function ownerOf(uint256 tokenId) external view returns (address); }
interface IBanManager { function isAddressBanned(address target) external view returns (bool); }
interface IPriceOracle { function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }

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

    struct TierConfig { uint256 minUsdValue; uint256 rpcRateLimit; uint256 storageQuotaMB; uint256 computeCredits; uint256 cdnBandwidthGB; }
    struct ServiceAllocation { uint256 rpcUsed; uint256 storageUsed; uint256 computeUsed; uint256 cdnUsed; uint256 periodStartTimestamp; }
    struct PriceData { uint256 price; uint256 timestamp; bool isValid; }

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_BONUS_BPS = 5000;
    uint256 public constant BPS = 10000;
    uint256 public constant ALLOCATION_RESET_PERIOD = 30 days;
    uint256 public constant MIN_STAKE = 0.0001 ether;
    uint256 public constant ORACLE_STALENESS = 1 hours;
    uint256 public constant PRICE_DEVIATION_BPS = 5000;

    IERC20 public immutable jejuToken;
    IIdentityRegistry public identityRegistry;
    IBanManager public banManager;
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

    constructor(address _token, address _registry, address _oracle, address _treasury, address _owner) Ownable(_owner) {
        if (_token == address(0) || _treasury == address(0)) revert InvalidAddress();
        jejuToken = IERC20(_token);
        treasury = _treasury;
        if (_registry != address(0)) identityRegistry = IIdentityRegistry(_registry);
        primaryOracle = _oracle;
        lastKnownGoodPrice = fallbackPrice;
        lastPriceUpdateTime = block.timestamp;

        tierConfigs[Tier.FREE] = TierConfig(0, 10, 100, 10, 1);
        tierConfigs[Tier.BUILDER] = TierConfig(10e8, 100, 1000, 100, 10);
        tierConfigs[Tier.PRO] = TierConfig(100e8, 1000, 10000, 1000, 100);
        tierConfigs[Tier.UNLIMITED] = TierConfig(1000e8, 0, 0, 0, 0);
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused { _stake(msg.sender, amount, 0); }
    function stakeWithAgent(uint256 amount, uint256 agentId) external nonReentrant whenNotPaused { _stake(msg.sender, amount, agentId); }

    function _stake(address user, uint256 amount, uint256 agentId) internal {
        if (amount == 0) revert InvalidAmount();
        if (amount < MIN_STAKE) revert BelowMinimumStake();
        if (address(banManager) != address(0) && banManager.isAddressBanned(user)) revert UserIsBanned();

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);
        bool wasActive = pos.isActive;

        jejuToken.safeTransferFrom(user, address(this), amount);

        if (!pos.isActive) { pos.isActive = true; pos.stakedAt = block.timestamp; totalStakers++; }
        pos.stakedAmount += amount;
        totalStaked += amount;

        if (agentId > 0 && pos.linkedAgentId == 0) _linkAgent(user, agentId);

        Tier newTier = getTier(user);
        emit Staked(user, amount, newTier);
        _handleTierChange(oldTier, newTier, wasActive);
    }

    function linkAgent(uint256 agentId) external nonReentrant { _linkAgent(msg.sender, agentId); }

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

        emit UnbondingStarted(msg.sender, amount);
        _handleTierChange(oldTier, getTier(msg.sender), true);
    }

    function completeUnstaking() external nonReentrant {
        StakePosition storage pos = positions[msg.sender];
        if (pos.isFrozen) revert StakeIsFrozen();
        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) revert StillUnbonding();

        uint256 amount = pos.unbondingAmount;
        Tier tier = getTier(msg.sender);

        pos.unbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.stakedAmount == 0) {
            pos.isActive = false;
            totalStakers--;
            if (tierCounts[tier] > 0) tierCounts[tier]--;
        }

        jejuToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function _handleTierChange(Tier oldTier, Tier newTier, bool wasActive) internal {
        if (oldTier != newTier) {
            if (wasActive && tierCounts[oldTier] > 0) tierCounts[oldTier]--;
            tierCounts[newTier]++;
            emit TierChanged(msg.sender, oldTier, newTier);
        } else if (!wasActive) {
            tierCounts[newTier]++;
        }
    }

    function getTier(address user) public view returns (Tier) {
        if (whitelisted[user]) return Tier.UNLIMITED;
        uint256 usd = getEffectiveUsdValue(user);
        if (usd >= tierConfigs[Tier.UNLIMITED].minUsdValue) return Tier.UNLIMITED;
        if (usd >= tierConfigs[Tier.PRO].minUsdValue) return Tier.PRO;
        if (usd >= tierConfigs[Tier.BUILDER].minUsdValue) return Tier.BUILDER;
        return Tier.FREE;
    }

    function getEffectiveUsdValue(address user) public view returns (uint256) {
        StakePosition storage pos = positions[user];
        if (!pos.isActive) return 0;
        uint256 base = (pos.stakedAmount * getJejuPrice()) / 1e18;
        return base + (base * pos.reputationBonus) / BPS;
    }

    function getJejuPrice() public view returns (uint256) {
        PriceData memory p1 = _getOraclePrice(primaryOracle);
        if (_isValidPrice(p1) && (lastKnownGoodPrice == 0 || _deviation(p1.price, lastKnownGoodPrice) <= PRICE_DEVIATION_BPS))
            return p1.price;

        if (secondaryOracle != address(0)) {
            PriceData memory p2 = _getOraclePrice(secondaryOracle);
            if (_isValidPrice(p2)) {
                if (p1.isValid && _deviation(p1.price, p2.price) <= 1000) return (p1.price + p2.price) / 2;
                return p2.price;
            }
        }

        if (lastKnownGoodPrice > 0 && block.timestamp - lastPriceUpdateTime < 24 hours) return lastKnownGoodPrice;
        return fallbackPrice;
    }

    function _getOraclePrice(address oracle) internal view returns (PriceData memory) {
        if (oracle == address(0)) return PriceData(0, 0, false);
        try IPriceOracle(oracle).latestRoundData() returns (uint80, int256 ans, uint256, uint256 at, uint80) {
            if (block.timestamp - at > ORACLE_STALENESS || ans <= 0) return PriceData(0, at, false);
            return PriceData(uint256(ans), at, true);
        } catch { return PriceData(0, 0, false); }
    }

    function _isValidPrice(PriceData memory d) internal view returns (bool) {
        return d.isValid && d.price >= minAllowedPrice && d.price <= maxAllowedPrice;
    }

    function _deviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return BPS;
        uint256 lg = a > b ? a : b;
        uint256 sm = a > b ? b : a;
        return ((lg - sm) * BPS) / lg;
    }

    function _resetAllocationIfNeeded(ServiceAllocation storage alloc) internal {
        if (block.timestamp > alloc.periodStartTimestamp + ALLOCATION_RESET_PERIOD) {
            alloc.rpcUsed = 0;
            alloc.computeUsed = 0;
            alloc.cdnUsed = 0;
            alloc.periodStartTimestamp = block.timestamp;
        }
    }

    function _getServiceData(Service s, TierConfig storage c, ServiceAllocation storage a, bool reset) internal view returns (uint256 lim, uint256 used) {
        if (s == Service.RPC) return (c.rpcRateLimit, reset ? 0 : a.rpcUsed);
        if (s == Service.STORAGE) return (c.storageQuotaMB, a.storageUsed);
        if (s == Service.COMPUTE) return (c.computeCredits, reset ? 0 : a.computeUsed);
        if (s == Service.CDN) return (c.cdnBandwidthGB, reset ? 0 : a.cdnUsed);
        revert InvalidService();
    }

    function _recordUsage(Service s, ServiceAllocation storage a, uint256 amt) internal {
        if (s == Service.RPC) a.rpcUsed += amt;
        else if (s == Service.STORAGE) a.storageUsed += amt;
        else if (s == Service.COMPUTE) a.computeUsed += amt;
        else if (s == Service.CDN) a.cdnUsed += amt;
    }

    function getAllocation(address user, Service s) external view returns (uint256 lim, uint256 used, uint256 rem) {
        ServiceAllocation storage a = allocations[user];
        bool reset = block.timestamp > a.periodStartTimestamp + ALLOCATION_RESET_PERIOD;
        (lim, used) = _getServiceData(s, tierConfigs[getTier(user)], a, reset);
        rem = lim == 0 ? type(uint256).max : (used >= lim ? 0 : lim - used);
    }

    function consumeAllocation(address user, Service s, uint256 amt) external returns (bool) {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();
        ServiceAllocation storage a = allocations[user];
        _resetAllocationIfNeeded(a);

        (uint256 lim, uint256 used) = _getServiceData(s, tierConfigs[getTier(user)], a, false);
        if (lim != 0 && used + amt > lim) { emit AllocationExceeded(user, s, amt, lim - used); revert AllocationExceededError(); }

        _recordUsage(s, a, amt);
        emit ServiceUsageRecorded(user, s, amt);
        return true;
    }

    function recordUsage(address user, Service s, uint256 amt) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();
        ServiceAllocation storage a = allocations[user];
        _resetAllocationIfNeeded(a);
        _recordUsage(s, a, amt);
        emit ServiceUsageRecorded(user, s, amt);
    }

    function reduceStorageUsage(address user, uint256 amt) external {
        if (!authorizedServices[msg.sender]) revert NotAuthorized();
        ServiceAllocation storage a = allocations[user];
        a.storageUsed = a.storageUsed >= amt ? a.storageUsed - amt : 0;
    }

    function hasAllocation(address user, Service s, uint256 amt) external view returns (bool) {
        ServiceAllocation storage a = allocations[user];
        (uint256 lim, uint256 used) = _getServiceData(s, tierConfigs[getTier(user)], a, block.timestamp > a.periodStartTimestamp + ALLOCATION_RESET_PERIOD);
        return lim == 0 || used + amt <= lim;
    }

    function updateReputationBonus(address user, uint256 bps) external {
        if (msg.sender != reputationProvider && msg.sender != owner()) revert NotAuthorized();
        if (bps > MAX_REPUTATION_BONUS_BPS) bps = MAX_REPUTATION_BONUS_BPS;

        StakePosition storage pos = positions[user];
        uint256 old = pos.reputationBonus;
        if (old != bps) {
            Tier oldTier = getTier(user);
            pos.reputationBonus = bps;
            emit ReputationBonusUpdated(user, old, bps);
            if (pos.isActive) _handleTierChange(oldTier, getTier(user), true);
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

    function slash(address user, uint256 amt, string calldata reason) external nonReentrant {
        if (msg.sender != address(banManager) && msg.sender != owner()) revert NotAuthorized();

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);

        uint256 slashAmt = amt > pos.stakedAmount ? pos.stakedAmount : amt;
        pos.stakedAmount -= slashAmt;
        totalStaked -= slashAmt;

        jejuToken.safeTransfer(treasury, slashAmt);

        if (pos.isActive) _handleTierChange(oldTier, getTier(user), true);
        emit Slashed(user, slashAmt, reason);
    }

    function getPosition(address u) external view returns (StakePosition memory) { return positions[u]; }
    function getTierConfig(Tier t) external view returns (TierConfig memory) { return tierConfigs[t]; }
    function getRateLimit(address u) external view returns (uint256) { return tierConfigs[getTier(u)].rpcRateLimit; }
    function getServiceAllocation(address u) external view returns (ServiceAllocation memory) { return allocations[u]; }

    function getStakeRequirement(Tier t) external view returns (uint256 usd, uint256 jeju) {
        usd = tierConfigs[t].minUsdValue;
        uint256 p = getJejuPrice();
        if (p > 0) jeju = (usd * 1e18) / p;
    }

    function getPriceInfo() external view returns (uint256, uint256, uint256, address, address) {
        return (getJejuPrice(), lastKnownGoodPrice, lastPriceUpdateTime, primaryOracle, secondaryOracle);
    }

    function setTierConfig(Tier t, uint256 usd, uint256 rpc, uint256 storage_, uint256 compute, uint256 cdn) external onlyOwner {
        tierConfigs[t] = TierConfig(usd, rpc, storage_, compute, cdn);
        emit TierConfigUpdated(t);
    }

    function setAuthorizedService(address s, bool auth) external onlyOwner { authorizedServices[s] = auth; emit AuthorizedServiceUpdated(s, auth); }
    function setWhitelisted(address u, bool v) external onlyOwner { whitelisted[u] = v; }
    function setIdentityRegistry(address r) external onlyOwner { identityRegistry = IIdentityRegistry(r); }
    function setBanManager(address b) external onlyOwner { banManager = IBanManager(b); }
    function setReputationProvider(address p) external onlyOwner { reputationProvider = p; }

    function setPrimaryOracle(address o) external onlyOwner { emit OracleUpdated(primaryOracle, o, true); primaryOracle = o; }
    function setSecondaryOracle(address o) external onlyOwner { emit OracleUpdated(secondaryOracle, o, false); secondaryOracle = o; }

    function setFallbackPrice(uint256 p) external onlyOwner {
        if (p < minAllowedPrice || p > maxAllowedPrice) revert InvalidPriceBounds();
        emit PriceUpdated(fallbackPrice, p, address(0));
        fallbackPrice = p;
    }

    function setPriceBounds(uint256 min_, uint256 max_) external onlyOwner {
        if (min_ >= max_ || min_ == 0) revert InvalidPriceBounds();
        minAllowedPrice = min_;
        maxAllowedPrice = max_;
        emit PriceBoundsUpdated(min_, max_);
    }

    function updateLastKnownGoodPrice() external {
        PriceData memory d = _getOraclePrice(primaryOracle);
        if (_isValidPrice(d)) {
            emit PriceUpdated(lastKnownGoodPrice, d.price, primaryOracle);
            lastKnownGoodPrice = d.price;
            lastPriceUpdateTime = block.timestamp;
        }
    }

    function setTreasury(address t) external onlyOwner { if (t == address(0)) revert InvalidAddress(); treasury = t; }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function version() external pure returns (string memory) { return "2.0.0"; }
}
