// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPriceOracle
 * @notice Consolidated price oracle interface for all Jeju contracts
 * @dev Supports both multi-token oracles (PriceOracle) and specialized oracles (ManualPriceOracle)
 */
interface IPriceOracle {
    /**
     * @notice Get token price in USD
     * @param token Token address (address(0) for ETH)
     * @return priceUSD Price in USD with decimals
     * @return decimals Number of decimals in price
     */
    function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals);

    /**
     * @notice Check if price data is fresh
     * @param token Token address to check
     * @return fresh True if price was updated within staleness threshold
     */
    function isPriceFresh(address token) external view returns (bool fresh);

    /**
     * @notice Convert amount from one token to another using oracle prices
     * @param fromToken Source token address
     * @param toToken Destination token address
     * @param amount Amount of fromToken to convert
     * @return convertedAmount Equivalent amount in toToken
     */
    function convertAmount(address fromToken, address toToken, uint256 amount)
        external
        view
        returns (uint256 convertedAmount);
}

/**
 * @title ISimplePriceOracle
 * @notice Minimal price oracle interface for simple use cases
 */
interface ISimplePriceOracle {
    function getPrice(address token) external view returns (uint256);
}

/**
 * @title IElizaOSPriceOracle
 * @notice Specialized oracle for elizaOS/ETH rate (ManualPriceOracle compatibility)
 */
interface IElizaOSPriceOracle {
    function getElizaOSPerETH() external view returns (uint256);
    function isPriceFresh() external view returns (bool);
}
