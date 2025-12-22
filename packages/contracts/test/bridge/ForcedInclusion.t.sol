// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../../src/bridge/ForcedInclusion.sol";

contract MockSequencerRegistry {
    mapping(address => bool) public activeSequencers;

    function setActiveSequencer(address sequencer, bool active) external {
        activeSequencers[sequencer] = active;
    }

    function isActiveSequencer(address sequencer) external view returns (bool) {
        return activeSequencers[sequencer];
    }
}

contract MockBatchInbox {
    bytes public lastData;
    bool public shouldRevert;

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    fallback() external payable {
        if (shouldRevert) revert("BatchInbox: forced revert");
        lastData = msg.data;
    }

    receive() external payable {}
}

contract ForcedInclusionTest is Test {
    ForcedInclusion public forcedInclusion;
    MockSequencerRegistry public registry;
    MockBatchInbox public batchInbox;

    address public owner = makeAddr("owner");
    address public securityCouncil = makeAddr("securityCouncil");
    address public user = makeAddr("user");
    address public sequencer = makeAddr("sequencer");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        registry = new MockSequencerRegistry();
        batchInbox = new MockBatchInbox();
        
        forcedInclusion = new ForcedInclusion(
            address(batchInbox),
            address(registry),
            securityCouncil,
            owner
        );

        registry.setActiveSequencer(sequencer, true);
        vm.deal(user, 100 ether);
        vm.deal(sequencer, 10 ether);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(forcedInclusion.batchInbox(), address(batchInbox));
        assertEq(forcedInclusion.sequencerRegistry(), address(registry));
        assertEq(forcedInclusion.securityCouncil(), securityCouncil);
        assertEq(forcedInclusion.owner(), owner);
    }

    function test_Constructor_RevertZeroBatchInbox() public {
        vm.expectRevert(ForcedInclusion.ZeroAddress.selector);
        new ForcedInclusion(address(0), address(registry), securityCouncil, owner);
    }

    // ============ Queue TX Tests ============

    function test_QueueTx() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        uint256 fee = 0.01 ether;

        vm.prank(user);
        forcedInclusion.queueTx{value: fee}(data, gasLimit);

        assertEq(forcedInclusion.totalPendingFees(), fee);
        assertEq(forcedInclusion.getPendingCount(), 1);
    }

    function test_QueueTx_RevertInsufficientFee() public {
        bytes memory data = abi.encodePacked("test data");
        
        vm.prank(user);
        vm.expectRevert(ForcedInclusion.InsufficientFee.selector);
        forcedInclusion.queueTx{value: 0.0001 ether}(data, 100000);
    }

    function test_QueueTx_RevertInvalidData() public {
        vm.prank(user);
        vm.expectRevert(ForcedInclusion.InvalidData.selector);
        forcedInclusion.queueTx{value: 0.01 ether}("", 100000);
    }

    function test_QueueTx_RevertsWhenPaused() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();

        vm.prank(user);
        vm.expectRevert();
        forcedInclusion.queueTx{value: 0.01 ether}("data", 100000);
    }

    // ============ Pause Tests - Security Council Only ============

    function test_Pause_OnlySecurityCouncil() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();
        assertTrue(forcedInclusion.paused());
    }

    function test_Pause_RevertWhenNotSecurityCouncil() public {
        vm.prank(owner);
        vm.expectRevert(ForcedInclusion.NotSecurityCouncil.selector);
        forcedInclusion.pause();
    }

    function test_Pause_RevertWhenAttacker() public {
        vm.prank(attacker);
        vm.expectRevert(ForcedInclusion.NotSecurityCouncil.selector);
        forcedInclusion.pause();
    }

    function test_Pause_EmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ForcedInclusion.EmergencyPause(securityCouncil);
        
        vm.prank(securityCouncil);
        forcedInclusion.pause();
    }

    // ============ Unpause Timelock Tests ============

    function test_ProposeUnpause_OnlyOwner() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();

        vm.prank(owner);
        forcedInclusion.proposeUnpause();
        
        assertEq(forcedInclusion.pendingUnpauseTime(), block.timestamp + 7 days);
    }

    function test_ProposeUnpause_RevertWhenNotOwner() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();

        vm.prank(attacker);
        vm.expectRevert();
        forcedInclusion.proposeUnpause();
    }

    function test_ExecuteUnpause_AfterTimelock() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();
        assertTrue(forcedInclusion.paused());

        vm.prank(owner);
        forcedInclusion.proposeUnpause();

        vm.warp(block.timestamp + 7 days);
        forcedInclusion.executeUnpause();
        
        assertFalse(forcedInclusion.paused());
        assertEq(forcedInclusion.pendingUnpauseTime(), 0);
    }

    function test_ExecuteUnpause_RevertBeforeTimelock() public {
        vm.prank(securityCouncil);
        forcedInclusion.pause();

        vm.prank(owner);
        forcedInclusion.proposeUnpause();

        vm.warp(block.timestamp + 6 days);
        vm.expectRevert(ForcedInclusion.TimelockNotExpired.selector);
        forcedInclusion.executeUnpause();
    }

    function test_ExecuteUnpause_RevertNoPending() public {
        vm.expectRevert(ForcedInclusion.NoPendingUnpause.selector);
        forcedInclusion.executeUnpause();
    }

    function test_UnpauseDelay_Is7Days() public view {
        assertEq(forcedInclusion.UNPAUSE_DELAY(), 7 days);
    }

    // ============ CRITICAL: forceInclude Works When Paused ============

    function test_ForceInclude_WorksWhenPaused() public {
        // Queue a transaction
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);

        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));

        // Security Council pauses
        vm.prank(securityCouncil);
        forcedInclusion.pause();
        assertTrue(forcedInclusion.paused());

        // Advance past inclusion window
        vm.roll(block.number + 51);

        // forceInclude should STILL work even when paused
        uint256 balanceBefore = address(this).balance;
        forcedInclusion.forceInclude(txId);
        
        // Verify reward was paid
        assertGt(address(this).balance, balanceBefore);
    }

    function test_ForceInclude_NotAffectedByPause() public {
        bytes memory data = abi.encodePacked("important transaction");
        uint256 gasLimit = 200000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.05 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));

        // Pause the contract
        vm.prank(securityCouncil);
        forcedInclusion.pause();

        // Wait for window to expire
        vm.roll(block.number + 100);

        // This is the critical test: forceInclude MUST work even when paused
        address forcer = makeAddr("forcer");
        vm.prank(forcer);
        forcedInclusion.forceInclude(txId);

        // Verify the tx was force-included
        (,,,,,, bool included,) = forcedInclusion.queuedTxs(txId);
        assertTrue(included);
    }

    // ============ Registry Change Timelock Tests ============

    function test_ProposeSequencerRegistry() public {
        address newRegistry = makeAddr("newRegistry");
        
        vm.prank(owner);
        forcedInclusion.proposeSequencerRegistry(newRegistry);
        
        (address pendingRegistry, uint256 executeAfter) = forcedInclusion.pendingRegistryChange();
        assertEq(pendingRegistry, newRegistry);
        assertEq(executeAfter, block.timestamp + 2 days);
    }

    function test_ProposeSequencerRegistry_RevertWhenNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        forcedInclusion.proposeSequencerRegistry(makeAddr("newRegistry"));
    }

    function test_ExecuteSequencerRegistry_AfterTimelock() public {
        address newRegistry = makeAddr("newRegistry");
        
        vm.prank(owner);
        forcedInclusion.proposeSequencerRegistry(newRegistry);
        
        vm.warp(block.timestamp + 2 days);
        forcedInclusion.executeSequencerRegistry();
        
        assertEq(forcedInclusion.sequencerRegistry(), newRegistry);
        
        (address pendingRegistry, uint256 executeAfter) = forcedInclusion.pendingRegistryChange();
        assertEq(pendingRegistry, address(0));
        assertEq(executeAfter, 0);
    }

    function test_ExecuteSequencerRegistry_RevertBeforeTimelock() public {
        address newRegistry = makeAddr("newRegistry");
        
        vm.prank(owner);
        forcedInclusion.proposeSequencerRegistry(newRegistry);
        
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(ForcedInclusion.TimelockNotExpired.selector);
        forcedInclusion.executeSequencerRegistry();
    }

    function test_ExecuteSequencerRegistry_RevertNoPending() public {
        vm.expectRevert(ForcedInclusion.NoPendingChange.selector);
        forcedInclusion.executeSequencerRegistry();
    }

    function test_RegistryChangeDelay_Is2Days() public view {
        assertEq(forcedInclusion.REGISTRY_CHANGE_DELAY(), 2 days);
    }

    // ============ Security Council Update Tests ============

    function test_SetSecurityCouncil_OnlyOwner() public {
        address newCouncil = makeAddr("newCouncil");
        
        vm.prank(owner);
        forcedInclusion.setSecurityCouncil(newCouncil);
        
        assertEq(forcedInclusion.securityCouncil(), newCouncil);
    }

    function test_SetSecurityCouncil_RevertWhenNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        forcedInclusion.setSecurityCouncil(makeAddr("newCouncil"));
    }

    function test_SetSecurityCouncil_EmitsEvent() public {
        address newCouncil = makeAddr("newCouncil");
        
        vm.expectEmit(true, true, false, false);
        emit ForcedInclusion.SecurityCouncilUpdated(securityCouncil, newCouncil);
        
        vm.prank(owner);
        forcedInclusion.setSecurityCouncil(newCouncil);
    }

    function test_NewSecurityCouncilCanPause() public {
        address newCouncil = makeAddr("newCouncil");
        
        vm.prank(owner);
        forcedInclusion.setSecurityCouncil(newCouncil);
        
        // Old council cannot pause
        vm.prank(securityCouncil);
        vm.expectRevert(ForcedInclusion.NotSecurityCouncil.selector);
        forcedInclusion.pause();
        
        // New council can pause
        vm.prank(newCouncil);
        forcedInclusion.pause();
        assertTrue(forcedInclusion.paused());
    }

    // ============ Force Include Tests ============

    function test_ForceInclude_Success() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Move past inclusion window
        vm.roll(block.number + 51);
        
        assertTrue(forcedInclusion.canForceInclude(txId));
        
        address forcer = makeAddr("forcer");
        uint256 balanceBefore = forcer.balance;
        
        vm.prank(forcer);
        forcedInclusion.forceInclude(txId);
        
        assertGt(forcer.balance, balanceBefore);
        assertFalse(forcedInclusion.canForceInclude(txId));
    }

    function test_ForceInclude_RevertWindowNotExpired() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        vm.expectRevert(ForcedInclusion.WindowNotExpired.selector);
        forcedInclusion.forceInclude(txId);
    }

    function test_ForceInclude_RevertTxNotFound() public {
        vm.expectRevert(ForcedInclusion.TxNotFound.selector);
        forcedInclusion.forceInclude(bytes32(uint256(123)));
    }

    function test_ForceInclude_RevertAlreadyIncluded() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        vm.roll(block.number + 51);
        
        forcedInclusion.forceInclude(txId);
        
        vm.expectRevert(ForcedInclusion.TxAlreadyIncluded.selector);
        forcedInclusion.forceInclude(txId);
    }

    // ============ Mark Included Tests ============

    function test_MarkIncluded_Success() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Create a valid merkle proof: leaf = keccak256(sender, data, gasLimit)
        // For a single-element tree, root = leaf, so we need a non-empty proof
        // that combines with leaf to produce root
        bytes32 leaf = keccak256(abi.encodePacked(user, data, gasLimit));
        bytes32 sibling = bytes32(uint256(1)); // Any arbitrary sibling
        
        // Calculate the root: since leaf > sibling, root = keccak256(sibling, leaf)
        bytes32 batchRoot = leaf < sibling 
            ? keccak256(abi.encodePacked(leaf, sibling))
            : keccak256(abi.encodePacked(sibling, leaf));
        
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = sibling;
        
        vm.prank(sequencer);
        forcedInclusion.markIncluded(txId, batchRoot, proof);
        
        (,,,,,, bool included,) = forcedInclusion.queuedTxs(txId);
        assertTrue(included);
    }

    function test_MarkIncluded_RevertNotActiveSequencer() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bytes32(uint256(1));
        
        vm.prank(attacker);
        vm.expectRevert(ForcedInclusion.NotActiveSequencer.selector);
        forcedInclusion.markIncluded(txId, bytes32(0), proof);
    }

    // ============ Refund Tests ============

    function test_RefundExpired() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        uint256 fee = 0.01 ether;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: fee}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // Skip past expiry window
        vm.warp(block.timestamp + 1 days + 1);
        
        uint256 balanceBefore = user.balance;
        forcedInclusion.refundExpired(txId);
        
        assertEq(user.balance, balanceBefore + fee);
    }

    // ============ View Function Tests ============

    function test_CanForceInclude() public {
        bytes memory data = abi.encodePacked("test data");
        uint256 gasLimit = 100000;
        
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        assertFalse(forcedInclusion.canForceInclude(txId));
        
        vm.roll(block.number + 51);
        assertTrue(forcedInclusion.canForceInclude(txId));
    }

    function test_GetOverdueTxs() public {
        bytes memory data1 = abi.encodePacked("tx1");
        bytes memory data2 = abi.encodePacked("tx2");
        
        vm.startPrank(user);
        forcedInclusion.queueTx{value: 0.01 ether}(data1, 100000);
        forcedInclusion.queueTx{value: 0.01 ether}(data2, 100000);
        vm.stopPrank();
        
        vm.roll(block.number + 51);
        
        bytes32[] memory overdue = forcedInclusion.getOverdueTxs();
        assertEq(overdue.length, 2);
    }

    // ============ Integration Tests ============

    function test_FullFlow_QueueForceInclude() public {
        bytes memory data = abi.encodePacked("important transaction");
        uint256 gasLimit = 150000;
        uint256 fee = 0.02 ether;
        
        // 1. User queues transaction
        vm.prank(user);
        forcedInclusion.queueTx{value: fee}(data, gasLimit);
        
        bytes32 txId = keccak256(abi.encodePacked(user, data, gasLimit, block.number, block.timestamp));
        
        // 2. Sequencer doesn't include it (censorship)
        vm.roll(block.number + 51);
        
        // 3. Anyone can force-include and get the reward
        address forcer = makeAddr("forcer");
        uint256 forcerBalanceBefore = forcer.balance;
        
        vm.prank(forcer);
        forcedInclusion.forceInclude(txId);
        
        // 4. Verify reward was paid
        assertEq(forcer.balance, forcerBalanceBefore + fee);
        
        // 5. Verify batch inbox received the data
        assertTrue(batchInbox.lastData().length > 0);
    }

    function test_FullFlow_EmergencyPauseAndUnpause() public {
        // 1. User queues a transaction
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}("data", 100000);
        
        // 2. Security Council pauses due to emergency
        vm.prank(securityCouncil);
        forcedInclusion.pause();
        assertTrue(forcedInclusion.paused());
        
        // 3. New queuing is blocked
        vm.prank(user);
        vm.expectRevert();
        forcedInclusion.queueTx{value: 0.01 ether}("data2", 100000);
        
        // 4. Owner proposes unpause
        vm.prank(owner);
        forcedInclusion.proposeUnpause();
        
        // 5. Wait for timelock (7 days)
        vm.warp(block.timestamp + 7 days);
        
        // 6. Execute unpause
        forcedInclusion.executeUnpause();
        assertFalse(forcedInclusion.paused());
        
        // 7. Queuing works again
        vm.prank(user);
        forcedInclusion.queueTx{value: 0.01 ether}("data3", 100000);
    }

    function test_FullFlow_RegistryUpgrade() public {
        address newRegistry = makeAddr("upgradedRegistry");
        
        // 1. Owner proposes registry change
        vm.prank(owner);
        forcedInclusion.proposeSequencerRegistry(newRegistry);
        
        // 2. Cannot execute immediately
        vm.expectRevert(ForcedInclusion.TimelockNotExpired.selector);
        forcedInclusion.executeSequencerRegistry();
        
        // 3. Wait for timelock (2 days)
        vm.warp(block.timestamp + 2 days);
        
        // 4. Execute the change
        forcedInclusion.executeSequencerRegistry();
        
        // 5. Verify
        assertEq(forcedInclusion.sequencerRegistry(), newRegistry);
    }

    // Allow receiving ETH for tests
    receive() external payable {}
}
