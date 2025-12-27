// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/registry/ReputationProviderRegistry.sol";

contract MockReputationProvider {
    mapping(uint256 => uint256) public scores;

    function setScore(uint256 agentId, uint256 score) external {
        scores[agentId] = score;
    }

    function getReputationScore(uint256 agentId) external view returns (uint256) {
        return scores[agentId] > 0 ? scores[agentId] : 5000;
    }
}

contract MockCouncilGovernance {
    ReputationProviderRegistry public registry;

    function setRegistry(address _registry) external {
        registry = ReputationProviderRegistry(payable(_registry));
    }

    function submitDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, string calldata reason) external {
        registry.submitCouncilDecision(proposalId, approved, decisionHash, reason);
    }
}

contract ReputationProviderRegistryTest is Test {
    ReputationProviderRegistry public registry;
    MockCouncilGovernance public council;
    MockReputationProvider public provider1;
    MockReputationProvider public provider2;
    MockReputationProvider public provider3;

    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);
    address public david = address(6);
    address public eve = address(7);

    event ProviderAdded(address indexed provider, string name, uint256 weight);
    event ProposalCreated(
        bytes32 indexed proposalId,
        ReputationProviderRegistry.ProposalType proposalType,
        address indexed targetProvider,
        address indexed proposer,
        uint256 stake
    );
    event ProposalVoted(bytes32 indexed proposalId, address indexed voter, bool inFavor, uint256 stake);
    event CouncilDecision(bytes32 indexed proposalId, bool approved, bytes32 decisionHash, string reason);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed proposer, uint256 penaltyAmount);

    function setUp() public {
        council = new MockCouncilGovernance();
        provider1 = new MockReputationProvider();
        provider2 = new MockReputationProvider();
        provider3 = new MockReputationProvider();

        vm.prank(owner);
        registry = new ReputationProviderRegistry(address(council), treasury, owner);

        council.setRegistry(address(registry));

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(david, 100 ether);
        vm.deal(eve, 100 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INITIALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_InitializeProvider() public {
        vm.prank(owner);
        registry.initializeProvider(
            address(provider1), "GitHub Reputation", "Reputation based on GitHub activity", 5000
        );

        ReputationProviderRegistry.ReputationProvider memory p = registry.getProvider(address(provider1));

        assertEq(p.providerContract, address(provider1));
        assertEq(p.name, "GitHub Reputation");
        assertEq(p.weight, 5000);
        assertTrue(p.isActive);
        assertFalse(p.isSuspended);
        assertEq(registry.activeProviderCount(), 1);
        assertEq(registry.totalWeight(), 5000);
    }

    function test_InitializeProvider_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.initializeProvider(address(provider1), "Test Provider", "Description", 5000);
    }

    function test_InitializeProvider_InvalidWeight() public {
        vm.prank(owner);
        vm.expectRevert(ReputationProviderRegistry.InvalidWeight.selector);
        registry.initializeProvider(
            address(provider1),
            "Test Provider",
            "Description",
            10001 // > MAX_WEIGHT
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PROPOSAL CREATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ProposeAddProvider() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1), "New Provider", "A new reputation provider", 3000
        );

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);

        assertEq(uint256(p.proposalType), uint256(ReputationProviderRegistry.ProposalType.ADD_PROVIDER));
        assertEq(p.targetProvider, address(provider1));
        assertEq(p.proposer, alice);
        assertEq(p.stake, 0.01 ether);
        assertEq(p.forStake, 0); // Proposer stake tracked separately
        assertEq(p.proposedWeight, 3000);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.PENDING));
    }

    function test_ProposeAddProvider_MinStakeRequired() public {
        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.InsufficientStake.selector);
        registry.proposeAddProvider{value: 0.009 ether}(address(provider1), "New Provider", "Description", 3000);
    }

    function test_ProposeAddProvider_ProviderAlreadyExists() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.ProviderExists.selector);
        registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "Duplicate", "Description", 3000);
    }

    function test_ProposeRemoveProvider() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        bytes32 proposalId = registry.proposeRemoveProvider{value: 0.01 ether}(address(provider1));

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.proposalType), uint256(ReputationProviderRegistry.ProposalType.REMOVE_PROVIDER));
        assertEq(p.targetProvider, address(provider1));
    }

    function test_ProposeUpdateWeight() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        bytes32 proposalId = registry.proposeUpdateWeight{value: 0.01 ether}(address(provider1), 7000);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.proposalType), uint256(ReputationProviderRegistry.ProposalType.UPDATE_WEIGHT));
        assertEq(p.proposedWeight, 7000);
    }

    function test_ProposeSuspendProvider() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        bytes32 proposalId = registry.proposeSuspendProvider{value: 0.01 ether}(address(provider1));

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.proposalType), uint256(ReputationProviderRegistry.ProposalType.SUSPEND_PROVIDER));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VOTING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_VoteOnProposal() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Bob votes in favor
        vm.prank(bob);
        registry.vote{value: 0.002 ether}(proposalId, true);

        // Charlie votes against
        vm.prank(charlie);
        registry.vote{value: 0.001 ether}(proposalId, false);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);

        assertEq(p.forStake, 0.002 ether); // Only bob's vote (proposer stake separate)
        assertEq(p.againstStake, 0.001 ether); // charlie
        assertEq(p.forCount, 1);
        assertEq(p.againstCount, 1);
    }

    function test_VoteOnProposal_MinStakeRequired() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.InsufficientStake.selector);
        registry.vote{value: 0.0009 ether}(proposalId, true);
    }

    function test_CannotVoteTwice() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.vote{value: 0.001 ether}(proposalId, true);

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.AlreadyVoted.selector);
        registry.vote{value: 0.001 ether}(proposalId, false);
    }

    function test_ProposerCannotVote() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.AlreadyVoted.selector);
        registry.vote{value: 0.001 ether}(proposalId, true);
    }

    function test_CannotVoteAfterChallengePeriod() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.warp(block.timestamp + 8 days);

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.ChallengePeriodEnded.selector);
        registry.vote{value: 0.001 ether}(proposalId, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         OPINION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_AddOpinion() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.addOpinion{value: 0.0005 ether}(
            proposalId, true, "QmOpinionHash", "I support this provider because..."
        );

        ReputationProviderRegistry.Opinion[] memory opinions = registry.getProposalOpinions(proposalId);

        assertEq(opinions.length, 1);
        assertEq(opinions[0].author, bob);
        assertEq(opinions[0].stake, 0.0005 ether);
        assertTrue(opinions[0].inFavor);
        assertFalse(opinions[0].claimed);

        // Opinions add to vote totals
        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(p.forStake, 0.0005 ether);
    }

    function test_AddOpinion_CannotOpineTwice() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.addOpinion{value: 0.0005 ether}(proposalId, true, "QmHash1", "First opinion");

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.AlreadyOpined.selector);
        registry.addOpinion{value: 0.0005 ether}(proposalId, false, "QmHash2", "Second opinion");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         QUORUM TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_QuorumRequired_MinStake() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Only one small vote - not enough stake for quorum (needs 0.1 ETH)
        vm.prank(bob);
        registry.vote{value: 0.001 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);

        // Advance should auto-reject due to quorum
        registry.advanceToCouncilReview(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.REJECTED));
    }

    function test_QuorumRequired_MinVoters() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // One large vote but only 1 voter - needs 3
        vm.prank(bob);
        registry.vote{value: 0.15 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);

        // Advance should auto-reject due to quorum
        registry.advanceToCouncilReview(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.REJECTED));
    }

    function test_QuorumMet() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // 3 voters with > 0.1 ETH total
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);

        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.COUNCIL_REVIEW));
    }

    function test_IsQuorumReached() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        (bool reached,,) = registry.isQuorumReached(proposalId);
        assertFalse(reached);

        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        (reached,,) = registry.isQuorumReached(proposalId);
        assertTrue(reached);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PROPOSAL CANCELLATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_CancelProposal() public {
        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        uint256 aliceBalanceAfterProposal = alice.balance;
        assertEq(aliceBalanceBefore - aliceBalanceAfterProposal, 0.01 ether);

        vm.prank(alice);
        registry.cancelProposal(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.CANCELLED));

        // Alice gets 50% back (50% penalty)
        uint256 aliceBalanceAfterCancel = alice.balance;
        assertEq(aliceBalanceAfterCancel - aliceBalanceAfterProposal, 0.005 ether);
    }

    function test_CancelProposal_OnlyProposer() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.NotProposer.selector);
        registry.cancelProposal(proposalId);
    }

    function test_CancelProposal_CannotCancelAfterReview() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Add enough votes for quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.CannotCancelAfterReview.selector);
        registry.cancelProposal(proposalId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         COUNCIL DECISION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_AdvanceToCouncilReview() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        // Cannot advance before challenge period ends
        vm.expectRevert(ReputationProviderRegistry.ChallengePeriodActive.selector);
        registry.advanceToCouncilReview(proposalId);

        // Skip challenge period (7 days)
        vm.warp(block.timestamp + 8 days);

        // Now can advance
        registry.advanceToCouncilReview(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.COUNCIL_REVIEW));
    }

    function test_CouncilApproval() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1), "New Provider", "A great new provider", 3000
        );

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        // Council approves
        council.submitDecision(proposalId, true, keccak256("decision-reasoning"), "Approved after careful review");

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.APPROVED));
        assertTrue(p.timelockEnds > block.timestamp);
    }

    function test_CouncilRejection() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        council.submitDecision(proposalId, false, keccak256("rejection-reasoning"), "Does not meet quality standards");

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint256(p.status), uint256(ReputationProviderRegistry.ProposalStatus.REJECTED));
    }

    function test_OnlyCouncilCanDecide() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        // Random address tries to decide
        vm.prank(eve);
        vm.expectRevert(ReputationProviderRegistry.NotAuthorized.selector);
        registry.submitCouncilDecision(proposalId, true, keccak256("fake"), "Fake approval");

        // Even owner cannot bypass
        vm.prank(owner);
        vm.expectRevert(ReputationProviderRegistry.NotAuthorized.selector);
        registry.submitCouncilDecision(proposalId, true, keccak256("fake"), "Owner bypass");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         EXECUTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ExecuteApprovedProposal() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");

        // Cannot execute before timelock
        vm.expectRevert(ReputationProviderRegistry.TimelockNotComplete.selector);
        registry.executeProposal(proposalId);

        // Skip timelock (2 days)
        vm.warp(block.timestamp + 3 days);

        // Execute
        registry.executeProposal(proposalId);

        // Provider should now be active
        ReputationProviderRegistry.ReputationProvider memory provider = registry.getProvider(address(provider1));
        assertTrue(provider.isActive);
        assertEq(provider.weight, 3000);
        assertEq(registry.activeProviderCount(), 1);
    }

    function test_ExecuteRemoveProvider() public {
        // First add provider
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        assertEq(registry.activeProviderCount(), 1);
        assertEq(registry.totalWeight(), 5000);

        // Propose removal
        vm.prank(alice);
        bytes32 proposalId = registry.proposeRemoveProvider{value: 0.01 ether}(address(provider1));

        // Meet quorum
        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.03 ether}(proposalId, true);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Remove");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        ReputationProviderRegistry.ReputationProvider memory provider = registry.getProvider(address(provider1));
        assertFalse(provider.isActive);
        assertEq(registry.activeProviderCount(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM REWARDS TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ClaimRewards_ProposerWins() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.05 ether}(address(provider1), "New Provider", "Description", 3000);

        // Add votes to meet quorum (0.1 ether from voters, 3 voters)
        vm.prank(bob);
        registry.vote{value: 0.04 ether}(proposalId, true);

        vm.prank(charlie);
        registry.vote{value: 0.04 ether}(proposalId, true);

        // Dave votes against (will lose)
        vm.prank(david);
        registry.vote{value: 0.04 ether}(proposalId, false);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        registry.claimRewards(proposalId);

        uint256 aliceBalanceAfter = alice.balance;
        // Alice should get back more than her stake
        assertTrue(aliceBalanceAfter > aliceBalanceBefore);
        assertTrue(aliceBalanceAfter - aliceBalanceBefore > 0.05 ether);
    }

    function test_ClaimRewards_VoterWins() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.05 ether}(address(provider1), "New Provider", "Description", 3000);

        // Add votes to meet quorum (0.1 ether from voters, 3 voters)
        vm.prank(bob);
        registry.vote{value: 0.04 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.04 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.04 ether}(proposalId, false);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        uint256 bobBalanceBefore = bob.balance;

        vm.prank(bob);
        registry.claimRewards(proposalId);

        assertTrue(bob.balance > bobBalanceBefore);
    }

    function test_ClaimRewards_VoterLoses() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.02 ether}(proposalId, false);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        // David voted against but proposal passed
        vm.prank(david);
        vm.expectRevert(ReputationProviderRegistry.NothingToClaim.selector);
        registry.claimRewards(proposalId);
    }

    function test_ClaimRewards_OpinionStakeClaimed() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.05 ether}(address(provider1), "New Provider", "Description", 3000);

        // Add votes to meet quorum (0.1 ether from voters, 3 voters)
        vm.prank(bob);
        registry.vote{value: 0.04 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.04 ether}(proposalId, true);
        vm.prank(eve);
        registry.vote{value: 0.04 ether}(proposalId, true);

        // Dave adds supporting opinion
        vm.prank(david);
        registry.addOpinion{value: 0.01 ether}(proposalId, true, "QmHash", "Great idea");

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        uint256 davidBalanceBefore = david.balance;

        vm.prank(david);
        registry.claimRewards(proposalId);

        // David should get his opinion stake back + rewards
        assertTrue(david.balance > davidBalanceBefore);
        assertTrue(david.balance - davidBalanceBefore >= 0.01 ether);
    }

    function test_GetClaimableAmount() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.02 ether}(proposalId, false);

        // Before resolution
        uint256 claimable = registry.getClaimableAmount(proposalId, alice);
        assertEq(claimable, 0);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        // After execution
        claimable = registry.getClaimableAmount(proposalId, alice);
        assertTrue(claimable > 0.01 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_GetAggregatedReputation() public {
        // Initialize two providers
        vm.startPrank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 6000);
        registry.initializeProvider(address(provider2), "Provider 2", "Desc", 4000);
        vm.stopPrank();

        // Set scores for agent 1
        provider1.setScore(1, 8000); // 80%
        provider2.setScore(1, 6000); // 60%

        (uint256 weightedScore, uint256[] memory scores, uint256[] memory weights) = registry.getAggregatedReputation(1);

        // Expected: (8000 * 6000/10000 + 6000 * 4000/10000) = 4800 + 2400 = 7200
        assertEq(weightedScore, 7200);
        assertEq(scores.length, 2);
        assertEq(weights.length, 2);
    }

    function test_GetAggregatedReputation_NormalizedWeights() public {
        // Initialize provider with weight 3000 (not full 10000)
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 3000);

        provider1.setScore(1, 8000);

        (uint256 weightedScore,,) = registry.getAggregatedReputation(1);

        // With only one provider, normalized weight is 10000/10000 = 100%
        // So score should be 8000
        assertEq(weightedScore, 8000);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Pause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(owner);
        registry.unpause();

        // Should work now
        vm.prank(alice);
        registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "New Provider", "Description", 3000);
    }

    function test_SetCouncilGovernance() public {
        address newCouncil = address(100);

        vm.prank(owner);
        registry.setCouncilGovernance(newCouncil);

        assertEq(registry.councilGovernance(), newCouncil);
    }

    function test_SetTreasury() public {
        address newTreasury = address(101);

        vm.prank(owner);
        registry.setTreasury(newTreasury);

        assertEq(registry.treasury(), newTreasury);
    }

    function test_SetTreasury_InvalidAddress() public {
        vm.prank(owner);
        vm.expectRevert(ReputationProviderRegistry.InvalidAddress.selector);
        registry.setTreasury(address(0));
    }

    function test_WithdrawProtocolFees() public {
        vm.prank(alice);
        bytes32 proposalId =
            registry.proposeAddProvider{value: 0.1 ether}(address(provider1), "New Provider", "Description", 3000);

        vm.prank(bob);
        registry.vote{value: 0.05 ether}(proposalId, true);
        vm.prank(charlie);
        registry.vote{value: 0.03 ether}(proposalId, true);
        vm.prank(david);
        registry.vote{value: 0.02 ether}(proposalId, false);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        // Have winners claim to accumulate fees
        vm.prank(alice);
        registry.claimRewards(proposalId);

        uint256 fees = registry.totalProtocolFees();
        if (fees > 0) {
            uint256 treasuryBefore = treasury.balance;

            vm.prank(owner);
            registry.withdrawProtocolFees();

            assertEq(registry.totalProtocolFees(), 0);
            assertEq(treasury.balance - treasuryBefore, fees);
        }
    }

    function test_GetAllProposals() public {
        vm.prank(alice);
        registry.proposeAddProvider{value: 0.01 ether}(address(provider1), "Provider 1", "Description", 3000);

        vm.prank(bob);
        registry.proposeAddProvider{value: 0.01 ether}(address(provider2), "Provider 2", "Description", 4000);

        bytes32[] memory allProposals = registry.getAllProposals();
        assertEq(allProposals.length, 2);
    }

    function test_Version() public view {
        assertEq(registry.version(), "2.0.0");
    }
}
