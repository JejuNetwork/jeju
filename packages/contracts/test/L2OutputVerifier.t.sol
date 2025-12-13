// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {L2OutputVerifier, IL2OutputOracle} from "../src/eil/L2OutputVerifier.sol";

/// @title MockL2OutputOracle
/// @notice Mock L2OutputOracle for testing
contract MockL2OutputOracle {
    mapping(uint256 => IL2OutputOracle.OutputProposal) public outputs;
    uint256 public outputCount;
    uint256 public _startingBlockNumber = 1000;
    uint256 public _latestBlockNumber = 1000;

    function addOutput(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber) external {
        outputs[outputCount] =
            IL2OutputOracle.OutputProposal({outputRoot: outputRoot, timestamp: timestamp, l2BlockNumber: l2BlockNumber});
        outputCount++;
        if (l2BlockNumber > _latestBlockNumber) {
            _latestBlockNumber = l2BlockNumber;
        }
    }

    function getL2Output(uint256 _l2OutputIndex) external view returns (IL2OutputOracle.OutputProposal memory) {
        return outputs[_l2OutputIndex];
    }

    function getL2OutputIndexAfter(uint256 _l2BlockNumber) external view returns (uint256) {
        // Simple linear search for testing
        for (uint256 i = 0; i < outputCount; i++) {
            if (outputs[i].l2BlockNumber >= _l2BlockNumber) {
                return i;
            }
        }
        revert("Block not found");
    }

    function latestOutputIndex() external view returns (uint256) {
        return outputCount > 0 ? outputCount - 1 : 0;
    }

    function startingBlockNumber() external view returns (uint256) {
        return _startingBlockNumber;
    }

    function latestBlockNumber() external view returns (uint256) {
        return _latestBlockNumber;
    }
}

