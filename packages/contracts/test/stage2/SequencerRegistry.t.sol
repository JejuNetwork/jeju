// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SequencerRegistryTest is Test {
    SequencerRegistry public registry;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockJEJU public jejuToken;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public sequencer1 = makeAddr("sequencer1");
    address public sequencer2 = makeAddr("sequencer2");
    address public sequencer3 = makeAddr("sequencer3");
    address public nonSequencer = makeAddr("nonSequencer");

    uint256 public agentId1;
    uint256 public agentId2;
    uint256 public agentId3;

    function _getSequencerStake(address seq) internal view returns (uint256) {
        (, uint256 stake,,,,,,,) = registry.sequencers(seq);
        return stake;
    }

    function _getSequencer(address seq) internal view returns (SequencerRegistry.Sequencer memory) {
        (
            uint256 agentId,
            uint256 stake,
            uint256 reputationScore,
            uint256 registeredAt,
            uint256 lastBlockProposed,
            uint256 blocksProposed,
            uint256 blocksMissed,
            bool isActive,
            bool isSlashed
        ) = registry.sequencers(seq);

        return SequencerRegistry.Sequencer({
            agentId: agentId,
            stake: stake,
            reputationScore: reputationScore,
            registeredAt: registeredAt,
            lastBlockProposed: lastBlockProposed,
            blocksProposed: blocksProposed,
            blocksMissed: blocksMissed,
            isActive: isActive,
            isSlashed: isSlashed
        });
    }

    function setUp() public {
        vm.startPrank(owner);

        // Deploy dependencies
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        jejuToken = new MockJEJU();

        // Deploy registry
        registry = new SequencerRegistry(
            address(jejuToken), address(identityRegistry), address(reputationRegistry), treasury, owner
        );

        // Register agents
        vm.stopPrank();
        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");

        vm.prank(sequencer2);
        agentId2 = identityRegistry.register("ipfs://agent2");

        vm.prank(sequencer3);
        agentId3 = identityRegistry.register("ipfs://agent3");

        // Fund sequencers
        jejuToken.mint(sequencer1, 100_000 ether);
        jejuToken.mint(sequencer2, 100_000 ether);
        jejuToken.mint(sequencer3, 100_000 ether);
    }

    // ============ Registration Tests ============

    function testRegisterSuccess() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();

        (address[] memory addresses,) = registry.getActiveSequencers();
        assertEq(addresses.length, 1);
        assertEq(addresses[0], sequencer1);
        assertEq(registry.totalStaked(), 1000 ether);
        assertTrue(registry.isActiveSequencer(sequencer1));
    }

    function testRegisterMinimumStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether); // Exactly MIN_STAKE
        vm.stopPrank();

        assertTrue(registry.isActiveSequencer(sequencer1));
    }

    function testRegisterBelowMinimumStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 999 ether);
        vm.expectRevert(SequencerRegistry.InsufficientStake.selector);
        registry.register(agentId1, 999 ether);
        vm.stopPrank();
    }

    function testRegisterAboveMaximumStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 100_001 ether);
        vm.expectRevert(SequencerRegistry.ExceedsMaxStake.selector);
        registry.register(agentId1, 100_001 ether);
        vm.stopPrank();
    }

    function testRegisterMaximumStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 100_000 ether);
        registry.register(agentId1, 100_000 ether); // Exactly MAX_STAKE
        vm.stopPrank();

        assertTrue(registry.isActiveSequencer(sequencer1));
    }

    function testRegisterWithBannedAgent() public {
        vm.prank(owner);
        identityRegistry.banAgent(agentId1, "banned");

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        vm.expectRevert(SequencerRegistry.AgentBanned.selector);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();
    }

    function testRegisterWithNonExistentAgent() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        vm.expectRevert(SequencerRegistry.AgentNotRegistered.selector);
        registry.register(999, 1000 ether);
        vm.stopPrank();
    }

    function testRegisterWithWrongOwner() public {
        vm.startPrank(nonSequencer);
        jejuToken.approve(address(registry), 1000 ether);
        vm.expectRevert(SequencerRegistry.InvalidAgentId.selector);
        registry.register(agentId1, 1000 ether); // agentId1 owned by sequencer1
        vm.stopPrank();
    }

    function testRegisterTwice() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether);
        vm.expectRevert(SequencerRegistry.AlreadyRegistered.selector);
        registry.register(agentId1, 2000 ether);
        vm.stopPrank();
    }

    function testRegisterMultipleSequencers() public {
        // Register 3 sequencers
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 5000 ether);
        registry.register(agentId1, 5000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId2, 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer3);
        jejuToken.approve(address(registry), 15000 ether);
        registry.register(agentId3, 15000 ether);
        vm.stopPrank();

        (address[] memory addresses,) = registry.getActiveSequencers();
        assertEq(addresses.length, 3);
        assertEq(registry.totalStaked(), 30000 ether);
    }

    // ============ Staking Tests ============

    function testIncreaseStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 1000 ether);

        jejuToken.approve(address(registry), 5000 ether);
        registry.increaseStake(5000 ether);
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer1), 6000 ether);
        assertEq(registry.totalStaked(), 6000 ether);
    }

    function testIncreaseStakeExceedsMax() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 100_000 ether);
        registry.register(agentId1, 99_000 ether);

        jejuToken.approve(address(registry), 2000 ether);
        vm.expectRevert(SequencerRegistry.ExceedsMaxStake.selector);
        registry.increaseStake(2000 ether); // Would exceed MAX_STAKE
        vm.stopPrank();
    }

    function testDecreaseStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);

        registry.decreaseStake(5000 ether);
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer1), 5000 ether);
        assertEq(jejuToken.balanceOf(sequencer1), 95_000 ether); // 100k - 10k + 5k
    }

    function testDecreaseStakeBelowMinimum() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);

        vm.expectRevert(SequencerRegistry.InsufficientStake.selector);
        registry.decreaseStake(9500 ether); // Would go below MIN_STAKE
        vm.stopPrank();
    }

    function testDecreaseStakeToMinimum() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);

        registry.decreaseStake(9000 ether); // Exactly to MIN_STAKE
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer1), 1000 ether);
    }

    // ============ Unregistration Tests ============

    function testUnregister() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);

        uint256 balanceBefore = jejuToken.balanceOf(sequencer1);
        registry.unregister();
        vm.stopPrank();

        assertFalse(registry.isActiveSequencer(sequencer1));
        assertEq(jejuToken.balanceOf(sequencer1), balanceBefore + 10000 ether);
        assertEq(registry.totalStaked(), 0);
    }

    function testUnregisterWhenSlashed() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Slash sequencer
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOUBLE_SIGNING);

        vm.startPrank(sequencer1);
        vm.expectRevert(SequencerRegistry.AlreadySlashed.selector);
        registry.unregister();
        vm.stopPrank();
    }

    // ============ Block Production Tests ============

    function testRecordBlockProposed() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.lastBlockProposed, 1);
        assertEq(seq.blocksProposed, 1);
    }

    function testDoubleSigningDetection() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        // Try to record same block again (double-signing)
        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        // Should be slashed
        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertTrue(seq.isSlashed);
        assertEq(seq.stake, 0); // 100% slash
        assertEq(jejuToken.balanceOf(treasury), 10000 ether);
    }

    function testRecordBlockProposedWhenNotActive() public {
        vm.prank(owner);
        vm.expectRevert(SequencerRegistry.NotActive.selector);
        registry.recordBlockProposed(sequencer1, 1);
    }

    // ============ Slashing Tests ============

    function testSlashDoubleSigning() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        uint256 treasuryBefore = jejuToken.balanceOf(treasury);

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOUBLE_SIGNING);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 0); // 100% slash
        assertTrue(seq.isSlashed);
        assertFalse(seq.isActive);
        assertEq(jejuToken.balanceOf(treasury), treasuryBefore + 10000 ether);
    }

    function testSlashCensorship() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 5000 ether); // 50% slash
        assertEq(jejuToken.balanceOf(treasury), 5000 ether);
    }

    function testSlashDowntime() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 9000 ether); // 10% slash
        assertEq(jejuToken.balanceOf(treasury), 1000 ether);
    }

    function testSlashGovernanceBan() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.GOVERNANCE_BAN);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 0); // 100% slash
        assertTrue(seq.isSlashed);
        assertFalse(seq.isActive);
    }

    function testSlashPartialStakeBelowMinimum() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 2000 ether);
        registry.register(agentId1, 2000 ether);
        vm.stopPrank();

        // Slash 50% (1000 ether), leaving 1000 ether (exactly MIN_STAKE)
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 1000 ether);
        assertTrue(seq.isActive); // Still active at minimum

        // Slash again, goes below minimum
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        seq = _getSequencer(sequencer1);
        assertEq(seq.stake, 500 ether);
        assertFalse(seq.isActive); // Deactivated
        assertEq(jejuToken.balanceOf(sequencer1), 98_500 ether); // Remaining stake returned (100_000 - 2000 + 500)
    }

    function testSlashWhenNotActive() public {
        vm.prank(owner);
        vm.expectRevert(SequencerRegistry.NotActive.selector);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOUBLE_SIGNING);
    }

    function testSlashWhenAlreadySlashed() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOUBLE_SIGNING);

        vm.prank(owner);
        vm.expectRevert(SequencerRegistry.AlreadySlashed.selector);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);
    }

    // ============ Downtime Tests ============

    function testCheckDowntime() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Record block 1
        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        // Fast forward past threshold
        vm.roll(block.number + 101);

        vm.prank(owner);
        registry.checkDowntime(sequencer1, 102);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.blocksMissed, 101);
        // Should be slashed
        assertLt(seq.stake, 10000 ether);
    }

    function testCheckDowntimeWithinThreshold() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        vm.roll(block.number + 50); // Within threshold

        vm.prank(owner);
        registry.checkDowntime(sequencer1, 51);

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.blocksMissed, 50);
        assertEq(seq.stake, 10000 ether); // Not slashed yet
    }

    // ============ Reputation Tests ============

    function testReputationDefaultWhenNoFeedback() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();

        SequencerRegistry.Sequencer memory seq = _getSequencer(sequencer1);
        assertEq(seq.reputationScore, 5000); // Default 50%
    }

    // ============ Selection Weight Tests ============

    function testSelectionWeight() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        uint256 weight = registry.getSelectionWeight(sequencer1);
        assertGt(weight, 0);

        // Weight should be proportional to stake (with reputation factor)
        // Base: 10000 * 0.5 = 5000
        // Rep: 10000 * 0.5 * 0.5 = 2500
        // Total: ~7500
        assertApproxEqRel(weight, 7500 ether, 0.1e18); // 10% tolerance
    }

    function testSelectionWeightZeroWhenInactive() public view {
        uint256 weight = registry.getSelectionWeight(sequencer1);
        assertEq(weight, 0);
    }

    function testGetActiveSequencers() public {
        // Register 3 sequencers with different stakes
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 5000 ether);
        registry.register(agentId1, 5000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId2, 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer3);
        jejuToken.approve(address(registry), 15000 ether);
        registry.register(agentId3, 15000 ether);
        vm.stopPrank();

        (address[] memory addresses, uint256[] memory weights) = registry.getActiveSequencers();
        assertEq(addresses.length, 3);
        assertEq(weights.length, 3);

        // Weights should be proportional to stakes
        assertGt(weights[2], weights[1]); // sequencer3 > sequencer2
        assertGt(weights[1], weights[0]); // sequencer2 > sequencer1
    }

    // ============ Pause Tests ============

    function testPausePreventsRegistration() public {
        vm.prank(owner);
        registry.pause();

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        vm.expectRevert();
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();
    }

    function testPausePreventsStakeIncrease() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.pause();

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 5000 ether);
        vm.expectRevert();
        registry.increaseStake(5000 ether);
        vm.stopPrank();
    }

    function testUnpauseAllowsOperations() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(owner);
        registry.unpause();

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether); // Should work
        vm.stopPrank();
    }

    // ============ Edge Cases ============

    function testRegisterAtExactBoundaries() public {
        // Test MIN_STAKE
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        registry.register(agentId1, 1000 ether);
        vm.stopPrank();
        assertTrue(registry.isActiveSequencer(sequencer1));

        // Test MAX_STAKE
        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), 100_000 ether);
        registry.register(agentId2, 100_000 ether);
        vm.stopPrank();
        assertTrue(registry.isActiveSequencer(sequencer2));
    }

    function testMultipleSequencersConcurrentRegistration() public {
        // Simulate concurrent registration
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), 1000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer3);
        jejuToken.approve(address(registry), 1000 ether);
        vm.stopPrank();

        // Register concurrently (in same block)
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);

        vm.prank(sequencer2);
        registry.register(agentId2, 1000 ether);

        vm.prank(sequencer3);
        registry.register(agentId3, 1000 ether);

        (address[] memory addresses,) = registry.getActiveSequencers();
        assertEq(addresses.length, 3);
    }

    function testSlashingEvents() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        // Check slashing events array
        (,,, uint256 timestamp) = registry.slashingEvents(0);
        uint256 eventCount = timestamp > 0 ? 1 : 0;
        assertGt(eventCount, 0);
    }

    // ============ Integration Tests ============

    function testFullLifecycle() public {
        // 1. Register
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // 2. Increase stake
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 5000 ether);
        registry.increaseStake(5000 ether);
        vm.stopPrank();

        // 3. Record blocks
        for (uint256 i = 1; i <= 10; i++) {
            vm.prank(owner);
            registry.recordBlockProposed(sequencer1, i);
        }

        // 4. Update reputation
        vm.prank(sequencer1);
        registry.updateReputation(sequencer1);

        // 5. Get selection weight
        uint256 weight = registry.getSelectionWeight(sequencer1);
        assertGt(weight, 0);

        // 6. Unregister
        uint256 balanceBefore = jejuToken.balanceOf(sequencer1);
        vm.prank(sequencer1);
        registry.unregister();
        assertEq(jejuToken.balanceOf(sequencer1), balanceBefore + 15000 ether);
    }
}
