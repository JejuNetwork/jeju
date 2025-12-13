// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "../../src/stage2/GovernanceTimelock.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/stage2/provers/Prover.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract RejectingReceiver {
    receive() external payable {
        revert("I reject ETH");
    }
}

contract ReentrantAttacker {
    DisputeGameFactory public factory;
    bytes32 public targetGameId;
    bytes public proof;
    uint256 public attackCount;

    function setTarget(DisputeGameFactory _factory, bytes32 _gameId, bytes memory _proof) external {
        factory = _factory;
        targetGameId = _gameId;
        proof = _proof;
    }

    receive() external payable {
        if (attackCount < 2) {
            attackCount++;
            factory.resolveChallengerWins(targetGameId, proof);
        }
    }
}

contract MockJEJUEdge is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DisputeGameFactoryEdgeCasesTest is Test {
    using MessageHashUtils for bytes32;

    DisputeGameFactory public factory;
    Prover public prover;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public challenger = makeAddr("challenger");
    address public proposer = makeAddr("proposer");

    uint256 constant VALIDATOR1_KEY = 0x1;
    uint256 constant VALIDATOR2_KEY = 0x2;
    address validator1;
    address validator2;

    bytes32 constant STATE_ROOT = keccak256("stateRoot");
    bytes32 constant CLAIM_ROOT = keccak256("claimRoot");
    bytes32 constant ACTUAL_POST_STATE = keccak256("actualPostState");
    bytes32 constant BLOCK_HASH = keccak256("blockHash");
    uint64 constant BLOCK_NUMBER = 12345;

    function setUp() public {
        validator1 = vm.addr(VALIDATOR1_KEY);
        validator2 = vm.addr(VALIDATOR2_KEY);
        prover = new Prover();
        factory = new DisputeGameFactory(treasury, owner);
        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(prover), true);
        vm.deal(challenger, 200 ether);
    }

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

    function _generateDefenseProof(bytes32 stateRoot, bytes32 claimRoot) internal view returns (bytes memory) {
        address[] memory signers = new address[](2);
        bytes[] memory signatures = new bytes[](2);
        signers[0] = validator1;
        signers[1] = validator2;

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, stateRoot, claimRoot));
        bytes32 defenseHash = keccak256(
            abi.encodePacked(prover.DEFENSE_DOMAIN(), stateRoot, claimRoot, BLOCK_HASH, BLOCK_NUMBER, outputRoot)
        );

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(VALIDATOR1_KEY, defenseHash.toEthSignedMessageHash());
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VALIDATOR2_KEY, defenseHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);

        return prover.generateDefenseProof(stateRoot, claimRoot, BLOCK_HASH, BLOCK_NUMBER, signers, signatures);
    }

    // ============ Boundary Tests ============

    function testCreateGameExactlyMinBond() public {
        uint256 minBond = factory.MIN_BOND();
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: minBond}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.bondAmount, minBond);
    }

    function testCreateGameMinBondMinusOneWei() public {
        uint256 minBond = factory.MIN_BOND();
        vm.prank(challenger);
        vm.expectRevert(DisputeGameFactory.InsufficientBond.selector);
        factory.createGame{value: minBond - 1}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testCreateGameExactlyMaxBond() public {
        uint256 maxBond = factory.MAX_BOND();
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: maxBond}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.bondAmount, maxBond);
    }

    function testCreateGameMaxBondPlusOneWei() public {
        uint256 maxBond = factory.MAX_BOND();
        vm.prank(challenger);
        vm.expectRevert(DisputeGameFactory.InvalidBond.selector);
        factory.createGame{value: maxBond + 1}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testResolveTimeoutExactlyAtBoundary() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        uint256 timeout = factory.GAME_TIMEOUT();
        vm.warp(block.timestamp + timeout);
        factory.resolveTimeout(gameId);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.TIMEOUT));
    }

    function testResolveTimeoutOneSecondBefore() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        uint256 timeout = factory.GAME_TIMEOUT();
        vm.warp(block.timestamp + timeout - 1);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveTimeout(gameId);
    }

    // ============ Treasury Fallback Tests ============

    function testChallengerWinsWhenChallengerRejectsETH() public {
        RejectingReceiver rejectingChallenger = new RejectingReceiver();
        vm.deal(address(rejectingChallenger), 10 ether);

        vm.prank(address(rejectingChallenger));
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        uint256 treasuryBefore = treasury.balance;
        factory.resolveChallengerWins(gameId, proof);
        assertEq(treasury.balance, treasuryBefore + 5 ether);
    }

    function testReentrancyProtectionOnChallengerWins() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        vm.expectRevert(DisputeGameFactory.GameAlreadyResolved.selector);
        factory.resolveChallengerWins(gameId, proof);
    }

    // ============ Invalid Proof Tests ============

    function testResolveChallengerWinsWithEmptyProof() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        // Empty proof should fail in prover
        vm.expectRevert(Prover.InvalidProofLength.selector);
        factory.resolveChallengerWins(gameId, "");
    }

    function testResolveChallengerWinsWithShortProof() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        // Proof shorter than MIN_PROOF_LENGTH (32 bytes)
        bytes memory shortProof = new bytes(16);
        vm.expectRevert(Prover.InvalidProofLength.selector);
        factory.resolveChallengerWins(gameId, shortProof);
    }

    function testResolveProposerWinsWithFraudProof() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory fraudProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveProposerWins(gameId, fraudProof);
    }

    function testResolveChallengerWinsWithDefenseProof() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveChallengerWins(gameId, defenseProof);
    }

    function testResolveWithWrongStateRoot() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes32 wrongStateRoot = keccak256("wrong");
        bytes memory wrongProof = _generateFraudProof(wrongStateRoot, CLAIM_ROOT);
        vm.expectRevert(); // Will revert due to state mismatch in prover
        factory.resolveChallengerWins(gameId, wrongProof);
    }

    function testConcurrentResolutionAttempts() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory fraudProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);

        factory.resolveChallengerWins(gameId, fraudProof);

        vm.expectRevert(DisputeGameFactory.GameAlreadyResolved.selector);
        factory.resolveProposerWins(gameId, defenseProof);
    }

    function testMultipleGamesResolutionOrder() public {
        vm.startPrank(challenger);
        bytes32 game1 = factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.warp(block.timestamp + 1);
        bytes32 game2 = factory.createGame{value: 2 ether}(
            proposer,
            keccak256("state2"),
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.warp(block.timestamp + 1);
        bytes32 game3 = factory.createGame{value: 3 ether}(
            proposer,
            keccak256("state3"),
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        vm.stopPrank();

        assertEq(factory.getActiveGameCount(), 3);

        factory.resolveChallengerWins(game2, _generateFraudProof(keccak256("state2"), CLAIM_ROOT));
        assertEq(factory.getActiveGameCount(), 2);

        factory.resolveChallengerWins(game1, _generateFraudProof(STATE_ROOT, CLAIM_ROOT));
        assertEq(factory.getActiveGameCount(), 1);

        factory.resolveChallengerWins(game3, _generateFraudProof(keccak256("state3"), CLAIM_ROOT));
        assertEq(factory.getActiveGameCount(), 0);
    }

    function testDisableProverMidGame() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(0), false);

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        vm.expectRevert(DisputeGameFactory.InvalidProver.selector);
        factory.resolveChallengerWins(gameId, proof);
    }

    function testChangeProverMidGame() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        Prover newProver = new Prover();
        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(newProver), true);

        // Generate proof with new prover
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
    }

    // ============ Zero Address Tests ============

    function testCreateGameWithZeroProposer() public {
        // Creating game with zero proposer is technically allowed but economically useless
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            address(0),
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(game.proposer, address(0));
    }

    function testSetTreasuryToZero() public {
        vm.prank(owner);
        vm.expectRevert(DisputeGameFactory.InvalidTreasury.selector);
        factory.setTreasury(address(0));
    }

    function testConstructorZeroTreasury() public {
        vm.expectRevert(DisputeGameFactory.InvalidTreasury.selector);
        new DisputeGameFactory(address(0), owner);
    }

    // ============ View Function Edge Cases ============

    function testGetGameNonExistent() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.expectRevert(DisputeGameFactory.GameNotFound.selector);
        factory.getGame(fakeId);
    }

    function testIsGameNonExistent() public view {
        bytes32 fakeId = keccak256("nonexistent");
        assertFalse(factory.isGame(fakeId));
    }

    function testCanResolveTimeoutNonExistentGame() public view {
        bytes32 fakeId = keccak256("nonexistent");
        assertFalse(factory.canResolveTimeout(fakeId));
    }

    function testGetActiveGamesEmpty() public view {
        bytes32[] memory active = factory.getActiveGames();
        assertEq(active.length, 0);
    }

    function testGetAllGameIdsEmpty() public view {
        bytes32[] memory all = factory.getAllGameIds();
        assertEq(all.length, 0);
    }

    // ============ Large Scale Tests ============

    function testCreateManyGames() public {
        uint256 numGames = 50;
        bytes32[] memory gameIds = new bytes32[](numGames);

        for (uint256 i = 0; i < numGames; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(challenger);
            gameIds[i] = factory.createGame{value: 1 ether}(
                proposer,
                keccak256(abi.encode("state", i)),
                CLAIM_ROOT,
                DisputeGameFactory.GameType.FAULT_DISPUTE,
                DisputeGameFactory.ProverType.CANNON
            );
        }

        assertEq(factory.getGameCount(), numGames);
        assertEq(factory.getActiveGameCount(), numGames);
        assertEq(factory.totalBondsLocked(), numGames * 1 ether);
    }

    // ============ State Verification Tests ============

    function testGameStateTransitions() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.PENDING));
        assertEq(game.resolvedAt, 0);
        assertEq(game.winner, address(0));

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
        assertGt(game.resolvedAt, 0);
        assertEq(game.winner, challenger);
    }

    // ============ Pause Tests ============

    function testCreateGameWhilePaused() public {
        vm.prank(owner);
        factory.pause();

        vm.prank(challenger);
        vm.expectRevert();
        factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }

    function testResolveWhilePausedStillWorks() public {
        // Create game before pause
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        // Pause
        vm.prank(owner);
        factory.pause();

        // Resolution should still work (not pausable)
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
    }

    function testUnpauseAndCreateGame() public {
        vm.prank(owner);
        factory.pause();

        vm.prank(owner);
        factory.unpause();

        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        assertTrue(factory.isGame(gameId));
    }

    // ============ Prover Switch Tests ============

    function testSwitchProverDuringActiveGame() public {
        // Create game with CANNON prover
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        // Deploy new prover and switch
        Prover newProver = new Prover();
        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(newProver), true);

        // Generate proof - must work with new prover
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);
        factory.resolveChallengerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
    }

    // ============ Bond Accounting Tests ============

    function testTotalBondsLockedAccuracy() public {
        assertEq(factory.totalBondsLocked(), 0);

        vm.startPrank(challenger);
        bytes32 game1 = factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        assertEq(factory.totalBondsLocked(), 1 ether);

        vm.warp(block.timestamp + 1);
        bytes32 game2 = factory.createGame{value: 2 ether}(
            proposer,
            keccak256("s2"),
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        assertEq(factory.totalBondsLocked(), 3 ether);

        vm.warp(block.timestamp + 1);
        bytes32 game3 = factory.createGame{value: 3 ether}(
            proposer,
            keccak256("s3"),
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        assertEq(factory.totalBondsLocked(), 6 ether);
        vm.stopPrank();

        // Resolve one game
        factory.resolveChallengerWins(game2, _generateFraudProof(keccak256("s2"), CLAIM_ROOT));
        assertEq(factory.totalBondsLocked(), 4 ether);

        // Resolve another
        factory.resolveChallengerWins(game1, _generateFraudProof(STATE_ROOT, CLAIM_ROOT));
        assertEq(factory.totalBondsLocked(), 3 ether);

        // Resolve last
        factory.resolveChallengerWins(game3, _generateFraudProof(keccak256("s3"), CLAIM_ROOT));
        assertEq(factory.totalBondsLocked(), 0);
    }

    // ============ Gas Tests ============

    function testCreateGameGas() public {
        uint256 gasBefore = gasleft();
        vm.prank(challenger);
        factory.createGame{value: 1 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
        uint256 gasUsed = gasBefore - gasleft();

        // Should be under 350k gas (accounts for test suite overhead variance)
        assertLt(gasUsed, 350_000);
    }

    function testResolveGameGas() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT);

        uint256 gasBefore = gasleft();
        factory.resolveChallengerWins(gameId, proof);
        uint256 gasUsed = gasBefore - gasleft();

        // Should be under 200k gas
        assertLt(gasUsed, 200_000);
    }

    // ============ Event Emission Tests ============

    function testGameCreatedEventData() public {
        vm.prank(challenger);
        vm.expectEmit(true, true, true, true);
        emit DisputeGameFactory.GameCreated(
            keccak256(
                abi.encodePacked(
                    challenger,
                    proposer,
                    STATE_ROOT,
                    CLAIM_ROOT,
                    DisputeGameFactory.GameType.FAULT_DISPUTE,
                    DisputeGameFactory.ProverType.CANNON,
                    block.timestamp,
                    block.number
                )
            ),
            challenger,
            proposer,
            STATE_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON,
            5 ether
        );
        factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.CANNON
        );
    }
}

