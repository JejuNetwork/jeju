// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {GovernanceMixin} from "../../src/governance/GovernanceMixin.sol";

contract GovernanceMixinHarness {
    using GovernanceMixin for GovernanceMixin.Data;

    GovernanceMixin.Data public gov;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function setGovernance(address addr) external {
        gov.setGovernance(addr);
    }

    function setSecurityBoard(address addr) external {
        gov.setSecurityBoard(addr);
    }

    function setTimelock(address addr) external {
        gov.setTimelock(addr);
    }

    function setEnabled(bool enabled) external {
        gov.setEnabled(enabled);
    }

    function requireGovernance() external view {
        gov.requireGovernance();
    }

    function requireSecurityBoard() external view {
        gov.requireSecurityBoard();
    }

    function requireTimelock() external view {
        gov.requireTimelock();
    }

    function requireGovernanceOrOwner() external view {
        gov.requireGovernanceOrOwner(owner);
    }

    function requireSecurityBoardOrOwner() external view {
        gov.requireSecurityBoardOrOwner(owner);
    }

    function isGovernance() external view returns (bool) {
        return gov.isGovernance();
    }

    function isSecurityBoard() external view returns (bool) {
        return gov.isSecurityBoard();
    }

    function canExecute() external view returns (bool) {
        return gov.canExecute();
    }

    function getData() external view returns (address, address, address, bool) {
        return (gov.governance, gov.securityBoard, gov.timelock, gov.enabled);
    }
}

