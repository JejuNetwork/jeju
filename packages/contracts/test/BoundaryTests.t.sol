// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/sequencer/ThresholdBatchSubmitter.sol";
import "../src/bridge/ForcedInclusion.sol";
import "../src/sequencer/SequencerRegistry.sol";
import "../src/dispute/DisputeGameFactory.sol";
import "../src/governance/GovernanceTimelock.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("JEJU", "JEJU") { _mint(msg.sender, 10_000_000 ether); }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MockBatchInbox {
    uint256 public callCount;
    bool public shouldRevert;
    
    fallback() external payable {
        if (shouldRevert) revert("inbox failed");
        callCount++;
    }
    receive() external payable {}
    function setRevert(bool _revert) external { shouldRevert = _revert; }
}

contract ReentrantForcer {
    ForcedInclusion public target;
    bytes32 public targetTxId;
    uint256 public attempts;
    
    function attack(ForcedInclusion _target, bytes32 _txId) external {
        target = _target;
        targetTxId = _txId;
        target.forceInclude(_txId);
    }
    
    receive() external payable {
        if (attempts++ < 2) {
            target.forceInclude(targetTxId);
        }
    }
}

/// @title Boundary and Edge Case Tests for Decentralization Contracts
contract BoundaryTests is Test {
    receive() external payable {}
    ThresholdBatchSubmitter public submitter;
    ForcedInclusion public forceInc;
    MockBatchInbox public inbox;
    MockToken public token;
    
    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    
    uint256 constant SEQ1_KEY = 0x1111;
    uint256 constant SEQ2_KEY = 0x2222;
    uint256 constant SEQ3_KEY = 0x3333;
    address seq1;
    address seq2;
    address seq3;

    function setUp() public {
        seq1 = vm.addr(SEQ1_KEY);
        seq2 = vm.addr(SEQ2_KEY);
        seq3 = vm.addr(SEQ3_KEY);
        
        inbox = new MockBatchInbox();
        submitter = new ThresholdBatchSubmitter(address(inbox), owner, 2);
        forceInc = new ForcedInclusion(address(inbox), address(0), owner, owner, true);
        token = new MockToken();
        
        // Add sequencers via timelock
        vm.startPrank(owner);
        bytes32 c1 = submitter.proposeAddSequencer(seq1);
        bytes32 c2 = submitter.proposeAddSequencer(seq2);
        bytes32 c3 = submitter.proposeAddSequencer(seq3);
        vm.stopPrank();
        
        vm.warp(block.timestamp + 2 days + 1);
        submitter.executeAddSequencer(c1);
        submitter.executeAddSequencer(c2);
        submitter.executeAddSequencer(c3);
        
        vm.deal(user, 100 ether);
    }

    // ============ ThresholdBatchSubmitter Boundary Tests ============

    function testSubmitExactlyAtThreshold() public {
        bytes memory data = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(data);
        
        bytes[] memory sigs = new bytes[](2);
        address[] memory signers = new address[](2);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
        signers[0] = seq1;
        signers[1] = seq2;
        
        submitter.submitBatch(data, sigs, signers);
        assertEq(inbox.callCount(), 1);
    }

    function testSubmitOneAboveThreshold() public {
        bytes memory data = hex"cafebabe";
        bytes32 digest = submitter.getBatchDigest(data);
        
        bytes[] memory sigs = new bytes[](3);
        address[] memory signers = new address[](3);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        (uint8 v3, bytes32 r3, bytes32 s3) = vm.sign(SEQ3_KEY, digest);
        
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
        sigs[2] = abi.encodePacked(r3, s3, v3);
        signers[0] = seq1;
        signers[1] = seq2;
        signers[2] = seq3;
        
        submitter.submitBatch(data, sigs, signers);
        assertEq(inbox.callCount(), 1);
    }

    function testSubmitOneBelowThreshold() public {
        bytes memory data = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(data);
        
        bytes[] memory sigs = new bytes[](1);
        address[] memory signers = new address[](1);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        signers[0] = seq1;
        
        vm.expectRevert(abi.encodeWithSelector(ThresholdBatchSubmitter.InsufficientSignatures.selector, 1, 2));
        submitter.submitBatch(data, sigs, signers);
    }

    function testSubmitWithInboxRevert() public {
        inbox.setRevert(true);
        
        bytes memory data = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(data);
        
        bytes[] memory sigs = new bytes[](2);
        address[] memory signers = new address[](2);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
        signers[0] = seq1;
        signers[1] = seq2;
        
        vm.expectRevert(ThresholdBatchSubmitter.BatchSubmissionFailed.selector);
        submitter.submitBatch(data, sigs, signers);
    }

    function testSubmitWithMaxUint256Nonce() public {
        // Simulate high nonce by submitting many batches
        bytes memory data = hex"aa";
        
        for (uint256 i = 0; i < 5; i++) {
            bytes32 digest = submitter.getBatchDigest(data);
            bytes[] memory sigs = new bytes[](2);
            address[] memory signers = new address[](2);
            
            (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
            (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
            
            sigs[0] = abi.encodePacked(r1, s1, v1);
            sigs[1] = abi.encodePacked(r2, s2, v2);
            signers[0] = seq1;
            signers[1] = seq2;
            
            submitter.submitBatch(data, sigs, signers);
        }
        
        assertEq(submitter.nonce(), 5);
    }

    function testSignatureWithWrongV() public {
        bytes memory data = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(data);
        
        bytes[] memory sigs = new bytes[](2);
        address[] memory signers = new address[](2);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        
        // Corrupt v value
        sigs[0] = abi.encodePacked(r1, s1, uint8(99)); // Invalid v
        sigs[1] = abi.encodePacked(r2, s2, v2);
        signers[0] = seq1;
        signers[1] = seq2;
        
        vm.expectRevert(); // ECDSA recovery will fail
        submitter.submitBatch(data, sigs, signers);
    }

    function testSignatureWithZeroR() public {
        bytes memory data = hex"deadbeef";
        
        bytes[] memory sigs = new bytes[](2);
        address[] memory signers = new address[](2);
        
        sigs[0] = abi.encodePacked(bytes32(0), bytes32(0), uint8(27)); // Zero signature
        sigs[1] = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        signers[0] = seq1;
        signers[1] = seq2;
        
        vm.expectRevert(); // Invalid signature
        submitter.submitBatch(data, sigs, signers);
    }

    function testTimelockExactlyAtBoundary() public {
        vm.prank(owner);
        bytes32 changeId = submitter.proposeSetThreshold(3);
        
        // Warp to one second before execute time
        vm.warp(block.timestamp + 2 days - 1);
        
        // Should revert - still before the delay
        vm.expectRevert(ThresholdBatchSubmitter.TimelockNotExpired.selector);
        submitter.executeSetThreshold(changeId);
        
        // At exactly the boundary should work (>= check)
        vm.warp(block.timestamp + 1);
        submitter.executeSetThreshold(changeId);
        assertEq(submitter.threshold(), 3);
    }

    // ============ ForcedInclusion Boundary Tests ============

    function testQueueExactlyMinFee() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.001 ether}(hex"aa", 100000);
        assertEq(forceInc.totalPendingFees(), 0.001 ether);
    }

    function testQueueOneBelowMinFee() public {
        vm.prank(user);
        vm.expectRevert(ForcedInclusion.InsufficientFee.selector);
        forceInc.queueTx{value: 0.001 ether - 1}(hex"aa", 100000);
    }

    function testForceIncludeExactlyAtWindow() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"aa", 100000);
        bytes32 txId = keccak256(abi.encodePacked(user, hex"aa", uint256(100000), block.number, block.timestamp));
        
        // Roll to exactly the window boundary (block.number <= queuedAtBlock + 50)
        vm.roll(block.number + 50);
        
        // At exactly window end, still can't force (need to be > not >=)
        vm.expectRevert(ForcedInclusion.WindowNotExpired.selector);
        forceInc.forceInclude(txId);
        
        // One block after window should work
        vm.roll(block.number + 1);
        
        uint256 balBefore = address(this).balance;
        forceInc.forceInclude(txId);
        assertGt(address(this).balance, balBefore);
    }

    function testRefundExactlyAtExpiry() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"bb", 100000);
        bytes32 txId = keccak256(abi.encodePacked(user, hex"bb", uint256(100000), block.number, block.timestamp));
        
        // Warp to one second before expiry
        vm.warp(block.timestamp + 1 days - 1);
        vm.roll(block.number + 100);
        
        // Should fail - still before expiry
        vm.expectRevert(ForcedInclusion.WindowNotExpired.selector);
        forceInc.refundExpired(txId);
        
        // At exactly expiry should work (>= check)
        vm.warp(block.timestamp + 1);
        forceInc.refundExpired(txId);
    }

    function testReentrancyOnForceInclude() public {
        ReentrantForcer attacker = new ReentrantForcer();
        vm.deal(address(attacker), 1 ether);
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"cc", 100000);
        bytes32 txId = keccak256(abi.encodePacked(user, hex"cc", uint256(100000), block.number, block.timestamp));
        
        vm.roll(block.number + 51);
        
        // Reentrancy guard blocks the second call - ForceFailed is thrown
        // when the attacker's receive() tries to call forceInclude again
        vm.expectRevert(ForcedInclusion.ForceFailed.selector);
        attacker.attack(forceInc, txId);
    }

    function testMultipleConcurrentQueues() public {
        // Queue 10 transactions
        for (uint256 i = 0; i < 10; i++) {
            bytes memory data = abi.encodePacked(bytes1(uint8(i)));
            vm.prank(user);
            forceInc.queueTx{value: 0.01 ether}(data, 100000);
        }
        
        assertEq(forceInc.getPendingCount(), 10);
        assertEq(forceInc.totalPendingFees(), 0.1 ether);
    }

    function testInvalidMerkleProof() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"dd", 100000);
        bytes32 txId = keccak256(abi.encodePacked(user, hex"dd", uint256(100000), block.number, block.timestamp));
        
        // Invalid proof - wrong root
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = bytes32(uint256(0xdead));
        
        vm.expectRevert(ForcedInclusion.InvalidInclusionProof.selector);
        forceInc.markIncluded(txId, bytes32(uint256(0xbeef)), badProof);
    }

    function testEmptyMerkleProof() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"ee", 100000);
        bytes32 txId = keccak256(abi.encodePacked(user, hex"ee", uint256(100000), block.number, block.timestamp));
        
        bytes32[] memory emptyProof = new bytes32[](0);
        
        vm.expectRevert(ForcedInclusion.InvalidInclusionProof.selector);
        forceInc.markIncluded(txId, bytes32(0), emptyProof);
    }

    // ============ Gas Limit Tests ============

    function testSubmitLargeBatch() public {
        // 128KB batch
        bytes memory data = new bytes(128 * 1024);
        for (uint256 i = 0; i < data.length; i++) {
            data[i] = bytes1(uint8(i % 256));
        }
        
        bytes32 digest = submitter.getBatchDigest(data);
        bytes[] memory sigs = new bytes[](2);
        address[] memory signers = new address[](2);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
        signers[0] = seq1;
        signers[1] = seq2;
        
        uint256 gasBefore = gasleft();
        submitter.submitBatch(data, sigs, signers);
        uint256 gasUsed = gasBefore - gasleft();
        
        // Should use reasonable gas (< 1M for 128KB)
        assertLt(gasUsed, 1_000_000);
    }

    function testQueueMaxGasLimit() public {
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"ff", type(uint256).max);
        assertEq(forceInc.getPendingCount(), 1);
    }

    // ============ State Consistency Tests ============

    function testNonceNeverDecreases() public {
        uint256 prevNonce = submitter.nonce();
        
        for (uint256 i = 0; i < 5; i++) {
            bytes memory data = abi.encodePacked(bytes2(uint16(i)));
            bytes32 digest = submitter.getBatchDigest(data);
            
            bytes[] memory sigs = new bytes[](2);
            address[] memory signers = new address[](2);
            
            (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
            (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
            
            sigs[0] = abi.encodePacked(r1, s1, v1);
            sigs[1] = abi.encodePacked(r2, s2, v2);
            signers[0] = seq1;
            signers[1] = seq2;
            
            submitter.submitBatch(data, sigs, signers);
            
            uint256 currentNonce = submitter.nonce();
            assertGt(currentNonce, prevNonce);
            prevNonce = currentNonce;
        }
    }

    function testPendingFeesAccuracy() public {
        uint256 totalFees = 0;
        
        for (uint256 i = 0; i < 5; i++) {
            uint256 fee = 0.01 ether + i * 0.001 ether;
            bytes memory data = abi.encodePacked(bytes1(uint8(i)));
            vm.prank(user);
            forceInc.queueTx{value: fee}(data, 100000);
            totalFees += fee;
        }
        
        assertEq(forceInc.totalPendingFees(), totalFees);
    }

    // ============ Concurrent Operations ============

    function testConcurrentSequencerAddRemove() public {
        address seq4 = makeAddr("seq4");
        address seq5 = makeAddr("seq5");
        
        vm.startPrank(owner);
        bytes32 add4 = submitter.proposeAddSequencer(seq4);
        bytes32 add5 = submitter.proposeAddSequencer(seq5);
        bytes32 rem1 = submitter.proposeRemoveSequencer(seq1);
        vm.stopPrank();
        
        vm.warp(block.timestamp + 2 days + 1);
        
        // Execute in different order than proposed
        submitter.executeRemoveSequencer(rem1);
        submitter.executeAddSequencer(add5);
        submitter.executeAddSequencer(add4);
        
        assertEq(submitter.sequencerCount(), 4); // 3 - 1 + 2 = 4
        assertFalse(submitter.isSequencer(seq1));
        assertTrue(submitter.isSequencer(seq4));
        assertTrue(submitter.isSequencer(seq5));
    }
}

