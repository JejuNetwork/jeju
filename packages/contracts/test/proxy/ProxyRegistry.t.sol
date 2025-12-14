// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ProxyRegistry} from "../../src/proxy/ProxyRegistry.sol";
import {IProxyRegistry} from "../../src/proxy/interfaces/IProxyRegistry.sol";

contract ProxyRegistryTest is Test {
    ProxyRegistry public registry;
    
    address public owner = address(1);
    address public treasury = address(2);
    address public coordinator = address(3);
    address public node1 = address(4);
    address public node2 = address(5);
    address public node3 = address(6);
    
    bytes32 public regionUS = keccak256("US");
    bytes32 public regionGB = keccak256("GB");
    bytes32 public regionDE = keccak256("DE");
    
    uint256 public constant MIN_STAKE = 0.01 ether;
    
    event NodeRegistered(address indexed node, bytes32 regionCode, uint256 stake, string endpoint);
    event NodeUpdated(address indexed node, bytes32 regionCode, string endpoint);
    event NodeDeactivated(address indexed node);
    event NodeReactivated(address indexed node);
    event StakeAdded(address indexed node, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed node, uint256 amount);
    event SessionRecorded(address indexed node, uint256 bytesServed, bool successful);
    event NodeSlashed(address indexed node, uint256 amount, string reason);
    
    function setUp() public {
        vm.prank(owner);
        registry = new ProxyRegistry(owner, treasury);
        
        vm.prank(owner);
        registry.setCoordinator(coordinator);
        
        // Fund test accounts
        vm.deal(node1, 10 ether);
        vm.deal(node2, 10 ether);
        vm.deal(node3, 10 ether);
    }
    
    // ============ Registration Tests ============
    
    function test_Register() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "http://node1:8080");
        
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.owner, node1);
        assertEq(node.regionCode, regionUS);
        assertEq(node.stake, MIN_STAKE);
        assertEq(node.endpoint, "http://node1:8080");
        assertTrue(node.active);
        assertEq(node.totalSessions, 0);
    }
    
    function test_RegisterWithExactMinStake() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        assertTrue(registry.isActive(node1));
    }
    
    function test_RegisterWithMoreThanMinStake() public {
        uint256 stake = 1 ether;
        
        vm.prank(node1);
        registry.register{value: stake}(regionUS, "");
        
        assertEq(registry.getNodeStake(node1), stake);
    }
    
    function test_RevertRegisterInsufficientStake() public {
        vm.prank(node1);
        vm.expectRevert(abi.encodeWithSelector(IProxyRegistry.InsufficientStake.selector, 0.005 ether, MIN_STAKE));
        registry.register{value: 0.005 ether}(regionUS, "");
    }
    
    function test_RevertRegisterZeroRegion() public {
        vm.prank(node1);
        vm.expectRevert(IProxyRegistry.InvalidRegion.selector);
        registry.register{value: MIN_STAKE}(bytes32(0), "");
    }
    
    function test_RevertRegisterAlreadyRegistered() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node1);
        vm.expectRevert(IProxyRegistry.NodeAlreadyRegistered.selector);
        registry.register{value: MIN_STAKE}(regionGB, "");
    }
    
    function test_RegisterMultipleNodes() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node3);
        registry.register{value: MIN_STAKE}(regionGB, "");
        
        assertEq(registry.getNodeCount(), 3);
        
        address[] memory usNodes = registry.getNodesByRegion(regionUS);
        assertEq(usNodes.length, 2);
        
        address[] memory gbNodes = registry.getNodesByRegion(regionGB);
        assertEq(gbNodes.length, 1);
    }
    
    // ============ Update Node Tests ============
    
    function test_UpdateNodeRegion() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "http://node1:8080");
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, true);
        emit NodeUpdated(node1, regionGB, "http://node1:8080");
        registry.updateNode(regionGB, "");
        
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.regionCode, regionGB);
        
        // Verify region list updates
        address[] memory usNodes = registry.getNodesByRegion(regionUS);
        assertEq(usNodes.length, 0);
        
        address[] memory gbNodes = registry.getNodesByRegion(regionGB);
        assertEq(gbNodes.length, 1);
        assertEq(gbNodes[0], node1);
    }
    
    function test_UpdateNodeEndpoint() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "http://old:8080");
        
        vm.prank(node1);
        registry.updateNode(bytes32(0), "http://new:9090");
        
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.endpoint, "http://new:9090");
        assertEq(node.regionCode, regionUS); // Region unchanged
    }
    
    function test_RevertUpdateNotRegistered() public {
        vm.prank(node1);
        vm.expectRevert(IProxyRegistry.NodeNotRegistered.selector);
        registry.updateNode(regionGB, "");
    }
    
    // ============ Deactivate/Reactivate Tests ============
    
    function test_Deactivate() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, false);
        emit NodeDeactivated(node1);
        registry.deactivate();
        
        assertFalse(registry.isActive(node1));
        
        // Node should not appear in active lists
        address[] memory activeNodes = registry.getActiveNodes();
        assertEq(activeNodes.length, 0);
    }
    
    function test_Reactivate() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node1);
        registry.deactivate();
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, false);
        emit NodeReactivated(node1);
        registry.reactivate();
        
        assertTrue(registry.isActive(node1));
    }
    
    function test_RevertReactivateInsufficientStake() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node1);
        registry.deactivate();
        
        // Slash the node to below minimum
        vm.prank(owner);
        registry.slash(node1, MIN_STAKE, "test");
        
        vm.prank(node1);
        vm.expectRevert(abi.encodeWithSelector(IProxyRegistry.InsufficientStake.selector, 0, MIN_STAKE));
        registry.reactivate();
    }
    
    // ============ Staking Tests ============
    
    function test_AddStake() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        uint256 additionalStake = 0.5 ether;
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, true);
        emit StakeAdded(node1, additionalStake, MIN_STAKE + additionalStake);
        registry.addStake{value: additionalStake}();
        
        assertEq(registry.getNodeStake(node1), MIN_STAKE + additionalStake);
    }
    
    function test_WithdrawStake() public {
        uint256 initialStake = 1 ether;
        
        vm.prank(node1);
        registry.register{value: initialStake}(regionUS, "");
        
        uint256 withdrawAmount = 0.5 ether;
        
        vm.prank(node1);
        vm.expectEmit(true, false, false, true);
        emit StakeWithdrawn(node1, withdrawAmount);
        registry.withdrawStake(withdrawAmount);
        
        assertEq(registry.getNodeStake(node1), initialStake - withdrawAmount);
        assertEq(node1.balance, 10 ether - initialStake + withdrawAmount);
    }
    
    function test_RevertWithdrawBelowMinimum() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node1);
        vm.expectRevert(IProxyRegistry.WithdrawalWouldBreachMinimum.selector);
        registry.withdrawStake(0.001 ether);
    }
    
    function test_WithdrawAllAfterDeactivate() public {
        uint256 stake = 1 ether;
        
        vm.prank(node1);
        registry.register{value: stake}(regionUS, "");
        
        vm.prank(node1);
        registry.deactivate();
        
        vm.prank(node1);
        registry.withdrawStake(stake);
        
        assertEq(registry.getNodeStake(node1), 0);
    }
    
    // ============ Session Recording Tests ============
    
    function test_RecordSession() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(coordinator);
        vm.expectEmit(true, false, false, true);
        emit SessionRecorded(node1, 1_000_000, true);
        registry.recordSession(node1, 1_000_000, true);
        
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.totalBytesServed, 1_000_000);
        assertEq(node.totalSessions, 1);
        assertEq(node.successfulSessions, 1);
    }
    
    function test_RecordFailedSession() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(coordinator);
        registry.recordSession(node1, 500_000, true);
        
        vm.prank(coordinator);
        registry.recordSession(node1, 0, false);
        
        IProxyRegistry.ProxyNode memory node = registry.getNode(node1);
        assertEq(node.totalSessions, 2);
        assertEq(node.successfulSessions, 1);
        assertEq(registry.getSuccessRate(node1), 50);
    }
    
    function test_RevertRecordSessionNotCoordinator() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        vm.expectRevert(IProxyRegistry.NotAuthorized.selector);
        registry.recordSession(node1, 1_000_000, true);
    }
    
    function test_OwnerCanRecordSession() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(owner);
        registry.recordSession(node1, 1_000_000, true);
        
        assertEq(registry.getNode(node1).totalSessions, 1);
    }
    
    // ============ Slashing Tests ============
    
    function test_Slash() public {
        uint256 stake = 1 ether;
        
        vm.prank(node1);
        registry.register{value: stake}(regionUS, "");
        
        uint256 slashAmount = 0.5 ether;
        uint256 treasuryBalanceBefore = treasury.balance;
        
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit NodeSlashed(node1, slashAmount, "misbehavior");
        registry.slash(node1, slashAmount, "misbehavior");
        
        assertEq(registry.getNodeStake(node1), stake - slashAmount);
        assertEq(treasury.balance, treasuryBalanceBefore + slashAmount);
        assertFalse(registry.isActive(node1)); // Slashing deactivates
    }
    
    function test_RevertSlashExceedsStake() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(owner);
        vm.expectRevert(IProxyRegistry.SlashExceedsStake.selector);
        registry.slash(node1, 1 ether, "too much");
    }
    
    function test_RevertSlashNotOwner() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        vm.expectRevert();
        registry.slash(node1, 0.005 ether, "not authorized");
    }
    
    // ============ View Function Tests ============
    
    function test_GetActiveNodes() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node3);
        registry.register{value: MIN_STAKE}(regionGB, "");
        
        vm.prank(node2);
        registry.deactivate();
        
        address[] memory activeNodes = registry.getActiveNodes();
        assertEq(activeNodes.length, 2);
    }
    
    function test_GetNodesByRegion() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node2);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        vm.prank(node3);
        registry.register{value: MIN_STAKE}(regionGB, "");
        
        address[] memory usNodes = registry.getNodesByRegion(regionUS);
        assertEq(usNodes.length, 2);
        
        address[] memory gbNodes = registry.getNodesByRegion(regionGB);
        assertEq(gbNodes.length, 1);
        
        address[] memory deNodes = registry.getNodesByRegion(regionDE);
        assertEq(deNodes.length, 0);
    }
    
    function test_SuccessRateNoSessions() public {
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        assertEq(registry.getSuccessRate(node1), 100);
    }
    
    // ============ Admin Tests ============
    
    function test_SetMinNodeStake() public {
        uint256 newMinStake = 0.1 ether;
        
        vm.prank(owner);
        registry.setMinNodeStake(newMinStake);
        
        assertEq(registry.minNodeStake(), newMinStake);
        
        // New registrations need new minimum
        vm.prank(node1);
        vm.expectRevert(abi.encodeWithSelector(IProxyRegistry.InsufficientStake.selector, MIN_STAKE, newMinStake));
        registry.register{value: MIN_STAKE}(regionUS, "");
    }
    
    function test_Pause() public {
        vm.prank(owner);
        registry.pause();
        
        vm.prank(node1);
        vm.expectRevert();
        registry.register{value: MIN_STAKE}(regionUS, "");
    }
    
    function test_Unpause() public {
        vm.prank(owner);
        registry.pause();
        
        vm.prank(owner);
        registry.unpause();
        
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        assertTrue(registry.isActive(node1));
    }
    
    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }
    
    // ============ Fuzz Tests ============
    
    function testFuzz_RegisterWithVariableStake(uint256 stake) public {
        stake = bound(stake, MIN_STAKE, 100 ether);
        vm.deal(node1, stake + 1 ether);
        
        vm.prank(node1);
        registry.register{value: stake}(regionUS, "");
        
        assertEq(registry.getNodeStake(node1), stake);
    }
    
    function testFuzz_AddAndWithdrawStake(uint256 addAmount, uint256 withdrawAmount) public {
        // Keep within node1's balance (10 ether - MIN_STAKE already spent)
        addAmount = bound(addAmount, 0, 5 ether);
        
        vm.prank(node1);
        registry.register{value: MIN_STAKE}(regionUS, "");
        
        if (addAmount > 0) {
            vm.prank(node1);
            registry.addStake{value: addAmount}();
        }
        
        uint256 totalStake = MIN_STAKE + addAmount;
        uint256 maxWithdraw = totalStake - MIN_STAKE;
        withdrawAmount = bound(withdrawAmount, 0, maxWithdraw);
        
        if (withdrawAmount > 0) {
            vm.prank(node1);
            registry.withdrawStake(withdrawAmount);
        }
        
        assertEq(registry.getNodeStake(node1), totalStake - withdrawAmount);
    }
}

