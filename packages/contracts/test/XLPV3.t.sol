// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPV3Pool} from "../src/amm/v3/XLPV3Pool.sol";
import {TestERC20} from "../src/mocks/TestERC20.sol";
import {TickMath} from "../src/amm/libraries/TickMath.sol";
import {IXLPV3MintCallback, IXLPV3SwapCallback} from "../src/amm/interfaces/IXLPV3Pool.sol";

contract XLPV3Test is Test, IXLPV3MintCallback, IXLPV3SwapCallback {
    XLPV3Factory public factory;
    TestERC20 public tokenA;
    TestERC20 public tokenB;
    address public pool;

    address public owner = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);

    // Store tokens for callbacks
    address public token0;
    address public token1;

    function setUp() public {
        factory = new XLPV3Factory();
        tokenA = new TestERC20("Token A", "TKA", 18);
        tokenB = new TestERC20("Token B", "TKB", 18);

        // Ensure proper ordering
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        token0 = address(tokenA);
        token1 = address(tokenB);

        // Create pool with 0.3% fee
        pool = factory.createPool(address(tokenA), address(tokenB), 3000);

        // Initialize at price 1:1 (sqrtPriceX96 = sqrt(1) * 2^96)
        uint160 sqrtPriceX96 = 79228162514264337593543950336; // 1:1 price
        XLPV3Pool(pool).initialize(sqrtPriceX96);

        // Fund accounts
        tokenA.mint(address(this), 10000 ether);
        tokenB.mint(address(this), 10000 ether);
        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenA.mint(bob, 1000 ether);
        tokenB.mint(bob, 1000 ether);
    }

    // ============ Factory Tests ============

    function testCreatePool() public view {
        assertEq(factory.allPoolsLength(), 1);
        assertEq(factory.getPool(address(tokenA), address(tokenB), 3000), pool);
    }

    function testCannotCreateDuplicatePool() public {
        vm.expectRevert(XLPV3Factory.PoolExists.selector);
        factory.createPool(address(tokenA), address(tokenB), 3000);
    }

    function testDifferentFeeTiers() public {
        // Can create pools with different fees
        address pool500 = factory.createPool(address(tokenA), address(tokenB), 500);
        address pool10000 = factory.createPool(address(tokenA), address(tokenB), 10000);

        assertNotEq(pool500, pool);
        assertNotEq(pool10000, pool);
        assertEq(factory.allPoolsLength(), 3);
    }

    // ============ Pool State Tests ============

    function testPoolState() public view {
        (uint160 sqrtPriceX96, int24 tick,,,,, bool unlocked) = XLPV3Pool(pool).slot0();

        assertGt(sqrtPriceX96, 0);
        assertEq(tick, 0); // At 1:1 price
        assertTrue(unlocked);
        assertEq(XLPV3Pool(pool).fee(), 3000);
        assertEq(XLPV3Pool(pool).tickSpacing(), 60);
    }

    // ============ Liquidity Tests ============

    function testMint() public {
        int24 tickLower = -60;
        int24 tickUpper = 60;
        uint128 liquidityAmount = 1000000;

        (uint256 amount0, uint256 amount1) =
            XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(XLPV3Pool(pool).liquidity(), liquidityAmount);
    }

    function testBurn() public {
        int24 tickLower = -60;
        int24 tickUpper = 60;
        uint128 liquidityAmount = 1000000;

        // First mint
        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        // Then burn half
        (uint256 amount0, uint256 amount1) = XLPV3Pool(pool).burn(tickLower, tickUpper, liquidityAmount / 2);

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(XLPV3Pool(pool).liquidity(), liquidityAmount / 2);
    }

    // ============ Swap Tests ============

    function testSwapZeroForOne() public {
        // First add liquidity
        int24 tickLower = -887220;
        int24 tickUpper = 887220;
        uint128 liquidityAmount = 10000000000000000;

        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        // Record balance before
        uint256 balanceB_before = tokenB.balanceOf(address(this));

        // Swap token0 for token1
        (int256 amount0, int256 amount1) = XLPV3Pool(pool).swap(
            address(this),
            true, // zeroForOne
            int256(1 ether), // exactInput
            TickMath.MIN_SQRT_RATIO + 1,
            ""
        );

        // Should have paid token0 and received token1
        assertGt(amount0, 0);
        assertLt(amount1, 0); // Negative = received
        assertGt(tokenB.balanceOf(address(this)), balanceB_before);
    }

    function testSwapOneForZero() public {
        // First add liquidity
        int24 tickLower = -887220;
        int24 tickUpper = 887220;
        uint128 liquidityAmount = 10000000000000000;

        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        // Record balance before
        uint256 balanceA_before = tokenA.balanceOf(address(this));

        // Swap token1 for token0
        (int256 amount0, int256 amount1) = XLPV3Pool(pool).swap(
            address(this),
            false, // oneForZero
            int256(1 ether), // exactInput
            TickMath.MAX_SQRT_RATIO - 1,
            ""
        );

        // Should have received token0 and paid token1
        assertLt(amount0, 0); // Negative = received
        assertGt(amount1, 0);
        assertGt(tokenA.balanceOf(address(this)), balanceA_before);
    }

    // ============ Fee Tests ============

    function testFeesAccumulate() public {
        // Add liquidity
        int24 tickLower = -887220;
        int24 tickUpper = 887220;
        uint128 liquidityAmount = 10000000000000000;

        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        // Do several swaps
        for (uint256 i = 0; i < 5; i++) {
            XLPV3Pool(pool).swap(address(this), true, int256(1 ether), TickMath.MIN_SQRT_RATIO + 1, "");
        }

        // Fee growth should be > 0
        assertGt(XLPV3Pool(pool).feeGrowthGlobal0X128(), 0);
    }

    // ============ Callback Implementations ============

    function xlpV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external override {
        if (amount0Owed > 0) {
            TestERC20(token0).transfer(msg.sender, amount0Owed);
        }
        if (amount1Owed > 0) {
            TestERC20(token1).transfer(msg.sender, amount1Owed);
        }
    }

    function xlpV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        if (amount0Delta > 0) {
            TestERC20(token0).transfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            TestERC20(token1).transfer(msg.sender, uint256(amount1Delta));
        }
    }
}
