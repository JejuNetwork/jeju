// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../../src/bridge/WithdrawalPortal.sol";
import "../../src/bridge/L2ToL1MessagePasser.sol";
import "../../src/bridge/interfaces/IL2OutputOracle.sol";

/// @title Mock L2 Output Oracle for testing
contract MockL2OutputOracle is IL2OutputOracle {
    mapping(uint256 => OutputProposal) public outputs;
    uint256 public latestIndex;

    function proposeL2Output(bytes32 _outputRoot, uint256 _l2BlockNumber, bytes32, uint256) external payable override {
        outputs[latestIndex] = OutputProposal({
            outputRoot: _outputRoot,
            timestamp: uint128(block.timestamp),
            l2BlockNumber: uint128(_l2BlockNumber)
        });
        latestIndex++;
    }

    function setOutput(uint256 index, bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber) external {
        outputs[index] = OutputProposal({
            outputRoot: outputRoot,
            timestamp: timestamp,
            l2BlockNumber: l2BlockNumber
        });
        if (index >= latestIndex) latestIndex = index + 1;
    }

    function deleteOutput(uint256 index) external {
        delete outputs[index];
    }

    function getL2Output(uint256 _l2OutputIndex) external view override returns (OutputProposal memory) {
        return outputs[_l2OutputIndex];
    }

    function latestOutputIndex() external view override returns (uint256) {
        return latestIndex > 0 ? latestIndex - 1 : 0;
    }

    function latestBlockNumber() external view override returns (uint256) {
        if (latestIndex == 0) return 0;
        return outputs[latestIndex - 1].l2BlockNumber;
    }

    function finalizationPeriodSeconds() external pure override returns (uint256) {
        return 7 days;
    }

    function sequencerRegistry() external pure override returns (address) {
        return address(0);
    }
}

/// @title Mock target for withdrawal execution
contract MockTarget {
    uint256 public lastValue;
    bytes public lastData;
    bool public shouldFail;

    function execute(uint256 value) external payable {
        require(!shouldFail, "MockTarget: execution failed");
        lastValue = value;
        lastData = msg.data;
    }

    function setShouldFail(bool _fail) external {
        shouldFail = _fail;
    }

    receive() external payable {}
}

