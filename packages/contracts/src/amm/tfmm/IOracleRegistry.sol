// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOracleRegistry
 * @author Jeju Network
 * @notice Interface for the oracle registry
 */
interface IOracleRegistry {
    struct OracleConfig {
        address feed;           // Oracle feed address
        uint256 heartbeat;      // Max staleness in seconds
        uint8 decimals;         // Price decimals
        bool active;            // Whether oracle is active
    }

    /**
     * @notice Get price for a token
     * @param token Token address
     * @return price Price with 8 decimals
     */
    function getPrice(address token) external view returns (uint256 price);

    /**
     * @notice Get prices for multiple tokens
     * @param tokens Token addresses
     * @return prices Prices with 8 decimals
     */
    function getPrices(address[] calldata tokens) external view returns (uint256[] memory prices);

    /**
     * @notice Check if price is stale
     * @param token Token address
     * @return isStale True if price is stale
     */
    function isPriceStale(address token) external view returns (bool isStale);

    /**
     * @notice Get oracle configuration
     * @param token Token address
     * @return config Oracle configuration
     */
    function getOracleConfig(address token) external view returns (OracleConfig memory config);

    /**
     * @notice Register an oracle
     * @param token Token address
     * @param feed Oracle feed address
     * @param heartbeat Max staleness
     * @param decimals Price decimals
     */
    function registerOracle(
        address token,
        address feed,
        uint256 heartbeat,
        uint8 decimals
    ) external;
}

