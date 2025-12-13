// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/stage2/provers/Prover.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract DisputeGameFactoryTest is Test {
    using MessageHashUtils for bytes32;

    DisputeGameFactory public factory;
    Prover public proverContract;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public challenger1 = makeAddr("challenger1");
    address public challenger2 = makeAddr("challenger2");
    address public proposer = makeAddr("proposer");

    uint256 constant VALIDATOR1_KEY = 0x1;
    uint256 constant VALIDATOR2_KEY = 0x2;
    address validator1;
    address validator2;

    bytes32 public constant STATE_ROOT = keccak256("stateRoot");
    bytes32 public constant CLAIM_ROOT = keccak256("claimRoot");
    bytes32 public constant ACTUAL_POST_STATE = keccak256("actualPostState");
    bytes32 public constant INVALID_STATE_ROOT = keccak256("invalidStateRoot");
    bytes32 constant BLOCK_HASH = keccak256("blockHash");
    uint64 constant BLOCK_NUMBER = 12345;

    function setUp() public {
        validator1 = vm.addr(VALIDATOR1_KEY);
        validator2 = vm.addr(VALIDATOR2_KEY);
        
        proverContract = new Prover();
        factory = new DisputeGameFactory(treasury, owner);

        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(proverContract), true);

        vm.deal(challenger1, 100 ether);
        vm.deal(challenger2, 100 ether);
    }

    function _generateFraudProof(bytes32 stateRoot, bytes32 claimRoot) internal view returns (bytes memory) {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;
        
        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, stateRoot, ACTUAL_POST_STATE));
        bytes32 fraudHash = keccak256(abi.encodePacked(
            proverContract.FRAUD_DOMAIN(), stateRoot, claimRoot, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, outputRoot
        ));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);
        
        return proverContract.generateFraudProof(stateRoot, claimRoot, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures);
    }

    function _generateDefenseProof(bytes32 stateRoot, bytes32 claimRoot) internal view returns (bytes memory) {
        address[] memory signers = new address[](2);
        bytes[] memory signatures = new bytes[](2);
        signers[0] = validator1;
        signers[1] = validator2;
        
        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, stateRoot, claimRoot));
        bytes32 defenseHash = keccak256(abi.encodePacked(
            proverContract.DEFENSE_DOMAIN(), stateRoot, claimRoot, BLOCK_HASH, BLOCK_NUMBER, outputRoot
        ));
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(VALIDATOR1_KEY, defenseHash.toEthSignedMessageHash());
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VALIDATOR2_KEY, defenseHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        return proverContract.generateDefenseProof(stateRoot, claimRoot, BLOCK_HASH, BLOCK_NUMBER, signers, signatures);
    }

    function testCreateGame() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.challenger, challenger1);
        assertEq(game.proposer, proposer);
        assertEq(game.stateRoot, STATE_ROOT);
        assertEq(game.claimRoot, CLAIM_ROOT);
        assertEq(game.bondAmount, 1 ether);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.PENDING));
    }

    function testCreateGameMinimumBond() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.bondAmount, 1 ether);
    }

    function testCreateGameBelowMinimumBond() public {
        vm.prank(challenger1);
        vm.expectRevert(DisputeGameFactory.InsufficientBond.selector);
        factory.createGame{value: 0.5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testCreateGameAboveMaximumBond() public {
        vm.deal(challenger1, 200 ether);
        vm.prank(challenger1);
        vm.expectRevert(DisputeGameFactory.InvalidBond.selector);
        factory.createGame{value: 101 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testCreateGameMaximumBond() public {
        vm.deal(challenger1, 200 ether);
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 100 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.bondAmount, 100 ether);
    }

    function testCreateGameWithDisabledProver() public {
        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, address(proverContract), false);

        vm.prank(challenger1);
        vm.expectRevert(DisputeGameFactory.ProverNotEnabled.selector);
        factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );
    }

    function testCreateMultipleGames() public {
        vm.startPrank(challenger1);
        factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        factory.createGame{value: 2 ether}(
            proposer, INVALID_STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();

        bytes32[] memory activeGames = factory.getActiveGames();
        assertEq(activeGames.length, 2);
        assertEq(factory.totalBondsLocked(), 3 ether);
    }

    function testCreateGamePermissionless() public {
        address randomUser = makeAddr("random");
        vm.deal(randomUser, 10 ether);

        vm.prank(randomUser);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.challenger, randomUser);
    }

    function testResolveChallengerWins() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        uint256 challengerBalanceBefore = challenger1.balance;
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
        assertEq(game.winner, challenger1);
        assertGt(challenger1.balance, challengerBalanceBefore);
        assertEq(factory.totalBondsLocked(), 0);
    }

    function testResolveProposerWins() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        uint256 treasuryBalanceBefore = treasury.balance;
        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveProposerWins(gameId, defenseProof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.PROPOSER_WINS));
        assertEq(game.winner, proposer);
        assertEq(treasury.balance, treasuryBalanceBefore + 5 ether);
    }

    function testResolveTimeout() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.warp(block.timestamp + factory.GAME_TIMEOUT() + 1);
        uint256 treasuryBalanceBefore = treasury.balance;
        factory.resolveTimeout(gameId);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.TIMEOUT));
        assertEq(game.winner, proposer);
        assertEq(treasury.balance, treasuryBalanceBefore + 5 ether);
    }

    function testResolveTimeoutBeforeExpiry() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.warp(block.timestamp + factory.GAME_TIMEOUT() - 1);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveTimeout(gameId);
    }

    function testResolveAlreadyResolved() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        vm.expectRevert(DisputeGameFactory.GameAlreadyResolved.selector);
        factory.resolveChallengerWins(gameId, proof);
    }

    function testResolveNonExistentGame() public {
        bytes32 fakeId = keccak256("fake");
        vm.expectRevert(DisputeGameFactory.GameNotFound.selector);
        factory.resolveChallengerWins(fakeId, "proof");
    }

    function testSetProverImplementation() public {
        address newProver = makeAddr("newProver");
        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, newProver, true);

        assertEq(factory.proverImplementations(DisputeGameFactory.ProverType.SIMPLE), newProver);
        assertTrue(factory.proverEnabled(DisputeGameFactory.ProverType.SIMPLE));
    }

    function testMultipleProverTypes() public {
        address cannonProver = makeAddr("cannon");
        address simpleProver = makeAddr("simple");
        address altProver = makeAddr("alt");

        vm.startPrank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, cannonProver, true);
        factory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, simpleProver, true);
        factory.setProverImplementation(DisputeGameFactory.ProverType.ALTERNATIVE, altProver, true);
        vm.stopPrank();

        vm.prank(challenger1);
        bytes32 game1 = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.prank(challenger2);
        bytes32 game2 = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );

        DisputeGameFactory.DisputeGame memory g1 = factory.getGame(game1);
        DisputeGameFactory.DisputeGame memory g2 = factory.getGame(game2);
        assertEq(uint256(g1.proverType), uint256(DisputeGameFactory.ProverType.CANNON));
        assertEq(uint256(g2.proverType), uint256(DisputeGameFactory.ProverType.SIMPLE));
    }

    function testGetAllGameIds() public {
        vm.startPrank(challenger1);
        factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        factory.createGame{value: 1 ether}(
            proposer, INVALID_STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();

        bytes32[] memory allIds = factory.getAllGameIds();
        assertEq(allIds.length, 2);
    }

    function testGetActiveGames() public {
        vm.startPrank(challenger1);
        bytes32 game1 = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        bytes32 game2 = factory.createGame{value: 1 ether}(
            proposer, INVALID_STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();

        bytes32[] memory active = factory.getActiveGames();
        assertEq(active.length, 2);

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(game1, proof);

        active = factory.getActiveGames();
        assertEq(active.length, 1);
        assertEq(active[0], game2);
    }

    function testCanResolveTimeout() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        assertFalse(factory.canResolveTimeout(gameId));
        vm.warp(block.timestamp + factory.GAME_TIMEOUT() + 1);
        assertTrue(factory.canResolveTimeout(gameId));
    }

    function testGameIdUniqueness() public {
        vm.startPrank(challenger1);
        bytes32 game1 = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.warp(block.timestamp + 1);
        bytes32 game2 = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();
        assertNotEq(game1, game2);
    }

    function testConcurrentGameCreation() public {
        vm.prank(challenger1);
        factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.prank(challenger2);
        factory.createGame{value: 2 ether}(
            proposer, INVALID_STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        assertEq(factory.totalBondsLocked(), 3 ether);
        assertEq(factory.getActiveGames().length, 2);
    }

    function testBondLockedUntilResolution() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        assertEq(factory.totalBondsLocked(), 5 ether);
        assertEq(address(factory).balance, 5 ether);

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);
        assertEq(factory.totalBondsLocked(), 0);
    }

    function testFullGameLifecycle() public {
        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.PENDING));

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        uint256 challengerBalanceBefore = challenger1.balance;
        factory.resolveChallengerWins(gameId, proof);

        game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
        assertEq(game.winner, challenger1);
        assertGt(challenger1.balance, challengerBalanceBefore);
    }

    function testMultipleGamesDifferentOutcomes() public {
        vm.prank(challenger1);
        bytes32 game1 = factory.createGame{value: 5 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.prank(challenger2);
        bytes32 game2 = factory.createGame{value: 3 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof1 = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(game1, proof1);

        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveProposerWins(game2, defenseProof);

        DisputeGameFactory.DisputeGame memory g1 = factory.getGame(game1);
        DisputeGameFactory.DisputeGame memory g2 = factory.getGame(game2);
        assertEq(uint256(g1.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
        assertEq(uint256(g2.status), uint256(DisputeGameFactory.GameStatus.PROPOSER_WINS));
    }

    function testPausePreventsGameCreation() public {
        vm.prank(owner);
        factory.pause();

        vm.prank(challenger1);
        vm.expectRevert();
        factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testUnpauseAllowsGameCreation() public {
        vm.prank(owner);
        factory.pause();
        vm.prank(owner);
        factory.unpause();

        vm.prank(challenger1);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer, STATE_ROOT, CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        assertTrue(gameId != bytes32(0));
    }
}