/// @title WithdrawalPortalTest
/// @notice Comprehensive tests for the WithdrawalPortal contract
contract WithdrawalPortalTest is Test {
    WithdrawalPortal public portal;
    L2ToL1MessagePasser public messagePasser;
    MockL2OutputOracle public oracle;
    MockTarget public target;

    address public user = address(0x1234);
    address public recipient = address(0x5678);

    // Test withdrawal data
    uint256 constant WITHDRAWAL_VALUE = 1 ether;
    uint256 constant GAS_LIMIT = 100000;
    bytes constant WITHDRAWAL_DATA = "";

    function setUp() public {
        // Deploy contracts
        oracle = new MockL2OutputOracle();
        portal = new WithdrawalPortal(address(oracle));
        messagePasser = new L2ToL1MessagePasser();
        target = new MockTarget();

        // Fund the portal for withdrawal payouts
        vm.deal(address(portal), 100 ether);
        vm.deal(user, 10 ether);
    }

    // ============ L2ToL1MessagePasser Tests ============

    function test_MessagePasser_InitiateWithdrawal() public {
        vm.prank(user);
        messagePasser.initiateWithdrawal{value: WITHDRAWAL_VALUE}(recipient, GAS_LIMIT, WITHDRAWAL_DATA);

        assertEq(messagePasser.messageNonce(), 1);

        bytes32 expectedHash = messagePasser.hashWithdrawalParams(
            0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA
        );
        assertTrue(messagePasser.isMessageSent(expectedHash));
    }

    function test_MessagePasser_RevertOnZeroTarget() public {
        vm.prank(user);
        vm.expectRevert(L2ToL1MessagePasser.ZeroTarget.selector);
        messagePasser.initiateWithdrawal{value: WITHDRAWAL_VALUE}(address(0), GAS_LIMIT, WITHDRAWAL_DATA);
    }

    function test_MessagePasser_RevertOnZeroGasLimit() public {
        vm.prank(user);
        vm.expectRevert(L2ToL1MessagePasser.ZeroGasLimit.selector);
        messagePasser.initiateWithdrawal{value: WITHDRAWAL_VALUE}(recipient, 0, WITHDRAWAL_DATA);
    }

    function test_MessagePasser_IncrementingNonce() public {
        vm.startPrank(user);

        messagePasser.initiateWithdrawal{value: 0.1 ether}(recipient, GAS_LIMIT, WITHDRAWAL_DATA);
        assertEq(messagePasser.messageNonce(), 1);

        messagePasser.initiateWithdrawal{value: 0.2 ether}(recipient, GAS_LIMIT, WITHDRAWAL_DATA);
        assertEq(messagePasser.messageNonce(), 2);

        messagePasser.initiateWithdrawal{value: 0.3 ether}(recipient, GAS_LIMIT, WITHDRAWAL_DATA);
        assertEq(messagePasser.messageNonce(), 3);

        vm.stopPrank();
    }

    function test_MessagePasser_EmitsMessagePassed() public {
        bytes32 expectedHash = messagePasser.hashWithdrawalParams(
            0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA
        );

        vm.expectEmit(true, true, true, true);
        emit L2ToL1MessagePasser.MessagePassed(
            0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA, expectedHash
        );

        vm.prank(user);
        messagePasser.initiateWithdrawal{value: WITHDRAWAL_VALUE}(recipient, GAS_LIMIT, WITHDRAWAL_DATA);
    }

    // ============ WithdrawalPortal Proving Tests ============

    function test_Portal_Constructor() public view {
        assertEq(address(portal.l2Oracle()), address(oracle));
        assertEq(portal.FINALIZATION_PERIOD_SECONDS(), 7 days);
    }

    function test_Portal_RevertOnZeroOracleAddress() public {
        vm.expectRevert(WithdrawalPortal.ZeroAddress.selector);
        new WithdrawalPortal(address(0));
    }

    function test_Portal_ProveWithdrawal() public {
        // Setup withdrawal
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        // Create output root proof
        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);
        bytes32 outputRoot = portal.computeOutputRoot(outputProof);

        // Set the output in the oracle
        oracle.setOutput(0, outputRoot, uint128(block.timestamp), uint128(1000));

        // Create valid Merkle proof
        bytes32[] memory proof = _createValidMerkleProof(withdrawalHash, outputProof.messagePasserStorageRoot);

        // Prove the withdrawal
        portal.proveWithdrawal(wtx, 0, outputProof, proof);

        // Verify it's proven
        assertTrue(portal.isWithdrawalProven(withdrawalHash));
        assertFalse(portal.isWithdrawalFinalized(withdrawalHash));
    }

    function test_Portal_RevertOnInvalidProof() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);
        bytes32 outputRoot = portal.computeOutputRoot(outputProof);

        oracle.setOutput(0, outputRoot, uint128(block.timestamp), uint128(1000));

        // Create invalid proof (wrong data)
        bytes32[] memory invalidProof = new bytes32[](1);
        invalidProof[0] = bytes32(uint256(0xdeadbeef));

        vm.expectRevert(WithdrawalPortal.InvalidProof.selector);
        portal.proveWithdrawal(wtx, 0, outputProof, invalidProof);
    }

    function test_Portal_RevertOnOutputRootMismatch() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);

        // Set a DIFFERENT output root in oracle
        oracle.setOutput(0, bytes32(uint256(1)), uint128(block.timestamp), uint128(1000));

        bytes32[] memory proof = _createValidMerkleProof(withdrawalHash, outputProof.messagePasserStorageRoot);

        vm.expectRevert(WithdrawalPortal.OutputRootMismatch.selector);
        portal.proveWithdrawal(wtx, 0, outputProof, proof);
    }

    function test_Portal_RevertOnReproving() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, recipient, WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);
        bytes32 outputRoot = portal.computeOutputRoot(outputProof);

        oracle.setOutput(0, outputRoot, uint128(block.timestamp), uint128(1000));
        bytes32[] memory proof = _createValidMerkleProof(withdrawalHash, outputProof.messagePasserStorageRoot);

        // First prove succeeds
        portal.proveWithdrawal(wtx, 0, outputProof, proof);

        // Second prove with same index should fail
        vm.expectRevert(WithdrawalPortal.ProofAlreadySubmitted.selector);
        portal.proveWithdrawal(wtx, 0, outputProof, proof);
    }

    // ============ WithdrawalPortal Finalization Tests ============

    function test_Portal_FinalizeWithdrawal() public {
        // Setup and prove withdrawal
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = _proveWithdrawal(wtx);

        // Fast forward past challenge period
        vm.warp(block.timestamp + 7 days + 1);

        // Record recipient balance before
        uint256 balanceBefore = address(target).balance;

        // Finalize
        portal.finalizeWithdrawal(wtx);

        // Verify finalization
        assertTrue(portal.isWithdrawalFinalized(withdrawalHash));
        assertEq(address(target).balance, balanceBefore + WITHDRAWAL_VALUE);
    }

    function test_Portal_RevertOnEarlyFinalization() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        _proveWithdrawal(wtx);

        // Try to finalize before challenge period
        vm.warp(block.timestamp + 6 days);

        vm.expectRevert(WithdrawalPortal.ChallengePeriodNotElapsed.selector);
        portal.finalizeWithdrawal(wtx);
    }

    function test_Portal_RevertOnDoubleFinalization() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        _proveWithdrawal(wtx);

        vm.warp(block.timestamp + 7 days + 1);

        // First finalization succeeds
        portal.finalizeWithdrawal(wtx);

        // Second finalization should fail
        vm.expectRevert(WithdrawalPortal.WithdrawalAlreadyFinalized.selector);
        portal.finalizeWithdrawal(wtx);
    }

    function test_Portal_RevertOnUnprovenWithdrawal() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);

        vm.expectRevert(WithdrawalPortal.WithdrawalNotProven.selector);
        portal.finalizeWithdrawal(wtx);
    }

    function test_Portal_RevertOnDeletedOutput() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        _proveWithdrawal(wtx);

        // Delete the output (simulating a successful challenge)
        oracle.deleteOutput(0);

        vm.warp(block.timestamp + 7 days + 1);

        vm.expectRevert(WithdrawalPortal.OutputRootMismatch.selector);
        portal.finalizeWithdrawal(wtx);
    }

    function test_Portal_FinalizeWithCalldata() public {
        bytes memory callData = abi.encodeWithSelector(MockTarget.execute.selector, uint256(42));

        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(
            0, user, address(target), 0.5 ether, GAS_LIMIT, callData
        );
        _proveWithdrawal(wtx);

        vm.warp(block.timestamp + 7 days + 1);

        portal.finalizeWithdrawal(wtx);

        assertEq(target.lastValue(), 42);
    }

    function test_Portal_FinalizeEmitsEvent() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = _proveWithdrawal(wtx);

        vm.warp(block.timestamp + 7 days + 1);

        vm.expectEmit(true, false, false, true);
        emit WithdrawalPortal.WithdrawalFinalized(withdrawalHash, true);

        portal.finalizeWithdrawal(wtx);
    }

    function test_Portal_FailedExecutionStillFinalizes() public {
        // Make target fail
        target.setShouldFail(true);

        bytes memory callData = abi.encodeWithSelector(MockTarget.execute.selector, uint256(42));
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(
            0, user, address(target), 0, GAS_LIMIT, callData
        );
        bytes32 withdrawalHash = _proveWithdrawal(wtx);

        vm.warp(block.timestamp + 7 days + 1);

        // Should emit failure but not revert
        vm.expectEmit(true, false, false, true);
        emit WithdrawalPortal.WithdrawalFinalized(withdrawalHash, false);

        portal.finalizeWithdrawal(wtx);

        // Still marked as finalized to prevent replay
        assertTrue(portal.isWithdrawalFinalized(withdrawalHash));
    }

    // ============ View Function Tests ============

    function test_Portal_GetFinalizationTime() public {
        WithdrawalPortal.WithdrawalTransaction memory wtx = _createWithdrawal(0, user, address(target), WITHDRAWAL_VALUE, GAS_LIMIT, WITHDRAWAL_DATA);
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        // Before proving
        assertEq(portal.getFinalizationTime(withdrawalHash), 0);

        // After proving
        uint256 proveTime = block.timestamp;
        _proveWithdrawal(wtx);
        assertEq(portal.getFinalizationTime(withdrawalHash), proveTime + 7 days);
    }

    function test_Portal_ComputeStorageKey() public view {
        bytes32 withdrawalHash = bytes32(uint256(1));
        bytes32 storageKey = portal.computeStorageKey(withdrawalHash);

        // Should match keccak256(abi.encode(hash, slot))
        bytes32 expected = keccak256(abi.encode(withdrawalHash, uint256(1)));
        assertEq(storageKey, expected);
    }

    // ============ Fuzz Tests ============

    function testFuzz_MessagePasser_InitiateWithdrawal(
        address sender,
        address targetAddr,
        uint256 value,
        uint256 gasLimit,
        bytes calldata data
    ) public {
        vm.assume(targetAddr != address(0));
        vm.assume(gasLimit > 0);
        vm.assume(sender != address(0));
        vm.deal(sender, value);

        vm.prank(sender);
        messagePasser.initiateWithdrawal{value: value}(targetAddr, gasLimit, data);

        bytes32 hash = messagePasser.hashWithdrawalParams(0, sender, targetAddr, value, gasLimit, data);
        assertTrue(messagePasser.isMessageSent(hash));
    }

    function testFuzz_Portal_HashWithdrawal(
        uint256 nonce,
        address sender,
        address targetAddr,
        uint256 value,
        uint256 gasLimit,
        bytes calldata data
    ) public view {
        WithdrawalPortal.WithdrawalTransaction memory wtx = WithdrawalPortal.WithdrawalTransaction({
            nonce: nonce,
            sender: sender,
            target: targetAddr,
            value: value,
            gasLimit: gasLimit,
            data: data
        });

        bytes32 hash1 = portal.hashWithdrawal(wtx);
        bytes32 hash2 = keccak256(abi.encode(nonce, sender, targetAddr, value, gasLimit, data));

        assertEq(hash1, hash2);
    }

    // ============ Helper Functions ============

    function _createWithdrawal(
        uint256 nonce,
        address sender,
        address targetAddr,
        uint256 value,
        uint256 gasLimit,
        bytes memory data
    ) internal pure returns (WithdrawalPortal.WithdrawalTransaction memory) {
        return WithdrawalPortal.WithdrawalTransaction({
            nonce: nonce,
            sender: sender,
            target: targetAddr,
            value: value,
            gasLimit: gasLimit,
            data: data
        });
    }

    function _createOutputRootProof(bytes32 withdrawalHash) internal view returns (WithdrawalPortal.OutputRootProof memory) {
        bytes32 storageKey = portal.computeStorageKey(withdrawalHash);
        bytes32 leaf = keccak256(abi.encodePacked(storageKey, bytes32(uint256(1))));

        return WithdrawalPortal.OutputRootProof({
            version: bytes32(0),
            stateRoot: bytes32(uint256(0x123)),
            messagePasserStorageRoot: leaf, // For single-element tree, root = leaf
            latestBlockhash: bytes32(uint256(0x456))
        });
    }

    function _createValidMerkleProof(bytes32 withdrawalHash, bytes32 root) internal view returns (bytes32[] memory) {
        // For a single-element tree, proof is empty since leaf = root
        bytes32 storageKey = portal.computeStorageKey(withdrawalHash);
        bytes32 leaf = keccak256(abi.encodePacked(storageKey, bytes32(uint256(1))));

        if (leaf == root) {
            return new bytes32[](0);
        }

        // Should not reach here in our test setup
        revert("Invalid test setup: leaf != root");
    }

    function _proveWithdrawal(WithdrawalPortal.WithdrawalTransaction memory wtx) internal returns (bytes32) {
        bytes32 withdrawalHash = portal.hashWithdrawal(wtx);

        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);
        bytes32 outputRoot = portal.computeOutputRoot(outputProof);

        oracle.setOutput(0, outputRoot, uint128(block.timestamp), uint128(1000));
        bytes32[] memory proof = _createValidMerkleProof(withdrawalHash, outputProof.messagePasserStorageRoot);

        portal.proveWithdrawal(wtx, 0, outputProof, proof);

        return withdrawalHash;
    }
}
