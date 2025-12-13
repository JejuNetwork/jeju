// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {XLPV2Factory} from "../src/amm/v2/XLPV2Factory.sol";
import {XLPV2Pair} from "../src/amm/v2/XLPV2Pair.sol";
import {TestERC20} from "../src/mocks/TestERC20.sol";
import {IXLPV2Callee} from "../src/amm/interfaces/IXLPV2Callee.sol";

contract XLPV2ComprehensiveTest is Test {
    XLPV2Factory public factory;
    TestERC20 public tokenA;
    TestERC20 public tokenB;
    address public pair;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);

    uint256 constant MINIMUM_LIQUIDITY = 1000;

    function setUp() public {
        factory = new XLPV2Factory(address(this));
        tokenA = new TestERC20("Token A", "TKA", 18);
        tokenB = new TestERC20("Token B", "TKB", 18);

        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        pair = factory.createPair(address(tokenA), address(tokenB));

        // Fund accounts generously
        tokenA.mint(alice, 1000000 ether);
        tokenB.mint(alice, 1000000 ether);
        tokenA.mint(bob, 1000000 ether);
        tokenB.mint(bob, 1000000 ether);
        tokenA.mint(charlie, 1000000 ether);
        tokenB.mint(charlie, 1000000 ether);
    }

    // ============ K Invariant Tests ============

    function testKInvariantAfterSwap() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        (uint112 r0_before, uint112 r1_before,) = XLPV2Pair(pair).getReserves();
        uint256 k_before = uint256(r0_before) * uint256(r1_before);

        // Do swap
        uint256 swapAmount = 1 ether;
        vm.startPrank(bob);
        tokenA.transfer(pair, swapAmount);
        (uint112 reserve0, uint112 reserve1,) = XLPV2Pair(pair).getReserves();
        uint256 amountInWithFee = swapAmount * 997;
        uint256 amountOut = (amountInWithFee * reserve1) / (reserve0 * 1000 + amountInWithFee);
        XLPV2Pair(pair).swap(0, amountOut, bob, "");
        vm.stopPrank();

        (uint112 r0_after, uint112 r1_after,) = XLPV2Pair(pair).getReserves();
        uint256 k_after = uint256(r0_after) * uint256(r1_after);

        // K should increase due to fees
        assertGe(k_after, k_before, "K invariant violated - K decreased");
    }

    function testFuzz_KInvariant(uint96 liquidity0, uint96 liquidity1, uint96 swapAmount) public {
        // Bound inputs to reasonable values
        liquidity0 = uint96(bound(liquidity0, 1 ether, 100000 ether));
        liquidity1 = uint96(bound(liquidity1, 1 ether, 100000 ether));
        swapAmount = uint96(bound(swapAmount, 0.001 ether, liquidity0 / 10));

        _addLiquidity(alice, liquidity0, liquidity1);

        (uint112 r0_before, uint112 r1_before,) = XLPV2Pair(pair).getReserves();
        uint256 k_before = uint256(r0_before) * uint256(r1_before);

        // Calculate expected output
        uint256 amountInWithFee = swapAmount * 997;
        uint256 expectedOut = (amountInWithFee * r1_before) / (r0_before * 1000 + amountInWithFee);

        if (expectedOut > 0 && expectedOut < r1_before) {
            vm.startPrank(bob);
            tokenA.transfer(pair, swapAmount);
            XLPV2Pair(pair).swap(0, expectedOut, bob, "");
            vm.stopPrank();

            (uint112 r0_after, uint112 r1_after,) = XLPV2Pair(pair).getReserves();
            uint256 k_after = uint256(r0_after) * uint256(r1_after);

            assertGe(k_after, k_before, "K invariant violated");
        }
    }

    // ============ Liquidity Provider Tests ============

    function testMultipleLPs() public {
        // Alice adds initial liquidity
        _addLiquidity(alice, 100 ether, 100 ether);
        uint256 aliceLp = XLPV2Pair(pair).balanceOf(alice);

        // Bob adds liquidity at same ratio
        _addLiquidity(bob, 50 ether, 50 ether);
        uint256 bobLp = XLPV2Pair(pair).balanceOf(bob);

        // Bob should have proportionally less LP tokens
        assertApproxEqRel(bobLp, aliceLp / 2, 0.01e18, "LP proportion incorrect");

        // Charlie adds asymmetric liquidity (gets less LP due to optimal ratio)
        vm.startPrank(charlie);
        tokenA.transfer(pair, 100 ether);
        tokenB.transfer(pair, 50 ether);
        uint256 charlieLp = XLPV2Pair(pair).mint(charlie);
        vm.stopPrank();

        // Charlie gets LP based on minimum ratio
        assertLt(charlieLp, aliceLp, "Charlie should get less LP due to asymmetric deposit");
    }

    function testFuzz_AddRemoveLiquidity(uint96 amount0, uint96 amount1) public {
        // Minimum 10000 to ensure liquidity > MINIMUM_LIQUIDITY after sqrt
        amount0 = uint96(bound(amount0, 10000, 100000 ether));
        amount1 = uint96(bound(amount1, 10000, 100000 ether));

        _addLiquidity(alice, amount0, amount1);
        uint256 lpBalance = XLPV2Pair(pair).balanceOf(alice);

        // Transfer LP to pair for burning
        vm.startPrank(alice);
        XLPV2Pair(pair).transfer(pair, lpBalance);

        uint256 balance0Before = tokenA.balanceOf(alice);
        uint256 balance1Before = tokenB.balanceOf(alice);

        (uint256 returned0, uint256 returned1) = XLPV2Pair(pair).burn(alice);
        vm.stopPrank();

        // Should get back proportional amounts (minus minimum liquidity on first deposit)
        assertGt(returned0, 0, "Should return token0");
        assertGt(returned1, 0, "Should return token1");
        assertEq(tokenA.balanceOf(alice), balance0Before + returned0);
        assertEq(tokenB.balanceOf(alice), balance1Before + returned1);
    }

    // ============ Swap Verification Tests ============

    function testSwapOutputCalculation() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        uint256 swapAmount = 1 ether;

        // Calculate expected output manually
        (uint112 reserve0, uint112 reserve1,) = XLPV2Pair(pair).getReserves();
        uint256 amountInWithFee = swapAmount * 997;
        uint256 expectedOut = (amountInWithFee * reserve1) / (reserve0 * 1000 + amountInWithFee);

        uint256 bobBalanceBefore = tokenB.balanceOf(bob);

        vm.startPrank(bob);
        tokenA.transfer(pair, swapAmount);
        XLPV2Pair(pair).swap(0, expectedOut, bob, "");
        vm.stopPrank();

        uint256 actualReceived = tokenB.balanceOf(bob) - bobBalanceBefore;
        assertEq(actualReceived, expectedOut, "Swap output mismatch");
    }

    function testFuzz_SwapBothDirections(uint96 swapAmount) public {
        _addLiquidity(alice, 100 ether, 100 ether);

        swapAmount = uint96(bound(swapAmount, 0.001 ether, 10 ether));

        // Swap A -> B
        (uint112 r0, uint112 r1,) = XLPV2Pair(pair).getReserves();
        uint256 amountInWithFee = swapAmount * 997;
        uint256 expectedOutB = (amountInWithFee * r1) / (r0 * 1000 + amountInWithFee);

        vm.startPrank(bob);
        tokenA.transfer(pair, swapAmount);
        XLPV2Pair(pair).swap(0, expectedOutB, bob, "");
        vm.stopPrank();

        // Swap B -> A
        (r0, r1,) = XLPV2Pair(pair).getReserves();
        amountInWithFee = swapAmount * 997;
        uint256 expectedOutA = (amountInWithFee * r0) / (r1 * 1000 + amountInWithFee);

        vm.startPrank(charlie);
        tokenB.transfer(pair, swapAmount);
        XLPV2Pair(pair).swap(expectedOutA, 0, charlie, "");
        vm.stopPrank();

        // Verify reserves are reasonable
        (uint112 finalR0, uint112 finalR1,) = XLPV2Pair(pair).getReserves();
        assertGt(finalR0, 0);
        assertGt(finalR1, 0);
    }

    // ============ Flash Swap Tests ============

    function testFlashSwap() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        FlashBorrower borrower = new FlashBorrower(pair, address(tokenA), address(tokenB));
        tokenA.mint(address(borrower), 10 ether); // Give borrower tokens to repay

        // Borrow tokenB, must repay with tokenA
        uint256 borrowAmount = 1 ether;
        (uint112 reserve0, uint112 reserve1,) = XLPV2Pair(pair).getReserves();

        // Calculate amount of tokenA needed to repay
        uint256 amountIn = (reserve0 * borrowAmount * 1000) / ((reserve1 - borrowAmount) * 997) + 1;

        borrower.initiateFlashSwap(borrowAmount, amountIn);

        // Verify flash swap completed - borrower should have tokenB
        assertEq(tokenB.balanceOf(address(borrower)), borrowAmount, "Flash swap failed");
    }

    // ============ Edge Cases ============

    function testMinimumLiquidity() public {
        // First liquidity provider
        vm.startPrank(alice);
        tokenA.transfer(pair, 10000);
        tokenB.transfer(pair, 10000);
        uint256 lpTokens = XLPV2Pair(pair).mint(alice);
        vm.stopPrank();

        // MINIMUM_LIQUIDITY is burned
        assertEq(lpTokens, _sqrt(10000 * 10000) - MINIMUM_LIQUIDITY);
        assertEq(XLPV2Pair(pair).balanceOf(address(0)), MINIMUM_LIQUIDITY);
    }

    function testCannotSwapMoreThanReserves() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        vm.startPrank(bob);
        tokenA.transfer(pair, 1 ether);

        vm.expectRevert(XLPV2Pair.InsufficientLiquidity.selector);
        XLPV2Pair(pair).swap(0, 100 ether, bob, "");
        vm.stopPrank();
    }

    function testCannotSwapToTokenAddress() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        vm.startPrank(bob);
        tokenA.transfer(pair, 1 ether);

        vm.expectRevert(XLPV2Pair.InvalidTo.selector);
        XLPV2Pair(pair).swap(0, 0.5 ether, address(tokenB), "");
        vm.stopPrank();
    }

    // ============ Fee Verification ============

    function testFeeCollection() public {
        factory.setFeeTo(charlie);

        _addLiquidity(alice, 100 ether, 100 ether);

        // Do many swaps to accumulate fees
        for (uint i = 0; i < 10; i++) {
            _swap(bob, true, 1 ether);
            _swap(bob, false, 1 ether);
        }

        // Add more liquidity to trigger fee mint
        _addLiquidity(alice, 10 ether, 10 ether);

        // Protocol should have received fee tokens
        uint256 protocolLp = XLPV2Pair(pair).balanceOf(charlie);
        assertGt(protocolLp, 0, "Protocol should receive LP tokens as fees");
    }

    // ============ Price Impact Simulation ============

    function testPriceImpact() public {
        _addLiquidity(alice, 1000 ether, 1000 ether);

        // Small swap - low impact
        (uint112 r0, uint112 r1,) = XLPV2Pair(pair).getReserves();
        uint256 smallSwap = 1 ether;
        uint256 smallOutput = _getAmountOut(smallSwap, r0, r1);
        uint256 smallImpact = (smallSwap * 1e18 / smallOutput) - 1e18;

        // Large swap - high impact
        uint256 largeSwap = 100 ether;
        uint256 largeOutput = _getAmountOut(largeSwap, r0, r1);
        uint256 largeImpact = (largeSwap * 1e18 / largeOutput) - 1e18;

        assertGt(largeImpact, smallImpact, "Large swap should have more price impact");

        console.log("Small swap price impact:", smallImpact * 100 / 1e18, "basis points");
        console.log("Large swap price impact:", largeImpact * 100 / 1e18, "basis points");
    }

    // ============ Multi-Block Simulation ============

    function testMultiBlockSimulation() public {
        _addLiquidity(alice, 100 ether, 100 ether);

        uint256 initialK;
        {
            (uint112 r0, uint112 r1,) = XLPV2Pair(pair).getReserves();
            initialK = uint256(r0) * uint256(r1);
        }

        // Simulate 100 blocks of trading
        for (uint i = 0; i < 100; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);

            // Random trader does swap
            address trader = i % 2 == 0 ? bob : charlie;
            bool direction = i % 3 == 0;
            uint256 amount = 0.1 ether + (i * 0.01 ether);

            _swap(trader, direction, amount);
        }

        // Final K should be >= initial K
        (uint112 finalR0, uint112 finalR1,) = XLPV2Pair(pair).getReserves();
        uint256 finalK = uint256(finalR0) * uint256(finalR1);

        assertGe(finalK, initialK, "K should grow due to fees");
        console.log("K growth after 100 swaps:", (finalK - initialK) * 100 / initialK, "%");
    }

    // ============ Helpers ============

    function _addLiquidity(address lp, uint256 amount0, uint256 amount1) internal {
        vm.startPrank(lp);
        tokenA.transfer(pair, amount0);
        tokenB.transfer(pair, amount1);
        XLPV2Pair(pair).mint(lp);
        vm.stopPrank();
    }

    function _swap(address trader, bool zeroForOne, uint256 amountIn) internal {
        (uint112 r0, uint112 r1,) = XLPV2Pair(pair).getReserves();

        vm.startPrank(trader);
        if (zeroForOne) {
            tokenA.transfer(pair, amountIn);
            uint256 amountOut = _getAmountOut(amountIn, r0, r1);
            if (amountOut > 0 && amountOut < r1) {
                XLPV2Pair(pair).swap(0, amountOut, trader, "");
            }
        } else {
            tokenB.transfer(pair, amountIn);
            uint256 amountOut = _getAmountOut(amountIn, r1, r0);
            if (amountOut > 0 && amountOut < r0) {
                XLPV2Pair(pair).swap(amountOut, 0, trader, "");
            }
        }
        vm.stopPrank();
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

// Flash swap borrower contract
contract FlashBorrower is IXLPV2Callee {
    address public pair;
    address public token0;
    address public token1;

    constructor(address _pair, address _token0, address _token1) {
        pair = _pair;
        token0 = _token0;
        token1 = _token1;
    }

    function initiateFlashSwap(uint256 borrowAmount, uint256 repayAmount) external {
        // Borrow token1, will repay with token0
        bytes memory data = abi.encode(repayAmount);
        XLPV2Pair(pair).swap(0, borrowAmount, address(this), data);
    }

    function xlpV2Call(address, uint256, uint256, bytes calldata data) external override {
        require(msg.sender == pair, "Unauthorized");

        uint256 repayAmount = abi.decode(data, (uint256));

        // Repay with token0
        TestERC20(token0).transfer(pair, repayAmount);
    }
}
