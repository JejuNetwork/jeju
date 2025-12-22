// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RiskSleeve
 * @notice Risk-tiered liquidity allocation wrapper
 * @dev Wraps liquidity pools with risk-based sleeves:
 *
 * CONSERVATIVE (Low Risk):
 *   - Only used for established, high-volume tokens
 *   - Lower yield, higher safety
 *   - Max 20% utilization
 *
 * BALANCED (Medium Risk):
 *   - Used for verified tokens with history
 *   - Moderate yield and risk
 *   - Max 50% utilization
 *
 * AGGRESSIVE (High Risk):
 *   - Used for any approved token
 *   - Higher yield, accepts more risk
 *   - Max 80% utilization
 *
 * Users choose their risk sleeve on deposit. The vault routes
 * liquidity requests to appropriate sleeves based on token risk scores.
 */
contract RiskSleeve is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RiskTier {
        CONSERVATIVE,   // Low risk, low return
        BALANCED,       // Medium risk, medium return
        AGGRESSIVE      // High risk, high return
    }

    struct SleeveConfig {
        uint256 maxUtilizationBps;  // Max % of sleeve that can be utilized
        uint256 minTokenRiskScore;  // Minimum risk score for tokens using this sleeve
        uint256 baseYieldBps;       // Base yield for this sleeve
        uint256 riskPremiumBps;     // Additional yield for higher risk
        uint256 totalDeposited;     // Total ETH in this sleeve
        uint256 totalUtilized;      // Amount currently in use
    }

    struct UserPosition {
        uint256 amount;
        RiskTier tier;
        uint256 depositTime;
        uint256 accumulatedYield;
    }

    // Token risk scores (0-100, higher = safer)
    mapping(address => uint256) public tokenRiskScores;

    // Sleeve configurations
    mapping(RiskTier => SleeveConfig) public sleeves;

    // User positions per tier
    mapping(address => mapping(RiskTier => UserPosition)) public positions;

    // Approved consumers (paymasters, bridges, etc.)
    mapping(address => bool) public approvedConsumers;
    mapping(address => RiskTier) public consumerMaxTier;

    IERC20 public rewardToken;
    uint256 public totalDeposits;
    uint256 public totalYieldDistributed;

    event Deposited(address indexed user, RiskTier tier, uint256 amount);
    event Withdrawn(address indexed user, RiskTier tier, uint256 amount, uint256 yield_);
    event LiquidityUtilized(address indexed consumer, RiskTier tier, uint256 amount);
    event LiquidityReturned(address indexed consumer, RiskTier tier, uint256 amount, uint256 fee);
    event TokenRiskScoreSet(address indexed token, uint256 score);
    event SleeveConfigUpdated(RiskTier tier, uint256 maxUtil, uint256 minRisk, uint256 baseYield);

    error InsufficientLiquidity();
    error InvalidTier();
    error InvalidAmount();
    error UnauthorizedConsumer();
    error TokenRiskTooLow();
    error ExceedsMaxUtilization();
    error NoPosition();

    constructor(address _rewardToken, address initialOwner) Ownable(initialOwner) {
        rewardToken = IERC20(_rewardToken);

        // Initialize sleeve configs
        sleeves[RiskTier.CONSERVATIVE] = SleeveConfig({
            maxUtilizationBps: 2000,   // 20%
            minTokenRiskScore: 80,      // Only high-safety tokens
            baseYieldBps: 300,          // 3% base
            riskPremiumBps: 0,
            totalDeposited: 0,
            totalUtilized: 0
        });

        sleeves[RiskTier.BALANCED] = SleeveConfig({
            maxUtilizationBps: 5000,   // 50%
            minTokenRiskScore: 50,      // Medium-safety tokens
            baseYieldBps: 500,          // 5% base
            riskPremiumBps: 200,        // +2% risk premium
            totalDeposited: 0,
            totalUtilized: 0
        });

        sleeves[RiskTier.AGGRESSIVE] = SleeveConfig({
            maxUtilizationBps: 8000,   // 80%
            minTokenRiskScore: 20,      // Most tokens
            baseYieldBps: 800,          // 8% base
            riskPremiumBps: 500,        // +5% risk premium
            totalDeposited: 0,
            totalUtilized: 0
        });
    }

    // ============ User Functions ============

    /**
     * @notice Deposit ETH into a risk sleeve
     * @param tier Risk tier to deposit into
     */
    function deposit(RiskTier tier) external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();

        SleeveConfig storage sleeve = sleeves[tier];
        UserPosition storage position = positions[msg.sender][tier];

        // Claim any pending yield first
        if (position.amount > 0) {
            uint256 pendingYield = _calculateYield(msg.sender, tier);
            if (pendingYield > 0) {
                position.accumulatedYield += pendingYield;
            }
        }

        position.amount += msg.value;
        position.tier = tier;
        position.depositTime = block.timestamp;

        sleeve.totalDeposited += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, tier, msg.value);
    }

    /**
     * @notice Withdraw from a risk sleeve
     * @param tier Risk tier to withdraw from
     * @param amount Amount to withdraw
     */
    function withdraw(RiskTier tier, uint256 amount) external nonReentrant {
        UserPosition storage position = positions[msg.sender][tier];
        SleeveConfig storage sleeve = sleeves[tier];

        if (position.amount == 0) revert NoPosition();
        if (amount > position.amount) revert InvalidAmount();

        // Check liquidity availability
        uint256 available = sleeve.totalDeposited - sleeve.totalUtilized;
        if (amount > available) revert InsufficientLiquidity();

        // Calculate and add yield
        uint256 yield_ = _calculateYield(msg.sender, tier) + position.accumulatedYield;

        position.amount -= amount;
        position.accumulatedYield = 0;
        sleeve.totalDeposited -= amount;
        totalDeposits -= amount;

        // Transfer ETH + yield
        uint256 totalPayout = amount + yield_;
        (bool success,) = msg.sender.call{value: totalPayout}("");
        require(success, "Transfer failed");

        if (yield_ > 0) {
            totalYieldDistributed += yield_;
        }

        emit Withdrawn(msg.sender, tier, amount, yield_);
    }

    /**
     * @notice Claim accumulated yield without withdrawing principal
     * @param tier Risk tier to claim from
     */
    function claimYield(RiskTier tier) external nonReentrant {
        UserPosition storage position = positions[msg.sender][tier];
        if (position.amount == 0) revert NoPosition();

        uint256 yield_ = _calculateYield(msg.sender, tier) + position.accumulatedYield;
        if (yield_ == 0) return;

        position.accumulatedYield = 0;
        position.depositTime = block.timestamp; // Reset for next yield period

        (bool success,) = msg.sender.call{value: yield_}("");
        require(success, "Transfer failed");

        totalYieldDistributed += yield_;
    }

    // ============ Consumer Functions ============

    /**
     * @notice Request liquidity for a token operation
     * @param token Token being sponsored
     * @param amount Amount of ETH needed
     * @return tier Tier the liquidity came from
     */
    function requestLiquidity(address token, uint256 amount) external nonReentrant returns (RiskTier tier) {
        if (!approvedConsumers[msg.sender]) revert UnauthorizedConsumer();

        uint256 tokenRisk = tokenRiskScores[token];

        // Find appropriate tier based on token risk
        tier = _findAppropriateSleve(tokenRisk, amount);

        SleeveConfig storage sleeve = sleeves[tier];

        // Check utilization limits
        uint256 newUtilization = sleeve.totalUtilized + amount;
        uint256 maxAllowed = (sleeve.totalDeposited * sleeve.maxUtilizationBps) / 10000;
        if (newUtilization > maxAllowed) revert ExceedsMaxUtilization();

        sleeve.totalUtilized += amount;

        // Transfer to consumer
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit LiquidityUtilized(msg.sender, tier, amount);
    }

    /**
     * @notice Return liquidity with fee
     * @param tier Tier to return to
     * @param fee Fee amount (goes to yield pool)
     */
    function returnLiquidity(RiskTier tier, uint256 fee) external payable nonReentrant {
        if (!approvedConsumers[msg.sender]) revert UnauthorizedConsumer();

        uint256 principal = msg.value - fee;
        SleeveConfig storage sleeve = sleeves[tier];

        sleeve.totalUtilized -= principal;
        // Fee stays in contract for yield distribution

        emit LiquidityReturned(msg.sender, tier, principal, fee);
    }

    // ============ Internal Functions ============

    function _calculateYield(address user, RiskTier tier) internal view returns (uint256) {
        UserPosition storage position = positions[user][tier];
        if (position.amount == 0) return 0;

        SleeveConfig storage sleeve = sleeves[tier];

        uint256 duration = block.timestamp - position.depositTime;
        uint256 totalYieldBps = sleeve.baseYieldBps + sleeve.riskPremiumBps;

        // Annual yield prorated to duration
        return (position.amount * totalYieldBps * duration) / (10000 * 365 days);
    }

    function _findAppropriateSleve(uint256 tokenRisk, uint256 amount) internal view returns (RiskTier) {
        // Try conservative first if token is safe enough
        if (tokenRisk >= sleeves[RiskTier.CONSERVATIVE].minTokenRiskScore) {
            uint256 available = _getAvailable(RiskTier.CONSERVATIVE);
            if (available >= amount) return RiskTier.CONSERVATIVE;
        }

        // Try balanced
        if (tokenRisk >= sleeves[RiskTier.BALANCED].minTokenRiskScore) {
            uint256 available = _getAvailable(RiskTier.BALANCED);
            if (available >= amount) return RiskTier.BALANCED;
        }

        // Fall back to aggressive
        if (tokenRisk >= sleeves[RiskTier.AGGRESSIVE].minTokenRiskScore) {
            uint256 available = _getAvailable(RiskTier.AGGRESSIVE);
            if (available >= amount) return RiskTier.AGGRESSIVE;
        }

        revert TokenRiskTooLow();
    }

    function _getAvailable(RiskTier tier) internal view returns (uint256) {
        SleeveConfig storage sleeve = sleeves[tier];
        uint256 maxAllowed = (sleeve.totalDeposited * sleeve.maxUtilizationBps) / 10000;
        if (sleeve.totalUtilized >= maxAllowed) return 0;
        return maxAllowed - sleeve.totalUtilized;
    }

    // ============ View Functions ============

    function getSleeveStats(RiskTier tier) external view returns (
        uint256 deposited,
        uint256 utilized,
        uint256 available,
        uint256 utilizationBps,
        uint256 yieldBps
    ) {
        SleeveConfig storage sleeve = sleeves[tier];
        deposited = sleeve.totalDeposited;
        utilized = sleeve.totalUtilized;
        available = _getAvailable(tier);
        utilizationBps = deposited > 0 ? (utilized * 10000) / deposited : 0;
        yieldBps = sleeve.baseYieldBps + sleeve.riskPremiumBps;
    }

    function getUserPosition(address user, RiskTier tier) external view returns (
        uint256 deposited,
        uint256 pendingYield,
        uint256 depositDuration
    ) {
        UserPosition storage position = positions[user][tier];
        deposited = position.amount;
        pendingYield = _calculateYield(user, tier) + position.accumulatedYield;
        depositDuration = position.amount > 0 ? block.timestamp - position.depositTime : 0;
    }

    // ============ Admin ============

    function setTokenRiskScore(address token, uint256 score) external onlyOwner {
        require(score <= 100, "Score must be 0-100");
        tokenRiskScores[token] = score;
        emit TokenRiskScoreSet(token, score);
    }

    function setApprovedConsumer(address consumer, bool approved, RiskTier maxTier) external onlyOwner {
        approvedConsumers[consumer] = approved;
        consumerMaxTier[consumer] = maxTier;
    }

    function updateSleeveConfig(
        RiskTier tier,
        uint256 maxUtilBps,
        uint256 minRiskScore,
        uint256 baseYieldBps,
        uint256 riskPremiumBps
    ) external onlyOwner {
        SleeveConfig storage sleeve = sleeves[tier];
        sleeve.maxUtilizationBps = maxUtilBps;
        sleeve.minTokenRiskScore = minRiskScore;
        sleeve.baseYieldBps = baseYieldBps;
        sleeve.riskPremiumBps = riskPremiumBps;

        emit SleeveConfigUpdated(tier, maxUtilBps, minRiskScore, baseYieldBps);
    }

    receive() external payable {}
}

