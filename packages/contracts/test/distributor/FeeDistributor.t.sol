// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeDistributor} from "../../src/distributor/FeeDistributor.sol";
import {MockElizaOS} from "../../src/tokens/MockElizaOS.sol";
import {LiquidityVault} from "../../src/liquidity/LiquidityVault.sol";

contract FeeDistributorTest is Test {
    FeeDistributor public distributor;
    MockElizaOS public token;
    LiquidityVault public vault;

    address public owner = address(this);
    address public paymaster = address(0x1);
    address public oracle = address(0x2);
    address public app1 = address(0x3);
    address public contributor1 = address(0x4);
    address public contributor2 = address(0x5);

    function setUp() public {
        // Deploy token
        token = new MockElizaOS(owner);

        // Deploy vault
        vault = new LiquidityVault(address(token), owner);

        // Deploy distributor
        distributor = new FeeDistributor(address(token), address(vault), owner);

        // Set up roles
        distributor.setPaymaster(paymaster);
        distributor.setContributorOracle(oracle);
        vault.setFeeDistributor(address(distributor));

        // Mint tokens to paymaster
        token.mint(paymaster, 1000000 ether);

        // Approve distributor to spend paymaster tokens
        vm.prank(paymaster);
        token.approve(address(distributor), type(uint256).max);
    }

    // ============ Test 45/45/10 Fee Split ============

    function test_distributeFees_splits45_45_10() public {
        uint256 amount = 1000 ether;

        vm.prank(paymaster);
        distributor.distributeFees(amount, app1);

        // Check app earnings (45%)
        assertEq(distributor.appEarnings(app1), 450 ether, "App should receive 45%");

        // Check contributor pool (10%)
        assertEq(distributor.contributorPoolBalance(), 100 ether, "Contributors should receive 10%");

        // Check LP allocation (45% goes to vault)
        // This is harder to verify directly, but we can check totals
        assertEq(distributor.totalAppEarnings(), 450 ether);
        assertEq(distributor.totalLPEarnings(), 450 ether);
        assertEq(distributor.totalContributorEarnings(), 100 ether);
    }

    function test_distributeFees_accumulates() public {
        vm.startPrank(paymaster);

        distributor.distributeFees(1000 ether, app1);
        assertEq(distributor.contributorPoolBalance(), 100 ether);

        distributor.distributeFees(1000 ether, app1);
        assertEq(distributor.contributorPoolBalance(), 200 ether, "Pool should accumulate");

        vm.stopPrank();
    }

    function test_distributeFees_onlyPaymaster() public {
        vm.expectRevert(FeeDistributor.OnlyPaymaster.selector);
        distributor.distributeFees(1000 ether, app1);
    }

    function test_distributeFees_zeroAmount() public {
        vm.prank(paymaster);
        vm.expectRevert(FeeDistributor.InvalidAmount.selector);
        distributor.distributeFees(0, app1);
    }

    // ============ Test Snapshot Submission ============

    function test_submitMonthlySnapshot() public {
        // Accumulate fees
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        // Prepare snapshot data
        address[] memory contributors = new address[](2);
        contributors[0] = contributor1;
        contributors[1] = contributor2;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 600; // 60%
        shares[1] = 400; // 40%

        // Submit snapshot as oracle
        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        // Verify snapshot data
        (uint256 totalPool, uint256 totalShares, uint256 contributorCount,,, bool finalized) =
            distributor.getSnapshot(0);

        assertEq(totalPool, 100 ether, "Pool should match accumulated fees");
        assertEq(totalShares, 1000, "Total shares should sum to 1000");
        assertEq(contributorCount, 2, "Should have 2 contributors");
        assertFalse(finalized, "Should not be finalized yet");
    }

    function test_submitMonthlySnapshot_onlyOracle() public {
        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.expectRevert(FeeDistributor.OnlyOracle.selector);
        distributor.submitMonthlySnapshot(0, contributors, shares);
    }

    function test_submitMonthlySnapshot_arrayLengthMismatch() public {
        address[] memory contributors = new address[](2);
        contributors[0] = contributor1;
        contributors[1] = contributor2;

        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        vm.expectRevert(FeeDistributor.ArrayLengthMismatch.selector);
        distributor.submitMonthlySnapshot(0, contributors, shares);
    }

    // ============ Test Finalization ============

    function test_finalizeSnapshot() public {
        // Setup and submit snapshot
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        // Finalize
        vm.prank(oracle);
        distributor.finalizeSnapshot(0);

        // Verify finalized
        (,,,,, bool finalized) = distributor.getSnapshot(0);
        assertTrue(finalized, "Snapshot should be finalized");

        // Verify pool reset
        assertEq(distributor.contributorPoolBalance(), 0, "Pool should be reset");

        // Verify period advanced
        assertEq(distributor.currentPeriod(), 1, "Period should advance");
    }

    // ============ Test Claiming ============

    function test_claimContributorReward_proRata() public {
        // Setup: Distribute 1000 tokens -> 100 to contributors
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        // Submit snapshot: contributor1 gets 60%, contributor2 gets 40%
        address[] memory contributors = new address[](2);
        contributors[0] = contributor1;
        contributors[1] = contributor2;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 600;
        shares[1] = 400;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        vm.prank(oracle);
        distributor.finalizeSnapshot(0);

        // Contributor1 claims (should get 60% of 100 ether = 60 ether)
        vm.prank(contributor1);
        distributor.claimContributorReward(0);

        assertEq(token.balanceOf(contributor1), 60 ether, "Should receive 60%");

        // Contributor2 claims (should get 40% of 100 ether = 40 ether)
        vm.prank(contributor2);
        distributor.claimContributorReward(0);

        assertEq(token.balanceOf(contributor2), 40 ether, "Should receive 40%");
    }

    function test_claimContributorReward_cannotClaimTwice() public {
        // Setup
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        vm.prank(oracle);
        distributor.finalizeSnapshot(0);

        // First claim succeeds
        vm.prank(contributor1);
        distributor.claimContributorReward(0);

        // Second claim fails
        vm.prank(contributor1);
        vm.expectRevert(FeeDistributor.AlreadyClaimed.selector);
        distributor.claimContributorReward(0);
    }

    function test_claimContributorReward_notFinalizedYet() public {
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        // Try to claim before finalization
        vm.prank(contributor1);
        vm.expectRevert(FeeDistributor.SnapshotNotFinalized.selector);
        distributor.claimContributorReward(0);
    }

    // ============ Test Batch Claiming ============

    function test_claimMultiplePeriods() public {
        // Period 0
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        vm.prank(oracle);
        distributor.finalizeSnapshot(0);

        // Period 1
        vm.prank(paymaster);
        distributor.distributeFees(2000 ether, app1);

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(1, contributors, shares);

        vm.prank(oracle);
        distributor.finalizeSnapshot(1);

        // Batch claim periods 0 and 1
        uint256[] memory periods = new uint256[](2);
        periods[0] = 0;
        periods[1] = 1;

        vm.prank(contributor1);
        distributor.claimMultiplePeriods(periods);

        // Should receive 100 + 200 = 300 ether
        assertEq(token.balanceOf(contributor1), 300 ether, "Should receive from both periods");
    }

    // ============ Test View Functions ============

    function test_getContributorReward() public {
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;

        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);

        vm.prank(oracle);
        distributor.finalizeSnapshot(0);

        (uint256 reward, bool claimed, bool finalized) = distributor.getContributorReward(contributor1, 0);

        assertEq(reward, 100 ether);
        assertFalse(claimed);
        assertTrue(finalized);
    }

    function test_previewDistribution() public view {
        (uint256 appAmount, uint256 ethLPAmount, uint256 tokenLPAmount, uint256 contributorAmount) =
            distributor.previewDistribution(1000 ether);

        assertEq(appAmount, 450 ether, "App should get 45%");
        assertEq(contributorAmount, 100 ether, "Contributors should get 10%");
        assertEq(ethLPAmount, 315 ether, "ETH LPs should get 31.5% (70% of 45%)");
        assertEq(tokenLPAmount, 135 ether, "Token LPs should get 13.5% (30% of 45%)");
    }

    // ============ Test Security ============

    function test_pausable() public {
        distributor.pause();

        vm.prank(paymaster);
        vm.expectRevert();
        distributor.distributeFees(1000 ether, app1);
    }

    function test_unpause() public {
        distributor.pause();
        distributor.unpause();

        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);
        // Should succeed
    }

    function test_setContributorOracle_onlyOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        distributor.setContributorOracle(address(0x123));
    }

    // ============ Test Backward Compatibility ============

    function test_appClaiming_stillWorks() public {
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, app1);

        // App should be able to claim their 45%
        vm.prank(app1);
        distributor.claimEarnings();

        assertEq(token.balanceOf(app1), 450 ether, "App claiming should still work");
    }
}
