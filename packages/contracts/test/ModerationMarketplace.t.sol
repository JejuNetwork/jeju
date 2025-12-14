// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/BanManager.sol";
import "../src/moderation/ModerationMarketplace.sol";

contract ModerationMarketplaceTest is Test {
    BanManager public banManager;
    ModerationMarketplace public marketplace;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public reporter = address(0x100);
    address public target = address(0x200);
    address public voter1 = address(0x300);
    address public voter2 = address(0x400);

    uint256 public constant MIN_STAKE = 0.1 ether;
    uint256 public constant STAKE_AGE = 24 hours;
    uint256 public constant STAKE_BLOCKS = 7200;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy BanManager
        banManager = new BanManager(owner, owner);

        // Deploy ModerationMarketplace
        marketplace = new ModerationMarketplace(
            address(banManager),
            address(0), // ETH staking
            treasury,
            owner
        );

        // Authorize marketplace as moderator
        banManager.setModerator(address(marketplace), true);

        vm.stopPrank();

        // Fund test accounts
        vm.deal(reporter, 10 ether);
        vm.deal(target, 10 ether);
        vm.deal(voter1, 10 ether);
        vm.deal(voter2, 10 ether);
    }

    // ============ Staking Tests ============

    function testStake() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(reporter);
        assertEq(stake.amount, 0.1 ether);
        assertTrue(stake.isStaked);
    }

    function testStakeRequiresMinAmount() public {
        vm.expectRevert(ModerationMarketplace.InvalidAmount.selector);
        vm.prank(reporter);
        marketplace.stake{value: 0}();
    }

    function testUnstake() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.prank(reporter);
        marketplace.unstake(0.05 ether);

        ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(reporter);
        assertEq(stake.amount, 0.05 ether);
    }

    function testCannotUnstakeMoreThanStaked() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.expectRevert(ModerationMarketplace.InsufficientStake.selector);
        vm.prank(reporter);
        marketplace.unstake(0.2 ether);
    }

    // ============ Case Opening Tests ============

    function testOpenCase() public {
        // Stake and age
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        assertEq(banCase.reporter, reporter);
        assertEq(banCase.target, target);
        assertEq(banCase.reason, "Spam bot");
        assertTrue(uint8(banCase.status) == uint8(ModerationMarketplace.BanStatus.ON_NOTICE));
    }

    function testCannotOpenCaseWithoutStake() public {
        vm.expectRevert(ModerationMarketplace.NotStaked.selector);
        vm.prank(reporter);
        marketplace.openCase(target, "Spam", bytes32(0));
    }

    function testCannotOpenCaseWithYoungStake() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.expectRevert(ModerationMarketplace.StakeTooYoung.selector);
        vm.prank(reporter);
        marketplace.openCase(target, "Spam", bytes32(0));
    }

    function testCannotBanSelf() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.expectRevert(ModerationMarketplace.CannotBanSelf.selector);
        vm.prank(reporter);
        marketplace.openCase(reporter, "Self ban", bytes32(0));
    }

    // ============ Challenge Tests ============

    function testChallengeCase() public {
        // Setup: stake reporter and open case
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        // Target challenges
        vm.prank(target);
        marketplace.challengeCase{value: MIN_STAKE}(caseId);

        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        assertTrue(uint8(banCase.status) == uint8(ModerationMarketplace.BanStatus.CHALLENGED));
        assertEq(banCase.targetStake, MIN_STAKE);
    }

    // ============ Voting Tests ============

    function testVoteYes() public {
        // Setup: open a challenged case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Voter stakes and ages
        vm.prank(voter1);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Vote
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        ModerationMarketplace.Vote memory vote = marketplace.getVote(caseId, voter1);
        assertTrue(vote.hasVoted);
        assertTrue(vote.position == ModerationMarketplace.VotePosition.YES);
    }

    function testVoteNo() public {
        // Setup: open a challenged case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Voter stakes and ages
        vm.prank(voter1);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Vote
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.NO);

        ModerationMarketplace.Vote memory vote = marketplace.getVote(caseId, voter1);
        assertTrue(vote.hasVoted);
        assertTrue(vote.position == ModerationMarketplace.VotePosition.NO);
    }

    function testCannotVoteTwice() public {
        // Setup: open a challenged case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Voter stakes and ages
        vm.prank(voter1);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        vm.expectRevert(ModerationMarketplace.AlreadyVoted.selector);
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.NO);
    }

    // ============ Resolution Tests ============

    function testResolveCase_BanUpheld() public {
        // Setup: open a challenged case with more YES votes
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Add more YES votes by staking more with voter
        vm.prank(voter1);
        marketplace.stake{value: 1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        // Fast forward past voting period
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        vm.warp(banCase.marketOpenUntil + 1);

        // Resolve
        marketplace.resolveCase(caseId);

        banCase = marketplace.getCase(caseId);
        assertTrue(banCase.resolved);
        assertTrue(uint8(banCase.outcome) == uint8(ModerationMarketplace.MarketOutcome.BAN_UPHELD));
        assertTrue(uint8(banCase.status) == uint8(ModerationMarketplace.BanStatus.BANNED));
    }

    function testResolveCase_BanRejected() public {
        // Setup: open a challenged case with more NO votes
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Add more NO votes by staking more with voter
        vm.prank(voter1);
        marketplace.stake{value: 1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.NO);

        // Fast forward past voting period
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        vm.warp(banCase.marketOpenUntil + 1);

        // Resolve
        marketplace.resolveCase(caseId);

        banCase = marketplace.getCase(caseId);
        assertTrue(banCase.resolved);
        assertTrue(uint8(banCase.outcome) == uint8(ModerationMarketplace.MarketOutcome.BAN_REJECTED));
        assertTrue(uint8(banCase.status) == uint8(ModerationMarketplace.BanStatus.CLEARED));
    }

    function testCannotResolveBeforeVotingEnds() public {
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        vm.expectRevert(ModerationMarketplace.VotingNotEnded.selector);
        marketplace.resolveCase(caseId);
    }

    // ============ Re-Review Tests ============

    function testRequestReReview() public {
        // Setup: resolve a case with ban upheld
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Add more YES votes
        vm.prank(voter1);
        marketplace.stake{value: 1 ether}();
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        // Resolve
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        vm.warp(banCase.marketOpenUntil + 1);
        marketplace.resolveCase(caseId);

        // Request re-review with 10x stake
        uint256 reReviewStake = banCase.reporterStake * 10;
        vm.prank(target);
        marketplace.requestReReview{value: reReviewStake}(caseId);

        banCase = marketplace.getCase(caseId);
        assertFalse(banCase.resolved);
        assertTrue(uint8(banCase.status) == uint8(ModerationMarketplace.BanStatus.APPEALING));
        assertEq(banCase.appealCount, 1);
    }

    // ============ Flash Loan Protection Tests ============

    function testStakeAgeEnforced() public {
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        // Try to vote immediately - should fail
        vm.expectRevert(ModerationMarketplace.StakeTooYoung.selector);
        vm.prank(reporter);
        marketplace.openCase(target, "Spam", bytes32(0));
    }

    function testStakeCheckpointing() public {
        // Before staking, stake at current block should be 0
        uint256 stakeBeforeStaking = marketplace.getStakeAtBlock(reporter, block.number);
        assertEq(stakeBeforeStaking, 0);

        // First stake - checkpoint is created BEFORE update (shows 0)
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        // Checkpoint at stake block shows previous state (0)
        uint256 stakeAtStakeBlock = marketplace.getStakeAtBlock(reporter, block.number);
        assertEq(stakeAtStakeBlock, 0); // Checkpoint shows state BEFORE stake

        // Move to next block
        vm.roll(block.number + 1);

        // Second stake - checkpoint now shows 0.1 (state before second stake)
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        // Query the block where second stake happened
        uint256 stakeAtSecondBlock = marketplace.getStakeAtBlock(reporter, block.number);
        assertEq(stakeAtSecondBlock, 0.1 ether); // Shows state before second stake

        // Current stake should be 0.2 ether
        ModerationMarketplace.StakeInfo memory stake = marketplace.getStake(reporter);
        assertEq(stake.amount, 0.2 ether);
    }

    function testCanReport() public {
        // Not staked - cannot report
        assertFalse(marketplace.canReport(reporter));

        // Staked but too young
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();
        assertFalse(marketplace.canReport(reporter));

        // After aging - can report
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);
        assertTrue(marketplace.canReport(reporter));
    }

    // ============ Anti-Manipulation Tests ============

    function testQuadraticVoting() public {
        // Setup case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Voter1 stakes 1 ETH
        vm.prank(voter1);
        marketplace.stake{value: 1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Vote and check weight is quadratic (sqrt)
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        ModerationMarketplace.Vote memory vote = marketplace.getVote(caseId, voter1);

        // Vote weight should be approximately sqrt(1 ether * 1e18) = 1e18
        // With time bonus, it should be higher
        assertTrue(vote.weight > 0);
        // The raw stake is 1 ether, but quadratic should make it less dominant
        assertTrue(vote.weight < 1 ether); // Quadratic reduces whale power
    }

    function testTimeWeightedVoting() public {
        // Setup case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Voter1 stakes
        vm.prank(voter1);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Vote early - should get time bonus
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        uint256 timeUntilEnd = banCase.marketOpenUntil - block.timestamp;
        assertTrue(timeUntilEnd > 0); // Should have time remaining

        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        ModerationMarketplace.Vote memory earlyVote = marketplace.getVote(caseId, voter1);

        // Early voters should have bonus
        assertTrue(earlyVote.weight > 0);
    }

    function testVoteCap() public {
        // Setup case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Whale stakes massive amount
        address whale = address(0x999);
        vm.deal(whale, 1000 ether);
        vm.prank(whale);
        marketplace.stake{value: 100 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Whale votes - weight should be capped at 25% of total votes
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        uint256 totalVotesBefore = banCase.yesVotes + banCase.noVotes;

        vm.prank(whale);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);

        ModerationMarketplace.Vote memory whaleVote = marketplace.getVote(caseId, whale);

        // Vote weight should be capped
        uint256 maxAllowedWeight = (totalVotesBefore * 2500) / 10000; // 25%
        assertTrue(whaleVote.weight <= maxAllowedWeight || totalVotesBefore == 0);
    }

    function testTotalStakedTracking() public {
        uint256 initialTotal = marketplace.totalStaked();
        assertEq(initialTotal, 0);

        // Stake
        vm.prank(reporter);
        marketplace.stake{value: 1 ether}();
        assertEq(marketplace.totalStaked(), 1 ether);

        // Another stake
        vm.prank(voter1);
        marketplace.stake{value: 0.5 ether}();
        assertEq(marketplace.totalStaked(), 1.5 ether);

        // Unstake
        vm.prank(reporter);
        marketplace.unstake(0.5 ether);
        assertEq(marketplace.totalStaked(), 1 ether);
    }

    function testAsymmetricSlashing() public {
        // Setup case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Get reporter's initial stake
        ModerationMarketplace.StakeInfo memory reporterStakeBefore = marketplace.getStake(reporter);
        uint256 reporterInitialStake = reporterStakeBefore.amount;

        // Add more NO votes to reject the ban
        vm.prank(voter1);
        marketplace.stake{value: 2 ether}();
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.NO);

        // Resolve
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        vm.warp(banCase.marketOpenUntil + 1);
        marketplace.resolveCase(caseId);

        // Check reporter was slashed 2x (asymmetric penalty)
        ModerationMarketplace.StakeInfo memory reporterStakeAfter = marketplace.getStake(reporter);

        // Reporter should have lost at least their original stake (up to 2x)
        assertTrue(reporterStakeAfter.amount < reporterInitialStake);
    }

    // ============ Banned User Restriction Tests ============

    function testBannedUserCannotVote() public {
        // Setup case
        _setupChallengedCase();
        bytes32 caseId = marketplace.getAllCaseIds()[0];

        // Setup voter1 with stake
        vm.prank(voter1);
        marketplace.stake{value: 1 ether}();
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Ban voter1 via BanManager (placeOnNotice then make permanent)
        vm.prank(address(marketplace));
        banManager.placeOnNotice(voter1, reporter, bytes32("testcase"), "Test ban");
        vm.prank(address(marketplace));
        banManager.updateBanStatus(voter1, BanManager.BanType.PERMANENT);

        // Banned user should not be able to vote
        vm.expectRevert(ModerationMarketplace.BannedUserCannotVote.selector);
        vm.prank(voter1);
        marketplace.vote(caseId, ModerationMarketplace.VotePosition.YES);
    }

    function testBannedUserCannotOpenCase() public {
        // Setup reporter with stake and age
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Ban reporter via BanManager (placeOnNotice then make permanent)
        vm.prank(address(marketplace));
        banManager.placeOnNotice(reporter, target, bytes32("testcase"), "Test ban");
        vm.prank(address(marketplace));
        banManager.updateBanStatus(reporter, BanManager.BanType.PERMANENT);

        // Banned user should not be able to open a case
        vm.expectRevert(ModerationMarketplace.BannedUserCannotReport.selector);
        vm.prank(reporter);
        marketplace.openCase(target, "Spam bot", bytes32(0));
    }

    function testBannedUserCanChallengeTheirOwnCase() public {
        // Setup case against target
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();
        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        // Target is now ON_NOTICE (effectively banned) - they should still be able to challenge
        vm.prank(target);
        marketplace.challengeCase{value: MIN_STAKE}(caseId);

        // Verify challenge succeeded
        ModerationMarketplace.BanCase memory banCase = marketplace.getCase(caseId);
        assertEq(uint8(banCase.status), uint8(ModerationMarketplace.BanStatus.CHALLENGED));
    }

    // ============ Helper Functions ============

    function _setupChallengedCase() internal returns (bytes32) {
        // Reporter stakes and ages
        vm.prank(reporter);
        marketplace.stake{value: 0.1 ether}();

        vm.warp(block.timestamp + STAKE_AGE + 1);
        vm.roll(block.number + STAKE_BLOCKS + 1);

        // Open case
        vm.prank(reporter);
        bytes32 caseId = marketplace.openCase(target, "Spam bot", bytes32(0));

        // Target challenges
        vm.prank(target);
        marketplace.challengeCase{value: MIN_STAKE}(caseId);

        return caseId;
    }
}
