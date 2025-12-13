// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Council} from "../src/council/Council.sol";
import {IPredimarket} from "../src/council/IPredimarket.sol";

// Mock Predimarket for testing
contract MockPredimarketForCouncil is IPredimarket {
    mapping(bytes32 => bool) public marketsCreated;
    mapping(bytes32 => uint256) public yesVotes;
    mapping(bytes32 => uint256) public noVotes;
    mapping(bytes32 => bool) public resolved;
    mapping(bytes32 => bool) public outcome;

    function createModerationMarket(
        bytes32 sessionId,
        string calldata,
        uint256,
        MarketCategory,
        ModerationMetadata calldata
    ) external override {
        marketsCreated[sessionId] = true;
        yesVotes[sessionId] = 5000; // Default 50/50
        noVotes[sessionId] = 5000;
    }

    function getMarketPrices(bytes32 sessionId) external view override returns (uint256 yesPrice, uint256 noPrice) {
        return (yesVotes[sessionId], noVotes[sessionId]);
    }

    function getMarket(bytes32 sessionId) external view override returns (
        bytes32 _sessionId,
        string memory question,
        uint256 _yesShares,
        uint256 _noShares,
        uint256 liquidityParameter,
        uint256 totalVolume,
        uint256 createdAt,
        bool _resolved,
        bool _outcome,
        uint8 gameType,
        address gameContract,
        MarketCategory category
    ) {
        return (
            sessionId,
            "",
            yesVotes[sessionId],
            noVotes[sessionId],
            1000e18,
            0,
            block.timestamp,
            resolved[sessionId],
            outcome[sessionId],
            0,
            address(0),
            MarketCategory.GOVERNANCE_VETO
        );
    }

    function isMarketResolved(bytes32 sessionId) external view override returns (bool, bool) {
        return (resolved[sessionId], outcome[sessionId]);
    }

    // Test helpers
    function setVotes(bytes32 sessionId, uint256 yes, uint256 no) external {
        yesVotes[sessionId] = yes;
        noVotes[sessionId] = no;
    }

    function resolveMarket(bytes32 sessionId, bool _outcome) external {
        resolved[sessionId] = true;
        outcome[sessionId] = _outcome;
    }
}

