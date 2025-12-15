// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/cannon/CannonProver.sol";

/// @title MockMIPS
/// @notice Mock MIPS VM for testing CannonProver
contract MockMIPS {
    mapping(bytes32 => bytes32) public stepResults;
    bool public shouldFail;

    function setStepResult(bytes32 preStateHash, bytes32 postStateHash) external {
        stepResults[preStateHash] = postStateHash;
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function step(bytes calldata stateData, bytes calldata, bytes32) 
        external view returns (bytes32 postState) 
    {
        if (shouldFail) revert("MIPS: execution failed");
        
        bytes32 preStateHash = keccak256(stateData);
        postState = stepResults[preStateHash];
        
        // If no result set, compute a deterministic output
        if (postState == bytes32(0)) {
            postState = keccak256(abi.encodePacked(preStateHash, "step"));
        }
    }
}

/// @title MockPreimageOracle
/// @notice Mock preimage oracle for testing
contract MockPreimageOracle {
    mapping(bytes32 => bytes) public preimages;

    function setPreimage(bytes32 key, bytes calldata data) external {
        preimages[key] = data;
    }

    function readPreimage(bytes32 key, uint256 offset) 
        external view returns (bytes32 dat, uint256 datLen) 
    {
        bytes storage data = preimages[key];
        datLen = data.length;
        
        if (offset < datLen) {
            bytes memory chunk = new bytes(32);
            for (uint256 i = 0; i < 32 && offset + i < datLen; i++) {
                chunk[i] = data[offset + i];
            }
            dat = bytes32(chunk);
        }
    }

    function loadLocalData(uint256, bytes32, bytes32, uint256, uint256) 
        external pure returns (bytes32) 
    {
        return bytes32(0);
    }
}

contract CannonProverTest is Test {
    CannonProver public prover;
    MockMIPS public mips;
    MockPreimageOracle public oracle;

    function setUp() public {
        mips = new MockMIPS();
        oracle = new MockPreimageOracle();
        prover = new CannonProver(address(mips), address(oracle));
    }

    // =========================================================================
    // Constructor Tests
    // =========================================================================

    function test_Constructor_SetsAddresses() public view {
        assertEq(prover.getMIPS(), address(mips));
        assertEq(prover.getOracle(), address(oracle));
    }

    function test_Constructor_RevertsZeroMIPS() public {
        vm.expectRevert(CannonProver.InvalidMIPSContract.selector);
        new CannonProver(address(0), address(oracle));
    }

    function test_Constructor_RevertsZeroOracle() public {
        vm.expectRevert(CannonProver.InvalidOracleContract.selector);
        new CannonProver(address(mips), address(0));
    }

    // =========================================================================
    // Proof Verification Tests
    // =========================================================================

    function test_VerifyProof_ValidFraudProof() public {
        // Setup: Create state data and proof
        bytes memory stateData = hex"deadbeef";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        
        // Set up MIPS to return a specific post-state
        bytes32 realPostState = keccak256(abi.encodePacked(preStateRoot, "step"));
        mips.setStepResult(preStateRoot, realPostState);
        
        // Proposer claimed a WRONG post-state
        bytes32 claimedPostState = bytes32(uint256(1));
        
        // Encode proof
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        // Verification should return true (fraud detected)
        bool isFraud = prover.verifyProof(preStateRoot, claimedPostState, proof);
        assertTrue(isFraud, "Should detect fraud when post-state mismatches");
    }

    function test_VerifyProof_ValidDefenseNoFraud() public {
        bytes memory stateData = hex"deadbeef";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 realPostState = keccak256(abi.encodePacked(preStateRoot, "step"));
        
        mips.setStepResult(preStateRoot, realPostState);
        
        // Proposer claimed the CORRECT post-state
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        // Should return false (no fraud)
        bool isFraud = prover.verifyProof(preStateRoot, realPostState, proof);
        assertFalse(isFraud, "Should not detect fraud when post-state matches");
    }

    function test_VerifyProof_ExecutionFailure() public {
        bytes memory stateData = hex"badf00d0";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 claimedPostState = bytes32(uint256(1));
        
        // Make MIPS fail
        mips.setShouldFail(true);
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        // Should return true (execution failed = fraud if proposer claimed success)
        bool isFraud = prover.verifyProof(preStateRoot, claimedPostState, proof);
        assertTrue(isFraud, "Execution failure should be detected as fraud");
    }

    function test_VerifyProof_InvalidProofLength() public {
        bytes32 preStateRoot = bytes32(uint256(1));
        bytes32 postStateRoot = bytes32(uint256(2));
        bytes memory shortProof = hex"1234"; // Too short
        
        vm.expectRevert(CannonProver.InvalidProofData.selector);
        prover.verifyProof(preStateRoot, postStateRoot, shortProof);
    }

    function test_VerifyProof_PreStateMismatch() public view {
        bytes memory stateData = hex"deadbeef";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 wrongPreStateRoot = bytes32(uint256(999));
        bytes32 postStateRoot = bytes32(uint256(1));
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        bool isFraud = prover.verifyProof(wrongPreStateRoot, postStateRoot, proof);
        assertFalse(isFraud, "Pre-state mismatch should fail verification");
    }

    // =========================================================================
    // Defense Proof Tests
    // =========================================================================

    function test_VerifyDefenseProof_ValidDefense() public {
        bytes memory stateData = hex"cafebabe";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 realPostState = keccak256(abi.encodePacked(preStateRoot, "step"));
        
        mips.setStepResult(preStateRoot, realPostState);
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        bool isValid = prover.verifyDefenseProof(preStateRoot, realPostState, proof);
        assertTrue(isValid, "Defense should be valid when states match");
    }

    function test_VerifyDefenseProof_InvalidDefense() public view {
        bytes memory stateData = hex"cafebabe";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 wrongPostState = bytes32(uint256(12345));
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        bool isValid = prover.verifyDefenseProof(preStateRoot, wrongPostState, proof);
        assertFalse(isValid, "Defense should be invalid when states don't match");
    }

    function test_VerifyDefenseProof_ExecutionFails() public {
        bytes memory stateData = hex"cafebabe";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 postStateRoot = bytes32(uint256(1));
        
        mips.setShouldFail(true);
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        bool isValid = prover.verifyDefenseProof(preStateRoot, postStateRoot, proof);
        assertFalse(isValid, "Defense should be invalid if execution fails");
    }

    // =========================================================================
    // Bisection Game Tests
    // =========================================================================

    function test_StartBisection() public {
        bytes32 disputeId = keccak256("dispute1");
        bytes32 rootClaim = bytes32(uint256(100));
        
        prover.startBisection(disputeId, rootClaim);
        
        // Verify the dispute was started (claims array has length 1)
        (bytes32 stateHash, uint256 position, bool countered) = prover.disputes(disputeId, 0);
        assertEq(stateHash, rootClaim);
        assertEq(position, 1);
        assertFalse(countered);
    }

    function test_Bisect_Attack() public {
        bytes32 disputeId = keccak256("dispute2");
        bytes32 rootClaim = bytes32(uint256(200));
        
        prover.startBisection(disputeId, rootClaim);
        
        bytes32 intermediateClaim = bytes32(uint256(50));
        prover.bisect(disputeId, 0, intermediateClaim, true); // Attack
        
        // Check parent is countered
        (, , bool countered) = prover.disputes(disputeId, 0);
        assertTrue(countered);
        
        // Check new claim
        (bytes32 newStateHash, uint256 newPosition, ) = prover.disputes(disputeId, 1);
        assertEq(newStateHash, intermediateClaim);
        assertEq(newPosition, 2); // Left child: position * 2
    }

    function test_Bisect_Defend() public {
        bytes32 disputeId = keccak256("dispute3");
        bytes32 rootClaim = bytes32(uint256(300));
        
        prover.startBisection(disputeId, rootClaim);
        
        bytes32 intermediateClaim = bytes32(uint256(150));
        prover.bisect(disputeId, 0, intermediateClaim, false); // Defend
        
        (bytes32 newStateHash, uint256 newPosition, ) = prover.disputes(disputeId, 1);
        assertEq(newStateHash, intermediateClaim);
        assertEq(newPosition, 3); // Right child: position * 2 + 1
    }

    // =========================================================================
    // Constants Tests
    // =========================================================================

    function test_Constants() public view {
        assertEq(prover.MAX_GAME_DEPTH(), 73);
        assertEq(prover.STEP_GAS_LIMIT(), 400_000);
    }

    // =========================================================================
    // Gas Tests
    // =========================================================================

    function test_VerifyProof_GasUsage() public {
        bytes memory stateData = hex"deadbeefcafebabe";
        bytes memory memoryProof = hex"";
        bytes32 localContext = bytes32(0);
        
        bytes32 preStateRoot = keccak256(stateData);
        bytes32 postStateRoot = keccak256(abi.encodePacked(preStateRoot, "step"));
        
        mips.setStepResult(preStateRoot, postStateRoot);
        
        bytes memory proof = abi.encode(stateData, memoryProof, localContext);
        
        uint256 gasBefore = gasleft();
        prover.verifyProof(preStateRoot, postStateRoot, proof);
        uint256 gasUsed = gasBefore - gasleft();
        
        // Should use less than 500k gas
        assertLt(gasUsed, 500_000, "Verification should be gas efficient");
    }
}

