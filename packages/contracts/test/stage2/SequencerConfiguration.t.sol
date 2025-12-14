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
    
    // Timelock delay for batch submitter admin changes
    uint256 constant ADMIN_TIMELOCK_DELAY = 2 days;

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

        forcedInclusion = new ForcedInclusion(address(0x5678), address(registry), owner);

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

    /// @notice Helper to add a sequencer via propose + execute flow
    function _addSequencer(address seq) internal {
        vm.prank(owner);
        bytes32 changeId = batchSubmitter.proposeAddSequencer(seq);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        batchSubmitter.executeAddSequencer(changeId);
    }

    // =========================================================================
    // Sequencer Registry Configuration Tests
    // =========================================================================

    function test_SequencerRegistry_MinimumStakeIsPositive() public view {
        uint256 minStake = registry.MIN_STAKE();
        assertGt(minStake, 0, "Minimum stake must be positive");
    }

    function test_SequencerRegistry_MaxStakeIsGreaterThanMin() public view {
        uint256 minStake = registry.MIN_STAKE();
        uint256 maxStake = registry.MAX_STAKE();
        assertGt(maxStake, minStake, "Max stake must be greater than min stake");
    }

    function test_SequencerRegistry_SlashingIsEnabled() public view {
        uint256 doubleSignSlash = registry.SLASH_DOUBLE_SIGN();
        assertGt(doubleSignSlash, 0, "Double sign slashing must be enabled");
    }

    function test_SequencerRegistry_WithdrawDelayMeetsStage2Requirements() public view {
        // Stage 2 requires at least 7 days withdraw delay to allow for dispute resolution
        uint256 delay = registry.STAKE_WITHDRAWAL_DELAY();
        assertGe(delay, 7 days, "Withdraw delay must be >= 7 days for Stage 2");
    }

    function test_SequencerRegistry_MultipleSequencersCanRegister() public {
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);

        vm.prank(sequencer2);
        registry.register(agentId2, 1500 ether);

        vm.prank(sequencer3);
        registry.register(agentId3, 2000 ether);

        (address[] memory activeSeqs,) = registry.getActiveSequencers();
        assertEq(activeSeqs.length, 3, "Should have 3 active sequencers");
    }

    // =========================================================================
    // Threshold Batch Submitter Configuration Tests
    // =========================================================================

    function test_ThresholdBatchSubmitter_ThresholdMeetsStage2Requirements() public view {
        // Stage 2 requires threshold of at least 2 to prevent single point of failure
        uint256 threshold = batchSubmitter.threshold();
        assertGe(threshold, 2, "Threshold must be >= 2 for Stage 2");
    }

    function test_ThresholdBatchSubmitter_RequiresMultipleSigners() public {
        // Add sequencers via propose/execute flow
        _addSequencer(sequencer1);
        _addSequencer(sequencer2);
        _addSequencer(sequencer3);

        address[] memory seqs = batchSubmitter.getSequencers();
        assertGe(seqs.length, 3, "Should have at least 3 signers");
    }

    function test_ThresholdBatchSubmitter_SingleSignerCannotSubmit() public {
        _addSequencer(sequencer1);
        _addSequencer(sequencer2);

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
        // Emergency actions should still have some delay
        uint256 emergencyDelay = timelock.EMERGENCY_MIN_DELAY();
        assertGe(emergencyDelay, 7 days, "Emergency delay must be >= 7 days");
    }

    function test_GovernanceTimelock_SecurityCouncilIsSet() public view {
        address council = timelock.securityCouncil();
        assertTrue(council != address(0), "Security council must be set");
    }

    // =========================================================================
    // Dispute Game Factory Configuration Tests
    // =========================================================================

    function test_DisputeGameFactory_TimeoutMeetsStage2Requirements() public view {
        // Stage 2 requires adequate time for dispute resolution
        uint256 timeout = disputeFactory.GAME_TIMEOUT();
        assertGe(timeout, 7 days, "Game timeout must be >= 7 days for Stage 2");
    }

    function test_DisputeGameFactory_TreasuryIsConfigured() public view {
        address configuredTreasury = disputeFactory.treasury();
        assertEq(configuredTreasury, treasury, "Treasury must be properly configured");
    }

    function test_DisputeGameFactory_BondRequirementIsPositive() public view {
        uint256 minBond = disputeFactory.MIN_BOND();
        assertGt(minBond, 0, "Bond requirement must be positive");
    }

    // =========================================================================
    // Forced Inclusion Configuration Tests
    // =========================================================================

    function test_ForcedInclusion_InclusionWindowIsPositive() public view {
        uint256 window = forcedInclusion.INCLUSION_WINDOW_BLOCKS();
        assertGt(window, 0, "Inclusion window must be positive");
    }

    function test_ForcedInclusion_ExpiryWindowIsPositive() public view {
        uint256 expiry = forcedInclusion.EXPIRY_WINDOW();
        assertGt(expiry, 0, "Expiry window must be positive");
    }

    function test_ForcedInclusion_MinFeeIsPositive() public view {
        uint256 minFee = forcedInclusion.MIN_FEE();
        assertGt(minFee, 0, "Minimum queue fee must be positive");
    }

    // =========================================================================
    // Integration Configuration Tests
    // =========================================================================

    function test_FullStage2Configuration() public {
        // Register 3 sequencers in the registry
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);
        vm.prank(sequencer2);
        registry.register(agentId2, 1500 ether);
        vm.prank(sequencer3);
        registry.register(agentId3, 2000 ether);

        // Add as threshold signers via propose/execute
        _addSequencer(sequencer1);
        _addSequencer(sequencer2);
        _addSequencer(sequencer3);

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
        assertTrue(forcedInclusion.INCLUSION_WINDOW_BLOCKS() > 0, "Forced inclusion enabled");

        // 7. Slashing mechanism exists
        assertTrue(registry.SLASH_DOUBLE_SIGN() > 0, "Slashing enabled");
    }
}
