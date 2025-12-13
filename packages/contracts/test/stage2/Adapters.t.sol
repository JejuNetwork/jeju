// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/L2OutputOracleAdapter.sol";
import "../../src/stage2/OptimismPortalAdapter.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/stage2/GovernanceTimelock.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/stage2/provers/Prover.sol";
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

contract L2OutputOracleAdapterTest is Test {
    L2OutputOracleAdapter public adapter;
    SequencerRegistry public sequencerRegistry;
    DisputeGameFactory public disputeFactory;
    Prover public prover;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockJEJU public jejuToken;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public sequencer1 = makeAddr("sequencer1");
    address public sequencer2 = makeAddr("sequencer2");
    address public challenger = makeAddr("challenger");
    address public l2OutputOracle = makeAddr("l2OutputOracle");

    uint256 public agentId1;

    function setUp() public {
        vm.startPrank(owner);

        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        jejuToken = new MockJEJU();
        prover = new Prover();

        sequencerRegistry = new SequencerRegistry(
            address(jejuToken),
            address(identityRegistry),
            address(reputationRegistry),
            treasury,
            owner
        );

        disputeFactory = new DisputeGameFactory(treasury, owner);
        disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(prover), true);

        adapter = new L2OutputOracleAdapter(
            address(sequencerRegistry),
            payable(address(disputeFactory)),
            l2OutputOracle
        );

        vm.stopPrank();

        // Register agent
        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");

        // Fund sequencer
        jejuToken.mint(sequencer1, 100_000 ether);
        vm.deal(challenger, 100 ether);
    }

    function testIsAuthorizedSequencer() public {
        // Not registered yet
        assertFalse(adapter.isAuthorizedSequencer(sequencer1));

        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Now authorized
        assertTrue(adapter.isAuthorizedSequencer(sequencer1));
    }

    function testGetSequencerWeight() public {
        // No weight before registration
        assertEq(adapter.getSequencerWeight(sequencer1), 0);

        // Register
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        // Now has weight
        assertGt(adapter.getSequencerWeight(sequencer1), 0);
    }

    function testGetActiveSequencers() public {
        (address[] memory seqs, uint256[] memory weights) = adapter.getActiveSequencers();
        assertEq(seqs.length, 0);

        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(sequencerRegistry), 10000 ether);
        sequencerRegistry.register(agentId1, 10000 ether);
        vm.stopPrank();

        (seqs, weights) = adapter.getActiveSequencers();
        assertEq(seqs.length, 1);
        assertEq(seqs[0], sequencer1);
        assertGt(weights[0], 0);
    }

    function testTransferOwnership() public {
        assertEq(adapter.owner(), owner);

        vm.prank(owner);
        adapter.transferOwnership(sequencer1);

        assertEq(adapter.owner(), sequencer1);
    }

    function testTransferOwnershipOnlyOwner() public {
        vm.prank(sequencer1);
        vm.expectRevert(L2OutputOracleAdapter.NotOwner.selector);
        adapter.transferOwnership(sequencer1);
    }
}

contract OptimismPortalAdapterTest is Test {
    OptimismPortalAdapter public adapter;
    GovernanceTimelock public timelock;

    address public owner = makeAddr("owner");
    address public governance = makeAddr("governance");
    address public securityCouncil = makeAddr("securityCouncil");
    address public portal = makeAddr("portal");

    uint256 constant TIMELOCK_DELAY = 2 hours;

    function setUp() public {
        vm.startPrank(owner);

        timelock = new GovernanceTimelock(governance, securityCouncil, owner, TIMELOCK_DELAY);
        adapter = new OptimismPortalAdapter(address(timelock), securityCouncil);

        vm.stopPrank();
    }

    function testSetPortalViaTimelock() public {
        // Propose through timelock
        bytes memory setPortalData = abi.encodeWithSelector(
            OptimismPortalAdapter.setPortal.selector,
            portal
        );

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(adapter), setPortalData, "Set portal");

        // Wait for timelock
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);

        // Execute
        timelock.execute(proposalId);

        assertEq(adapter.optimismPortal(), portal);
    }

    function testSetPortalOnlyTimelock() public {
        vm.prank(owner);
        vm.expectRevert(OptimismPortalAdapter.NotGovernanceTimelock.selector);
        adapter.setPortal(portal);
    }

    function testSetSecurityCouncilViaTimelock() public {
        address newCouncil = makeAddr("newCouncil");

        bytes memory data = abi.encodeWithSelector(
            OptimismPortalAdapter.setSecurityCouncil.selector,
            newCouncil
        );

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(adapter), data, "Update council");

        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        timelock.execute(proposalId);

        assertEq(adapter.securityCouncil(), newCouncil);
    }

    function testPauseOnlySecurityCouncil() public {
        // Set portal first via timelock
        bytes memory setPortalData = abi.encodeWithSelector(
            OptimismPortalAdapter.setPortal.selector,
            portal
        );

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(adapter), setPortalData, "Set portal");
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        timelock.execute(proposalId);

        // Now test pause
        vm.prank(owner);
        vm.expectRevert(OptimismPortalAdapter.NotSecurityCouncil.selector);
        adapter.pause();
    }

    function testRequiresTimelock() public view {
        // Upgrade functions require timelock
        assertTrue(adapter.requiresTimelock(bytes4(keccak256("upgradeTo(address)"))));
        assertTrue(adapter.requiresTimelock(bytes4(keccak256("upgradeToAndCall(address,bytes)"))));

        // Pause doesn't require timelock (emergency)
        assertFalse(adapter.requiresTimelock(bytes4(keccak256("pause()"))));

        // Unpause requires timelock
        assertTrue(adapter.requiresTimelock(bytes4(keccak256("unpause()"))));
    }

    function testGetStatus() public view {
        (address portalAddr, bool paused, uint256 delay) = adapter.getStatus();

        assertEq(portalAddr, address(0));
        assertFalse(paused);
        assertEq(delay, TIMELOCK_DELAY);
    }

    function testPortalNotSetRevert() public {
        bytes memory upgradeData = abi.encodeWithSelector(
            OptimismPortalAdapter.executeUpgrade.selector,
            ""
        );

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(adapter), upgradeData, "Test");

        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);

        vm.expectRevert();
        timelock.execute(proposalId);
    }
}
