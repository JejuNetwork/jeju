// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/stage2/ThresholdBatchSubmitter.sol";
import "../../src/stage2/GovernanceTimelock.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/stage2/ForcedInclusion.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";

contract MockJEJUConfig is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title SequencerConfigurationTest
/// @notice Tests that validate proper Stage 2 sequencer configuration
contract SequencerConfigurationTest is Test {
    SequencerRegistry public registry;
    ThresholdBatchSubmitter public batchSubmitter;
    GovernanceTimelock public timelock;
    DisputeGameFactory public disputeFactory;
    ForcedInclusion public forcedInclusion;

    MockJEJUConfig public token;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;

    address public owner = address(1);
    address public treasury = address(2);
    address public governance = address(3);
    address public securityCouncil = address(4);
    address public prover = address(5);

    // Test sequencers
    address public sequencer1;
    uint256 public sequencer1Key;
    address public sequencer2;
    uint256 public sequencer2Key;
    address public sequencer3;
    uint256 public sequencer3Key;

    uint256 public agentId1;
    uint256 public agentId2;
    uint256 public agentId3;

    function setUp() public {
        (sequencer1, sequencer1Key) = makeAddrAndKey("sequencer1");
        (sequencer2, sequencer2Key) = makeAddrAndKey("sequencer2");
        (sequencer3, sequencer3Key) = makeAddrAndKey("sequencer3");

        vm.startPrank(owner);

        // Deploy token
        token = new MockJEJUConfig();

        // Deploy identity and reputation registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));

        // Deploy Stage 2 contracts
        registry = new SequencerRegistry(
            address(token),
            address(identityRegistry),
            address(reputationRegistry),
            treasury,
            owner
        );

        batchSubmitter = new ThresholdBatchSubmitter(
            address(0x1234), // Mock batch inbox
            owner,
            2 // Threshold of 2
        );

        timelock = new GovernanceTimelock(governance, securityCouncil, owner, 30 days);

        disputeFactory = new DisputeGameFactory(treasury, owner);

        forcedInclusion = new ForcedInclusion(address(0x5678), address(registry));

        vm.stopPrank();

        // Register agents and setup sequencers
        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");
        vm.prank(sequencer2);
        agentId2 = identityRegistry.register("ipfs://agent2");
        vm.prank(sequencer3);
        agentId3 = identityRegistry.register("ipfs://agent3");

        // Fund and approve tokens
        token.mint(sequencer1, 20000 ether);
        token.mint(sequencer2, 20000 ether);
        token.mint(sequencer3, 20000 ether);

        vm.prank(sequencer1);
        token.approve(address(registry), 20000 ether);
        vm.prank(sequencer2);
        token.approve(address(registry), 20000 ether);
        vm.prank(sequencer3);
        token.approve(address(registry), 20000 ether);
    }

    // =========================================================================
    // Sequencer Registry Configuration Tests
    // =========================================================================

    function test_SequencerRegistry_MinStakeIsReasonable() public view {
        // MIN_STAKE should be at least 1000 ether for economic security
        assertGe(registry.MIN_STAKE(), 1000 ether, "MIN_STAKE too low for security");
    }

    function test_SequencerRegistry_MaxStakePreventsCentralization() public view {
        // MAX_STAKE should cap at 100,000 ether to prevent centralization
        assertLe(registry.MAX_STAKE(), 100000 ether, "MAX_STAKE too high, risks centralization");
    }

    function test_SequencerRegistry_SlashingPercentagesAreEffective() public view {
        // Double signing should have significant penalty (>=10%)
        assertGe(registry.SLASH_DOUBLE_SIGN(), 1000, "Double sign penalty too low");
        
        // Censorship penalty should be meaningful (>=5%)
        assertGe(registry.SLASH_CENSORSHIP(), 500, "Censorship penalty too low");
        
        // Downtime penalty should exist but be lower (>=1%)
        assertGe(registry.SLASH_DOWNTIME(), 100, "Downtime penalty too low");
    }

    function test_SequencerRegistry_ReputationWeightIsBalanced() public view {
        // Reputation weight should be significant but not dominant (20-50%)
        uint256 weight = registry.REPUTATION_WEIGHT();
        assertGe(weight, 2000, "Reputation weight too low");
        assertLe(weight, 5000, "Reputation weight too high");
    }

    function test_SequencerRegistry_CanRegisterMultipleSequencers() public {
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);

        vm.prank(sequencer2);
        registry.register(agentId2, 1000 ether);

        vm.prank(sequencer3);
        registry.register(agentId3, 1000 ether);

        (address[] memory addrs,) = registry.getActiveSequencers();
        assertEq(addrs.length, 3, "Should have 3 active sequencers");
    }

    function test_SequencerRegistry_SelectionWeightBasedOnStakeAndReputation() public {
        // Register with different stakes
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);

        vm.prank(sequencer2);
        registry.register(agentId2, 2000 ether);

        // Higher stake should have higher weight
        uint256 weight1 = registry.getSelectionWeight(sequencer1);
        uint256 weight2 = registry.getSelectionWeight(sequencer2);

        assertGt(weight2, weight1, "Higher stake should have higher weight");
    }

    // =========================================================================
    // Threshold Batch Submitter Configuration Tests
    // =========================================================================

    function test_ThresholdBatchSubmitter_ThresholdIsReasonable() public view {
        uint256 threshold = batchSubmitter.threshold();

        // Threshold should be at least 2 for true decentralization
        assertGe(threshold, 2, "Threshold must be >= 2 for Stage 2");
    }

    function test_ThresholdBatchSubmitter_RequiresMultipleSigners() public {
        // Add sequencers
        vm.startPrank(owner);
        batchSubmitter.addSequencer(sequencer1);
        batchSubmitter.addSequencer(sequencer2);
        batchSubmitter.addSequencer(sequencer3);
        vm.stopPrank();

        address[] memory seqs = batchSubmitter.getSequencers();
        assertGe(seqs.length, 3, "Should have at least 3 signers");
    }

    function test_ThresholdBatchSubmitter_SingleSignerCannotSubmit() public {
        vm.startPrank(owner);
        batchSubmitter.addSequencer(sequencer1);
        batchSubmitter.addSequencer(sequencer2);
        vm.stopPrank();

        // Try to submit with only 1 signature (threshold is 2)
        bytes memory batchData = "test batch";
        bytes32 digest = batchSubmitter.getBatchDigest(batchData);
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sequencer1Key, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        address[] memory signers = new address[](1);
        signers[0] = sequencer1;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InsufficientSignatures.selector, 1, 2));
        batchSubmitter.submitBatch(batchData, sigs, signers);
    }

    // =========================================================================
    // Governance Timelock Configuration Tests
    // =========================================================================

    function test_GovernanceTimelock_DelayMeetsStage2Requirements() public view {
        // Stage 2 requires 30-day timelock for upgrades
        uint256 delay = timelock.TIMELOCK_DELAY();
        assertGe(delay, 30 days, "Timelock delay must be >= 30 days for Stage 2");
    }

    function test_GovernanceTimelock_EmergencyDelayIsConstrained() public view {
        // Emergency delay should be at least 7 days
        uint256 emergencyDelay = timelock.EMERGENCY_MIN_DELAY();
        assertGe(emergencyDelay, 7 days, "Emergency delay must be >= 7 days");
    }

    function test_GovernanceTimelock_SecurityCouncilCannotBypassTimelock() public {
        bytes memory data = abi.encodeWithSignature("someAction()");
        bytes32 bugProof = keccak256("bug-proof");

        // Propose emergency bugfix
        vm.prank(securityCouncil);
        bytes32 proposalId = timelock.proposeEmergencyBugfix(address(this), data, "emergency", bugProof);

        // Cannot execute immediately (must wait EMERGENCY_MIN_DELAY)
        vm.expectRevert();
        timelock.execute(proposalId);
    }

    // =========================================================================
    // Dispute Game Factory Configuration Tests
    // =========================================================================

    function test_DisputeGameFactory_TreasuryIsConfigured() public view {
        address configuredTreasury = disputeFactory.treasury();
        assertTrue(configuredTreasury != address(0), "Treasury must be set");
    }

    function test_DisputeGameFactory_GameTimeoutIsReasonable() public view {
        uint256 timeout = disputeFactory.GAME_TIMEOUT();
        // Timeout should be at least 7 days for Stage 2
        assertGe(timeout, 7 days, "Game timeout must be >= 7 days");
    }
    
    function test_DisputeGameFactory_BondAmountsAreReasonable() public view {
        uint256 minBond = disputeFactory.MIN_BOND();
        uint256 maxBond = disputeFactory.MAX_BOND();
        // Min bond should prevent spam
        assertGe(minBond, 0.1 ether, "Min bond should prevent spam");
        // Max bond should not be prohibitive
        assertLe(maxBond, 1000 ether, "Max bond should not be prohibitive");
    }

    // =========================================================================
    // Forced Inclusion Configuration Tests
    // =========================================================================

    function test_ForcedInclusion_InclusionWindowIsReasonable() public view {
        uint256 window = forcedInclusion.INCLUSION_WINDOW();
        // Window should be reasonable (not too short, not too long)
        assertGe(window, 10, "Inclusion window too short");
        assertLe(window, 200, "Inclusion window too long");
    }

    function test_ForcedInclusion_MinFeePreventsDOS() public view {
        uint256 minFee = forcedInclusion.MIN_FEE();
        // Min fee should prevent spam but not be prohibitive
        assertGe(minFee, 0.0001 ether, "Min fee too low, DOS risk");
        assertLe(minFee, 0.1 ether, "Min fee too high, barrier to access");
    }

    // =========================================================================
    // Integration Configuration Tests
    // =========================================================================

    function test_FullStage2Configuration() public {
        // Register 3 sequencers
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);
        vm.prank(sequencer2);
        registry.register(agentId2, 1500 ether);
        vm.prank(sequencer3);
        registry.register(agentId3, 2000 ether);

        // Add as threshold signers
        vm.startPrank(owner);
        batchSubmitter.addSequencer(sequencer1);
        batchSubmitter.addSequencer(sequencer2);
        batchSubmitter.addSequencer(sequencer3);
        vm.stopPrank();

        // Verify configuration
        (address[] memory activeSeqs,) = registry.getActiveSequencers();
        assertEq(activeSeqs.length, 3, "Should have 3 active sequencers");
        
        address[] memory seqs = batchSubmitter.getSequencers();
        assertEq(seqs.length, 3, "Should have 3 threshold signers");
        assertGe(batchSubmitter.threshold(), 2, "Threshold should be at least 2");
        assertGe(timelock.TIMELOCK_DELAY(), 30 days, "Timelock should be 30+ days");
        assertGe(disputeFactory.GAME_TIMEOUT(), 7 days, "Game timeout should be 7+ days");
    }

    function test_Stage2ChecklistComplete() public view {
        // Stage 2 Decentralization Checklist
        
        // 1. Multiple sequencers can participate
        assertTrue(registry.MIN_STAKE() > 0, "Staking enabled");
        assertTrue(registry.MAX_STAKE() > registry.MIN_STAKE(), "Stake limits set");

        // 2. Threshold signing for batch submission
        assertTrue(batchSubmitter.threshold() >= 2, "Threshold >= 2");

        // 3. Governance timelock for upgrades
        assertTrue(timelock.TIMELOCK_DELAY() >= 30 days, "30+ day timelock");

        // 4. Emergency powers are constrained
        assertTrue(timelock.EMERGENCY_MIN_DELAY() >= 7 days, "Emergency delay constrained");

        // 5. Dispute mechanism exists
        assertTrue(disputeFactory.treasury() != address(0), "Treasury configured");
        assertTrue(disputeFactory.GAME_TIMEOUT() >= 7 days, "Game timeout adequate");

        // 6. Forced inclusion exists
        assertTrue(forcedInclusion.INCLUSION_WINDOW() > 0, "Forced inclusion enabled");

        // 7. Slashing mechanism exists
        assertTrue(registry.SLASH_DOUBLE_SIGN() > 0, "Slashing enabled");
    }
}

