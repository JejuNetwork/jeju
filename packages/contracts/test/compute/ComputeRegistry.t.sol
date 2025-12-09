// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/compute/ComputeRegistry.sol";

contract ComputeRegistryTest is Test {
    ComputeRegistry public registry;
    address public owner;
    address public provider1;
    address public provider2;

    function setUp() public {
        owner = address(this);
        provider1 = makeAddr("provider1");
        provider2 = makeAddr("provider2");

        vm.deal(provider1, 10 ether);
        vm.deal(provider2, 10 ether);

        registry = new ComputeRegistry(owner);
    }

    function test_RegisterProvider() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        ComputeRegistry.Provider memory provider = registry.getProvider(provider1);

        assertEq(provider.owner, provider1);
        assertEq(provider.name, "Test Provider");
        assertEq(provider.endpoint, "https://api.test.com");
        assertEq(provider.stake, 0.01 ether);
        assertTrue(provider.active);

        vm.stopPrank();
    }

    function test_RegisterProviderInsufficientStake() public {
        vm.startPrank(provider1);

        vm.expectRevert(abi.encodeWithSelector(ComputeRegistry.InsufficientStake.selector, 0.001 ether, 0.01 ether));
        registry.register{value: 0.001 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        vm.stopPrank();
    }

    function test_RegisterProviderAlreadyRegistered() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        vm.expectRevert(ComputeRegistry.ProviderAlreadyRegistered.selector);
        registry.register{value: 0.01 ether}("Test Provider 2", "https://api2.test.com", bytes32(uint256(2)));

        vm.stopPrank();
    }

    function test_AddCapability() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        registry.addCapability(
            "llama-3.1-8b",
            1e9, // 1 gwei per input token
            2e9, // 2 gwei per output token
            128000 // 128k context
        );

        ComputeRegistry.Capability[] memory caps = registry.getCapabilities(provider1);
        assertEq(caps.length, 1);
        assertEq(caps[0].model, "llama-3.1-8b");
        assertEq(caps[0].pricePerInputToken, 1e9);
        assertEq(caps[0].pricePerOutputToken, 2e9);
        assertEq(caps[0].maxContextLength, 128000);
        assertTrue(caps[0].active);

        vm.stopPrank();
    }

    function test_UpdateEndpoint() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        registry.updateEndpoint("https://api2.test.com", bytes32(uint256(2)));

        ComputeRegistry.Provider memory provider = registry.getProvider(provider1);
        assertEq(provider.endpoint, "https://api2.test.com");
        assertEq(provider.attestationHash, bytes32(uint256(2)));

        vm.stopPrank();
    }

    function test_DeactivateAndReactivate() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        registry.deactivate();
        assertFalse(registry.isActive(provider1));

        registry.reactivate();
        assertTrue(registry.isActive(provider1));

        vm.stopPrank();
    }

    function test_AddAndWithdrawStake() public {
        vm.startPrank(provider1);

        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));

        registry.addStake{value: 0.05 ether}();
        assertEq(registry.getProviderStake(provider1), 0.06 ether);

        // Deactivate to allow full withdrawal
        registry.deactivate();

        uint256 balanceBefore = provider1.balance;
        registry.withdrawStake(0.05 ether);
        uint256 balanceAfter = provider1.balance;

        assertEq(balanceAfter - balanceBefore, 0.05 ether);
        assertEq(registry.getProviderStake(provider1), 0.01 ether);

        vm.stopPrank();
    }

    function test_GetActiveProviders() public {
        // Register two providers
        vm.prank(provider1);
        registry.register{value: 0.01 ether}("Provider 1", "https://api1.test.com", bytes32(uint256(1)));

        vm.prank(provider2);
        registry.register{value: 0.01 ether}("Provider 2", "https://api2.test.com", bytes32(uint256(2)));

        address[] memory activeProviders = registry.getActiveProviders();
        assertEq(activeProviders.length, 2);

        // Deactivate one
        vm.prank(provider1);
        registry.deactivate();

        activeProviders = registry.getActiveProviders();
        assertEq(activeProviders.length, 1);
        assertEq(activeProviders[0], provider2);
    }

    function test_SetMinProviderStake() public {
        uint256 newMinStake = 0.05 ether;
        registry.setMinProviderStake(newMinStake);
        assertEq(registry.minProviderStake(), newMinStake);
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }
}
