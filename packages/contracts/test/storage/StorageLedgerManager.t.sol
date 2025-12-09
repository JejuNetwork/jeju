// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {StorageLedgerManager} from "../../src/storage/StorageLedgerManager.sol";
import {IStorageTypes} from "../../src/storage/IStorageTypes.sol";

contract StorageLedgerManagerTest is Test, IStorageTypes {
    StorageLedgerManager public ledger;
    
    address public user = makeAddr("user");
    address public provider = makeAddr("provider");
    
    uint256 constant DEPOSIT = 1 ether;
    
    function setUp() public {
        ledger = new StorageLedgerManager();
        
        vm.deal(user, 10 ether);
    }
    
    // ========== Ledger Creation Tests ==========
    
    function test_CreateLedger() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        assertTrue(ledger.ledgerExists(user));
        
        IStorageTypes.Ledger memory l = ledger.getLedger(user);
        assertEq(l.totalBalance, DEPOSIT);
        assertEq(l.availableBalance, DEPOSIT);
        assertEq(l.lockedBalance, 0);
        assertGt(l.createdAt, 0);
    }
    
    function test_CreateLedgerWithoutDeposit() public {
        vm.prank(user);
        ledger.createLedger{value: 0}();
        
        assertTrue(ledger.ledgerExists(user));
        assertEq(ledger.getAvailableBalance(user), 0);
    }
    
    function test_RevertCreateDuplicateLedger() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.expectRevert("Ledger exists");
        ledger.createLedger{value: DEPOSIT}();
        vm.stopPrank();
    }
    
    // ========== Deposit Tests ==========
    
    function test_Deposit() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        uint256 additional = 0.5 ether;
        ledger.deposit{value: additional}();
        vm.stopPrank();
        
        IStorageTypes.Ledger memory l = ledger.getLedger(user);
        assertEq(l.totalBalance, DEPOSIT + additional);
        assertEq(l.availableBalance, DEPOSIT + additional);
    }
    
    function test_RevertDepositNoLedger() public {
        vm.startPrank(user);
        vm.expectRevert("Ledger not found");
        ledger.deposit{value: 0.5 ether}();
        vm.stopPrank();
    }
    
    // ========== Withdraw Tests ==========
    
    function test_Withdraw() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        uint256 balanceBefore = user.balance;
        uint256 withdrawAmount = 0.5 ether;
        ledger.withdraw(withdrawAmount);
        vm.stopPrank();
        
        assertEq(user.balance, balanceBefore + withdrawAmount);
        assertEq(ledger.getAvailableBalance(user), DEPOSIT - withdrawAmount);
    }
    
    function test_WithdrawAll() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        ledger.withdraw(DEPOSIT);
        vm.stopPrank();
        
        assertEq(ledger.getAvailableBalance(user), 0);
    }
    
    function test_RevertWithdrawInsufficient() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.expectRevert("Insufficient balance");
        ledger.withdraw(DEPOSIT + 1);
        vm.stopPrank();
    }
    
    // ========== Provider Transfer Tests ==========
    
    function test_TransferToProvider() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        uint256 transferAmount = 0.3 ether;
        ledger.transferToProvider(provider, transferAmount);
        vm.stopPrank();
        
        IStorageTypes.Ledger memory l = ledger.getLedger(user);
        assertEq(l.availableBalance, DEPOSIT - transferAmount);
        assertEq(l.lockedBalance, transferAmount);
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.balance, transferAmount);
    }
    
    function test_MultipleTransfersToProvider() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        ledger.transferToProvider(provider, 0.3 ether);
        ledger.transferToProvider(provider, 0.2 ether);
        vm.stopPrank();
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.balance, 0.5 ether);
    }
    
    function test_RevertTransferInsufficient() public {
        vm.startPrank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.expectRevert("Insufficient balance");
        ledger.transferToProvider(provider, DEPOSIT + 1);
        vm.stopPrank();
    }
    
    // ========== Provider Claim Tests ==========
    
    function test_ProviderClaimPayment() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        uint256 providerBalanceBefore = provider.balance;
        
        vm.prank(provider);
        ledger.claimPayment(user, 0.3 ether);
        
        assertEq(provider.balance, providerBalanceBefore + 0.3 ether);
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.balance, 0.2 ether);
    }
    
    function test_ProviderClaimAll() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.prank(provider);
        ledger.claimPayment(user, 0.5 ether);
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.balance, 0);
    }
    
    function test_RevertProviderClaimInsufficient() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.prank(provider);
        vm.expectRevert("Insufficient balance");
        ledger.claimPayment(user, 0.6 ether);
    }
    
    // ========== Refund Tests ==========
    
    function test_RequestRefund() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.prank(user);
        ledger.requestRefund(provider, 0.2 ether);
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.balance, 0.3 ether);
        assertEq(sub.pendingRefund, 0.2 ether);
        assertGt(sub.refundUnlockTime, block.timestamp);
    }
    
    function test_ClaimRefund() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.prank(user);
        ledger.requestRefund(provider, 0.2 ether);
        
        // Fast forward past lock period
        vm.warp(block.timestamp + 7 days + 1);
        
        vm.prank(user);
        ledger.claimRefund(provider);
        
        IStorageTypes.SubAccount memory sub = ledger.getSubAccount(user, provider);
        assertEq(sub.pendingRefund, 0);
        assertEq(sub.refundUnlockTime, 0);
        
        IStorageTypes.Ledger memory l = ledger.getLedger(user);
        assertEq(l.availableBalance, DEPOSIT - 0.3 ether); // 0.5 - 0.2 refunded
        assertEq(l.lockedBalance, 0.3 ether);
    }
    
    function test_RevertClaimRefundBeforeLock() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.prank(user);
        ledger.requestRefund(provider, 0.2 ether);
        
        // Try to claim immediately
        vm.prank(user);
        vm.expectRevert("Refund locked");
        ledger.claimRefund(provider);
    }
    
    function test_RevertRefundAlreadyPending() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        vm.startPrank(user);
        ledger.requestRefund(provider, 0.2 ether);
        
        vm.expectRevert("Refund already pending");
        ledger.requestRefund(provider, 0.1 ether);
        vm.stopPrank();
    }
    
    // ========== Acknowledgement Tests ==========
    
    function test_AcknowledgeUser() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        vm.prank(user);
        ledger.transferToProvider(provider, 0.5 ether);
        
        assertFalse(ledger.getSubAccount(user, provider).acknowledged);
        
        vm.prank(provider);
        ledger.acknowledgeUser(user);
        
        assertTrue(ledger.getSubAccount(user, provider).acknowledged);
    }
    
    // ========== Balance Tracking Tests ==========
    
    function test_BalanceTracking() public {
        vm.prank(user);
        ledger.createLedger{value: DEPOSIT}();
        
        // Transfer to provider
        vm.prank(user);
        ledger.transferToProvider(provider, 0.4 ether);
        
        IStorageTypes.Ledger memory l = ledger.getLedger(user);
        assertEq(l.totalBalance, DEPOSIT);
        assertEq(l.availableBalance, 0.6 ether);
        assertEq(l.lockedBalance, 0.4 ether);
        
        // Provider claims half
        vm.prank(provider);
        ledger.claimPayment(user, 0.2 ether);
        
        l = ledger.getLedger(user);
        assertEq(l.totalBalance, 0.8 ether); // Reduced by claimed amount
        assertEq(l.lockedBalance, 0.2 ether); // Reduced by claimed amount
    }
}

