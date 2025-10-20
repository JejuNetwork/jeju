// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AirdropManager} from "../../src/distributor/AirdropManager.sol";
import {FeeDistributor} from "../../src/distributor/FeeDistributor.sol";
import {MockElizaOS} from "../../src/tokens/MockElizaOS.sol";
import {MockJejuUSDC} from "../../src/tokens/MockJejuUSDC.sol";
import {LiquidityVault} from "../../src/liquidity/LiquidityVault.sol";

contract AirdropManagerTest is Test {
    AirdropManager public manager;
    FeeDistributor public distributor;
    MockElizaOS public token;
    MockJejuUSDC public usdc;
    LiquidityVault public vault;
    
    address public owner = address(this);
    address public paymaster = address(0x1);
    address public oracle = address(0x2);
    address public airdropCreator = address(0x3);
    address public contributor1 = address(0x4);
    address public contributor2 = address(0x5);
    
    function setUp() public {
        // Deploy tokens
        token = new MockElizaOS(owner);
        usdc = new MockJejuUSDC(owner);
        
        // Deploy infrastructure
        vault = new LiquidityVault(address(token), owner);
        distributor = new FeeDistributor(address(token), address(vault), owner);
        manager = new AirdropManager(address(distributor), owner);
        
        // Set reasonable minimum for USDC (6 decimals)
        manager.setMinimumAirdropAmount(100e6); // 100 USDC
        
        // Configure
        distributor.setPaymaster(paymaster);
        distributor.setContributorOracle(oracle);
        vault.setFeeDistributor(address(distributor));
        
        // Setup balances
        token.mint(paymaster, 1000000 ether);
        usdc.mint(airdropCreator, 10000e6); // 10k USDC
        
        vm.prank(paymaster);
        token.approve(address(distributor), type(uint256).max);
        
        // Create and finalize a snapshot
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, owner);
        
        address[] memory contributors = new address[](2);
        contributors[0] = contributor1;
        contributors[1] = contributor2;
        
        uint256[] memory shares = new uint256[](2);
        shares[0] = 600; // 60%
        shares[1] = 400; // 40%
        
        vm.prank(oracle);
        distributor.submitMonthlySnapshot(0, contributors, shares);
        
        vm.prank(oracle);
        distributor.finalizeSnapshot(0);
    }
    
    // ============ Test Airdrop Creation ============
    
    function test_createAirdrop() public {
        uint256 airdropAmount = 1000e6; // 1000 USDC
        
        vm.startPrank(airdropCreator);
        usdc.approve(address(manager), airdropAmount);
        
        uint256 airdropId = manager.createAirdrop(
            address(usdc),
            airdropAmount,
            0 // period 0
        );
        
        vm.stopPrank();
        
        assertEq(airdropId, 1, "First airdrop should have ID 1");
        
        // Verify airdrop data
        (
            address creator,
            address airdropToken,
            uint256 totalAmount,
            ,
            ,
            uint256 contributorCount,
            ,
            bool active
        ) = manager.getAirdrop(airdropId);
        
        assertEq(creator, airdropCreator);
        assertEq(airdropToken, address(usdc));
        assertEq(totalAmount, airdropAmount);
        assertEq(contributorCount, 2);
        assertTrue(active);
    }
    
    function test_createAirdrop_belowMinimum() public {
        uint256 smallAmount = 50e6; // Below 100 USDC minimum
        
        usdc.mint(airdropCreator, smallAmount);
        
        vm.startPrank(airdropCreator);
        usdc.approve(address(manager), smallAmount);
        
        vm.expectRevert();
        manager.createAirdrop(address(usdc), smallAmount, 0);
        
        vm.stopPrank();
    }
    
    function test_createAirdrop_snapshotNotFinalized() public {
        // Create a new period that's not finalized yet
        vm.prank(paymaster);
        distributor.distributeFees(1000 ether, owner);
        
        address[] memory contributors = new address[](1);
        contributors[0] = contributor1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1000;
        
        vm.prank(oracle);
        distributor.submitMonthlySnapshot(1, contributors, shares);
        // Don't finalize
        
        vm.startPrank(airdropCreator);
        usdc.approve(address(manager), 1000e6);
        
        vm.expectRevert(AirdropManager.SnapshotNotFinalized.selector);
        manager.createAirdrop(address(usdc), 1000e6, 1);
        
        vm.stopPrank();
    }
    
    // ============ Test Admin Functions ============
    
    function test_setMinimumAirdropAmount() public {
        manager.setMinimumAirdropAmount(500 ether);
        assertEq(manager.minimumAirdropAmount(), 500 ether);
    }
    
    function test_pausable() public {
        manager.pause();
        
        vm.startPrank(airdropCreator);
        usdc.approve(address(manager), 1000e6);
        
        vm.expectRevert();
        manager.createAirdrop(address(usdc), 1000e6, 0);
        
        vm.stopPrank();
    }
    
    function test_version() public view {
        assertEq(manager.version(), "1.0.0");
    }
}


