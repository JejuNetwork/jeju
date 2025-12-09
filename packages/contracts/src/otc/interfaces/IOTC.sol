// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IOTC Interface
/// @notice Interface for the OTC contract's external functions
interface IOTC {
    function registerToken(bytes32 tokenId, address tokenAddress, address priceOracle) external;
}
