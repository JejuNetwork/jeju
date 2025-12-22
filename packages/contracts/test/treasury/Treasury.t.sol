// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../../src/treasury/Treasury.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TreasuryTest is Test {
    Treasury public treasury;
    MockERC20 public token;
    
    address public admin;
    address public operator;
    address public councilMember;
    address public recipient;
    address public user;
    
    uint256 public constant DAILY_LIMIT = 10 ether;
    
    function setUp() public {
        admin = makeAddr("admin");
        operator = makeAddr("operator");
        councilMember = makeAddr("councilMember");
        recipient = makeAddr("recipient");
        user = makeAddr("user");
        
        vm.deal(admin, 100 ether);
        vm.deal(user, 100 ether);
        
        vm.prank(admin);
        treasury = new Treasury(DAILY_LIMIT, admin);
        
        vm.prank(user);
        token = new MockERC20();
    }
    
    // ============ Deposit Tests ============
    
    function test_DepositETH() public {
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        assertEq(treasury.getBalance(), 5 ether);
        assertEq(treasury.totalEthDeposits(), 5 ether);
    }
    
    function test_DepositETHViaReceive() public {
        vm.prank(user);
        (bool success,) = address(treasury).call{value: 3 ether}("");
        assertTrue(success);
        
        assertEq(treasury.getBalance(), 3 ether);
    }
    
    function test_DepositToken() public {
        uint256 amount = 1000 * 10**18;
        
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();
        
        assertEq(treasury.getTokenBalance(address(token)), amount);
        assertEq(treasury.tokenDeposits(address(token)), amount);
    }
    
    function test_DepositToken_RevertIfZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(Treasury.ZeroAmount.selector);
        treasury.depositToken(address(token), 0);
    }
    
    function test_DepositToken_RevertIfZeroAddress() public {
        vm.prank(user);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.depositToken(address(0), 100);
    }
    
    // ============ Withdrawal Tests ============
    
    function test_WithdrawETH() public {
        // Deposit first
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        // Withdraw as operator (admin has operator role)
        uint256 recipientBalanceBefore = recipient.balance;
        
        vm.prank(admin);
        treasury.withdrawETH(2 ether, recipient);
        
        assertEq(recipient.balance, recipientBalanceBefore + 2 ether);
        assertEq(treasury.getBalance(), 3 ether);
    }
    
    function test_WithdrawETH_RevertIfNotOperator() public {
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        vm.prank(user);
        vm.expectRevert();
        treasury.withdrawETH(1 ether, recipient);
    }
    
    function test_WithdrawETH_RevertIfInsufficientBalance() public {
        vm.prank(user);
        treasury.deposit{value: 1 ether}();
        
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Treasury.InsufficientBalance.selector, 1 ether, 5 ether));
        treasury.withdrawETH(5 ether, recipient);
    }
    
    function test_WithdrawToken() public {
        uint256 amount = 1000 * 10**18;
        
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();
        
        vm.prank(admin);
        treasury.withdrawToken(address(token), 500 * 10**18, recipient);
        
        assertEq(token.balanceOf(recipient), 500 * 10**18);
        assertEq(treasury.getTokenBalance(address(token)), 500 * 10**18);
    }
    
    // ============ Daily Limit Tests ============
    
    function test_DailyLimitEnforced() public {
        vm.prank(user);
        treasury.deposit{value: 20 ether}();
        
        // First withdrawal within limit
        vm.prank(admin);
        treasury.withdrawETH(5 ether, recipient);
        
        // Second withdrawal within limit
        vm.prank(admin);
        treasury.withdrawETH(5 ether, recipient);
        
        // Third withdrawal exceeds limit
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Treasury.ExceedsDailyLimit.selector, 10 ether, 1 ether, 0));
        treasury.withdrawETH(1 ether, recipient);
    }
    
    function test_DailyLimitResetsNextDay() public {
        vm.prank(user);
        treasury.deposit{value: 20 ether}();
        
        // Use up daily limit
        vm.prank(admin);
        treasury.withdrawETH(10 ether, recipient);
        
        // Move to next day
        vm.warp(block.timestamp + 1 days + 1);
        
        // Should be able to withdraw again
        vm.prank(admin);
        treasury.withdrawETH(5 ether, recipient);
        
        assertEq(recipient.balance, 15 ether);
    }
    
    function test_SetDailyLimit() public {
        vm.prank(admin);
        treasury.setDailyLimit(20 ether);
        
        assertEq(treasury.dailyWithdrawalLimit(), 20 ether);
    }
    
    // ============ Role Management Tests ============
    
    function test_AddOperator() public {
        vm.prank(admin);
        treasury.addOperator(operator);
        
        assertTrue(treasury.isOperator(operator));
        
        // New operator can withdraw
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        vm.prank(operator);
        treasury.withdrawETH(1 ether, recipient);
    }
    
    function test_RemoveOperator() public {
        vm.prank(admin);
        treasury.addOperator(operator);
        
        vm.prank(admin);
        treasury.removeOperator(operator);
        
        assertFalse(treasury.isOperator(operator));
    }
    
    function test_AddCouncilMember() public {
        vm.prank(admin);
        treasury.addCouncilMember(councilMember);
        
        assertTrue(treasury.isCouncilMember(councilMember));
        
        // Council member can add operators
        vm.prank(councilMember);
        treasury.addOperator(operator);
        
        assertTrue(treasury.isOperator(operator));
    }
    
    function test_RemoveCouncilMember() public {
        vm.prank(admin);
        treasury.addCouncilMember(councilMember);
        
        vm.prank(admin);
        treasury.removeCouncilMember(councilMember);
        
        assertFalse(treasury.isCouncilMember(councilMember));
    }
    
    // ============ Emergency Withdrawal Tests ============
    
    function test_EmergencyWithdrawETH() public {
        vm.prank(user);
        treasury.deposit{value: 15 ether}();
        
        // Emergency withdrawal bypasses daily limit
        vm.prank(admin);
        treasury.emergencyWithdraw(address(0), recipient, 15 ether);
        
        assertEq(recipient.balance, 15 ether);
        assertEq(treasury.getBalance(), 0);
    }
    
    function test_EmergencyWithdrawToken() public {
        uint256 amount = 1000 * 10**18;
        
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();
        
        vm.prank(admin);
        treasury.emergencyWithdraw(address(token), recipient, amount);
        
        assertEq(token.balanceOf(recipient), amount);
    }
    
    function test_EmergencyWithdraw_RevertIfNotAdmin() public {
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        vm.prank(admin);
        treasury.addOperator(operator);
        
        vm.prank(operator);
        vm.expectRevert();
        treasury.emergencyWithdraw(address(0), recipient, 5 ether);
    }
    
    // ============ Pause Tests ============
    
    function test_PauseUnpause() public {
        vm.prank(user);
        treasury.deposit{value: 5 ether}();
        
        vm.prank(admin);
        treasury.pause();
        
        // Cannot withdraw when paused
        vm.prank(admin);
        vm.expectRevert();
        treasury.withdrawETH(1 ether, recipient);
        
        vm.prank(admin);
        treasury.unpause();
        
        // Can withdraw after unpause
        vm.prank(admin);
        treasury.withdrawETH(1 ether, recipient);
        assertEq(recipient.balance, 1 ether);
    }
    
    // ============ View Function Tests ============
    
    function test_GetWithdrawalInfo() public {
        vm.prank(user);
        treasury.deposit{value: 15 ether}();
        
        vm.prank(admin);
        treasury.withdrawETH(3 ether, recipient);
        
        (uint256 limit, uint256 usedToday, uint256 remaining) = treasury.getWithdrawalInfo();
        
        assertEq(limit, DAILY_LIMIT);
        assertEq(usedToday, 3 ether);
        assertEq(remaining, 7 ether);
    }
    
    function test_Version() public view {
        assertEq(treasury.version(), "1.0.0");
    }
}
