// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/moderation/EvidenceRegistry.sol";

contract MockModerationMarketplace {
    EvidenceRegistry public evidenceRegistry;

    function setEvidenceRegistry(address _registry) external {
        evidenceRegistry = EvidenceRegistry(payable(_registry));
    }

    function registerCase(bytes32 caseId, uint256 createdAt, uint256 endsAt) external {
        evidenceRegistry.registerCase(caseId, createdAt, endsAt);
    }

    function resolveCase(bytes32 caseId, bool outcomeWasAction) external {
        evidenceRegistry.resolveCase(caseId, outcomeWasAction);
    }
}

contract MockReputationProvider {
    mapping(address => uint256) public reputations;

    function setReputation(address user, uint256 rep) external {
        reputations[user] = rep;
    }

    function getReputation(address user) external view returns (uint256) {
        return reputations[user] > 0 ? reputations[user] : 5000;
    }
}

contract EvidenceRegistryTest is Test {
    EvidenceRegistry public registry;
    MockModerationMarketplace public marketplace;
    MockReputationProvider public reputationProvider;

    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);
    address public david = address(6);

    bytes32 public constant TEST_CASE_ID = keccak256("test-case-1");
    uint256 public caseEndTime;

    event EvidenceSubmitted(
        bytes32 indexed evidenceId,
        bytes32 indexed caseId,
        address indexed submitter,
        uint256 stake,
        EvidenceRegistry.EvidencePosition position,
        string ipfsHash,
        uint256 timeWeight
    );

    event EvidenceSupported(
        bytes32 indexed evidenceId,
        address indexed supporter,
        uint256 stake,
        bool isSupporting,
        string comment,
        uint256 timeWeight
    );

    event CaseResolved(
        bytes32 indexed caseId,
        bool outcomeWasAction,
        uint256 totalForStake,
        uint256 totalAgainstStake,
        uint256 protocolFees
    );

    event RewardsClaimed(bytes32 indexed evidenceId, address indexed claimer, uint256 amount, bool wasSubmitter);

    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);

    function setUp() public {
        marketplace = new MockModerationMarketplace();
        reputationProvider = new MockReputationProvider();

        vm.prank(owner);
        registry = new EvidenceRegistry(address(marketplace), address(reputationProvider), treasury, owner);

        marketplace.setEvidenceRegistry(address(registry));

        // Register the test case (7 days voting period)
        caseEndTime = block.timestamp + 7 days;
        marketplace.registerCase(TEST_CASE_ID, block.timestamp, caseEndTime);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(david, 100 ether);

        // Set reputations
        reputationProvider.setReputation(alice, 8000);
        reputationProvider.setReputation(bob, 6000);
        reputationProvider.setReputation(charlie, 4000);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         BASIC FUNCTIONALITY TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_SubmitEvidence() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence summary", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        EvidenceRegistry.Evidence memory evidence = registry.getEvidence(evidenceId);

        assertEq(evidence.caseId, TEST_CASE_ID);
        assertEq(evidence.submitter, alice);
        assertEq(evidence.stake, 0.001 ether);
        assertEq(evidence.ipfsHash, "QmTestHash123");
        assertEq(evidence.summary, "Test evidence summary");
        assertEq(evidence.submitterReputation, 8000); // Alice's reputation
        assertEq(uint256(evidence.position), uint256(EvidenceRegistry.EvidencePosition.FOR_ACTION));
        assertEq(uint256(evidence.status), uint256(EvidenceRegistry.EvidenceStatus.ACTIVE));
        assertTrue(evidence.timeWeight >= 10000); // Base weight + time bonus
    }

    function test_SubmitEvidence_MinStakeRequired() public {
        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.InsufficientStake.selector);
        registry.submitEvidence{value: 0.0009 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SubmitEvidence_SummaryTooLong() public {
        bytes memory longSummary = new bytes(501);
        for (uint256 i = 0; i < 501; i++) {
            longSummary[i] = "a";
        }

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.SummaryTooLong.selector);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", string(longSummary), EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SubmitEvidence_CaseNotRegistered() public {
        bytes32 unknownCase = keccak256("unknown-case");

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.CaseNotRegistered.selector);
        registry.submitEvidence{value: 0.001 ether}(
            unknownCase, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SubmitEvidence_AfterVotingEnded() public {
        // Warp past voting end
        vm.warp(caseEndTime + 1);

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.VotingEnded.selector);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ANTI-GAMING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_CannotSupportOwnEvidence() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Alice tries to support her own evidence
        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.CannotSupportOwnEvidence.selector);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, true, "Self-support attempt");
    }

    function test_MaxEvidencePerCase() public {
        // Submit 50 pieces of evidence (the max)
        for (uint256 i = 0; i < 50; i++) {
            address submitter = address(uint160(100 + i));
            vm.deal(submitter, 1 ether);
            vm.prank(submitter);
            registry.submitEvidence{value: 0.001 ether}(
                TEST_CASE_ID,
                string(abi.encodePacked("QmHash", i)),
                "Evidence",
                EvidenceRegistry.EvidencePosition.FOR_ACTION
            );
        }

        // 51st should fail
        address lastSubmitter = address(uint160(200));
        vm.deal(lastSubmitter, 1 ether);
        vm.prank(lastSubmitter);
        vm.expectRevert(EvidenceRegistry.MaxEvidenceReached.selector);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash51", "Too much evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SupportEvidence_CannotSupportTwice() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, true, "First support");

        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.AlreadySupported.selector);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, false, "Second support");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         TIME WEIGHTING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_TimeWeight_EarlySubmissionGetsBonus() public {
        // Submit at start (7 days remaining = 168 hours)
        vm.prank(alice);
        bytes32 earlyEvidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmEarlyHash", "Early evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        EvidenceRegistry.Evidence memory earlyEvidence = registry.getEvidence(earlyEvidenceId);

        // Max time bonus is 72% (7200 BPS), so weight should be ~17200
        assertGe(earlyEvidence.timeWeight, 17000);
        assertLe(earlyEvidence.timeWeight, 17200);
    }

    function test_TimeWeight_LateSubmissionLowerWeight() public {
        // Warp to 1 hour before end
        vm.warp(caseEndTime - 1 hours);

        vm.prank(alice);
        bytes32 lateEvidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmLateHash", "Late evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        EvidenceRegistry.Evidence memory lateEvidence = registry.getEvidence(lateEvidenceId);

        // 1 hour remaining = 100 BPS bonus
        assertEq(lateEvidence.timeWeight, 10100);
    }

    function test_TimeWeight_AffectsEffectiveStake() public {
        // Early submission
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmEarlyHash", "Early evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Check case totals reflect time-weighted stake
        (, uint256 totalFor,,) = registry.getCaseEvidence(TEST_CASE_ID);

        // 0.001 ether with ~172% weight = ~0.00172 ether
        assertGe(totalFor, 0.0017 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         SUPPORT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_SupportEvidence_Basic() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, true, "I agree with this evidence");

        EvidenceRegistry.Evidence memory evidence = registry.getEvidence(evidenceId);
        assertEq(evidence.supportStake, 0.0005 ether);
        assertEq(evidence.supporterCount, 1);

        vm.prank(charlie);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, false, "I disagree");

        evidence = registry.getEvidence(evidenceId);
        assertEq(evidence.opposeStake, 0.0005 ether);
        assertEq(evidence.opposerCount, 1);
    }

    function test_SupportEvidence_MinStakeRequired() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmTestHash123", "Test evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.InsufficientStake.selector);
        registry.supportEvidence{value: 0.0004 ether}(evidenceId, true, "");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         RESOLUTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ResolveCase_ForAction() public {
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        bytes32 evidenceIdAgainst = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against action", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, true);

        EvidenceRegistry.Evidence memory evidenceFor = registry.getEvidence(evidenceIdFor);
        EvidenceRegistry.Evidence memory evidenceAgainst = registry.getEvidence(evidenceIdAgainst);

        assertEq(uint256(evidenceFor.status), uint256(EvidenceRegistry.EvidenceStatus.REWARDED));
        assertEq(uint256(evidenceAgainst.status), uint256(EvidenceRegistry.EvidenceStatus.SLASHED));
    }

    function test_ResolveCase_AgainstAction() public {
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        bytes32 evidenceIdAgainst = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against action", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, false);

        EvidenceRegistry.Evidence memory evidenceFor = registry.getEvidence(evidenceIdFor);
        EvidenceRegistry.Evidence memory evidenceAgainst = registry.getEvidence(evidenceIdAgainst);

        assertEq(uint256(evidenceFor.status), uint256(EvidenceRegistry.EvidenceStatus.SLASHED));
        assertEq(uint256(evidenceAgainst.status), uint256(EvidenceRegistry.EvidenceStatus.REWARDED));
    }

    function test_ResolveCase_CollectsProtocolFees() public {
        vm.prank(alice);
        registry.submitEvidence{value: 0.1 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.05 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against action", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, true);

        // Total pot = 0.15 ether, protocol fee = 5% = 0.0075 ether
        uint256 protocolFees = registry.totalProtocolFees();
        assertGe(protocolFees, 0.007 ether);
    }

    function test_OnlyMarketplaceCanResolve() public {
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.NotAuthorized.selector);
        registry.resolveCase(TEST_CASE_ID, true);
    }

    function test_CannotResolveUnregisteredCase() public {
        bytes32 unknownCase = keccak256("unknown");

        vm.expectRevert(EvidenceRegistry.CaseNotRegistered.selector);
        marketplace.resolveCase(unknownCase, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM REWARDS TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ClaimRewards_SubmitterWinner() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, true);

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        registry.claimRewards(evidenceId);

        uint256 aliceBalanceAfter = alice.balance;

        // Alice should get back more than her stake
        assertTrue(aliceBalanceAfter > aliceBalanceBefore);
        assertTrue(aliceBalanceAfter - aliceBalanceBefore > 0.002 ether);
    }

    function test_ClaimRewards_SubmitterLoser() public {
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        // Action NOT taken - Alice loses
        marketplace.resolveCase(TEST_CASE_ID, false);

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.NothingToClaim.selector);
        registry.claimRewards(evidenceIdFor);
    }

    function test_ClaimRewards_SupporterWinner() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Bob supports Alice's evidence
        vm.prank(bob);
        registry.supportEvidence{value: 0.001 ether}(evidenceId, true, "Agree");

        // Charlie opposes (will lose)
        vm.prank(charlie);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, false, "Disagree");

        marketplace.resolveCase(TEST_CASE_ID, true);

        uint256 bobBalanceBefore = bob.balance;

        vm.prank(bob);
        registry.claimRewards(evidenceId);

        uint256 bobBalanceAfter = bob.balance;

        // Bob should get back more than his stake
        assertTrue(bobBalanceAfter > bobBalanceBefore);
    }

    function test_ClaimRewards_SupporterOpposedAndWon() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Charlie opposes the FOR_ACTION evidence (betting it's wrong)
        vm.prank(charlie);
        registry.supportEvidence{value: 0.001 ether}(evidenceId, false, "Disagree");

        // Action NOT taken - Charlie was right to oppose
        marketplace.resolveCase(TEST_CASE_ID, false);

        uint256 charlieBalanceBefore = charlie.balance;

        vm.prank(charlie);
        registry.claimRewards(evidenceId);

        uint256 charlieBalanceAfter = charlie.balance;

        // Charlie should get rewards for correctly opposing
        assertTrue(charlieBalanceAfter > charlieBalanceBefore);
    }

    function test_ClaimRewards_CannotClaimTwice() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, true);

        vm.prank(alice);
        registry.claimRewards(evidenceId);

        // Try to claim again
        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.NothingToClaim.selector);
        registry.claimRewards(evidenceId);
    }

    function test_ClaimRewards_CannotClaimBeforeResolution() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.CaseNotResolved.selector);
        registry.claimRewards(evidenceId);
    }

    function test_BatchClaimRewards() public {
        // Create second case
        bytes32 caseId2 = keccak256("test-case-2");
        marketplace.registerCase(caseId2, block.timestamp, block.timestamp + 7 days);

        // Alice submits to both cases
        vm.startPrank(alice);
        bytes32 evidenceId1 = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence 1", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
        bytes32 evidenceId2 = registry.submitEvidence{value: 0.003 ether}(
            caseId2, "QmHash2", "Evidence 2", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
        vm.stopPrank();

        // Resolve both cases
        marketplace.resolveCase(TEST_CASE_ID, true);
        marketplace.resolveCase(caseId2, true);

        bytes32[] memory evidenceIds = new bytes32[](2);
        evidenceIds[0] = evidenceId1;
        evidenceIds[1] = evidenceId2;

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        registry.batchClaimRewards(evidenceIds);

        uint256 aliceBalanceAfter = alice.balance;

        // Should have claimed from both
        assertTrue(aliceBalanceAfter > aliceBalanceBefore);
        assertTrue(aliceBalanceAfter - aliceBalanceBefore >= 0.005 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PROTOCOL FEES TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_WithdrawProtocolFees() public {
        vm.prank(alice);
        registry.submitEvidence{value: 1 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence for action", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.5 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence against action", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        marketplace.resolveCase(TEST_CASE_ID, true);

        uint256 treasuryBalanceBefore = treasury.balance;
        uint256 fees = registry.totalProtocolFees();
        assertTrue(fees > 0);

        vm.prank(owner);
        registry.withdrawProtocolFees();

        assertEq(registry.totalProtocolFees(), 0);
        assertEq(treasury.balance - treasuryBalanceBefore, fees);
    }

    function test_WithdrawProtocolFees_NothingToClaim() public {
        vm.prank(owner);
        vm.expectRevert(EvidenceRegistry.NothingToClaim.selector);
        registry.withdrawProtocolFees();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_GetCaseEvidence() public {
        vm.warp(caseEndTime - 1 hours); // Near end to minimize time weight

        vm.prank(alice);
        registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence 1", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.003 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence 2", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        (bytes32[] memory evidenceIds, uint256 totalFor, uint256 totalAgainst, bool resolved) =
            registry.getCaseEvidence(TEST_CASE_ID);

        assertEq(evidenceIds.length, 2);
        assertGe(totalFor, 0.002 ether);
        assertGe(totalAgainst, 0.003 ether);
        assertFalse(resolved);
    }

    function test_GetUserEvidence() public {
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence 1", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(alice);
        registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash2", "Evidence 2", EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        bytes32[] memory aliceEvidence = registry.getUserEvidence(alice);
        assertEq(aliceEvidence.length, 2);
    }

    function test_IsCaseActive() public {
        assertTrue(registry.isCaseActive(TEST_CASE_ID));

        marketplace.resolveCase(TEST_CASE_ID, true);
        assertFalse(registry.isCaseActive(TEST_CASE_ID));
    }

    function test_GetClaimableAmount() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Before resolution
        uint256 claimable = registry.getClaimableAmount(evidenceId, alice);
        assertEq(claimable, 0);

        marketplace.resolveCase(TEST_CASE_ID, true);

        // After resolution
        claimable = registry.getClaimableAmount(evidenceId, alice);
        assertTrue(claimable >= 0.002 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_AdminFunctions() public {
        address newMarketplace = address(100);
        address newReputationProvider = address(101);
        address newTreasury = address(102);

        vm.startPrank(owner);

        registry.setModerationMarketplace(newMarketplace);
        assertEq(registry.moderationMarketplace(), newMarketplace);

        registry.setReputationProvider(newReputationProvider);
        assertEq(registry.reputationProvider(), newReputationProvider);

        registry.setTreasury(newTreasury);
        assertEq(registry.treasury(), newTreasury);

        vm.stopPrank();
    }

    function test_SetTreasury_InvalidAddress() public {
        vm.prank(owner);
        vm.expectRevert(EvidenceRegistry.InvalidAddress.selector);
        registry.setTreasury(address(0));
    }

    function test_Pause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(owner);
        registry.unpause();

        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID, "QmHash1", "Evidence", EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_Version() public view {
        assertEq(registry.version(), "2.0.0");
    }
}
