// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../../src/agents/AgentVault.sol";

contract AgentVaultTest is Test {
    AgentVault public vault;
    
    address public owner;
    address public user1;
    address public user2;
    address public feeRecipient;
    address public executor;
    
    uint256 public constant AGENT_ID_1 = 1;
    uint256 public constant AGENT_ID_2 = 2;
    
    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        feeRecipient = makeAddr("feeRecipient");
        executor = makeAddr("executor");
        
        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        
        vm.prank(owner);
        vault = new AgentVault(feeRecipient);
    }
    
    // ============ Create Vault Tests ============
    
    function test_CreateVault() public {
        vm.prank(user1);
        address vaultAddr = vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        assertEq(vault.getBalance(AGENT_ID_1), 1 ether);
        assertEq(vault.totalVaults(), 1);
        assertEq(vault.totalValueLocked(), 1 ether);
        assertTrue(vaultAddr != address(0));
    }
    
    function test_CreateVaultWithoutDeposit() public {
        vm.prank(user1);
        vault.createVault(AGENT_ID_1);
        
        assertEq(vault.getBalance(AGENT_ID_1), 0);
        assertEq(vault.totalVaults(), 1);
    }
    
    function test_CreateVault_RevertIfAlreadyExists() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.VaultAlreadyExists.selector, AGENT_ID_1));
        vault.createVault{value: 1 ether}(AGENT_ID_1);
    }
    
    // ============ Deposit Tests ============
    
    function test_Deposit() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user2);
        vault.deposit{value: 0.5 ether}(AGENT_ID_1);
        
        assertEq(vault.getBalance(AGENT_ID_1), 1.5 ether);
        assertEq(vault.totalValueLocked(), 1.5 ether);
    }
    
    function test_Deposit_RevertIfZeroAmount() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user2);
        vm.expectRevert(AgentVault.InvalidAmount.selector);
        vault.deposit{value: 0}(AGENT_ID_1);
    }
    
    function test_Deposit_RevertIfVaultNotFound() public {
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.VaultNotFound.selector, AGENT_ID_1));
        vault.deposit{value: 1 ether}(AGENT_ID_1);
    }
    
    // ============ Withdraw Tests ============
    
    function test_Withdraw() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        uint256 balanceBefore = user1.balance;
        vault.withdraw(AGENT_ID_1, 0.5 ether);
        
        assertEq(vault.getBalance(AGENT_ID_1), 0.5 ether);
        assertEq(user1.balance, balanceBefore + 0.5 ether);
        vm.stopPrank();
    }
    
    function test_Withdraw_RevertIfNotOwner() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotVaultOwner.selector, AGENT_ID_1, user2));
        vault.withdraw(AGENT_ID_1, 0.5 ether);
    }
    
    function test_Withdraw_RevertIfInsufficientBalance() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.expectRevert(abi.encodeWithSelector(AgentVault.InsufficientBalance.selector, 1 ether, 2 ether));
        vault.withdraw(AGENT_ID_1, 2 ether);
        vm.stopPrank();
    }
    
    // ============ Spend Tests ============
    
    function test_Spend() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user1);
        vault.approveSpender(AGENT_ID_1, executor);
        
        uint256 recipientBalanceBefore = user2.balance;
        uint256 feeRecipientBalanceBefore = feeRecipient.balance;
        
        vm.prank(executor);
        vault.spend(AGENT_ID_1, user2, 0.01 ether, "Test spend");
        
        // 1% fee = 0.0001 ether, recipient gets 0.0099 ether
        assertEq(user2.balance, recipientBalanceBefore + 0.0099 ether);
        assertEq(feeRecipient.balance, feeRecipientBalanceBefore + 0.0001 ether);
    }
    
    function test_Spend_RevertIfNotApproved() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotApprovedSpender.selector, AGENT_ID_1, executor));
        vault.spend(AGENT_ID_1, user2, 0.01 ether, "Test spend");
    }
    
    function test_Spend_RevertIfExceedsLimit() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(user1);
        vault.approveSpender(AGENT_ID_1, executor);
        
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.SpendLimitExceeded.selector, 0.01 ether, 0.5 ether));
        vault.spend(AGENT_ID_1, user2, 0.5 ether, "Test spend");
    }
    
    function test_SpendAsOwner() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vault.spend(AGENT_ID_1, user2, 0.005 ether, "Owner spend");
        vm.stopPrank();
        
        assertTrue(vault.getBalance(AGENT_ID_1) < 1 ether);
    }
    
    function test_SpendAsGlobalExecutor() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(owner);
        vault.setGlobalExecutor(executor, true);
        
        vm.prank(executor);
        vault.spend(AGENT_ID_1, user2, 0.005 ether, "Global executor spend");
        
        assertTrue(vault.getBalance(AGENT_ID_1) < 1 ether);
    }
    
    // ============ Spender Management Tests ============
    
    function test_ApproveAndRevokeSpender() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vault.approveSpender(AGENT_ID_1, executor);
        assertTrue(vault.isApprovedSpender(AGENT_ID_1, executor));
        
        vault.revokeSpender(AGENT_ID_1, executor);
        assertFalse(vault.approvedSpenders(AGENT_ID_1, executor));
        vm.stopPrank();
    }
    
    function test_SetSpendLimit() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vault.setSpendLimit(AGENT_ID_1, 0.1 ether);
        
        AgentVault.Vault memory info = vault.getVaultInfo(AGENT_ID_1);
        assertEq(info.spendLimit, 0.1 ether);
        vm.stopPrank();
    }
    
    // ============ Vault Status Tests ============
    
    function test_DeactivateAndReactivateVault() public {
        vm.startPrank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vault.deactivateVault(AGENT_ID_1);
        
        AgentVault.Vault memory info = vault.getVaultInfo(AGENT_ID_1);
        assertFalse(info.active);
        
        // Cannot spend from deactivated vault
        vault.approveSpender(AGENT_ID_1, executor);
        vm.stopPrank();
        
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.VaultNotActive.selector, AGENT_ID_1));
        vault.spend(AGENT_ID_1, user2, 0.005 ether, "Should fail");
        
        // Reactivate
        vm.prank(user1);
        vault.reactivateVault(AGENT_ID_1);
        
        info = vault.getVaultInfo(AGENT_ID_1);
        assertTrue(info.active);
    }
    
    // ============ Admin Tests ============
    
    function test_SetProtocolFee() public {
        vm.prank(owner);
        vault.setProtocolFee(200); // 2%
        
        assertEq(vault.protocolFeeBps(), 200);
    }
    
    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        vault.setProtocolFee(600); // 6% > max 5%
    }
    
    function test_SetFeeRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        
        vm.prank(owner);
        vault.setFeeRecipient(newRecipient);
        
        assertEq(vault.feeRecipient(), newRecipient);
    }
    
    function test_PauseUnpause() public {
        vm.startPrank(owner);
        vault.pause();
        vm.stopPrank();
        
        vm.prank(user1);
        vm.expectRevert();
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.prank(owner);
        vault.unpause();
        
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        assertEq(vault.totalVaults(), 1);
    }
    
    // ============ View Function Tests ============
    
    function test_GetSpendHistory() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        vm.startPrank(user1);
        vault.spend(AGENT_ID_1, user2, 0.005 ether, "Spend 1");
        vault.spend(AGENT_ID_1, user2, 0.003 ether, "Spend 2");
        vm.stopPrank();
        
        AgentVault.SpendRecord[] memory history = vault.getSpendHistory(AGENT_ID_1, 10);
        assertEq(history.length, 2);
        assertEq(history[0].reason, "Spend 1");
        assertEq(history[1].reason, "Spend 2");
    }
    
    function test_GetVaultInfo() public {
        vm.prank(user1);
        vault.createVault{value: 1 ether}(AGENT_ID_1);
        
        AgentVault.Vault memory info = vault.getVaultInfo(AGENT_ID_1);
        assertEq(info.agentId, AGENT_ID_1);
        assertEq(info.owner, user1);
        assertEq(info.balance, 1 ether);
        assertTrue(info.active);
    }
}