contract L2OutputVerifierTest is Test {
    L2OutputVerifier public verifier;
    MockL2OutputOracle public mockOracle;

    address public owner;
    uint256 constant BASE_CHAIN_ID = 8453;
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function setUp() public {
        owner = address(this);

        // Warp to a reasonable timestamp to avoid underflow
        vm.warp(1_000_000_000); // ~2001

        verifier = new L2OutputVerifier();
        mockOracle = new MockL2OutputOracle();
    }

    // ============ Registration Tests ============

    function test_RegisterOracle() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        assertEq(verifier.getOracle(BASE_CHAIN_ID), address(mockOracle));
        assertEq(verifier.getFinalityDelay(BASE_CHAIN_ID), 7 days);
        assertFalse(verifier.isZKChain(BASE_CHAIN_ID));
    }

    function test_RegisterZKOracle() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), true);

        assertEq(verifier.getOracle(BASE_CHAIN_ID), address(mockOracle));
        assertEq(verifier.getFinalityDelay(BASE_CHAIN_ID), 1 hours);
        assertTrue(verifier.isZKChain(BASE_CHAIN_ID));
    }

    function test_SetFinalityDelay() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);
        verifier.setFinalityDelay(BASE_CHAIN_ID, 3 days);

        assertEq(verifier.getFinalityDelay(BASE_CHAIN_ID), 3 days);
    }

    function test_OnlyOwnerCanRegister() public {
        address notOwner = address(0x123);
        vm.prank(notOwner);
        vm.expectRevert();
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);
    }

    // ============ Verification Tests ============

    function test_VerifyBlockExists_NotRegistered() public view {
        (bool exists, bool finalized, bytes32 outputRoot) = verifier.verifyBlockExists(BASE_CHAIN_ID, 1000);

        assertFalse(exists);
        assertFalse(finalized);
        assertEq(outputRoot, bytes32(0));
    }

    function test_VerifyBlockExists_NotCommitted() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Add output for block 2000
        bytes32 testOutputRoot = keccak256("test output root");
        mockOracle.addOutput(testOutputRoot, uint128(block.timestamp), 2000);

        // Query block 3000 (not committed)
        (bool exists, bool finalized, bytes32 outputRoot) = verifier.verifyBlockExists(BASE_CHAIN_ID, 3000);

        assertFalse(exists);
        assertFalse(finalized);
        assertEq(outputRoot, bytes32(0));
    }

    function test_VerifyBlockExists_NotFinalized() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Add output at current timestamp
        bytes32 testOutputRoot = keccak256("test output root");
        mockOracle.addOutput(testOutputRoot, uint128(block.timestamp), 2000);

        (bool exists, bool finalized, bytes32 outputRoot) = verifier.verifyBlockExists(BASE_CHAIN_ID, 2000);

        assertTrue(exists);
        assertFalse(finalized); // Not 7 days old yet
        assertEq(outputRoot, testOutputRoot);
    }

    function test_VerifyBlockExists_Finalized() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Add output at timestamp 8 days ago
        bytes32 testOutputRoot = keccak256("test output root");
        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        mockOracle.addOutput(testOutputRoot, oldTimestamp, 2000);

        (bool exists, bool finalized, bytes32 outputRoot) = verifier.verifyBlockExists(BASE_CHAIN_ID, 2000);

        assertTrue(exists);
        assertTrue(finalized); // 8 days old
        assertEq(outputRoot, testOutputRoot);
    }

    function test_VerifyBlockExists_ZKFasterFinality() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), true); // ZK chain

        // Add output at timestamp 2 hours ago
        bytes32 testOutputRoot = keccak256("test output root");
        uint128 recentTimestamp = uint128(block.timestamp - 2 hours);
        mockOracle.addOutput(testOutputRoot, recentTimestamp, 2000);

        (bool exists, bool finalized, bytes32 outputRoot) = verifier.verifyBlockExists(BASE_CHAIN_ID, 2000);

        assertTrue(exists);
        assertTrue(finalized); // ZK finality is 1 hour
        assertEq(outputRoot, testOutputRoot);
    }

    // ============ Full State Root Verification Tests ============

    function test_VerifyStateRoot_Success() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Create output root components
        bytes32 stateRoot = keccak256("state root");
        bytes32 messagePasserRoot = keccak256("message passer root");
        bytes32 blockHash = keccak256("block hash");

        // Compute expected output root
        bytes32 expectedOutputRoot = keccak256(
            abi.encode(bytes32(0), stateRoot, messagePasserRoot, blockHash) // version 0
        );

        // Add output with correct root, 8 days ago (finalized)
        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        mockOracle.addOutput(expectedOutputRoot, oldTimestamp, 2000);

        // Verify state root
        bool valid = verifier.verifyStateRoot(BASE_CHAIN_ID, 2000, stateRoot, messagePasserRoot, blockHash);

        assertTrue(valid);

        // Check it was cached
        assertTrue(verifier.isOutputVerified(BASE_CHAIN_ID, 2000, expectedOutputRoot));
    }

    function test_VerifyStateRoot_WrongStateRoot() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Create output root with one set of components
        bytes32 realStateRoot = keccak256("real state root");
        bytes32 messagePasserRoot = keccak256("message passer root");
        bytes32 blockHash = keccak256("block hash");

        bytes32 expectedOutputRoot = keccak256(abi.encode(bytes32(0), realStateRoot, messagePasserRoot, blockHash));

        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        mockOracle.addOutput(expectedOutputRoot, oldTimestamp, 2000);

        // Try to verify with wrong state root
        bytes32 fakeStateRoot = keccak256("fake state root");
        vm.expectRevert(L2OutputVerifier.InvalidOutputRoot.selector);
        verifier.verifyStateRoot(BASE_CHAIN_ID, 2000, fakeStateRoot, messagePasserRoot, blockHash);
    }

    function test_VerifyStateRoot_NotFinalized() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        bytes32 stateRoot = keccak256("state root");
        bytes32 messagePasserRoot = keccak256("message passer root");
        bytes32 blockHash = keccak256("block hash");

        bytes32 expectedOutputRoot = keccak256(abi.encode(bytes32(0), stateRoot, messagePasserRoot, blockHash));

        // Add output at current timestamp (not finalized)
        mockOracle.addOutput(expectedOutputRoot, uint128(block.timestamp), 2000);

        vm.expectRevert(L2OutputVerifier.BlockNotFinalized.selector);
        verifier.verifyStateRoot(BASE_CHAIN_ID, 2000, stateRoot, messagePasserRoot, blockHash);
    }

    function test_VerifyStateRoot_OracleNotRegistered() public {
        vm.expectRevert(L2OutputVerifier.OracleNotRegistered.selector);
        verifier.verifyStateRoot(BASE_CHAIN_ID, 2000, bytes32(0), bytes32(0), bytes32(0));
    }

    // ============ Simplified Interface Tests ============

    function test_SimplifiedVerifyStateRoot_ReturnsFalse() public view {
        // The simplified interface always returns false to force arbitrator review
        bool valid = verifier.verifyStateRoot(bytes32(0), 2000);
        assertFalse(valid);
    }

    // ============ View Function Tests ============

    function test_GetLatestCommittedBlock() public {
        verifier.registerOracle(BASE_CHAIN_ID, address(mockOracle), false);

        // Initially at starting block
        assertEq(verifier.getLatestCommittedBlock(BASE_CHAIN_ID), 1000);

        // Add some outputs
        mockOracle.addOutput(keccak256("output1"), uint128(block.timestamp), 2000);
        mockOracle.addOutput(keccak256("output2"), uint128(block.timestamp), 3000);

        assertEq(verifier.getLatestCommittedBlock(BASE_CHAIN_ID), 3000);
    }

    function test_GetLatestCommittedBlock_NotRegistered() public view {
        assertEq(verifier.getLatestCommittedBlock(BASE_CHAIN_ID), 0);
    }
}
