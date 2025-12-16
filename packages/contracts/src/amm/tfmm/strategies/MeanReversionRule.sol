// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IStrategyRule} from "../IStrategyRule.sol";

/**
 * @title MeanReversionRule
 * @author Jeju Network
 * @notice Mean-reversion weight adjustment strategy
 * @dev Increases weight of oversold assets, decreases weight of overbought
 *
 * Philosophy: "Buy low, sell high" - assets revert to their mean
 *
 * Uses Bollinger Bands approach:
 * - Upper band = SMA + k * StdDev
 * - Lower band = SMA - k * StdDev
 */
contract MeanReversionRule is IStrategyRule, Ownable {

    // ============ Constants ============

    uint256 private constant WEIGHT_PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10000;
    uint256 private constant SQRT_PRECISION = 1e9;

    // ============ State Variables ============

    /// @notice Lookback period for SMA calculation
    uint256 public lookbackPeriod;

    /// @notice Bollinger band multiplier (e.g., 200 = 2.0 std devs)
    uint256 public bandMultiplier;

    /// @notice Sensitivity (100 = 1x)
    uint256 public sensitivity;

    /// @notice Blocks to target for interpolation
    uint256 public blocksToTarget;

    /// @notice Historical prices by pool and token index
    mapping(address => mapping(uint256 => uint256[])) private _priceHistory;

    /// @notice Max history length
    uint256 public maxHistoryLength;

    /// @notice Governance address
    address public governance;

    // ============ Events ============

    event ParametersUpdated(
        uint256 lookbackPeriod,
        uint256 bandMultiplier,
        uint256 sensitivity
    );

    // ============ Constructor ============

    constructor(
        uint256 lookbackPeriod_,
        uint256 bandMultiplier_,
        uint256 sensitivity_,
        uint256 blocksToTarget_,
        address governance_
    ) Ownable(msg.sender) {
        lookbackPeriod = lookbackPeriod_;
        bandMultiplier = bandMultiplier_;
        sensitivity = sensitivity_;
        blocksToTarget = blocksToTarget_;
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

        uint256[] memory reversionScores = new uint256[](prices.length);

        for (uint256 i = 0; i < prices.length; i++) {
            uint256[] storage history = _priceHistory[pool][i];

            if (history.length < lookbackPeriod) {
                // Not enough data - maintain weight
                reversionScores[i] = WEIGHT_PRECISION;
                continue;
            }

            // Calculate SMA and StdDev
            (uint256 sma, uint256 stdDev) = _calculateStats(history, lookbackPeriod);

            if (stdDev == 0) {
                reversionScores[i] = WEIGHT_PRECISION;
                continue;
            }

            uint256 currentPrice = prices[i];

            // Calculate bands
            uint256 bandWidth = (stdDev * bandMultiplier) / 100;
            uint256 upperBand = sma + bandWidth;
            uint256 lowerBand = sma > bandWidth ? sma - bandWidth : 0;

            // Determine position relative to bands
            uint256 score = WEIGHT_PRECISION;

            if (currentPrice < lowerBand && lowerBand > 0) {
                // Oversold - increase weight
                uint256 distanceBelow = lowerBand - currentPrice;
                uint256 percentBelow = (distanceBelow * BPS_PRECISION) / sma;

                // Scale adjustment by sensitivity
                uint256 adjustment = (percentBelow * sensitivity) / 100;
                adjustment = adjustment > 2000 ? 2000 : adjustment; // Cap at 20%

                score = WEIGHT_PRECISION + (adjustment * WEIGHT_PRECISION) / BPS_PRECISION;
            } else if (currentPrice > upperBand) {
                // Overbought - decrease weight
                uint256 distanceAbove = currentPrice - upperBand;
                uint256 percentAbove = (distanceAbove * BPS_PRECISION) / sma;

                uint256 adjustment = (percentAbove * sensitivity) / 100;
                adjustment = adjustment > 2000 ? 2000 : adjustment; // Cap at 20%

                uint256 decrease = (adjustment * WEIGHT_PRECISION) / BPS_PRECISION;
                score = decrease >= WEIGHT_PRECISION ? WEIGHT_PRECISION / 5 : WEIGHT_PRECISION - decrease;
            }

            reversionScores[i] = score;
        }

        // Apply scores to weights
        for (uint256 i = 0; i < prices.length; i++) {
            newWeights[i] = (currentWeights[i] * reversionScores[i]) / WEIGHT_PRECISION;
        }

        // Normalize
        newWeights = _normalizeWeights(newWeights);
    }

    /**
     * @notice Record prices for calculation
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
        return "MeanReversion";
    }

    /**
     * @inheritdoc IStrategyRule
     */
    function getParameters() external view override returns (bytes memory) {
        return abi.encode(lookbackPeriod, bandMultiplier, sensitivity, blocksToTarget);
    }

    // ============ Admin Functions ============

    function setParameters(
        uint256 lookbackPeriod_,
        uint256 bandMultiplier_,
        uint256 sensitivity_
    ) external onlyGovernance {
        require(bandMultiplier_ >= 100 && bandMultiplier_ <= 400, "Invalid band multiplier");
        require(sensitivity_ > 0 && sensitivity_ <= 500, "Invalid sensitivity");

        lookbackPeriod = lookbackPeriod_;
        bandMultiplier = bandMultiplier_;
        sensitivity = sensitivity_;

        emit ParametersUpdated(lookbackPeriod_, bandMultiplier_, sensitivity_);
    }

    function setBlocksToTarget(uint256 blocks) external onlyGovernance {
        blocksToTarget = blocks;
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        governance = newGovernance;
    }

    // ============ Internal Functions ============

    function _calculateStats(
        uint256[] storage history,
        uint256 period
    ) internal view returns (uint256 sma, uint256 stdDev) {
        uint256 length = period > history.length ? history.length : period;
        uint256 startIndex = history.length - length;

        // Calculate SMA
        uint256 sum = 0;
        for (uint256 i = startIndex; i < history.length; i++) {
            sum += history[i];
        }
        sma = sum / length;

        // Calculate variance
        uint256 sumSquaredDiff = 0;
        for (uint256 i = startIndex; i < history.length; i++) {
            uint256 diff = history[i] > sma ? history[i] - sma : sma - history[i];
            sumSquaredDiff += (diff * diff) / WEIGHT_PRECISION;
        }
        uint256 variance = sumSquaredDiff / length;

        // Calculate standard deviation (sqrt)
        stdDev = _sqrt(variance * WEIGHT_PRECISION);
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

