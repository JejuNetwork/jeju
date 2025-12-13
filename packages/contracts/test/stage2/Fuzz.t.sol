// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/stage2/GovernanceTimelock.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, type(uint128).max);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract Stage2FuzzTest is Test {
    SequencerRegistry public sequencerRegistry;
    GovernanceTimelock public timelock;
    DisputeGameFactory public disputeFactory;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockJEJU public jejuToken;

    address public owner = makeAddr("owner");
    address public governance = makeAddr("governance");
    address public treasury = makeAddr("treasury");

    function setUp() public {
        vm.startPrank(owner);
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        jejuToken = new MockJEJU();
        sequencerRegistry = new SequencerRegistry(
            address(jejuToken), address(identityRegistry), address(reputationRegistry), treasury, owner
        );
        timelock = new GovernanceTimelock(governance, makeAddr("council"), owner, 60);
        disputeFactory = new DisputeGameFactory(treasury, owner);
        vm.stopPrank();

        vm.prank(owner);
        disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, makeAddr("prover"), true);
    }

    function _getSequencerStake(address seq) internal view returns (uint256) {
        (, uint256 stake,,,,,,,) = sequencerRegistry.sequencers(seq);
        return stake;
    }

    function testFuzzRegisterStake(uint256 stake, address sequencer) public {
        vm.assume(stake >= 1000 ether && stake <= 100_000 ether);
        vm.assume(sequencer != address(0) && sequencer != owner);
        vm.assume(sequencer.code.length == 0); // EOA only, ERC721 requires receiver support

        vm.prank(sequencer);
        uint256 agentId = identityRegistry.register("ipfs://test");
        jejuToken.mint(sequencer, stake);

        vm.startPrank(sequencer);
        jejuToken.approve(address(sequencerRegistry), stake);
        sequencerRegistry.register(agentId, stake);
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer), stake);
        assertTrue(sequencerRegistry.isActiveSequencer(sequencer));
    }

    function testFuzzIncreaseStake(uint256 initialStake, uint256 increase) public {
        vm.assume(initialStake >= 1000 ether && initialStake <= 50_000 ether);
        vm.assume(increase > 0 && increase <= 100_000 ether);
        vm.assume(initialStake + increase <= 100_000 ether);

        address sequencer = makeAddr("sequencer");
        vm.prank(sequencer);
        uint256 agentId = identityRegistry.register("ipfs://test");
        jejuToken.mint(sequencer, initialStake + increase);

        vm.startPrank(sequencer);
        jejuToken.approve(address(sequencerRegistry), initialStake + increase);
        sequencerRegistry.register(agentId, initialStake);
        sequencerRegistry.increaseStake(increase);
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer), initialStake + increase);
    }

    function testFuzzDecreaseStake(uint256 initialStake, uint256 decrease) public {
        // Bound inputs to valid range
        initialStake = bound(initialStake, 2000 ether, 100_000 ether);
        decrease = bound(decrease, 1, initialStake - 1000 ether);

        address sequencer = makeAddr("sequencer");
        vm.prank(sequencer);
        uint256 agentId = identityRegistry.register("ipfs://test");
        jejuToken.mint(sequencer, initialStake);

        vm.startPrank(sequencer);
        jejuToken.approve(address(sequencerRegistry), initialStake);
        sequencerRegistry.register(agentId, initialStake);
        sequencerRegistry.decreaseStake(decrease);
        vm.stopPrank();

        assertEq(_getSequencerStake(sequencer), initialStake - decrease);
    }

    function testFuzzSelectionWeight(uint256 stake) public {
        vm.assume(stake >= 1000 ether && stake <= 100_000 ether);

        address sequencer = makeAddr("sequencer");
        vm.prank(sequencer);
        uint256 agentId = identityRegistry.register("ipfs://test");
        jejuToken.mint(sequencer, stake);

        vm.startPrank(sequencer);
        jejuToken.approve(address(sequencerRegistry), stake);
        sequencerRegistry.register(agentId, stake);
        vm.stopPrank();

        uint256 weight = sequencerRegistry.getSelectionWeight(sequencer);
        assertGt(weight, 0);
        assertLe(weight, stake);
    }

    function testFuzzProposeUpgrade(bytes calldata data) public {
        vm.assume(data.length <= 10000);

        // Use a contract address that exists (the timelock itself)
        address target = address(timelock);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(target, data, "test");

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(proposal.target, target);
        assertEq(keccak256(proposal.data), keccak256(data));
    }

    function testFuzzExecuteAfterDelay(uint256 delay) public {
        vm.assume(delay >= 60 && delay <= 365 days);

        bytes memory data = abi.encodeWithSelector(bytes4(0x12345678));
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(this), data, "test");

        vm.warp(block.timestamp + delay);
        bool canExec = timelock.canExecute(proposalId);
        assertEq(canExec, delay >= 60);
    }

    function testFuzzCreateGame(uint256 bond, bytes32 stateRoot, bytes32 claimRoot) public {
        vm.assume(bond >= 1 ether && bond <= 100 ether);
        address challenger = makeAddr("challenger");
        vm.deal(challenger, bond);

        vm.prank(challenger);
        bytes32 gameId = disputeFactory.createGame{value: bond}(
            makeAddr("proposer"),
            stateRoot,
            claimRoot,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        DisputeGameFactory.DisputeGame memory game = disputeFactory.getGame(gameId);
        assertEq(game.bondAmount, bond);
        assertEq(game.stateRoot, stateRoot);
        assertEq(game.claimRoot, claimRoot);
    }

    function testFuzzGameIdUniqueness(bytes32 stateRoot1, bytes32 stateRoot2, bytes32 claimRoot) public {
        vm.assume(stateRoot1 != stateRoot2);

        address challenger = makeAddr("challenger");
        vm.deal(challenger, 10 ether);

        vm.startPrank(challenger);
        bytes32 game1 = disputeFactory.createGame{value: 1 ether}(
            makeAddr("proposer"),
            stateRoot1,
            claimRoot,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.warp(block.timestamp + 1);
        bytes32 game2 = disputeFactory.createGame{value: 1 ether}(
            makeAddr("proposer"),
            stateRoot2,
            claimRoot,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();

        assertNotEq(game1, game2);
    }

    function testInvariantTotalStakedEqualsSum() public {
        address[] memory sequencers = new address[](3);
        uint256[] memory stakes = new uint256[](3);
        stakes[0] = 5000 ether;
        stakes[1] = 10000 ether;
        stakes[2] = 15000 ether;

        for (uint256 i = 0; i < 3; i++) {
            sequencers[i] = makeAddr(string(abi.encodePacked("seq", i)));
            vm.prank(sequencers[i]);
            uint256 agentId = identityRegistry.register("ipfs://test");
            jejuToken.mint(sequencers[i], stakes[i]);

            vm.startPrank(sequencers[i]);
            jejuToken.approve(address(sequencerRegistry), stakes[i]);
            sequencerRegistry.register(agentId, stakes[i]);
            vm.stopPrank();
        }

        uint256 total = sequencerRegistry.totalStaked();
        assertEq(total, 30000 ether);
    }

    function testInvariantBondsLockedEqualsActiveGames() public {
        address challenger = makeAddr("challenger");
        vm.deal(challenger, 100 ether);

        uint256 totalBonds = 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 bond = (i + 1) * 1 ether;
            totalBonds += bond;

            vm.prank(challenger);
            disputeFactory.createGame{value: bond}(
                makeAddr("proposer"),
                keccak256(abi.encode(i)),
                keccak256(abi.encode(i + 100)),
                DisputeGameFactory.GameType.FAULT_DISPUTE,
                DisputeGameFactory.ProverType.CANNON
            );
        }

        assertEq(disputeFactory.totalBondsLocked(), totalBonds);
        assertEq(disputeFactory.getActiveGames().length, 5);
    }
}