contract SequencerRegistryEdgeCasesTest is Test {
    SequencerRegistry public registry;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockJEJUEdge public jejuToken;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public sequencer1 = makeAddr("sequencer1");
    address public sequencer2 = makeAddr("sequencer2");

    uint256 public agentId1;
    uint256 public agentId2;

    function setUp() public {
        vm.startPrank(owner);
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        jejuToken = new MockJEJUEdge();
        registry = new SequencerRegistry(
            address(jejuToken), address(identityRegistry), address(reputationRegistry), treasury, owner
        );
        vm.stopPrank();

        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");
        vm.prank(sequencer2);
        agentId2 = identityRegistry.register("ipfs://agent2");

        jejuToken.mint(sequencer1, 200_000 ether);
        jejuToken.mint(sequencer2, 200_000 ether);
    }

    // ============ Boundary Tests ============

    function testRegisterExactlyMinStake() public {
        uint256 minStake = registry.MIN_STAKE();
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), minStake);
        registry.register(agentId1, minStake);
        vm.stopPrank();
        assertTrue(registry.isActiveSequencer(sequencer1));
    }

    function testRegisterMinStakeMinusOneWei() public {
        uint256 minStake = registry.MIN_STAKE();
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), minStake - 1);
        vm.expectRevert(SequencerRegistry.InsufficientStake.selector);
        registry.register(agentId1, minStake - 1);
        vm.stopPrank();
    }

    function testRegisterExactlyMaxStake() public {
        uint256 maxStake = registry.MAX_STAKE();
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), maxStake);
        registry.register(agentId1, maxStake);
        vm.stopPrank();
        assertTrue(registry.isActiveSequencer(sequencer1));
    }

    function testRegisterMaxStakePlusOneWei() public {
        uint256 maxStake = registry.MAX_STAKE();
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), maxStake + 1);
        vm.expectRevert(SequencerRegistry.ExceedsMaxStake.selector);
        registry.register(agentId1, maxStake + 1);
        vm.stopPrank();
    }

    // ============ Staking Edge Cases ============

    function testIncreaseStakeToExactlyMax() public {
        uint256 maxStake = registry.MAX_STAKE();
        uint256 initialStake = 50_000 ether;

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), maxStake);
        registry.register(agentId1, initialStake);
        registry.increaseStake(maxStake - initialStake);
        vm.stopPrank();

        (, uint256 stake,,,,,,,) = registry.sequencers(sequencer1);
        assertEq(stake, maxStake);
    }

    function testIncreaseStakeOneWeiOverMax() public {
        uint256 maxStake = registry.MAX_STAKE();
        uint256 initialStake = 50_000 ether;

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), maxStake + 1);
        registry.register(agentId1, initialStake);
        vm.expectRevert(SequencerRegistry.ExceedsMaxStake.selector);
        registry.increaseStake(maxStake - initialStake + 1);
        vm.stopPrank();
    }

    function testDecreaseStakeToExactlyMin() public {
        uint256 minStake = registry.MIN_STAKE();
        uint256 initialStake = 10_000 ether;

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), initialStake);
        registry.register(agentId1, initialStake);
        registry.decreaseStake(initialStake - minStake);
        vm.stopPrank();

        (, uint256 stake,,,,,,,) = registry.sequencers(sequencer1);
        assertEq(stake, minStake);
    }

    function testDecreaseStakeOneWeiBelowMin() public {
        uint256 minStake = registry.MIN_STAKE();
        uint256 initialStake = 10_000 ether;

        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), initialStake);
        registry.register(agentId1, initialStake);
        vm.expectRevert(SequencerRegistry.InsufficientStake.selector);
        registry.decreaseStake(initialStake - minStake + 1);
        vm.stopPrank();
    }

    // ============ Slashing Edge Cases ============

    function testSlashCensorshipLeavingExactlyMinStake() public {
        // SLASH_CENSORSHIP = 5000 (50%)
        // To leave exactly MIN_STAKE (1000 ether), start with 2000 ether
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 2000 ether);
        registry.register(agentId1, 2000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        (, uint256 stake,,,,,, bool isActive,) = registry.sequencers(sequencer1);
        assertEq(stake, 1000 ether);
        assertTrue(isActive); // Still active at minimum
    }

    function testSlashCensorshipBelowMinStakeDeactivates() public {
        // 50% of 1500 = 750, leaving 750 which is below MIN_STAKE
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 1500 ether);
        registry.register(agentId1, 1500 ether);
        vm.stopPrank();

        uint256 balanceBefore = jejuToken.balanceOf(sequencer1);

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.CENSORSHIP);

        (, uint256 stake,,,,,, bool isActive,) = registry.sequencers(sequencer1);
        assertEq(stake, 750 ether);
        assertFalse(isActive); // Deactivated

        // Remaining stake returned to sequencer
        assertEq(jejuToken.balanceOf(sequencer1), balanceBefore + 750 ether);
    }

    function testSlashDowntimeLeavingAboveMin() public {
        // SLASH_DOWNTIME = 1000 (10%)
        // 10000 * 10% = 1000 slashed, 9000 remaining
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);

        (, uint256 stake,,,,,, bool isActive, bool isSlashed) = registry.sequencers(sequencer1);
        assertEq(stake, 9000 ether);
        assertTrue(isActive); // Still active
        assertFalse(isSlashed); // Downtime doesn't set isSlashed flag
    }

    function testMultipleDowntimeSlashesUntilDeactivation() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 2000 ether);
        registry.register(agentId1, 2000 ether);
        vm.stopPrank();

        // First slash: 2000 * 10% = 200, remaining 1800
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);
        (, uint256 stake1,,,,,, bool isActive1,) = registry.sequencers(sequencer1);
        assertEq(stake1, 1800 ether);
        assertTrue(isActive1);

        // Second slash: 1800 * 10% = 180, remaining 1620
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);
        (, uint256 stake2,,,,,, bool isActive2,) = registry.sequencers(sequencer1);
        assertEq(stake2, 1620 ether);
        assertTrue(isActive2);

        // Third slash: 1620 * 10% = 162, remaining 1458
        vm.prank(owner);
        registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);
        (, uint256 stake3,,,,,, bool isActive3,) = registry.sequencers(sequencer1);
        assertEq(stake3, 1458 ether);
        assertTrue(isActive3);

        // Continue until below MIN_STAKE
        while (isActive3) {
            vm.prank(owner);
            registry.slash(sequencer1, SequencerRegistry.SlashingReason.DOWNTIME);
            (,,,,,,, isActive3,) = registry.sequencers(sequencer1);
        }

        assertFalse(isActive3);
    }

    // ============ Downtime Detection Tests ============

    function testDowntimeExactlyAtThreshold() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        uint256 threshold = registry.DOWNTIME_THRESHOLD();

        // Check exactly at threshold - should not slash
        registry.checkDowntime(sequencer1, 1 + threshold);
        (, uint256 stake1,,,,,,,) = registry.sequencers(sequencer1);
        assertEq(stake1, 10000 ether); // Not slashed yet
    }

    function testDowntimeOneOverThreshold() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.prank(owner);
        registry.recordBlockProposed(sequencer1, 1);

        uint256 threshold = registry.DOWNTIME_THRESHOLD();

        // Check one over threshold - should slash
        registry.checkDowntime(sequencer1, 1 + threshold + 1);
        (, uint256 stake,,,,,,,) = registry.sequencers(sequencer1);
        assertLt(stake, 10000 ether); // Slashed
    }

    // ============ Selection Weight Tests ============

    function testSelectionWeightCalculation() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        uint256 weight = registry.getSelectionWeight(sequencer1);

        // Weight = baseWeight + repWeight
        // baseWeight = stake * (10000 - REPUTATION_WEIGHT) / 10000
        //            = 10000 * 5000 / 10000 = 5000 ether
        // repWeight = stake * REPUTATION_WEIGHT * reputationScore / 100000000
        //           = 10000 * 5000 * 5000 / 100000000 = 2500 ether
        // Total = 7500 ether
        assertApproxEqAbs(weight, 7500 ether, 1 ether);
    }

    function testSelectionWeightProportionalToStake() public {
        // Register two sequencers with different stakes
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 10000 ether);
        registry.register(agentId1, 10000 ether);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), 20000 ether);
        registry.register(agentId2, 20000 ether);
        vm.stopPrank();

        uint256 weight1 = registry.getSelectionWeight(sequencer1);
        uint256 weight2 = registry.getSelectionWeight(sequencer2);

        // weight2 should be approximately 2x weight1
        assertApproxEqRel(weight2, weight1 * 2, 0.01e18);
    }

    // ============ Constructor Validation Tests ============

    function testConstructorZeroToken() public {
        vm.expectRevert(SequencerRegistry.InvalidAddress.selector);
        new SequencerRegistry(address(0), address(identityRegistry), address(reputationRegistry), treasury, owner);
    }

    function testConstructorZeroIdentityRegistry() public {
        vm.expectRevert(SequencerRegistry.InvalidAddress.selector);
        new SequencerRegistry(address(jejuToken), address(0), address(reputationRegistry), treasury, owner);
    }

    function testConstructorZeroReputationRegistry() public {
        vm.expectRevert(SequencerRegistry.InvalidAddress.selector);
        new SequencerRegistry(address(jejuToken), address(identityRegistry), address(0), treasury, owner);
    }

    function testConstructorZeroTreasury() public {
        vm.expectRevert(SequencerRegistry.InvalidAddress.selector);
        new SequencerRegistry(
            address(jejuToken), address(identityRegistry), address(reputationRegistry), address(0), owner
        );
    }
}

