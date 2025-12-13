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
        
        submitter.addSequencer(seq1);
        submitter.addSequencer(seq2);
        submitter.addSequencer(seq3);
    }

    // ============ Helper Functions ============

    function _signBatch(bytes memory batchData, uint256 privateKey) internal view returns (bytes memory) {
        bytes32 digest = submitter.getBatchDigest(batchData);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signBatchWithNonce(bytes memory batchData, uint256 privateKey, uint256 nonce) internal view returns (bytes memory) {
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InsufficientSignatures.selector, 1, 2
        ));
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.NotAuthorizedSequencer.selector, unauthorized
        ));
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.DuplicateSigner.selector, seq1
        ));
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InvalidSignature.selector, seq2, 1
        ));
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

    // ============ Sequencer Management Tests ============

    function testAddSequencer() public {
        address newSeq = address(0x123);
        submitter.addSequencer(newSeq);
        
        assertTrue(submitter.isSequencer(newSeq));
        assertEq(submitter.sequencerCount(), 4);
    }

    function testAddSequencerZeroAddress() public {
        vm.expectRevert(ThresholdBatchSubmitter.ZeroAddress.selector);
        submitter.addSequencer(address(0));
    }

    function testAddSequencerDuplicate() public {
        // Should be idempotent
        submitter.addSequencer(seq1);
        assertEq(submitter.sequencerCount(), 3);
    }

    function testRemoveSequencer() public {
        submitter.removeSequencer(seq3);
        
        assertFalse(submitter.isSequencer(seq3));
        assertEq(submitter.sequencerCount(), 2);
    }

    function testRemoveSequencerAdjustsThreshold() public {
        // threshold=2, count=3
        submitter.removeSequencer(seq3);
        // threshold=2, count=2
        submitter.removeSequencer(seq2);
        // threshold should adjust to 1 (can't be > count)
        assertEq(submitter.threshold(), 1);
        assertEq(submitter.sequencerCount(), 1);
    }

    function testRemoveSequencerNotAuthorized() public {
        // Should be idempotent
        submitter.removeSequencer(unauthorized);
        assertEq(submitter.sequencerCount(), 3);
    }

    // ============ Threshold Management Tests ============

    function testSetThreshold() public {
        submitter.setThreshold(3);
        assertEq(submitter.threshold(), 3);
    }

    function testSetThresholdZero() public {
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InvalidThreshold.selector, 0, 3
        ));
        submitter.setThreshold(0);
    }

    function testSetThresholdTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InvalidThreshold.selector, 5, 3
        ));
        submitter.setThreshold(5);
    }

    // ============ Access Control Tests ============

    function testOnlyOwnerCanAddSequencer() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.addSequencer(address(0x999));
    }

    function testOnlyOwnerCanRemoveSequencer() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.removeSequencer(seq2);
    }

    function testOnlyOwnerCanSetThreshold() public {
        vm.prank(seq1);
        vm.expectRevert();
        submitter.setThreshold(1);
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

    function testThresholdOfOne() public {
        // Create new submitter with threshold=1
        ThresholdBatchSubmitter sub1 = new ThresholdBatchSubmitter(address(batchInbox), owner, 1);
        sub1.addSequencer(seq1);
        
        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = _signBatchFor(sub1, batchData, SEQ1_KEY);
        address[] memory signers = new address[](1);
        signers[0] = seq1;
        
        sub1.submitBatch(batchData, signatures, signers);
        assertEq(sub1.nonce(), 1);
    }

    function testThresholdEqualsSequencerCount() public {
        submitter.setThreshold(3);
        
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InsufficientSignatures.selector, 3, 2
        ));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testZeroSignatures() public {
        bytes memory batchData = hex"deadbeef";
        bytes[] memory signatures = new bytes[](0);
        address[] memory signers = new address[](0);
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.InsufficientSignatures.selector, 0, 2
        ));
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
        subRevert.addSequencer(seq1);
        subRevert.addSequencer(seq2);
        
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
        submitter.removeSequencer(seq2);
        
        // Try to submit with removed sequencer
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _signBatch(batchData, SEQ1_KEY);
        signatures[1] = _signBatch(batchData, SEQ2_KEY);
        
        address[] memory signers = new address[](2);
        signers[0] = seq1;
        signers[1] = seq2;
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.NotAuthorizedSequencer.selector, seq2
        ));
        submitter.submitBatch(batchData, signatures, signers);
    }

    function testSubmitWithNewlyAddedSequencer() public {
        uint256 SEQ4_KEY = 0x4;
        address seq4 = vm.addr(SEQ4_KEY);
        submitter.addSequencer(seq4);
        
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
        submitter.setThreshold(3);
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
        
        vm.expectRevert(abi.encodeWithSelector(
            ThresholdBatchSubmitter.DuplicateSigner.selector, seq1
        ));
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
            subMany.addSequencer(addrs[i]);
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

    function _signBatchFor(ThresholdBatchSubmitter sub, bytes memory batchData, uint256 privateKey) internal view returns (bytes memory) {
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
        vm.assume(thresholdInput >= 1 && thresholdInput <= 3);
        
        ThresholdBatchSubmitter sub = new ThresholdBatchSubmitter(address(batchInbox), owner, thresholdInput);
        sub.addSequencer(seq1);
        sub.addSequencer(seq2);
        sub.addSequencer(seq3);
        
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

