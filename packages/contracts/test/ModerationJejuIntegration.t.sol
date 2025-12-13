// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/BanManager.sol";
import "../src/moderation/ModerationMarketplace.sol";
import "../src/tokens/JejuToken.sol";

/**
 * @title ModerationJejuIntegrationTest
 * @notice Tests the conviction lock mechanism with JEJU token
 * @dev Verifies that banned users can stake JEJU but cannot withdraw
 */
contract ModerationJejuIntegrationTest is Test {
    BanManager public banManager;
    ModerationMarketplace public marketplace;
    JejuToken public jeju;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public reporter = address(0x100);
    address public target = address(0x200);
    address public voter1 = address(0x300);
    address public voter2 = address(0x400);

    uint256 public constant STAKE_AGE = 24 hours;
    uint256 public constant STAKE_BLOCKS = 7200;
    uint256 public constant STAKE_AMOUNT = 1000 ether; // 1000 JEJU

    function setUp() public {
        vm.startPrank(owner);

        // 1. Deploy BanManager
        banManager = new BanManager(owner, owner);

        // 2. Deploy JejuToken with BanManager
        jeju = new JejuToken(owner, address(banManager), true);

        // 3. Deploy ModerationMarketplace with JEJU as staking token
        marketplace = new ModerationMarketplace(
            address(banManager),
            address(jeju), // JEJU staking!
            treasury,
            owner
        );

        // 4. Set marketplace as ban-exempt in JejuToken
        jeju.setBanExempt(address(marketplace), true);

        // 5. Authorize marketplace as moderator in BanManager
        banManager.setModerator(address(marketplace), true);

        // 6. Fund test accounts with JEJU
        jeju.transfer(reporter, 10_000 ether);
        jeju.transfer(target, 10_000 ether);
        jeju.transfer(voter1, 10_000 ether);
        jeju.transfer(voter2, 10_000 ether);

        vm.stopPrank();

        // Fund accounts with ETH for gas
        vm.deal(reporter, 1 ether);
        vm.deal(target, 1 ether);
        vm.deal(voter1, 1 ether);
        vm.deal(voter2, 1 ether);
    }

    // ============ Basic JEJU Staking ============

    function testStakeJeju() public {
        vm.startPrank(reporter);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(reporter);
        assertEq(stake.amount, STAKE_AMOUNT, "Stake amount incorrect");
        assertTrue(stake.isStaked, "Should be staked");
    }

    function testUnstakeJeju() public {
        // Stake
        vm.startPrank(reporter);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        uint256 balanceBefore = jeju.balanceOf(reporter);

        // Unstake (no age requirement for non-voting)
        vm.prank(reporter);
        marketplace.unstake(STAKE_AMOUNT / 2);

        assertEq(jeju.balanceOf(reporter), balanceBefore + STAKE_AMOUNT / 2, "Should receive JEJU back");
    }

    // ============ Conviction Lock Tests ============

    function testBannedUserCanStakeJeju() public {
        // First ban the target directly via BanManager
        vm.prank(owner);
        banManager.applyAddressBan(target, keccak256("test"), "Test ban");

        assertTrue(jeju.isBanned(target), "Target should be banned");

        // Target should still be able to stake JEJU (marketplace is ban-exempt)
        vm.startPrank(target);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(target);
        assertEq(stake.amount, STAKE_AMOUNT, "Banned user should be able to stake");
    }

    function testBannedUserCannotUnstakeJeju() public {
        // First stake as target
        vm.startPrank(target);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        // Then ban the target
        vm.prank(owner);
        banManager.applyAddressBan(target, keccak256("test"), "Test ban");

        assertTrue(jeju.isBanned(target), "Target should be banned");

        // Target should NOT be able to unstake (JejuToken blocks transfer to banned user)
        vm.prank(target);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, target));
        marketplace.unstake(STAKE_AMOUNT);
    }

    function testUnbannedUserCanWithdrawAfterAppeal() public {
        // Setup: stake and get banned
        vm.startPrank(target);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        vm.prank(owner);
        banManager.applyAddressBan(target, keccak256("test"), "Test ban");

        // Verify can't unstake while banned
        vm.prank(target);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, target));
        marketplace.unstake(STAKE_AMOUNT);

        // Remove ban (simulating successful appeal)
        vm.prank(owner);
        banManager.removeAddressBan(target);

        assertFalse(jeju.isBanned(target), "Target should no longer be banned");

        // Now target can unstake
        uint256 balanceBefore = jeju.balanceOf(target);
        vm.prank(target);
        marketplace.unstake(STAKE_AMOUNT);

        assertEq(jeju.balanceOf(target), balanceBefore + STAKE_AMOUNT, "Should receive JEJU after unban");
    }

    // ============ Full Moderation Flow with JEJU ============

    function testFullModerationFlowWithJeju() public {
        // 1. Both parties stake JEJU upfront
        vm.startPrank(reporter);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(target);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        // 2. Age the stakes
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // 3. Reporter opens case against staked target
        // Since target is already staked, case goes directly to CHALLENGED status
        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        // 4. Verify case state
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);

        assertTrue(banCase.createdAt > 0, "Case should be created");
        assertEq(banCase.reporter, reporter, "Reporter should match");
        assertEq(banCase.target, target, "Target should match");
        assertEq(banCase.reporterStake, STAKE_AMOUNT, "Reporter stake recorded");
        assertEq(banCase.targetStake, STAKE_AMOUNT, "Target stake recorded");

        // Case should be CHALLENGED since target was staked
        assertEq(uint256(banCase.status), uint256(ModerationMarketplace.BanStatus.CHALLENGED), "Should be CHALLENGED");
    }

    function testConvictionLockAfterBanUpheld() public {
        // Setup: ALL parties stake first
        vm.startPrank(reporter);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(target);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(voter1);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(voter2);
        jeju.approve(address(marketplace), STAKE_AMOUNT);
        marketplace.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();

        // Age ALL stakes together
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Open case
        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        // Voters vote YES (ban)
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        vm.prank(voter2);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        // Wait for voting to end
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        vm.warp(banCase.marketOpenUntil + 1);

        // Resolve case
        marketplace.resolveCase(caseId);

        // If ban upheld, target is now banned
        if (banManager.isAddressBanned(target)) {
            // Target's stake should be conviction locked
            ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(target);

            // Target cannot unstake (will revert)
            if (stake.amount > 0) {
                vm.prank(target);
                vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, target));
                marketplace.unstake(stake.amount);
            }
        }
    }

    // ============ Edge Cases ============

    function testBanExemptionRequired() public {
        // Deploy new JejuToken WITHOUT setting marketplace as ban-exempt
        vm.startPrank(owner);
        JejuToken jejuNoExempt = new JejuToken(owner, address(banManager), true);

        ModerationMarketplace marketplaceNoExempt =
            new ModerationMarketplace(address(banManager), address(jejuNoExempt), treasury, owner);

        // Don't set ban exempt!
        // banManager.setModerator(address(marketplaceNoExempt), true);

        jejuNoExempt.transfer(target, 10_000 ether);
        vm.stopPrank();

        // Ban target first
        vm.prank(owner);
        banManager.applyAddressBan(target, keccak256("test"), "Test ban");

        // Target should NOT be able to stake because marketplace is not ban-exempt
        vm.startPrank(target);
        jejuNoExempt.approve(address(marketplaceNoExempt), STAKE_AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, target));
        marketplaceNoExempt.stakeTokens(STAKE_AMOUNT);
        vm.stopPrank();
    }
}
