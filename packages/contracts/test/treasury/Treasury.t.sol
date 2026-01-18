// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../../src/treasury/Treasury.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1000000 * 10 ** 18);
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
    address public boardMember;
    address public recipient;
    address public user;

    uint256 public constant DAILY_LIMIT = 10 ether;

    function setUp() public {
        admin = makeAddr("admin");
        operator = makeAddr("operator");
        boardMember = makeAddr("boardMember");
        recipient = makeAddr("recipient");
        user = makeAddr("user");

        vm.deal(admin, 100 ether);
        vm.deal(user, 100 ether);

        vm.prank(admin);
        treasury = new Treasury("Test Treasury", DAILY_LIMIT, admin);

        // Grant admin the DIRECTOR_ROLE for Director controls tests
        vm.prank(admin);
        treasury.addDirector(admin);

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
        uint256 amount = 1000 * 10 ** 18;

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
        uint256 amount = 1000 * 10 ** 18;

        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();

        vm.prank(admin);
        treasury.withdrawToken(address(token), 500 * 10 ** 18, recipient);

        assertEq(token.balanceOf(recipient), 500 * 10 ** 18);
        assertEq(treasury.getTokenBalance(address(token)), 500 * 10 ** 18);
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

    function test_AddBoardMember() public {
        vm.prank(admin);
        treasury.addBoardMember(boardMember);

        assertTrue(treasury.isBoardMember(boardMember));

        // Board member can add operators
        vm.prank(boardMember);
        treasury.addOperator(operator);

        assertTrue(treasury.isOperator(operator));
    }

    function test_RemoveBoardMember() public {
        vm.prank(admin);
        treasury.addBoardMember(boardMember);

        vm.prank(admin);
        treasury.removeBoardMember(boardMember);

        assertFalse(treasury.isBoardMember(boardMember));
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
        uint256 amount = 1000 * 10 ** 18;

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
        assertEq(treasury.version(), "2.2.0");
    }

    function test_Name() public view {
        assertEq(treasury.name(), "Test Treasury");
    }

    // ============ Director Controls Tests ============

    function test_DirectorSendTokens() public {
        // Deposit tokens to treasury
        uint256 amount = 1000 * 10 ** 18;
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();

        // Admin has DIRECTOR_ROLE
        vm.prank(admin);
        treasury.directorSendTokens(recipient, address(token), 500 * 10 ** 18, "Payment for services");

        assertEq(token.balanceOf(recipient), 500 * 10 ** 18);
        assertEq(treasury.getTokenBalance(address(token)), 500 * 10 ** 18);
    }

    function test_DirectorSendETH() public {
        vm.prank(user);
        treasury.deposit{value: 10 ether}();

        uint256 recipientBefore = recipient.balance;

        vm.prank(admin);
        treasury.directorSendTokens(recipient, address(0), 3 ether, "ETH payment");

        assertEq(recipient.balance, recipientBefore + 3 ether);
    }

    function test_DirectorSendTokens_NotDirector() public {
        uint256 amount = 1000 * 10 ** 18;
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert();
        treasury.directorSendTokens(recipient, address(token), 100 * 10 ** 18, "Unauthorized");
    }

    // ============ Recurring Payments Tests ============

    function test_CreateRecurringPayment() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0), // ETH
            1 ether,
            7 days, // weekly
            4, // 4 payments
            "Weekly allowance"
        );

        Treasury.RecurringPayment memory payment = treasury.getRecurringPayment(paymentId);
        assertEq(payment.recipient, recipient);
        assertEq(payment.amount, 1 ether);
        assertEq(payment.interval, 7 days);
        assertEq(payment.maxPayments, 4);
        assertTrue(payment.active);
    }

    function test_ExecuteRecurringPayment() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0),
            1 ether,
            1 days,
            0, // unlimited
            "Daily payment"
        );

        // Advance time to make payment due
        vm.warp(block.timestamp + 1 days + 1);

        uint256 recipientBefore = recipient.balance;

        // Anyone can execute due payments
        vm.prank(user);
        treasury.executeRecurringPayment(paymentId);

        assertEq(recipient.balance, recipientBefore + 1 ether);

        Treasury.RecurringPayment memory payment = treasury.getRecurringPayment(paymentId);
        assertEq(payment.paymentsMade, 1);
    }

    function test_ExecuteRecurringPayment_NotDue() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0),
            1 ether,
            7 days,
            0,
            "Weekly"
        );

        // Try to execute immediately (not due yet)
        vm.prank(user);
        vm.expectRevert(Treasury.PaymentNotDue.selector);
        treasury.executeRecurringPayment(paymentId);
    }

    function test_ExecuteRecurringPayment_MaxReached() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        uint256 startTime = block.timestamp;

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0),
            1 ether,
            1 days,
            2, // only 2 payments
            "Limited"
        );

        // Execute first payment (after interval)
        vm.warp(startTime + 1 days + 1);
        treasury.executeRecurringPayment(paymentId);

        // Execute second payment (another interval later)
        vm.warp(startTime + 2 days + 2);
        treasury.executeRecurringPayment(paymentId);

        // Third should fail - max reached and payment deactivated
        vm.warp(startTime + 3 days + 3);
        vm.expectRevert(Treasury.PaymentNotActive.selector);
        treasury.executeRecurringPayment(paymentId);
    }

    function test_CancelRecurringPayment() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0),
            1 ether,
            1 days,
            0,
            "To be cancelled"
        );

        vm.prank(admin);
        treasury.cancelRecurringPayment(paymentId);

        Treasury.RecurringPayment memory payment = treasury.getRecurringPayment(paymentId);
        assertFalse(payment.active);

        // Cannot execute cancelled payment
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(Treasury.PaymentNotActive.selector);
        treasury.executeRecurringPayment(paymentId);
    }

    function test_CancelRecurringPayment_NotDirector() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(0),
            1 ether,
            1 days,
            0,
            "Payment"
        );

        vm.prank(user);
        vm.expectRevert();
        treasury.cancelRecurringPayment(paymentId);
    }

    function test_GetActiveRecurringPayments() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.startPrank(admin);
        treasury.createRecurringPayment(recipient, address(0), 1 ether, 1 days, 0, "Payment 1");
        treasury.createRecurringPayment(recipient, address(0), 2 ether, 7 days, 0, "Payment 2");
        bytes32 payment3 = treasury.createRecurringPayment(recipient, address(0), 3 ether, 30 days, 0, "Payment 3");
        treasury.cancelRecurringPayment(payment3);
        vm.stopPrank();

        Treasury.RecurringPayment[] memory active = treasury.getActiveRecurringPayments();
        assertEq(active.length, 2);
    }

    function test_GetDuePayments() public {
        vm.prank(user);
        treasury.deposit{value: 100 ether}();

        vm.startPrank(admin);
        treasury.createRecurringPayment(recipient, address(0), 1 ether, 1 days, 0, "Daily");
        treasury.createRecurringPayment(recipient, address(0), 2 ether, 7 days, 0, "Weekly");
        vm.stopPrank();

        // Only daily payment should be due after 2 days
        vm.warp(block.timestamp + 2 days);

        Treasury.RecurringPayment[] memory due = treasury.getDuePayments();
        assertEq(due.length, 1);
        assertEq(due[0].amount, 1 ether);
    }

    function test_RecurringPaymentWithTokens() public {
        uint256 amount = 10000 * 10 ** 18;
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();

        vm.prank(admin);
        bytes32 paymentId = treasury.createRecurringPayment(
            recipient,
            address(token),
            100 * 10 ** 18,
            30 days, // monthly
            12, // 12 months
            "Monthly salary"
        );

        vm.warp(block.timestamp + 30 days + 1);

        uint256 recipientBefore = token.balanceOf(recipient);
        treasury.executeRecurringPayment(paymentId);

        assertEq(token.balanceOf(recipient), recipientBefore + 100 * 10 ** 18);
    }

    // ============ Top Up Account Tests ============

    function test_TopUpAccount() public {
        uint256 amount = 1000 * 10 ** 18;
        vm.startPrank(user);
        token.approve(address(treasury), amount);
        treasury.depositToken(address(token), amount);
        vm.stopPrank();

        address serviceAccount = makeAddr("service");

        vm.prank(admin);
        treasury.topUpAccount(serviceAccount, address(token), 100 * 10 ** 18);

        assertEq(token.balanceOf(serviceAccount), 100 * 10 ** 18);
    }

    function test_TopUpAccount_ETH() public {
        vm.prank(user);
        treasury.deposit{value: 10 ether}();

        address serviceAccount = makeAddr("service");
        uint256 before = serviceAccount.balance;

        vm.prank(admin);
        treasury.topUpAccount(serviceAccount, address(0), 2 ether);

        assertEq(serviceAccount.balance, before + 2 ether);
    }
}
