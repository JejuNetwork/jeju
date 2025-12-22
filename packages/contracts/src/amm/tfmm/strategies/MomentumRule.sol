// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IStrategyRule} from "../IStrategyRule.sol";

/**
 * @title MomentumRule
 * @author Jeju Network
 * @notice Momentum-based weight adjustment strategy
 * @dev Increases weight of assets with positive price momentum
 *
 * Philosophy: "Trend is your friend" - assets going up tend to continue
 *
 * Parameters:
 * - lookbackBlocks: How far back to measure momentum
 * - sensitivity: How aggressively to rebalance (100 = 1x)
 * - momentumThresholdBps: Minimum momentum to act on
 */
contract MomentumRule is IStrategyRule, Ownable {

    // ============ Constants ============

    uint256 private constant WEIGHT_PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10000;

    // ============ State Variables ============

    /// @notice Number of blocks to look back for momentum
    uint256 public lookbackBlocks;

    /// @notice Sensitivity multiplier (100 = 1x, 200 = 2x)
    uint256 public sensitivity;

    /// @notice Minimum momentum in bps to trigger weight change
    uint256 public momentumThresholdBps;

    /// @notice Default blocks to target for interpolation
    uint256 public blocksToTarget;

    /// @notice Historical prices by pool and token index
    mapping(address => mapping(uint256 => uint256[])) private _priceHistory;

    /// @notice Maximum history length per token
    uint256 public maxHistoryLength;

    /// @notice Governance address
    address public governance;

    // ============ Events ============

    event ParametersUpdated(
        uint256 lookbackBlocks,
        uint256 sensitivity,
        uint256 momentumThresholdBps
    );
    event PriceRecorded(address indexed pool, uint256[] prices);

    // ============ Constructor ============

    constructor(
        uint256 lookbackBlocks_,
        uint256 sensitivity_,
        uint256 momentumThresholdBps_,
        uint256 blocksToTarget_,
        address governance_
    ) Ownable(msg.sender) {
        lookbackBlocks = lookbackBlocks_;
        sensitivity = sensitivity_;
        momentumThresholdBps = momentumThresholdBps_;
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

        // Calculate momentum for each token
        uint256[] memory momentumScores = new uint256[](prices.length);
        uint256 totalScore = 0;

        for (uint256 i = 0; i < prices.length; i++) {
            uint256[] storage history = _priceHistory[pool][i];

            if (history.length < 2) {
                // Not enough history - maintain weight
                momentumScores[i] = WEIGHT_PRECISION;
                totalScore += WEIGHT_PRECISION;
                continue;
            }

            // Get oldest price in lookback window
            uint256 lookbackIndex = history.length > lookbackBlocks
                ? history.length - lookbackBlocks
                : 0;
            uint256 oldPrice = history[lookbackIndex];
            uint256 currentPrice = prices[i];

            // Calculate momentum in bps
            int256 momentum;
            if (oldPrice > 0) {
                momentum = int256((currentPrice * BPS_PRECISION) / oldPrice) - int256(BPS_PRECISION);
            }

            // Check threshold
            bool meetsThreshold = momentum > 0
                ? uint256(momentum) >= momentumThresholdBps
                : uint256(-momentum) >= momentumThresholdBps;

            // Calculate score
            uint256 score = WEIGHT_PRECISION;
            if (meetsThreshold) {
                // Apply sensitivity
                int256 adjustedMomentum = (momentum * int256(sensitivity)) / 100;

                // Convert to multiplier (positive momentum = higher score)
                if (adjustedMomentum > 0) {
                    score = WEIGHT_PRECISION + (uint256(adjustedMomentum) * WEIGHT_PRECISION) / BPS_PRECISION;
                } else {
                    uint256 decrease = (uint256(-adjustedMomentum) * WEIGHT_PRECISION) / BPS_PRECISION;
                    score = decrease >= WEIGHT_PRECISION ? WEIGHT_PRECISION / 10 : WEIGHT_PRECISION - decrease;
                }
            }

            momentumScores[i] = score;
            totalScore += score;
        }

        // Calculate new weights based on momentum
        for (uint256 i = 0; i < prices.length; i++) {
            // Blend current weight with momentum-adjusted weight
            uint256 momentumWeight = (currentWeights[i] * momentumScores[i]) / WEIGHT_PRECISION;
            newWeights[i] = momentumWeight;
        }

        // Normalize weights
        newWeights = _normalizeWeights(newWeights);
    }

    /**
     * @notice Record prices for momentum calculation
     * @param pool Pool address
     * @param prices Current prices
     */
    function recordPrices(address pool, uint256[] calldata prices) external {
        for (uint256 i = 0; i < prices.length; i++) {
            uint256[] storage history = _priceHistory[pool][i];
            history.push(prices[i]);

            // Trim if too long
            if (history.length > maxHistoryLength) {
                // Shift array (expensive but maintains order)
                for (uint256 j = 0; j < history.length - 1; j++) {
                    history[j] = history[j + 1];
                }
                history.pop();
            }
        }

        emit PriceRecorded(pool, prices);
    }

    /**
     * @inheritdoc IStrategyRule
     */
    function name() external pure override returns (string memory) {
        return "Momentum";
    }

    /**
     * @inheritdoc IStrategyRule
     */
    function getParameters() external view override returns (bytes memory) {
        return abi.encode(lookbackBlocks, sensitivity, momentumThresholdBps, blocksToTarget);
    }

    // ============ View Functions ============

    /**
     * @notice Get price history length for a token
     */
    function getHistoryLength(address pool, uint256 tokenIndex) external view returns (uint256) {
        return _priceHistory[pool][tokenIndex].length;
    }

    /**
     * @notice Get recent prices for a token
     */
    function getRecentPrices(
        address pool,
        uint256 tokenIndex,
        uint256 count
    ) external view returns (uint256[] memory) {
        uint256[] storage history = _priceHistory[pool][tokenIndex];
        uint256 length = count > history.length ? history.length : count;
        uint256[] memory recent = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            recent[i] = history[history.length - length + i];
        }

        return recent;
    }

    // ============ Admin Functions ============

    function setParameters(
        uint256 lookbackBlocks_,
        uint256 sensitivity_,
        uint256 momentumThresholdBps_
    ) external onlyGovernance {
        require(sensitivity_ > 0 && sensitivity_ <= 500, "Invalid sensitivity");
        require(momentumThresholdBps_ <= 1000, "Threshold too high");

        lookbackBlocks = lookbackBlocks_;
        sensitivity = sensitivity_;
        momentumThresholdBps = momentumThresholdBps_;

        emit ParametersUpdated(lookbackBlocks_, sensitivity_, momentumThresholdBps_);
    }

    function setBlocksToTarget(uint256 blocks) external onlyGovernance {
        blocksToTarget = blocks;
    }

    function setMaxHistoryLength(uint256 length) external onlyOwner {
        maxHistoryLength = length;
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        governance = newGovernance;
    }

    // ============ Internal Functions ============

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

