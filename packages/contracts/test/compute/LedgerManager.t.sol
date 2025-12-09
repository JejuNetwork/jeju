// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/compute/LedgerManager.sol";

contract LedgerManagerTest is Test {
    LedgerManager public ledger;
    address public owner;
    address public registry;
    address public inference;
    address public user1;
    address public provider1;

    function setUp() public {
        owner = address(this);
        registry = makeAddr("registry");
        inference = makeAddr("inference");
        user1 = makeAddr("user1");
        provider1 = makeAddr("provider1");

        vm.deal(user1, 10 ether);
        vm.deal(provider1, 10 ether);

        ledger = new LedgerManager(registry, owner);
        ledger.setInferenceContract(inference);
    }

    function test_CreateLedger() public {
        vm.startPrank(user1);

        ledger.createLedger{value: 0.1 ether}();

        LedgerManager.Ledger memory userLedger = ledger.getLedger(user1);
        assertEq(userLedger.totalBalance, 0.1 ether);
        assertEq(userLedger.availableBalance, 0.1 ether);
        assertEq(userLedger.lockedBalance, 0);
        assertTrue(ledger.ledgerExists(user1));

        vm.stopPrank();
    }

    function test_CreateLedgerInsufficientDeposit() public {
        vm.startPrank(user1);

        vm.expectRevert(abi.encodeWithSelector(LedgerManager.InsufficientDeposit.selector, 0.0001 ether, 0.001 ether));
        ledger.createLedger{value: 0.0001 ether}();

        vm.stopPrank();
    }

    function test_DepositToExistingLedger() public {
        vm.startPrank(user1);

        ledger.createLedger{value: 0.1 ether}();
        ledger.deposit{value: 0.05 ether}();

        LedgerManager.Ledger memory userLedger = ledger.getLedger(user1);
        assertEq(userLedger.totalBalance, 0.15 ether);
        assertEq(userLedger.availableBalance, 0.15 ether);

        vm.stopPrank();
    }

    function test_Withdraw() public {
        vm.startPrank(user1);

        ledger.createLedger{value: 0.1 ether}();

        uint256 balanceBefore = user1.balance;
        ledger.withdraw(0.05 ether);
        uint256 balanceAfter = user1.balance;

        assertEq(balanceAfter - balanceBefore, 0.05 ether);
        assertEq(ledger.getAvailableBalance(user1), 0.05 ether);

        vm.stopPrank();
    }

    function test_TransferToProvider() public {
        vm.startPrank(user1);

        ledger.createLedger{value: 0.1 ether}();
        ledger.transferToProvider(provider1, 0.05 ether);

        LedgerManager.Ledger memory userLedger = ledger.getLedger(user1);
        assertEq(userLedger.availableBalance, 0.05 ether);
        assertEq(userLedger.lockedBalance, 0.05 ether);

        assertEq(ledger.getProviderBalance(user1, provider1), 0.05 ether);

        vm.stopPrank();
    }

    function test_ProviderAcknowledge() public {
        vm.prank(user1);
        ledger.createLedger{value: 0.1 ether}();

        vm.prank(user1);
        ledger.transferToProvider(provider1, 0.05 ether);

        assertFalse(ledger.isAcknowledged(user1, provider1));

        vm.prank(provider1);
        ledger.acknowledgeUser(user1);

        assertTrue(ledger.isAcknowledged(user1, provider1));
    }

    function test_RequestAndCompleteRefund() public {
        // Setup
        vm.prank(user1);
        ledger.createLedger{value: 0.1 ether}();

        vm.prank(user1);
        ledger.transferToProvider(provider1, 0.05 ether);

        // Request refund
        vm.prank(user1);
        ledger.requestRefund(provider1, 0.05 ether);

        LedgerManager.ProviderSubAccount memory subAccount = ledger.getSubAccount(user1, provider1);
        assertEq(subAccount.balance, 0);
        assertEq(subAccount.pendingRefund, 0.05 ether);
        assertTrue(subAccount.refundUnlockTime > block.timestamp);

        // Try to complete too early
        vm.prank(user1);
        vm.expectRevert(LedgerManager.RefundNotUnlocked.selector);
        ledger.completeRefund(provider1);

        // Warp time and complete
        vm.warp(block.timestamp + 25 hours);
        vm.prank(user1);
        ledger.completeRefund(provider1);

        LedgerManager.Ledger memory userLedger = ledger.getLedger(user1);
        assertEq(userLedger.availableBalance, 0.1 ether);
        assertEq(userLedger.lockedBalance, 0);
    }

    function test_Settle() public {
        // Setup
        vm.prank(user1);
        ledger.createLedger{value: 0.1 ether}();

        vm.prank(user1);
        ledger.transferToProvider(provider1, 0.05 ether);

        vm.prank(provider1);
        ledger.acknowledgeUser(user1);

        // Settle as inference contract
        uint256 providerBalanceBefore = provider1.balance;

        vm.prank(inference);
        ledger.settle(user1, provider1, 0.01 ether, bytes32(uint256(1)));

        uint256 providerBalanceAfter = provider1.balance;
        assertEq(providerBalanceAfter - providerBalanceBefore, 0.01 ether);

        LedgerManager.ProviderSubAccount memory subAccount = ledger.getSubAccount(user1, provider1);
        assertEq(subAccount.balance, 0.04 ether);

        LedgerManager.Ledger memory userLedger = ledger.getLedger(user1);
        assertEq(userLedger.totalBalance, 0.09 ether);
    }

    function test_SettleUnauthorized() public {
        vm.prank(user1);
        ledger.createLedger{value: 0.1 ether}();

        vm.prank(user1);
        ledger.transferToProvider(provider1, 0.05 ether);

        vm.prank(provider1);
        ledger.acknowledgeUser(user1);

        // Try to settle from non-inference address
        vm.prank(user1);
        vm.expectRevert(LedgerManager.UnauthorizedCaller.selector);
        ledger.settle(user1, provider1, 0.01 ether, bytes32(uint256(1)));
    }

    function test_Version() public view {
        assertEq(ledger.version(), "1.0.0");
    }
}
