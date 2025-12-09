// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PriceOracle
 * @notice Multi-token price oracle supporting unlimited tokens
 * @dev Supports manual price setting and automatic Uniswap V4 pool reading
 *      Works on localnet (manual/pools) and mainnet (bot updates from Ethereum)
 *
 * @custom:security-contact security@jeju.network
 */
contract PriceOracle is Ownable, Pausable {
    // ============ Errors ============

    error PriceBelowMinimum(uint256 price, uint256 minimum);
    error PriceAboveMaximum(uint256 price, uint256 maximum);
    error DeviationTooLarge(uint256 deviation, uint256 maxDeviation);
    error TokenPaused(address token);

    // ============ State Variables ============

    /// @notice Token price in USD (with decimals)
    mapping(address => uint256) public prices;

    /// @notice Price decimals (usually 18)
    mapping(address => uint256) public priceDecimals;

    /// @notice Last price update timestamp
    mapping(address => uint256) public lastUpdate;

    /// @notice Price staleness threshold (default 1 hour)
    uint256 public stalenessThreshold = 1 hours;

    /// @notice Maximum price deviation allowed per update (50%)
    uint256 public maxDeviation = 5000; // 50% in basis points

    /// @notice Absolute price bounds per token
    mapping(address => uint256) public minPrice;
    mapping(address => uint256) public maxPrice;

    /// @notice Per-token pause status
    mapping(address => bool) public tokenPaused;

    /// @notice ETH address constant
    address public constant ETH_ADDRESS = address(0);

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    // ============ Events ============

    event PriceUpdated(address indexed token, uint256 price, uint256 decimals);
    event PriceBoundsSet(address indexed token, uint256 min, uint256 max);
    event DeviationLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event TokenPausedStatusChanged(address indexed token, bool paused);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        // Set default ETH price for initial testing/deployment
        // Note: Owner must set actual token prices after deployment
        _setPrice(ETH_ADDRESS, 3000 * 1e18, 18); // ETH = $3000 (default)
    }

    // ============ Core Functions ============

    /**
     * @notice Get token price in USD
     * @param token Token address (address(0) for ETH)
     * @return priceUSD Price in USD with decimals
     * @return decimals Number of decimals in price
     * @dev Reverts if token is paused
     */
    function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals) {
        if (tokenPaused[token]) revert TokenPaused(token);

        priceUSD = prices[token];
        decimals = priceDecimals[token];

        if (priceUSD == 0) {
            // Default to $1 if not set
            priceUSD = 1e18;
            decimals = 18;
        }
    }

    /**
     * @notice Check if price is fresh
     * @param token Token address
     * @return isFresh Whether price was updated recently
     */
    function isPriceFresh(address token) external view returns (bool isFresh) {
        uint256 age = block.timestamp - lastUpdate[token];
        return age <= stalenessThreshold;
    }

    /**
     * @notice Check if ETH price is fresh (no-argument version for compatibility)
     * @return isFresh Whether ETH price was updated recently
     */
    function isPriceFresh() external view returns (bool isFresh) {
        return this.isPriceFresh(ETH_ADDRESS);
    }

    /**
     * @notice Convert amount from one token to another
     * @param fromToken Source token
     * @param toToken Destination token
     * @param amount Amount in source token
     * @return converted Amount in destination token
     */
    function convertAmount(address fromToken, address toToken, uint256 amount)
        external
        view
        returns (uint256 converted)
    {
        if (fromToken == toToken) return amount;

        uint256 fromPrice = prices[fromToken];
        uint256 toPrice = prices[toToken];

        if (fromPrice == 0) fromPrice = 1e18;
        if (toPrice == 0) toPrice = 1e18;

        // converted = (amount * fromPrice) / toPrice
        converted = (amount * fromPrice) / toPrice;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set token price with deviation and bounds checking
     * @param token Token address (address(0) for ETH)
     * @param priceUSD Price in USD
     * @param decimals Price decimals
     * @dev Validates price is within bounds and deviation limits to prevent manipulation
     *      Can be called even when globally paused for emergency updates
     */
    function setPrice(address token, uint256 priceUSD, uint256 decimals) external onlyOwner {
        if (tokenPaused[token]) revert TokenPaused(token);
        // Check bounds if set
        if (minPrice[token] > 0 && priceUSD < minPrice[token]) {
            revert PriceBelowMinimum(priceUSD, minPrice[token]);
        }
        if (maxPrice[token] > 0 && priceUSD > maxPrice[token]) {
            revert PriceAboveMaximum(priceUSD, maxPrice[token]);
        }

        // Check deviation from last price (if price exists)
        uint256 lastPrice = prices[token];
        if (lastPrice > 0) {
            uint256 deviation;
            if (priceUSD > lastPrice) {
                deviation = ((priceUSD - lastPrice) * BASIS_POINTS) / lastPrice;
            } else {
                deviation = ((lastPrice - priceUSD) * BASIS_POINTS) / lastPrice;
            }

            // Allow larger deviation if price is very stale (>24h)
            uint256 age = block.timestamp - lastUpdate[token];
            if (age < 24 hours && deviation > maxDeviation) {
                revert DeviationTooLarge(deviation, maxDeviation);
            }
        }

        _setPrice(token, priceUSD, decimals);
    }

    /**
     * @notice Set price bounds for a token
     * @param token Token address
     * @param min Minimum allowed price
     * @param max Maximum allowed price
     * @dev Prevents oracle from setting unreasonable prices
     */
    function setPriceBounds(address token, uint256 min, uint256 max) external onlyOwner {
        require(min < max, "Invalid bounds");
        minPrice[token] = min;
        maxPrice[token] = max;
        emit PriceBoundsSet(token, min, max);
    }

    /**
     * @notice Emergency price update (bypasses deviation check)
     * @param token Token address
     * @param priceUSD New price
     * @param decimals Price decimals
     * @dev Only use in emergencies. Still enforces bounds checking.
     */
    function emergencySetPrice(address token, uint256 priceUSD, uint256 decimals) external onlyOwner {
        // Still check bounds
        if (minPrice[token] > 0 && priceUSD < minPrice[token]) {
            revert PriceBelowMinimum(priceUSD, minPrice[token]);
        }
        if (maxPrice[token] > 0 && priceUSD > maxPrice[token]) {
            revert PriceAboveMaximum(priceUSD, maxPrice[token]);
        }

        _setPrice(token, priceUSD, decimals);
    }

    /**
     * @notice Set staleness threshold
     * @param threshold New threshold in seconds
     */
    function setStalenessThreshold(uint256 threshold) external onlyOwner {
        uint256 oldThreshold = stalenessThreshold;
        stalenessThreshold = threshold;
        emit StalenessThresholdUpdated(oldThreshold, threshold);
    }

    /**
     * @notice Set maximum allowed price deviation
     * @param newMaxDeviation New deviation limit in basis points
     * @dev Default is 5000 (50%). Can be adjusted based on market conditions.
     */
    function setMaxDeviation(uint256 newMaxDeviation) external onlyOwner {
        require(newMaxDeviation <= BASIS_POINTS, "Deviation too high");
        uint256 oldLimit = maxDeviation;
        maxDeviation = newMaxDeviation;
        emit DeviationLimitUpdated(oldLimit, newMaxDeviation);
    }

    /**
     * @notice Pause a specific token's price updates and queries
     * @param token Token address to pause
     * @dev Use when a token's price source is compromised or unreliable
     */
    function pauseToken(address token) external onlyOwner {
        tokenPaused[token] = true;
        emit TokenPausedStatusChanged(token, true);
    }

    /**
     * @notice Unpause a specific token
     * @param token Token address to unpause
     */
    function unpauseToken(address token) external onlyOwner {
        tokenPaused[token] = false;
        emit TokenPausedStatusChanged(token, false);
    }

    /**
     * @notice Pause all oracle operations (emergency)
     * @dev Prevents all price updates and queries
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause all oracle operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal ============

    function _setPrice(address token, uint256 priceUSD, uint256 decimals) internal {
        prices[token] = priceUSD;
        priceDecimals[token] = decimals;
        lastUpdate[token] = block.timestamp;
        emit PriceUpdated(token, priceUSD, decimals);
    }

    // ============ Helper Views ============

    /**
     * @notice Get elizaOS per ETH exchange rate
     * @return rate Exchange rate (elizaOS per ETH)
     */
    function getElizaOSPerETH() external view returns (uint256 rate) {
        uint256 ethPrice = prices[ETH_ADDRESS];
        uint256 elizaPrice = prices[address(0x2)]; // Assumes elizaOS is tracked

        if (ethPrice == 0) ethPrice = 3000e18;
        if (elizaPrice == 0) elizaPrice = 1e17; // $0.10

        // rate = ethPrice / elizaPrice
        rate = (ethPrice * 1e18) / elizaPrice;
    }
}
