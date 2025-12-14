// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/stage2/GovernanceTimelock.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/stage2/provers/Prover.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract Stage2IntegrationTest is Test {
    using MessageHashUtils for bytes32;

    SequencerRegistry public sequencerRegistry;
    GovernanceTimelock public timelock;
    DisputeGameFactory public disputeFactory;
    Prover public prover;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockJEJU public jejuToken;

    address public owner = makeAddr("owner");
    address public governance = makeAddr("governance");
    address public securityCouncil = makeAddr("securityCouncil");
    address public treasury = makeAddr("treasury");
    address public sequencer1 = makeAddr("sequencer1");
    address public sequencer2 = makeAddr("sequencer2");
    address public challenger = makeAddr("challenger");

    uint256 constant VALIDATOR1_KEY = 0x1;
    uint256 constant VALIDATOR2_KEY = 0x2;
    address validator1;
    address validator2;

    uint256 public agentId1;
    uint256 public agentId2;

    bytes32 constant BLOCK_HASH = keccak256("blockHash");
    uint64 constant BLOCK_NUMBER = 12345;
    bytes32 constant ACTUAL_POST_STATE = keccak256("actualPostState");

    function _generateFraudProof(bytes32 stateRoot, bytes32 claimRoot) internal view returns (bytes memory) {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, stateRoot, ACTUAL_POST_STATE));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), stateRoot, claimRoot, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, outputRoot
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        return prover.generateFraudProof(
            stateRoot, claimRoot, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );
    }

    function setUp() public {
        validator1 = vm.addr(VALIDATOR1_KEY);
        validator2 = vm.addr(VALIDATOR2_KEY);

        vm.startPrank(owner);
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        jejuToken = new MockJEJU();
        prover = new Prover();

        // Deploy Stage 2 contracts
        sequencerRegistry = new SequencerRegistry(
            address(jejuToken), address(identityRegistry), address(reputationRegistry), treasury, owner
        );

        timelock = new GovernanceTimelock(governance, securityCouncil, owner, 2 hours);

        disputeFactory = new DisputeGameFactory(treasury, owner);
        disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(prover), true);

        // Transfer ownership to timelock for upgrade tests
        disputeFactory.transferOwnership(address(timelock));
        sequencerRegistry.transferOwnership(address(timelock));

        vm.stopPrank();

        // Register agents
        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");

        vm.prank(sequencer2);
        agentId2 = identityRegistry.register("ipfs://agent2");

        // Fund accounts
        jejuToken.mint(sequencer1, 100_000 ether);
        jejuToken.mint(sequencer2, 100_000 ether);
        vm.deal(challenger, 100 ether);
    }

    function testSequencerSlashingAffectsSelection() public {
        // Register 2 sequencers
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId2, 10000 ether);
        vm.stopPrank();

        (address[] memory addressesBefore,) = sequencerRegistry.getActiveSequencers();
        assertEq(addressesBefore.length, 2);

        // Slash sequencer1 via timelock (since ownership was transferred)
        bytes memory slashData = abi.encodeWithSelector(
            SequencerRegistry.slash.selector, sequencer1, SequencerRegistry.SlashingReason.DOUBLE_SIGNING
        );

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(sequencerRegistry), slashData, "Slash double signer");

        vm.warp(block.timestamp + 2 hours + 1);
        timelock.execute(proposalId);

        (address[] memory addressesAfter,) = sequencerRegistry.getActiveSequencers();
        assertEq(addressesAfter.length, 1);
        assertEq(addressesAfter[0], sequencer2);
    }

    // ============ Governance + Timelock Integration ============

    function testUpgradeSequencerRegistryViaTimelock() public {
        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Propose upgrade (would upgrade treasury address)
        address newTreasury = makeAddr("newTreasury");
        bytes memory data = abi.encodeWithSelector(SequencerRegistry.setTreasury.selector, newTreasury);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(sequencerRegistry), data, "Upgrade treasury");

        // Wait for timelock (2 hours)
        vm.warp(block.timestamp + 2 hours + 1);

        // Execute
        timelock.execute(proposalId);

        assertEq(sequencerRegistry.treasury(), newTreasury);
    }

    function testEmergencyBugfixViaTimelock() public {
        // Emergency bugfix has shorter delay
        address newTreasury = makeAddr("newTreasury");
        bytes memory data = abi.encodeWithSelector(DisputeGameFactory.setTreasury.selector, newTreasury);
        bytes32 bugProof = keccak256("bug exists");

        vm.prank(securityCouncil);
        bytes32 proposalId = timelock.proposeEmergencyBugfix(address(disputeFactory), data, "Fix bug", bugProof);

        uint256 emergencyDelay = timelock.EMERGENCY_MIN_DELAY();
        vm.warp(block.timestamp + emergencyDelay + 1);

        timelock.execute(proposalId);

        // Verify the treasury was updated
        assertEq(disputeFactory.treasury(), newTreasury);
    }

    // ============ Dispute + Sequencer Integration ============

    function testChallengeInvalidStateRoot() public {
        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Sequencer proposes invalid state root (simulated)
        bytes32 invalidStateRoot = keccak256("invalid");
        bytes32 claimRoot = keccak256("correct");

        // Anyone can challenge
        vm.prank(challenger);
        bytes32 gameId = disputeFactory.createGame{value: 5 ether}(
            sequencer1,
            invalidStateRoot,
            claimRoot,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(invalidStateRoot, claimRoot);
        disputeFactory.resolveChallengerWins(gameId, proof);

        // Challenger wins, gets bond back
        assertGt(challenger.balance, 95 ether); // Got bond back
    }

    // ============ Full Lifecycle Integration ============

    function testFullStage2Lifecycle() public {
        // 1. Register sequencers
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(sequencerRegistry), 15000 ether);
        sequencerRegistry.register(agentId2, 15000 ether);
        vm.stopPrank();

        // 2. Check selection weights
        uint256 weight1 = sequencerRegistry.getSelectionWeight(sequencer1);
        uint256 weight2 = sequencerRegistry.getSelectionWeight(sequencer2);
        assertGt(weight1, 0);
        assertGt(weight2, weight1); // seq2 has more stake

        // 3. Challenge invalid output
        bytes32 invalidRoot = keccak256("invalid");
        bytes32 claimRoot = keccak256("correct");
        vm.prank(challenger);
        bytes32 gameId = disputeFactory.createGame{value: 5 ether}(
            sequencer1,
            invalidRoot,
            claimRoot,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(invalidRoot, claimRoot);
        disputeFactory.resolveChallengerWins(gameId, proof);

        // 5. Propose upgrade via timelock
        address newTreasury = makeAddr("newTreasury");
        bytes memory upgradeData = abi.encodeWithSelector(SequencerRegistry.setTreasury.selector, newTreasury);
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(sequencerRegistry), upgradeData, "Upgrade");

        vm.warp(block.timestamp + 2 hours + 1);
        timelock.execute(proposalId);

        // 6. Verify upgrade took effect
        assertEq(sequencerRegistry.treasury(), newTreasury);

        // All systems working together
        (address[] memory sequencers,) = sequencerRegistry.getActiveSequencers();
        assertEq(sequencers.length, 2);
    }

    // ============ Edge Case Integration ============

    function testSequencerBannedViaIdentityRegistry() public {
        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        sequencerRegistry.unregister();
        vm.stopPrank();

        // Ban agent in IdentityRegistry
        vm.prank(owner);
        identityRegistry.banAgent(agentId1, "banned");

        // Try to register again (should fail)
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        vm.expectRevert(SequencerRegistry.AgentBanned.selector);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();
    }

    function testConcurrentOperations() public {
        // Multiple sequencers register concurrently
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        vm.stopPrank();

        vm.prank(sequencer1);
        sequencerRegistry.register(agentId1, 10000 ether);

        vm.prank(sequencer2);
        sequencerRegistry.register(agentId2, 10000 ether);

        // Multiple challenges concurrently
        bytes32 root1 = keccak256("root1");
        bytes32 root2 = keccak256("root2");

        vm.prank(challenger);
        disputeFactory.createGame{value: 1 ether}(
            sequencer1,
            root1,
            keccak256("claim1"),
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.deal(challenger, 200 ether);
        vm.prank(challenger);
        disputeFactory.createGame{value: 2 ether}(
            sequencer2,
            root2,
            keccak256("claim2"),
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        assertEq(disputeFactory.totalBondsLocked(), 3 ether);
        bytes32[] memory active = disputeFactory.getActiveGames();
        assertEq(active.length, 2);
    }
}
