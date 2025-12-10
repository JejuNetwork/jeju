// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

contract LiquidityVaultTest is Test {
    LiquidityVault public vault;
    ElizaOSToken public rewardToken;

    address public owner = address(this);
    address public paymaster = address(0x123);
    address public lp1 = address(0x1);
    address public lp2 = address(0x2);

    function setUp() public {
        // Deploy token and vault
        rewardToken = new ElizaOSToken(owner);
        vault = new LiquidityVault(address(rewardToken), owner);
        vault.setPaymaster(paymaster); // For funding tests
        vault.setFeeDistributor(paymaster); // For fee distribution tests (paymaster simulates distributor)

        // Fund test accounts
        vm.deal(lp1, 100 ether);
        vm.deal(lp2, 100 ether);
        rewardToken.transfer(lp1, 1000000e18);
        rewardToken.transfer(lp2, 1000000e18);
    }

    // ============ ETH Liquidity Tests ============

    function testAddETHLiquidity_FirstDeposit() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        assertEq(vault.ethShares(lp1), 10 ether);
        assertEq(vault.totalETHLiquidity(), 10 ether);
        assertEq(address(vault).balance, 10 ether);
    }

    function testAddETHLiquidity_SubsequentDeposits() public {
        // LP1 deposits 10 ETH
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        // LP2 deposits 5 ETH (should get 5 shares since pool is 1:1)
        vm.prank(lp2);
        vault.addETHLiquidity{value: 5 ether}(0);

        assertEq(vault.ethShares(lp2), 5 ether);
        assertEq(vault.totalETHLiquidity(), 15 ether);
        assertEq(address(vault).balance, 15 ether);
    }

    function testRemoveETHLiquidity() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(0);

        uint256 lp1BalanceBefore = lp1.balance;

        vm.prank(lp1);
        vault.removeETHLiquidity(10 ether);

        assertEq(vault.ethShares(lp1), 10 ether);
        assertEq(lp1.balance, lp1BalanceBefore + 10 ether);
    }

    function testCannotRemoveMoreThanOwned() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        vm.prank(lp1);
        vm.expectRevert(LiquidityVault.InsufficientLiquidity.selector);
        vault.removeETHLiquidity(20 ether);
    }

    // ============ elizaOS Liquidity Tests ============

    function testAddElizaLiquidity() public {
        uint256 amount = 1000e18;

        vm.startPrank(lp1);
        rewardToken.approve(address(vault), amount);
        vault.addElizaLiquidity(amount, 0); // amount, minShares
        vm.stopPrank();

        assertEq(vault.elizaShares(lp1), amount);
        assertEq(vault.totalElizaLiquidity(), amount);
    }

    function testRemoveElizaLiquidity() public {
        uint256 amount = 1000e18;

        vm.startPrank(lp1);
        rewardToken.approve(address(vault), amount);
        vault.addElizaLiquidity(amount, 0); // amount, minShares

        uint256 balanceBefore = rewardToken.balanceOf(lp1);
        vault.removeElizaLiquidity(amount / 2);
        vm.stopPrank();

        assertEq(vault.elizaShares(lp1), amount / 2);
        assertEq(rewardToken.balanceOf(lp1), balanceBefore + amount / 2);
    }

    // ============ Fee Distribution Tests ============

    function testDistributeFees() public {
        // Setup: LP1 provides liquidity
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        // Distribute fees
        uint256 ethFees = 100e18;
        uint256 tokenFees = 50e18;
        uint256 totalFees = ethFees + tokenFees;

        // Give paymaster tokens
        rewardToken.transfer(paymaster, totalFees);

        // Paymaster distributes
        vm.startPrank(paymaster);
        rewardToken.approve(address(vault), totalFees);
        vault.distributeFees(ethFees, tokenFees);
        vm.stopPrank();

        // Verify fees were distributed with exact calculations
        // LP1 has 10 ETH shares, totalShares = 10 ETH
        // ethFees = 50e18, so ethFeesPerShare = 50e18 * 1e18 / 10e18 = 5e18
        uint256 expectedFeesPerShare = (ethFees * 1e18) / (10 ether);
        assertEq(vault.ethFeesPerShare(), expectedFeesPerShare, "Fees per share mismatch");

        // LP1's pending fees = shares * feesPerShare / 1e18 = 10e18 * 5e18 / 1e18 = 50e18
        assertEq(vault.pendingFees(lp1), ethFees, "LP1 should have all fees (only LP)");
    }

    function testClaimFees() public {
        // Setup liquidity
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        // Distribute fees
        uint256 fees = 100e18;
        rewardToken.transfer(paymaster, fees);
        vm.startPrank(paymaster);
        rewardToken.approve(address(vault), fees);
        vault.distributeFees(fees, 0);
        vm.stopPrank();

        // LP1 claims
        uint256 balanceBefore = rewardToken.balanceOf(lp1);
        vm.prank(lp1);
        vault.claimFees();

        // Verify exact fee amount claimed (LP1 has all shares, gets all fees)
        assertEq(rewardToken.balanceOf(lp1), balanceBefore + fees, "LP1 should receive exact fee amount");
        assertEq(vault.pendingFees(lp1), 0, "Pending fees should be zero after claim");
    }

    function testProportionalFeeDistribution() public {
        // LP1 deposits 10 ETH, LP2 deposits 5 ETH
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        vm.prank(lp2);
        vault.addETHLiquidity{value: 5 ether}(0);

        // Distribute 150 tokens
        uint256 totalFees = 150e18;
        rewardToken.transfer(paymaster, totalFees);
        vm.startPrank(paymaster);
        rewardToken.approve(address(vault), totalFees);
        vault.distributeFees(totalFees, 0);
        vm.stopPrank();

        // LP1 should get 2/3, LP2 should get 1/3
        uint256 lp1Fees = vault.pendingFees(lp1);
        uint256 lp2Fees = vault.pendingFees(lp2);

        assertApproxEqRel(lp1Fees, 100e18, 0.01e18); // Within 1%
        assertApproxEqRel(lp2Fees, 50e18, 0.01e18);
    }

    // ============ Paymaster Integration Tests ============

    function testProvideETHForGas() public {
        // Add enough liquidity (need >10 ether minimum)
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(0);

        uint256 paymasterBalanceBefore = paymaster.balance;
        uint256 available = vault.availableETH();

        // Should be able to provide some ETH
        assertGt(available, 0);

        vm.prank(paymaster);
        vault.provideETHForGas(1 ether);

        assertEq(paymaster.balance, paymasterBalanceBefore + 1 ether);
    }

    function testCannotProvideMoreThanAvailable() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(0);

        // Available is 80% of balance minus minimum
        uint256 available = vault.availableETH();

        vm.prank(paymaster);
        vm.expectRevert(LiquidityVault.InsufficientLiquidity.selector);
        vault.provideETHForGas(available + 1 ether);
    }

    // ============ Safety Tests ============

    function testMinimumLiquidityEnforced() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 11 ether}(0);

        // Try to withdraw all but 1 ETH (below 10 ETH minimum)
        vm.prank(lp1);
        vm.expectRevert(LiquidityVault.BelowMinimumLiquidity.selector);
        vault.removeETHLiquidity(10.5 ether);
    }

    function testPauseStopsNewDeposits() public {
        vault.pause();

        vm.prank(lp1);
        vm.expectRevert();
        vault.addETHLiquidity{value: 1 ether}(0);
    }

    function testPauseDoesNotBlockWithdrawals() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(0);

        vault.pause();

        // Should still be able to withdraw
        vm.prank(lp1);
        vault.removeETHLiquidity(5 ether);

        assertEq(vault.ethShares(lp1), 15 ether);
    }

    function testOnlyFeeDistributorCanDistributeFees() public {
        rewardToken.transfer(lp1, 100e18);

        vm.startPrank(lp1);
        rewardToken.approve(address(vault), 100e18);
        vm.expectRevert("Only fee distributor");
        vault.distributeFees(100e18, 0);
        vm.stopPrank();
    }

    // ============ Dual-Use (V4 + XLP) Tests ============

    function testDepositDual() public {
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Default allocation: 70% V4, 30% XLP
        assertEq(vault.ethInV4(), 7 ether);
        assertEq(vault.ethInXLP(), 3 ether);
        assertEq(vault.ethShares(lp1), 10 ether);
    }

    function testPreviewAllocation() public view {
        (uint256 v4Amount, uint256 xlpAmount) = vault.previewAllocation(10 ether);
        
        assertEq(v4Amount, 7 ether); // 70%
        assertEq(xlpAmount, 3 ether); // 30%
    }

    function testSetAllocation() public {
        vault.setAllocation(5000, 5000); // 50/50 split
        
        assertEq(vault.v4AllocationBps(), 5000);
        assertEq(vault.xlpAllocationBps(), 5000);
    }

    function testSetAllocation_MustTotal100() public {
        vm.expectRevert("Must total 100%");
        vault.setAllocation(6000, 3000); // Only 90%
    }

    function testRebalance() public {
        // Initial deposit with 70/30 split
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Change allocation to 50/50
        vault.setAllocation(5000, 5000);

        // Rebalance
        vault.rebalance();

        // Should now be 50/50
        assertEq(vault.ethInV4(), 5 ether);
        assertEq(vault.ethInXLP(), 5 ether);
    }

    function testCreateV4Position() public {
        bytes32 poolId = keccak256("ETH/USDC");
        
        vault.createV4Position(
            poolId,
            address(0), // ETH
            address(rewardToken), // USDC (using rewardToken as proxy)
            3000, // 0.3% fee
            -887220, // tickLower
            887220, // tickUpper
            1000000 // liquidity
        );

        (address token0,,,,,,, bool active) = vault.v4Positions(poolId);
        assertEq(token0, address(0));
        assertTrue(active);
    }

    function testRecordV4Fees() public {
        // Create position first
        bytes32 poolId = keccak256("ETH/USDC");
        vault.createV4Position(
            poolId,
            address(0),
            address(rewardToken),
            3000,
            -887220,
            887220,
            1000000
        );

        // Add LP so there are shares
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Record fees (owner can do this)
        vault.recordV4Fees(poolId, 1 ether, 0.5 ether);

        assertEq(vault.totalV4Fees(), 1.5 ether);
    }

    function testRecordXLPFees() public {
        // Set up XLP paymaster
        address xlpPaymaster = address(0x456);
        vault.setCrossChainPaymaster(xlpPaymaster);

        // Add LP
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Record fees
        vm.prank(xlpPaymaster);
        vault.recordXLPFees(0.5 ether);

        assertEq(vault.totalXLPFees(), 0.5 ether);
    }

    function testPendingCombinedFees() public {
        // Set up
        bytes32 poolId = keccak256("ETH/USDC");
        vault.createV4Position(poolId, address(0), address(rewardToken), 3000, -887220, 887220, 1000000);

        address xlpPaymaster = address(0x456);
        vault.setCrossChainPaymaster(xlpPaymaster);

        // LP deposits
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Record V4 fees
        vault.recordV4Fees(poolId, 1 ether, 0);

        // Record XLP fees
        vm.prank(xlpPaymaster);
        vault.recordXLPFees(0.5 ether);

        // LP1 should have 1.5 ETH in combined fees
        uint256 pending = vault.pendingCombined(lp1);
        assertEq(pending, 1.5 ether);
    }

    function testGetVaultStats() public {
        // Deposit
        vm.prank(lp1);
        vault.depositDual{value: 10 ether}(0);

        // Create a position
        bytes32 poolId = keccak256("ETH/USDC");
        vault.createV4Position(poolId, address(0), address(rewardToken), 3000, -887220, 887220, 1000000);

        (
            uint256 v4Total,
            uint256 xlpTotal,
            uint256 v4FeesTotal,
            uint256 xlpFeesTotal,
            uint256 activePositions
        ) = vault.getVaultStats();

        assertEq(v4Total, 7 ether);
        assertEq(xlpTotal, 3 ether);
        assertEq(v4FeesTotal, 0);
        assertEq(xlpFeesTotal, 0);
        assertEq(activePositions, 1);
    }

    function testSetSwapRouter() public {
        address router = address(0x789);
        vault.setSwapRouter(router);
        assertEq(vault.swapRouter(), router);
    }

    function testSetCrossChainPaymaster() public {
        address xlpPaymaster = address(0x456);
        vault.setCrossChainPaymaster(xlpPaymaster);
        assertEq(vault.crossChainPaymaster(), xlpPaymaster);
    }

    function testVersion() public view {
        assertEq(vault.version(), "2.0.0");
    }
}
