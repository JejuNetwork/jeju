// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../../src/sequencer/ThresholdBatchSubmitter.sol";

/**
 * @title ThresholdBatchSubmitterTest
 * @notice Comprehensive tests for threshold batch submission
 */
contract ThresholdBatchSubmitterTest is Test {
    ThresholdBatchSubmitter public submitter;

    address public owner = address(0x1);
    address public batchInbox = address(0x2);

    // Test sequencers
    uint256 constant SEQ1_PK = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 constant SEQ2_PK = 0x2222222222222222222222222222222222222222222222222222222222222222;
    uint256 constant SEQ3_PK = 0x3333333333333333333333333333333333333333333333333333333333333333;
    uint256 constant SEQ4_PK = 0x4444444444444444444444444444444444444444444444444444444444444444;

    address public seq1;
    address public seq2;
    address public seq3;
    address public seq4;

    // Timelock delay from contract
    uint256 constant TIMELOCK_DELAY = 2 days;

    function setUp() public {
        seq1 = vm.addr(SEQ1_PK);
        seq2 = vm.addr(SEQ2_PK);
        seq3 = vm.addr(SEQ3_PK);
        seq4 = vm.addr(SEQ4_PK);

        vm.prank(owner);
        submitter = new ThresholdBatchSubmitter(batchInbox, owner, 2);

        // Add sequencers via timelock
        _addSequencer(seq1);
        _addSequencer(seq2);
        _addSequencer(seq3);
    }

    // ============ Helper: Add sequencer with timelock ============
    
    function _addSequencer(address seq) internal {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeAddSequencer(seq);
        
        // Fast forward past timelock
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        
        submitter.executeAddSequencer(changeId);
    }

    function _removeSequencer(address seq) internal {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeRemoveSequencer(seq);
        
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        
        submitter.executeRemoveSequencer(changeId);
    }

    function _setThreshold(uint256 newThreshold) internal {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeSetThreshold(newThreshold);
        
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        
        submitter.executeSetThreshold(changeId);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(submitter.batchInbox(), batchInbox);
        assertEq(submitter.owner(), owner);
        assertEq(submitter.threshold(), 2);
        assertEq(submitter.sequencerCount(), 3);
    }

    function test_Constructor_RevertsOnZeroBatchInbox() public {
        vm.expectRevert(ThresholdBatchSubmitter.ZeroAddress.selector);
        new ThresholdBatchSubmitter(address(0), owner, 2);
    }

    function test_Constructor_RevertsOnLowThreshold() public {
        vm.expectRevert(ThresholdBatchSubmitter.ThresholdTooLow.selector);
        new ThresholdBatchSubmitter(batchInbox, owner, 1);
    }

    // ============ Sequencer Management Tests ============

    function test_AddSequencer() public {
        _addSequencer(seq4);

        assertTrue(submitter.isSequencer(seq4));
        assertEq(submitter.sequencerCount(), 4);
    }

    function test_ProposeAddSequencer_RevertsForNonOwner() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.proposeAddSequencer(seq4);
    }

    function test_RemoveSequencer() public {
        _removeSequencer(seq3);

        assertFalse(submitter.isSequencer(seq3));
        assertEq(submitter.sequencerCount(), 2);
    }

    function test_Timelock_CannotExecuteBeforeDelay() public {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeAddSequencer(seq4);
        
        // Try to execute immediately (should fail)
        vm.expectRevert(ThresholdBatchSubmitter.TimelockNotExpired.selector);
        submitter.executeAddSequencer(changeId);
    }

    function test_CancelChange() public {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeAddSequencer(seq4);
        
        // Cancel
        vm.prank(owner);
        submitter.cancelChange(changeId);
        
        // Try to execute (should fail)
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        vm.expectRevert(ThresholdBatchSubmitter.ChangeNotFound.selector);
        submitter.executeAddSequencer(changeId);
    }

    // ============ Threshold Update Tests ============

    function test_SetThreshold() public {
        _setThreshold(3);

        assertEq(submitter.threshold(), 3);
    }

    function test_SetThreshold_RevertsIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert();
        submitter.proposeSetThreshold(10); // Higher than sequencer count
    }

    function test_SetThreshold_RevertsIfTooLow() public {
        vm.prank(owner);
        vm.expectRevert();
        submitter.proposeSetThreshold(1);
    }

    // ============ Batch Submission Tests ============

    function test_SubmitBatch_WithValidSignatures() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        // Create EIP-712 digest
        bytes32 digest = _getDigest(batchHash, currentNonce);

        // Sign with two sequencers
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_PK, digest);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        // Submit - should forward to batch inbox
        vm.expectCall(batchInbox, batchData);
        submitter.submitBatch(batchData, signatures, signers);

        assertEq(submitter.nonce(), currentNonce + 1);
    }

    function test_SubmitBatch_RevertsWithInsufficientSignatures() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        bytes32 digest = _getDigest(batchHash, currentNonce);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);

        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r1, s1, v1);

        address[] memory signers = new address[](1);
        signers[0] = seq1;

        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InsufficientSignatures.selector,
            1,
            2
        ));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function test_SubmitBatch_RevertsWithUnauthorizedSigner() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        bytes32 digest = _getDigest(batchHash, currentNonce);

        // Sign with seq1 (valid) and seq4 (not added)
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);
        (uint8 v4, bytes32 r4, bytes32 s4) = vm.sign(SEQ4_PK, digest);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r4, s4, v4);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq4;

        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.NotAuthorizedSequencer.selector,
            seq4
        ));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function test_SubmitBatch_RevertsWithDuplicateSigner() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        bytes32 digest = _getDigest(batchHash, currentNonce);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r1, s1, v1); // Same signature

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq1; // Duplicate

        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.DuplicateSigner.selector,
            seq1
        ));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function test_SubmitBatch_RevertsWithWrongSignature() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        bytes32 digest = _getDigest(batchHash, currentNonce);

        // Sign correct message with seq1
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);

        // Sign WRONG message with seq2
        bytes32 wrongDigest = _getDigest(keccak256("wrongdata"), currentNonce);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_PK, wrongDigest);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        // Should revert because signature 2 doesn't match
        vm.expectRevert();
        submitter.submitBatch(batchData, signatures, signers);
    }

    // ============ Nonce Tests ============

    function test_NonceIncrementsAfterSubmission() public {
        bytes memory batchData = hex"deadbeef";
        
        uint256 nonce0 = submitter.nonce();
        _submitValidBatch(batchData);
        uint256 nonce1 = submitter.nonce();
        
        assertEq(nonce1, nonce0 + 1);

        _submitValidBatch(batchData);
        uint256 nonce2 = submitter.nonce();
        
        assertEq(nonce2, nonce0 + 2);
    }

    // ============ 3-of-3 Threshold Tests ============

    function test_ThreeOfThreeThreshold() public {
        // Update threshold to 3
        _setThreshold(3);

        bytes memory batchData = hex"deadbeef";
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();

        bytes32 digest = _getDigest(batchHash, currentNonce);

        // Sign with all three
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_PK, digest);
        (uint8 v3, bytes32 r3, bytes32 s3) = vm.sign(SEQ3_PK, digest);

        bytes[] memory signatures = new bytes[](3);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        signatures[2] = abi.encodePacked(r3, s3, v3);

        address[] memory signers = new address[](3);
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq3;

        vm.expectCall(batchInbox, batchData);
        submitter.submitBatch(batchData, signatures, signers);
    }

    // ============ Gas Tests ============

    function test_GasUsage_2of3() public {
        bytes memory batchData = hex"deadbeefdeadbeefdeadbeefdeadbeef";
        
        uint256 gasBefore = gasleft();
        _submitValidBatch(batchData);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for 2-of-3 submission:", gasUsed);
        assertLt(gasUsed, 200000); // Should be reasonable
    }

    // ============ Helper Functions ============

    function _getDigest(bytes32 batchHash, uint256 currentNonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                submitter.BATCH_TYPEHASH(),
                batchHash,
                currentNonce,
                block.chainid
            )
        );
        return keccak256(
            abi.encodePacked("\x19\x01", submitter.DOMAIN_SEPARATOR(), structHash)
        );
    }

    function _submitValidBatch(bytes memory batchData) internal {
        bytes32 batchHash = keccak256(batchData);
        uint256 currentNonce = submitter.nonce();
        bytes32 digest = _getDigest(batchHash, currentNonce);

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_PK, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_PK, digest);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);
    }
}
