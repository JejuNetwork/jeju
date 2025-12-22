// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title XLP V2 Callee Interface
/// @notice Interface for flash swap callbacks (Uniswap V2 compatible)
interface IXLPV2Callee {
    function xlpV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
