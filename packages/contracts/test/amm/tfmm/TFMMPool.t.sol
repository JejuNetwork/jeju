// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {TFMMPool} from "../../../src/amm/tfmm/TFMMPool.sol";
import {ITFMMPool} from "../../../src/amm/tfmm/ITFMMPool.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TFMMPoolTest is Test {
    TFMMPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner = address(1);
    address public governance = address(2);
    address public user = address(3);
    address public weightRunner = address(4);

    uint256 constant WEIGHT_PRECISION = 1e18;
    uint256 constant INITIAL_BALANCE = 1000e18;

    function setUp() public {
        // Deploy mock tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");

        // Initial weights: 50/50
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        uint256[] memory weights = new uint256[](2);
        weights[0] = WEIGHT_PRECISION / 2;
        weights[1] = WEIGHT_PRECISION / 2;

        vm.prank(owner);
        pool = new TFMMPool(
            "TFMM Pool",
            "TFMM-LP",
            tokens,
            weights,
            30, // 0.3% swap fee
            owner,
            governance
        );

        // Set weight runner
        vm.prank(owner);
        pool.setWeightRunner(weightRunner);

        // Mint tokens and approve
        tokenA.mint(user, INITIAL_BALANCE);
        tokenB.mint(user, INITIAL_BALANCE);

        vm.startPrank(user);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_InitialState() public view {
        address[] memory tokens = pool.getTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], address(tokenA));
        assertEq(tokens[1], address(tokenB));

        uint256[] memory weights = pool.getNormalizedWeights();
        assertEq(weights[0], WEIGHT_PRECISION / 2);
        assertEq(weights[1], WEIGHT_PRECISION / 2);

        assertEq(pool.swapFeeBps(), 30);
    }

    function test_AddLiquidity() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        uint256 lpTokens = pool.addLiquidity(amounts, 0);

        assertGt(lpTokens, 0);
        assertEq(pool.balanceOf(user), lpTokens);

        uint256[] memory balances = pool.getBalances();
        assertEq(balances[0], 100e18);
        assertEq(balances[1], 100e18);
    }

    function test_RemoveLiquidity() public {
        // Add liquidity first
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        uint256 lpTokens = pool.addLiquidity(amounts, 0);

        // Remove half
        uint256[] memory minAmounts = new uint256[](2);
        minAmounts[0] = 0;
        minAmounts[1] = 0;

        vm.prank(user);
        uint256[] memory receivedAmounts = pool.removeLiquidity(lpTokens / 2, minAmounts);

        assertGt(receivedAmounts[0], 0);
        assertGt(receivedAmounts[1], 0);
    }

    function test_Swap() public {
        // Add liquidity first
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        // Swap
        uint256 amountIn = 10e18;
        uint256 balanceBefore = tokenB.balanceOf(user);

        vm.prank(user);
        uint256 amountOut = pool.swap(address(tokenA), address(tokenB), amountIn, 0);

        assertGt(amountOut, 0);
        assertEq(tokenB.balanceOf(user), balanceBefore + amountOut);
    }

    function test_GetAmountOut() public {
        // Add liquidity
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        // Get quote
        (uint256 amountOut, uint256 feeAmount) = pool.getAmountOut(address(tokenA), address(tokenB), 10e18);

        assertGt(amountOut, 0);
        assertGt(feeAmount, 0);
    }

    function test_UpdateWeights() public {
        // Add liquidity first
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        // New weights: 52/48 (4% change, within 5% limit)
        uint256[] memory newWeights = new uint256[](2);
        newWeights[0] = (WEIGHT_PRECISION * 52) / 100;
        newWeights[1] = (WEIGHT_PRECISION * 48) / 100;

        // Advance blocks for minimum interval
        vm.roll(block.number + 20);

        vm.prank(weightRunner);
        pool.updateWeights(newWeights, 100);

        // Weights should interpolate over 100 blocks
        // After 0 blocks, should still be close to original
        uint256[] memory currentWeights = pool.getNormalizedWeights();

        // Move forward 100 blocks to reach target
        vm.roll(block.number + 100);

        currentWeights = pool.getNormalizedWeights();
        assertEq(currentWeights[0], newWeights[0]);
        assertEq(currentWeights[1], newWeights[1]);
    }

    function test_RevertOnWeightChangeTooLarge() public {
        // Add liquidity
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        // Try to change weights by more than max allowed (5%)
        uint256[] memory newWeights = new uint256[](2);
        newWeights[0] = (WEIGHT_PRECISION * 80) / 100; // 50% -> 80% = 30% change
        newWeights[1] = (WEIGHT_PRECISION * 20) / 100;

        vm.roll(block.number + 20);

        vm.prank(weightRunner);
        vm.expectRevert();
        pool.updateWeights(newWeights, 100);
    }

    function test_GetSpotPrice() public {
        // Add liquidity
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        uint256 price = pool.getSpotPrice(address(tokenA), address(tokenB));

        // With equal weights and balances, price should be 1:1
        assertEq(price, WEIGHT_PRECISION);
    }

    function test_GuardRails() public view {
        (uint256 minWeight, uint256 maxWeight, uint256 maxWeightChangeBps) = pool.getGuardRails();

        assertEq(minWeight, WEIGHT_PRECISION / 20); // 5%
        assertEq(maxWeight, (WEIGHT_PRECISION * 95) / 100); // 95%
        assertEq(maxWeightChangeBps, 500); // 5%
    }

    function test_SetGuardRails() public {
        ITFMMPool.GuardRails memory newRails = ITFMMPool.GuardRails({
            minWeight: WEIGHT_PRECISION / 10,
            maxWeight: (WEIGHT_PRECISION * 90) / 100,
            maxWeightChangeBps: 300,
            minUpdateInterval: 20
        });

        vm.prank(governance);
        pool.setGuardRails(newRails);

        (uint256 minWeight, uint256 maxWeight, uint256 maxWeightChangeBps) = pool.getGuardRails();
        assertEq(minWeight, WEIGHT_PRECISION / 10);
        assertEq(maxWeight, (WEIGHT_PRECISION * 90) / 100);
        assertEq(maxWeightChangeBps, 300);
    }

    function test_SetSwapFee() public {
        vm.prank(governance);
        pool.setSwapFee(50); // 0.5%

        assertEq(pool.swapFeeBps(), 50);
    }

    function test_RevertOnHighSwapFee() public {
        vm.prank(governance);
        vm.expectRevert();
        pool.setSwapFee(1001); // > 10%
    }

    function test_PoolState() public {
        // Add liquidity
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e18;
        amounts[1] = 100e18;

        vm.prank(user);
        pool.addLiquidity(amounts, 0);

        ITFMMPool.PoolState memory state = pool.getPoolState();

        assertEq(state.tokens.length, 2);
        assertEq(state.balances.length, 2);
        assertEq(state.currentWeights.length, 2);
        assertEq(state.swapFeeBps, 30);
        assertGt(state.totalSupply, 0);
    }
}