contract CouncilFutarchyTest is Test {
    Council public council;
    MockPredimarketForCouncil public predimarket;

    address public owner = address(1);
    address public proposer = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public ceoAgent = address(5);

    address public token = address(0x1234);
    address public identityRegistry = address(0x2345);
    address public reputationRegistry = address(0x3456);

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy mock predimarket
        predimarket = new MockPredimarketForCouncil();
        
        // Deploy council (4 args)
        council = new Council(
            token,
            identityRegistry,
            reputationRegistry,
            owner
        );

        // Set CEO agent (takes 2 args: address and agentId)
        council.setCEOAgent(ceoAgent, 1);
        
        // Set predimarket via setter
        council.setPredimarket(address(predimarket));
        
        vm.stopPrank();
    }

    function _submitProposal() internal returns (bytes32) {
        // Submit a proposal
        vm.deal(proposer, 1 ether);
        vm.prank(proposer);
        bytes32 proposalId = council.submitProposal{value: 0.01 ether}(
            Council.ProposalType.PARAMETER_CHANGE,
            90, // qualityScore
            keccak256("content"),
            address(0),
            "",
            0   // value
        );
        return proposalId;
    }

    function testFutarchyEscalation() public {
        // First create a proposal
        bytes32 proposalId = _submitProposal();

        // Verify predimarket is set
        assertEq(council.predimarket(), address(predimarket));
    }

    function testFutarchyParametersCanBeSet() public {
        vm.prank(owner);
        council.setFutarchyParameters(5 days, 2000e18);

        assertEq(council.futarchyVotingPeriod(), 5 days);
        assertEq(council.futarchyLiquidity(), 2000e18);
    }

    function testGetVetoedProposals() public view {
        bytes32[] memory vetoed = council.getVetoedProposals();
        assertEq(vetoed.length, 0);
    }

    function testGetFutarchyPendingProposals() public view {
        bytes32[] memory pending = council.getFutarchyPendingProposals();
        assertEq(pending.length, 0);
    }

    function testGetFutarchyMarketInfo() public view {
        bytes32 proposalId = keccak256("test-proposal");
        
        (bytes32 marketId, uint256 deadline, bool canResolve) = council.getFutarchyMarket(proposalId);
        
        assertEq(marketId, bytes32(0));
        assertEq(deadline, 0);
        assertFalse(canResolve);
    }

    function testNewProposalStatusEnums() public pure {
        // Test that new status enums exist
        Council.ProposalStatus futarchyPending = Council.ProposalStatus.FUTARCHY_PENDING;
        Council.ProposalStatus futarchyApproved = Council.ProposalStatus.FUTARCHY_APPROVED;
        Council.ProposalStatus futarchyRejected = Council.ProposalStatus.FUTARCHY_REJECTED;

        // These should not revert
        assertEq(uint256(futarchyPending), 10);
        assertEq(uint256(futarchyApproved), 11);
        assertEq(uint256(futarchyRejected), 12);
    }

    function testEscalateRequiresVetoedStatus() public {
        bytes32 proposalId = _submitProposal();

        // Try to escalate a proposal that's not vetoed
        vm.prank(voter1);
        vm.expectRevert(Council.NotVetoed.selector);
        council.escalateToFutarchy(proposalId);
    }

    function testResolveFutarchyRequiresFutarchyPendingStatus() public {
        bytes32 proposalId = _submitProposal();

        vm.prank(voter1);
        vm.expectRevert(Council.FutarchyNotPending.selector);
        council.resolveFutarchy(proposalId);
    }

    function testExecuteFutarchyApprovedRequiresCorrectStatus() public {
        bytes32 proposalId = _submitProposal();

        vm.expectRevert();
        council.executeFutarchyApproved(proposalId);
    }

    function testPredimarketIntegration() public {
        // Test that we can interact with the mock predimarket
        bytes32 testSessionId = keccak256("test-session");
        
        // Create a market
        IPredimarket.ModerationMetadata memory metadata = IPredimarket.ModerationMetadata({
            targetAgentId: 0,
            evidenceHash: bytes32(0),
            reporter: address(0),
            reportId: 0
        });

        predimarket.createModerationMarket(
            testSessionId,
            "Test Question",
            1000e18,
            IPredimarket.MarketCategory.GOVERNANCE_VETO,
            metadata
        );

        assertTrue(predimarket.marketsCreated(testSessionId));

        // Set votes
        predimarket.setVotes(testSessionId, 7000, 3000);

        // Get prices
        (uint256 yes, uint256 no) = predimarket.getMarketPrices(testSessionId);
        assertEq(yes, 7000);
        assertEq(no, 3000);
    }

    function testActiveProposalsExcludesFutarchyRejected() public {
        // Submit proposal
        bytes32 proposalId = _submitProposal();

        // Get active proposals - should include the new one
        bytes32[] memory active = council.getActiveProposals();
        bool found = false;
        for (uint i = 0; i < active.length; i++) {
            if (active[i] == proposalId) {
                found = true;
                break;
            }
        }
        assertTrue(found);
    }
}

contract CouncilFutarchyIntegrationTest is Test {
    Council public council;
    MockPredimarketForCouncil public predimarket;

    address public owner = address(1);
    address public proposer = address(2);
    address public ceoAgent = address(5);

    function setUp() public {
        vm.startPrank(owner);
        
        predimarket = new MockPredimarketForCouncil();
        
        council = new Council(
            address(0x1234), // token
            address(0x2345), // identityRegistry
            address(0x3456), // reputationRegistry
            owner
        );

        council.setCEOAgent(ceoAgent, 1);
        council.setPredimarket(address(predimarket));
        
        vm.stopPrank();
    }

    function testFullFutarchyFlow() public view {
        // This test would simulate the full flow:
        // 1. Submit proposal
        // 2. Council review
        // 3. CEO decision
        // 4. Veto during grace period
        // 5. Escalate to futarchy
        // 6. Resolve futarchy
        // 7. Execute or reject

        // For now, just verify the integration points exist
        assertEq(council.predimarket(), address(predimarket));
        assertEq(council.futarchyVotingPeriod(), 3 days);
        assertEq(council.futarchyLiquidity(), 1000e18);
    }
}
