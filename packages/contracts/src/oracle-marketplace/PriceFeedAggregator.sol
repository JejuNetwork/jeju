// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracleStakingManager} from "./interfaces/IOracleStakingManager.sol";

/**
 * @title IPriceFeed
 * @notice Standard price feed interface (Chainlink-compatible)
 */
interface IPriceFeed {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );

    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

/**
 * @title IChainlinkAggregator
 * @notice Interface for Chainlink price feeds (fallback)
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

/**
 * @title PriceFeedAggregator
 * @notice Aggregates prices from Jeju oracles with Chainlink fallback
 */
contract PriceFeedAggregator is IPriceFeed, Ownable {

    struct FeedConfig {
        bytes32 jejuMarketId;           // Market ID in OracleStakingManager
        address chainlinkFeed;          // Chainlink fallback (address(0) if none)
        uint256 maxStalenessSeconds;    // Max age before price is stale
        uint256 maxDeviationBps;        // Max deviation between sources
        bool requireJejuOracle;         // If true, must have Jeju price
        bool isActive;
    }

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint8 source;  // 0 = none, 1 = Jeju, 2 = Chainlink, 3 = both agree
    }


    uint8 public constant DECIMALS = 8;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Circuit breaker: max 20% price change in single update
    uint256 public constant MAX_PRICE_CHANGE_BPS = 2000;


    IOracleStakingManager public oracleStakingManager;

    // Asset symbol => feed config
    mapping(string => FeedConfig) public feeds;
    string[] public allAssets;

    // Last known prices for circuit breaker
    mapping(string => uint256) public lastPrices;
    mapping(string => uint256) public lastUpdateTimes;

    // Current asset being queried (for interface compatibility)
    string public currentAsset;


    event FeedConfigured(
        string indexed asset,
        bytes32 jejuMarketId,
        address chainlinkFeed
    );

    event PriceUpdated(
        string indexed asset,
        uint256 price,
        uint8 source,
        uint256 timestamp
    );

    event CircuitBreakerTriggered(
        string indexed asset,
        uint256 oldPrice,
        uint256 newPrice,
        uint256 deviationBps
    );


    error FeedNotConfigured();
    error FeedNotActive();
    error StalePrice();
    error NoPriceAvailable();
    error PriceDeviationTooLarge();
    error CircuitBreakerActive();
    error InvalidPrice();


    constructor(address _oracleStakingManager, address initialOwner) Ownable(initialOwner) {
        oracleStakingManager = IOracleStakingManager(_oracleStakingManager);
    }


    /**
     * @notice Get latest price data (Chainlink-compatible interface)
     * @dev Uses currentAsset set by setCurrentAsset or defaults to ETH-USD
     */
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        string memory asset = bytes(currentAsset).length > 0 ? currentAsset : "ETH-USD";
        PriceData memory data = _getPrice(asset);

        if (data.price == 0) revert NoPriceAvailable();

        return (
            uint80(block.number), // roundId = block number
            int256(data.price),
            data.timestamp,
            data.timestamp,
            uint80(block.number)
        );
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function description() external view returns (string memory) {
        return string(abi.encodePacked(currentAsset, " Price Feed"));
    }


    /**
     * @notice Get the current price for an asset
     * @param asset Asset symbol (e.g., "BTC-USD", "ETH-USD")
     * @return price Price with 8 decimals
     * @return timestamp When price was last updated
     * @return isValid Whether price passes all validity checks
     */
    function getPrice(string calldata asset) external view returns (
        uint256 price,
        uint256 timestamp,
        bool isValid
    ) {
        PriceData memory data = _getPrice(asset);
        return (data.price, data.timestamp, data.price > 0 && data.source > 0);
    }

    /**
     * @notice Get price with source information
     * @param asset Asset symbol
     * @return data Full price data including source
     */
    function getPriceWithSource(string calldata asset) external view returns (PriceData memory data) {
        return _getPrice(asset);
    }

    /**
     * @notice Check if a price is valid (fresh and within bounds)
     * @param asset Asset symbol
     * @return valid Whether price is valid
     */
    function isPriceValid(string calldata asset) external view returns (bool valid) {
        PriceData memory data = _getPrice(asset);
        return data.price > 0 && data.source > 0;
    }


    function _getPrice(string memory asset) internal view returns (PriceData memory data) {
        FeedConfig storage config = feeds[asset];

        if (!config.isActive) revert FeedNotActive();

        uint256 jejuPrice;
        uint256 jejuTimestamp;
        bool jejuValid;

        uint256 chainlinkPrice;
        uint256 chainlinkTimestamp;
        bool chainlinkValid;

        // Try Jeju Oracle Network first
        if (config.jejuMarketId != bytes32(0)) {
            (jejuPrice, jejuTimestamp, jejuValid) = _getJejuPrice(config.jejuMarketId, config.maxStalenessSeconds);
        }

        // Try Chainlink fallback
        if (config.chainlinkFeed != address(0)) {
            (chainlinkPrice, chainlinkTimestamp, chainlinkValid) = _getChainlinkPrice(
                config.chainlinkFeed,
                config.maxStalenessSeconds
            );
        }

        // Decision logic
        if (jejuValid && chainlinkValid) {
            // Both sources available - check deviation
            uint256 deviation = _calculateDeviation(jejuPrice, chainlinkPrice);

            if (deviation > config.maxDeviationBps) {
                // Sources disagree too much - use Jeju if required, else Chainlink
                if (config.requireJejuOracle) {
                    data = PriceData({
                        price: jejuPrice,
                        timestamp: jejuTimestamp,
                        source: 1
                    });
                } else {
                    data = PriceData({
                        price: chainlinkPrice,
                        timestamp: chainlinkTimestamp,
                        source: 2
                    });
                }
            } else {
                // Sources agree - use Jeju (prefer decentralized)
                data = PriceData({
                    price: jejuPrice,
                    timestamp: jejuTimestamp,
                    source: 3 // Both agree
                });
            }
        } else if (jejuValid) {
            data = PriceData({
                price: jejuPrice,
                timestamp: jejuTimestamp,
                source: 1
            });
        } else if (chainlinkValid && !config.requireJejuOracle) {
            data = PriceData({
                price: chainlinkPrice,
                timestamp: chainlinkTimestamp,
                source: 2
            });
        }
        // else: data remains zero (no valid price)
    }

    function _getJejuPrice(
        bytes32 marketId,
        uint256 maxStaleness
    ) internal view returns (uint256 price, uint256 timestamp, bool valid) {
        IOracleStakingManager.ConsensusPrice memory cp = oracleStakingManager.getConsensusPrice(marketId);

        if (cp.price == 0) return (0, 0, false);
        if (block.timestamp - cp.timestamp > maxStaleness) return (0, 0, false);
        if (cp.confidence < 5000) return (0, 0, false); // Require 50% confidence

        return (cp.price, cp.timestamp, true);
    }

    function _getChainlinkPrice(
        address feed,
        uint256 maxStaleness
    ) internal view returns (uint256 price, uint256 timestamp, bool valid) {
        (
            ,
            int256 answer,
            ,
            uint256 updatedAt,
        ) = IChainlinkAggregator(feed).latestRoundData();

        if (answer <= 0) return (0, 0, false);
        if (block.timestamp - updatedAt > maxStaleness) return (0, 0, false);

        // Convert to 8 decimals if needed
        uint8 feedDecimals = IChainlinkAggregator(feed).decimals();
        if (feedDecimals < DECIMALS) {
            price = uint256(answer) * (10 ** (DECIMALS - feedDecimals));
        } else if (feedDecimals > DECIMALS) {
            price = uint256(answer) / (10 ** (feedDecimals - DECIMALS));
        } else {
            price = uint256(answer);
        }

        return (price, updatedAt, true);
    }

    function _calculateDeviation(uint256 price1, uint256 price2) internal pure returns (uint256) {
        if (price1 == 0 || price2 == 0) return BPS_DENOMINATOR;
        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        return (diff * BPS_DENOMINATOR) / ((price1 + price2) / 2);
    }


    /**
     * @notice Update the circuit breaker reference price
     * @dev Called after a valid price is used to update the reference
     * @param asset Asset symbol
     * @param price New reference price
     */
    function updateReferencePrice(string calldata asset, uint256 price) external {
        // Only callable by owner or authorized contracts
        require(msg.sender == owner() || _isAuthorizedUpdater(msg.sender), "Unauthorized");

        uint256 oldPrice = lastPrices[asset];

        if (oldPrice > 0) {
            uint256 deviation = _calculateDeviation(oldPrice, price);
            if (deviation > MAX_PRICE_CHANGE_BPS) {
                emit CircuitBreakerTriggered(asset, oldPrice, price, deviation);
                // Don't update - let admin investigate
                return;
            }
        }

        lastPrices[asset] = price;
        lastUpdateTimes[asset] = block.timestamp;

        emit PriceUpdated(asset, price, 0, block.timestamp);
    }

    function _isAuthorizedUpdater(address account) internal view returns (bool) {
        // Can add authorized updater list here
        return account == address(oracleStakingManager);
    }


    /**
     * @notice Configure a price feed for an asset
     * @param asset Asset symbol (e.g., "BTC-USD")
     * @param jejuMarketId Market ID in OracleStakingManager (bytes32(0) if none)
     * @param chainlinkFeed Chainlink aggregator address (address(0) if none)
     * @param maxStalenessSeconds Max age for prices
     * @param maxDeviationBps Max allowed deviation between sources
     * @param requireJejuOracle If true, Jeju oracle is required (no Chainlink-only)
     */
    function configureFeed(
        string calldata asset,
        bytes32 jejuMarketId,
        address chainlinkFeed,
        uint256 maxStalenessSeconds,
        uint256 maxDeviationBps,
        bool requireJejuOracle
    ) external onlyOwner {
        bool isNew = !feeds[asset].isActive;

        feeds[asset] = FeedConfig({
            jejuMarketId: jejuMarketId,
            chainlinkFeed: chainlinkFeed,
            maxStalenessSeconds: maxStalenessSeconds,
            maxDeviationBps: maxDeviationBps,
            requireJejuOracle: requireJejuOracle,
            isActive: true
        });

        if (isNew) {
            allAssets.push(asset);
        }

        emit FeedConfigured(asset, jejuMarketId, chainlinkFeed);
    }

    /**
     * @notice Deactivate a feed
     * @param asset Asset symbol
     */
    function deactivateFeed(string calldata asset) external onlyOwner {
        feeds[asset].isActive = false;
    }

    /**
     * @notice Set the current asset for Chainlink-compatible interface
     * @dev Only owner can change this to prevent front-running issues
     * @param asset Asset symbol
     */
    function setCurrentAsset(string calldata asset) external onlyOwner {
        currentAsset = asset;
    }

    /**
     * @notice Update the oracle staking manager address
     * @param _oracleStakingManager New address
     */
    function setOracleStakingManager(address _oracleStakingManager) external onlyOwner {
        oracleStakingManager = IOracleStakingManager(_oracleStakingManager);
    }


    /**
     * @notice Get all configured assets
     * @return assets Array of asset symbols
     */
    function getAllAssets() external view returns (string[] memory) {
        return allAssets;
    }

    /**
     * @notice Get feed configuration for an asset
     * @param asset Asset symbol
     * @return config Feed configuration
     */
    function getFeedConfig(string calldata asset) external view returns (FeedConfig memory) {
        return feeds[asset];
    }

    /**
     * @notice Check if multiple prices are valid
     * @param assets Array of asset symbols
     * @return validities Array of validity flags
     */
    function arePricesValid(string[] calldata assets) external view returns (bool[] memory validities) {
        validities = new bool[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            PriceData memory data = _getPrice(assets[i]);
            validities[i] = data.price > 0 && data.source > 0;
        }
    }

    /**
     * @notice Get prices for multiple assets
     * @param assets Array of asset symbols
     * @return prices Array of prices
     * @return timestamps Array of timestamps
     */
    function getPrices(string[] calldata assets) external view returns (
        uint256[] memory prices,
        uint256[] memory timestamps
    ) {
        prices = new uint256[](assets.length);
        timestamps = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            PriceData memory data = _getPrice(assets[i]);
            prices[i] = data.price;
            timestamps[i] = data.timestamp;
        }
    }

}
