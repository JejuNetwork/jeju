// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/council/Council.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Mock Governance Token for testing
 */
contract MockGovernanceToken is ERC20 {
    constructor() ERC20("Jeju Token", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title Council Test Suite
 * @notice Comprehensive tests for AI Council DAO governance
 */
contract CouncilTest is Test {
    Council public council;
    MockGovernanceToken public token;

    address public owner = address(0x1001);
    address public ceoAgent = address(0x2001);
    address public treasuryAgent = address(0x3001);
    address public codeAgent = address(0x3002);
    address public communityAgent = address(0x3003);
    address public securityAgent = address(0x3004);
    address public researchOperator = address(0x4001);
    address public proposer1 = address(0x5001);
    address public proposer2 = address(0x5002);
    address public backer1 = address(0x6001);
    address public backer2 = address(0x6002);

    address public identityRegistry = address(0x7001);
    address public reputationRegistry = address(0x7002);

    bytes32 public constant CONTENT_HASH = keccak256("ipfs://proposal-content");
    bytes32 public constant REASONING_HASH = keccak256("ipfs://reasoning");
    bytes32 public constant RESEARCH_HASH = keccak256("ipfs://research");
    bytes32 public constant DECISION_HASH = keccak256("ipfs://decision");

    function setUp() public {
        vm.startPrank(owner);

        // Deploy token
        token = new MockGovernanceToken();

        // Deploy council
        council = new Council(
            address(token),
            identityRegistry,
            reputationRegistry,
            owner
        );

        // Configure council agents
        council.setCouncilAgent(Council.CouncilRole.TREASURY, treasuryAgent, 1, 100);
        council.setCouncilAgent(Council.CouncilRole.CODE, codeAgent, 2, 100);
        council.setCouncilAgent(Council.CouncilRole.COMMUNITY, communityAgent, 3, 100);
        council.setCouncilAgent(Council.CouncilRole.SECURITY, securityAgent, 4, 100);

        // Set CEO
        council.setCEOAgent(ceoAgent, 5);

        // Set research operator
        council.setResearchOperator(researchOperator, true);

        vm.stopPrank();

        // Fund accounts
        vm.deal(proposer1, 10 ether);
        vm.deal(proposer2, 10 ether);
        vm.deal(backer1, 10 ether);
        vm.deal(backer2, 10 ether);

        // Distribute tokens
        vm.startPrank(owner);
        token.transfer(proposer1, 10000 ether);
        token.transfer(proposer2, 10000 ether);
        token.transfer(backer1, 10000 ether);
        token.transfer(backer2, 10000 ether);
        vm.stopPrank();
    }

    // ============================================================================
    // Proposal Submission Tests
    // ============================================================================

    function test_SubmitProposal_Success() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95, // quality score
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        assertGt(uint256(proposalId), 0);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.proposer, proposer1);
        assertEq(proposal.qualityScore, 95);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.COUNCIL_REVIEW));
    }

    function test_SubmitProposal_InsufficientQuality() public {
        vm.prank(proposer1);
        vm.expectRevert(abi.encodeWithSelector(Council.InsufficientQualityScore.selector, 80, 90));
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            80, // below 90
            CONTENT_HASH,
            address(0),
            "",
            0
        );
    }

    function test_SubmitProposal_InsufficientBond() public {
        vm.prank(proposer1);
        vm.expectRevert(Council.InsufficientBond.selector);
        council.submitProposal{value: 0.0001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );
    }

    function test_SubmitProposal_AllTypes() public {
        uint8[10] memory types = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        
        for (uint256 i = 0; i < types.length; i++) {
            vm.prank(proposer1);
            bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
                Council.ProposalType(types[i]),
                95,
                keccak256(abi.encodePacked(CONTENT_HASH, i)),
                address(0),
                "",
                0
            );
            
            Council.Proposal memory proposal = council.getProposal(proposalId);
            assertEq(uint8(proposal.proposalType), types[i]);
        }
    }

    // ============================================================================
    // Backing Tests
    // ============================================================================

    function test_BackProposal_WithStake() public {
        // Submit proposal
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        // Approve token transfer
        vm.prank(backer1);
        token.approve(address(council), 1000 ether);

        // Back proposal
        vm.prank(backer1);
        council.backProposal(proposalId, 1000 ether, 500);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.totalStaked, 1000 ether);
        assertEq(proposal.totalReputation, 500);
        assertEq(proposal.backerCount, 1);
    }

    function test_BackProposal_MultipleBackers() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        // Backer 1
        vm.startPrank(backer1);
        token.approve(address(council), 500 ether);
        council.backProposal(proposalId, 500 ether, 200);
        vm.stopPrank();

        // Backer 2
        vm.startPrank(backer2);
        token.approve(address(council), 300 ether);
        council.backProposal(proposalId, 300 ether, 150);
        vm.stopPrank();

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.totalStaked, 800 ether);
        assertEq(proposal.totalReputation, 350);
        assertEq(proposal.backerCount, 2);
    }

    function test_BackProposal_AlreadyBacked() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.startPrank(backer1);
        token.approve(address(council), 2000 ether);
        council.backProposal(proposalId, 500 ether, 200);

        vm.expectRevert(Council.AlreadyBacked.selector);
        council.backProposal(proposalId, 500 ether, 200);
        vm.stopPrank();
    }

    // ============================================================================
    // Council Voting Tests
    // ============================================================================

    function test_CastCouncilVote_Success() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        Council.CouncilVote[] memory votes = council.getCouncilVotes(proposalId);
        assertEq(votes.length, 1);
        assertEq(votes[0].councilAgent, treasuryAgent);
        assertEq(uint8(votes[0].vote), uint8(Council.VoteType.APPROVE));
    }

    function test_CastCouncilVote_AllAgents() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.CODE_UPGRADE,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);

        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.ABSTAIN, REASONING_HASH);

        Council.CouncilVote[] memory votes = council.getCouncilVotes(proposalId);
        assertEq(votes.length, 4);
    }

    function test_CastCouncilVote_NotCouncilAgent() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.prank(proposer1);
        vm.expectRevert(Council.NotCouncilAgent.selector);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
    }

    function test_CastCouncilVote_AlreadyVoted() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.prank(treasuryAgent);
        vm.expectRevert(Council.AlreadyVoted.selector);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
    }

    // ============================================================================
    // Council Finalization Tests
    // ============================================================================

    function test_FinalizeCouncilVote_Approved() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        // All agents vote approve
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        // Fast forward past voting period
        vm.warp(block.timestamp + 4 days);

        council.finalizeCouncilVote(proposalId);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.RESEARCH_PENDING));
    }

    function test_FinalizeCouncilVote_Rejected() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        // Majority rejects
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.REJECTED));
    }

    function test_FinalizeCouncilVote_VotingPeriodNotEnded() public {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.expectRevert(Council.VotingPeriodNotEnded.selector);
        council.finalizeCouncilVote(proposalId);
    }

    // ============================================================================
    // Research Tests
    // ============================================================================

    function test_SubmitResearch_Proceed() public {
        bytes32 proposalId = _createApprovedByCouncil();

        vm.prank(researchOperator);
        council.submitResearch(proposalId, RESEARCH_HASH, true);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.hasResearch, true);
        assertEq(proposal.researchHash, RESEARCH_HASH);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.COUNCIL_FINAL));
    }

    function test_SubmitResearch_NotProceed() public {
        bytes32 proposalId = _createApprovedByCouncil();

        vm.prank(researchOperator);
        council.submitResearch(proposalId, RESEARCH_HASH, false);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.REJECTED));
    }

    function test_SubmitResearch_NotOperator() public {
        bytes32 proposalId = _createApprovedByCouncil();

        vm.prank(proposer1);
        vm.expectRevert(Council.NotResearchOperator.selector);
        council.submitResearch(proposalId, RESEARCH_HASH, true);
    }

    // ============================================================================
    // CEO Decision Tests
    // ============================================================================

    function test_CEODecide_Approve() public {
        bytes32 proposalId = _createInCEOQueue();

        vm.prank(ceoAgent);
        council.ceoDecide(proposalId, true, DECISION_HASH);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.ceoApproved, true);
        assertEq(proposal.ceoDecisionHash, DECISION_HASH);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.APPROVED));
        assertGt(proposal.gracePeriodEnd, block.timestamp);
    }

    function test_CEODecide_Reject() public {
        bytes32 proposalId = _createInCEOQueue();

        vm.prank(ceoAgent);
        council.ceoDecide(proposalId, false, DECISION_HASH);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(proposal.ceoApproved, false);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.REJECTED));
    }

    function test_CEODecide_NotCEO() public {
        bytes32 proposalId = _createInCEOQueue();

        vm.prank(proposer1);
        vm.expectRevert(Council.NotCEOAgent.selector);
        council.ceoDecide(proposalId, true, DECISION_HASH);
    }

    // ============================================================================
    // Veto Tests
    // ============================================================================

    function test_CastVetoVote_Success() public {
        bytes32 proposalId = _createApprovedByCEO();

        vm.prank(backer1);
        council.castVetoVote{value: 0.1 ether}(
            proposalId,
            Council.VetoCategory.HARMFUL,
            REASONING_HASH
        );

        Council.VetoVote[] memory vetos = council.getVetoVotes(proposalId);
        assertEq(vetos.length, 1);
        assertEq(vetos[0].voter, backer1);
        assertEq(vetos[0].stakedAmount, 0.1 ether);
    }

    function test_CastVetoVote_InsufficientStake() public {
        bytes32 proposalId = _createApprovedByCEO();

        vm.prank(backer1);
        vm.expectRevert(Council.InsufficientVetoStake.selector);
        council.castVetoVote{value: 0.001 ether}(
            proposalId,
            Council.VetoCategory.HARMFUL,
            REASONING_HASH
        );
    }

    function test_CastVetoVote_AlreadyVetoed() public {
        bytes32 proposalId = _createApprovedByCEO();

        // First, stake on the proposal so the veto threshold is higher
        vm.startPrank(backer1);
        token.approve(address(council), 100 ether);
        council.backProposal(proposalId, 100 ether, 0);
        vm.stopPrank();

        // Cast a small veto vote (won't trigger threshold)
        vm.prank(backer2);
        council.castVetoVote{value: 0.02 ether}(
            proposalId,
            Council.VetoCategory.HARMFUL,
            REASONING_HASH
        );

        // Try to vote again with same address
        vm.prank(backer2);
        vm.expectRevert(Council.AlreadyVetoed.selector);
        council.castVetoVote{value: 0.02 ether}(
            proposalId,
            Council.VetoCategory.HARMFUL,
            REASONING_HASH
        );
    }

    function test_CastVetoVote_GracePeriodEnded() public {
        bytes32 proposalId = _createApprovedByCEO();

        vm.warp(block.timestamp + 2 days);

        vm.prank(backer1);
        vm.expectRevert(Council.GracePeriodEnded.selector);
        council.castVetoVote{value: 0.1 ether}(
            proposalId,
            Council.VetoCategory.HARMFUL,
            REASONING_HASH
        );
    }

    // ============================================================================
    // Execution Tests
    // ============================================================================

    function test_ExecuteProposal_Success() public {
        bytes32 proposalId = _createApprovedByCEO();

        // Wait for grace period to end
        vm.warp(block.timestamp + 2 days);

        council.executeProposal(proposalId);

        Council.Proposal memory proposal = council.getProposal(proposalId);
        assertEq(uint8(proposal.status), uint8(Council.ProposalStatus.COMPLETED));
    }

    function test_ExecuteProposal_GracePeriodNotEnded() public {
        bytes32 proposalId = _createApprovedByCEO();

        vm.expectRevert(Council.GracePeriodNotEnded.selector);
        council.executeProposal(proposalId);
    }

    function test_ExecuteProposal_WithTargetContract() public {
        // Create a simple target contract
        MockTarget target = new MockTarget();
        bytes memory callData = abi.encodeWithSignature("setValue(uint256)", 42);

        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            95,
            keccak256(abi.encodePacked(CONTENT_HASH, "target")),
            address(target),
            callData,
            0
        );

        // Manual fast track with explicit timestamps
        uint256 baseTime = block.timestamp;
        
        // First council vote
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(baseTime + 4 days);
        council.finalizeCouncilVote(proposalId);

        // Research
        vm.prank(researchOperator);
        council.submitResearch(proposalId, RESEARCH_HASH, true);

        // Final council vote
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(baseTime + 8 days);
        council.finalizeCouncilVote(proposalId);

        // CEO approve
        vm.prank(ceoAgent);
        council.ceoDecide(proposalId, true, DECISION_HASH);

        // Wait for grace period
        vm.warp(baseTime + 10 days);

        council.executeProposal(proposalId);

        assertEq(target.value(), 42);
    }

    // ============================================================================
    // View Function Tests
    // ============================================================================

    function test_GetAllProposals() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(proposer1);
            council.submitProposal{value: 0.001 ether}(
                Council.ProposalType.GRANT,
                95,
                keccak256(abi.encodePacked(CONTENT_HASH, i)),
                address(0),
                "",
                0
            );
        }

        bytes32[] memory proposals = council.getAllProposals();
        assertEq(proposals.length, 5);
    }

    function test_GetActiveProposals() public {
        // Create 3 proposals
        vm.startPrank(proposer1);
        bytes32 id1 = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT, 95, keccak256("1"), address(0), "", 0
        );
        bytes32 id2 = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT, 95, keccak256("2"), address(0), "", 0
        );
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT, 95, keccak256("3"), address(0), "", 0
        );
        vm.stopPrank();

        // Reject one via council vote
        _rejectViaCouncil(id1);

        bytes32[] memory active = council.getActiveProposals();
        assertEq(active.length, 2);
    }

    function test_GetProposerProposals() public {
        vm.startPrank(proposer1);
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT, 95, keccak256("1"), address(0), "", 0
        );
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.BOUNTY, 95, keccak256("2"), address(0), "", 0
        );
        vm.stopPrank();

        vm.prank(proposer2);
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.POLICY, 95, keccak256("3"), address(0), "", 0
        );

        bytes32[] memory p1Proposals = council.getProposerProposals(proposer1);
        bytes32[] memory p2Proposals = council.getProposerProposals(proposer2);

        assertEq(p1Proposals.length, 2);
        assertEq(p2Proposals.length, 1);
    }

    // ============================================================================
    // Admin Tests
    // ============================================================================

    function test_SetParameters() public {
        vm.prank(owner);
        council.setParameters(
            85,      // minQualityScore
            2 days,  // councilVotingPeriod
            12 hours,// gracePeriod
            3,       // minBackers
            0.05 ether, // minStakeForVeto
            5000,    // vetoThresholdBPS (50%)
            0.002 ether // proposalBond
        );

        assertEq(council.minQualityScore(), 85);
        assertEq(council.councilVotingPeriod(), 2 days);
        assertEq(council.gracePeriod(), 12 hours);
        assertEq(council.minBackers(), 3);
        assertEq(council.minStakeForVeto(), 0.05 ether);
        assertEq(council.vetoThresholdBPS(), 5000);
        assertEq(council.proposalBond(), 0.002 ether);
    }

    function test_PauseUnpause() public {
        vm.prank(owner);
        council.pause();

        vm.prank(proposer1);
        vm.expectRevert();
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        vm.prank(owner);
        council.unpause();

        vm.prank(proposer1);
        council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );
    }

    function test_Version() public view {
        assertEq(council.version(), "1.0.0");
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    function _createApprovedByCouncil() internal returns (bytes32) {
        vm.prank(proposer1);
        bytes32 proposalId = council.submitProposal{value: 0.001 ether}(
            Council.ProposalType.GRANT,
            95,
            CONTENT_HASH,
            address(0),
            "",
            0
        );

        // All approve
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);

        return proposalId;
    }

    function _createInCEOQueue() internal returns (bytes32) {
        bytes32 proposalId = _createApprovedByCouncil();

        // Submit research with proceed recommendation
        vm.prank(researchOperator);
        council.submitResearch(proposalId, RESEARCH_HASH, true);

        // Final council vote (votes were cleared by submitResearch)
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);

        return proposalId;
    }

    function _createApprovedByCEO() internal returns (bytes32) {
        bytes32 proposalId = _createInCEOQueue();

        vm.prank(ceoAgent);
        council.ceoDecide(proposalId, true, DECISION_HASH);

        return proposalId;
    }

    function _fastTrackToApproved(bytes32 proposalId) internal {
        // First council vote
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);

        // Research
        vm.prank(researchOperator);
        council.submitResearch(proposalId, RESEARCH_HASH, true);

        // Final council vote (votes were cleared by research submission)
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.APPROVE, REASONING_HASH);

        // Need to warp past the new voting period set by submitResearch
        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);

        // CEO approve
        vm.prank(ceoAgent);
        council.ceoDecide(proposalId, true, DECISION_HASH);
    }

    function _rejectViaCouncil(bytes32 proposalId) internal {
        vm.prank(treasuryAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(codeAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(communityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);
        vm.prank(securityAgent);
        council.castCouncilVote(proposalId, Council.VoteType.REJECT, REASONING_HASH);

        vm.warp(block.timestamp + 4 days);
        council.finalizeCouncilVote(proposalId);
    }
}

/**
 * @title Mock Target for execution tests
 */
contract MockTarget {
    uint256 public value;

    function setValue(uint256 _value) external {
        value = _value;
    }
}
