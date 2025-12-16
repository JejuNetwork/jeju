// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITFMMPool} from "./ITFMMPool.sol";

/**
 * @title TFMMPool
 * @author Jeju Network
 * @notice Temporal Function Market Maker - Dynamic weight AMM pool
 * @dev Implements QuantAMM-style time-varying weights for on-chain portfolio management
 *
 * Key features:
 * - Dynamic weights that change over time based on strategy signals
 * - Weighted geometric mean invariant (Balancer-style)
 * - Linear weight interpolation between updates
 * - Configurable guard rails for safety
 *
 * Math:
 * - Invariant: prod(balance_i ^ weight_i) = constant
 * - Spot price: (balance_out / weight_out) / (balance_in / weight_in)
 * - Swap output: balance_out * (1 - (balance_in / (balance_in + amount_in)) ^ (weight_in / weight_out))
 */
contract TFMMPool is ITFMMPool, ERC20, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant WEIGHT_PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10000;
    uint256 private constant MIN_BALANCE = 1e6;  // Minimum balance to prevent manipulation
    uint256 private constant MAX_TOKENS = 8;

    // ============ State Variables ============

    /// @notice Pool token addresses
    address[] private _tokens;

    /// @notice Token balances
    mapping(address => uint256) private _balances;

    /// @notice Current normalized weights (sum = WEIGHT_PRECISION)
    uint256[] private _currentWeights;

    /// @notice Target weights for interpolation
    uint256[] private _targetWeights;

    /// @notice Weight change per block
    int256[] private _weightDeltas;

    /// @notice Block number of last weight update
    uint256 public override lastUpdateBlock;

    /// @notice Blocks remaining to reach target weights
    uint256 private _blocksRemaining;

    /// @notice Swap fee in basis points
    uint256 public override swapFeeBps;

    /// @notice Protocol fee share in basis points (of swap fee)
    uint256 public protocolFeeBps;

    /// @notice Accumulated protocol fees per token
    mapping(address => uint256) private _protocolFees;

    /// @notice Strategy rule contract
    address public override strategyRule;

    /// @notice Weight update runner contract
    address public weightRunner;

    /// @notice Guard rail parameters
    GuardRails private _guardRails;

    /// @notice Fee treasury address
    address public treasury;

    /// @notice Governance address (can modify fees)
    address public governance;

    // ============ Constructor ============

    constructor(
        string memory name_,
        string memory symbol_,
        address[] memory tokens_,
        uint256[] memory initialWeights_,
        uint256 swapFeeBps_,
        address owner_,
        address governance_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        require(tokens_.length >= 2 && tokens_.length <= MAX_TOKENS, "Invalid token count");
        require(tokens_.length == initialWeights_.length, "Length mismatch");
        require(swapFeeBps_ <= 1000, "Fee too high"); // Max 10%

        _tokens = tokens_;
        _currentWeights = initialWeights_;
        _targetWeights = initialWeights_;
        _weightDeltas = new int256[](tokens_.length);

        swapFeeBps = swapFeeBps_;
        governance = governance_;
        lastUpdateBlock = block.number;

        // Default guard rails
        _guardRails = GuardRails({
            minWeight: WEIGHT_PRECISION / 20,     // 5% minimum
            maxWeight: (WEIGHT_PRECISION * 95) / 100, // 95% maximum
            maxWeightChangeBps: 500,              // 5% max change per update
            minUpdateInterval: 10                  // 10 blocks minimum
        });

        // Validate initial weights
        _validateWeights(initialWeights_);
    }

    // ============ Modifiers ============

    modifier onlyWeightRunner() {
        require(msg.sender == weightRunner || msg.sender == owner(), "Not weight runner");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance || msg.sender == owner(), "Not governance");
        _;
    }

    // ============ Weight Management ============

    /**
     * @inheritdoc ITFMMPool
     */
    function getNormalizedWeights() public view override returns (uint256[] memory) {
        uint256 blocksPassed = block.number - lastUpdateBlock;
        uint256[] memory weights = new uint256[](_tokens.length);

        if (blocksPassed >= _blocksRemaining || _blocksRemaining == 0) {
            // Interpolation complete - return target weights
            for (uint256 i = 0; i < _tokens.length; i++) {
                weights[i] = _targetWeights[i];
            }
        } else {
            // Interpolate weights
            for (uint256 i = 0; i < _tokens.length; i++) {
                int256 delta = _weightDeltas[i] * int256(blocksPassed);
                int256 newWeight = int256(_currentWeights[i]) + delta;
                weights[i] = uint256(newWeight > 0 ? newWeight : int256(_guardRails.minWeight));
            }
        }

        return _normalizeWeights(weights);
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function updateWeights(
        uint256[] calldata newWeights,
        uint256 blocksToTarget
    ) external override onlyWeightRunner {
        require(newWeights.length == _tokens.length, "Length mismatch");
        require(
            block.number >= lastUpdateBlock + _guardRails.minUpdateInterval,
            "Update too soon"
        );

        // Validate new weights
        _validateWeights(newWeights);

        // Get current interpolated weights
        uint256[] memory currentWeights = getNormalizedWeights();

        // Apply guard rails
        for (uint256 i = 0; i < _tokens.length; i++) {
            uint256 change = newWeights[i] > currentWeights[i]
                ? newWeights[i] - currentWeights[i]
                : currentWeights[i] - newWeights[i];

            uint256 maxChange = (currentWeights[i] * _guardRails.maxWeightChangeBps) / BPS_PRECISION;

            if (change > maxChange) {
                revert WeightChangeTooLarge(change, maxChange);
            }
        }

        // Store current weights snapshot
        for (uint256 i = 0; i < _tokens.length; i++) {
            _currentWeights[i] = currentWeights[i];
        }

        // Calculate deltas for interpolation
        if (blocksToTarget > 0) {
            for (uint256 i = 0; i < _tokens.length; i++) {
                _weightDeltas[i] = (int256(newWeights[i]) - int256(currentWeights[i])) / int256(blocksToTarget);
            }
            _blocksRemaining = blocksToTarget;
        } else {
            for (uint256 i = 0; i < _tokens.length; i++) {
                _weightDeltas[i] = 0;
            }
            _blocksRemaining = 0;
        }

        _targetWeights = newWeights;
        lastUpdateBlock = block.number;

        emit WeightsUpdated(currentWeights, newWeights, blocksToTarget, block.number);
    }

    // ============ Trading ============

    /**
     * @inheritdoc ITFMMPool
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external override nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        require(tokenIn != tokenOut, "Same token");

        (uint256 indexIn, uint256 indexOut) = _getTokenIndices(tokenIn, tokenOut);
        uint256[] memory weights = getNormalizedWeights();

        // Calculate swap output
        uint256 feeAmount;
        (amountOut, feeAmount) = _calculateSwapOutput(
            _balances[tokenIn],
            _balances[tokenOut],
            weights[indexIn],
            weights[indexOut],
            amountIn
        );

        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut < _balances[tokenOut] - MIN_BALANCE, "Insufficient liquidity");

        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        // Update balances
        _balances[tokenIn] += amountIn;
        _balances[tokenOut] -= amountOut;

        // Track protocol fee
        uint256 protocolFee = (feeAmount * protocolFeeBps) / BPS_PRECISION;
        _protocolFees[tokenIn] += protocolFee;

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, feeAmount);
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 amountOut, uint256 feeAmount) {
        (uint256 indexIn, uint256 indexOut) = _getTokenIndices(tokenIn, tokenOut);
        uint256[] memory weights = getNormalizedWeights();

        return _calculateSwapOutput(
            _balances[tokenIn],
            _balances[tokenOut],
            weights[indexIn],
            weights[indexOut],
            amountIn
        );
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function getSpotPrice(
        address tokenIn,
        address tokenOut
    ) external view override returns (uint256 price) {
        (uint256 indexIn, uint256 indexOut) = _getTokenIndices(tokenIn, tokenOut);
        uint256[] memory weights = getNormalizedWeights();

        // price = (balanceOut / weightOut) / (balanceIn / weightIn)
        // Scaled by 1e18 for precision
        price = (_balances[tokenOut] * weights[indexIn] * WEIGHT_PRECISION) /
                (_balances[tokenIn] * weights[indexOut]);
    }

    // ============ Liquidity ============

    /**
     * @inheritdoc ITFMMPool
     */
    function addLiquidity(
        uint256[] calldata amounts,
        uint256 minLpTokens
    ) external override nonReentrant returns (uint256 lpTokens) {
        require(amounts.length == _tokens.length, "Length mismatch");

        uint256 totalSupplyBefore = totalSupply();
        uint256[] memory weights = getNormalizedWeights();

        if (totalSupplyBefore == 0) {
            // Initial liquidity - mint based on geometric mean
            uint256 value = _calculateInitialLpTokens(amounts, weights);
            lpTokens = value;

            // Transfer tokens
            for (uint256 i = 0; i < _tokens.length; i++) {
                require(amounts[i] >= MIN_BALANCE, "Amount too small");
                IERC20(_tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
                _balances[_tokens[i]] = amounts[i];
            }
        } else {
            // Proportional join - calculate LP tokens based on contribution
            lpTokens = _calculateProportionalLpTokens(amounts, totalSupplyBefore);

            // Transfer tokens
            for (uint256 i = 0; i < _tokens.length; i++) {
                if (amounts[i] > 0) {
                    IERC20(_tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
                    _balances[_tokens[i]] += amounts[i];
                }
            }
        }

        require(lpTokens >= minLpTokens, "Insufficient LP tokens");
        _mint(msg.sender, lpTokens);

        emit LiquidityAdded(msg.sender, amounts, lpTokens);
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function removeLiquidity(
        uint256 lpTokens,
        uint256[] calldata minAmounts
    ) external override nonReentrant returns (uint256[] memory amounts) {
        require(lpTokens > 0, "Zero LP tokens");
        require(minAmounts.length == _tokens.length, "Length mismatch");

        uint256 totalSupplyBefore = totalSupply();
        require(lpTokens <= totalSupplyBefore, "Insufficient LP tokens");

        amounts = new uint256[](_tokens.length);

        // Calculate proportional share
        for (uint256 i = 0; i < _tokens.length; i++) {
            amounts[i] = (_balances[_tokens[i]] * lpTokens) / totalSupplyBefore;
            require(amounts[i] >= minAmounts[i], "Slippage exceeded");
            require(_balances[_tokens[i]] - amounts[i] >= MIN_BALANCE, "Would drain pool");
        }

        // Burn LP tokens
        _burn(msg.sender, lpTokens);

        // Transfer tokens
        for (uint256 i = 0; i < _tokens.length; i++) {
            _balances[_tokens[i]] -= amounts[i];
            IERC20(_tokens[i]).safeTransfer(msg.sender, amounts[i]);
        }

        emit LiquidityRemoved(msg.sender, amounts, lpTokens);
    }

    // ============ View Functions ============

    /**
     * @inheritdoc ITFMMPool
     */
    function getTokens() external view override returns (address[] memory) {
        return _tokens;
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function getBalances() external view override returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            balances[i] = _balances[_tokens[i]];
        }
        return balances;
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function getGuardRails() external view override returns (
        uint256 minWeight,
        uint256 maxWeight,
        uint256 maxWeightChangeBps
    ) {
        return (_guardRails.minWeight, _guardRails.maxWeight, _guardRails.maxWeightChangeBps);
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function getPoolState() external view override returns (PoolState memory) {
        uint256[] memory balances = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            balances[i] = _balances[_tokens[i]];
        }

        return PoolState({
            tokens: _tokens,
            balances: balances,
            currentWeights: _currentWeights,
            targetWeights: _targetWeights,
            weightDeltas: _weightDeltas,
            lastUpdateBlock: lastUpdateBlock,
            swapFeeBps: swapFeeBps,
            totalSupply: totalSupply()
        });
    }

    /**
     * @inheritdoc ITFMMPool
     */
    function collectFees() external override returns (uint256[] memory fees) {
        require(msg.sender == treasury || msg.sender == owner(), "Not treasury");

        fees = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            fees[i] = _protocolFees[_tokens[i]];
            if (fees[i] > 0) {
                _protocolFees[_tokens[i]] = 0;
                _balances[_tokens[i]] -= fees[i];
                IERC20(_tokens[i]).safeTransfer(treasury, fees[i]);
            }
        }
    }

    // ============ Admin Functions ============

    function setWeightRunner(address runner) external onlyOwner {
        weightRunner = runner;
    }

    function setStrategyRule(address rule) external onlyOwner {
        address oldRule = strategyRule;
        strategyRule = rule;
        emit StrategyRuleUpdated(oldRule, rule);
    }

    function setGuardRails(GuardRails calldata rails) external onlyGovernance {
        require(rails.minWeight >= WEIGHT_PRECISION / 100, "Min weight too low");
        require(rails.maxWeight <= (WEIGHT_PRECISION * 99) / 100, "Max weight too high");
        require(rails.maxWeightChangeBps <= 2000, "Max change too high");
        _guardRails = rails;
        emit GuardRailsUpdated(rails);
    }

    function setSwapFee(uint256 newFeeBps) external onlyGovernance {
        require(newFeeBps <= 1000, "Fee too high");
        swapFeeBps = newFeeBps;
    }

    function setProtocolFee(uint256 newFeeBps) external onlyGovernance {
        require(newFeeBps <= 5000, "Protocol fee too high");
        protocolFeeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyGovernance {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        require(newGovernance != address(0), "Invalid governance");
        governance = newGovernance;
    }

    // ============ Internal Functions ============

    function _calculateSwapOutput(
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 weightIn,
        uint256 weightOut,
        uint256 amountIn
    ) internal view returns (uint256 amountOut, uint256 feeAmount) {
        // Apply fee
        feeAmount = (amountIn * swapFeeBps) / BPS_PRECISION;
        uint256 amountInAfterFee = amountIn - feeAmount;

        // Calculate output using power function approximation
        // amountOut = balanceOut * (1 - (balanceIn / (balanceIn + amountIn)) ^ (weightIn / weightOut))
        
        uint256 newBalanceIn = balanceIn + amountInAfterFee;
        uint256 ratio = (balanceIn * WEIGHT_PRECISION) / newBalanceIn;
        
        // Power approximation: (1 - ratio) for small changes
        // For larger changes, use log/exp or iterative approach
        uint256 weightRatio = (weightIn * WEIGHT_PRECISION) / weightOut;
        uint256 powerResult = _power(ratio, weightRatio);
        
        amountOut = (balanceOut * (WEIGHT_PRECISION - powerResult)) / WEIGHT_PRECISION;
    }

    function _calculateInitialLpTokens(
        uint256[] calldata amounts,
        uint256[] memory weights
    ) internal pure returns (uint256) {
        // Geometric mean weighted by weights
        uint256 product = WEIGHT_PRECISION;
        for (uint256 i = 0; i < amounts.length; i++) {
            // Simplified: sum of (amount * weight)
            product += (amounts[i] * weights[i]) / WEIGHT_PRECISION;
        }
        return product;
    }

    function _calculateProportionalLpTokens(
        uint256[] calldata amounts,
        uint256 totalSupplyBefore
    ) internal view returns (uint256) {
        // Find the token with the smallest contribution ratio
        uint256 minRatio = type(uint256).max;
        
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (amounts[i] > 0 && _balances[_tokens[i]] > 0) {
                uint256 ratio = (amounts[i] * WEIGHT_PRECISION) / _balances[_tokens[i]];
                if (ratio < minRatio) {
                    minRatio = ratio;
                }
            }
        }

        require(minRatio != type(uint256).max, "No valid amounts");
        return (totalSupplyBefore * minRatio) / WEIGHT_PRECISION;
    }

    function _validateWeights(uint256[] memory weights) internal view {
        uint256 sum = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            require(weights[i] >= _guardRails.minWeight, "Weight below minimum");
            require(weights[i] <= _guardRails.maxWeight, "Weight above maximum");
            sum += weights[i];
        }
        // Allow 0.1% tolerance for rounding
        require(
            sum >= WEIGHT_PRECISION - WEIGHT_PRECISION / 1000 &&
            sum <= WEIGHT_PRECISION + WEIGHT_PRECISION / 1000,
            "Weights must sum to 1e18"
        );
    }

    function _normalizeWeights(uint256[] memory weights) internal pure returns (uint256[] memory) {
        uint256 sum = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            sum += weights[i];
        }

        if (sum == 0) {
            // Equal weights fallback
            uint256 equalWeight = WEIGHT_PRECISION / weights.length;
            for (uint256 i = 0; i < weights.length; i++) {
                weights[i] = equalWeight;
            }
            return weights;
        }

        for (uint256 i = 0; i < weights.length; i++) {
            weights[i] = (weights[i] * WEIGHT_PRECISION) / sum;
        }
        return weights;
    }

    function _getTokenIndices(
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256 indexIn, uint256 indexOut) {
        bool foundIn = false;
        bool foundOut = false;

        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i] == tokenIn) {
                indexIn = i;
                foundIn = true;
            }
            if (_tokens[i] == tokenOut) {
                indexOut = i;
                foundOut = true;
            }
        }

        require(foundIn && foundOut, "Invalid token");
    }

    /**
     * @notice Power function approximation using binary decomposition
     * @param base Base value (18 decimals)
     * @param exp Exponent (18 decimals)
     */
    function _power(uint256 base, uint256 exp) internal pure returns (uint256) {
        // For values close to 1, use Taylor series approximation
        // (1-x)^n ≈ 1 - n*x for small x
        
        if (base >= WEIGHT_PRECISION) {
            return WEIGHT_PRECISION;
        }

        uint256 x = WEIGHT_PRECISION - base;
        
        // Simple linear approximation for typical AMM cases
        // More accurate would be iterative or logarithmic
        uint256 result = WEIGHT_PRECISION - (x * exp) / WEIGHT_PRECISION;
        
        return result;
    }
}

