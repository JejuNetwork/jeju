// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title OracleLib
 * @author Jeju Network
 * @notice Library for oracle price reading (Chainlink, Pyth, TWAP)
 */
library OracleLib {
    // ============ Structs ============

    /// @notice Chainlink aggregator configuration
    struct ChainlinkConfig {
        address feed;           // Aggregator address
        uint256 maxStaleness;   // Maximum age of price data in seconds
        uint8 expectedDecimals; // Expected decimal precision
    }

    /// @notice Price result with metadata
    struct PriceResult {
        uint256 price;          // Price value
        uint256 timestamp;      // When price was updated
        uint8 decimals;         // Price decimals
        bool isValid;           // Whether price passed validation
    }

    // ============ Errors ============

    error InvalidPrice();
    error StalePrice(uint256 updatedAt, uint256 maxAge);
    error StaleRound(uint80 answeredInRound, uint80 roundId);
    error ZeroAddress();

    // ============ Chainlink Functions ============

    /**
     * @notice Read price from Chainlink aggregator with full validation
     * @param config Chainlink configuration
     * @return result Price result with validation status
     */
    function readChainlinkPrice(ChainlinkConfig memory config) internal view returns (PriceResult memory result) {
        if (config.feed == address(0)) revert ZeroAddress();

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = IChainlinkAggregator(config.feed).latestRoundData();

        result.timestamp = updatedAt;
        result.decimals = config.expectedDecimals;

        // Validate price is positive
        if (answer <= 0) {
            result.isValid = false;
            return result;
        }

        // Validate round freshness
        if (answeredInRound < roundId) {
            result.isValid = false;
            return result;
        }

        // Validate staleness
        if (updatedAt == 0 || block.timestamp - updatedAt > config.maxStaleness) {
            result.isValid = false;
            return result;
        }

        result.price = uint256(answer);
        result.isValid = true;
    }

    /**
     * @notice Read price from Chainlink with revert on invalid
     * @param config Chainlink configuration
     * @return price Validated price
     * @return timestamp Price update timestamp
     */
    function readChainlinkPriceStrict(ChainlinkConfig memory config) internal view returns (uint256 price, uint256 timestamp) {
        if (config.feed == address(0)) revert ZeroAddress();

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = IChainlinkAggregator(config.feed).latestRoundData();

        if (answer <= 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert StaleRound(answeredInRound, roundId);
        if (updatedAt == 0 || block.timestamp - updatedAt > config.maxStaleness) {
            revert StalePrice(updatedAt, config.maxStaleness);
        }

        return (uint256(answer), updatedAt);
    }

    /**
     * @notice Check if a Chainlink price is stale
     * @param feed Aggregator address
     * @param maxAge Maximum allowed age in seconds
     * @return isStale True if price is stale
     */
    function isChainlinkStale(address feed, uint256 maxAge) internal view returns (bool isStale) {
        (, , , uint256 updatedAt, ) = IChainlinkAggregator(feed).latestRoundData();
        return updatedAt == 0 || block.timestamp - updatedAt > maxAge;
    }

    /**
     * @notice Get decimals from Chainlink feed
     * @param feed Aggregator address
     * @return decimals Feed decimals
     */
    function getChainlinkDecimals(address feed) internal view returns (uint8) {
        return IChainlinkAggregator(feed).decimals();
    }

    // ============ Decimal Normalization ============

    /**
     * @notice Normalize price to target decimals
     * @param value Price value
     * @param fromDecimals Source decimals
     * @param toDecimals Target decimals
     * @return normalized Normalized price
     */
    function normalizeDecimals(uint256 value, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256 normalized) {
        if (fromDecimals == toDecimals) {
            return value;
        } else if (fromDecimals > toDecimals) {
            return value / (10 ** (fromDecimals - toDecimals));
        } else {
            return value * (10 ** (toDecimals - fromDecimals));
        }
    }

    /**
     * @notice Convert price from one token to another using oracle prices
     * @param amount Amount of source token
     * @param sourcePrice Price of source token (in USD, 8 decimals)
     * @param targetPrice Price of target token (in USD, 8 decimals)
     * @param sourceDecimals Decimals of source token
     * @param targetDecimals Decimals of target token
     * @return converted Amount in target token
     */
    function convertViaUSD(
        uint256 amount,
        uint256 sourcePrice,
        uint256 targetPrice,
        uint8 sourceDecimals,
        uint8 targetDecimals
    ) internal pure returns (uint256 converted) {
        // Convert to USD value (8 decimals)
        uint256 usdValue = (amount * sourcePrice) / (10 ** sourceDecimals);
        // Convert USD value to target token
        converted = (usdValue * (10 ** targetDecimals)) / targetPrice;
    }

    // ============ Price Deviation ============

    /**
     * @notice Calculate price deviation in basis points
     * @param currentPrice Current price
     * @param referencePrice Reference price to compare against
     * @return deviationBps Deviation in basis points (10000 = 100%)
     */
    function calculateDeviationBps(uint256 currentPrice, uint256 referencePrice) internal pure returns (uint256 deviationBps) {
        if (referencePrice == 0) return type(uint256).max;
        
        uint256 priceDiff = currentPrice > referencePrice 
            ? currentPrice - referencePrice 
            : referencePrice - currentPrice;
        
        deviationBps = (priceDiff * 10000) / referencePrice;
    }

    /**
     * @notice Check if price deviation exceeds threshold
     * @param currentPrice Current price
     * @param referencePrice Reference price
     * @param maxDeviationBps Maximum allowed deviation in basis points
     * @return exceeded True if deviation exceeds threshold
     */
    function isDeviationExceeded(
        uint256 currentPrice,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) internal pure returns (bool exceeded) {
        return calculateDeviationBps(currentPrice, referencePrice) > maxDeviationBps;
    }
}

/**
 * @title IChainlinkAggregator
 * @notice Minimal Chainlink AggregatorV3 interface
 */
interface IChainlinkAggregator {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    
    function decimals() external view returns (uint8);
}
