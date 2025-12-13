// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title TWAPLibrary
 * @author Jeju Network
 * @notice Library for TWAP (Time-Weighted Average Price) calculations
 * @dev Provides utilities for computing weighted medians, TWAP from observations,
 *      and cross-venue price aggregation for the Jeju Oracle Network.
 *
 * Key Features:
 * - Weighted median calculation for consensus
 * - TWAP computation from price observations
 * - Outlier rejection for manipulation resistance
 * - Confidence band calculation
 */
library TWAPLibrary {
    // ============ Structs ============

    struct PriceObservation {
        uint256 price;
        uint256 timestamp;
        uint256 liquidity;
        address venue;
    }

    struct AggregatedPrice {
        uint256 price;
        uint256 confidence;
        uint256 minPrice;
        uint256 maxPrice;
        uint256 sourceCount;
    }

    struct TWAPAccumulator {
        uint256 cumulativePrice;
        uint256 cumulativeTime;
        uint256 lastTimestamp;
        uint256 lastPrice;
    }

    // ============ Constants ============

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS_DENOMINATOR = 10000;
    uint256 constant DEFAULT_OUTLIER_THRESHOLD_BPS = 500; // 5%

    // ============ Core Functions ============

    /**
     * @notice Calculate weighted median from an array of prices and weights
     * @param prices Array of prices
     * @param weights Array of weights (e.g., liquidity)
     * @return median The weighted median price
     */
    function calculateWeightedMedian(
        uint256[] memory prices,
        uint256[] memory weights
    ) internal pure returns (uint256 median) {
        require(prices.length == weights.length && prices.length > 0, "Invalid input");

        // Sort prices with weights (bubble sort - fine for small N)
        for (uint256 i = 0; i < prices.length - 1; i++) {
            for (uint256 j = 0; j < prices.length - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    // Swap prices
                    (prices[j], prices[j + 1]) = (prices[j + 1], prices[j]);
                    // Swap weights
                    (weights[j], weights[j + 1]) = (weights[j + 1], weights[j]);
                }
            }
        }

        // Calculate total weight
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }

        // Find weighted median
        uint256 halfWeight = totalWeight / 2;
        uint256 cumulativeWeight = 0;

        for (uint256 i = 0; i < prices.length; i++) {
            cumulativeWeight += weights[i];
            if (cumulativeWeight >= halfWeight) {
                return prices[i];
            }
        }

        // Fallback to last price
        return prices[prices.length - 1];
    }

    /**
     * @notice Calculate simple median from an array of prices
     * @param prices Array of prices
     * @return median The median price
     */
    function calculateMedian(uint256[] memory prices) internal pure returns (uint256 median) {
        require(prices.length > 0, "Empty array");

        // Sort prices
        for (uint256 i = 0; i < prices.length - 1; i++) {
            for (uint256 j = 0; j < prices.length - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    (prices[j], prices[j + 1]) = (prices[j + 1], prices[j]);
                }
            }
        }

        uint256 mid = prices.length / 2;
        if (prices.length % 2 == 0) {
            return (prices[mid - 1] + prices[mid]) / 2;
        } else {
            return prices[mid];
        }
    }

    /**
     * @notice Calculate TWAP from observations
     * @param observations Array of price observations
     * @param windowSeconds Time window for TWAP
     * @return twap The time-weighted average price
     */
    function calculateTWAP(
        PriceObservation[] memory observations,
        uint256 windowSeconds
    ) internal view returns (uint256 twap) {
        require(observations.length > 0, "No observations");

        uint256 cutoffTime = block.timestamp - windowSeconds;
        uint256 totalWeight = 0;
        uint256 weightedSum = 0;

        for (uint256 i = 0; i < observations.length; i++) {
            if (observations[i].timestamp >= cutoffTime) {
                // Weight by time in window
                uint256 timeWeight = observations[i].timestamp - cutoffTime;
                weightedSum += observations[i].price * timeWeight;
                totalWeight += timeWeight;
            }
        }

        if (totalWeight == 0) {
            // Fallback to latest price
            return observations[observations.length - 1].price;
        }

        return weightedSum / totalWeight;
    }

    /**
     * @notice Calculate liquidity-weighted TWAP
     * @param observations Array of price observations
     * @param windowSeconds Time window for TWAP
     * @return twap The liquidity and time-weighted average price
     */
    function calculateLiquidityWeightedTWAP(
        PriceObservation[] memory observations,
        uint256 windowSeconds
    ) internal view returns (uint256 twap) {
        require(observations.length > 0, "No observations");

        uint256 cutoffTime = block.timestamp - windowSeconds;
        uint256 totalWeight = 0;
        uint256 weightedSum = 0;

        for (uint256 i = 0; i < observations.length; i++) {
            if (observations[i].timestamp >= cutoffTime) {
                // Weight by time * sqrt(liquidity)
                uint256 timeWeight = observations[i].timestamp - cutoffTime;
                uint256 liquidityWeight = sqrt(observations[i].liquidity);
                uint256 combinedWeight = timeWeight * liquidityWeight;

                weightedSum += observations[i].price * combinedWeight;
                totalWeight += combinedWeight;
            }
        }

        if (totalWeight == 0) {
            return observations[observations.length - 1].price;
        }

        return weightedSum / totalWeight;
    }

    /**
     * @notice Aggregate prices from multiple venues with outlier rejection
     * @param observations Array of price observations
     * @param outlierThresholdBps Maximum deviation from median before considered outlier
     * @return aggregated The aggregated price result
     */
    function aggregateWithOutlierRejection(
        PriceObservation[] memory observations,
        uint256 outlierThresholdBps
    ) internal pure returns (AggregatedPrice memory aggregated) {
        require(observations.length > 0, "No observations");

        if (outlierThresholdBps == 0) {
            outlierThresholdBps = DEFAULT_OUTLIER_THRESHOLD_BPS;
        }

        // First pass: calculate preliminary median
        uint256[] memory prices = new uint256[](observations.length);
        for (uint256 i = 0; i < observations.length; i++) {
            prices[i] = observations[i].price;
        }
        uint256 prelimMedian = calculateMedian(prices);

        // Second pass: reject outliers and recalculate
        uint256 validCount = 0;
        uint256[] memory validPrices = new uint256[](observations.length);
        uint256[] memory validWeights = new uint256[](observations.length);

        for (uint256 i = 0; i < observations.length; i++) {
            uint256 deviation = calculateDeviation(observations[i].price, prelimMedian);
            if (deviation <= outlierThresholdBps) {
                validPrices[validCount] = observations[i].price;
                validWeights[validCount] = observations[i].liquidity;
                validCount++;
            }
        }

        require(validCount > 0, "All prices rejected as outliers");

        // Resize arrays
        uint256[] memory finalPrices = new uint256[](validCount);
        uint256[] memory finalWeights = new uint256[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            finalPrices[i] = validPrices[i];
            finalWeights[i] = validWeights[i];
        }

        // Calculate final weighted median
        aggregated.price = calculateWeightedMedian(finalPrices, finalWeights);
        aggregated.sourceCount = validCount;

        // Calculate confidence (based on agreement between sources)
        uint256 agreementCount = 0;
        uint256 confidenceThreshold = 100; // 1%

        for (uint256 i = 0; i < validCount; i++) {
            if (calculateDeviation(finalPrices[i], aggregated.price) <= confidenceThreshold) {
                agreementCount++;
            }
        }

        aggregated.confidence = (agreementCount * BPS_DENOMINATOR) / validCount;

        // Find min/max
        aggregated.minPrice = finalPrices[0];
        aggregated.maxPrice = finalPrices[0];
        for (uint256 i = 1; i < validCount; i++) {
            if (finalPrices[i] < aggregated.minPrice) aggregated.minPrice = finalPrices[i];
            if (finalPrices[i] > aggregated.maxPrice) aggregated.maxPrice = finalPrices[i];
        }
    }

    /**
     * @notice Calculate cross-venue median with minimum liquidity filter
     * @param observations Array of price observations
     * @param minLiquidityUSD Minimum liquidity required per venue
     * @return price The filtered median price
     * @return validVenues Number of venues meeting liquidity requirement
     */
    function calculateCrossVenueMedian(
        PriceObservation[] memory observations,
        uint256 minLiquidityUSD
    ) internal pure returns (uint256 price, uint256 validVenues) {
        // Filter by liquidity
        uint256[] memory validPrices = new uint256[](observations.length);
        uint256 count = 0;

        for (uint256 i = 0; i < observations.length; i++) {
            if (observations[i].liquidity >= minLiquidityUSD) {
                validPrices[count] = observations[i].price;
                count++;
            }
        }

        if (count == 0) {
            // Fallback: use all observations
            for (uint256 i = 0; i < observations.length; i++) {
                validPrices[i] = observations[i].price;
            }
            count = observations.length;
        }

        // Resize and calculate median
        uint256[] memory finalPrices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            finalPrices[i] = validPrices[i];
        }

        return (calculateMedian(finalPrices), count);
    }

    /**
     * @notice Update TWAP accumulator with new observation
     * @param acc Current accumulator state
     * @param newPrice New price observation
     * @return Updated accumulator
     */
    function updateAccumulator(
        TWAPAccumulator memory acc,
        uint256 newPrice
    ) internal view returns (TWAPAccumulator memory) {
        if (acc.lastTimestamp == 0) {
            // First observation
            acc.lastTimestamp = block.timestamp;
            acc.lastPrice = newPrice;
            return acc;
        }

        uint256 timeElapsed = block.timestamp - acc.lastTimestamp;
        if (timeElapsed > 0) {
            // Accumulate time-weighted price
            acc.cumulativePrice += acc.lastPrice * timeElapsed;
            acc.cumulativeTime += timeElapsed;
        }

        acc.lastTimestamp = block.timestamp;
        acc.lastPrice = newPrice;

        return acc;
    }

    /**
     * @notice Get TWAP from accumulator
     * @param acc Accumulator state
     * @return twap Current TWAP value
     */
    function getTWAPFromAccumulator(TWAPAccumulator memory acc) internal view returns (uint256 twap) {
        if (acc.cumulativeTime == 0) {
            return acc.lastPrice;
        }

        // Include time since last update
        uint256 timeElapsed = block.timestamp - acc.lastTimestamp;
        uint256 totalTime = acc.cumulativeTime + timeElapsed;
        uint256 totalPrice = acc.cumulativePrice + (acc.lastPrice * timeElapsed);

        return totalPrice / totalTime;
    }

    // ============ Utility Functions ============

    /**
     * @notice Calculate deviation between two prices in basis points
     * @param price1 First price
     * @param price2 Second price
     * @return deviation Deviation in basis points
     */
    function calculateDeviation(uint256 price1, uint256 price2) internal pure returns (uint256 deviation) {
        if (price1 == 0 || price2 == 0) return BPS_DENOMINATOR;
        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        return (diff * BPS_DENOMINATOR) / ((price1 + price2) / 2);
    }

    /**
     * @notice Calculate confidence band width
     * @param prices Array of prices
     * @return bandwidth Confidence band width (max - min) / median
     */
    function calculateConfidenceBand(uint256[] memory prices) internal pure returns (uint256 bandwidth) {
        if (prices.length == 0) return 0;

        uint256 minPrice = prices[0];
        uint256 maxPrice = prices[0];

        for (uint256 i = 1; i < prices.length; i++) {
            if (prices[i] < minPrice) minPrice = prices[i];
            if (prices[i] > maxPrice) maxPrice = prices[i];
        }

        uint256 median = calculateMedian(prices);
        if (median == 0) return 0;

        return ((maxPrice - minPrice) * BPS_DENOMINATOR) / median;
    }

    /**
     * @notice Integer square root using Babylonian method
     * @param x Input value
     * @return y Square root of x
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /**
     * @notice Check if price is within acceptable bounds of reference
     * @param price Price to check
     * @param refPrice Reference price
     * @param maxDeviationBps Maximum allowed deviation
     * @return valid Whether price is within bounds
     */
    function isPriceValid(
        uint256 price,
        uint256 refPrice,
        uint256 maxDeviationBps
    ) internal pure returns (bool valid) {
        return calculateDeviation(price, refPrice) <= maxDeviationBps;
    }

    /**
     * @notice Scale price to target decimals
     * @param price Original price
     * @param fromDecimals Original decimals
     * @param toDecimals Target decimals
     * @return scaledPrice Price in target decimals
     */
    function scalePrice(
        uint256 price,
        uint8 fromDecimals,
        uint8 toDecimals
    ) internal pure returns (uint256 scaledPrice) {
        if (fromDecimals == toDecimals) return price;

        if (fromDecimals < toDecimals) {
            return price * (10 ** (toDecimals - fromDecimals));
        } else {
            return price / (10 ** (fromDecimals - toDecimals));
        }
    }
}
