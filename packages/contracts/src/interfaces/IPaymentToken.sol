// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IPaymentToken
 * @author Jeju Network
 * @notice Interface for payment tokens used in Jeju infrastructure
 * @dev Any ERC-20 token can be used as a payment token. This interface
 *      defines optional extensions for minting (if token supports it).
 *
 * The default implementation is ElizaOSToken, but any ERC-20 can be used
 * by configuring the payment token address in deployment.
 *
 * Usage:
 * - Deploy contracts with configurable payment token address
 * - Use IERC20 interface for standard token operations
 * - Use IPaymentToken for optional minting operations
 */
interface IPaymentToken is IERC20 {
    /**
     * @notice Mint new tokens (optional - only if token supports minting)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external;

    /**
     * @notice Get token version
     * @return version string
     */
    function version() external view returns (string memory);
}

/**
 * @title IPaymentTokenConfig
 * @notice Configuration interface for contracts that use payment tokens
 * @dev Contracts implementing this interface accept configurable payment tokens
 */
interface IPaymentTokenConfig {
    /**
     * @notice Get the configured payment token address
     * @return token Address of the payment token
     */
    function paymentToken() external view returns (address token);

    /**
     * @notice Update the payment token (if supported)
     * @param newToken New payment token address
     */
    function setPaymentToken(address newToken) external;
}
