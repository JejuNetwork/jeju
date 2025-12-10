// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IRPCStakingManager} from "./IRPCStakingManager.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title RPCStakingManager
 * @author Jeju Network
 * @notice Staking system for RPC access rate limits with USD-denominated tiers
 * @dev Uses price oracle to calculate stake value in USD for tier determination.
 *      Reputation discounts reduce effective USD threshold requirements.
 *
 * Rate Limit Tiers (USD-denominated):
 * - FREE:      $0    → 10 req/min
 * - BASIC:     $10   → 100 req/min
 * - PRO:       $100  → 1,000 req/min
 * - UNLIMITED: $1000 → unlimited
 *
 * @custom:security-contact security@jeju.network
 */
contract RPCStakingManager is IRPCStakingManager, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant MAX_REPUTATION_DISCOUNT_BPS = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant USD_DECIMALS = 8; // Chainlink standard

    IERC20 public immutable jejuToken;

    IIdentityRegistry public identityRegistry;
    address public reputationProvider;
    address public priceOracle; // Chainlink-compatible price feed
    uint256 public fallbackPrice = 1e7; // $0.10 default (8 decimals)
    
    mapping(address => StakePosition) public positions;
    mapping(Tier => TierConfig) public tierConfigs;
    mapping(address => bool) public whitelisted;
    mapping(address => bool) public moderators;
    
    address public treasury;
    uint256 public totalStaked;
    uint256 public totalStakers;

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _priceOracle,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_jejuToken != address(0), "Invalid token");
        jejuToken = IERC20(_jejuToken);

        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
        priceOracle = _priceOracle;

        // USD-denominated tiers (8 decimals: 1e8 = $1)
        tierConfigs[Tier.FREE] = TierConfig({minUsdValue: 0, rateLimit: 10});
        tierConfigs[Tier.BASIC] = TierConfig({minUsdValue: 10e8, rateLimit: 100});      // $10
        tierConfigs[Tier.PRO] = TierConfig({minUsdValue: 100e8, rateLimit: 1000});      // $100
        tierConfigs[Tier.UNLIMITED] = TierConfig({minUsdValue: 1000e8, rateLimit: 0}); // $1000
    }

    // ============ Core Staking Functions ============

    /**
     * @notice Stake JEJU tokens for RPC access
     * @param amount Amount of JEJU to stake
     */
    function stake(uint256 amount) external override nonReentrant whenNotPaused {
        _stake(msg.sender, amount, 0);
    }

    /**
     * @notice Stake JEJU tokens and link to an ERC-8004 agent
     * @param amount Amount of JEJU to stake
     * @param agentId ERC-8004 agent ID to link
     */
    function stakeWithAgent(uint256 amount, uint256 agentId) external override nonReentrant whenNotPaused {
        _stake(msg.sender, amount, agentId);
    }

    function _stake(address user, uint256 amount, uint256 agentId) internal {
        if (amount == 0) revert InvalidAmount();

        StakePosition storage pos = positions[user];
        Tier oldTier = getTier(user);

        jejuToken.safeTransferFrom(user, address(this), amount);

        if (!pos.isActive) {
            pos.isActive = true;
            pos.stakedAt = block.timestamp;
            totalStakers++;
        }
        pos.stakedAmount += amount;
        totalStaked += amount;

        if (agentId > 0) {
            _linkAgent(user, agentId);
        }

        Tier newTier = getTier(user);
        emit Staked(user, amount, newTier);
        if (oldTier != newTier) {
            emit TierChanged(user, oldTier, newTier);
        }
    }

    /**
     * @notice Link an ERC-8004 agent to the stake position
     * @param agentId Agent ID to link
     */
    function linkAgent(uint256 agentId) external override nonReentrant {
        _linkAgent(msg.sender, agentId);
    }

    function _linkAgent(address user, uint256 agentId) internal {
        StakePosition storage pos = positions[user];
        if (pos.agentId != 0) revert AlreadyLinked();

        // Verify ownership if registry is set
        if (address(identityRegistry) != address(0)) {
            if (identityRegistry.ownerOf(agentId) != user) revert AgentNotOwned();
        }

        pos.agentId = agentId;
        emit AgentLinked(user, agentId);
    }

    /**
     * @notice Start unbonding stake (7-day waiting period)
     * @param amount Amount to unbond
     */
    function startUnbonding(uint256 amount) external override nonReentrant {
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
            emit TierChanged(msg.sender, oldTier, newTier);
        }
    }

    /**
     * @notice Complete unstaking after unbonding period
     */
    function completeUnstaking() external override nonReentrant {
        StakePosition storage pos = positions[msg.sender];

        if (pos.isFrozen) revert StakeIsFrozen();
        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) revert StillUnbonding();

        uint256 amount = pos.unbondingAmount;
        pos.unbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.stakedAmount == 0) {
            pos.isActive = false;
            totalStakers--;
        }

        jejuToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get user's staking position
     */
    function getPosition(address user) external view override returns (StakePosition memory) {
        return positions[user];
    }

    /**
     * @notice Get user's current tier based on USD value of stake
     */
    function getTier(address user) public view override returns (Tier) {
        if (whitelisted[user]) return Tier.UNLIMITED;
        uint256 usdValue = getStakeUsdValue(user);
        return _calculateTier(usdValue);
    }

    /**
     * @notice Get user's rate limit (requests per minute)
     */
    function getRateLimit(address user) external view override returns (uint256) {
        return tierConfigs[getTier(user)].rateLimit;
    }

    /**
     * @notice Get effective stake in JEJU after reputation bonus
     */
    function getEffectiveStake(address user) public view override returns (uint256) {
        StakePosition storage pos = positions[user];
        uint256 discountBps = getReputationDiscount(user);
        if (discountBps > 0) {
            return (pos.stakedAmount * (BPS_DENOMINATOR + discountBps)) / BPS_DENOMINATOR;
        }
        return pos.stakedAmount;
    }

    /**
     * @notice Get USD value of user's effective stake (8 decimals)
     */
    function getStakeUsdValue(address user) public view override returns (uint256) {
        uint256 effectiveStake = getEffectiveStake(user);
        uint256 price = getJejuPrice();
        return (effectiveStake * price) / 1e18; // JEJU has 18 decimals
    }

    /**
     * @notice Get current JEJU price in USD (8 decimals)
     */
    function getJejuPrice() public view override returns (uint256) {
        if (priceOracle == address(0)) return fallbackPrice;
        
        // Chainlink AggregatorV3 interface
        (bool success, bytes memory data) = priceOracle.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        
        if (success && data.length >= 160) {
            (, int256 price,,,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
            if (price > 0) return uint256(price);
        }
        
        return fallbackPrice;
    }

    /**
     * @notice Get reputation discount for user (0-5000 BPS)
     */
    function getReputationDiscount(address user) public view override returns (uint256) {
        if (reputationProvider == address(0)) return 0;

        // Query reputation provider for stake discount
        // Uses same interface as GitHubReputationProvider
        (bool success, bytes memory data) = reputationProvider.staticcall(
            abi.encodeWithSignature("getStakeDiscount(address)", user)
        );

        if (success && data.length >= 32) {
            uint256 discount = abi.decode(data, (uint256));
            // Cap at max discount
            return discount > MAX_REPUTATION_DISCOUNT_BPS ? MAX_REPUTATION_DISCOUNT_BPS : discount;
        }

        return 0;
    }

    /**
     * @notice Get tier configuration
     */
    function getTierConfig(Tier tier) external view override returns (TierConfig memory) {
        return tierConfigs[tier];
    }

    /**
     * @notice Check if user can access RPC (not banned, not frozen, has position or free tier)
     */
    function canAccess(address user) external view override returns (bool) {
        // Whitelisted always allowed
        if (whitelisted[user]) return true;

        // Check if stake is frozen
        if (positions[user].isFrozen) return false;

        // Check if banned in identity registry
        if (address(identityRegistry) != address(0)) {
            StakePosition storage pos = positions[user];
            if (pos.agentId > 0) {
                // Check if agent is banned via getMarketplaceInfo
                (bool success, bytes memory data) = address(identityRegistry).staticcall(
                    abi.encodeWithSignature("getMarketplaceInfo(uint256)", pos.agentId)
                );
                if (success && data.length >= 224) { // 7 return values
                    // banned is the 7th return value
                    (, , , , , , bool banned) = abi.decode(
                        data, 
                        (string, string, string, string, bool, uint8, bool)
                    );
                    if (banned) return false;
                }
            }
        }

        // Everyone can access (even free tier)
        return true;
    }

    /**
     * @notice Calculate tier from USD value
     */
    function _calculateTier(uint256 usdValue) internal view returns (Tier) {
        if (usdValue >= tierConfigs[Tier.UNLIMITED].minUsdValue) return Tier.UNLIMITED;
        if (usdValue >= tierConfigs[Tier.PRO].minUsdValue) return Tier.PRO;
        if (usdValue >= tierConfigs[Tier.BASIC].minUsdValue) return Tier.BASIC;
        return Tier.FREE;
    }

    // ============ Moderation Functions ============

    modifier onlyModerator() {
        if (!moderators[msg.sender] && msg.sender != owner()) revert NotModerator();
        _;
    }

    /**
     * @notice Freeze a user's stake (prevents withdrawal and RPC access)
     * @param user Address to freeze
     * @param reason Reason for freezing
     */
    function freezeStake(address user, string calldata reason) external override onlyModerator {
        StakePosition storage pos = positions[user];
        if (pos.isFrozen) revert StakeIsFrozen();
        
        pos.isFrozen = true;
        emit StakeFrozen(user, reason, msg.sender);
    }

    /**
     * @notice Unfreeze a user's stake
     * @param user Address to unfreeze
     */
    function unfreezeStake(address user) external override onlyModerator {
        StakePosition storage pos = positions[user];
        if (!pos.isFrozen) revert StakeNotFrozen();
        
        pos.isFrozen = false;
        emit StakeUnfrozen(user, msg.sender);
    }

    /**
     * @notice Slash a portion of user's stake (for confirmed abuse)
     * @param user Address to slash
     * @param amount Amount to slash
     * @param reportId Associated moderation report ID
     */
    function slashStake(address user, uint256 amount, bytes32 reportId) external override onlyModerator {
        StakePosition storage pos = positions[user];
        
        uint256 slashable = pos.stakedAmount;
        uint256 toSlash = amount > slashable ? slashable : amount;
        if (toSlash == 0) revert InvalidAmount();
        
        Tier oldTier = getTier(user);
        
        pos.stakedAmount -= toSlash;
        totalStaked -= toSlash;
        
        if (treasury != address(0)) {
            jejuToken.safeTransfer(treasury, toSlash);
        }
        
        Tier newTier = getTier(user);
        if (oldTier != newTier) {
            emit TierChanged(user, oldTier, newTier);
        }
        emit StakeSlashed(user, toSlash, reportId, msg.sender);
    }

    /**
     * @notice Check if a user's stake is frozen
     */
    function isFrozen(address user) external view override returns (bool) {
        return positions[user].isFrozen;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set reputation provider address
     */
    function setReputationProvider(address provider) external onlyOwner {
        reputationProvider = provider;
        emit ReputationProviderUpdated(provider);
    }

    /**
     * @notice Set identity registry
     */
    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = IIdentityRegistry(registry);
    }

    /**
     * @notice Update tier configuration (USD values, 8 decimals)
     */
    function setTierConfig(Tier tier, uint256 minUsdValue, uint256 rateLimit) external onlyOwner {
        tierConfigs[tier] = TierConfig({minUsdValue: minUsdValue, rateLimit: rateLimit});
        emit TierConfigUpdated(tier, minUsdValue, rateLimit);
    }

    /**
     * @notice Set price oracle address
     */
    function setPriceOracle(address oracle) external onlyOwner {
        priceOracle = oracle;
        emit PriceOracleUpdated(oracle);
    }

    /**
     * @notice Set fallback price when oracle unavailable (8 decimals)
     */
    function setFallbackPrice(uint256 price) external onlyOwner {
        fallbackPrice = price;
    }

    /**
     * @notice Add/remove address from whitelist (internal apps)
     */
    function setWhitelisted(address account, bool status) external onlyOwner {
        whitelisted[account] = status;
    }

    /**
     * @notice Batch whitelist addresses
     */
    function batchWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            whitelisted[accounts[i]] = status;
        }
    }

    /**
     * @notice Add/remove moderator
     */
    function setModerator(address account, bool status) external onlyOwner {
        moderators[account] = status;
    }

    /**
     * @notice Set treasury address for slashed funds
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Stats ============

    /**
     * @notice Get global staking statistics
     */
    function getStats() external view returns (
        uint256 _totalStaked,
        uint256 _totalStakers,
        uint256 freeCount,
        uint256 basicCount,
        uint256 proCount,
        uint256 unlimitedCount
    ) {
        _totalStaked = totalStaked;
        _totalStakers = totalStakers;
        // Note: tier counts would require enumeration, simplified here
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
