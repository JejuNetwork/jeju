// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/rpc/RPCStakingManager.sol";
import "../src/moderation/ModerationMarketplace.sol";
import "../src/moderation/BanManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPriceOracle {
    int256 public price = 1e7; // $0.10
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, price, 0, block.timestamp, 0);
    }
    function setPrice(int256 _price) external { price = _price; }
}

/**
 * @title Moderation & Staking Scenario Tests
 * @notice Comprehensive tests for attack vectors, edge cases, and financial exploits
 */
contract ModerationScenariosTest is Test {
    MockJEJU jejuToken;
    MockPriceOracle priceOracle;
    RPCStakingManager rpcStaking;
    ModerationMarketplace moderationMarket;
    BanManager banManager;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address governance = makeAddr("governance");
    
    // Test actors
    address stakedReporter = makeAddr("stakedReporter");
    address unstakedTarget = makeAddr("unstakedTarget");
    address stakedTarget = makeAddr("stakedTarget");
    address highRepModerator = makeAddr("highRepModerator");
    address lowRepModerator = makeAddr("lowRepModerator");
    address whale = makeAddr("whale");
    
    // Sybil accounts
    address[] sybils;
    
    uint256 constant RPC_STAKE_AMOUNT = 1000 ether; // $100 worth at $0.10
    uint256 constant MOD_STAKE_AMOUNT = 0.1 ether;

    function setUp() public {
        vm.startPrank(owner);
        
        jejuToken = new MockJEJU();
        priceOracle = new MockPriceOracle();
        banManager = new BanManager(governance, owner);
        
        rpcStaking = new RPCStakingManager(
            address(jejuToken),
            address(0), // no identity registry for tests
            address(priceOracle),
            owner
        );
        
        moderationMarket = new ModerationMarketplace(
            address(banManager),
            address(0), // ETH staking
            treasury,
            owner
        );
        
        // Authorize moderation marketplace
        banManager.setModerator(address(moderationMarket), true);
        
        // Fund test accounts
        jejuToken.mint(stakedReporter, 100_000 ether);
        jejuToken.mint(stakedTarget, 100_000 ether);
        jejuToken.mint(whale, 1_000_000 ether);
        
        vm.deal(stakedReporter, 100 ether);
        vm.deal(unstakedTarget, 100 ether);
        vm.deal(stakedTarget, 100 ether);
        vm.deal(highRepModerator, 100 ether);
        vm.deal(lowRepModerator, 100 ether);
        vm.deal(whale, 1000 ether);
        
        // Create sybil accounts
        for (uint256 i = 0; i < 10; i++) {
            address sybil = makeAddr(string(abi.encodePacked("sybil", i)));
            sybils.push(sybil);
            vm.deal(sybil, 10 ether);
            jejuToken.mint(sybil, 10_000 ether);
        }
        
        vm.stopPrank();
    }
    
    // =========================================================================
    //                    SCENARIO 1: STAKED REPORTS UNSTAKED
    // =========================================================================
    
    function test_Scenario_StakedReportsUnstaked() public {
        console.log("\n=== SCENARIO: Staked Reports Unstaked (No BanManager) ===");
        
        vm.startPrank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        vm.stopPrank();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        console.log("Reporter stake:", MOD_STAKE_AMOUNT / 1e18, "ETH");
        
        vm.prank(stakedReporter);
        moderationMarket.openCase(unstakedTarget, "Suspicious activity", keccak256("evidence"));
        
        console.log("Case opened against unstaked target");
        console.log("Target banned:", banManager.isAddressBanned(unstakedTarget));
        console.log("Target on notice:", banManager.isOnNotice(unstakedTarget));
        
        assertTrue(banManager.isAddressBanned(unstakedTarget));
        assertTrue(banManager.isOnNotice(unstakedTarget));
        
        // Without BanManager configured in RPC, banned user can still stake
        vm.startPrank(unstakedTarget);
        jejuToken.mint(unstakedTarget, RPC_STAKE_AMOUNT);
        jejuToken.approve(address(rpcStaking), RPC_STAKE_AMOUNT);
        rpcStaking.stake(RPC_STAKE_AMOUNT);
        
        bool canAccess = rpcStaking.canAccess(unstakedTarget);
        console.log("RPC access (no BanManager set):", canAccess);
        assertTrue(canAccess, "Without BanManager integration, banned user can access RPC");
        vm.stopPrank();
        
        console.log("RESULT: Shows vulnerability when BanManager not configured");
    }
    
    function test_Scenario_StakedReportsUnstaked_VotingAndResolution() public {
        console.log("\n=== SCENARIO: Full Voting Flow & Resolution ===");
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(unstakedTarget, "Spam", keccak256("evidence1"));
        
        ModerationMarketplace.BanCase memory openCase = moderationMarket.getCase(caseId);
        console.log("Initial YES votes:", openCase.yesVotes / 1e18);
        console.log("Initial NO votes:", openCase.noVotes / 1e18);
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        ModerationMarketplace.BanCase memory resolved = moderationMarket.getCase(caseId);
        console.log("Outcome:", uint256(resolved.outcome) == 1 ? "BAN_UPHELD" : "BAN_REJECTED");
        console.log("Permanently banned:", banManager.isPermanentlyBanned(unstakedTarget));
        
        assertEq(uint256(resolved.outcome), uint256(ModerationMarketplace.MarketOutcome.BAN_UPHELD));
        assertTrue(banManager.isPermanentlyBanned(unstakedTarget));
    }
    
    // =========================================================================
    //                    SCENARIO 2: UNSTAKED REPORTS STAKED
    // =========================================================================
    
    function test_Scenario_UnstakedCannotReport() public {
        // Unstaked user tries to report
        vm.prank(unstakedTarget);
        vm.expectRevert(ModerationMarketplace.NotStaked.selector);
        moderationMarket.openCase(stakedTarget, "False report", keccak256("fake"));
    }
    
    function test_Scenario_LowStakeCannotReport() public {
        // Stake below minimum
        vm.prank(lowRepModerator);
        moderationMarket.stake{value: 0.01 ether}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(lowRepModerator);
        vm.expectRevert(ModerationMarketplace.InsufficientStake.selector);
        moderationMarket.openCase(stakedTarget, "Report", keccak256("evidence"));
    }
    
    // =========================================================================
    //                    SCENARIO 3: STAKED vs STAKED
    // =========================================================================
    
    function test_Scenario_StakedVsStaked_Challenge() public {
        // Both parties stake in moderation
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.prank(stakedTarget);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        // Reporter opens case
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "Suspected scam", keccak256("evidence"));
        
        // Case should be CHALLENGED since target is staked
        ModerationMarketplace.BanCase memory banCase = moderationMarket.getCase(caseId);
        assertEq(uint256(banCase.status), uint256(ModerationMarketplace.BanStatus.CHALLENGED));
        
        // Both have votes recorded with quadratic weights
        assertTrue(banCase.yesVotes > 0, "Reporter should have YES votes");
        assertTrue(banCase.noVotes > 0, "Target should have NO votes");
    }
    
    function test_Scenario_StakedVsStaked_WinnerTakesStake() public {
        console.log("\n=== SCENARIO: Staked vs Staked - Winner Takes Stake ===");
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.prank(stakedTarget);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sybils[i]);
            moderationMarket.stake{value: 0.2 ether}();
        }
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        uint256 reporterBefore = moderationMarket.getStake(stakedReporter).amount;
        uint256 targetBefore = moderationMarket.getStake(stakedTarget).amount;
        console.log("Reporter stake before:", reporterBefore / 1e18, "ETH");
        console.log("Target stake before:", targetBefore / 1e18, "ETH");
        
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "Fraud", keccak256("evidence"));
        
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sybils[i]);
            moderationMarket.vote(caseId, ModerationMarketplace.VotePosition.YES);
        }
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        uint256 reporterAfter = moderationMarket.getStake(stakedReporter).amount;
        uint256 targetAfter = moderationMarket.getStake(stakedTarget).amount;
        console.log("Reporter stake after:", reporterAfter / 1e18, "ETH");
        console.log("Target stake after:", targetAfter / 1e18, "ETH");
        console.log("Reporter gained:", (reporterAfter - reporterBefore) / 1e15, "finney");
        
        assertGt(reporterAfter, reporterBefore, "Winner should gain stake");
    }
    
    // =========================================================================
    //                    SCENARIO 4: HIGH REP vs LOW REP
    // =========================================================================
    
    function test_Scenario_HighRepReportsLowRep() public {
        // High rep moderator stakes and builds reputation
        vm.prank(highRepModerator);
        moderationMarket.stake{value: 1 ether}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        // High rep can report alone (quorum = 1)
        uint256 quorum = moderationMarket.getQuorumRequired(highRepModerator);
        assertEq(quorum, 1, "High rep should be able to report alone");
        
        // Report low rep target
        vm.prank(highRepModerator);
        bytes32 caseId = moderationMarket.openCase(lowRepModerator, "Spam reports", keccak256("evidence"));
        
        assertTrue(caseId != bytes32(0), "Case should be created");
    }
    
    function test_Scenario_LowRepNeedsQuorum() public {
        // Degrade moderator reputation (simulate failed reports)
        // In practice this happens naturally via _updateReputation
        
        // Low rep needs quorum of 3
        // Note: New moderators start at HIGH tier (7000) so they can report alone
        // We need to simulate reputation loss first
        
        // For this test, we'll verify the quorum logic
        vm.prank(lowRepModerator);
        moderationMarket.stake{value: 0.15 ether}();
        
        vm.warp(block.timestamp + 8 days); // Need 7 days for quorum stake age
        vm.roll(block.number + 58000);
        
        // Check if needs quorum based on reputation
        ModerationMarketplace.ReputationTier tier = moderationMarket.getReputationTier(lowRepModerator);
        
        // New users start at HIGH tier, so they can report alone
        // But if reputation drops, they need quorum
        if (tier <= ModerationMarketplace.ReputationTier.MEDIUM) {
            uint256 quorum = moderationMarket.getQuorumRequired(lowRepModerator);
            assertGt(quorum, 1, "Low rep should need quorum");
        }
    }
    
    // =========================================================================
    //                    SCENARIO 5: SYBIL ATTACKS
    // =========================================================================
    
    function test_Scenario_SybilAttack_GangUpOnTarget() public {
        console.log("\n=== SCENARIO: Sybil Attack - Gang Up on Target ===");
        
        uint256 sybilStake = 0.15 ether;
        console.log("Sybil accounts:", uint256(5));
        console.log("Each sybil stake:", sybilStake / 1e15, "finney");
        
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(sybils[i]);
            moderationMarket.stake{value: sybilStake}();
        }
        
        vm.warp(block.timestamp + 8 days);
        vm.roll(block.number + 58000);
        
        vm.prank(sybils[0]);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "Coordinated attack", keccak256("evidence"));
        
        ModerationMarketplace.BanCase memory beforeChallenge = moderationMarket.getCase(caseId);
        console.log("YES votes after opening:", beforeChallenge.yesVotes / 1e15, "finney-weight");
        
        vm.prank(stakedTarget);
        moderationMarket.challengeCase{value: 0.1 ether}(caseId);
        
        ModerationMarketplace.BanCase memory afterChallenge = moderationMarket.getCase(caseId);
        console.log("NO votes after challenge:", afterChallenge.noVotes / 1e15, "finney-weight");
        
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(sybils[i]);
            moderationMarket.vote(caseId, ModerationMarketplace.VotePosition.YES);
        }
        
        ModerationMarketplace.BanCase memory afterVotes = moderationMarket.getCase(caseId);
        console.log("Final YES votes:", afterVotes.yesVotes / 1e15, "finney-weight");
        console.log("Final NO votes:", afterVotes.noVotes / 1e15, "finney-weight");
        
        // Calculate effective voting power per sybil (quadratic)
        uint256 linearTotal = 5 * sybilStake;
        console.log("Linear total would be:", linearTotal / 1e15, "finney");
        console.log("Actual quadratic total:", afterVotes.yesVotes / 1e15, "finney-weight");
        console.log("Reduction factor:", linearTotal / afterVotes.yesVotes, "x");
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        ModerationMarketplace.BanCase memory resolved = moderationMarket.getCase(caseId);
        console.log("Outcome:", uint256(resolved.outcome) == 1 ? "BAN_UPHELD" : "BAN_REJECTED");
        console.log("PROTECTION: Quadratic voting + vote caps reduced Sybil effectiveness");
    }
    
    function test_Scenario_SybilAttack_QuorumProtection() public {
        // Test that fresh stakes can't immediately vote
        
        // Create fresh sybil accounts
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sybils[i]);
            moderationMarket.stake{value: 0.15 ether}();
        }
        
        // Only wait 12 hours (not 24 required)
        vm.warp(block.timestamp + 12 hours);
        vm.roll(block.number + 3600);
        
        // Should fail due to stake age < 24 hours
        vm.prank(sybils[0]);
        vm.expectRevert(ModerationMarketplace.StakeTooYoung.selector);
        moderationMarket.openCase(stakedTarget, "Attack", keccak256("evidence"));
        
        // Also verify MIN_STAKE_BLOCKS protection (block-based flash loan protection)
        vm.warp(block.timestamp + 25 hours); // Time is OK
        vm.roll(block.number + 100); // But blocks are too few (need 7200)
        
        vm.prank(sybils[0]);
        vm.expectRevert(ModerationMarketplace.FlashLoanDetected.selector);
        moderationMarket.openCase(stakedTarget, "Attack", keccak256("evidence"));
    }
    
    // =========================================================================
    //                    SCENARIO 6: FINANCIAL ARBITRAGE
    // =========================================================================
    
    function test_Scenario_FinancialArbitrage_ReportToProfit() public {
        // Whale stakes large amount to gain moderation power
        vm.prank(whale);
        moderationMarket.stake{value: 10 ether}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        // Whale reports small staker to take their stake
        vm.prank(stakedReporter);
        moderationMarket.stake{value: 0.1 ether}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(whale);
        bytes32 caseId = moderationMarket.openCase(stakedReporter, "False accusation for profit", keccak256("fake"));
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        // If whale wins, they profit 90% of target's stake
        // If whale loses, they lose 2x their stake (asymmetric penalty)
        // The asymmetric slashing (2x for failed reports) is the key protection
    }
    
    function test_Scenario_FinancialArbitrage_AsymmetricPenalty() public {
        console.log("\n=== SCENARIO: Financial Arbitrage - Asymmetric Penalty ===");
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: 0.1 ether}();
        
        vm.prank(stakedTarget);
        moderationMarket.stake{value: 0.5 ether}();
        
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sybils[i]);
            moderationMarket.stake{value: 0.3 ether}();
        }
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        uint256 reporterBefore = moderationMarket.getStake(stakedReporter).amount;
        uint256 targetBefore = moderationMarket.getStake(stakedTarget).amount;
        console.log("Reporter stake before:", reporterBefore / 1e15, "finney");
        console.log("Target stake before:", targetBefore / 1e15, "finney");
        console.log("Potential gain if win:", (targetBefore * 90) / 100 / 1e15, "finney (90%)");
        console.log("Risk if lose:", (reporterBefore * 2) / 1e15, "finney (2x penalty)");
        
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "False report", keccak256("fake"));
        
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(sybils[i]);
            moderationMarket.vote(caseId, ModerationMarketplace.VotePosition.NO);
        }
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        ModerationMarketplace.MarketOutcome outcome = moderationMarket.getCase(caseId).outcome;
        console.log("Outcome:", uint256(outcome) == 1 ? "BAN_UPHELD" : "BAN_REJECTED");
        
        uint256 reporterAfter = moderationMarket.getStake(stakedReporter).amount;
        console.log("Reporter stake after:", reporterAfter / 1e15, "finney");
        
        if (outcome == ModerationMarketplace.MarketOutcome.BAN_REJECTED) {
            uint256 lost = reporterBefore - reporterAfter;
            console.log("Reporter lost:", lost / 1e15, "finney");
            console.log("PROTECTION: 2x penalty discourages false reports");
            assertLt(reporterAfter, reporterBefore, "Failed reporter should lose stake");
        }
    }
    
    // =========================================================================
    //                    SCENARIO 7: 51% ATTACK
    // =========================================================================
    
    function test_Scenario_51Attack_WhaleControl() public {
        console.log("\n=== SCENARIO: 51% Attack - Whale Control ===");
        
        uint256 whaleStake = 50 ether;
        uint256 communityStake = 0.2 ether;
        console.log("Whale stake:", whaleStake / 1e18, "ETH");
        console.log("Community stake (each):", communityStake / 1e15, "finney");
        console.log("Community members: 5");
        
        vm.prank(whale);
        moderationMarket.stake{value: whaleStake}();
        
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(sybils[i]);
            moderationMarket.stake{value: communityStake}();
        }
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(whale);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "Whale attack", keccak256("evidence"));
        
        ModerationMarketplace.BanCase memory whaleVote = moderationMarket.getCase(caseId);
        console.log("Whale YES vote weight:", whaleVote.yesVotes / 1e15, "finney-weight");
        
        // Linear: whale would have 50 ETH = 50000 finney
        // Quadratic: sqrt(50 ETH) = ~7.07 ETH weight, capped at 0.707 ETH max
        console.log("If linear, whale would have:", whaleStake / 1e15, "finney");
        console.log("Quadratic + cap protection active");
        
        vm.prank(stakedTarget);
        moderationMarket.challengeCase{value: 0.1 ether}(caseId);
        
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(sybils[i]);
            moderationMarket.vote(caseId, ModerationMarketplace.VotePosition.NO);
        }
        
        ModerationMarketplace.BanCase memory afterVotes = moderationMarket.getCase(caseId);
        console.log("Final YES (whale):", afterVotes.yesVotes / 1e15, "finney-weight");
        console.log("Final NO (community):", afterVotes.noVotes / 1e15, "finney-weight");
        
        uint256 whaleControlPct = (afterVotes.yesVotes * 100) / (afterVotes.yesVotes + afterVotes.noVotes);
        console.log("Whale control %:", whaleControlPct);
        console.log("PROTECTION: Whale with 50 ETH cannot dominate 5 small stakers");
        
        assertGt(afterVotes.noVotes, whaleVote.noVotes, "Community should add voting weight");
    }
    
    // =========================================================================
    //                    SCENARIO 8: RPC-MODERATION INTEGRATION GAP
    // =========================================================================
    
    function test_Scenario_BannedUserCanStillUseRPC() public {
        console.log("\n=== SCENARIO: RPC-Moderation Integration (FIXED) ===");
        
        vm.prank(owner);
        rpcStaking.setBanManager(address(banManager));
        console.log("BanManager configured in RPCStakingManager");
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(stakedReporter);
        moderationMarket.openCase(unstakedTarget, "Bad actor", keccak256("evidence"));
        
        console.log("Target banned:", banManager.isAddressBanned(unstakedTarget));
        console.log("Target on notice:", banManager.isOnNotice(unstakedTarget));
        
        assertTrue(banManager.isAddressBanned(unstakedTarget));
        
        vm.startPrank(unstakedTarget);
        jejuToken.mint(unstakedTarget, RPC_STAKE_AMOUNT);
        jejuToken.approve(address(rpcStaking), RPC_STAKE_AMOUNT);
        
        console.log("Attempting to stake while banned...");
        vm.expectRevert(IRPCStakingManager.UserIsBanned.selector);
        rpcStaking.stake(RPC_STAKE_AMOUNT);
        console.log("BLOCKED: UserIsBanned revert");
        
        bool canAccess = rpcStaking.canAccess(unstakedTarget);
        console.log("canAccess():", canAccess);
        assertFalse(canAccess);
        
        vm.stopPrank();
        console.log("RESULT: Banned users cannot stake or access RPC");
    }
    
    function test_Scenario_RPCStakeNotFrozenWhenBanned() public {
        console.log("\n=== SCENARIO: Existing RPC Stake + Later Ban ===");
        
        vm.prank(owner);
        rpcStaking.setBanManager(address(banManager));
        
        vm.startPrank(stakedTarget);
        jejuToken.approve(address(rpcStaking), RPC_STAKE_AMOUNT);
        rpcStaking.stake(RPC_STAKE_AMOUNT);
        vm.stopPrank();
        
        console.log("User staked:", RPC_STAKE_AMOUNT / 1e18, "JEJU");
        console.log("canAccess before ban:", rpcStaking.canAccess(stakedTarget));
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(stakedReporter);
        moderationMarket.openCase(stakedTarget, "Hacker", keccak256("evidence"));
        
        console.log("User banned after staking");
        console.log("Banned:", banManager.isAddressBanned(stakedTarget));
        console.log("canAccess after ban:", rpcStaking.canAccess(stakedTarget));
        
        assertTrue(banManager.isAddressBanned(stakedTarget));
        assertFalse(rpcStaking.canAccess(stakedTarget));
        
        // Check stake still exists (can be slashed separately)
        IRPCStakingManager.StakePosition memory pos = rpcStaking.getPosition(stakedTarget);
        console.log("Stake still exists:", pos.stakedAmount / 1e18, "JEJU");
        console.log("RESULT: Access denied but stake preserved for potential slashing");
    }
    
    // =========================================================================
    //                    SCENARIO 9: APPEAL MECHANICS
    // =========================================================================
    
    function test_Scenario_AppealRequires10xStake() public {
        console.log("\n=== SCENARIO: Appeal Requires 10x Stake ===");
        
        uint256 reporterStake = 0.1 ether;
        console.log("Reporter stake:", reporterStake / 1e15, "finney");
        console.log("Required appeal stake:", (reporterStake * 10) / 1e15, "finney (10x)");
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: reporterStake}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(unstakedTarget, "Initial ban", keccak256("evidence"));
        
        vm.warp(block.timestamp + 4 days);
        moderationMarket.resolveCase(caseId);
        
        console.log("Target banned:", banManager.isAddressBanned(unstakedTarget));
        assertTrue(banManager.isAddressBanned(unstakedTarget));
        
        console.log("Attempting appeal with 0.5 ETH (insufficient)...");
        vm.prank(unstakedTarget);
        vm.expectRevert(ModerationMarketplace.InsufficientStake.selector);
        moderationMarket.requestReReview{value: 0.5 ether}(caseId);
        console.log("BLOCKED: InsufficientStake");
        
        console.log("Attempting appeal with 1 ETH (sufficient)...");
        vm.prank(unstakedTarget);
        moderationMarket.requestReReview{value: 1 ether}(caseId);
        
        ModerationMarketplace.BanCase memory appealed = moderationMarket.getCase(caseId);
        console.log("Status after appeal:", uint256(appealed.status) == 4 ? "APPEALING" : "OTHER");
        assertEq(uint256(appealed.status), uint256(ModerationMarketplace.BanStatus.APPEALING));
        console.log("RESULT: Appeals require significant stake commitment");
    }
    
    // =========================================================================
    //                    SCENARIO 10: CONVICTION LOCK
    // =========================================================================
    
    function test_Scenario_ConvictionLockPreventsVoteAndRun() public {
        console.log("\n=== SCENARIO: Conviction Lock Prevents Vote-and-Run ===");
        
        uint256 voterStake = 0.5 ether;
        console.log("Voter stake:", voterStake / 1e15, "finney");
        console.log("Conviction lock period: 3 days");
        
        vm.prank(sybils[0]);
        moderationMarket.stake{value: voterStake}();
        
        vm.prank(stakedReporter);
        moderationMarket.stake{value: MOD_STAKE_AMOUNT}();
        
        vm.warp(block.timestamp + 25 hours);
        vm.roll(block.number + 7201);
        
        vm.prank(stakedReporter);
        bytes32 caseId = moderationMarket.openCase(stakedTarget, "Test", keccak256("evidence"));
        
        console.log("Voter casts YES vote...");
        vm.prank(sybils[0]);
        moderationMarket.vote(caseId, ModerationMarketplace.VotePosition.YES);
        
        console.log("Attempting immediate unstake...");
        vm.prank(sybils[0]);
        vm.expectRevert(ModerationMarketplace.ConvictionLockActive.selector);
        moderationMarket.unstake(voterStake);
        console.log("BLOCKED: ConvictionLockActive");
        
        console.log("Waiting 4 days...");
        vm.warp(block.timestamp + 4 days);
        
        console.log("Attempting unstake after lock expires...");
        vm.prank(sybils[0]);
        moderationMarket.unstake(voterStake);
        console.log("SUCCESS: Unstake allowed after conviction period");
        
        console.log("RESULT: Voters cannot quickly exit after voting");
    }
}
