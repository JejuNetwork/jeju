// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ILiquidityVault
 * @notice Interface for liquidity vaults that provide ETH for gas sponsorship
 */
interface ILiquidityVault {
    function provideETHForGas(uint256 amount) external returns (bool);
    function availableETH() external view returns (uint256);
    function distributeFees(uint256 ethPoolFees, uint256 elizaPoolFees) external;
}

/**
 * @title IFeeDistributor
 * @notice Interface for fee distribution to apps and LPs
 */
interface IFeeDistributor {
    function distributeFees(uint256 amount, address appAddress) external;
}

/**
 * @title ITokenRegistry
 * @notice Interface for token registration for paymaster usage
 */
interface ITokenRegistry {
    function isRegistered(address token) external view returns (bool);
    function isTokenSupported(address token) external view returns (bool);
}

/**
 * @title IPaymasterFactory
 * @notice Interface for paymaster deployment factory
 */
interface IPaymasterFactory {
    function hasPaymaster(address token) external view returns (bool);
    function getPaymaster(address token) external view returns (address);
}
