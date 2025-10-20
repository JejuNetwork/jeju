// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/ReputationLabelManager.sol";
import "../src/moderation/BanManager.sol";

/**
 * @title ReputationLabelManager Test Suite
 * @notice Comprehensive tests for label proposal and resolution
 */
contract ReputationLabelManagerTest is Test {
    ReputationLabelManager public labelManager;
    BanManager public banManager;
    MockPredimarket public mockPredimarket;
    
    address public owner = address(0x5001);
    address public governance = address(0x5002);
    address public proposer1 = address(0x5003);
    address public proposer2 = address(0x5004);
    
    bytes32 public constant EVIDENCE_1 = keccak256("evidence1");
    bytes32 public constant EVIDENCE_2 = keccak256("evidence2");
    
    function setUp() public {
        // Deploy mock Predimarket
        mockPredimarket = new MockPredimarket();
        
        // Deploy BanManager
        vm.prank(owner);
        banManager = new BanManager(governance, owner);
        
        // Deploy LabelManager
        vm.prank(owner);
        labelManager = new ReputationLabelManager(
            address(banManager),
            address(mockPredimarket),
            governance,
            owner
        );
        
        // Fund proposers
        vm.deal(proposer1, 10 ether);
        vm.deal(proposer2, 10 ether);
        
        // Set labelManager as authorized on banManager
        vm.prank(owner);
        banManager.setGovernance(address(labelManager));
    }
    
    // ============ Test 1: Propose HACKER Label ============
    
    function test_ProposeHackerLabel() public {
        uint256 stake = 0.1 ether;
        
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: stake}(
            100,
            ReputationLabelManager.Label.HACKER,
            EVIDENCE_1
        );
        
        // Verify proposal created
        ReputationLabelManager.LabelProposal memory proposal = labelManager.getProposal(proposalId);
        assertEq(proposal.targetAgentId, 100);
        assertEq(uint8(proposal.proposedLabel), uint8(ReputationLabelManager.Label.HACKER));
        assertEq(proposal.proposer, proposer1);
        assertEq(proposal.stakeAmount, stake);
    }
    
    // ============ Test 2: Insufficient Stake ============
    
    function test_ProposeLabel_InsufficientStake() public {
        vm.prank(proposer1);
        vm.expectRevert(ReputationLabelManager.InsufficientStake.selector);
        
        labelManager.proposeLabel{value: 0.01 ether}(
            100,
            ReputationLabelManager.Label.HACKER,
            EVIDENCE_1
        ); // Requires 0.1 ETH
    }
    
    // ============ Test 3: Resolve Proposal - YES ============
    
    function test_ResolveProposal_Approved() public {
        // Propose label
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.1 ether}(
            100,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        // Get market ID
        ReputationLabelManager.LabelProposal memory proposal = labelManager.getProposal(proposalId);
        
        // Mock market outcome as YES
        mockPredimarket.setOutcome(proposal.marketId, true);
        
        // Advance time past voting period
        vm.warp(block.timestamp + 7 days + 1);
        
        // Fund contract for bonus payment
        vm.deal(address(labelManager), 1 ether);
        
        // Resolve
        uint256 balanceBefore = proposer1.balance;
        labelManager.resolveProposal(proposalId);
        
        // Check label applied
        assertTrue(labelManager.hasLabel(100, ReputationLabelManager.Label.SCAMMER));
        
        // Check proposer rewarded (stake + 10% bonus)
        uint256 reward = 0.1 ether + (0.1 ether / 10);
        assertEq(proposer1.balance, balanceBefore + reward);
    }
    
    // ============ Test 4: Resolve Proposal - NO (Slashed) ============
    
    function test_ResolveProposal_Rejected() public {
        // Propose label
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.05 ether}(
            200,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_2
        );
        
        // Get market ID
        ReputationLabelManager.LabelProposal memory proposal = labelManager.getProposal(proposalId);
        
        // Mock market outcome as NO
        mockPredimarket.setOutcome(proposal.marketId, false);
        
        // Advance time
        vm.warp(block.timestamp + 7 days + 1);
        
        // Resolve
        uint256 balanceBefore = proposer1.balance;
        labelManager.resolveProposal(proposalId);
        
        // Check label NOT applied
        assertFalse(labelManager.hasLabel(200, ReputationLabelManager.Label.SCAMMER));
        
        // Check proposer slashed (no refund)
        assertEq(proposer1.balance, balanceBefore);
    }
    
    // ============ Test 5: HACKER Label Auto-Bans ============
    
    function test_HackerLabel_AutoBan() public {
        // Propose HACKER label
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.1 ether}(
            300,
            ReputationLabelManager.Label.HACKER,
            EVIDENCE_1
        );
        
        // Mock market approves
        ReputationLabelManager.LabelProposal memory proposal = labelManager.getProposal(proposalId);
        mockPredimarket.setOutcome(proposal.marketId, true);
        
        // Advance time and resolve
        vm.warp(block.timestamp + 7 days + 1);
        labelManager.resolveProposal(proposalId);
        
        // Check label applied
        assertTrue(labelManager.hasLabel(300, ReputationLabelManager.Label.HACKER));
        
        // Check auto-ban triggered
        assertTrue(banManager.isNetworkBanned(300));
    }
    
    // ============ Test 6: Multiple Labels Per Agent ============
    
    function test_MultipleLabelsPerAgent() public {
        // Propose SCAMMER
        vm.prank(proposer1);
        bytes32 proposal1 = labelManager.proposeLabel{value: 0.05 ether}(
            400,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        // Propose SPAM_BOT
        vm.prank(proposer2);
        bytes32 proposal2 = labelManager.proposeLabel{value: 0.01 ether}(
            400,
            ReputationLabelManager.Label.SPAM_BOT,
            EVIDENCE_2
        );
        
        // Approve both
        mockPredimarket.setOutcome(labelManager.getProposal(proposal1).marketId, true);
        mockPredimarket.setOutcome(labelManager.getProposal(proposal2).marketId, true);
        
        vm.warp(block.timestamp + 7 days + 1);
        
        // Fund contract for bonus payments
        vm.deal(address(labelManager), 1 ether);
        
        labelManager.resolveProposal(proposal1);
        labelManager.resolveProposal(proposal2);
        
        // Check both labels applied
        ReputationLabelManager.Label[] memory labels = labelManager.getLabels(400);
        assertEq(labels.length, 2);
    }
    
    // ============ Test 7: Remove Label (Governance) ============
    
    function test_RemoveLabel() public {
        // Setup: Apply label first
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.05 ether}(
            500,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        mockPredimarket.setOutcome(labelManager.getProposal(proposalId).marketId, true);
        vm.warp(block.timestamp + 7 days + 1);
        labelManager.resolveProposal(proposalId);
        
        assertTrue(labelManager.hasLabel(500, ReputationLabelManager.Label.SCAMMER));
        
        // Remove via governance
        vm.prank(governance);
        labelManager.removeLabel(500, ReputationLabelManager.Label.SCAMMER);
        
        assertFalse(labelManager.hasLabel(500, ReputationLabelManager.Label.SCAMMER));
    }
    
    // ============ Test 8: Cannot Propose Duplicate Label ============
    
    function test_CannotProposeDuplicateLabel() public {
        // Propose and approve first label
        vm.prank(proposer1);
        bytes32 proposal1 = labelManager.proposeLabel{value: 0.05 ether}(
            600,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        mockPredimarket.setOutcome(labelManager.getProposal(proposal1).marketId, true);
        vm.warp(block.timestamp + 7 days + 1);
        labelManager.resolveProposal(proposal1);
        
        // Try to propose same label again
        vm.prank(proposer2);
        vm.expectRevert(ReputationLabelManager.LabelAlreadyExists.selector);
        labelManager.proposeLabel{value: 0.05 ether}(
            600,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_2
        );
    }
    
    // ============ Test 9: TRUSTED Label Rewards ============
    
    function test_TrustedLabel() public {
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.5 ether}(
            700,
            ReputationLabelManager.Label.TRUSTED,
            EVIDENCE_1
        );
        
        mockPredimarket.setOutcome(labelManager.getProposal(proposalId).marketId, true);
        vm.warp(block.timestamp + 7 days + 1);
        
        // Fund contract for bonus payment
        vm.deal(address(labelManager), 1 ether);
        
        uint256 balanceBefore = proposer1.balance;
        labelManager.resolveProposal(proposalId);
        
        // Check TRUSTED label applied
        assertTrue(labelManager.hasLabel(700, ReputationLabelManager.Label.TRUSTED));
        
        // Check reward (0.5 ETH stake + 10% bonus = 0.55 ETH)
        uint256 reward = 0.5 ether + (0.5 ether / 10);
        assertEq(proposer1.balance, balanceBefore + reward);
    }
    
    // ============ Test 10: Invalid Label Type ============
    
    function test_ProposeLabel_InvalidLabel() public {
        vm.prank(proposer1);
        vm.expectRevert(ReputationLabelManager.InvalidLabel.selector);
        
        labelManager.proposeLabel{value: 0.1 ether}(
            800,
            ReputationLabelManager.Label.NONE,
            EVIDENCE_1
        );
    }
    
    // ============ Test 11: Get Agent Proposals ============
    
    function test_GetAgentProposals() public {
        // Create multiple proposals for same agent
        vm.prank(proposer1);
        labelManager.proposeLabel{value: 0.05 ether}(900, ReputationLabelManager.Label.SCAMMER, EVIDENCE_1);
        
        vm.prank(proposer2);
        labelManager.proposeLabel{value: 0.01 ether}(900, ReputationLabelManager.Label.SPAM_BOT, EVIDENCE_2);
        
        bytes32[] memory proposals = labelManager.getAgentProposals(900);
        assertEq(proposals.length, 2);
    }
    
    // ============ Test 12: Voting Not Ended ============
    
    function test_ResolveProposal_VotingNotEnded() public {
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.05 ether}(
            1000,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        // Try to resolve immediately (voting period not ended)
        vm.expectRevert(ReputationLabelManager.VotingNotEnded.selector);
        labelManager.resolveProposal(proposalId);
    }
    
    // ============ Test 13: Market Not Resolved ============
    
    function test_ResolveProposal_MarketNotResolved() public {
        vm.prank(proposer1);
        bytes32 proposalId = labelManager.proposeLabel{value: 0.05 ether}(
            1100,
            ReputationLabelManager.Label.SCAMMER,
            EVIDENCE_1
        );
        
        // Advance time but don't resolve market
        vm.warp(block.timestamp + 7 days + 1);
        
        vm.expectRevert(ReputationLabelManager.ProposalNotResolved.selector);
        labelManager.resolveProposal(proposalId);
    }
    
    // ============ Test 14: Pause Functionality ============
    
    function test_Pause() public {
        vm.prank(owner);
        labelManager.pause();
        
        vm.prank(proposer1);
        vm.expectRevert();
        labelManager.proposeLabel{value: 0.1 ether}(
            1200,
            ReputationLabelManager.Label.HACKER,
            EVIDENCE_1
        );
    }
}

/**
 * @title Mock Predimarket for testing
 */
contract MockPredimarket {
    mapping(bytes32 => bool) public marketResolved;
    mapping(bytes32 => bool) public marketOutcome;
    
    function createMarket(bytes32 sessionId, string memory, uint256) external {
        // Just track that market was created
    }
    
    function setOutcome(bytes32 sessionId, bool outcome) external {
        marketResolved[sessionId] = true;
        marketOutcome[sessionId] = outcome;
    }
    
    function getMarket(bytes32 sessionId) external view returns (
        bytes32,
        string memory,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        bool,
        bool
    ) {
        return (
            sessionId,
            "Test question",
            0, 0, 1000 ether, 0,
            block.timestamp,
            marketResolved[sessionId],
            marketOutcome[sessionId]
        );
    }
}

