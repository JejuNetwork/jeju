// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./XLPV2Pair.sol";
import "../interfaces/IXLPV2Factory.sol";

/// @title XLP V2 Factory
/// @author Jeju Network
/// @notice Uniswap V2 compatible factory for creating V2 pairs
/// @dev Creates pairs deterministically using CREATE2
contract XLPV2Factory is IXLPV2Factory {
    // ============ State Variables ============

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // ============ Errors ============

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error Forbidden();

    // ============ Constructor ============

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    // ============ View Functions ============

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    // ============ Pair Creation ============

    /// @notice Create a new pair for two tokens
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return pair Address of the created pair
    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        bytes memory bytecode = type(XLPV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        XLPV2Pair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    // ============ Admin Functions ============

    function setFeeTo(address _feeTo) external override {
        if (msg.sender != feeToSetter) revert Forbidden();
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        if (msg.sender != feeToSetter) revert Forbidden();
        feeToSetter = _feeToSetter;
    }

    // ============ Utility Functions ============

    /// @notice Get the CREATE2 address for a pair
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return pair Predicted pair address
    function pairFor(address tokenA, address tokenB) external view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            address(this),
                            keccak256(abi.encodePacked(token0, token1)),
                            keccak256(type(XLPV2Pair).creationCode)
                        )
                    )
                )
            )
        );
    }
}
