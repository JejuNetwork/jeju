// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPV3Pool} from "../src/amm/v3/XLPV3Pool.sol";
import {TestERC20} from "../src/mocks/TestERC20.sol";
import {TickMath} from "../src/amm/libraries/TickMath.sol";
import {FullMath} from "../src/amm/libraries/FullMath.sol";
import {IXLPV3MintCallback, IXLPV3SwapCallback, IXLPV3FlashCallback} from "../src/amm/interfaces/IXLPV3Pool.sol";

contract XLPV3ComprehensiveTest is Test, IXLPV3MintCallback, IXLPV3SwapCallback, IXLPV3FlashCallback {
    XLPV3Factory public factory;
    TestERC20 public tokenA;
    TestERC20 public tokenB;
    address public pool;

    address public token0;
    address public token1;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);

    // 1:1 price
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function setUp() public {
        factory = new XLPV3Factory();
        tokenA = new TestERC20("Token A", "TKA", 18);
        tokenB = new TestERC20("Token B", "TKB", 18);

        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        token0 = address(tokenA);
        token1 = address(tokenB);

        pool = factory.createPool(address(tokenA), address(tokenB), 3000);
        XLPV3Pool(pool).initialize(SQRT_PRICE_1_1);

        // Fund accounts
        tokenA.mint(address(this), 10000000 ether);
        tokenB.mint(address(this), 10000000 ether);
        tokenA.mint(alice, 1000000 ether);
        tokenB.mint(alice, 1000000 ether);
        tokenA.mint(bob, 1000000 ether);
        tokenB.mint(bob, 1000000 ether);
        tokenA.mint(charlie, 1000000 ether);
        tokenB.mint(charlie, 1000000 ether);
    }

    // ============ Tick Math Verification ============

    function testTickMathConsistency() public pure {
        // Test tick -> price -> tick roundtrip
        int24[] memory testTicks = new int24[](7);
        testTicks[0] = -887220;
        testTicks[1] = -60000;
        testTicks[2] = -60;
        testTicks[3] = 0;
        testTicks[4] = 60;
        testTicks[5] = 60000;
        testTicks[6] = 887220;

        for (uint i = 0; i < testTicks.length; i++) {
            int24 tick = testTicks[i];
            uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(tick);
            int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPrice);

            // Should be within 1 tick due to rounding
            assertApproxEqAbs(recoveredTick, tick, 1, "Tick roundtrip failed");
        }
    }

    function testFuzz_TickMath(int24 tick) public pure {
        // Bound tick to valid range
        tick = int24(bound(tick, TickMath.MIN_TICK, TickMath.MAX_TICK));

        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(tick);
        assertTrue(sqrtPrice >= TickMath.MIN_SQRT_RATIO, "Price below minimum");
        assertTrue(sqrtPrice < TickMath.MAX_SQRT_RATIO, "Price above maximum");
    }

    // ============ Concentrated Liquidity Tests ============

    function testConcentratedLiquidityEfficiency() public {
        // Full range liquidity
        int24 fullRangeLower = -887220;
        int24 fullRangeUpper = 887220;

        // Narrow range (around current price)
        int24 narrowLower = -600;
        int24 narrowUpper = 600;

        // Same liquidity amount for both
        uint128 liquidityAmount = 1000000000000000;

        // Mint full range
        (uint256 fullAmount0, uint256 fullAmount1) = XLPV3Pool(pool).mint(
            alice,
            fullRangeLower,
            fullRangeUpper,
            liquidityAmount,
            ""
        );

        // Reset pool for fair comparison
        pool = factory.createPool(address(tokenA), address(tokenB), 500);
        XLPV3Pool(pool).initialize(SQRT_PRICE_1_1);

        // Mint narrow range with same liquidity
        (uint256 narrowAmount0, uint256 narrowAmount1) = XLPV3Pool(pool).mint(
            bob,
            narrowLower,
            narrowUpper,
            liquidityAmount,
            ""
        );

        // Narrow range should require LESS capital for same liquidity
        console.log("Full range capital:", fullAmount0 + fullAmount1);
        console.log("Narrow range capital:", narrowAmount0 + narrowAmount1);
        assertLt(narrowAmount0 + narrowAmount1, fullAmount0 + fullAmount1, "Concentrated liquidity should be more capital efficient");
    }

    function testMultiplePositions() public {
        // Create positions at different ranges - current tick is 0
        int24[3] memory lowerTicks = [int24(-600), int24(-120), int24(60)];
        int24[3] memory upperTicks = [int24(-60), int24(120), int24(600)];
        uint128 liquidityAmount = 100000000000000;

        for (uint i = 0; i < 3; i++) {
            XLPV3Pool(pool).mint(
                address(this),
                lowerTicks[i],
                upperTicks[i],
                liquidityAmount,
                ""
            );
        }

        // Pool should have liquidity from position that includes current tick (tick 0)
        // Position 1 (-120 to 120) is the only one that includes tick 0
        assertEq(XLPV3Pool(pool).liquidity(), liquidityAmount, "Active liquidity should be from position 1");
    }

    // ============ Cross-Tick Swap Tests ============

    function testCrossTickSwap() public {
        // Add liquidity in multiple ranges
        // Position 1: below current price
        XLPV3Pool(pool).mint(address(this), -600, -60, 1000000000000000, "");

        // Position 2: around current price
        XLPV3Pool(pool).mint(address(this), -60, 60, 1000000000000000, "");

        // Position 3: above current price
        XLPV3Pool(pool).mint(address(this), 60, 600, 1000000000000000, "");

        // Large swap that crosses multiple ticks
        uint256 swapAmount = 100 ether;

        (int256 amount0, int256 amount1) = XLPV3Pool(pool).swap(
            address(this),
            true, // zeroForOne
            int256(swapAmount),
            TickMath.MIN_SQRT_RATIO + 1,
            ""
        );

        // Verify swap occurred and crossed ticks
        assertGt(amount0, 0, "Should have spent token0");
        assertLt(amount1, 0, "Should have received token1");

        (,int24 newTick,,,,,) = XLPV3Pool(pool).slot0();
        assertLt(newTick, 0, "Price should have moved down");
    }

    // ============ Fee Accumulation Verification ============

    function testFeeGrowthAccumulation() public {
        // Add concentrated liquidity
        int24 tickLower = -60;
        int24 tickUpper = 60;
        uint128 liquidityAmount = 10000000000000000;

        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        uint256 feeGrowth0Before = XLPV3Pool(pool).feeGrowthGlobal0X128();
        uint256 feeGrowth1Before = XLPV3Pool(pool).feeGrowthGlobal1X128();

        // Do swaps in both directions
        for (uint i = 0; i < 10; i++) {
            // Swap token0 -> token1
            XLPV3Pool(pool).swap(address(this), true, int256(1 ether), TickMath.MIN_SQRT_RATIO + 1, "");
            // Swap token1 -> token0
            XLPV3Pool(pool).swap(address(this), false, int256(1 ether), TickMath.MAX_SQRT_RATIO - 1, "");
        }

        uint256 feeGrowth0After = XLPV3Pool(pool).feeGrowthGlobal0X128();
        uint256 feeGrowth1After = XLPV3Pool(pool).feeGrowthGlobal1X128();

        assertGt(feeGrowth0After, feeGrowth0Before, "Fee growth 0 should increase");
        assertGt(feeGrowth1After, feeGrowth1Before, "Fee growth 1 should increase");

        console.log("Fee growth token0:", feeGrowth0After - feeGrowth0Before);
        console.log("Fee growth token1:", feeGrowth1After - feeGrowth1Before);
    }

    function testFeeCollection() public {
        // Use full range liquidity for simplicity
        int24 tickLower = -887220;
        int24 tickUpper = 887220;
        uint128 liquidityAmount = 1000000000000000000;

        // Mint position with full range
        XLPV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidityAmount, "");

        // Generate fees through swaps - alternate directions
        for (uint i = 0; i < 3; i++) {
            XLPV3Pool(pool).swap(address(this), true, int256(0.01 ether), TickMath.MIN_SQRT_RATIO + 1, "");
            XLPV3Pool(pool).swap(address(this), false, int256(0.01 ether), TickMath.MAX_SQRT_RATIO - 1, "");
        }

        // Burn 0 liquidity to update position fees
        XLPV3Pool(pool).burn(tickLower, tickUpper, 0);

        // Collect fees
        uint256 balance0Before = tokenA.balanceOf(address(this));
        (uint128 collected0,) = XLPV3Pool(pool).collect(
            address(this),
            tickLower,
            tickUpper,
            type(uint128).max,
            type(uint128).max
        );

        assertGt(collected0, 0, "Should collect token0 fees");
        assertEq(tokenA.balanceOf(address(this)), balance0Before + collected0);
    }

    // ============ Flash Loan Tests ============

    function testFlashLoan() public {
        // Add significant liquidity first
        XLPV3Pool(pool).mint(address(this), -887220, 887220, 10000000000000000000, "");

        // Borrow small amounts relative to pool liquidity
        uint256 borrowAmount0 = 0.001 ether;
        uint256 borrowAmount1 = 0.001 ether;

        // Store borrow amounts for callback
        lastFlashBorrow0 = borrowAmount0;
        lastFlashBorrow1 = borrowAmount1;

        uint256 balance0Before = tokenA.balanceOf(address(this));
        uint256 balance1Before = tokenB.balanceOf(address(this));

        // Flash loan
        XLPV3Pool(pool).flash(address(this), borrowAmount0, borrowAmount1, abi.encode(borrowAmount0, borrowAmount1));

        // Verify we paid fees (0.3% = 3000 / 1e6)
        uint256 expectedFee0 = FullMath.mulDivRoundingUp(borrowAmount0, 3000, 1e6);
        uint256 expectedFee1 = FullMath.mulDivRoundingUp(borrowAmount1, 3000, 1e6);

        assertEq(tokenA.balanceOf(address(this)), balance0Before - expectedFee0, "Should pay fee for token0");
        assertEq(tokenB.balanceOf(address(this)), balance1Before - expectedFee1, "Should pay fee for token1");
    }

    // Storage for flash loan callback
    uint256 lastFlashBorrow0;
    uint256 lastFlashBorrow1;

    // ============ Protocol Fee Tests ============

    function testProtocolFees() public {
        // Set protocol fee (1/4 of LP fees go to protocol)
        XLPV3Pool(pool).setFeeProtocol(4, 4);

        // Add liquidity
        XLPV3Pool(pool).mint(address(this), -887220, 887220, 100000000000000000, "");

        // Do swaps to generate fees
        for (uint i = 0; i < 10; i++) {
            XLPV3Pool(pool).swap(address(this), true, int256(1 ether), TickMath.MIN_SQRT_RATIO + 1, "");
        }

        // Check protocol fees accumulated
        (uint128 protocolFee0,) = XLPV3Pool(pool).protocolFees();
        assertGt(protocolFee0, 0, "Protocol should accumulate token0 fees");

        // Collect protocol fees
        uint256 ownerBalance0Before = tokenA.balanceOf(address(this));
        XLPV3Pool(pool).collectProtocol(address(this), type(uint128).max, type(uint128).max);

        assertEq(tokenA.balanceOf(address(this)), ownerBalance0Before + protocolFee0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_MintBurn(uint128 liquidity, int24 tickLower, int24 tickUpper) public {
        int24 tickSpacing = XLPV3Pool(pool).tickSpacing();

        // Bound inputs
        liquidity = uint128(bound(liquidity, 1000000, 1e20));
        tickLower = int24(bound(tickLower, TickMath.MIN_TICK / tickSpacing, -1)) * tickSpacing;
        tickUpper = int24(bound(tickUpper, 1, TickMath.MAX_TICK / tickSpacing)) * tickSpacing;

        if (tickLower >= tickUpper) return;

        // Mint
        (uint256 amount0, uint256 amount1) = XLPV3Pool(pool).mint(
            address(this),
            tickLower,
            tickUpper,
            liquidity,
            ""
        );

        // Verify amounts are reasonable
        if (amount0 > 0 || amount1 > 0) {
            // Burn
            (uint256 burned0, uint256 burned1) = XLPV3Pool(pool).burn(tickLower, tickUpper, liquidity);

            // Should get back approximately what we put in (minus any precision loss)
            assertApproxEqRel(burned0, amount0, 0.001e18, "Burn amount0 mismatch");
            assertApproxEqRel(burned1, amount1, 0.001e18, "Burn amount1 mismatch");
        }
    }

    function testFuzz_Swap(uint96 swapAmount, bool zeroForOne) public {
        // Setup liquidity
        XLPV3Pool(pool).mint(address(this), -887220, 887220, 100000000000000000, "");

        swapAmount = uint96(bound(swapAmount, 0.001 ether, 10 ether));

        (uint160 sqrtPriceBefore,,,,,, ) = XLPV3Pool(pool).slot0();

        // Execute swap
        (int256 amount0, int256 amount1) = XLPV3Pool(pool).swap(
            address(this),
            zeroForOne,
            int256(uint256(swapAmount)),
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            ""
        );

        (uint160 sqrtPriceAfter,,,,,, ) = XLPV3Pool(pool).slot0();

        // Verify price moved in expected direction
        if (zeroForOne) {
            assertLt(sqrtPriceAfter, sqrtPriceBefore, "Price should decrease for zeroForOne");
            assertGt(amount0, 0, "Should spend token0");
            assertLt(amount1, 0, "Should receive token1");
        } else {
            assertGt(sqrtPriceAfter, sqrtPriceBefore, "Price should increase for oneForZero");
            assertLt(amount0, 0, "Should receive token0");
            assertGt(amount1, 0, "Should spend token1");
        }
    }

    // ============ Multi-Block Simulation ============

    function testMultiBlockTradingSimulation() public {
        // Setup with liquidity at different ranges
        XLPV3Pool(pool).mint(address(this), -6000, -60, 50000000000000000, "");
        XLPV3Pool(pool).mint(address(this), -60, 60, 100000000000000000, "");
        XLPV3Pool(pool).mint(address(this), 60, 6000, 50000000000000000, "");

        uint256 totalVolume0;
        uint256 totalVolume1;

        // Simulate 50 blocks of trading
        for (uint i = 0; i < 50; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);

            // Alternate swap directions with varying amounts
            bool direction = i % 2 == 0;
            uint256 amount = 0.5 ether + (i % 10) * 0.1 ether;

            (int256 amount0, int256 amount1) = XLPV3Pool(pool).swap(
                address(this),
                direction,
                int256(amount),
                direction ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
                ""
            );

            totalVolume0 += amount0 > 0 ? uint256(amount0) : uint256(-amount0);
            totalVolume1 += amount1 > 0 ? uint256(amount1) : uint256(-amount1);
        }

        console.log("Total volume token0:", totalVolume0 / 1e18, "ETH");
        console.log("Total volume token1:", totalVolume1 / 1e18, "ETH");
        console.log("Fee growth 0:", XLPV3Pool(pool).feeGrowthGlobal0X128());
        console.log("Fee growth 1:", XLPV3Pool(pool).feeGrowthGlobal1X128());
    }

    // ============ All Fee Tiers Test ============

    function testAllFeeTiers() public {
        // Use different tokens to avoid pool exists error (pool at 3000 fee created in setUp)
        TestERC20 tokenX = new TestERC20("Token X", "TKX", 18);
        TestERC20 tokenY = new TestERC20("Token Y", "TKY", 18);
        tokenX.mint(address(this), 10000 ether);
        tokenY.mint(address(this), 10000 ether);

        if (address(tokenX) > address(tokenY)) {
            (tokenX, tokenY) = (tokenY, tokenX);
        }

        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        int24[3] memory expectedTickSpacing = [int24(10), int24(60), int24(200)];

        for (uint i = 0; i < fees.length; i++) {
            address tierPool = factory.createPool(address(tokenX), address(tokenY), fees[i]);
            XLPV3Pool(tierPool).initialize(SQRT_PRICE_1_1);

            assertEq(XLPV3Pool(tierPool).fee(), fees[i], "Fee mismatch");
            assertEq(XLPV3Pool(tierPool).tickSpacing(), expectedTickSpacing[i], "Tick spacing mismatch");

            // Mint callback needs to handle the new tokens
            tokenX.transfer(tierPool, 100 ether);
            tokenY.transfer(tierPool, 100 ether);
        }
    }

    // ============ Callbacks ============

    function xlpV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external override {
        if (amount0Owed > 0) TestERC20(token0).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) TestERC20(token1).transfer(msg.sender, amount1Owed);
    }

    function xlpV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        if (amount0Delta > 0) TestERC20(token0).transfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) TestERC20(token1).transfer(msg.sender, uint256(amount1Delta));
    }

    function xlpV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external override {
        // Decode the borrowed amounts
        (uint256 borrowed0, uint256 borrowed1) = abi.decode(data, (uint256, uint256));

        // Repay borrowed + fees
        // The pool transferred tokens to us, so we already have the borrowed amounts
        // We need to return those borrowed amounts PLUS the fees
        // The pool checks: balance_after >= balance_before + fee
        // balance_before was BEFORE the transfer to us, so we need to return borrowed + fee
        TestERC20(token0).transfer(msg.sender, borrowed0 + fee0);
        TestERC20(token1).transfer(msg.sender, borrowed1 + fee1);
    }
}
