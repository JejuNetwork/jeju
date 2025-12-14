// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ProxyPayment} from "../../src/proxy/ProxyPayment.sol";
import {ProxyRegistry} from "../../src/proxy/ProxyRegistry.sol";
import {IProxyRegistry} from "../../src/proxy/interfaces/IProxyRegistry.sol";

contract ProxyPaymentTest is Test {
    ProxyPayment public payment;
    ProxyRegistry public registry;
    
    address public owner = address(1);
    address public treasury = address(2);
    address public coordinator = address(3);
    address public client1 = address(4);
    address public client2 = address(5);
    address public node1 = address(6);
    address public node2 = address(7);
    
    bytes32 public regionUS = keccak256("US");
    bytes32 public regionGB = keccak256("GB");
    
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant MIN_DEPOSIT = 0.0001 ether;
    uint256 public constant PRICE_PER_GB = 0.001 ether;
    
    event SessionOpened(bytes32 indexed sessionId, address indexed client, bytes32 regionCode, uint256 deposit);
    event SessionAssigned(bytes32 indexed sessionId, address indexed node);
    event SessionClosed(bytes32 indexed sessionId, address indexed node, uint256 bytesServed, uint256 nodePayout, uint256 protocolFee, uint256 clientRefund);
    event SessionCancelled(bytes32 indexed sessionId, address indexed client, uint256 refund);
    event PayoutClaimed(address indexed node, uint256 amount);
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy registry first
        registry = new ProxyRegistry(owner, treasury);
        
        // Deploy payment contract
        payment = new ProxyPayment(owner, address(registry), treasury);
        payment.setCoordinator(coordinator);
        
        // Payment contract needs to be able to call recordSession on registry
        // Set payment contract as coordinator on registry
        registry.setCoordinator(address(payment));
        
        vm.stopPrank();
        
        // Fund accounts
        vm.deal(client1, 10 ether);
        vm.deal(client2, 10 ether);
        vm.deal(node1, 10 ether);
        vm.deal(node2, 10 ether);
        
        // Register nodes
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        registry.register{value: MIN_STAKE}(regionGB, "");
    }
    
    // ============ Session Opening Tests ============
    
    function test_OpenSession() public {
        uint256 deposit = 0.01 ether;
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(session.client, client1);
        assertEq(session.regionCode, regionUS);
        assertEq(session.deposit, deposit);
        assertEq(session.node, address(0));
        assertEq(uint8(session.status), uint8(ProxyPayment.SessionStatus.PENDING));
    }
    
    function test_OpenSessionEmitsEvent() public {
        uint256 deposit = 0.01 ether;
        
        vm.prank(client1);
        vm.expectEmit(false, true, false, true);
        emit SessionOpened(bytes32(0), client1, regionUS, deposit);
        payment.openSession{value: deposit}(regionUS);
    }
    
    function test_RevertOpenSessionInsufficientDeposit() public {
        vm.prank(client1);
        vm.expectRevert(abi.encodeWithSelector(ProxyPayment.InvalidDeposit.selector, MIN_DEPOSIT / 2, MIN_DEPOSIT));
        payment.openSession{value: MIN_DEPOSIT / 2}(regionUS);
    }
    
    function test_OpenMultipleSessions() public {
        vm.prank(client1);
        bytes32 session1 = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(client1);
        bytes32 session2 = payment.openSession{value: 0.01 ether}(regionGB);
        
        assertTrue(session1 != session2);
        
        bytes32[] memory clientSessions = payment.getClientSessions(client1);
        assertEq(clientSessions.length, 2);
    }
    
    // ============ Session Assignment Tests ============
    
    function test_AssignNode() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(coordinator);
        vm.expectEmit(true, true, false, false);
        emit SessionAssigned(sessionId, node1);
        payment.assignNode(sessionId, node1);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(session.node, node1);
        assertEq(uint8(session.status), uint8(ProxyPayment.SessionStatus.ACTIVE));
    }
    
    function test_RevertAssignNodeNotCoordinator() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(client2);
        vm.expectRevert(ProxyPayment.NotAuthorized.selector);
        payment.assignNode(sessionId, node1);
    }
    
    function test_RevertAssignNodeInvalidNode() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        address unregisteredNode = address(99);
        
        vm.prank(coordinator);
        vm.expectRevert(ProxyPayment.InvalidNode.selector);
        payment.assignNode(sessionId, unregisteredNode);
    }
    
    function test_RevertAssignNodeSessionNotPending() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.prank(coordinator);
        vm.expectRevert(ProxyPayment.SessionNotPending.selector);
        payment.assignNode(sessionId, node2);
    }
    
    // ============ Session Closing Tests ============
    
    function test_CloseSession() public {
        uint256 deposit = 0.01 ether;
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        // Simulate 500MB transferred (0.5 GB)
        uint256 bytesServed = 500_000_000;
        // Cost = 500MB * 0.001 ETH / 1GB = 0.0005 ETH
        uint256 expectedCost = (bytesServed * PRICE_PER_GB) / 1e9;
        uint256 protocolFee = (expectedCost * 500) / 10000; // 5%
        uint256 nodePayout = expectedCost - protocolFee;
        uint256 clientRefund = deposit - expectedCost;
        
        uint256 client1BalanceBefore = client1.balance;
        
        vm.prank(coordinator);
        payment.closeSession(sessionId, bytesServed);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(uint8(session.status), uint8(ProxyPayment.SessionStatus.COMPLETED));
        assertEq(session.bytesServed, bytesServed);
        
        // Client gets refund immediately
        assertEq(client1.balance, client1BalanceBefore + clientRefund);
        
        // Node has pending payout
        assertEq(payment.pendingPayouts(node1), nodePayout);
        
        // Protocol fees accumulated
        assertEq(payment.totalFeesCollected(), protocolFee);
    }
    
    function test_CloseSessionFullUsage() public {
        uint256 deposit = 0.001 ether;
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        // Transfer 2GB (more than deposited for)
        uint256 bytesServed = 2_000_000_000;
        
        vm.prank(coordinator);
        payment.closeSession(sessionId, bytesServed);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(session.usedAmount, deposit); // Capped at deposit
    }
    
    function test_RevertCloseSessionNotActive() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        // Try to close without assigning node
        vm.prank(coordinator);
        vm.expectRevert(ProxyPayment.SessionNotActive.selector);
        payment.closeSession(sessionId, 1000);
    }
    
    // ============ Session Cancellation Tests ============
    
    function test_CancelSession() public {
        uint256 deposit = 0.01 ether;
        uint256 clientBalanceBefore = client1.balance;
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        assertEq(client1.balance, clientBalanceBefore - deposit);
        
        vm.prank(client1);
        vm.expectEmit(true, true, false, true);
        emit SessionCancelled(sessionId, client1, deposit);
        payment.cancelSession(sessionId);
        
        // Full refund
        assertEq(client1.balance, clientBalanceBefore);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(uint8(session.status), uint8(ProxyPayment.SessionStatus.CANCELLED));
    }
    
    function test_RevertCancelSessionNotClient() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(client2);
        vm.expectRevert(ProxyPayment.NotSessionClient.selector);
        payment.cancelSession(sessionId);
    }
    
    function test_RevertCancelSessionNotPending() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.prank(client1);
        vm.expectRevert(ProxyPayment.SessionNotPending.selector);
        payment.cancelSession(sessionId);
    }
    
    // ============ Session Expiry Tests ============
    
    function test_ExpireSession() public {
        uint256 deposit = 0.01 ether;
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        // Warp past timeout (default 1 hour)
        vm.warp(block.timestamp + 1 hours + 1);
        
        uint256 clientBalanceBefore = client1.balance;
        
        // Anyone can expire
        vm.prank(address(99));
        payment.expireSession(sessionId);
        
        assertEq(client1.balance, clientBalanceBefore + deposit);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(uint8(session.status), uint8(ProxyPayment.SessionStatus.EXPIRED));
    }
    
    function test_ExpireActiveSession() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.warp(block.timestamp + 1 hours + 1);
        
        vm.prank(address(99));
        payment.expireSession(sessionId);
        
        // Node should have failed session recorded
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.totalSessions, 1);
        assertEq(node.successfulSessions, 0);
    }
    
    function test_RevertExpireSessionNotExpired() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        // Try to expire before timeout
        vm.prank(address(99));
        vm.expectRevert(ProxyPayment.SessionNotFound.selector);
        payment.expireSession(sessionId);
    }
    
    function test_IsSessionExpired() public {
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 0.01 ether}(regionUS);
        
        assertFalse(payment.isSessionExpired(sessionId));
        
        vm.warp(block.timestamp + 1 hours);
        assertTrue(payment.isSessionExpired(sessionId));
    }
    
    // ============ Payout Tests ============
    
    function test_ClaimPayout() public {
        // Create and complete a session
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 1 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.prank(coordinator);
        payment.closeSession(sessionId, 500_000_000); // 0.5 GB
        
        uint256 pendingPayout = payment.pendingPayouts(node1);
        assertTrue(pendingPayout > 0);
        
        uint256 node1BalanceBefore = node1.balance;
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, true);
        emit PayoutClaimed(node1, pendingPayout);
        payment.claimPayout();
        
        assertEq(node1.balance, node1BalanceBefore + pendingPayout);
        assertEq(payment.pendingPayouts(node1), 0);
    }
    
    function test_AccumulatePayouts() public {
        // Complete multiple sessions
        for (uint i = 0; i < 3; i++) {
            vm.prank(client1);
            bytes32 sessionId = payment.openSession{value: 1 ether}(regionUS);
            
            vm.prank(coordinator);
            payment.assignNode(sessionId, node1);
            
            vm.prank(coordinator);
            payment.closeSession(sessionId, 100_000_000); // 0.1 GB each
        }
        
        // Should have accumulated payouts from all sessions
        assertTrue(payment.pendingPayouts(node1) > 0);
        
        // Single claim gets all
        vm.prank(node1);
        payment.claimPayout();
        
        assertEq(payment.pendingPayouts(node1), 0);
    }
    
    function test_RevertClaimPayoutNoPending() public {
        vm.prank(node1);
        vm.expectRevert(ProxyPayment.NoPendingPayout.selector);
        payment.claimPayout();
    }
    
    // ============ Admin Tests ============
    
    function test_WithdrawFees() public {
        // Create and complete session
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 1 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.prank(coordinator);
        payment.closeSession(sessionId, 1_000_000_000); // 1 GB
        
        uint256 fees = payment.totalFeesCollected();
        assertTrue(fees > 0);
        
        uint256 treasuryBalanceBefore = treasury.balance;
        
        vm.prank(owner);
        payment.withdrawFees();
        
        assertEq(treasury.balance, treasuryBalanceBefore + fees);
        assertEq(payment.totalFeesCollected(), 0);
    }
    
    function test_SetPricePerGb() public {
        uint256 newPrice = 0.002 ether;
        
        vm.prank(owner);
        payment.setPricePerGb(newPrice);
        
        assertEq(payment.pricePerGb(), newPrice);
    }
    
    function test_SetProtocolFeeBps() public {
        uint256 newFee = 1000; // 10%
        
        vm.prank(owner);
        payment.setProtocolFeeBps(newFee);
        
        assertEq(payment.protocolFeeBps(), newFee);
    }
    
    function test_SetSessionTimeout() public {
        uint256 newTimeout = 2 hours;
        
        vm.prank(owner);
        payment.setSessionTimeout(newTimeout);
        
        assertEq(payment.sessionTimeout(), newTimeout);
    }
    
    function test_Pause() public {
        vm.prank(owner);
        payment.pause();
        
        vm.prank(client1);
        vm.expectRevert();
        payment.openSession{value: 0.01 ether}(regionUS);
    }
    
    function test_EstimateCost() public view {
        uint256 oneGb = 1_000_000_000;
        uint256 cost = payment.estimateCost(oneGb);
        assertEq(cost, PRICE_PER_GB);
        
        uint256 halfGb = 500_000_000;
        cost = payment.estimateCost(halfGb);
        assertEq(cost, PRICE_PER_GB / 2);
    }
    
    function test_Version() public view {
        assertEq(payment.version(), "1.0.0");
    }
    
    // ============ Integration Tests ============
    
    function test_FullSessionFlow() public {
        // 1. Client opens session
        uint256 deposit = 1 ether;
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        // 2. Coordinator assigns node
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        // 3. Simulate some usage (500 MB)
        uint256 bytesServed = 500_000_000;
        uint256 expectedCost = (bytesServed * PRICE_PER_GB) / 1e9;
        
        // 4. Close session
        vm.prank(coordinator);
        payment.closeSession(sessionId, bytesServed);
        
        // 5. Verify registry was updated
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.totalBytesServed, bytesServed);
        assertEq(node.totalSessions, 1);
        assertEq(node.successfulSessions, 1);
        
        // 6. Node claims payout
        uint256 node1BalanceBefore = node1.balance;
        vm.prank(node1);
        payment.claimPayout();
        
        uint256 protocolFee = (expectedCost * 500) / 10000;
        uint256 expectedPayout = expectedCost - protocolFee;
        assertEq(node1.balance - node1BalanceBefore, expectedPayout);
    }
    
    // ============ Fuzz Tests ============
    
    function testFuzz_OpenSessionWithVariableDeposit(uint256 deposit) public {
        deposit = bound(deposit, MIN_DEPOSIT, 5 ether); // Keep within client's balance
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: deposit}(regionUS);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(session.deposit, deposit);
    }
    
    function testFuzz_CloseSessionWithVariableBytes(uint256 bytesServed) public {
        bytesServed = bound(bytesServed, 0, 10_000_000_000); // Up to 10 GB
        
        vm.prank(client1);
        bytes32 sessionId = payment.openSession{value: 1 ether}(regionUS);
        
        vm.prank(coordinator);
        payment.assignNode(sessionId, node1);
        
        vm.prank(coordinator);
        payment.closeSession(sessionId, bytesServed);
        
        ProxyPayment.Session memory session = payment.getSession(sessionId);
        assertEq(session.bytesServed, bytesServed);
        
        // usedAmount should be capped at deposit
        assertTrue(session.usedAmount <= session.deposit);
    }
}

