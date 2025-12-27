// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TokenVesting} from "../../src/distributor/TokenVesting.sol";
import {Token} from "../../src/tokens/Token.sol";

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    Token public token;

    address public owner = address(0x1);
    address public beneficiary1 = address(0x2);
    address public beneficiary2 = address(0x3);

    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;
    uint256 public constant VESTING_AMOUNT = 100_000 ether;

    // Typical vesting schedule: 1 year cliff, 4 years total, 10% TGE
    uint256 public constant CLIFF_DURATION = 365 days;
    uint256 public constant VESTING_DURATION = 3 * 365 days; // After cliff
    uint8 public constant TGE_UNLOCK_PERCENT = 10;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy token (home chain)
        token = new Token("Test Token", "TEST", INITIAL_SUPPLY, owner, INITIAL_SUPPLY, true);

        // Deploy vesting
        vesting = new TokenVesting(token, owner);

        // Transfer tokens to vesting contract
        token.transfer(address(vesting), VESTING_AMOUNT * 3);

        vm.stopPrank();
    }

    // =============================================================================
    // CONSTRUCTOR TESTS
    // =============================================================================

    function test_Deploy_SetsToken() public view {
        assertEq(address(vesting.token()), address(token));
    }

    function test_Deploy_SetsOwner() public view {
        assertEq(vesting.owner(), owner);
    }

    function test_Deploy_RevertsZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(TokenVesting.ZeroAddress.selector);
        new TokenVesting(Token(address(0)), owner);
    }

    function test_Deploy_RevertsZeroOwner() public {
        vm.prank(owner);
        // OpenZeppelin's Ownable reverts with OwnableInvalidOwner before our check
        vm.expectRevert(abi.encodeWithSignature("OwnableInvalidOwner(address)", address(0)));
        new TokenVesting(token, address(0));
    }

    // =============================================================================
    // TGE TESTS
    // =============================================================================

    function test_TGE_StartsAtCurrentTime() public {
        vm.prank(owner);
        vesting.startTGE(0);

        assertEq(vesting.tgeStartTime(), block.timestamp);
    }

    function test_TGE_StartsAtFutureTime() public {
        uint256 futureTime = block.timestamp + 7 days;

        vm.prank(owner);
        vesting.startTGE(futureTime);

        assertEq(vesting.tgeStartTime(), futureTime);
    }

    function test_TGE_OnlyOwner() public {
        vm.prank(beneficiary1);
        vm.expectRevert();
        vesting.startTGE(block.timestamp);
    }

    // =============================================================================
    // SCHEDULE CREATION TESTS
    // =============================================================================

    function test_CreateSchedule_Success() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true, // revocable
            TokenVesting.VestingCategory.Team
        );

        vm.stopPrank();

        assertNotEq(scheduleId, bytes32(0));

        TokenVesting.VestingSchedule memory schedule = vesting.getSchedule(scheduleId);
        assertEq(schedule.beneficiary, beneficiary1);
        assertEq(schedule.totalAmount, VESTING_AMOUNT);
        assertEq(schedule.releasedAmount, 0);
        assertEq(schedule.cliffDuration, CLIFF_DURATION);
        assertEq(schedule.vestingDuration, VESTING_DURATION);
        assertEq(schedule.tgeUnlockPercent, TGE_UNLOCK_PERCENT);
        assertTrue(schedule.revocable);
        assertFalse(schedule.revoked);
    }

    function test_CreateSchedule_UpdatesTotalVesting() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);
        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        assertEq(vesting.totalVesting(), VESTING_AMOUNT);
    }

    function test_CreateSchedule_RevertsZeroBeneficiary() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vm.expectRevert(TokenVesting.ZeroAddress.selector);
        vesting.createSchedule(
            address(0),
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();
    }

    function test_CreateSchedule_RevertsZeroAmount() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vm.expectRevert(TokenVesting.ZeroAmount.selector);
        vesting.createSchedule(
            beneficiary1,
            0,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();
    }

    function test_CreateSchedule_RevertsInvalidTGEPercent() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vm.expectRevert(TokenVesting.InvalidSchedule.selector);
        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            101, // > 100%
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();
    }

    function test_CreateSchedule_RevertsZeroVestingWithPartialTGE() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vm.expectRevert(TokenVesting.InvalidSchedule.selector);
        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            0, // Zero vesting duration
            50, // But only 50% TGE
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();
    }

    function test_CreateSchedule_AllowsFullTGEWithZeroVesting() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            0, // No cliff
            0, // No vesting
            100, // 100% TGE - fully unlocked immediately
            false,
            TokenVesting.VestingCategory.PublicSale
        );
        vm.stopPrank();

        assertNotEq(scheduleId, bytes32(0));
    }

    // =============================================================================
    // BATCH CREATION TESTS
    // =============================================================================

    function test_CreateSchedulesBatch_Success() public {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = beneficiary1;
        beneficiaries[1] = beneficiary2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = VESTING_AMOUNT;
        amounts[1] = VESTING_AMOUNT / 2;

        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);
        vesting.createSchedulesBatch(
            beneficiaries,
            amounts,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Advisors
        );
        vm.stopPrank();

        assertEq(vesting.getScheduleCount(), 2);
        assertEq(vesting.totalVesting(), VESTING_AMOUNT + VESTING_AMOUNT / 2);
    }

    // =============================================================================
    // RELEASE TESTS
    // =============================================================================

    function test_Release_TGEAmountAvailableImmediately() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        // Beneficiary can release TGE amount immediately
        vm.prank(beneficiary1);
        vesting.release(scheduleId);

        uint256 expectedTGE = (VESTING_AMOUNT * TGE_UNLOCK_PERCENT) / 100;
        assertEq(token.balanceOf(beneficiary1), expectedTGE);
    }

    function test_Release_NothingDuringCliff() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        // Release TGE first
        vm.prank(beneficiary1);
        vesting.release(scheduleId);

        // Fast forward to middle of cliff
        vm.warp(block.timestamp + CLIFF_DURATION / 2);

        // Should have nothing more to release
        vm.prank(beneficiary1);
        vm.expectRevert(TokenVesting.NothingToRelease.selector);
        vesting.release(scheduleId);
    }

    function test_Release_LinearVestingAfterCliff() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        // Fast forward past cliff + half vesting period
        vm.warp(block.timestamp + CLIFF_DURATION + VESTING_DURATION / 2);

        vm.prank(beneficiary1);
        vesting.release(scheduleId);

        uint256 tgeAmount = (VESTING_AMOUNT * TGE_UNLOCK_PERCENT) / 100;
        uint256 vestingAmount = VESTING_AMOUNT - tgeAmount;
        uint256 halfVested = vestingAmount / 2;
        uint256 expectedTotal = tgeAmount + halfVested;

        // Allow for small rounding differences
        assertApproxEqAbs(token.balanceOf(beneficiary1), expectedTotal, 100);
    }

    function test_Release_FullAmountAfterVesting() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        // Fast forward past all vesting
        vm.warp(block.timestamp + CLIFF_DURATION + VESTING_DURATION + 1);

        vm.prank(beneficiary1);
        vesting.release(scheduleId);

        assertEq(token.balanceOf(beneficiary1), VESTING_AMOUNT);
    }

    function test_Release_RevertsTGENotStarted() public {
        vm.startPrank(owner);
        // Don't start TGE
        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        vm.prank(beneficiary1);
        vm.expectRevert(TokenVesting.TGENotStarted.selector);
        vesting.release(scheduleId);
    }

    function test_Release_RevertsScheduleNotFound() public {
        vm.prank(beneficiary1);
        vm.expectRevert(TokenVesting.ScheduleNotFound.selector);
        vesting.release(bytes32(uint256(12345)));
    }

    // =============================================================================
    // RELEASE ALL TESTS
    // =============================================================================

    function test_ReleaseAll_ReleasesFromMultipleSchedules() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );

        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT / 2,
            0, // No cliff
            0, // No vesting
            100, // 100% TGE
            false,
            TokenVesting.VestingCategory.PublicSale
        );
        vm.stopPrank();

        // Should release TGE from first + all from second
        vm.prank(beneficiary1);
        vesting.releaseAll(beneficiary1);

        uint256 tgeFromFirst = (VESTING_AMOUNT * TGE_UNLOCK_PERCENT) / 100;
        uint256 allFromSecond = VESTING_AMOUNT / 2;
        assertEq(token.balanceOf(beneficiary1), tgeFromFirst + allFromSecond);
    }

    // =============================================================================
    // REVOKE TESTS
    // =============================================================================

    function test_Revoke_ReleasesVestedAndRefundsUnvested() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true, // revocable
            TokenVesting.VestingCategory.Team
        );

        // Fast forward to release TGE
        vm.warp(block.timestamp + 1);

        uint256 ownerBalanceBefore = token.balanceOf(owner);

        // Revoke
        vesting.revoke(scheduleId);
        vm.stopPrank();

        // Beneficiary should get TGE amount
        uint256 tgeAmount = (VESTING_AMOUNT * TGE_UNLOCK_PERCENT) / 100;
        assertEq(token.balanceOf(beneficiary1), tgeAmount);

        // Owner should get unvested amount back
        uint256 unvested = VESTING_AMOUNT - tgeAmount;
        assertEq(token.balanceOf(owner), ownerBalanceBefore + unvested);
    }

    function test_Revoke_RevertsNotRevocable() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            false, // NOT revocable
            TokenVesting.VestingCategory.Team
        );

        vm.expectRevert(TokenVesting.NotRevocable.selector);
        vesting.revoke(scheduleId);
        vm.stopPrank();
    }

    function test_Revoke_RevertsAlreadyRevoked() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );

        vesting.revoke(scheduleId);

        vm.expectRevert(TokenVesting.AlreadyRevoked.selector);
        vesting.revoke(scheduleId);
        vm.stopPrank();
    }

    // =============================================================================
    // VIEW FUNCTION TESTS
    // =============================================================================

    function test_GetReleasable_ReturnsCorrectAmount() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        uint256 releasable = vesting.getReleasable(scheduleId);
        uint256 expectedTGE = (VESTING_AMOUNT * TGE_UNLOCK_PERCENT) / 100;
        assertEq(releasable, expectedTGE);
    }

    function test_GetVested_ReturnsFullAmountAfterVesting() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        bytes32 scheduleId = vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );
        vm.stopPrank();

        vm.warp(block.timestamp + CLIFF_DURATION + VESTING_DURATION + 1);

        uint256 vested = vesting.getVested(scheduleId);
        assertEq(vested, VESTING_AMOUNT);
    }

    function test_GetBeneficiarySchedules_ReturnsAllSchedules() public {
        vm.startPrank(owner);
        vesting.startTGE(block.timestamp);

        vesting.createSchedule(
            beneficiary1,
            VESTING_AMOUNT,
            CLIFF_DURATION,
            VESTING_DURATION,
            TGE_UNLOCK_PERCENT,
            true,
            TokenVesting.VestingCategory.Team
        );

        vesting.createSchedule(
            beneficiary1, VESTING_AMOUNT / 2, 0, VESTING_DURATION, 0, false, TokenVesting.VestingCategory.Advisors
        );
        vm.stopPrank();

        bytes32[] memory schedules = vesting.getBeneficiarySchedules(beneficiary1);
        assertEq(schedules.length, 2);
    }
}
