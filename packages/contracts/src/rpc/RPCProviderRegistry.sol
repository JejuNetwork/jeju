// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {PerformanceMetrics} from "../registry/PerformanceMetrics.sol";

/**
 * @title RPCProviderRegistry
 * @author Jeju Network
 * @notice Registry for RPC providers with staking and rate limiting
 * @dev Migrated from RPCStakingManager to use ProviderRegistryBase pattern.
 *      Now consistent with ComputeRegistry and StorageProviderRegistry.
 *
 * Features:
 * - Provider registration with stake (ETH or JEJU)
 * - USD-denominated tier system for rate limits
 * - Reputation-based discount on stake requirements
 * - ERC-8004 agent integration
 * - Moderation integration via ProviderRegistryBase
 *
 * Rate Limit Tiers (USD-denominated):
 * - FREE:      $0    → 10 req/min
 * - BASIC:     $10   → 100 req/min
 * - PRO:       $100  → 1,000 req/min
 * - UNLIMITED: $1000 → unlimited
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract RPCProviderRegistry is ProviderRegistryBase {
    using SafeERC20 for IERC20;
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;
    using PerformanceMetrics for PerformanceMetrics.Metrics;

    enum Tier { FREE, BASIC, PRO, UNLIMITED }

    struct TierConfig {
        uint256 minUsdValue;
        uint256 rateLimit;
    }

    struct RPCProvider {
        address operator;
        string endpoint;
        string region;
        uint256 stake;
        uint256 jejuStake;
        uint256 registeredAt;
        uint256 lastSeen;
        uint256 requestsServed;
        uint256 agentId;
        bool isActive;
        bool isFrozen;
    }

    struct RPCUser {
        uint256 stakedAmount;
        uint256 agentId;
        uint256 stakedAt;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        bool isActive;
        bool isFrozen;
    }

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_DISCOUNT_BPS = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;

    IERC20 public immutable jejuToken;
    mapping(address => RPCProvider) private _providers;
    mapping(address => PerformanceMetrics.Metrics) public metrics; // New: Performance tracking
    mapping(address => RPCUser) public users;
    mapping(Tier => TierConfig) public tierConfigs;
    mapping(address => bool) public whitelisted;
    address public priceOracle;
    uint256 public fallbackPrice = 1e7;
    address public reputationProvider;
    address public treasury;
    uint256 public totalUserStaked;
    uint256 public totalUsers;
    mapping(Tier => uint256) public tierCounts;

    event RPCProviderRegistered(address indexed provider, string endpoint, string region, uint256 stake, uint256 agentId);
    event RPCProviderUpdated(address indexed provider, string endpoint);
    event UserStaked(address indexed user, uint256 amount, Tier tier);
    event UserUnbondingStarted(address indexed user, uint256 amount);
    event UserUnstaked(address indexed user, uint256 amount);
    event UserTierChanged(address indexed user, Tier oldTier, Tier newTier);
    event UserFrozen(address indexed user, string reason);
    event UserUnfrozen(address indexed user);
    event UserSlashed(address indexed user, uint256 amount, bytes32 reportId);
    event PriceOracleUpdated(address indexed oracle);
    event ReputationProviderUpdated(address indexed provider);
    event AgentLinked(address indexed user, uint256 agentId);
    event PerformanceReported(address indexed provider, uint256 uptime, uint256 successRate, uint256 latency);

    error InvalidAmount();
    error InvalidEndpoint();
    error InvalidRegion();
    error InvalidTreasury();
    error InsufficientBalance();
    error UserIsFrozen();
    error UserNotFrozen();
    error AlreadyLinked();
    error AgentNotOwned();
    error NotUnbonding();
    error StillUnbonding();
    error InvalidScore();

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _banManager,
        address _priceOracle,
        address _owner
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, 0.1 ether) {
        jejuToken = IERC20(_jejuToken);
        priceOracle = _priceOracle;

        tierConfigs[Tier.FREE] = TierConfig({minUsdValue: 0, rateLimit: 10});
        tierConfigs[Tier.BASIC] = TierConfig({minUsdValue: 10e8, rateLimit: 100});
        tierConfigs[Tier.PRO] = TierConfig({minUsdValue: 100e8, rateLimit: 1000});
        tierConfigs[Tier.UNLIMITED] = TierConfig({minUsdValue: 1000e8, rateLimit: 0});
    }

    function registerProvider(string calldata endpoint, string calldata region) external payable nonReentrant whenNotPaused {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (bytes(region).length == 0) revert InvalidRegion();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, endpoint, region, 0);
    }

    function registerProviderWithAgent(string calldata endpoint, string calldata region, uint256 agentId) external payable nonReentrant whenNotPaused {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (bytes(region).length == 0) revert InvalidRegion();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, endpoint, region, agentId);
    }

    function _storeProviderData(address provider, string calldata endpoint, string calldata region, uint256 agentId) internal {
        _providers[provider] = RPCProvider({
            operator: provider,
            endpoint: endpoint,
            region: region,
            stake: msg.value,
            jejuStake: 0,
            registeredAt: block.timestamp,
            lastSeen: block.timestamp,
            requestsServed: 0,
            agentId: agentId,
            isActive: true,
            isFrozen: false
        });

        emit RPCProviderRegistered(provider, endpoint, region, msg.value, agentId);
    }

    function _onProviderRegistered(address, uint256, uint256) internal override {}

    function stakeForAccess(uint256 amount) external nonReentrant whenNotPaused {
        _stakeForAccess(msg.sender, amount, 0);
    }

    function stakeForAccessWithAgent(uint256 amount, uint256 agentId) external nonReentrant whenNotPaused {
        _stakeForAccess(msg.sender, amount, agentId);
    }

    function _stakeForAccess(address user, uint256 amount, uint256 agentId) internal {
        if (amount == 0) revert InvalidAmount();
        moderation.requireNotBanned(user);

        RPCUser storage u = users[user];
        Tier oldTier = getUserTier(user);
        bool wasActive = u.isActive;

        jejuToken.safeTransferFrom(user, address(this), amount);

        if (!u.isActive) {
            u.isActive = true;
            u.stakedAt = block.timestamp;
            totalUsers++;
        }
        u.stakedAmount += amount;
        totalUserStaked += amount;

        if (agentId > 0 && u.agentId == 0) {
            _linkUserAgent(user, agentId);
        }

        Tier newTier = getUserTier(user);
        emit UserStaked(user, amount, newTier);

        if (oldTier != newTier) {
            _updateTierCounts(oldTier, newTier, wasActive);
            emit UserTierChanged(user, oldTier, newTier);
        } else if (!wasActive) {
            tierCounts[newTier]++;
        }
    }

    function _linkUserAgent(address user, uint256 agentId) internal {
        RPCUser storage u = users[user];
        if (u.agentId != 0) revert AlreadyLinked();

        if (address(erc8004.identityRegistry) != address(0)) {
            if (erc8004.identityRegistry.ownerOf(agentId) != user) revert AgentNotOwned();
        }

        u.agentId = agentId;
        emit AgentLinked(user, agentId);
    }

    function startUnbonding(uint256 amount) external nonReentrant {
        RPCUser storage u = users[msg.sender];

        if (u.isFrozen) revert UserIsFrozen();
        if (amount == 0) revert InvalidAmount();
        if (amount > u.stakedAmount) revert InvalidAmount();
        if (u.unbondingStartTime > 0) revert StillUnbonding();

        Tier oldTier = getUserTier(msg.sender);

        u.unbondingAmount = amount;
        u.unbondingStartTime = block.timestamp;
        u.stakedAmount -= amount;
        totalUserStaked -= amount;

        Tier newTier = getUserTier(msg.sender);

        emit UserUnbondingStarted(msg.sender, amount);
        if (oldTier != newTier) {
            _updateTierCounts(oldTier, newTier, true);
            emit UserTierChanged(msg.sender, oldTier, newTier);
        }
    }

    function completeUnstaking() external nonReentrant {
        RPCUser storage u = users[msg.sender];

        if (u.isFrozen) revert UserIsFrozen();
        if (u.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < u.unbondingStartTime + UNBONDING_PERIOD) revert StillUnbonding();

        uint256 amount = u.unbondingAmount;
        Tier currentTier = getUserTier(msg.sender);

        u.unbondingAmount = 0;
        u.unbondingStartTime = 0;

        if (u.stakedAmount == 0) {
            u.isActive = false;
            totalUsers--;
            if (tierCounts[currentTier] > 0) {
                tierCounts[currentTier]--;
            }
        }

        jejuToken.safeTransfer(msg.sender, amount);
        emit UserUnstaked(msg.sender, amount);
    }

    function getProvider(address provider) external view returns (RPCProvider memory) {
        return _providers[provider];
    }

    function getUser(address user) external view returns (RPCUser memory) {
        return users[user];
    }

    function getUserTier(address user) public view returns (Tier) {
        if (whitelisted[user]) return Tier.UNLIMITED;
        uint256 usdValue = getUserStakeUsdValue(user);
        return _calculateTier(usdValue);
    }

    function getUserRateLimit(address user) external view returns (uint256) {
        return tierConfigs[getUserTier(user)].rateLimit;
    }

    function getUserStakeUsdValue(address user) public view returns (uint256) {
        uint256 effectiveStake = getEffectiveStake(user);
        uint256 price = getJejuPrice();
        return (effectiveStake * price) / 1e18;
    }

    function getEffectiveStake(address user) public view returns (uint256) {
        RPCUser storage u = users[user];
        uint256 discountBps = getReputationDiscount(user);
        if (discountBps > 0) {
            return (u.stakedAmount * (BPS_DENOMINATOR + discountBps)) / BPS_DENOMINATOR;
        }
        return u.stakedAmount;
    }

    function getJejuPrice() public view returns (uint256) {
        if (priceOracle == address(0)) return fallbackPrice;

        (bool success, bytes memory data) = priceOracle.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );

        if (success && data.length >= 160) {
            (, int256 price,,,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
            if (price > 0) return uint256(price);
        }

        return fallbackPrice;
    }

    function getReputationDiscount(address user) public view returns (uint256) {
        if (reputationProvider == address(0)) return 0;

        (bool success, bytes memory data) = reputationProvider.staticcall(
            abi.encodeWithSignature("getStakeDiscount(address)", user)
        );

        if (success && data.length >= 32) {
            uint256 discount = abi.decode(data, (uint256));
            return discount > MAX_REPUTATION_DISCOUNT_BPS ? MAX_REPUTATION_DISCOUNT_BPS : discount;
        }

        return 0;
    }

    function canUserAccess(address user) external view returns (bool) {
        if (whitelisted[user]) return true;
        if (users[user].isFrozen) return false;
        if (moderation.isAddressBanned(user)) return false;

        RPCUser storage u = users[user];
        if (u.agentId > 0 && moderation.isAgentBanned(u.agentId)) {
            return false;
        }

        return true;
    }

    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].isActive) activeCount++;
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (_providers[providerList[i]].isActive) active[j++] = providerList[i];
        }

        return active;
    }

    function _calculateTier(uint256 usdValue) internal view returns (Tier) {
        if (usdValue >= tierConfigs[Tier.UNLIMITED].minUsdValue) return Tier.UNLIMITED;
        if (usdValue >= tierConfigs[Tier.PRO].minUsdValue) return Tier.PRO;
        if (usdValue >= tierConfigs[Tier.BASIC].minUsdValue) return Tier.BASIC;
        return Tier.FREE;
    }

    function _updateTierCounts(Tier oldTier, Tier newTier, bool wasActive) internal {
        if (wasActive && tierCounts[oldTier] > 0) tierCounts[oldTier]--;
        tierCounts[newTier]++;
    }

    function freezeUser(address user, string calldata reason) external onlyOwner {
        RPCUser storage u = users[user];
        if (u.isFrozen) revert UserIsFrozen();
        u.isFrozen = true;
        emit UserFrozen(user, reason);
    }

    function unfreezeUser(address user) external onlyOwner {
        RPCUser storage u = users[user];
        if (!u.isFrozen) revert UserNotFrozen();
        u.isFrozen = false;
        emit UserUnfrozen(user);
    }

    function slashUser(address user, uint256 amount, bytes32 reportId) external onlyOwner {
        RPCUser storage u = users[user];

        uint256 slashable = u.stakedAmount;
        uint256 toSlash = amount > slashable ? slashable : amount;
        if (toSlash == 0) revert InvalidAmount();

        Tier oldTier = getUserTier(user);

        u.stakedAmount -= toSlash;
        totalUserStaked -= toSlash;

        if (treasury != address(0)) {
            jejuToken.safeTransfer(treasury, toSlash);
        }

        Tier newTier = getUserTier(user);
        if (oldTier != newTier) emit UserTierChanged(user, oldTier, newTier);
        emit UserSlashed(user, toSlash, reportId);
    }

    function setTierConfig(Tier tier, uint256 minUsdValue, uint256 rateLimit) external onlyOwner {
        tierConfigs[tier] = TierConfig({minUsdValue: minUsdValue, rateLimit: rateLimit});
    }

    function setPriceOracle(address oracle) external onlyOwner {
        priceOracle = oracle;
        emit PriceOracleUpdated(oracle);
    }

    function setFallbackPrice(uint256 price) external onlyOwner {
        fallbackPrice = price;
    }

    function setReputationProvider(address provider) external onlyOwner {
        reputationProvider = provider;
        emit ReputationProviderUpdated(provider);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice Withdraw accumulated ETH to treasury
    function withdrawETH() external onlyOwner {
        if (treasury == address(0)) revert InvalidTreasury();
        uint256 balance = address(this).balance;
        if (balance == 0) revert InsufficientBalance();
        (bool success, ) = treasury.call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function setWhitelisted(address account, bool status) external onlyOwner {
        whitelisted[account] = status;
    }

    function batchWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            whitelisted[accounts[i]] = status;
        }
    }

    function updateProviderEndpoint(string calldata endpoint) external {
        RPCProvider storage p = _providers[msg.sender];
        if (p.registeredAt == 0) revert ProviderNotRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        p.endpoint = endpoint;
        p.lastSeen = block.timestamp;
        emit RPCProviderUpdated(msg.sender, endpoint);
    }

    function reportPerformance(address provider, uint256 uptimeScore, uint256 successRate, uint256 avgLatencyMs) external onlyOwner {
        if (uptimeScore > 10000 || successRate > 10000) revert InvalidScore();
        
        PerformanceMetrics.Metrics storage m = metrics[provider];
        m.uptimeScore = uptimeScore;
        m.successRate = successRate;
        m.avgLatencyMs = avgLatencyMs;
        m.lastUpdated = block.timestamp;

        emit PerformanceReported(provider, uptimeScore, successRate, avgLatencyMs);
    }

    function getStats() external view returns (
        uint256 _totalUserStaked,
        uint256 _totalUsers,
        uint256 freeTierCount,
        uint256 basicTierCount,
        uint256 proTierCount,
        uint256 unlimitedTierCount
    ) {
        return (totalUserStaked, totalUsers, tierCounts[Tier.FREE], tierCounts[Tier.BASIC], tierCounts[Tier.PRO], tierCounts[Tier.UNLIMITED]);
    }

    function getProviderStats(address provider) external view returns (PerformanceMetrics.Metrics memory) {
        return metrics[provider];
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
