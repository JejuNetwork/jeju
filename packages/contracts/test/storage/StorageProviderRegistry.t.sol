// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {StorageProviderRegistry} from "../../src/storage/StorageProviderRegistry.sol";
import {IStorageTypes} from "../../src/storage/IStorageTypes.sol";

contract StorageProviderRegistryTest is Test, IStorageTypes {
    StorageProviderRegistry public registry;
    
    address public owner = makeAddr("owner");
    address public provider1 = makeAddr("provider1");
    address public provider2 = makeAddr("provider2");
    
    uint256 constant STAKE = 0.1 ether;
    
    function setUp() public {
        vm.prank(owner);
        registry = new StorageProviderRegistry(owner, address(0));
        
        vm.deal(provider1, 10 ether);
        vm.deal(provider2, 10 ether);
    }
    
    // ========== Registration Tests ==========
    
    function test_RegisterProvider() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}(
            "Test Provider",
            "http://localhost:3100",
            0, // IPFS_NODE
            bytes32(0)
        );
        vm.stopPrank();
        
        assertTrue(registry.isActive(provider1));
        
        IStorageTypes.Provider memory p = registry.getProvider(provider1);
        assertEq(p.owner, provider1);
        assertEq(p.name, "Test Provider");
        assertEq(p.endpoint, "http://localhost:3100");
        assertEq(p.stake, STAKE);
        assertTrue(p.active);
        assertFalse(p.verified);
        assertEq(p.agentId, 0);
    }
    
    function test_RevertInsufficientStake() public {
        vm.startPrank(provider1);
        vm.expectRevert("Insufficient stake");
        registry.register{value: 0.05 ether}(
            "Test Provider",
            "http://localhost:3100",
            0,
            bytes32(0)
        );
        vm.stopPrank();
    }
    
    function test_RevertAlreadyRegistered() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        vm.expectRevert("Already registered");
        registry.register{value: STAKE}("Provider 2", "http://test2.com", 0, bytes32(0));
        vm.stopPrank();
    }
    
    function test_MultipleProviders() public {
        vm.prank(provider1);
        registry.register{value: STAKE}("Provider 1", "http://p1.com", 0, bytes32(0));
        
        vm.prank(provider2);
        registry.register{value: STAKE}("Provider 2", "http://p2.com", 1, bytes32(0)); // FILECOIN
        
        assertEq(registry.getProviderCount(), 2);
        
        address[] memory active = registry.getActiveProviders();
        assertEq(active.length, 2);
    }
    
    // ========== Update Tests ==========
    
    function test_UpdateEndpoint() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://old.com", 0, bytes32(0));
        
        registry.updateEndpoint("http://new.com");
        vm.stopPrank();
        
        IStorageTypes.Provider memory p = registry.getProvider(provider1);
        assertEq(p.endpoint, "http://new.com");
    }
    
    function test_UpdateCapacity() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        registry.updateCapacity(1000, 100);
        vm.stopPrank();
        
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider1);
        assertEq(info.capacity.totalCapacityGB, 1000);
        assertEq(info.capacity.usedCapacityGB, 100);
        assertEq(info.capacity.availableCapacityGB, 900);
    }
    
    function test_UpdatePricing() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        registry.updatePricing(
            0.002 ether,  // pricePerGBMonth
            0.0002 ether, // retrievalPricePerGB
            0.0003 ether  // uploadPricePerGB
        );
        vm.stopPrank();
        
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider1);
        assertEq(info.pricing.pricePerGBMonth, 0.002 ether);
        assertEq(info.pricing.retrievalPricePerGB, 0.0002 ether);
        assertEq(info.pricing.uploadPricePerGB, 0.0003 ether);
    }
    
    // ========== Deactivation Tests ==========
    
    function test_DeactivateProvider() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        assertTrue(registry.isActive(provider1));
        
        registry.deactivate();
        vm.stopPrank();
        
        assertFalse(registry.isActive(provider1));
        
        address[] memory active = registry.getActiveProviders();
        assertEq(active.length, 0);
    }
    
    function test_ReactivateProvider() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        registry.deactivate();
        
        assertFalse(registry.isActive(provider1));
        
        registry.reactivate();
        vm.stopPrank();
        
        assertTrue(registry.isActive(provider1));
    }
    
    // ========== Staking Tests ==========
    
    function test_AddStake() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        uint256 additional = 0.5 ether;
        registry.addStake{value: additional}();
        vm.stopPrank();
        
        assertEq(registry.getProviderStake(provider1), STAKE + additional);
    }
    
    function test_WithdrawStake() public {
        vm.startPrank(provider1);
        registry.register{value: 0.5 ether}("Provider", "http://test.com", 0, bytes32(0));
        
        uint256 balanceBefore = provider1.balance;
        registry.withdrawStake(0.3 ether);
        vm.stopPrank();
        
        assertEq(provider1.balance, balanceBefore + 0.3 ether);
        assertEq(registry.getProviderStake(provider1), 0.2 ether);
    }
    
    function test_RevertWithdrawBelowMinimum() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        vm.expectRevert("Would fall below minimum");
        registry.withdrawStake(0.05 ether);
        vm.stopPrank();
    }
    
    function test_WithdrawAllWhenDeactivated() public {
        vm.startPrank(provider1);
        registry.register{value: 0.5 ether}("Provider", "http://test.com", 0, bytes32(0));
        registry.deactivate();
        
        uint256 balanceBefore = provider1.balance;
        registry.withdrawStake(0.5 ether);
        vm.stopPrank();
        
        assertEq(provider1.balance, balanceBefore + 0.5 ether);
        assertEq(registry.getProviderStake(provider1), 0);
    }
    
    // ========== Admin Tests ==========
    
    function test_VerifyProvider() public {
        vm.prank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        assertFalse(registry.getProvider(provider1).verified);
        
        vm.prank(owner);
        registry.verifyProvider(provider1);
        
        assertTrue(registry.getProvider(provider1).verified);
    }
    
    function test_SetHealthScore() public {
        vm.prank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        vm.prank(owner);
        registry.setHealthScore(provider1, 95);
        
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider1);
        assertEq(info.healthScore, 95);
    }
    
    function test_SetMinProviderStake() public {
        vm.prank(owner);
        registry.setMinProviderStake(0.2 ether);
        
        assertEq(registry.minProviderStake(), 0.2 ether);
        
        // New providers must meet new minimum
        vm.startPrank(provider1);
        vm.expectRevert("Insufficient stake");
        registry.register{value: 0.15 ether}("Provider", "http://test.com", 0, bytes32(0));
        vm.stopPrank();
    }
    
    function test_SetIpfsGateway() public {
        vm.prank(provider1);
        registry.register{value: STAKE}("Provider", "http://test.com", 0, bytes32(0));
        
        vm.prank(provider1);
        registry.setIpfsGateway(provider1, "https://ipfs.provider1.com");
        
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider1);
        assertEq(info.ipfsGateway, "https://ipfs.provider1.com");
    }
    
    // ========== Provider Info Tests ==========
    
    function test_ProviderInfoComplete() public {
        vm.startPrank(provider1);
        registry.register{value: STAKE}("Full Provider", "http://test.com", 2, bytes32("attestation")); // ARWEAVE
        registry.updateCapacity(500, 50);
        registry.updatePricing(0.003 ether, 0.0003 ether, 0.0004 ether);
        vm.stopPrank();
        
        vm.prank(owner);
        registry.setHealthScore(provider1, 88);
        
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider1);
        
        // Provider basics
        assertEq(info.provider.name, "Full Provider");
        assertEq(uint8(info.provider.providerType), 2);
        assertEq(info.provider.attestationHash, bytes32("attestation"));
        
        // Capacity
        assertEq(info.capacity.totalCapacityGB, 500);
        assertEq(info.capacity.usedCapacityGB, 50);
        assertEq(info.capacity.availableCapacityGB, 450);
        
        // Pricing
        assertEq(info.pricing.pricePerGBMonth, 0.003 ether);
        
        // Health
        assertEq(info.healthScore, 88);
        
        // Default supported tiers (HOT, WARM, COLD)
        assertEq(info.supportedTiers.length, 3);
    }
}

