// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {CircuitBreaker} from "../src/council/CircuitBreaker.sol";

contract MockPausable {
    bool public paused;

    function pause() external {
        paused = true;
    }

    function unpause() external {
        paused = false;
    }
}

contract MockDelegationRegistry {
    address[] public council;

    function setSecurityCouncil(address[] memory _council) external {
        council = _council;
    }

    function getSecurityCouncil() external view returns (address[] memory) {
        return council;
    }

    function isSecurityCouncilMember(address member) external view returns (bool) {
        for (uint256 i = 0; i < council.length; i++) {
            if (council[i] == member) return true;
        }
        return false;
    }
}

contract CircuitBreakerTest is Test {
    CircuitBreaker public breaker;
    MockPausable public pausable1;
    MockPausable public pausable2;
    MockDelegationRegistry public delegation;

    address public owner = address(this);
    address public safe = address(0x5AFE);
    address public councilMember = address(0x1);

    function setUp() public {
        // Warp past initial cooldown period (default is 1 hour)
        vm.warp(2 hours);

        pausable1 = new MockPausable();
        pausable2 = new MockPausable();
        delegation = new MockDelegationRegistry();

        breaker = new CircuitBreaker(safe, address(delegation), owner);

        // Add council member
        breaker.addSecurityCouncilMember(councilMember);

        // Register contracts
        breaker.registerContract(address(pausable1), "Contract 1", 1);
        breaker.registerContract(address(pausable2), "Contract 2", 5);
    }

    function testRegisterContract() public {
        MockPausable newContract = new MockPausable();

        breaker.registerContract(address(newContract), "New Contract", 3);

        CircuitBreaker.ProtectedContract memory pc = breaker.getProtectedContract(address(newContract));
        assertEq(pc.name, "New Contract");
        assertEq(pc.priority, 3);
        assertTrue(pc.isRegistered);
        assertFalse(pc.isPaused);
    }

    function testUnregisterContract() public {
        breaker.unregisterContract(address(pausable1));

        CircuitBreaker.ProtectedContract memory pc = breaker.getProtectedContract(address(pausable1));
        assertFalse(pc.isRegistered);
    }

    function testPauseContract() public {
        vm.prank(councilMember);
        bytes32 eventId = breaker.pauseContract(address(pausable1), "Security concern");

        assertTrue(pausable1.paused());

        CircuitBreaker.ProtectedContract memory pc = breaker.getProtectedContract(address(pausable1));
        assertTrue(pc.isPaused);
        assertEq(pc.pauseReason, "Security concern");
        assertEq(pc.pausedBy, councilMember);

        assertTrue(eventId != bytes32(0));
    }

    function testUnpauseContract() public {
        // First pause
        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "Test");

        // Unpause from Safe
        vm.prank(safe);
        breaker.unpauseContract(address(pausable1));

        assertFalse(pausable1.paused());

        CircuitBreaker.ProtectedContract memory pc = breaker.getProtectedContract(address(pausable1));
        assertFalse(pc.isPaused);
    }

    function testGlobalEmergencyPause() public {
        vm.prank(councilMember);
        breaker.globalEmergencyPause("Critical vulnerability");

        assertTrue(breaker.globalPause());
        assertTrue(pausable1.paused());
        assertTrue(pausable2.paused());
    }

    function testGlobalUnpause() public {
        vm.prank(councilMember);
        breaker.globalEmergencyPause("Test");

        vm.prank(safe);
        breaker.globalUnpause();

        assertFalse(breaker.globalPause());
        assertFalse(pausable1.paused());
        assertFalse(pausable2.paused());
    }

    function testOnlySecurityCouncilCanPause() public {
        address notCouncil = address(0x999);

        vm.prank(notCouncil);
        vm.expectRevert(CircuitBreaker.NotSecurityCouncil.selector);
        breaker.pauseContract(address(pausable1), "Test");
    }

    function testOnlySafeCanUnpause() public {
        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "Test");

        vm.prank(councilMember);
        vm.expectRevert(CircuitBreaker.NotSafe.selector);
        breaker.unpauseContract(address(pausable1));
    }

    function testPauseCooldown() public {
        vm.prank(councilMember);
        breaker.globalEmergencyPause("First");

        vm.prank(safe);
        breaker.globalUnpause();

        // Try again immediately
        vm.prank(councilMember);
        vm.expectRevert(CircuitBreaker.PauseCooldown.selector);
        breaker.globalEmergencyPause("Second");

        // Fast forward past cooldown
        vm.warp(block.timestamp + 2 hours);

        vm.prank(councilMember);
        breaker.globalEmergencyPause("Third");
        assertTrue(breaker.globalPause());
    }

    function testSyncSecurityCouncil() public {
        address[] memory newCouncil = new address[](2);
        newCouncil[0] = address(0x111);
        newCouncil[1] = address(0x222);

        delegation.setSecurityCouncil(newCouncil);

        breaker.syncSecurityCouncil();

        address[] memory members = breaker.getSecurityCouncilMembers();
        // Should include owner + synced members
        assertTrue(members.length >= 2);
    }

    function testAnomalyConfig() public {
        breaker.setAnomalyConfig(50, 100 ether, 1000 ether, true);

        (uint256 maxTx, uint256 maxValue, uint256 maxHour, bool enabled) = breaker.anomalyConfig();
        assertEq(maxTx, 50);
        assertEq(maxValue, 100 ether);
        assertEq(maxHour, 1000 ether);
        assertTrue(enabled);
    }

    function testGetPausedContracts() public {
        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "Test");

        address[] memory pausedList = breaker.getPausedContracts();
        assertEq(pausedList.length, 1);
        assertEq(pausedList[0], address(pausable1));
    }

    function testPauseHistory() public {
        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "First pause");

        vm.prank(safe);
        breaker.unpauseContract(address(pausable1));

        CircuitBreaker.PauseEvent[] memory history = breaker.getPauseHistory(10);
        assertEq(history.length, 1);
        assertEq(history[0].target, address(pausable1));
        assertEq(history[0].reason, "First pause");
        assertTrue(history[0].unpausedAt > 0);
    }

    function testIsContractPaused() public {
        assertFalse(breaker.isContractPaused(address(pausable1)));

        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "Test");

        assertTrue(breaker.isContractPaused(address(pausable1)));

        // Also true during global pause
        vm.prank(safe);
        breaker.unpauseContract(address(pausable1));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(councilMember);
        breaker.globalEmergencyPause("Global");

        assertTrue(breaker.isContractPaused(address(pausable1)));
        assertTrue(breaker.isContractPaused(address(pausable2)));
    }

    function testSetSafe() public {
        address newSafe = address(0xBEEF);
        breaker.setSafe(newSafe);

        // Old safe can't unpause
        vm.prank(councilMember);
        breaker.pauseContract(address(pausable1), "Test");

        vm.prank(safe);
        vm.expectRevert(CircuitBreaker.NotSafe.selector);
        breaker.unpauseContract(address(pausable1));

        // New safe can
        vm.prank(newSafe);
        breaker.unpauseContract(address(pausable1));
    }

    function testVersion() public view {
        assertEq(breaker.version(), "1.0.0");
    }
}
