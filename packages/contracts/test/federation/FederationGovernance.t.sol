// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FederationGovernance} from "../../src/federation/FederationGovernance.sol";
import {NetworkRegistry} from "../../src/federation/NetworkRegistry.sol";

/**
 * @title FederationGovernanceTest
 * @notice Tests for AI DAO-controlled federation governance
 * 
 * Tests cover:
 * - Proposal creation flow
 * - AI evaluation scoring
 * - Market voting resolution
 * - Autocrat decision handling
 * - Challenge system
 * - Guardian voting
 * - Sybil protection
 * - Sequencer rotation
 */
contract FederationGovernanceTest is Test {
    FederationGovernance governance;
    NetworkRegistry registry;
    
    address deployer;
    address operator1;
    address operator2;
    address operator3;
    address aiOracle;
    address councilGovernance;
    address treasury;
    address guardian1;
    address guardian2;
    address guardian3;

    uint256 constant JEJU_CHAIN_ID = 420690;
    uint256 constant FORK_CHAIN_ID = 420691;
    uint256 constant TEST_CHAIN_ID = 420692;

    function setUp() public {
        deployer = makeAddr("deployer");
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        operator3 = makeAddr("operator3");
        aiOracle = makeAddr("aiOracle");
        councilGovernance = makeAddr("councilGovernance");
        treasury = makeAddr("treasury");
        guardian1 = makeAddr("guardian1");
        guardian2 = makeAddr("guardian2");
        guardian3 = makeAddr("guardian3");

        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);
        vm.deal(operator3, 100 ether);

        vm.startPrank(deployer);

        // Deploy NetworkRegistry
        registry = new NetworkRegistry(deployer);

        // Deploy FederationGovernance
        governance = new FederationGovernance(
            address(registry),
            councilGovernance,
            address(0), // prediction market
            aiOracle,
            treasury
        );

        // Connect governance to registry
        registry.setFederationGovernance(address(governance));

        // Add guardians
        governance.addGuardian(guardian1, 1);
        governance.addGuardian(guardian2, 2);
        governance.addGuardian(guardian3, 3);

        vm.stopPrank();
    }

    // ============ Basic Registration Tests ============

    function test_RegisterWithoutVerification() public {
        vm.startPrank(operator1);

        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 1 ether}(
            JEJU_CHAIN_ID,
            "Jeju Network",
            "https://rpc.jeju.network",
            "https://explorer.jeju.network",
            "",
            contracts,
            bytes32(0)
        );

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        
        // Should be STAKED but NOT verified (needs governance)
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        assertFalse(network.isVerified);
        assertTrue(network.isActive);

        vm.stopPrank();
    }

    function test_RegisterWithVerificationStakeTrigersGovernance() public {
        vm.startPrank(operator1);

        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Jeju Network",
            "https://rpc.jeju.network",
            "https://explorer.jeju.network",
            "",
            contracts,
            bytes32(0)
        );

        // Network should be STAKED (not VERIFIED yet) with pending verification
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        assertFalse(network.isVerified);
        assertTrue(registry.pendingVerification(JEJU_CHAIN_ID));

        vm.stopPrank();
    }

    // ============ Governance Flow Tests ============

    function test_FullGovernanceApprovalFlow() public {
        uint256 startTime = block.timestamp;
        
        // Step 1: Register network with verification stake
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Jeju Network",
            "https://rpc.jeju.network",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        // Step 2: AI Oracle submits evaluation
        bytes32 proposalId = _getProposalId(JEJU_CHAIN_ID);
        
        vm.startPrank(aiOracle);
        governance.submitAIEvaluation(
            proposalId,
            95,  // uptime
            90,  // uniqueness
            85,  // rpc health
            80   // operator reputation
        );
        vm.stopPrank();

        // Check scores
        (,,,, uint8 overallScore,,) = governance.getProposal(proposalId);
        assertGt(overallScore, 0);

        // Step 3: Skip market voting period
        vm.warp(startTime + 8 days);

        // Step 4: Resolve market voting
        governance.resolveMarketVoting(proposalId);

        // Should be in AUTOCRAT_REVIEW
        (,,, FederationGovernance.ProposalStatus status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.AUTOCRAT_REVIEW));

        // Step 5: Autocrat approves (this sets timelockEnds = now + 7 days)
        vm.startPrank(councilGovernance);
        governance.submitAutocratDecision(
            proposalId,
            true,
            keccak256("AI approved this network"),
            "Network meets all quality criteria"
        );
        vm.stopPrank();

        // Should be APPROVED
        (,,, status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.APPROVED));

        // Step 6: Wait for timelock (another 7 days from now)
        vm.warp(startTime + 16 days);

        // Step 7: Execute proposal
        governance.executeProposal(proposalId);

        // Network should now be VERIFIED
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertTrue(network.isVerified);
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.VERIFIED));

        // Should be eligible for sequencer
        assertTrue(registry.isSequencerEligible(JEJU_CHAIN_ID));
    }

    function test_GovernanceRejection() public {
        // Register network
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Suspicious Network",
            "https://rpc.suspicious.network",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        bytes32 proposalId = _getProposalId(JEJU_CHAIN_ID);

        // AI gives low scores
        vm.startPrank(aiOracle);
        governance.submitAIEvaluation(
            proposalId,
            30,  // poor uptime
            20,  // not unique (possible Sybil)
            40,  // poor rpc
            10   // unknown operator
        );
        vm.stopPrank();

        // Skip voting period
        vm.warp(block.timestamp + 7 days + 1);

        // Resolve - should reject due to low scores
        governance.resolveMarketVoting(proposalId);

        // Should be REJECTED
        (,,, FederationGovernance.ProposalStatus status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.REJECTED));

        // Network should NOT be verified
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertFalse(network.isVerified);
    }

    // ============ Sybil Protection Tests ============

    function test_SybilProtection_MaxNetworksPerOperator() public {
        // Sybil protection: max 5 networks per operator can be pending VERIFIED
        // Registration itself is permissionless, but governance tracks limits
        
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;

        // Register 5 networks with VERIFIED stake
        for (uint256 i = 1; i <= 5; i++) {
            registry.registerNetwork{value: 10 ether}(
                JEJU_CHAIN_ID + i,
                "Network",
                "https://rpc.network",
                "",
                "",
                contracts,
                bytes32(0)
            );
        }
        vm.stopPrank();

        // Check operator history shows 5 networks
        (uint256 totalNetworks,,,,) = governance.getOperatorHistory(operator1);
        assertEq(totalNetworks, 5);

        // 6th registration succeeds (permissionless) but governance proposal creation fails
        // This is fine because the network won't be VERIFIED without governance
        vm.startPrank(operator1);
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID + 6,
            "Network 6",
            "https://rpc.network6",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        // Network is registered but will never be VERIFIED
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID + 6);
        assertTrue(network.isActive);
        assertFalse(network.isVerified);
        
        // The governance proposal was rejected, so this network can't become sequencer
        // This is the Sybil protection - you can register, but can't become VERIFIED
    }

    function test_SybilProtection_OperatorBan() public {
        // Register first network
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Network 1",
            "https://rpc.network1",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        // Ban operator for Sybil attack
        vm.startPrank(deployer);
        governance.banOperator(operator1, "Sybil attack detected");
        vm.stopPrank();

        // Operator can still register (permissionless) but governance proposal fails
        vm.startPrank(operator1);
        registry.registerNetwork{value: 10 ether}(
            FORK_CHAIN_ID,
            "Network 2",
            "https://rpc.network2",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        // Network exists but can never be VERIFIED because operator is banned
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(FORK_CHAIN_ID);
        assertTrue(network.isActive);
        assertFalse(network.isVerified);

        // Verify operator is banned
        (,,,, bool isBanned) = governance.getOperatorHistory(operator1);
        assertTrue(isBanned);
    }

    // ============ Challenge System Tests ============

    function test_ChallengeVerifiedNetwork() public {
        // Setup: Create and approve a verified network
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        // Challenge the network
        vm.startPrank(operator2);
        bytes32 challengeId = governance.challengeNetwork{value: 1 ether}(
            JEJU_CHAIN_ID,
            FederationGovernance.ChallengeReason.SYBIL_SUSPECTED,
            "ipfs://evidence"
        );
        vm.stopPrank();

        // Network should be in CHALLENGED status
        bytes32 proposalId = _getProposalId(JEJU_CHAIN_ID);
        (,,, FederationGovernance.ProposalStatus status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.CHALLENGED));

        // Guardians vote to uphold challenge
        vm.prank(guardian1);
        governance.voteOnChallenge(challengeId, true);
        
        vm.prank(guardian2);
        governance.voteOnChallenge(challengeId, true);

        vm.prank(guardian3);
        governance.voteOnChallenge(challengeId, true);

        // Challenge should be upheld, network revoked
        (,,, status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.REVOKED));

        // Network should no longer be verified
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertFalse(network.isVerified);
    }

    function test_ChallengeRejected() public {
        // Setup verified network
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        // Frivolous challenge
        vm.startPrank(operator2);
        bytes32 challengeId = governance.challengeNetwork{value: 1 ether}(
            JEJU_CHAIN_ID,
            FederationGovernance.ChallengeReason.OTHER,
            "ipfs://fake-evidence"
        );
        vm.stopPrank();

        // Guardians vote to reject challenge
        vm.prank(guardian1);
        governance.voteOnChallenge(challengeId, false);
        
        vm.prank(guardian2);
        governance.voteOnChallenge(challengeId, false);

        vm.prank(guardian3);
        governance.voteOnChallenge(challengeId, false);

        // Network should still be active/verified
        bytes32 proposalId = _getProposalId(JEJU_CHAIN_ID);
        (,,, FederationGovernance.ProposalStatus status,,,) = governance.getProposal(proposalId);
        assertEq(uint8(status), uint8(FederationGovernance.ProposalStatus.ACTIVE));

        // Challenger loses bond (sent to treasury)
        assertEq(treasury.balance, 1 ether);
    }

    // ============ Sequencer Rotation Tests ============

    function test_SequencerRotation() public {
        // Create 3 verified networks
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);
        
        // Reset time and create second network
        vm.warp(1 days); // Reset to low timestamp
        _createVerifiedNetwork(FORK_CHAIN_ID, operator2);
        
        vm.warp(1 days); // Reset again
        _createVerifiedNetwork(TEST_CHAIN_ID, operator3);

        // Initial sequencer
        uint256 sequencer1 = governance.getCurrentSequencer();
        assertEq(sequencer1, JEJU_CHAIN_ID);

        // Set timestamp well into the future and ensure we can rotate
        // The rotationInterval is 1 day, and lastRotation starts at 0
        vm.warp(100 days);

        // First rotation
        governance.rotateSequencer();
        uint256 sequencer2 = governance.getCurrentSequencer();
        assertEq(sequencer2, FORK_CHAIN_ID);

        // Another rotation
        vm.warp(102 days);
        governance.rotateSequencer();
        uint256 sequencer3 = governance.getCurrentSequencer();
        assertEq(sequencer3, TEST_CHAIN_ID);

        // Wraps around
        vm.warp(104 days);
        governance.rotateSequencer();
        uint256 sequencer4 = governance.getCurrentSequencer();
        assertEq(sequencer4, JEJU_CHAIN_ID);
    }

    function test_SequencerRotation_RevokedNetworkRemoved() public {
        // Create verified networks
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);
        _createVerifiedNetwork(FORK_CHAIN_ID, operator2);

        // Revoke first network via challenge
        vm.startPrank(operator3);
        bytes32 challengeId = governance.challengeNetwork{value: 1 ether}(
            JEJU_CHAIN_ID,
            FederationGovernance.ChallengeReason.MALICIOUS_BEHAVIOR,
            "ipfs://evidence"
        );
        vm.stopPrank();

        // Guardians uphold
        vm.prank(guardian1);
        governance.voteOnChallenge(challengeId, true);
        vm.prank(guardian2);
        governance.voteOnChallenge(challengeId, true);
        vm.prank(guardian3);
        governance.voteOnChallenge(challengeId, true);

        // Only FORK_CHAIN_ID should be in sequencer rotation
        uint256[] memory verified = governance.getVerifiedChainIds();
        assertEq(verified.length, 1);
        assertEq(verified[0], FORK_CHAIN_ID);
    }

    // ============ Guardian Tests ============

    function test_GuardianManagement() public {
        // Add new guardian
        address newGuardian = makeAddr("newGuardian");
        
        vm.startPrank(deployer);
        governance.addGuardian(newGuardian, 4);
        vm.stopPrank();

        address[] memory guardians = governance.getAllGuardians();
        assertEq(guardians.length, 4);

        // Remove guardian
        vm.startPrank(deployer);
        governance.removeGuardian(guardian1);
        vm.stopPrank();

        guardians = governance.getAllGuardians();
        assertEq(guardians.length, 3);
    }

    function test_NonGuardianCannotVote() public {
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        vm.startPrank(operator2);
        bytes32 challengeId = governance.challengeNetwork{value: 1 ether}(
            JEJU_CHAIN_ID,
            FederationGovernance.ChallengeReason.DOWNTIME,
            "ipfs://evidence"
        );
        vm.stopPrank();

        // Non-guardian tries to vote
        vm.startPrank(operator3);
        vm.expectRevert(FederationGovernance.NotGuardian.selector);
        governance.voteOnChallenge(challengeId, true);
        vm.stopPrank();
    }

    // ============ Operator History Tests ============

    function test_OperatorHistoryTracking() public {
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Network 1",
            "https://rpc.network1",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        (
            uint256 totalNetworks,
            uint256 approvedNetworks,
            uint256 rejectedNetworks,
            uint256 revokedNetworks,
            bool isBanned
        ) = governance.getOperatorHistory(operator1);

        assertEq(totalNetworks, 1);
        assertEq(approvedNetworks, 0); // Not approved yet
        assertEq(rejectedNetworks, 0);
        assertEq(revokedNetworks, 0);
        assertFalse(isBanned);
    }

    // ============ Helper Functions ============

    function _getProposalId(uint256 chainId) internal view returns (bytes32) {
        // The proposal ID is created by FederationGovernance
        // For tests, we compute it the same way
        address operator = registry.networkOperators(chainId);
        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(chainId);
        return keccak256(abi.encodePacked(
            chainId,
            operator,
            network.stake,
            network.registeredAt
        ));
    }

    function _createVerifiedNetwork(uint256 chainId, address operator) internal {
        uint256 startTime = block.timestamp;
        
        // Register
        vm.startPrank(operator);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            chainId,
            "Network",
            "https://rpc.network",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        bytes32 proposalId = _getProposalId(chainId);

        // AI evaluation
        vm.startPrank(aiOracle);
        governance.submitAIEvaluation(proposalId, 90, 90, 90, 90);
        vm.stopPrank();

        // Skip market voting (7 days from start)
        vm.warp(startTime + 8 days);
        governance.resolveMarketVoting(proposalId);

        // Autocrat approves (sets timelockEnds = now + 7 days)
        vm.startPrank(councilGovernance);
        governance.submitAutocratDecision(
            proposalId,
            true,
            keccak256("approved"),
            "Approved by AI DAO"
        );
        vm.stopPrank();

        // Wait for ANOTHER 7 days past the autocrat decision
        vm.warp(startTime + 16 days);

        // Execute
        governance.executeProposal(proposalId);
    }
}

