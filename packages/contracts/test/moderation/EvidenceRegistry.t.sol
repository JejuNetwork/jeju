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

contract EvidenceRegistryTest is Test {
    EvidenceRegistry public registry;
    MockModerationMarketplace public marketplace;

    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);

    bytes32 public constant TEST_CASE_ID = keccak256("test-case-1");

    event EvidenceSubmitted(
        bytes32 indexed evidenceId,
        bytes32 indexed caseId,
        address indexed submitter,
        uint256 stake,
        EvidenceRegistry.EvidencePosition position,
        string ipfsHash
    );

    event EvidenceSupported(
        bytes32 indexed evidenceId,
        address indexed supporter,
        uint256 stake,
        bool isSupporting,
        string comment
    );

    event CaseResolved(
        bytes32 indexed caseId,
        bool outcomeWasAction,
        uint256 totalForStake,
        uint256 totalAgainstStake
    );

    event RewardsClaimed(
        bytes32 indexed evidenceId,
        address indexed claimer,
        uint256 amount
    );

    function setUp() public {
        marketplace = new MockModerationMarketplace();
        
        vm.prank(owner);
        registry = new EvidenceRegistry(
            address(marketplace),
            address(0), // No reputation provider
            treasury,
            owner
        );

        marketplace.setEvidenceRegistry(address(registry));

        // Register the test case
        marketplace.registerCase(TEST_CASE_ID, block.timestamp, block.timestamp + 7 days);

        // Fund test accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);
    }

    function test_SubmitEvidence() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmTestHash123",
            "Test evidence summary",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        EvidenceRegistry.Evidence memory evidence = registry.getEvidence(evidenceId);
        
        assertEq(evidence.caseId, TEST_CASE_ID);
        assertEq(evidence.submitter, alice);
        assertEq(evidence.stake, 0.001 ether);
        assertEq(evidence.ipfsHash, "QmTestHash123");
        assertEq(evidence.summary, "Test evidence summary");
        assertEq(uint(evidence.position), uint(EvidenceRegistry.EvidencePosition.FOR_ACTION));
        assertEq(uint(evidence.status), uint(EvidenceRegistry.EvidenceStatus.ACTIVE));
    }

    function test_SubmitEvidence_MinStakeRequired() public {
        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.InsufficientStake.selector);
        registry.submitEvidence{value: 0.0009 ether}(
            TEST_CASE_ID,
            "QmTestHash123",
            "Test evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SubmitEvidence_SummaryTooLong() public {
        // Create a string longer than 500 chars
        bytes memory longSummary = new bytes(501);
        for (uint i = 0; i < 501; i++) {
            longSummary[i] = "a";
        }

        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.SummaryTooLong.selector);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmTestHash123",
            string(longSummary),
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_SupportEvidence() public {
        // Alice submits evidence
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmTestHash123",
            "Test evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Bob supports the evidence
        vm.prank(bob);
        registry.supportEvidence{value: 0.0005 ether}(
            evidenceId,
            true,
            "I agree with this evidence"
        );

        EvidenceRegistry.Evidence memory evidence = registry.getEvidence(evidenceId);
        assertEq(evidence.supportStake, 0.0005 ether);
        assertEq(evidence.supporterCount, 1);

        // Charlie opposes the evidence
        vm.prank(charlie);
        registry.supportEvidence{value: 0.0005 ether}(
            evidenceId,
            false,
            "I disagree"
        );

        evidence = registry.getEvidence(evidenceId);
        assertEq(evidence.opposeStake, 0.0005 ether);
        assertEq(evidence.opposerCount, 1);
    }

    function test_SupportEvidence_CannotSupportTwice() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmTestHash123",
            "Test evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, true, "First support");

        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.AlreadySupported.selector);
        registry.supportEvidence{value: 0.0005 ether}(evidenceId, false, "Second support");
    }

    function test_GetCaseEvidence() public {
        // Warp to near end of voting period to avoid time weight bonus
        vm.warp(block.timestamp + 6 days + 23 hours);
        
        // Submit multiple pieces of evidence
        vm.prank(alice);
        registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence 1",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(bob);
        registry.submitEvidence{value: 0.003 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Evidence 2",
            EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        (bytes32[] memory evidenceIds, uint256 totalFor, uint256 totalAgainst, bool resolved) = 
            registry.getCaseEvidence(TEST_CASE_ID);

        assertEq(evidenceIds.length, 2);
        // Time weight with ~1 hour remaining is ~10000 + 100 = 10100 BPS
        // 0.002 * 10100 / 10000 = ~0.00202 ether (approximately equal)
        assertGe(totalFor, 0.002 ether);
        assertLe(totalFor, 0.00205 ether);
        assertGe(totalAgainst, 0.003 ether);
        assertLe(totalAgainst, 0.00305 ether);
        assertFalse(resolved);
    }

    function test_ResolveCase_ForAction() public {
        // Submit evidence FOR action
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence for action",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Submit evidence AGAINST action
        vm.prank(bob);
        bytes32 evidenceIdAgainst = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Evidence against action",
            EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        // Resolve case - action was taken
        marketplace.resolveCase(TEST_CASE_ID, true);

        // Check evidence statuses
        EvidenceRegistry.Evidence memory evidenceFor = registry.getEvidence(evidenceIdFor);
        EvidenceRegistry.Evidence memory evidenceAgainst = registry.getEvidence(evidenceIdAgainst);

        assertEq(uint(evidenceFor.status), uint(EvidenceRegistry.EvidenceStatus.REWARDED));
        assertEq(uint(evidenceAgainst.status), uint(EvidenceRegistry.EvidenceStatus.SLASHED));
    }

    function test_ResolveCase_AgainstAction() public {
        // Submit evidence FOR action
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence for action",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Submit evidence AGAINST action
        vm.prank(bob);
        bytes32 evidenceIdAgainst = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Evidence against action",
            EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        // Resolve case - action was NOT taken
        marketplace.resolveCase(TEST_CASE_ID, false);

        // Check evidence statuses
        EvidenceRegistry.Evidence memory evidenceFor = registry.getEvidence(evidenceIdFor);
        EvidenceRegistry.Evidence memory evidenceAgainst = registry.getEvidence(evidenceIdAgainst);

        assertEq(uint(evidenceFor.status), uint(EvidenceRegistry.EvidenceStatus.SLASHED));
        assertEq(uint(evidenceAgainst.status), uint(EvidenceRegistry.EvidenceStatus.REWARDED));
    }

    function test_ClaimRewards_Winner() public {
        // Alice submits evidence FOR action
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence for action",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Bob submits evidence AGAINST action (will lose)
        vm.prank(bob);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Evidence against",
            EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        // Resolve case - action taken, Alice wins
        marketplace.resolveCase(TEST_CASE_ID, true);

        uint256 aliceBalanceBefore = alice.balance;

        // Alice claims rewards
        vm.prank(alice);
        registry.claimRewards(evidenceId);

        uint256 aliceBalanceAfter = alice.balance;
        
        // Alice should get back more than her stake
        assertTrue(aliceBalanceAfter > aliceBalanceBefore);
    }

    function test_ClaimRewards_Loser() public {
        // Alice submits evidence FOR action
        vm.prank(alice);
        bytes32 evidenceIdFor = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence for action",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Bob submits evidence AGAINST action (will win)
        vm.prank(bob);
        bytes32 evidenceIdAgainst = registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Evidence against",
            EvidenceRegistry.EvidencePosition.AGAINST_ACTION
        );

        // Resolve case - action NOT taken, Bob wins, Alice loses
        marketplace.resolveCase(TEST_CASE_ID, false);

        // Alice tries to claim - should get nothing
        vm.prank(alice);
        vm.expectRevert(EvidenceRegistry.NothingToClaim.selector);
        registry.claimRewards(evidenceIdFor);
    }

    function test_CannotSubmitToResolvedCase() public {
        // Submit initial evidence
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Initial evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Resolve the case
        marketplace.resolveCase(TEST_CASE_ID, true);

        // Try to submit more evidence
        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.CaseAlreadyResolved.selector);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash2",
            "Late evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }

    function test_OnlyMarketplaceCanResolve() public {
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Random address tries to resolve
        vm.prank(bob);
        vm.expectRevert(EvidenceRegistry.NotAuthorized.selector);
        registry.resolveCase(TEST_CASE_ID, true);
    }

    function test_GetClaimableAmount() public {
        vm.prank(alice);
        bytes32 evidenceId = registry.submitEvidence{value: 0.002 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        // Before resolution, should be 0
        uint256 claimable = registry.getClaimableAmount(evidenceId, alice);
        assertEq(claimable, 0);

        // Resolve
        marketplace.resolveCase(TEST_CASE_ID, true);

        // After resolution (winner), should have claimable amount
        claimable = registry.getClaimableAmount(evidenceId, alice);
        assertTrue(claimable >= 0.002 ether); // At least get stake back
    }

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

    function test_Pause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );

        vm.prank(owner);
        registry.unpause();

        // Should work now
        vm.prank(alice);
        registry.submitEvidence{value: 0.001 ether}(
            TEST_CASE_ID,
            "QmHash1",
            "Evidence",
            EvidenceRegistry.EvidencePosition.FOR_ACTION
        );
    }
}

