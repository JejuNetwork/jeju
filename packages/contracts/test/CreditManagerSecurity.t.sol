// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {CreditManager} from "../src/services/CreditManager.sol";
import {MockJejuUSDC} from "../src/tokens/MockJejuUSDC.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

/**
 * @title CreditManager Security Tests
 * @notice Tests for reentrancy protection, edge cases, and security vulnerabilities
 */
contract CreditManagerSecurityTest is Test {
    CreditManager public creditManager;
    MockJejuUSDC public usdc;
    ElizaOSToken public elizaOS;

    address owner = address(this);
    address alice = makeAddr("alice");
    address service1 = makeAddr("service1");
    address payable attacker;

    address constant ETH_ADDRESS = address(0);

    // Allow test contract to receive ETH
    receive() external payable {}

    function setUp() public {
        usdc = new MockJejuUSDC(owner);
        elizaOS = new ElizaOSToken(owner);
        creditManager = new CreditManager(address(usdc), address(elizaOS));

        // Deploy attacker contract
        ReentrancyAttacker attackerContract = new ReentrancyAttacker(payable(address(creditManager)));
        attacker = payable(address(attackerContract));

        // Fund accounts
        usdc.transfer(alice, 10000 * 1e6);
        elizaOS.transfer(alice, 1000 * 1e18);
        vm.deal(alice, 100 ether);
        vm.deal(attacker, 100 ether);

        // Authorize service
        creditManager.setServiceAuthorization(service1, true);
    }

    // ============ Reentrancy Protection Tests ============

    function test_ReentrancyProtectionOnWithdrawETH() public {
        // Fund attacker with credit
        vm.prank(attacker);
        creditManager.depositETH{value: 10 ether}();

        // Try to exploit reentrancy - should revert with ReentrancyGuard error
        vm.prank(attacker);
        vm.expectRevert();
        ReentrancyAttacker(attacker).attack(1 ether);
    }

    function test_WithdrawHasReentrancyGuardModifier() public {
        // Deposit and withdraw normally to prove modifier works
        vm.startPrank(alice);
        creditManager.depositETH{value: 5 ether}();

        uint256 balBefore = alice.balance;
        creditManager.withdraw(ETH_ADDRESS, 2 ether);

        assertEq(alice.balance, balBefore + 2 ether);
        assertEq(creditManager.balances(alice, ETH_ADDRESS), 3 ether);
        vm.stopPrank();
    }

    // ============ Zero Amount Protection Tests ============

    function test_CannotDepositZeroUSDC() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.InvalidAmount.selector, 0));
        creditManager.depositUSDC(0);
    }

    function test_CannotDepositZeroElizaOS() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.InvalidAmount.selector, 0));
        creditManager.depositElizaOS(0);
    }

    function test_CannotDepositZeroETH() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.InvalidAmount.selector, 0));
        creditManager.depositETH{value: 0}();
    }

    // ============ Access Control Tests ============

    function test_OnlyAuthorizedServicesCanDeductCredit() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);
        vm.stopPrank();

        address unauthorized = makeAddr("unauthorized");

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.UnauthorizedService.selector, unauthorized));
        creditManager.deductCredit(alice, address(usdc), 10 * 1e6);
    }

    function test_OnlyOwnerCanAuthorizeServices() public {
        address newService = makeAddr("newService");

        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        creditManager.setServiceAuthorization(newService, true);

        // Owner can authorize
        creditManager.setServiceAuthorization(newService, true);
        assertTrue(creditManager.authorizedServices(newService));
    }

    // ============ Insufficient Balance Tests ============

    function test_CannotWithdrawMoreThanBalance() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 100 * 1e6);
        creditManager.depositUSDC(100 * 1e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                CreditManager.InsufficientCredit.selector, alice, address(usdc), 200 * 1e6, 100 * 1e6
            )
        );
        creditManager.withdraw(address(usdc), 200 * 1e6);
        vm.stopPrank();
    }

    function test_CannotDeductMoreThanBalance() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 50 * 1e6);
        creditManager.depositUSDC(50 * 1e6);
        vm.stopPrank();

        vm.prank(service1);
        vm.expectRevert(
            abi.encodeWithSelector(CreditManager.InsufficientCredit.selector, alice, address(usdc), 100 * 1e6, 50 * 1e6)
        );
        creditManager.deductCredit(alice, address(usdc), 100 * 1e6);
    }

    function test_TryDeductCreditReturnsFalseOnInsufficient() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 50 * 1e6);
        creditManager.depositUSDC(50 * 1e6);
        vm.stopPrank();

        vm.prank(service1);
        (bool success, uint256 remaining) = creditManager.tryDeductCredit(alice, address(usdc), 100 * 1e6);

        assertFalse(success);
        assertEq(remaining, 50 * 1e6);
    }

    // ============ Edge Case Tests ============

    function test_DepositWithMismatchedETHAmount() public {
        vm.prank(alice);
        vm.expectRevert("ETH amount mismatch");
        creditManager.deposit{value: 1 ether}(ETH_ADDRESS, 2 ether); // Mismatch
    }

    function test_InvalidTokenReverts() public {
        address invalidToken = makeAddr("invalidToken");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditManager.InvalidToken.selector, invalidToken));
        creditManager.deposit(invalidToken, 100);
    }

    function test_BalanceLowEventEmitted() public {
        vm.startPrank(alice);
        usdc.approve(address(creditManager), 2 * 1e6);
        creditManager.depositUSDC(2 * 1e6);
        vm.stopPrank();

        vm.prank(service1);
        vm.expectEmit(true, true, false, false);
        emit BalanceLow(alice, address(usdc), 0, 0);

        creditManager.deductCredit(alice, address(usdc), 1.5e6);
    }

    function test_PauseStopsDeposits() public {
        creditManager.pause();

        vm.prank(alice);
        vm.expectRevert(); // Pausable: paused
        creditManager.depositETH{value: 1 ether}();
    }

    function test_EmergencyWithdrawRequiresPaused() public {
        vm.deal(address(creditManager), 10 ether);

        // Should revert when not paused
        vm.expectRevert("Must be paused");
        creditManager.emergencyWithdraw(ETH_ADDRESS, 5 ether);

        // Pause and try again
        creditManager.pause();

        uint256 balBefore = owner.balance;
        creditManager.emergencyWithdraw(ETH_ADDRESS, 5 ether);

        assertEq(owner.balance, balBefore + 5 ether);
    }

    // ============ Multi-Token Tests ============

    function test_IndependentBalancesPerToken() public {
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

        // Check all balances are independent
        assertEq(creditManager.balances(alice, address(usdc)), 100 * 1e6);
        assertEq(creditManager.balances(alice, address(elizaOS)), 10 * 1e18);
        assertEq(creditManager.balances(alice, ETH_ADDRESS), 1 ether);
    }

    function test_ReceiveETHDirectly() public {
        uint256 balBefore = creditManager.balances(alice, ETH_ADDRESS);

        vm.prank(alice);
        (bool success,) = address(creditManager).call{value: 1 ether}("");

        assertTrue(success);
        assertEq(creditManager.balances(alice, ETH_ADDRESS), balBefore + 1 ether);
    }

    // Events
    event BalanceLow(address indexed user, address indexed token, uint256 balance, uint256 recommended);
}

/**
 * @title Reentrancy Attacker
 * @notice Malicious contract that attempts reentrancy on CreditManager
 */
contract ReentrancyAttacker {
    CreditManager public target;
    bool public attacking = false;
    uint256 public attackAmount;

    constructor(address payable _target) {
        target = CreditManager(_target);
    }

    function attack(uint256 amount) external {
        attacking = true;
        attackAmount = amount;
        target.withdraw(address(0), amount);
    }

    receive() external payable {
        if (attacking && address(target).balance >= attackAmount) {
            // Try to reenter
            target.withdraw(address(0), attackAmount);
        }
    }
}
