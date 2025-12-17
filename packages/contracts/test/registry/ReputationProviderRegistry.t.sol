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

    function submitDecision(
        bytes32 proposalId,
        bool approved,
        bytes32 decisionHash,
        string calldata reason
    ) external {
        registry.submitCouncilDecision(proposalId, approved, decisionHash, reason);
    }
}

contract ReputationProviderRegistryTest is Test {
    ReputationProviderRegistry public registry;
    MockCouncilGovernance public council;
    MockReputationProvider public provider1;
    MockReputationProvider public provider2;

    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);

    event ProviderAdded(address indexed provider, string name, uint256 weight);
    event ProposalCreated(
        bytes32 indexed proposalId,
        ReputationProviderRegistry.ProposalType proposalType,
        address indexed targetProvider,
        address indexed proposer,
        uint256 stake
    );
    event ProposalVoted(
        bytes32 indexed proposalId,
        address indexed voter,
        bool inFavor,
        uint256 stake
    );
    event CouncilDecision(
        bytes32 indexed proposalId,
        bool approved,
        bytes32 decisionHash,
        string reason
    );

    function setUp() public {
        council = new MockCouncilGovernance();
        provider1 = new MockReputationProvider();
        provider2 = new MockReputationProvider();

        vm.prank(owner);
        registry = new ReputationProviderRegistry(
            address(council),
            treasury,
            owner
        );

        council.setRegistry(address(registry));

        // Fund test accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);
    }

    function test_InitializeProvider() public {
        vm.prank(owner);
        registry.initializeProvider(
            address(provider1),
            "GitHub Reputation",
            "Reputation based on GitHub activity",
            5000
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

    function test_ProposeAddProvider() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "A new reputation provider",
            3000
        );

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        
        assertEq(uint(p.proposalType), uint(ReputationProviderRegistry.ProposalType.ADD_PROVIDER));
        assertEq(p.targetProvider, address(provider1));
        assertEq(p.proposer, alice);
        assertEq(p.stake, 0.001 ether);
        assertEq(p.forStake, 0.001 ether);
        assertEq(p.proposedWeight, 3000);
        assertEq(uint(p.status), uint(ReputationProviderRegistry.ProposalStatus.PENDING));
    }

    function test_VoteOnProposal() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        // Bob votes in favor
        vm.prank(bob);
        registry.vote{value: 0.002 ether}(proposalId, true);

        // Charlie votes against
        vm.prank(charlie);
        registry.vote{value: 0.001 ether}(proposalId, false);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        
        assertEq(p.forStake, 0.003 ether); // alice + bob
        assertEq(p.againstStake, 0.001 ether); // charlie
        assertEq(p.forCount, 2);
        assertEq(p.againstCount, 1);
    }

    function test_CannotVoteTwice() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        vm.prank(bob);
        registry.vote{value: 0.001 ether}(proposalId, true);

        vm.prank(bob);
        vm.expectRevert(ReputationProviderRegistry.AlreadyVoted.selector);
        registry.vote{value: 0.001 ether}(proposalId, false);
    }

    function test_AddOpinion() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        vm.prank(bob);
        registry.addOpinion{value: 0.0005 ether}(
            proposalId,
            true,
            "QmOpinionHash",
            "I support this provider because..."
        );

        ReputationProviderRegistry.Opinion[] memory opinions = registry.getProposalOpinions(proposalId);
        
        assertEq(opinions.length, 1);
        assertEq(opinions[0].author, bob);
        assertEq(opinions[0].stake, 0.0005 ether);
        assertTrue(opinions[0].inFavor);
    }

    function test_AdvanceToCouncilReview() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        // Cannot advance before challenge period ends
        vm.expectRevert(ReputationProviderRegistry.ChallengePeriodActive.selector);
        registry.advanceToCouncilReview(proposalId);

        // Skip challenge period (7 days)
        vm.warp(block.timestamp + 8 days);

        // Now can advance
        registry.advanceToCouncilReview(proposalId);

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint(p.status), uint(ReputationProviderRegistry.ProposalStatus.COUNCIL_REVIEW));
    }

    function test_CouncilApproval() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "A great new provider",
            3000
        );

        // Skip challenge period
        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        // Council approves
        council.submitDecision(
            proposalId,
            true,
            keccak256("decision-reasoning"),
            "Approved after careful review"
        );

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint(p.status), uint(ReputationProviderRegistry.ProposalStatus.APPROVED));
        assertTrue(p.timelockEnds > block.timestamp);
    }

    function test_CouncilRejection() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        council.submitDecision(
            proposalId,
            false,
            keccak256("rejection-reasoning"),
            "Does not meet quality standards"
        );

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint(p.status), uint(ReputationProviderRegistry.ProposalStatus.REJECTED));
    }

    function test_ExecuteApprovedProposal() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

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

    function test_ProposeRemoveProvider() public {
        // First add a provider
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        // Propose removal
        vm.prank(alice);
        bytes32 proposalId = registry.proposeRemoveProvider{value: 0.01 ether}(address(provider1));

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint(p.proposalType), uint(ReputationProviderRegistry.ProposalType.REMOVE_PROVIDER));
        assertEq(p.targetProvider, address(provider1));
    }

    function test_ProposeUpdateWeight() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        bytes32 proposalId = registry.proposeUpdateWeight{value: 0.01 ether}(
            address(provider1),
            7000
        );

        ReputationProviderRegistry.Proposal memory p = registry.getProposal(proposalId);
        assertEq(uint(p.proposalType), uint(ReputationProviderRegistry.ProposalType.UPDATE_WEIGHT));
        assertEq(p.proposedWeight, 7000);
    }

    function test_GetAggregatedReputation() public {
        // Initialize two providers
        vm.startPrank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 6000);
        registry.initializeProvider(address(provider2), "Provider 2", "Desc", 4000);
        vm.stopPrank();

        // Set scores for agent 1
        provider1.setScore(1, 8000); // 80%
        provider2.setScore(1, 6000); // 60%

        (uint256 weightedScore, uint256[] memory scores, uint256[] memory weights) = 
            registry.getAggregatedReputation(1);

        // Expected: (8000 * 6000 + 6000 * 4000) / 10000 = 7200
        assertEq(weightedScore, 7200);
        assertEq(scores.length, 2);
        assertEq(weights.length, 2);
    }

    function test_ClaimRewards_Winner() public {
        vm.prank(alice);
        bytes32 proposalId = registry.proposeAddProvider{value: 0.002 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        // Bob votes against (will lose)
        vm.prank(bob);
        registry.vote{value: 0.001 ether}(proposalId, false);

        vm.warp(block.timestamp + 8 days);
        registry.advanceToCouncilReview(proposalId);

        // Council approves - Alice wins
        council.submitDecision(proposalId, true, keccak256("approved"), "Approved");
        
        vm.warp(block.timestamp + 3 days);
        registry.executeProposal(proposalId);

        uint256 aliceBalanceBefore = alice.balance;

        // Alice claims rewards
        vm.prank(alice);
        registry.claimRewards(proposalId);

        uint256 aliceBalanceAfter = alice.balance;
        assertTrue(aliceBalanceAfter > aliceBalanceBefore);
    }

    function test_InvalidWeight() public {
        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.InvalidWeight.selector);
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            10001 // > MAX_WEIGHT
        );
    }

    function test_ProviderAlreadyExists() public {
        vm.prank(owner);
        registry.initializeProvider(address(provider1), "Provider 1", "Desc", 5000);

        vm.prank(alice);
        vm.expectRevert(ReputationProviderRegistry.ProviderExists.selector);
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "Duplicate",
            "Description",
            3000
        );
    }

    function test_Pause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );

        vm.prank(owner);
        registry.unpause();

        // Should work now
        vm.prank(alice);
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "New Provider",
            "Description",
            3000
        );
    }

    function test_GetAllProposals() public {
        vm.prank(alice);
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider1),
            "Provider 1",
            "Description",
            3000
        );

        vm.prank(bob);
        registry.proposeAddProvider{value: 0.01 ether}(
            address(provider2),
            "Provider 2",
            "Description",
            4000
        );

        bytes32[] memory allProposals = registry.getAllProposals();
        assertEq(allProposals.length, 2);
    }
}

