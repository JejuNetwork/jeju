// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {CreditManager} from "../src/services/CreditManager.sol";
import {JejuUSDC} from "../src/tokens/JejuUSDC.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

contract CreditManagerTest is Test {
    CreditManager public creditManager;
    JejuUSDC public usdc;
    ElizaOSToken public elizaOS;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address service1 = makeAddr("service1");
    address service2 = makeAddr("service2");

    address constant ETH_ADDRESS = address(0);

    event CreditDeposited(address indexed user, address indexed token, uint256 amount, uint256 newBalance);
    event CreditDeducted(address indexed user, address indexed service, address indexed token, uint256 amount, uint256 remainingBalance);
    event BalanceLow(address indexed user, address indexed token, uint256 balance, uint256 recommended);

    function setUp() public {
        // Deploy tokens
        usdc = new JejuUSDC(owner, 10000000 * 1e6, true);
        elizaOS = new ElizaOSToken(owner);

        // Deploy credit manager
        creditManager = new CreditManager(address(usdc), address(elizaOS));

        // Fund test users
        usdc.transfer(alice, 10000 * 1e6);
        usdc.transfer(bob, 5000 * 1e6);
        elizaOS.transfer(alice, 1000 * 1e18);
        elizaOS.transfer(bob, 500 * 1e18);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 50 ether);

        // Authorize services
        creditManager.setServiceAuthorization(service1, true);
        creditManager.setServiceAuthorization(service2, true);
    }

    // ============ Deposit Tests ============

    function test_DepositUSDC() public {
        uint256 depositAmount = 100 * 1e6;

        vm.startPrank(alice);
        usdc.approve(address(creditManager), depositAmount);
        
        vm.expectEmit(true, true, false, true);
        emit CreditDeposited(alice, address(usdc), depositAmount, depositAmount);
        
        creditManager.depositUSDC(depositAmount);
        vm.stopPrank();

        assertEq(creditManager.balances(alice, address(usdc)), depositAmount);
    }

    function test_DepositElizaOS() public {
        uint256 depositAmount = 10 * 1e18;

        vm.startPrank(alice);
        elizaOS.approve(address(creditManager), depositAmount);
        creditManager.depositElizaOS(depositAmount);
        vm.stopPrank();

        assertEq(creditManager.balances(alice, address(elizaOS)), depositAmount);
    }

    function test_DepositETH() public {
        uint256 depositAmount = 1 ether;

        vm.prank(alice);
        creditManager.depositETH{value: depositAmount}();

        assertEq(creditManager.balances(alice, ETH_ADDRESS), depositAmount);
    }

    function test_GenericDeposit() public {
        uint256 amount = 50 * 1e6;

        vm.startPrank(alice);
        usdc.approve(address(creditManager), amount);
        creditManager.deposit(address(usdc), amount);
        vm.stopPrank();

        assertEq(creditManager.balances(alice, address(usdc)), amount);
    }

    function test_RevertDepositZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.InvalidAmount.selector, 0));
        creditManager.depositUSDC(0);
    }

    // ============ Deduction Tests ============

    function test_DeductCredit() public {
        // Alice deposits
        uint256 depositAmount = 100 * 1e6;
        vm.startPrank(alice);
        usdc.approve(address(creditManager), depositAmount);
        creditManager.depositUSDC(depositAmount);
        vm.stopPrank();

        // Service deducts
        uint256 deductAmount = 10 * 1e6;
        
        vm.prank(service1);
        vm.expectEmit(true, true, true, true);
        emit CreditDeducted(alice, service1, address(usdc), deductAmount, depositAmount - deductAmount);
        
        creditManager.deductCredit(alice, address(usdc), deductAmount);

        assertEq(creditManager.balances(alice, address(usdc)), depositAmount - deductAmount);
    }

    function test_TryDeductCreditSuccess() public {
        uint256 depositAmount = 100 * 1e6;
        vm.startPrank(alice);
        usdc.approve(address(creditManager), depositAmount);
        creditManager.depositUSDC(depositAmount);
        vm.stopPrank();

        vm.prank(service1);
        (bool success, uint256 remaining) = creditManager.tryDeductCredit(alice, address(usdc), 50 * 1e6);

        assertTrue(success);
        assertEq(remaining, 50 * 1e6);
    }

    function test_TryDeductCreditInsufficient() public {
        uint256 depositAmount = 10 * 1e6;
        vm.startPrank(alice);
        usdc.approve(address(creditManager), depositAmount);
        creditManager.depositUSDC(depositAmount);
        vm.stopPrank();

        vm.prank(service1);
        (bool success, uint256 remaining) = creditManager.tryDeductCredit(alice, address(usdc), 50 * 1e6);

        assertFalse(success);
        assertEq(remaining, depositAmount);
    }

    function test_RevertDeductUnauthorizedService() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        address unauthorized = makeAddr("unauthorized");
        
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.UnauthorizedService.selector, unauthorized));
        creditManager.deductCredit(alice, address(usdc), 10 * 1e6);
    }

    function test_RevertDeductInsufficientCredit() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 10 * 1e6);
        creditManager.depositUSDC(10 * 1e6);
        vm.stopPrank();

        vm.prank(service1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreditManager.InsufficientCredit.selector,
                alice,
                address(usdc),
                100 * 1e6,
                10 * 1e6
            )
        );
        creditManager.deductCredit(alice, address(usdc), 100 * 1e6);
    }

    function test_BalanceLowEvent() public {
        // Deposit small amount
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 2 * 1e6);
        creditManager.depositUSDC(2 * 1e6);
        vm.stopPrank();

        // Deduct amount that brings balance below minimum (1 USDC)
        vm.prank(service1);
        vm.expectEmit(true, true, false, false);
        emit BalanceLow(alice, address(usdc), 0, 0);
        
        creditManager.deductCredit(alice, address(usdc), 1.5e6);
    }

    // ============ Withdrawal Tests ============

    function test_Withdraw() public {
        uint256 depositAmount = 100 * 1e6;
        
        vm.startPrank(alice);
        usdc.approve(address(creditManager), depositAmount);
        creditManager.depositUSDC(depositAmount);

        uint256 balanceBefore = usdc.balanceOf(alice);
        
        creditManager.withdraw(address(usdc), 50 * 1e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), balanceBefore + 50 * 1e6);
        assertEq(creditManager.balances(alice, address(usdc)), 50 * 1e6);
    }

    function test_WithdrawETH() public {
        uint256 depositAmount = 1 ether;

        vm.prank(alice);
        creditManager.depositETH{value: depositAmount}();

        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        creditManager.withdraw(ETH_ADDRESS, 0.5 ether);

        assertEq(alice.balance, balanceBefore + 0.5 ether);
    }

    // ============ View Function Tests ============

    function test_GetBalance() public {
        uint256 amount = 100 * 1e6;
        
        vm.startPrank(alice);
        usdc.approve(address(creditManager), amount);
        creditManager.depositUSDC(amount);
        vm.stopPrank();

        uint256 balance = creditManager.getBalance(alice, address(usdc));
        assertEq(balance, amount);
    }

    function test_GetAllBalances() public {
        vm.startPrank(alice);
        
        // Deposit USDC
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);

        // Deposit elizaOS
        elizaOS.approve(address(creditManager), 10 * 1e18);
        creditManager.depositElizaOS(10 * 1e18);

        // Deposit ETH
        creditManager.depositETH{value: 1 ether}();
        
        vm.stopPrank();

        (uint256 usdcBal, uint256 elizaBal, uint256 ethBal) = creditManager.getAllBalances(alice);

        assertEq(usdcBal, 100 * 1e6);
        assertEq(elizaBal, 10 * 1e18);
        assertEq(ethBal, 1 ether);
    }

    function test_HasSufficientCredit() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        (bool sufficient, uint256 available) = creditManager.hasSufficientCredit(alice, address(usdc), 50 * 1e6);

        assertTrue(sufficient);
        assertEq(available, 100 * 1e6);
    }

    function test_HasInsufficientCredit() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 10 * 1e6);
        creditManager.depositUSDC(10 * 1e6);
        vm.stopPrank();

        (bool sufficient, uint256 available) = creditManager.hasSufficientCredit(alice, address(usdc), 50 * 1e6);

        assertFalse(sufficient);
        assertEq(available, 10 * 1e6);
    }

    function test_IsBalanceLow() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 0.5e6); // $0.50
        creditManager.depositUSDC(0.5e6);
        vm.stopPrank();

        (bool isLow, uint256 balance, uint256 recommended) = creditManager.isBalanceLow(alice, address(usdc));

        assertTrue(isLow);
        assertEq(balance, 0.5e6);
        assertEq(recommended, 10e6); // $10 recommended
    }

    // ============ Admin Tests ============

    function test_SetServiceAuthorization() public {
        address newService = makeAddr("newService");

        creditManager.setServiceAuthorization(newService, true);

        assertTrue(creditManager.authorizedServices(newService));
    }

    function test_SetMinBalance() public {
        uint256 newMin = 5e6; // $5

        creditManager.setMinBalance(newMin);

        assertEq(creditManager.minBalance(), newMin);
    }

    // ============ Multi-User Scenario Tests ============

    function test_MultipleUsersIndependentBalances() public {
        // Alice deposits
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        // Bob deposits
        vm.startPrank(bob);
        usdc.approve(address(creditManager), 50 * 1e6);
        creditManager.depositUSDC(50 * 1e6);
        vm.stopPrank();

        assertEq(creditManager.balances(alice, address(usdc)), 100 * 1e6);
        assertEq(creditManager.balances(bob, address(usdc)), 50 * 1e6);
    }

    function test_ServiceDeductionsFromMultipleUsers() public {
        // Fund both users
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        // Service deducts from Alice
        vm.prank(service1);
        creditManager.deductCredit(alice, address(usdc), 10 * 1e6);

        // Service deducts from Bob
        vm.prank(service1);
        creditManager.deductCredit(bob, address(usdc), 20 * 1e6);

        assertEq(creditManager.balances(alice, address(usdc)), 90 * 1e6);
        assertEq(creditManager.balances(bob, address(usdc)), 80 * 1e6);
    }

    // ============ Receive ETH Test ============

    function test_ReceiveETH() public {
        vm.prank(alice);
        (bool success, ) = address(creditManager).call{value: 1 ether}("");
        
        assertTrue(success);
        assertEq(creditManager.balances(alice, ETH_ADDRESS), 1 ether);
    }
}