contract GovernanceMixinTest is Test {
    GovernanceMixinHarness harness;
    address governance = makeAddr("governance");
    address securityBoard = makeAddr("securityBoard");
    address timelock = makeAddr("timelock");
    address owner;
    address attacker = makeAddr("attacker");

    event GovernanceSet(address indexed governance);
    event SecurityBoardSet(address indexed board);
    event TimelockSet(address indexed timelock);
    event GovernanceEnabledChanged(bool enabled);

    function setUp() public {
        harness = new GovernanceMixinHarness();
        owner = address(this);
    }

    function test_SetGovernance_EmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit GovernanceSet(governance);
        harness.setGovernance(governance);

        (address g,,,) = harness.getData();
        assertEq(g, governance);
    }

    function test_SetSecurityBoard_EmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit SecurityBoardSet(securityBoard);
        harness.setSecurityBoard(securityBoard);

        (, address sc,,) = harness.getData();
        assertEq(sc, securityBoard);
    }

    function test_SetTimelock_EmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit TimelockSet(timelock);
        harness.setTimelock(timelock);

        (,, address tl,) = harness.getData();
        assertEq(tl, timelock);
    }

    function test_SetEnabled_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit GovernanceEnabledChanged(true);
        harness.setEnabled(true);

        (,,, bool enabled) = harness.getData();
        assertTrue(enabled);
    }

    function test_RequireGovernance_DisabledAllowsAnyone() public {
        harness.setGovernance(governance);
        // Governance not enabled, anyone can call
        vm.prank(attacker);
        harness.requireGovernance(); // Should not revert
    }

    function test_RequireGovernance_EnabledBlocksUnauthorized() public {
        harness.setGovernance(governance);
        harness.setEnabled(true);

        vm.prank(attacker);
        vm.expectRevert(GovernanceMixin.NotGovernance.selector);
        harness.requireGovernance();
    }

    function test_RequireGovernance_EnabledAllowsGovernance() public {
        harness.setGovernance(governance);
        harness.setEnabled(true);

        vm.prank(governance);
        harness.requireGovernance(); // Should not revert
    }

    function test_RequireGovernance_EnabledAllowsTimelock() public {
        harness.setGovernance(governance);
        harness.setTimelock(timelock);
        harness.setEnabled(true);

        vm.prank(timelock);
        harness.requireGovernance(); // Should not revert
    }

    function test_RequireSecurityBoard_BlocksUnauthorized() public {
        harness.setSecurityBoard(securityBoard);

        vm.prank(attacker);
        vm.expectRevert(GovernanceMixin.NotSecurityBoard.selector);
        harness.requireSecurityBoard();
    }

    function test_RequireSecurityBoard_AllowsBoard() public {
        harness.setSecurityBoard(securityBoard);

        vm.prank(securityBoard);
        harness.requireSecurityBoard(); // Should not revert
    }

    function test_RequireTimelock_BlocksUnauthorized() public {
        harness.setTimelock(timelock);

        vm.prank(attacker);
        vm.expectRevert(GovernanceMixin.NotTimelock.selector);
        harness.requireTimelock();
    }

    function test_RequireTimelock_AllowsTimelock() public {
        harness.setTimelock(timelock);

        vm.prank(timelock);
        harness.requireTimelock(); // Should not revert
    }

    function test_RequireGovernanceOrOwner_DisabledAllowsOwner() public {
        harness.setGovernance(governance);
        // Governance disabled, only owner allowed
        vm.prank(owner);
        harness.requireGovernanceOrOwner(); // Should not revert
    }

    function test_RequireGovernanceOrOwner_DisabledBlocksNonOwner() public {
        harness.setGovernance(governance);
        // Governance disabled
        vm.prank(attacker);
        vm.expectRevert(GovernanceMixin.NotGovernance.selector);
        harness.requireGovernanceOrOwner();
    }

    function test_RequireGovernanceOrOwner_EnabledAllowsAll() public {
        harness.setGovernance(governance);
        harness.setTimelock(timelock);
        harness.setEnabled(true);

        // Governance can call
        vm.prank(governance);
        harness.requireGovernanceOrOwner();

        // Timelock can call
        vm.prank(timelock);
        harness.requireGovernanceOrOwner();

        // Owner can call
        vm.prank(owner);
        harness.requireGovernanceOrOwner();
    }

    function test_RequireSecurityBoardOrOwner_AllowsBoth() public {
        harness.setSecurityBoard(securityBoard);

        vm.prank(securityBoard);
        harness.requireSecurityBoardOrOwner();

        vm.prank(owner);
        harness.requireSecurityBoardOrOwner();
    }

    function test_RequireSecurityBoardOrOwner_BlocksOthers() public {
        harness.setSecurityBoard(securityBoard);

        vm.prank(attacker);
        vm.expectRevert(GovernanceMixin.NotSecurityBoard.selector);
        harness.requireSecurityBoardOrOwner();
    }

    function test_IsGovernance_ReturnsTrueForGovernance() public {
        harness.setGovernance(governance);

        vm.prank(governance);
        assertTrue(harness.isGovernance());
    }

    function test_IsGovernance_ReturnsTrueForTimelock() public {
        harness.setTimelock(timelock);

        vm.prank(timelock);
        assertTrue(harness.isGovernance());
    }

    function test_IsGovernance_ReturnsFalseForOthers() public {
        harness.setGovernance(governance);

        vm.prank(attacker);
        assertFalse(harness.isGovernance());
    }

    function test_IsSecurityBoard_ReturnsCorrectly() public {
        harness.setSecurityBoard(securityBoard);

        vm.prank(securityBoard);
        assertTrue(harness.isSecurityBoard());

        vm.prank(attacker);
        assertFalse(harness.isSecurityBoard());
    }

    function test_CanExecute_DisabledReturnsTrue() public {
        vm.prank(attacker);
        assertTrue(harness.canExecute());
    }

    function test_CanExecute_EnabledChecksAuth() public {
        harness.setGovernance(governance);
        harness.setEnabled(true);

        vm.prank(governance);
        assertTrue(harness.canExecute());

        vm.prank(attacker);
        assertFalse(harness.canExecute());
    }

    function test_ZeroAddresses_StillWork() public {
        harness.setGovernance(address(0));
        harness.setSecurityBoard(address(0));
        harness.setTimelock(address(0));

        (address g, address sc, address tl,) = harness.getData();
        assertEq(g, address(0));
        assertEq(sc, address(0));
        assertEq(tl, address(0));
    }

    function test_EnableDisableCycle() public {
        harness.setGovernance(governance);

        // Start disabled
        (,,, bool enabled) = harness.getData();
        assertFalse(enabled);

        // Enable
        harness.setEnabled(true);
        (,,, enabled) = harness.getData();
        assertTrue(enabled);

        // Disable again
        harness.setEnabled(false);
        (,,, enabled) = harness.getData();
        assertFalse(enabled);
    }

    function testFuzz_SetAddresses(address g, address sc, address tl) public {
        harness.setGovernance(g);
        harness.setSecurityBoard(sc);
        harness.setTimelock(tl);

        (address gotG, address gotSC, address gotTL,) = harness.getData();
        assertEq(gotG, g);
        assertEq(gotSC, sc);
        assertEq(gotTL, tl);
    }
}
