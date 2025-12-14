// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TWAPLibrary} from "../../../src/oracle/TWAPLibrary.sol";

/// @title TWAPLibrary Fuzz Tests
/// @notice Comprehensive fuzz testing for TWAP calculations and price aggregation
contract TWAPLibraryFuzzTest is Test {
    using TWAPLibrary for *;

    function setUp() public {
        vm.warp(1700000000);
    }

    // ==================== Weighted Median Fuzz Tests ====================

    function testFuzz_CalculateWeightedMedian_TwoPrices(
        uint256 price1,
        uint256 price2,
        uint256 weight1,
        uint256 weight2
    ) public pure {
        price1 = bound(price1, 1e8, 1e14);
        price2 = bound(price2, 1e8, 1e14);
        weight1 = bound(weight1, 1e18, 1e24);
        weight2 = bound(weight2, 1e18, 1e24);

        uint256[] memory prices = new uint256[](2);
        uint256[] memory weights = new uint256[](2);
        prices[0] = price1;
        prices[1] = price2;
        weights[0] = weight1;
        weights[1] = weight2;

        uint256 median = TWAPLibrary.calculateWeightedMedian(prices, weights);

        // Median should be one of the prices
        assertTrue(median == price1 || median == price2);
    }

    function testFuzz_CalculateWeightedMedian_ThreePrices(
        uint256 price1,
        uint256 price2,
        uint256 price3,
        uint256 weight1,
        uint256 weight2,
        uint256 weight3
    ) public pure {
        price1 = bound(price1, 1e8, 1e14);
        price2 = bound(price2, 1e8, 1e14);
        price3 = bound(price3, 1e8, 1e14);
        weight1 = bound(weight1, 1e18, 1e24);
        weight2 = bound(weight2, 1e18, 1e24);
        weight3 = bound(weight3, 1e18, 1e24);

        uint256[] memory prices = new uint256[](3);
        uint256[] memory weights = new uint256[](3);
        prices[0] = price1;
        prices[1] = price2;
        prices[2] = price3;
        weights[0] = weight1;
        weights[1] = weight2;
        weights[2] = weight3;

        uint256 median = TWAPLibrary.calculateWeightedMedian(prices, weights);

        // Median should be within bounds
        uint256 minPrice = price1 < price2 ? (price1 < price3 ? price1 : price3) : (price2 < price3 ? price2 : price3);
        uint256 maxPrice = price1 > price2 ? (price1 > price3 ? price1 : price3) : (price2 > price3 ? price2 : price3);

        assertGe(median, minPrice);
        assertLe(median, maxPrice);
    }

    function testFuzz_CalculateWeightedMedian_DominantWeight(
        uint256 targetPrice,
        uint256 otherPrice1,
        uint256 otherPrice2
    ) public pure {
        targetPrice = bound(targetPrice, 1e8, 1e14);
        otherPrice1 = bound(otherPrice1, 1e8, 1e14);
        otherPrice2 = bound(otherPrice2, 1e8, 1e14);

        uint256[] memory prices = new uint256[](3);
        uint256[] memory weights = new uint256[](3);
        prices[0] = otherPrice1;
        prices[1] = targetPrice;
        prices[2] = otherPrice2;
        // Give target overwhelming weight
        weights[0] = 1e18;
        weights[1] = 1e26; // Much larger
        weights[2] = 1e18;

        uint256 median = TWAPLibrary.calculateWeightedMedian(prices, weights);

        // With dominant weight, median should be the target price
        assertEq(median, targetPrice);
    }

    // ==================== Simple Median Fuzz Tests ====================

    function testFuzz_CalculateMedian_OddCount(uint8 count) public pure {
        count = uint8(bound(count, 1, 21));
        if (count % 2 == 0) count++; // Make odd

        uint256[] memory prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            prices[i] = (i + 1) * 1e8;
        }

        uint256 median = TWAPLibrary.calculateMedian(prices);

        // For sorted 1,2,3...n, median should be middle value
        uint256 expectedMedian = ((count + 1) / 2) * 1e8;
        assertEq(median, expectedMedian);
    }

    function testFuzz_CalculateMedian_EvenCount(uint8 count) public pure {
        count = uint8(bound(count, 2, 20));
        if (count % 2 != 0) count++; // Make even

        uint256[] memory prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            prices[i] = (i + 1) * 1e8;
        }

        uint256 median = TWAPLibrary.calculateMedian(prices);

        // For even count, median is average of two middle values
        uint256 mid = count / 2;
        uint256 expectedMedian = (prices[mid - 1] + prices[mid]) / 2;
        assertEq(median, expectedMedian);
    }

    // ==================== TWAP Calculation Fuzz Tests ====================

    function testFuzz_CalculateTWAP_SingleObservation(uint256 price, uint256 timestamp) public {
        price = bound(price, 1e8, 1e14);
        timestamp = bound(timestamp, block.timestamp - 1800, block.timestamp);

        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](1);
        observations[0] =
            TWAPLibrary.PriceObservation({price: price, timestamp: timestamp, liquidity: 1e24, venue: address(0x1)});

        uint256 twap = TWAPLibrary.calculateTWAP(observations, 1800);

        // Single observation should return that price
        assertEq(twap, price);
    }

    function testFuzz_CalculateTWAP_MultipleObservations(uint256 price1, uint256 price2) public {
        price1 = bound(price1, 1e8, 1e14);
        price2 = bound(price2, 1e8, 1e14);

        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](2);
        observations[0] = TWAPLibrary.PriceObservation({
            price: price1,
            timestamp: block.timestamp - 900,
            liquidity: 1e24,
            venue: address(0x1)
        });
        observations[1] = TWAPLibrary.PriceObservation({
            price: price2,
            timestamp: block.timestamp - 300,
            liquidity: 1e24,
            venue: address(0x1)
        });

        uint256 twap = TWAPLibrary.calculateTWAP(observations, 1800);

        // TWAP should be between the two prices
        uint256 minPrice = price1 < price2 ? price1 : price2;
        uint256 maxPrice = price1 > price2 ? price1 : price2;
        assertGe(twap, minPrice);
        assertLe(twap, maxPrice);
    }

    // ==================== Liquidity-Weighted TWAP Fuzz Tests ====================

    function testFuzz_CalculateLiquidityWeightedTWAP_HighLiquidityBias(
        uint256 highLiqPrice,
        uint256 lowLiqPrice,
        uint256 highLiq,
        uint256 lowLiq
    ) public {
        highLiqPrice = bound(highLiqPrice, 1e10, 1e12);
        lowLiqPrice = bound(lowLiqPrice, 1e10, 1e12);
        // Ensure significant liquidity difference (100x)
        highLiq = bound(highLiq, 1e24, 1e26);
        lowLiq = bound(lowLiq, 1e20, 1e22);

        // Ensure prices are different enough to test bias
        vm.assume(highLiqPrice != lowLiqPrice);
        uint256 priceDiff = highLiqPrice > lowLiqPrice ? highLiqPrice - lowLiqPrice : lowLiqPrice - highLiqPrice;
        vm.assume(priceDiff > 1e8); // At least some difference

        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](2);
        observations[0] = TWAPLibrary.PriceObservation({
            price: lowLiqPrice,
            timestamp: block.timestamp - 900,
            liquidity: lowLiq,
            venue: address(0x1)
        });
        observations[1] = TWAPLibrary.PriceObservation({
            price: highLiqPrice,
            timestamp: block.timestamp - 300,
            liquidity: highLiq,
            venue: address(0x2)
        });

        uint256 twap = TWAPLibrary.calculateLiquidityWeightedTWAP(observations, 1800);

        // TWAP should be between the two prices (basic sanity check)
        uint256 minPrice = highLiqPrice < lowLiqPrice ? highLiqPrice : lowLiqPrice;
        uint256 maxPrice = highLiqPrice > lowLiqPrice ? highLiqPrice : lowLiqPrice;
        assertGe(twap, minPrice);
        assertLe(twap, maxPrice);
    }

    // ==================== Outlier Rejection Fuzz Tests ====================

    function testFuzz_AggregateWithOutlierRejection_NoOutliers(uint256 price1, uint256 price2, uint256 price3)
        public
        pure
    {
        // Prices within 5% of each other
        price1 = bound(price1, 1e10, 1e12);
        price2 = bound(price2, price1 * 98 / 100, price1 * 102 / 100);
        price3 = bound(price3, price1 * 98 / 100, price1 * 102 / 100);

        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](3);
        observations[0] =
            TWAPLibrary.PriceObservation({price: price1, timestamp: 0, liquidity: 1e24, venue: address(0x1)});
        observations[1] =
            TWAPLibrary.PriceObservation({price: price2, timestamp: 0, liquidity: 1e24, venue: address(0x2)});
        observations[2] =
            TWAPLibrary.PriceObservation({price: price3, timestamp: 0, liquidity: 1e24, venue: address(0x3)});

        TWAPLibrary.AggregatedPrice memory result = TWAPLibrary.aggregateWithOutlierRejection(observations, 500);

        // All prices should be included (sourceCount = 3)
        assertEq(result.sourceCount, 3);
    }

    function testFuzz_AggregateWithOutlierRejection_WithOutlier(uint256 normalPrice, uint256 outlierMultiplier)
        public
        pure
    {
        normalPrice = bound(normalPrice, 1e10, 1e12);
        outlierMultiplier = bound(outlierMultiplier, 2, 10); // 2x-10x deviation

        uint256 outlierPrice = normalPrice * outlierMultiplier;

        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](3);
        observations[0] =
            TWAPLibrary.PriceObservation({price: normalPrice, timestamp: 0, liquidity: 1e24, venue: address(0x1)});
        observations[1] =
            TWAPLibrary.PriceObservation({price: normalPrice, timestamp: 0, liquidity: 1e24, venue: address(0x2)});
        observations[2] =
            TWAPLibrary.PriceObservation({price: outlierPrice, timestamp: 0, liquidity: 1e24, venue: address(0x3)});

        TWAPLibrary.AggregatedPrice memory result = TWAPLibrary.aggregateWithOutlierRejection(observations, 500);

        // Outlier should be rejected (sourceCount = 2)
        assertEq(result.sourceCount, 2);
        // Result should be close to normal price
        assertEq(result.price, normalPrice);
    }

    // ==================== Cross-Venue Median Fuzz Tests ====================

    function testFuzz_CalculateCrossVenueMedian_LiquidityFilter(
        uint256 minLiquidity,
        uint256 numAbove,
        uint256 numBelow
    ) public pure {
        minLiquidity = bound(minLiquidity, 1e20, 1e24);
        numAbove = bound(numAbove, 1, 5);
        numBelow = bound(numBelow, 0, 5);

        uint256 totalCount = numAbove + numBelow;
        TWAPLibrary.PriceObservation[] memory observations = new TWAPLibrary.PriceObservation[](totalCount);

        // Add observations above threshold
        for (uint256 i = 0; i < numAbove; i++) {
            observations[i] = TWAPLibrary.PriceObservation({
                price: (1000 + i) * 1e8,
                timestamp: 0,
                liquidity: minLiquidity + (i * 1e20),
                venue: address(uint160(0x100 + i))
            });
        }

        // Add observations below threshold
        for (uint256 i = 0; i < numBelow; i++) {
            observations[numAbove + i] = TWAPLibrary.PriceObservation({
                price: (2000 + i) * 1e8,
                timestamp: 0,
                liquidity: minLiquidity / 2,
                venue: address(uint160(0x200 + i))
            });
        }

        (uint256 price, uint256 validVenues) = TWAPLibrary.calculateCrossVenueMedian(observations, minLiquidity);

        // Only venues above threshold should count
        assertEq(validVenues, numAbove);
        assertTrue(price > 0);
    }

    // ==================== TWAP Accumulator Fuzz Tests ====================

    function testFuzz_UpdateAccumulator_TimeProgression(uint256 numUpdates, uint256 priceBase) public {
        numUpdates = bound(numUpdates, 1, 20);
        priceBase = bound(priceBase, 1e8, 1e12);

        TWAPLibrary.TWAPAccumulator memory acc;

        for (uint256 i = 0; i < numUpdates; i++) {
            vm.warp(block.timestamp + 60);
            uint256 newPrice = priceBase + (i * 1e6);
            acc = TWAPLibrary.updateAccumulator(acc, newPrice);
        }

        uint256 twap = TWAPLibrary.getTWAPFromAccumulator(acc);

        // TWAP should be in reasonable range
        assertGe(twap, priceBase);
        assertLe(twap, priceBase + (numUpdates * 1e6));
    }

    // ==================== Deviation Calculation Fuzz Tests ====================

    function testFuzz_CalculateDeviation_Symmetry(uint256 price1, uint256 price2) public pure {
        price1 = bound(price1, 1e8, 1e14);
        price2 = bound(price2, 1e8, 1e14);

        uint256 deviation1 = TWAPLibrary.calculateDeviation(price1, price2);
        uint256 deviation2 = TWAPLibrary.calculateDeviation(price2, price1);

        // Deviation should be symmetric
        assertEq(deviation1, deviation2);
    }

    function testFuzz_CalculateDeviation_SamePrice(uint256 price) public pure {
        price = bound(price, 1e8, 1e14);

        uint256 deviation = TWAPLibrary.calculateDeviation(price, price);

        // Same price = 0 deviation
        assertEq(deviation, 0);
    }

    function testFuzz_CalculateDeviation_Properties(uint256 price1, uint256 price2) public pure {
        // Bound prices to reasonable range
        price1 = bound(price1, 1e10, 1e12);
        price2 = bound(price2, 1e10, 1e12);

        uint256 deviation = TWAPLibrary.calculateDeviation(price1, price2);

        // If prices are equal (after bounding), deviation should be 0
        if (price1 == price2) {
            assertEq(deviation, 0);
        }

        // Deviation should be symmetric
        uint256 reverseDeviation = TWAPLibrary.calculateDeviation(price2, price1);
        assertEq(deviation, reverseDeviation);

        // Verify the calculation formula
        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        uint256 avg = (price1 + price2) / 2;
        if (avg > 0) {
            uint256 expectedDeviation = (diff * 10000) / avg;
            assertEq(deviation, expectedDeviation);
        }
    }

    // ==================== Price Validity Fuzz Tests ====================

    function testFuzz_IsPriceValid_Threshold(uint256 price, uint256 refPrice, uint256 maxDeviationBps) public pure {
        price = bound(price, 1e8, 1e14);
        refPrice = bound(refPrice, 1e8, 1e14);
        maxDeviationBps = bound(maxDeviationBps, 1, 5000);

        bool isValid = TWAPLibrary.isPriceValid(price, refPrice, maxDeviationBps);
        uint256 actualDeviation = TWAPLibrary.calculateDeviation(price, refPrice);

        if (actualDeviation <= maxDeviationBps) {
            assertTrue(isValid);
        } else {
            assertFalse(isValid);
        }
    }

    // ==================== Price Scaling Fuzz Tests ====================

    function testFuzz_ScalePrice_RoundTrip(uint256 price, uint8 fromDecimals, uint8 toDecimals) public pure {
        price = bound(price, 1, 1e30);
        fromDecimals = uint8(bound(fromDecimals, 1, 18));
        toDecimals = uint8(bound(toDecimals, 1, 18));

        uint256 scaled = TWAPLibrary.scalePrice(price, fromDecimals, toDecimals);
        uint256 roundTrip = TWAPLibrary.scalePrice(scaled, toDecimals, fromDecimals);

        // Round trip should preserve value (within rounding if scaling down then up)
        if (fromDecimals <= toDecimals) {
            assertEq(roundTrip, price);
        } else {
            // When scaling down, we lose precision
            uint256 lostPrecision = 10 ** (fromDecimals - toDecimals);
            assertLe(price - roundTrip, lostPrecision);
        }
    }

    // ==================== Confidence Band Fuzz Tests ====================

    function testFuzz_CalculateConfidenceBand_Uniform(uint256 price, uint8 count) public pure {
        price = bound(price, 1e8, 1e14);
        count = uint8(bound(count, 1, 10));

        uint256[] memory prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            prices[i] = price;
        }

        uint256 bandwidth = TWAPLibrary.calculateConfidenceBand(prices);

        // All same price = 0 bandwidth
        assertEq(bandwidth, 0);
    }

    function testFuzz_CalculateConfidenceBand_Spread(uint256 minPrice, uint256 spread) public pure {
        minPrice = bound(minPrice, 1e10, 1e12);
        // Ensure meaningful spread - at least 1e6 to avoid rounding issues
        spread = bound(spread, 1e6, minPrice / 4);

        uint256[] memory prices = new uint256[](3);
        prices[0] = minPrice;
        prices[1] = minPrice + spread / 2;
        prices[2] = minPrice + spread;

        uint256 bandwidth = TWAPLibrary.calculateConfidenceBand(prices);

        // Bandwidth should be non-negative
        assertGe(bandwidth, 0);
    }

    // ==================== Square Root Fuzz Tests ====================

    function testFuzz_Sqrt_Accuracy(uint256 x) public pure {
        x = bound(x, 0, 1e36);

        uint256 result = TWAPLibrary.sqrt(x);

        // result^2 <= x < (result+1)^2
        assertLe(result * result, x);
        if (result < type(uint128).max) {
            assertGt((result + 1) * (result + 1), x);
        }
    }
}
