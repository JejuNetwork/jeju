// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/ForcedInclusion.sol";

contract MockBatchInbox {
    bytes[] public batches;
    
    fallback() external payable {
        batches.push(msg.data);
    }
    
    receive() external payable {}
    
    function getBatchCount() external view returns (uint256) {
        return batches.length;
    }
}

contract ForcedInclusionTest is Test {
    ForcedInclusion public forceInc;
    MockBatchInbox public batchInbox;
    address public user = address(0x1);
    address public sequencer = address(0x2);
    address public forcer = address(0x3);

    function setUp() public {
        batchInbox = new MockBatchInbox();
        forceInc = new ForcedInclusion(address(batchInbox), address(0));
        
        vm.deal(user, 10 ether);
        vm.deal(sequencer, 10 ether);
        vm.deal(forcer, 10 ether);
    }

    // ============ Queue Tests ============

    function testQueueTx() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        assertEq(forceInc.totalPendingFees(), 0.01 ether);
    }

    function testQueueTxInsufficientFee() public {
        bytes memory data = hex"deadbeef";
        
        vm.prank(user);
        vm.expectRevert(ForcedInclusion.InsufficientFee.selector);
        forceInc.queueTx{value: 0.0001 ether}(data, 100000);
    }

    function testQueueTxEmptyData() public {
        vm.prank(user);
        vm.expectRevert(ForcedInclusion.InvalidData.selector);
        forceInc.queueTx{value: 0.01 ether}("", 100000);
    }

    // ============ Mark Included Tests ============

    function testMarkIncluded() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        uint256 balBefore = sequencer.balance;
        
        vm.prank(sequencer);
        forceInc.markIncluded(txId);
        
        // Sequencer receives fee
        assertEq(sequencer.balance, balBefore + 0.01 ether);
        assertEq(forceInc.totalPendingFees(), 0);
    }

    function testMarkIncludedNotFound() public {
        vm.prank(sequencer);
        vm.expectRevert(ForcedInclusion.TxNotFound.selector);
        forceInc.markIncluded(bytes32(0));
    }

    function testMarkIncludedAfterWindow() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Move past inclusion window
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        vm.prank(sequencer);
        vm.expectRevert(ForcedInclusion.WindowExpired.selector);
        forceInc.markIncluded(txId);
    }

    // ============ Force Include Tests ============

    function testForceInclude() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Move past inclusion window
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        uint256 balBefore = forcer.balance;
        
        vm.prank(forcer);
        forceInc.forceInclude(txId);
        
        // Forcer receives reward
        assertEq(forcer.balance, balBefore + 0.01 ether);
        
        // Batch was sent to inbox
        assertEq(batchInbox.getBatchCount(), 1);
    }

    function testForceIncludeWindowNotExpired() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Try to force include before window expires
        vm.prank(forcer);
        vm.expectRevert(ForcedInclusion.WindowNotExpired.selector);
        forceInc.forceInclude(txId);
    }

    function testForceIncludeAlreadyIncluded() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Sequencer includes it
        vm.prank(sequencer);
        forceInc.markIncluded(txId);
        
        // Move past window
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        // Try to force include
        vm.prank(forcer);
        vm.expectRevert(ForcedInclusion.TxAlreadyIncluded.selector);
        forceInc.forceInclude(txId);
    }

    // ============ Getters ============

    function testCanForceInclude() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Not yet
        assertFalse(forceInc.canForceInclude(txId));
        
        // Move past window
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        // Now can force
        assertTrue(forceInc.canForceInclude(txId));
    }

    function testGetOverdueTxs() public {
        bytes memory data1 = hex"deadbeef";
        bytes memory data2 = hex"cafebabe";
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data1, 100000);
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(data2, 100000);
        
        // No overdue yet
        bytes32[] memory overdue = forceInc.getOverdueTxs();
        assertEq(overdue.length, 0);
        
        // Move past window
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        // Now both are overdue
        overdue = forceInc.getOverdueTxs();
        assertEq(overdue.length, 2);
    }

    function testGetPendingCount() public {
        assertEq(forceInc.getPendingCount(), 0);
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"dead", 100000);
        
        vm.prank(user);
        forceInc.queueTx{value: 0.01 ether}(hex"beef", 100000);
        
        assertEq(forceInc.getPendingCount(), 2);
    }

    // ============ Expiry ============

    function testRefundExpired() public {
        bytes memory data = hex"deadbeef";
        uint256 gasLimit = 100000;
        uint256 fee = 0.01 ether;
        
        vm.prank(user);
        forceInc.queueTx{value: fee}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Move past expiry window
        vm.warp(block.timestamp + forceInc.EXPIRY_WINDOW() + 1);
        vm.roll(block.number + forceInc.INCLUSION_WINDOW() + 1);
        
        uint256 balBefore = user.balance;
        
        vm.prank(user);
        forceInc.refundExpired(txId);
        
        assertEq(user.balance, balBefore + fee);
    }
}

