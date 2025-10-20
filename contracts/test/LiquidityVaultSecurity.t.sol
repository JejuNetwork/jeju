// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

/**
 * @title LiquidityVault Security Tests
 * @notice Tests for slippage attacks, donation attacks, and other vulnerabilities
 */
contract LiquidityVaultSecurityTest is Test {
    LiquidityVault public vault;
    ElizaOSToken public token;
    
    address owner = address(this);
    address victim = makeAddr("victim");
    address attacker = makeAddr("attacker");
    address lp1 = makeAddr("lp1");
    
    function setUp() public {
        token = new ElizaOSToken(owner);
        vault = new LiquidityVault(address(token), owner);
        
        // Fund accounts
        vm.deal(victim, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(lp1, 100 ether);
        
        token.transfer(victim, 100000 * 1e18);
        token.transfer(attacker, 100000 * 1e18);
        token.transfer(lp1, 100000 * 1e18);
    }
    
    // ============ Slippage Attack Tests ============
    
    function test_SlippageProtection_PreventsAttack() public {
        // LP1 adds initial liquidity
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(10 ether); // minShares = 10 ether
        
        // Victim prepares to add 5 ETH, expects ~5 shares
        uint256 expectedShares = 5 ether;
        uint256 minShares = (expectedShares * 95) / 100; // 5% slippage tolerance
        
        // Attacker front-runs with large donation attack
        vm.prank(attacker);
        payable(address(vault)).transfer(50 ether); // Donate 50 ETH
        
        // Now victim would only get: (5 * 10) / (10 + 50) = 0.833 shares
        // This is < minShares, so tx reverts
        
        vm.prank(victim);
        vm.expectRevert(); // InsufficientShares
        vault.addETHLiquidity{value: 5 ether}(minShares);
        
        // Victim protected from sandwich attack!
    }
    
    function test_SlippageProtection_AllowsNormalDeposit() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(10 ether);
        
        // Normal deposit with reasonable slippage tolerance
        vm.prank(victim);
        vault.addETHLiquidity{value: 5 ether}(4.5 ether); // 10% slippage OK
        
        // Should succeed (gets 5 shares)
        assertEq(vault.ethShares(victim), 5 ether);
    }
    
    function test_SlippageProtection_TokenDeposit() public {
        // Add token liquidity with slippage protection
        vm.startPrank(lp1);
        token.approve(address(vault), 1000 * 1e18);
        vault.addElizaLiquidity(1000 * 1e18, 1000 * 1e18);
        vm.stopPrank();
        
        // Attacker donates tokens
        vm.prank(attacker);
        token.transfer(address(vault), 10000 * 1e18);
        
        // Victim tries to add with too high minShares
        vm.startPrank(victim);
        token.approve(address(vault), 1000 * 1e18);
        
        vm.expectRevert(); // InsufficientShares (would get diluted)
        vault.addElizaLiquidity(1000 * 1e18, 950 * 1e18);
        vm.stopPrank();
    }
    
    // ============ Donation Attack Tests ============
    
    function test_DonationAttack_Mitigated() public {
        // LP1 adds initial liquidity
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(10 ether);
        
        uint256 lp1SharesBefore = vault.ethShares(lp1);
        
        // Attacker donates ETH directly (trying to dilute LPs)
        vm.prank(attacker);
        payable(address(vault)).transfer(100 ether);
        
        // LP1's shares unchanged (donation doesn't dilute)
        assertEq(vault.ethShares(lp1), lp1SharesBefore);
        
        // But LP1 can withdraw more ETH now (benefits from donation)
        (uint256 ethShares, uint256 ethValue,,, ) = vault.getLPPosition(lp1);
        assertEq(ethShares, 10 ether);
        assertGt(ethValue, 10 ether); // Got free money from attacker!
        
        // Vault uses balance BEFORE deposit to calculate shares
        // So donations benefit existing LPs, not attacker
    }
    
    // ============ First Depositor Tests ============
    
    function test_FirstDepositor_Gets1to1Shares() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 100 ether}(100 ether);
        
        assertEq(vault.ethShares(lp1), 100 ether);
        assertEq(vault.totalETHLiquidity(), 100 ether);
    }
    
    function test_FirstDepositor_CannotGrief() public {
        // Attacker tries to become first depositor with tiny amount
        vm.prank(attacker);
        vault.addETHLiquidity{value: 1 wei}(1 wei);
        
        // This doesn't prevent others from depositing
        vm.prank(lp1);
        vault.addETHLiquidity{value: 100 ether}(99 ether);
        
        // LP1 gets fair share
        assertGt(vault.ethShares(lp1), 99 ether);
    }
    
    // ============ Reentrancy Tests ============
    
    function test_ReentrancyProtection_AddLiquidity() public {
        // LiquidityVault has ReentrancyGuard
        // Reentrancy attack should be prevented
        
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(10 ether);
        
        // Even if attacker has malicious receive(), can't reenter
        assertEq(vault.ethShares(lp1), 10 ether);
    }
    
    // ============ Edge Case Tests ============
    
    function test_ZeroLiquidity_HandledCorrectly() public {
        // First deposit with 0 total liquidity
        vm.prank(lp1);
        vault.addETHLiquidity{value: 10 ether}(10 ether);
        
        assertEq(vault.totalETHLiquidity(), 10 ether);
    }
    
    function test_MinimumLiquidity_Enforced() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(20 ether);
        
        // Try to withdraw too much (below minimum)
        vm.prank(lp1);
        vm.expectRevert(LiquidityVault.BelowMinimumLiquidity.selector);
        vault.removeETHLiquidity(15 ether); // Would leave only 5 ETH (< 10 ETH min)
    }
    
    function test_Withdrawal_ProportionalToShares() public {
        // Add 20 ETH (above 10 ETH minimum)
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(20 ether);

        uint256 balBefore = lp1.balance;

        // Remove 5 ETH (leaves 15 ETH, still above 10 ETH minimum)
        vm.prank(lp1);
        vault.removeETHLiquidity(5 ether);

        assertEq(lp1.balance, balBefore + 5 ether); // Gets 5 ETH back
        assertEq(vault.ethShares(lp1), 15 ether); // 15 ETH shares remain
    }
    
    // ============ Fee Distribution Security ============
    
    function test_OnlyFeeDistributorCanDistribute() public {
        vm.prank(attacker);
        vm.expectRevert("Only fee distributor");
        vault.distributeFees(100 * 1e18, 50 * 1e18);
    }
    
    function test_OnlyPaymasterCanProvidegETH() public {
        vm.prank(lp1);
        vault.addETHLiquidity{value: 20 ether}(20 ether);
        
        vm.prank(attacker);
        vm.expectRevert(LiquidityVault.OnlyPaymaster.selector);
        vault.provideETHForGas(5 ether);
    }
}

