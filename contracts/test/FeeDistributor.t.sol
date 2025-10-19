// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

contract FeeDistributorTest is Test {
    FeeDistributor public distributor;
    LiquidityVault public vault;
    ElizaOSToken public rewardToken;
    
    address public owner = address(this);
    address public paymaster = address(0x123);
    address public app1 = address(0xA1);
    address public app2 = address(0xA2);
    
    function setUp() public {
        rewardToken = new ElizaOSToken(owner);
        vault = new LiquidityVault(address(rewardToken), owner);
        distributor = new FeeDistributor(address(rewardToken), address(vault), owner);
        
        distributor.setPaymaster(paymaster);
        vault.setFeeDistributor(address(distributor));
        
        // Fund paymaster
        rewardToken.transfer(paymaster, 1000000e18);
    }
    
    function testDistributeFees_50_50Split() public {
        uint256 totalFees = 100e18;
        
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), totalFees);
        distributor.distributeFees(totalFees, app1);
        vm.stopPrank();
        
        // App should get 50%
        assertEq(distributor.appEarnings(app1), 50e18);
        
        // Vault should get 50% (check via totalLPEarnings)
        assertEq(distributor.totalLPEarnings(), 50e18);
    }
    
    function testDistributeFees_70_30LPSplit() public {
        uint256 totalFees = 100e18;
        
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), totalFees);
        distributor.distributeFees(totalFees, app1);
        vm.stopPrank();
        
        // 50 tokens to LPs, split 70/30
        // ETH LPs get 35, token LPs get 15
        
        // Check via preview function
        (uint256 appAmt, uint256 ethLPAmt, uint256 elizaLPAmt) = 
            distributor.previewDistribution(totalFees);
        
        assertEq(appAmt, 50e18);
        assertEq(ethLPAmt, 35e18);
        assertEq(elizaLPAmt, 15e18);
    }
    
    function testAppCanClaimEarnings() public {
        uint256 fees = 100e18;
        
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), fees);
        distributor.distributeFees(fees, app1);
        vm.stopPrank();
        
        uint256 app1BalanceBefore = rewardToken.balanceOf(app1);
        
        vm.prank(app1);
        distributor.claimEarnings();
        
        assertEq(rewardToken.balanceOf(app1), app1BalanceBefore + 50e18);
        assertEq(distributor.appEarnings(app1), 0);
    }
    
    function testMultipleAppsEarnSeparately() public {
        // App1 generates 100 fees
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), 100e18);
        distributor.distributeFees(100e18, app1);
        vm.stopPrank();
        
        // App2 generates 200 fees
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), 200e18);
        distributor.distributeFees(200e18, app2);
        vm.stopPrank();
        
        assertEq(distributor.appEarnings(app1), 50e18);
        assertEq(distributor.appEarnings(app2), 100e18);
    }
    
    function testOnlyPaymasterCanDistribute() public {
        vm.prank(app1);
        vm.expectRevert(FeeDistributor.OnlyPaymaster.selector);
        distributor.distributeFees(100e18, app1);
    }
    
    function testGetEarnings() public {
        vm.startPrank(paymaster);
        rewardToken.approve(address(distributor), 100e18);
        distributor.distributeFees(100e18, app1);
        vm.stopPrank();
        
        uint256 earnings = distributor.getEarnings(app1);
        assertEq(earnings, 50e18);
    }
}

