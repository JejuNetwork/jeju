// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/dispute/provers/CannonProver.sol";
import "../../src/dispute/provers/IMips.sol";

contract MockMIPS is IMIPS {
    bytes32 public returnValue;
    bool public shouldRevert;
    address public immutable oracleAddr;

    constructor(address _oracle) {
        oracleAddr = _oracle;
    }

    function setReturnValue(bytes32 value) external {
        returnValue = value;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function step(bytes calldata, bytes calldata, bytes32) external view returns (bytes32) {
        if (shouldRevert) revert("MIPS execution failed");
        return returnValue;
    }

    function oracle() external view returns (address) {
        return oracleAddr;
    }
}

contract MockPreimageOracle is IPreimageOracle {
    function readPreimage(bytes32, uint256) external pure returns (bytes32, uint256) {
        return (bytes32(0), 0);
    }

    function loadLocalData(uint256, bytes32, bytes32, uint256, uint256) external pure returns (bytes32) {
        return bytes32(0);
    }

    function loadKeccak256PreimagePart(uint256, bytes calldata) external pure returns (bytes32, uint256) {
        return (bytes32(0), 0);
    }

    function loadSha256PreimagePart(uint256, bytes calldata) external pure returns (bytes32, uint256) {
        return (bytes32(0), 0);
    }

    function loadBlobPreimagePart(uint256, uint256, bytes calldata, bytes calldata, uint256) external {}
}

contract CannonProverTest is Test {
    CannonProver public prover;
    MockMIPS public mockMips;
    MockPreimageOracle public mockOracle;

    bytes32 constant ABSOLUTE_PRESTATE = bytes32(uint256(1));

    function setUp() public {
        mockOracle = new MockPreimageOracle();
        mockMips = new MockMIPS(address(mockOracle));
        prover = new CannonProver(address(mockMips), address(mockOracle), ABSOLUTE_PRESTATE);
    }

    function testConstructor() public view {
        assertEq(address(prover.mips()), address(mockMips));
        assertEq(address(prover.preimageOracle()), address(mockOracle));
        assertEq(prover.absolutePrestate(), ABSOLUTE_PRESTATE);
        assertFalse(prover.isTestMode());
    }

    function testConstructorTestMode() public {
        // Deploy with placeholder addresses (no code)
        address placeholder1 = address(0x1234);
        address placeholder2 = address(0x5678);

        CannonProver testProver = new CannonProver(placeholder1, placeholder2, ABSOLUTE_PRESTATE);
        assertTrue(testProver.isTestMode());
    }

    function testProverType() public view {
        assertEq(prover.proverType(), "CANNON_MIPS_V1");
    }

    function testGetMips() public view {
        assertEq(prover.getMips(), address(mockMips));
    }

    function testGetPreimageOracle() public view {
        assertEq(prover.getPreimageOracle(), address(mockOracle));
    }

    function testVerifyProofFraudDetected() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 claimRoot = keccak256("claimed-post-state");
        bytes32 actualPostState = keccak256("actual-post-state");

        // Set MIPS to return a different state than claimed
        mockMips.setReturnValue(actualPostState);

        // Encode proof
        bytes memory proof = abi.encode(
            stateRoot, // preStateHash
            hex"deadbeef", // stateData
            hex"cafebabe" // proofData
        );

        // Fraud should be detected (actual != claimed)
        bool isFraud = prover.verifyProof(stateRoot, claimRoot, proof);
        assertTrue(isFraud, "Should detect fraud when states differ");
    }

    function testVerifyProofNoFraud() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 claimRoot = keccak256("post-state");

        // Set MIPS to return the claimed state (no fraud)
        mockMips.setReturnValue(claimRoot);

        bytes memory proof = abi.encode(stateRoot, hex"deadbeef", hex"cafebabe");

        // Should not detect fraud (states match)
        bool isFraud = prover.verifyProof(stateRoot, claimRoot, proof);
        assertFalse(isFraud, "Should not detect fraud when states match");
    }

    function testVerifyProofStateMismatch() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 wrongPreState = keccak256("wrong-pre-state");
        bytes32 claimRoot = keccak256("post-state");

        bytes memory proof = abi.encode(
            wrongPreState, // Mismatched pre-state
            hex"deadbeef",
            hex"cafebabe"
        );

        vm.expectRevert(CannonProver.StateTransitionInvalid.selector);
        prover.verifyProof(stateRoot, claimRoot, proof);
    }

    function testVerifyProofMipsFailure() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 claimRoot = keccak256("post-state");

        mockMips.setShouldRevert(true);

        bytes memory proof = abi.encode(stateRoot, hex"deadbeef", hex"cafebabe");

        vm.expectRevert(CannonProver.ProofExecutionFailed.selector);
        prover.verifyProof(stateRoot, claimRoot, proof);
    }

    function testVerifyDefenseProofValid() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 claimRoot = keccak256("post-state");

        // MIPS returns the claimed state (valid defense)
        mockMips.setReturnValue(claimRoot);

        bytes memory proof = abi.encode(stateRoot, hex"deadbeef", hex"cafebabe");

        bool isValid = prover.verifyDefenseProof(stateRoot, claimRoot, proof);
        assertTrue(isValid, "Defense should be valid when states match");
    }

    function testVerifyDefenseProofInvalid() public {
        bytes32 stateRoot = keccak256("pre-state");
        bytes32 claimRoot = keccak256("claimed-post-state");
        bytes32 actualState = keccak256("actual-post-state");

        // MIPS returns different state (invalid defense)
        mockMips.setReturnValue(actualState);

        bytes memory proof = abi.encode(stateRoot, hex"deadbeef", hex"cafebabe");

        bool isValid = prover.verifyDefenseProof(stateRoot, claimRoot, proof);
        assertFalse(isValid, "Defense should be invalid when states differ");
    }

    function testTestModeCannotVerify() public {
        // Deploy in test mode (placeholder addresses)
        address placeholder1 = address(0x1234);
        address placeholder2 = address(0x5678);
        CannonProver testProver = new CannonProver(placeholder1, placeholder2, ABSOLUTE_PRESTATE);

        bytes memory proof = abi.encode(bytes32(0), hex"", hex"");

        vm.expectRevert(CannonProver.TestModeCannotVerify.selector);
        testProver.verifyProof(bytes32(0), bytes32(0), proof);

        vm.expectRevert(CannonProver.TestModeCannotVerify.selector);
        testProver.verifyDefenseProof(bytes32(0), bytes32(0), proof);
    }

    function testFuzzVerifyProof(bytes32 preState, bytes32 claimRoot, bytes32 actualPost) public {
        vm.assume(preState != bytes32(0));
        vm.assume(claimRoot != bytes32(0));
        vm.assume(actualPost != bytes32(0));

        mockMips.setReturnValue(actualPost);

        bytes memory proof = abi.encode(preState, hex"00", hex"00");

        bool isFraud = prover.verifyProof(preState, claimRoot, proof);

        // Fraud detected if and only if actual != claimed
        assertEq(isFraud, actualPost != claimRoot);
    }
}
