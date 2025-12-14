// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/ThresholdBatchSubmitter.sol";

contract MockBatchInbox {
    bytes[] public batches;

    receive() external payable {
        batches.push("");
    }

    fallback() external payable {
        batches.push(msg.data);
    }

    function getBatchCount() external view returns (uint256) {
        return batches.length;
    }

    function getBatch(uint256 index) external view returns (bytes memory) {
        return batches[index];
    }
}

contract RevertingBatchInbox {
    fallback() external payable {
        revert("batch rejected");
    }
}

contract ThresholdBatchSubmitterTest is Test {
    ThresholdBatchSubmitter public submitter;
    MockBatchInbox public batchInbox;

    uint256 constant SEQ1_KEY = 0x1;
    uint256 constant SEQ2_KEY = 0x2;
    uint256 constant SEQ3_KEY = 0x3;
    uint256 constant UNAUTHORIZED_KEY = 0x999;
    uint256 constant ADMIN_TIMELOCK_DELAY = 2 days;

    address seq1;
    address seq2;
    address seq3;
    address unauthorized;
    address owner;

    function setUp() public {
        owner = address(this);
        seq1 = vm.addr(SEQ1_KEY);
        seq2 = vm.addr(SEQ2_KEY);
        seq3 = vm.addr(SEQ3_KEY);
        unauthorized = vm.addr(UNAUTHORIZED_KEY);

        batchInbox = new MockBatchInbox();
        submitter = new ThresholdBatchSubmitter(address(batchInbox), owner, 2);

        _addSequencer(seq1);
        _addSequencer(seq2);
        _addSequencer(seq3);
    }

    /// @notice Helper to add a sequencer via propose + execute flow
    function _addSequencer(address seq) internal {
        _addSequencerTo(submitter, seq);
    }
    
    /// @notice Helper to add a sequencer to any submitter instance
    function _addSequencerTo(ThresholdBatchSubmitter sub, address seq) internal {
        bytes32 changeId = sub.proposeAddSequencer(seq);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        sub.executeAddSequencer(changeId);
    }
    
    /// @notice Helper to set threshold via propose + execute flow
    function _setThreshold(uint256 threshold) internal {
        bytes32 changeId = submitter.proposeSetThreshold(threshold);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeSetThreshold(changeId);
    }
    
    /// @notice Helper to remove a sequencer via propose + execute flow
    function _removeSequencer(address seq) internal {
        bytes32 changeId = submitter.proposeRemoveSequencer(seq);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeRemoveSequencer(changeId);
    }

    // ============ Helper Functions ============

    function _signBatch(bytes memory batchData, uint256 privateKey) internal view returns (bytes memory) {
        bytes32 digest = submitter.getBatchDigest(batchData);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signBatchWithNonce(bytes memory batchData, uint256 privateKey, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = submitter.getBatchDigestWithNonce(batchData, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ============ Constructor Tests ============

    function testConstructor() public view {
        assertEq(submitter.batchInbox(), address(batchInbox));
        assertEq(submitter.threshold(), 2);
        assertEq(submitter.sequencerCount(), 3);
        assertEq(submitter.nonce(), 0);
    }

    function testConstructorZeroInbox() public {
        vm.expectRevert(ThresholdBatchSubmitter.ZeroAddress.selector);
        new ThresholdBatchSubmitter(address(0), owner, 2);
    }

    // ============ Submit Batch Tests ============

    function testSubmitBatchSuccess() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);

        assertEq(batchInbox.getBatchCount(), 1);
        assertEq(batchInbox.getBatch(0), batchData);
        assertEq(submitter.nonce(), 1);
    }

    function testSubmitBatchWithThreeSignatures() public {
        bytes memory batchData = hex"cafebabe";

        bytes[] memory signatures = new bytes[](3);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        signatures[2] = _signBatch(batchData, SEQ3_KEY);

        address[] memory signers = new address[](3);
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq3;

        submitter.submitBatch(batchData, signatures, signers);

        assertEq(batchInbox.getBatchCount(), 1);
    }

    function testSubmitBatchInsufficientSignatures() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](1);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);

        address[] memory signers = new address[](1);
        signers[0] = seq1;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InsufficientSignatures.selector, 1, 2));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitBatchUnauthorizedSigner() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, UNAUTHORIZED_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = unauthorized;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.NotAuthorizedSequencer.selector, unauthorized));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitBatchDuplicateSigner() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ1_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq1;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.DuplicateSigner.selector, seq1));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitBatchWrongSigner() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq3; // Wrong - signed by seq2

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InvalidSignature.selector, seq2, 1));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitBatchReplayProtection() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        // First submission succeeds
        submitter.submitBatch(batchData, signatures, signers);
        assertEq(submitter.nonce(), 1);

        // Replay fails - signature was for nonce 0
        vm.expectRevert();
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitMultipleBatches() public {
        for (uint256 i = 0; i < 5; i++) {
            bytes memory batchData = abi.encodePacked("batch", i);

            bytes[] memory signatures = new bytes[](2);
            signatures[0] = _signBatchWithNonce(batchData, SEQ1_KEY, i);
            signatures[1] = _signBatchWithNonce(batchData, SEQ2_KEY, i);

            address[] memory signers = new address[](2);
            signers[0] = seq1;
            signers[1] = seq2;

            submitter.submitBatch(batchData, signatures, signers);
        }

        assertEq(batchInbox.getBatchCount(), 5);
        assertEq(submitter.nonce(), 5);
    }

    // ============ Sequencer Management Tests (Propose/Execute Pattern) ============

    function testProposeAndExecuteAddSequencer() public {
        address newSeq = address(0x123);
        bytes32 changeId = submitter.proposeAddSequencer(newSeq);
        
        // Cannot execute immediately
        vm.expectRevert();
        submitter.executeAddSequencer(changeId);
        
        // Warp past timelock
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeAddSequencer(changeId);

        assertTrue(submitter.isSequencer(newSeq));
        assertEq(submitter.sequencerCount(), 4);
    }

    function testProposeAddSequencerZeroAddress() public {
        vm.expectRevert(ThresholdBatchSubmitter.ZeroAddress.selector);
        submitter.proposeAddSequencer(address(0));
    }

    function testProposeAndExecuteRemoveSequencer() public {
        bytes32 changeId = submitter.proposeRemoveSequencer(seq3);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeRemoveSequencer(changeId);

        assertFalse(submitter.isSequencer(seq3));
        assertEq(submitter.sequencerCount(), 2);
    }

    function testRemoveSequencerMaintainsMinThreshold() public {
        // threshold=2, count=3
        bytes32 changeId1 = submitter.proposeRemoveSequencer(seq3);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeRemoveSequencer(changeId1);
        
        // threshold=2, count=2 - at minimum
        assertEq(submitter.threshold(), 2);
        assertEq(submitter.sequencerCount(), 2);
        
        // Now try to remove another - need to warp AFTER proposing
        // Record timestamp BEFORE proposing
        uint256 proposalTime = block.timestamp;
        bytes32 changeId2 = submitter.proposeRemoveSequencer(seq2);
        
        // Warp relative to the proposal time, not current timestamp
        // The proposal was made at proposalTime, so we need to be at proposalTime + delay
        vm.warp(proposalTime + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeRemoveSequencer(changeId2);
        
        // Threshold stays at MIN_THRESHOLD=2, but count is 1
        // This means submissions will fail until more sequencers added
        assertEq(submitter.threshold(), 2); // MIN_THRESHOLD
        assertEq(submitter.sequencerCount(), 1);
    }

    // ============ Threshold Management Tests (Propose/Execute Pattern) ============

    function testProposeAndExecuteSetThreshold() public {
        bytes32 changeId = submitter.proposeSetThreshold(3);
        vm.warp(block.timestamp + ADMIN_TIMELOCK_DELAY + 1);
        submitter.executeSetThreshold(changeId);
        assertEq(submitter.threshold(), 3);
    }

    function testProposeSetThresholdZero() public {
        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InvalidThreshold.selector, 0, 3));
        submitter.proposeSetThreshold(0);
    }

    function testProposeSetThresholdTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InvalidThreshold.selector, 5, 3));
        submitter.proposeSetThreshold(5);
    }

    // ============ Access Control Tests ============

    function testOnlyOwnerCanProposeAddSequencer() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.proposeAddSequencer(address(0x999));
    }

    function testOnlyOwnerCanProposeRemoveSequencer() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.proposeRemoveSequencer(seq2);
    }

    function testOnlyOwnerCanProposeSetThreshold() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.proposeSetThreshold(1);
    }

    // ============ View Function Tests ============

    function testGetSequencers() public view {
        address[] memory seqs = submitter.getSequencers();
        assertEq(seqs.length, 3);
    }

    function testGetBatchDigest() public view {
        bytes memory batchData = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(batchData);
        assertNotEq(digest, bytes32(0));
    }

    function testGetBatchDigestDifferentData() public view {
        bytes32 digest1 = submitter.getBatchDigest(hex"deadbeef");
        bytes32 digest2 = submitter.getBatchDigest(hex"cafebabe");
        assertNotEq(digest1, digest2);
    }

    function testGetBatchDigestDifferentNonce() public {
        bytes memory batchData = hex"deadbeef";
        bytes32 digest1 = submitter.getBatchDigest(batchData);

        // Submit a batch to increment nonce
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;
        submitter.submitBatch(batchData, signatures, signers);

        bytes32 digest2 = submitter.getBatchDigest(batchData);
        assertNotEq(digest1, digest2);
    }

    // ============ Edge Cases ============

    function testLargeBatch() public {
        bytes memory batchData = new bytes(100000);
        for (uint256 i = 0; i < 100000; i++) {
            batchData[i] = bytes1(uint8(i % 256));
        }

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(batchInbox.getBatchCount(), 1);
    }

    function testEmptyBatch() public {
        bytes memory batchData = "";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(batchInbox.getBatchCount(), 1);
    }

    // ============ Boundary Conditions ============

    function testThresholdOfTwo() public {
        // Create new submitter with threshold=2 (MIN_THRESHOLD)
        ThresholdBatchSubmitter sub2 = new ThresholdBatchSubmitter(address(batchInbox), owner, 2);
        _addSequencerTo(sub2, seq1);
        _addSequencerTo(sub2, seq2);

        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatchFor(sub2, batchData, SEQ1_KEY);
        signatures[1] = _signBatchFor(sub2, batchData, SEQ2_KEY);
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        sub2.submitBatch(batchData, signatures, signers);
        assertEq(sub2.nonce(), 1);
    }

    function testThresholdEqualsSequencerCount() public {
        _setThreshold(3);

        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](3);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        signatures[2] = _signBatch(batchData, SEQ3_KEY);

        address[] memory signers = new address[](3);
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq3;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(submitter.nonce(), 1);
    }

    function testSignatureArrayLengthMismatch() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](3); // Mismatch!
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq3;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InsufficientSignatures.selector, 3, 2));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testZeroSignatures() public {
        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](0);
        address[] memory signers = new address[](0);

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InsufficientSignatures.selector, 0, 2));
        submitter.submitBatch(batchData, signatures, signers);
    }

    // ============ Error Handling ============

    function testMalformedSignature() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = hex"00"; // Invalid signature - too short

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        vm.expectRevert(); // ECDSA will revert
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testBatchInboxReverts() public {
        RevertingBatchInbox revertingInbox = new RevertingBatchInbox();
        ThresholdBatchSubmitter subRevert = new ThresholdBatchSubmitter(address(revertingInbox), owner, 2);
        _addSequencerTo(subRevert, seq1);
        _addSequencerTo(subRevert, seq2);

        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatchFor(subRevert, batchData, SEQ1_KEY);
        signatures[1] = _signBatchFor(subRevert, batchData, SEQ2_KEY);
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        vm.expectRevert(ThresholdBatchSubmitter.BatchSubmissionFailed.selector);
        subRevert.submitBatch(batchData, signatures, signers);
    }

    function testCorruptedSignature() public {
        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        bytes memory sig2 = _signBatch(batchData, SEQ2_KEY);
        sig2[0] = 0xff; // Corrupt the signature
        signatures[1] = sig2;

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        vm.expectRevert(); // Will recover wrong address
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSignatureForDifferentData() public {
        bytes memory batchData = hex"deadbeef";
        bytes memory wrongData = hex"cafebabe";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(wrongData, SEQ2_KEY); // Signed wrong data

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        // When signed with wrong data, recovered address != claimed signer
        vm.expectRevert(); // InvalidSignature with recovered address
        submitter.submitBatch(batchData, signatures, signers);
    }

    // ============ Signer Ordering ============

    function testReverseSignerOrder() public {
        bytes memory batchData = hex"deadbeef";

        // Sign in reverse order
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ2_KEY);
        signatures[1] = _signBatch(batchData, SEQ1_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq2;
        signers[1] = seq1;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(submitter.nonce(), 1);
    }

    function testSkipMiddleSequencer() public {
        bytes memory batchData = hex"deadbeef";

        // Use seq1 and seq3, skip seq2
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ3_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq3;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(submitter.nonce(), 1);
    }

    // ============ Sequencer State Changes ============

    function testSubmitAfterSequencerRemoved() public {
        bytes memory batchData = hex"deadbeef";

        // Remove seq2
        _removeSequencer(seq2);

        // Try to submit with removed sequencer
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.NotAuthorizedSequencer.selector, seq2));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitWithNewlyAddedSequencer() public {
        uint256 SEQ4_KEY = 0x4;
        address seq4 = vm.addr(SEQ4_KEY);
        _addSequencer(seq4);

        bytes memory batchData = hex"deadbeef";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ4_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq4;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(submitter.nonce(), 1);
    }

    // ============ EIP-712 Digest Verification ============

    function testDigestMatchesEIP712() public view {
        bytes memory batchData = hex"deadbeef";
        bytes32 contractDigest = submitter.getBatchDigest(batchData);

        // Manually compute expected EIP-712 digest
        bytes32 batchHash = keccak256(batchData);
        bytes32 BATCH_TYPEHASH = keccak256("BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)");
        bytes32 structHash = keccak256(abi.encode(BATCH_TYPEHASH, batchHash, 0, block.chainid));
        bytes32 expectedDigest = keccak256(abi.encodePacked("\x19\x01", submitter.DOMAIN_SEPARATOR(), structHash));

        assertEq(contractDigest, expectedDigest);
    }

    function testDigestWithNonZeroNonce() public {
        bytes memory batchData = hex"deadbeef";

        // Submit first batch
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;
        submitter.submitBatch(batchData, signatures, signers);

        // Verify digest for nonce=1
        bytes32 contractDigest = submitter.getBatchDigest(batchData);
        bytes32 batchHash = keccak256(batchData);
        bytes32 BATCH_TYPEHASH = keccak256("BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)");
        bytes32 structHash = keccak256(abi.encode(BATCH_TYPEHASH, batchHash, 1, block.chainid));
        bytes32 expectedDigest = keccak256(abi.encodePacked("\x19\x01", submitter.DOMAIN_SEPARATOR(), structHash));

        assertEq(contractDigest, expectedDigest);
    }

    // ============ Batch Data Verification ============

    function testBatchDataPassedToInbox() public {
        bytes memory batchData = hex"0102030405060708";

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);

        // Verify exact data was passed to inbox
        bytes memory received = batchInbox.getBatch(0);
        assertEq(keccak256(received), keccak256(batchData));
        assertEq(received.length, batchData.length);
        for (uint256 i = 0; i < batchData.length; i++) {
            assertEq(received[i], batchData[i]);
        }
    }

    // ============ Duplicate Detection Edge Cases ============

    function testDuplicateAtDifferentPositions() public {
        _setThreshold(3);
        bytes memory batchData = hex"deadbeef";

        // Duplicate at positions 0 and 2
        bytes[] memory signatures = new bytes[](3);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        signatures[2] = _signBatch(batchData, SEQ1_KEY);

        address[] memory signers = new address[](3);
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq1;

        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.DuplicateSigner.selector, seq1));
        submitter.submitBatch(batchData, signatures, signers);
    }

    // ============ Many Sequencers ============

    function testManySequencers() public {
        // Create submitter with many sequencers
        ThresholdBatchSubmitter subMany = new ThresholdBatchSubmitter(address(batchInbox), owner, 5);

        uint256[] memory keys = new uint256[](10);
        address[] memory addrs = new address[](10);
        for (uint256 i = 0; i < 10; i++) {
            keys[i] = i + 100;
            addrs[i] = vm.addr(keys[i]);
            _addSequencerTo(subMany, addrs[i]);
        }

        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](5);
        address[] memory signers = new address[](5);

        for (uint256 i = 0; i < 5; i++) {
            bytes32 digest = subMany.getBatchDigest(batchData);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
            signatures[i] = abi.encodePacked(r, s, v);
            signers[i] = addrs[i];
        }

        subMany.submitBatch(batchData, signatures, signers);
        assertEq(subMany.nonce(), 1);
    }

    // ============ Helper for other submitter instances ============

    function _signBatchFor(ThresholdBatchSubmitter sub, bytes memory batchData, uint256 privateKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = sub.getBatchDigest(batchData);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ============ Fuzz Tests ============

    function testFuzzSubmitBatch(bytes calldata batchData) public {
        vm.assume(batchData.length < 100000);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);

        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;

        submitter.submitBatch(batchData, signatures, signers);
        assertEq(batchInbox.getBatchCount(), 1);
    }

    function testFuzzThresholdBound(uint8 thresholdInput) public {
        // MIN_THRESHOLD is 2, so only test valid thresholds 2-3
        vm.assume(thresholdInput >= 2 && thresholdInput <= 3);

        ThresholdBatchSubmitter sub = new ThresholdBatchSubmitter(address(batchInbox), owner, thresholdInput);
        _addSequencerTo(sub, seq1);
        _addSequencerTo(sub, seq2);
        _addSequencerTo(sub, seq3);

        assertEq(sub.threshold(), thresholdInput);
    }

    function testFuzzNonceIncrement(uint8 batchCount) public {
        vm.assume(batchCount > 0 && batchCount <= 10);

        for (uint256 i = 0; i < batchCount; i++) {
            bytes memory batchData = abi.encodePacked("batch", i);

            bytes[] memory signatures = new bytes[](2);
            signatures[0] = _signBatchWithNonce(batchData, SEQ1_KEY, i);
            signatures[1] = _signBatchWithNonce(batchData, SEQ2_KEY, i);

            address[] memory signers = new address[](2);
            signers[0] = seq1;
            signers[1] = seq2;

            submitter.submitBatch(batchData, signatures, signers);
        }

        assertEq(submitter.nonce(), batchCount);
    }
}
