// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {LiquidityVault} from "../../src/liquidity/LiquidityVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRewardToken is ERC20 {
    constructor() ERC20("Reward Token", "REWARD") {
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityVaultTest is Test {
    LiquidityVault public vault;
    MockRewardToken public rewardToken;
    
    address public owner;
    address public paymaster;
    address public feeDistributor;
    address public user1;
    address public user2;
    
    function setUp() public {
        owner = makeAddr("owner");
        paymaster = makeAddr("paymaster");
        feeDistributor = makeAddr("feeDistributor");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        
        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        
        vm.prank(owner);
        rewardToken = new MockRewardToken();
        
        vm.prank(owner);
        vault = new LiquidityVault(address(rewardToken), owner);
        
        // Setup roles
        vm.startPrank(owner);
        vault.setPaymaster(paymaster);
        vault.setFeeDistributor(feeDistributor);
        
        // Distribute reward tokens
        rewardToken.transfer(user1, 10000 * 10**18);
        rewardToken.transfer(user2, 10000 * 10**18);
        rewardToken.transfer(feeDistributor, 10000 * 10**18);
        vm.stopPrank();
    }
    
    // ============ ETH Liquidity Tests ============
    
    function test_AddETHLiquidity() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        assertEq(vault.ethShares(user1), 20 ether);
        assertEq(vault.totalETHLiquidity(), 20 ether);
        assertEq(address(vault).balance, 20 ether);
    }
    
    function test_AddETHLiquidityMultipleUsers() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        vm.prank(user2);
        vault.addETHLiquidity{value: 10 ether}(0);
        
        assertEq(vault.totalETHLiquidity(), 30 ether);
        assertEq(address(vault).balance, 30 ether);
    }
    
    function test_AddETHLiquidity_RevertIfZeroAmount() public {
        vm.prank(user1);
        vm.expectRevert(LiquidityVault.InvalidAmount.selector);
        vault.addETHLiquidity{value: 0}(0);
    }
    
    function test_RemoveETHLiquidity() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        uint256 balanceBefore = user1.balance;
        
        vm.prank(user1);
        vault.removeETHLiquidity(8 ether); // Leave min liquidity
        
        assertTrue(user1.balance > balanceBefore);
        assertEq(vault.ethShares(user1), 12 ether);
    }
    
    function test_RemoveETHLiquidity_RevertIfBelowMinimum() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 15 ether}(0);
        
        // Try to withdraw too much (would go below 10 ether min)
        vm.prank(user1);
        vm.expectRevert(LiquidityVault.BelowMinimumLiquidity.selector);
        vault.removeETHLiquidity(10 ether);
    }
    
    function test_RemoveETHLiquidity_RevertIfInsufficientShares() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        vm.prank(user1);
        vm.expectRevert(LiquidityVault.InsufficientLiquidity.selector);
        vault.removeETHLiquidity(25 ether);
    }
    
    // ============ Token Liquidity Tests ============
    
    function test_AddElizaLiquidity() public {
        uint256 amount = 1000 * 10**18;
        
        vm.startPrank(user1);
        rewardToken.approve(address(vault), amount);
        vault.addElizaLiquidity(amount, 0);
        vm.stopPrank();
        
        assertEq(vault.elizaShares(user1), amount);
        assertEq(vault.totalElizaLiquidity(), amount);
    }
    
    function test_RemoveElizaLiquidity() public {
        uint256 amount = 1000 * 10**18;
        
        vm.startPrank(user1);
        rewardToken.approve(address(vault), amount);
        vault.addElizaLiquidity(amount, 0);
        
        uint256 balanceBefore = rewardToken.balanceOf(user1);
        vault.removeElizaLiquidity(500 * 10**18);
        
        assertTrue(rewardToken.balanceOf(user1) > balanceBefore);
        assertEq(vault.elizaShares(user1), 500 * 10**18);
        vm.stopPrank();
    }
    
    // ============ Fee Distribution Tests ============
    
    function test_DistributeFees() public {
        // Add liquidity first
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        vm.startPrank(user1);
        rewardToken.approve(address(vault), 1000 * 10**18);
        vault.addElizaLiquidity(1000 * 10**18, 0);
        vm.stopPrank();
        
        // Distribute fees
        uint256 ethPoolFees = 100 * 10**18;
        uint256 tokenPoolFees = 50 * 10**18;
        
        vm.startPrank(feeDistributor);
        rewardToken.approve(address(vault), ethPoolFees + tokenPoolFees);
        vault.distributeFees(ethPoolFees, tokenPoolFees);
        vm.stopPrank();
        
        // Check pending fees
        uint256 pending = vault.pendingFees(user1);
        assertTrue(pending > 0);
    }
    
    function test_ClaimFees() public {
        // Setup liquidity
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        // Distribute fees
        vm.startPrank(feeDistributor);
        rewardToken.approve(address(vault), 100 * 10**18);
        vault.distributeFees(100 * 10**18, 0);
        vm.stopPrank();
        
        uint256 pendingBefore = vault.pendingFees(user1);
        uint256 balanceBefore = rewardToken.balanceOf(user1);
        
        vm.prank(user1);
        vault.claimFees();
        
        assertTrue(rewardToken.balanceOf(user1) > balanceBefore);
        assertEq(vault.pendingFees(user1), 0);
    }
    
    function test_DistributeFees_RevertIfNotFeeDistributor() public {
        vm.prank(user1);
        vm.expectRevert(LiquidityVault.OnlyFeeDistributor.selector);
        vault.distributeFees(100, 50);
    }
    
    // ============ Paymaster Functions Tests ============
    
    function test_ProvideETHForGas() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        uint256 available = vault.availableETH();
        assertTrue(available > 0);
        
        uint256 paymasterBalanceBefore = paymaster.balance;
        
        vm.prank(paymaster);
        bool success = vault.provideETHForGas(1 ether);
        
        assertTrue(success);
        assertEq(paymaster.balance, paymasterBalanceBefore + 1 ether);
    }
    
    function test_ProvideETHForGas_RevertIfNotPaymaster() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        vm.prank(user2);
        vm.expectRevert(LiquidityVault.OnlyPaymaster.selector);
        vault.provideETHForGas(1 ether);
    }
    
    function test_ProvideETHForGas_RevertIfInsufficientLiquidity() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 15 ether}(0);
        
        vm.prank(paymaster);
        vm.expectRevert(LiquidityVault.InsufficientLiquidity.selector);
        vault.provideETHForGas(100 ether);
    }
    
    // ============ View Functions Tests ============
    
    function test_AvailableETH() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        uint256 available = vault.availableETH();
        // Should be (20 - 10 min) = 10, capped at 80% = 16
        // min(10, 16) = 10 ether available
        assertEq(available, 10 ether);
    }
    
    function test_GetLPPosition() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        vm.startPrank(user1);
        rewardToken.approve(address(vault), 1000 * 10**18);
        vault.addElizaLiquidity(1000 * 10**18, 0);
        vm.stopPrank();
        
        (uint256 ethShares, uint256 ethValue, uint256 elizaShares, uint256 elizaValue, uint256 pending) = 
            vault.getLPPosition(user1);
        
        assertEq(ethShares, 20 ether);
        assertEq(ethValue, 20 ether);
        assertEq(elizaShares, 1000 * 10**18);
        assertEq(elizaValue, 1000 * 10**18);
        assertEq(pending, 0);
    }
    
    function test_GetVaultHealth() public {
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        
        (uint256 ethBalance, uint256 tokenBalance, uint256 ethUtilization, bool isHealthy) = vault.getVaultHealth();
        
        assertEq(ethBalance, 20 ether);
        assertTrue(isHealthy);
    }
    
    // ============ Admin Functions Tests ============
    
    function test_SetMinETHLiquidity() public {
        vm.prank(owner);
        vault.setMinETHLiquidity(5 ether);
        
        assertEq(vault.minETHLiquidity(), 5 ether);
    }
    
    function test_PauseUnpause() public {
        vm.prank(owner);
        vault.pause();
        
        vm.prank(user1);
        vm.expectRevert();
        vault.addETHLiquidity{value: 10 ether}(0);
        
        vm.prank(owner);
        vault.unpause();
        
        vm.prank(user1);
        vault.addETHLiquidity{value: 20 ether}(0);
        assertEq(vault.ethShares(user1), 20 ether);
    }
    
    function test_Version() public view {
        assertEq(vault.version(), "1.1.0");
    }
}
