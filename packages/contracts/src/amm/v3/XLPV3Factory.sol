// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import "./XLPV3Pool.sol";

/// @title XLP V3 Factory
/// @author Jeju Network
/// @notice Uniswap V3 compatible factory for creating CLMM pools
/// @dev Deploys pools with different fee tiers and tick spacings
contract XLPV3Factory {
    // ============ State ============

    address public owner;

    /// @notice Returns the pool address for a given pair of tokens and a fee, or address 0 if it does not exist
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;

    /// @notice Returns the tick spacing for a given fee amount, or 0 if not enabled
    mapping(uint24 => int24) public feeAmountTickSpacing;

    /// @notice All deployed pools
    address[] public allPools;

    // ============ Deployer Parameters ============

    struct Parameters {
        address factory;
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
    }

    Parameters public parameters;

    // ============ Events ============

    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event PoolCreated(
        address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool
    );
    event FeeAmountEnabled(uint24 indexed fee, int24 indexed tickSpacing);

    // ============ Errors ============

    error IdenticalAddresses();
    error ZeroAddress();
    error FeeNotEnabled();
    error PoolExists();
    error NotOwner();
    error InvalidFee();
    error InvalidTickSpacing();

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
        emit OwnerChanged(address(0), msg.sender);

        // Enable default fee amounts
        feeAmountTickSpacing[500] = 10; // 0.05%
        emit FeeAmountEnabled(500, 10);

        feeAmountTickSpacing[3000] = 60; // 0.3%
        emit FeeAmountEnabled(3000, 60);

        feeAmountTickSpacing[10000] = 200; // 1%
        emit FeeAmountEnabled(10000, 200);
    }

    // ============ View Functions ============

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    // ============ Pool Creation ============

    /// @notice Creates a pool for the given two tokens and fee
    /// @param tokenA One of the two tokens in the desired pool
    /// @param tokenB The other of the two tokens in the desired pool
    /// @param fee The desired fee for the pool
    /// @return pool The address of the newly created pool
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        int24 tickSpacing = feeAmountTickSpacing[fee];
        if (tickSpacing == 0) revert FeeNotEnabled();
        if (getPool[token0][token1][fee] != address(0)) revert PoolExists();

        // Set parameters for pool deployment
        parameters =
            Parameters({factory: address(this), token0: token0, token1: token1, fee: fee, tickSpacing: tickSpacing});

        pool = address(new XLPV3Pool{salt: keccak256(abi.encode(token0, token1, fee))}());

        delete parameters;

        getPool[token0][token1][fee] = pool;
        getPool[token1][token0][fee] = pool;
        allPools.push(pool);

        emit PoolCreated(token0, token1, fee, tickSpacing, pool);
    }

    // ============ Admin Functions ============

    /// @notice Enables a fee amount with the given tickSpacing
    /// @param fee The fee amount to enable
    /// @param tickSpacing The spacing between ticks to be enforced for all pools created with the given fee amount
    function enableFeeAmount(uint24 fee, int24 tickSpacing) external {
        if (msg.sender != owner) revert NotOwner();
        if (fee >= 1000000) revert InvalidFee();
        if (tickSpacing <= 0 || tickSpacing >= 16384) revert InvalidTickSpacing();
        if (feeAmountTickSpacing[fee] != 0) revert FeeNotEnabled();

        feeAmountTickSpacing[fee] = tickSpacing;
        emit FeeAmountEnabled(fee, tickSpacing);
    }

    /// @notice Updates the owner of the factory
    /// @param _owner The new owner of the factory
    function setOwner(address _owner) external {
        if (msg.sender != owner) revert NotOwner();
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    // ============ Utility Functions ============

    /// @notice Returns the pool address for a pair or address(0) if it doesn't exist
    /// @param tokenA First token
    /// @param tokenB Second token
    /// @param fee Fee tier
    /// @return pool The pool address
    function getPoolAddress(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = getPool[token0][token1][fee];
    }

    /// @notice Computes the CREATE2 address for a pool
    /// @param tokenA First token
    /// @param tokenB Second token
    /// @param fee Fee tier
    /// @return pool The predicted pool address
    function computePoolAddress(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            address(this),
                            keccak256(abi.encode(token0, token1, fee)),
                            keccak256(type(XLPV3Pool).creationCode)
                        )
                    )
                )
            )
        );
    }
}
