// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "./interfaces/IPerps.sol";

/**
 * @title PerpsPriceOracle
 * @notice Price oracle for perpetual futures markets
 * @dev Aggregates prices from Pyth, Chainlink, and TWAP with priority fallback
 */
contract PerpsPriceOracle is IPriceOracle, Ownable {
    // External oracle interfaces
    address public pythOracle;
    address public chainlinkRegistry;
    address public twapOracle;

    // Price feed configuration per asset
    struct PriceFeed {
        bytes32 pythPriceId;
        address chainlinkFeed;
        address twapPool;
        uint256 maxStaleness;
        uint8 decimals;
        bool isActive;
    }

    // Market configuration for mark/index prices
    struct MarketPriceFeed {
        address baseAsset;
        address quoteAsset;
        int256 markPriceAdjustment; // bps adjustment for mark price
        bool useExternalMark;
    }

    mapping(address => PriceFeed) public assetFeeds;
    mapping(bytes32 => MarketPriceFeed) public marketFeeds;

    // Manual price fallback (for emergencies)
    mapping(address => uint256) public manualPrices;
    mapping(address => uint256) public manualPriceTimestamps;

    // Price limits
    uint256 public constant MAX_PRICE_DEVIATION_BPS = 500; // 5% max deviation between sources
    uint256 public constant DEFAULT_STALENESS = 1 hours;

    event PriceFeedUpdated(address indexed asset, bytes32 pythId, address chainlinkFeed);
    event MarketFeedUpdated(bytes32 indexed marketId, address baseAsset, address quoteAsset);
    event ManualPriceSet(address indexed asset, uint256 price);

    constructor(address _pythOracle, address _chainlinkRegistry, address _twapOracle, address _owner) Ownable(_owner) {
        pythOracle = _pythOracle;
        chainlinkRegistry = _chainlinkRegistry;
        twapOracle = _twapOracle;
    }

    // ============ Admin Functions ============

    function setPythOracle(address _pythOracle) external onlyOwner {
        pythOracle = _pythOracle;
    }

    function setChainlinkRegistry(address _registry) external onlyOwner {
        chainlinkRegistry = _registry;
    }

    function setTwapOracle(address _twapOracle) external onlyOwner {
        twapOracle = _twapOracle;
    }

    function setAssetFeed(
        address asset,
        bytes32 pythPriceId,
        address chainlinkFeed,
        address twapPool,
        uint256 maxStaleness,
        uint8 decimals
    ) external onlyOwner {
        assetFeeds[asset] = PriceFeed({
            pythPriceId: pythPriceId,
            chainlinkFeed: chainlinkFeed,
            twapPool: twapPool,
            maxStaleness: maxStaleness > 0 ? maxStaleness : DEFAULT_STALENESS,
            decimals: decimals > 0 ? decimals : 8,
            isActive: true
        });

        emit PriceFeedUpdated(asset, pythPriceId, chainlinkFeed);
    }

    function setMarketFeed(
        bytes32 marketId,
        address baseAsset,
        address quoteAsset,
        int256 markPriceAdjustment,
        bool useExternalMark
    ) external onlyOwner {
        marketFeeds[marketId] = MarketPriceFeed({
            baseAsset: baseAsset,
            quoteAsset: quoteAsset,
            markPriceAdjustment: markPriceAdjustment,
            useExternalMark: useExternalMark
        });

        emit MarketFeedUpdated(marketId, baseAsset, quoteAsset);
    }

    function setManualPrice(address asset, uint256 price) external onlyOwner {
        manualPrices[asset] = price;
        manualPriceTimestamps[asset] = block.timestamp;

        emit ManualPriceSet(asset, price);
    }

    function deactivateFeed(address asset) external onlyOwner {
        assetFeeds[asset].isActive = false;
    }

    // ============ Price Functions ============

    /**
     * @notice Get price for an asset with timestamp
     * @param asset Asset address
     * @return price Price in USD (normalized to 8 decimals)
     * @return timestamp When the price was last updated
     */
    function getPrice(address asset) external view returns (uint256 price, uint256 timestamp) {
        PriceFeed memory feed = assetFeeds[asset];

        // Try Pyth first
        if (pythOracle != address(0) && feed.pythPriceId != bytes32(0)) {
            (uint256 pythPrice, uint256 pythTime, bool pythValid) = _getPythPrice(feed.pythPriceId);
            if (pythValid && block.timestamp - pythTime <= feed.maxStaleness) {
                return (_normalizePrice(pythPrice, feed.decimals), pythTime);
            }
        }

        // Try Chainlink
        if (chainlinkRegistry != address(0) && feed.chainlinkFeed != address(0)) {
            (uint256 clPrice, uint256 clTime, bool clValid) = _getChainlinkPrice(feed.chainlinkFeed);
            if (clValid && block.timestamp - clTime <= feed.maxStaleness) {
                return (_normalizePrice(clPrice, feed.decimals), clTime);
            }
        }

        // Try TWAP
        if (twapOracle != address(0) && feed.twapPool != address(0)) {
            (uint256 twapPrice, bool twapValid) = _getTwapPrice(feed.twapPool);
            if (twapValid) {
                return (_normalizePrice(twapPrice, feed.decimals), block.timestamp);
            }
        }

        // Manual fallback
        uint256 manualPrice = manualPrices[asset];
        uint256 manualTime = manualPriceTimestamps[asset];
        if (manualPrice > 0 && block.timestamp - manualTime <= feed.maxStaleness) {
            return (manualPrice, manualTime);
        }

        revert("No valid price available");
    }

    /**
     * @notice Get mark price for a perpetual market
     * @param marketId Market identifier
     * @return Mark price (used for PnL calculations)
     */
    function getMarkPrice(bytes32 marketId) external view returns (uint256) {
        MarketPriceFeed memory market = marketFeeds[marketId];
        require(market.baseAsset != address(0), "Market not configured");

        (uint256 basePrice,) = this.getPrice(market.baseAsset);
        uint256 quotePrice = 1e8; // Default to 1 USD

        if (market.quoteAsset != address(0)) {
            (quotePrice,) = this.getPrice(market.quoteAsset);
        }

        // Calculate base/quote price
        uint256 price = (basePrice * 1e8) / quotePrice;

        // Apply mark adjustment if configured
        if (market.markPriceAdjustment != 0) {
            if (market.markPriceAdjustment > 0) {
                price = price + (price * uint256(market.markPriceAdjustment)) / 10000;
            } else {
                price = price - (price * uint256(-market.markPriceAdjustment)) / 10000;
            }
        }

        return price;
    }

    /**
     * @notice Get index price for a perpetual market (oracle price)
     * @param marketId Market identifier
     * @return Index price (used for funding rate calculations)
     */
    function getIndexPrice(bytes32 marketId) external view returns (uint256) {
        MarketPriceFeed memory market = marketFeeds[marketId];
        require(market.baseAsset != address(0), "Market not configured");

        (uint256 basePrice,) = this.getPrice(market.baseAsset);
        uint256 quotePrice = 1e8;

        if (market.quoteAsset != address(0)) {
            (quotePrice,) = this.getPrice(market.quoteAsset);
        }

        return (basePrice * 1e8) / quotePrice;
    }

    // ============ Internal Functions ============

    function _getPythPrice(bytes32 priceId) internal view returns (uint256 price, uint256 timestamp, bool valid) {
        if (pythOracle == address(0)) return (0, 0, false);

        // Call Pyth oracle
        // Interface: function getPriceUnsafe(bytes32 id) returns (Price memory)
        // Price struct: int64 price, uint64 conf, int32 expo, uint publishTime
        (bool success, bytes memory data) =
            pythOracle.staticcall(abi.encodeWithSignature("getPriceUnsafe(bytes32)", priceId));

        if (!success || data.length < 128) return (0, 0, false);

        (int64 priceInt, uint64 conf, int32 expo, uint256 publishTime) =
            abi.decode(data, (int64, uint64, int32, uint256));

        if (priceInt <= 0) return (0, 0, false);

        // Convert to positive with proper decimals
        if (expo >= 0) {
            price = uint256(uint64(priceInt)) * (10 ** uint32(expo));
        } else {
            price = uint256(uint64(priceInt)) / (10 ** uint32(-expo));
        }

        // Check confidence is reasonable (within 1% of price)
        valid = conf < uint64(priceInt) / 100;
        timestamp = publishTime;
    }

    function _getChainlinkPrice(address feed) internal view returns (uint256 price, uint256 timestamp, bool valid) {
        if (feed == address(0)) return (0, 0, false);

        // Call Chainlink aggregator
        // Interface: function latestRoundData() returns (uint80, int256, uint256, uint256, uint80)
        (bool success, bytes memory data) = feed.staticcall(abi.encodeWithSignature("latestRoundData()"));

        if (!success || data.length < 160) return (0, 0, false);

        (, int256 answer,, uint256 updatedAt,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));

        if (answer <= 0) return (0, 0, false);

        price = uint256(answer);
        timestamp = updatedAt;
        valid = true;
    }

    function _getTwapPrice(address pool) internal view returns (uint256 price, bool valid) {
        if (pool == address(0) || twapOracle == address(0)) return (0, false);

        // Call TWAP oracle
        // Interface: function getPrice(address pool) returns (uint256)
        (bool success, bytes memory data) = twapOracle.staticcall(abi.encodeWithSignature("getPrice(address)", pool));

        if (!success || data.length < 32) return (0, false);

        price = abi.decode(data, (uint256));
        valid = price > 0;
    }

    function _normalizePrice(uint256 price, uint8 sourceDecimals) internal pure returns (uint256) {
        // Normalize to 8 decimals
        if (sourceDecimals == 8) {
            return price;
        } else if (sourceDecimals > 8) {
            return price / (10 ** (sourceDecimals - 8));
        } else {
            return price * (10 ** (8 - sourceDecimals));
        }
    }
}
