// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IStrategyRule} from "../IStrategyRule.sol";

/**
 * @title VolatilityRule
 * @author Jeju Network
 * @notice Volatility-based weight adjustment strategy
 * @dev Inverse volatility weighting - lower vol = higher weight
 *
 * Philosophy: Risk-adjusted allocation. Safer assets get more weight
 * to reduce overall portfolio volatility.
 */
contract VolatilityRule is IStrategyRule, Ownable {

    // ============ Constants ============

    uint256 private constant WEIGHT_PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10000;

    // ============ State Variables ============

    /// @notice Lookback period for volatility calculation
    uint256 public lookbackPeriod;

    /// @notice Target annualized volatility (e.g., 1500 = 15%)
    uint256 public targetVolatilityBps;

    /// @notice Max volatility per asset before reduction (e.g., 5000 = 50%)
    uint256 public maxVolatilityBps;

    /// @notice Blocks per year (for annualization) - ~2.6M for 12s blocks
    uint256 public blocksPerYear;

    /// @notice Blocks to target for interpolation
    uint256 public blocksToTarget;

    /// @notice Historical prices
    mapping(address => mapping(uint256 => uint256[])) private _priceHistory;

    /// @notice Max history length
    uint256 public maxHistoryLength;

    /// @notice Governance
    address public governance;

    // ============ Events ============

    event ParametersUpdated(
        uint256 lookbackPeriod,
        uint256 targetVolatilityBps,
        uint256 maxVolatilityBps
    );

    // ============ Constructor ============

    constructor(
        uint256 lookbackPeriod_,
        uint256 targetVolatilityBps_,
        uint256 maxVolatilityBps_,
        uint256 blocksToTarget_,
        address governance_
    ) Ownable(msg.sender) {
        lookbackPeriod = lookbackPeriod_;
        targetVolatilityBps = targetVolatilityBps_;
        maxVolatilityBps = maxVolatilityBps_;
        blocksToTarget = blocksToTarget_;
        blocksPerYear = 2628000; // ~12s blocks
        maxHistoryLength = 1000;
        governance = governance_;
    }

    // ============ Modifiers ============

    modifier onlyGovernance() {
        require(msg.sender == governance || msg.sender == owner(), "Not governance");
        _;
    }

    // ============ Strategy Implementation ============

    /**
     * @inheritdoc IStrategyRule
     */
    function calculateWeights(
        address pool,
        uint256[] calldata prices,
        uint256[] calldata currentWeights
    ) external view override returns (uint256[] memory newWeights, uint256 blocks) {
        newWeights = new uint256[](prices.length);
        blocks = blocksToTarget;

        uint256[] memory volatilities = new uint256[](prices.length);
        uint256[] memory inverseVols = new uint256[](prices.length);
        uint256 totalInverseVol = 0;

        // Calculate volatility for each token
        for (uint256 i = 0; i < prices.length; i++) {
            uint256[] storage history = _priceHistory[pool][i];

            if (history.length < 2) {
                // Default to target volatility if not enough data
                volatilities[i] = targetVolatilityBps;
            } else {
                volatilities[i] = _calculateVolatility(history);
            }

            // Cap volatility
            if (volatilities[i] > maxVolatilityBps) {
                volatilities[i] = maxVolatilityBps;
            }
            if (volatilities[i] == 0) {
                volatilities[i] = 100; // Min 1% vol to avoid division by zero
            }

            // Calculate inverse volatility (lower vol = higher score)
            inverseVols[i] = (WEIGHT_PRECISION * BPS_PRECISION) / volatilities[i];
            totalInverseVol += inverseVols[i];
        }

        // Calculate target weights based on inverse volatility
        if (totalInverseVol > 0) {
            for (uint256 i = 0; i < prices.length; i++) {
                uint256 targetWeight = (inverseVols[i] * WEIGHT_PRECISION) / totalInverseVol;

                // Blend with current weight (gradual adjustment)
                // 30% new target, 70% current
                newWeights[i] = (currentWeights[i] * 70 + targetWeight * 30) / 100;
            }
        } else {
            // Fallback to equal weights
            uint256 equal = WEIGHT_PRECISION / prices.length;
            for (uint256 i = 0; i < prices.length; i++) {
                newWeights[i] = equal;
            }
        }

        // Normalize
        newWeights = _normalizeWeights(newWeights);
    }

    /**
     * @notice Record prices
     */
    function recordPrices(address pool, uint256[] calldata prices) external {
        for (uint256 i = 0; i < prices.length; i++) {
            uint256[] storage history = _priceHistory[pool][i];
            history.push(prices[i]);

            if (history.length > maxHistoryLength) {
                for (uint256 j = 0; j < history.length - 1; j++) {
                    history[j] = history[j + 1];
                }
                history.pop();
            }
        }
    }

    /**
     * @inheritdoc IStrategyRule
     */
    function name() external pure override returns (string memory) {
        return "Volatility";
    }

    /**
     * @inheritdoc IStrategyRule
     */
    function getParameters() external view override returns (bytes memory) {
        return abi.encode(lookbackPeriod, targetVolatilityBps, maxVolatilityBps, blocksToTarget);
    }

    // ============ View Functions ============

    /**
     * @notice Get volatility for a token
     */
    function getTokenVolatility(
        address pool,
        uint256 tokenIndex
    ) external view returns (uint256 volatilityBps) {
        uint256[] storage history = _priceHistory[pool][tokenIndex];
        if (history.length < 2) return targetVolatilityBps;
        return _calculateVolatility(history);
    }

    // ============ Admin Functions ============

    function setParameters(
        uint256 lookbackPeriod_,
        uint256 targetVolatilityBps_,
        uint256 maxVolatilityBps_
    ) external onlyGovernance {
        require(targetVolatilityBps_ <= 10000, "Target vol too high");
        require(maxVolatilityBps_ >= targetVolatilityBps_, "Max must be >= target");

        lookbackPeriod = lookbackPeriod_;
        targetVolatilityBps = targetVolatilityBps_;
        maxVolatilityBps = maxVolatilityBps_;

        emit ParametersUpdated(lookbackPeriod_, targetVolatilityBps_, maxVolatilityBps_);
    }

    function setBlocksToTarget(uint256 blocks) external onlyGovernance {
        blocksToTarget = blocks;
    }

    function setBlocksPerYear(uint256 blocks) external onlyOwner {
        blocksPerYear = blocks;
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        governance = newGovernance;
    }

    // ============ Internal Functions ============

    function _calculateVolatility(
        uint256[] storage history
    ) internal view returns (uint256 volatilityBps) {
        uint256 length = lookbackPeriod > history.length ? history.length : lookbackPeriod;
        if (length < 2) return targetVolatilityBps;

        uint256 startIndex = history.length - length;

        // Calculate returns
        int256[] memory returns_ = new int256[](length - 1);
        for (uint256 i = startIndex + 1; i < history.length; i++) {
            uint256 prev = history[i - 1];
            uint256 curr = history[i];
            if (prev > 0) {
                returns_[i - startIndex - 1] = int256((curr * BPS_PRECISION) / prev) - int256(BPS_PRECISION);
            }
        }

        // Calculate mean return
        int256 meanReturn = 0;
        for (uint256 i = 0; i < returns_.length; i++) {
            meanReturn += returns_[i];
        }
        meanReturn = meanReturn / int256(returns_.length);

        // Calculate variance
        uint256 sumSquaredDiff = 0;
        for (uint256 i = 0; i < returns_.length; i++) {
            int256 diff = returns_[i] - meanReturn;
            if (diff < 0) diff = -diff;
            sumSquaredDiff += uint256(diff) * uint256(diff > 0 ? diff : -diff);
        }

        uint256 variance = sumSquaredDiff / returns_.length;
        uint256 stdDev = _sqrt(variance);

        // Annualize: stdDev * sqrt(periods per year)
        // Simplified: assume daily updates, so ~365 periods
        uint256 periodsPerYear = blocksPerYear / (history.length > 1 ? history.length : 1);
        periodsPerYear = periodsPerYear > 365 ? 365 : (periodsPerYear < 1 ? 1 : periodsPerYear);

        volatilityBps = stdDev * _sqrt(periodsPerYear * BPS_PRECISION) / _sqrt(BPS_PRECISION);

        // Bound result
        if (volatilityBps > 20000) volatilityBps = 20000; // Max 200%
        if (volatilityBps < 10) volatilityBps = 10; // Min 0.1%
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        uint256 y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }

    function _normalizeWeights(uint256[] memory weights) internal pure returns (uint256[] memory) {
        uint256 sum = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            sum += weights[i];
        }

        if (sum == 0) {
            uint256 equal = WEIGHT_PRECISION / weights.length;
            for (uint256 i = 0; i < weights.length; i++) {
                weights[i] = equal;
            }
            return weights;
        }

        for (uint256 i = 0; i < weights.length; i++) {
            weights[i] = (weights[i] * WEIGHT_PRECISION) / sum;
        }

        return weights;
    }
}