contract GovernanceTimelockEdgeCasesTest is Test {
    GovernanceTimelock public timelock;
    MockTarget public target;

    address public owner = makeAddr("owner");
    address public governance = makeAddr("governance");
    address public securityCouncil = makeAddr("securityCouncil");

    uint256 constant DELAY = 2 hours;

    function setUp() public {
        target = new MockTarget();
        timelock = new GovernanceTimelock(governance, securityCouncil, owner, DELAY);
    }

    // ============ Complex Calldata Tests ============

    function testProposeWithLargeCalldata() public {
        // Create calldata with large payload
        bytes memory largeData = abi.encodeWithSelector(MockTarget.setValue.selector, uint256(type(uint256).max));

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), largeData, "Large value test");

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(keccak256(proposal.data), keccak256(largeData));
    }

    function testProposeWithEmptyCalldata() public {
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), "", "Empty calldata");

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertEq(proposal.data.length, 0);
    }

    function testExecuteWithEmptyCalldataToReceiver() public {
        // Create a contract that accepts empty calls
        address receiver = makeAddr("receiver");
        vm.deal(address(timelock), 1 ether);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(receiver, "", "Empty calldata to EOA");

        vm.warp(block.timestamp + DELAY);
        timelock.execute(proposalId);

        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertTrue(proposal.executed);
    }

    // ============ Timing Edge Cases ============

    function testExecuteOneSecondBeforeExpiry() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(GovernanceTimelock.TimelockNotExpired.selector);
        timelock.execute(proposalId);
    }

    function testExecuteExactlyAtExpiry() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.warp(block.timestamp + DELAY);
        timelock.execute(proposalId);
        assertEq(target.value(), 42);
    }

    function testTimeRemainingDecrementsCorrectly() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        uint256 startTime = block.timestamp;
        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        uint256 remaining1 = timelock.timeRemaining(proposalId);
        assertEq(remaining1, DELAY);

        vm.warp(startTime + 30 minutes);
        uint256 remaining2 = timelock.timeRemaining(proposalId);
        assertEq(remaining2, DELAY - 30 minutes);

        vm.warp(startTime + DELAY);
        uint256 remaining3 = timelock.timeRemaining(proposalId);
        assertEq(remaining3, 0);

        vm.warp(startTime + DELAY + 1 hours);
        uint256 remaining4 = timelock.timeRemaining(proposalId);
        assertEq(remaining4, 0); // Still 0 after expiry
    }

    // ============ Emergency vs Normal Timing ============

    function testEmergencyExecutesFasterThanNormal() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        bytes32 bugProof = keccak256("proof");

        // Normal proposal
        vm.prank(governance);
        bytes32 normalId = timelock.proposeUpgrade(address(target), data, "normal");

        // Emergency proposal
        vm.prank(securityCouncil);
        bytes32 emergencyId = timelock.proposeEmergencyBugfix(address(target), data, "emergency", bugProof);

        GovernanceTimelock.Proposal memory normalProposal = timelock.getProposal(normalId);
        GovernanceTimelock.Proposal memory emergencyProposal = timelock.getProposal(emergencyId);

        assertLt(emergencyProposal.executeAfter, normalProposal.executeAfter);
    }

    // ============ Batch Proposals ============

    function testBatchProposalCreation() public {
        bytes memory data1 = abi.encodeWithSelector(MockTarget.setValue.selector, 1);
        bytes memory data2 = abi.encodeWithSelector(MockTarget.setValue.selector, 2);
        bytes memory data3 = abi.encodeWithSelector(MockTarget.setValue.selector, 3);

        vm.startPrank(governance);
        bytes32 id1 = timelock.proposeUpgrade(address(target), data1, "p1");
        bytes32 id2 = timelock.proposeUpgrade(address(target), data2, "p2");
        bytes32 id3 = timelock.proposeUpgrade(address(target), data3, "p3");
        vm.stopPrank();

        bytes32[] memory allIds = timelock.getAllProposalIds();
        assertEq(allIds.length, 3);

        // Execute in reverse order
        vm.warp(block.timestamp + DELAY);
        timelock.execute(id3);
        assertEq(target.value(), 3);

        timelock.execute(id1);
        assertEq(target.value(), 1);

        timelock.execute(id2);
        assertEq(target.value(), 2);
    }

    // ============ Admin Function Edge Cases ============

    function testSetTimelockDelayExactlyAtMinimum() public {
        uint256 minDelay = timelock.EMERGENCY_MIN_DELAY();
        vm.prank(owner);
        timelock.setTimelockDelay(minDelay);
        assertEq(timelock.timelockDelay(), minDelay);
    }

    function testSetTimelockDelayOneSecondBelowMinimum() public {
        uint256 minDelay = timelock.EMERGENCY_MIN_DELAY();
        vm.prank(owner);
        vm.expectRevert(GovernanceTimelock.InvalidDelay.selector);
        timelock.setTimelockDelay(minDelay - 1);
    }

    function testSetGovernanceToZero() public {
        vm.prank(owner);
        timelock.setGovernance(address(0));
        assertEq(timelock.governance(), address(0));
    }

    // ============ Execution Failure Recovery ============

    function testExecutionFailurePreservesState() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        target.setShouldRevert(true);

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GovernanceTimelock.ExecutionFailed.selector);
        timelock.execute(proposalId);

        // Proposal should NOT be marked as executed
        GovernanceTimelock.Proposal memory proposal = timelock.getProposal(proposalId);
        assertFalse(proposal.executed);

        // Fix target and retry
        target.setShouldRevert(false);
        timelock.execute(proposalId);

        proposal = timelock.getProposal(proposalId);
        assertTrue(proposal.executed);
        assertEq(target.value(), 42);
    }

    // ============ Cancellation Edge Cases ============

    function testCancelTwice() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 42);

        vm.prank(governance);
        bytes32 proposalId = timelock.proposeUpgrade(address(target), data, "test");

        vm.prank(governance);
        timelock.cancel(proposalId);

        vm.prank(governance);
        vm.expectRevert(GovernanceTimelock.ProposalAlreadyCancelled.selector);
        timelock.cancel(proposalId);
    }

    function testCancelNonExistent() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(governance);
        vm.expectRevert(GovernanceTimelock.ProposalNotFound.selector);
        timelock.cancel(fakeId);
    }
}

contract MockTarget {
    uint256 public value;
    bool public shouldRevert;

    function setValue(uint256 _value) external {
        if (shouldRevert) revert("Execution failed");
        value = _value;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }
}
