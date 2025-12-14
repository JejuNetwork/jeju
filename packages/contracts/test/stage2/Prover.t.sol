// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/provers/Prover.sol";
import "../../src/stage2/DisputeGameFactory.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract ProverTest is Test {
    using MessageHashUtils for bytes32;

    Prover public prover;
    DisputeGameFactory public factory;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public challenger = makeAddr("challenger");
    address public proposer = makeAddr("proposer");

    // Test validator keys
    uint256 public constant VALIDATOR1_KEY = 0x1;
    uint256 public constant VALIDATOR2_KEY = 0x2;
    uint256 public constant VALIDATOR3_KEY = 0x3;
    address public validator1;
    address public validator2;
    address public validator3;

    bytes32 public constant STATE_ROOT = keccak256("stateRoot");
    bytes32 public constant CLAIM_ROOT = keccak256("claimRoot");
    bytes32 public constant ACTUAL_POST_STATE = keccak256("actualPostState");
    bytes32 public constant BLOCK_HASH = keccak256("blockHash");
    uint64 public constant BLOCK_NUMBER = 12345;

    function setUp() public {
        prover = new Prover();
        factory = new DisputeGameFactory(treasury, owner);

        validator1 = vm.addr(VALIDATOR1_KEY);
        validator2 = vm.addr(VALIDATOR2_KEY);
        validator3 = vm.addr(VALIDATOR3_KEY);

        vm.prank(owner);
        factory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, address(prover), true);
        vm.deal(challenger, 100 ether);
    }

    function _generateFraudProof(bytes32 stateRoot, bytes32 claimRoot, bytes32 actualPostState)
        internal
        view
        returns (bytes memory)
    {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, stateRoot, actualPostState));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), stateRoot, claimRoot, actualPostState, BLOCK_HASH, BLOCK_NUMBER, outputRoot
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        return prover.generateFraudProof(
            stateRoot, claimRoot, actualPostState, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
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

    function testGenerateFraudProof() public view {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        assertTrue(proof.length >= 138);
    }

    function testGenerateDefenseProof() public view {
        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        assertTrue(proof.length >= 138);
    }

    function testProofsDifferent() public view {
        bytes memory fraudProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, STATE_ROOT); // Defense needs matching states
        assertNotEq(keccak256(fraudProof), keccak256(defenseProof));
    }

    function testVerifyValidFraudProof() public view {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        assertTrue(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof));
    }

    function testVerifyValidDefenseProof() public view {
        // Defense proof: postStateRoot must match claimRoot
        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        assertTrue(prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, proof));
    }

    function testVerifyInvalidFraudProof_WrongProofType() public view {
        // Defense proof should NOT validate as fraud proof (wrong proofType)
        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        assertFalse(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, defenseProof));
    }

    function testVerifyInvalidDefenseProof_WrongProofType() public view {
        // Fraud proof should NOT validate as defense proof (wrong proofType)
        bytes memory fraudProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        assertFalse(prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, fraudProof));
    }

    function testVerifyProofWrongStateRoot() public {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        vm.expectRevert(Prover.StateMismatch.selector);
        prover.verifyProof(keccak256("wrong"), CLAIM_ROOT, proof);
    }

    function testVerifyFraudProof_StatesMatch_ReturnsFalse() public view {
        // If postStateRoot matches claimRoot, there's no fraud
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, CLAIM_ROOT);
        assertFalse(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof));
    }

    function testVerifyProofTooShort() public {
        vm.expectRevert(Prover.InvalidProofLength.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, new bytes(100));
    }

    function testVerifyDefenseProofTooShort() public {
        vm.expectRevert(Prover.InvalidProofLength.selector);
        prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, new bytes(100));
    }

    function testProverType() public view {
        assertEq(prover.proverType(), "JEJU_PROVER_V1");
    }

    function testVerifyProofInvalidSignature() public {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;
        signatures[0] = abi.encodePacked(bytes32(0), bytes32(0), uint8(27)); // Invalid sig

        bytes memory proof = prover.generateFraudProof(
            STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );

        // ECDSA library throws ECDSAInvalidSignature for invalid signature bytes
        vm.expectRevert();
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testVerifyDefenseProofInsufficientSignatures() public {
        // Defense requires 2 signatures, provide only 1 - should revert
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, STATE_ROOT, CLAIM_ROOT));
        bytes32 defenseHash = keccak256(
            abi.encodePacked(prover.DEFENSE_DOMAIN(), STATE_ROOT, CLAIM_ROOT, BLOCK_HASH, BLOCK_NUMBER, outputRoot)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, defenseHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        bytes memory proof =
            prover.generateDefenseProof(STATE_ROOT, CLAIM_ROOT, BLOCK_HASH, BLOCK_NUMBER, signers, signatures);
        vm.expectRevert(Prover.InsufficientSignatures.selector);
        prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testVerifyProofDuplicateSigner() public {
        address[] memory signers = new address[](2);
        bytes[] memory signatures = new bytes[](2);
        signers[0] = validator1;
        signers[1] = validator1; // Duplicate

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, STATE_ROOT, ACTUAL_POST_STATE));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, outputRoot
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);
        signatures[1] = abi.encodePacked(r, s, v);

        bytes memory proof = prover.generateFraudProof(
            STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );

        vm.expectRevert(Prover.DuplicateSigner.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testIntegrationChallengerWins() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );

        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        uint256 balanceBefore = challenger.balance;
        factory.resolveChallengerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.CHALLENGER_WINS));
        assertEq(game.winner, challenger);
        assertGt(challenger.balance, balanceBefore);
    }

    function testIntegrationProposerWins() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );

        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        uint256 treasuryBefore = treasury.balance;
        factory.resolveProposerWins(gameId, proof);

        DisputeGameFactory.DisputeGame memory game = factory.getGame(gameId);
        assertEq(uint256(game.status), uint256(DisputeGameFactory.GameStatus.PROPOSER_WINS));
        assertEq(game.winner, proposer);
        assertEq(treasury.balance, treasuryBefore + 5 ether);
    }

    function testIntegrationInvalidFraudProofFails() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );

        // Defense proof should NOT validate as fraud proof
        bytes memory wrongProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveChallengerWins(gameId, wrongProof);
    }

    function testIntegrationInvalidDefenseProofFails() public {
        vm.prank(challenger);
        bytes32 gameId = factory.createGame{value: 5 ether}(
            proposer,
            STATE_ROOT,
            CLAIM_ROOT,
            DisputeGameFactory.GameType.FAULT_DISPUTE,
            DisputeGameFactory.ProverType.SIMPLE
        );

        // Fraud proof should NOT validate as defense proof
        bytes memory wrongProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        vm.expectRevert(DisputeGameFactory.GameNotResolved.selector);
        factory.resolveProposerWins(gameId, wrongProof);
    }

    function testFuzzVerifyFraudProof(bytes32 stateRoot, bytes32 claimRoot, bytes32 actualPostState) public view {
        vm.assume(actualPostState != claimRoot); // Fraud requires different states

        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;

        bytes32 blockHash = keccak256(abi.encodePacked("fuzz_block", stateRoot));
        bytes32 outputRoot = keccak256(abi.encodePacked(blockHash, stateRoot, actualPostState));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), stateRoot, claimRoot, actualPostState, blockHash, BLOCK_NUMBER, outputRoot
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        bytes memory proof = prover.generateFraudProof(
            stateRoot, claimRoot, actualPostState, blockHash, BLOCK_NUMBER, signers, signatures
        );
        assertTrue(prover.verifyProof(stateRoot, claimRoot, proof));
    }

    function testFuzzVerifyDefenseProof(bytes32 stateRoot, bytes32 claimRoot) public view {
        address[] memory signers = new address[](2);
        bytes[] memory signatures = new bytes[](2);
        signers[0] = validator1;
        signers[1] = validator2;

        bytes32 blockHash = keccak256(abi.encodePacked("fuzz_block", stateRoot));
        bytes32 outputRoot = keccak256(abi.encodePacked(blockHash, stateRoot, claimRoot));
        bytes32 defenseHash = keccak256(
            abi.encodePacked(prover.DEFENSE_DOMAIN(), stateRoot, claimRoot, blockHash, BLOCK_NUMBER, outputRoot)
        );

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(VALIDATOR1_KEY, defenseHash.toEthSignedMessageHash());
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VALIDATOR2_KEY, defenseHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);

        bytes memory proof =
            prover.generateDefenseProof(stateRoot, claimRoot, blockHash, BLOCK_NUMBER, signers, signatures);
        assertTrue(prover.verifyDefenseProof(stateRoot, claimRoot, proof));
    }

    // ============ Boundary Tests ============

    function testVerifyProofExactMinLength() public view {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        // Proof should be at least 138 bytes
        assertTrue(proof.length >= 138);
        assertTrue(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof));
    }

    function testVerifyProofLength137Fails() public {
        // 137 is one less than minimum
        bytes memory shortProof = new bytes(137);
        vm.expectRevert(Prover.InvalidProofLength.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, shortProof);
    }

    function testVerifyProofLength138Passes() public view {
        // Build minimum valid proof structure manually
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        assertTrue(proof.length >= 138);
    }

    function testVerifyProofVersionZero() public {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        // Manually corrupt version byte to 0
        proof[0] = 0x00;
        vm.expectRevert(Prover.InvalidProofVersion.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testVerifyProofVersionTwo() public {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        // Manually corrupt version byte to 2
        proof[0] = 0x02;
        vm.expectRevert(Prover.InvalidProofVersion.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testVerifyDefenseProofStateMismatch() public {
        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        // Call with wrong stateRoot
        vm.expectRevert(Prover.StateMismatch.selector);
        prover.verifyDefenseProof(keccak256("wrong"), CLAIM_ROOT, proof);
    }

    function testVerifyDefenseProofPostStateMismatch() public view {
        // Defense proof where postStateRoot doesn't match claimRoot returns false
        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        // Since the defense proof encodes CLAIM_ROOT as postState, this should return true
        // But if we call with different claimRoot, postState won't match
        assertFalse(prover.verifyDefenseProof(STATE_ROOT, keccak256("different"), proof));
    }

    // ============ Signature Edge Cases ============

    function testVerifyProofWithManyValidators() public view {
        // Test with 3 validators (more than minimum)
        address[] memory signers = new address[](3);
        bytes[] memory signatures = new bytes[](3);
        signers[0] = validator1;
        signers[1] = validator2;
        signers[2] = validator3;

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, STATE_ROOT, ACTUAL_POST_STATE));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, outputRoot
            )
        );

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(VALIDATOR1_KEY, fraudHash.toEthSignedMessageHash());
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VALIDATOR2_KEY, fraudHash.toEthSignedMessageHash());
        (uint8 v3, bytes32 r3, bytes32 s3) = vm.sign(VALIDATOR3_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        signatures[2] = abi.encodePacked(r3, s3, v3);

        bytes memory proof = prover.generateFraudProof(
            STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );
        assertTrue(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof));
    }

    function testVerifyProofSignatureWrongMessage() public {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1;

        // Sign a completely different message
        bytes32 wrongMessage = keccak256("wrong message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR1_KEY, wrongMessage.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        bytes memory proof = prover.generateFraudProof(
            STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );

        // Signature is valid but for wrong message, so recovered address won't match
        vm.expectRevert(Prover.InvalidSignature.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    function testVerifyProofSignatureWrongSigner() public {
        address[] memory signers = new address[](1);
        bytes[] memory signatures = new bytes[](1);
        signers[0] = validator1; // Claim to be validator1

        bytes32 outputRoot = keccak256(abi.encodePacked(BLOCK_HASH, STATE_ROOT, ACTUAL_POST_STATE));
        bytes32 fraudHash = keccak256(
            abi.encodePacked(
                prover.FRAUD_DOMAIN(), STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, outputRoot
            )
        );

        // But sign with validator2's key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR2_KEY, fraudHash.toEthSignedMessageHash());
        signatures[0] = abi.encodePacked(r, s, v);

        bytes memory proof = prover.generateFraudProof(
            STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE, BLOCK_HASH, BLOCK_NUMBER, signers, signatures
        );

        vm.expectRevert(Prover.InvalidSignature.selector);
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
    }

    // ============ Domain Separation Tests ============

    function testFraudAndDefenseDomainsAreDifferent() public view {
        assertNotEq(prover.FRAUD_DOMAIN(), prover.DEFENSE_DOMAIN());
    }

    function testCrossProofTypeRejection() public view {
        // Fraud proof should not validate as defense proof
        bytes memory fraudProof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        assertFalse(prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, fraudProof));

        // Defense proof should not validate as fraud proof
        bytes memory defenseProof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        assertFalse(prover.verifyProof(STATE_ROOT, CLAIM_ROOT, defenseProof));
    }

    // ============ Gas Measurement Tests ============

    uint256 private _gasUsed;

    function testVerifyFraudProofGas() public {
        bytes memory proof = _generateFraudProof(STATE_ROOT, CLAIM_ROOT, ACTUAL_POST_STATE);
        uint256 gasBefore = gasleft();
        prover.verifyProof(STATE_ROOT, CLAIM_ROOT, proof);
        _gasUsed = gasBefore - gasleft();
        assertLt(_gasUsed, 100_000);
    }

    function testVerifyDefenseProofGas() public {
        bytes memory proof = _generateDefenseProof(STATE_ROOT, CLAIM_ROOT);
        uint256 gasBefore = gasleft();
        prover.verifyDefenseProof(STATE_ROOT, CLAIM_ROOT, proof);
        _gasUsed = gasBefore - gasleft();
        assertLt(_gasUsed, 150_000);
    }
}
