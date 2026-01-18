// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {AppFeeRegistry} from "../../src/distributor/AppFeeRegistry.sol";
import {IDAORegistry} from "../../src/governance/interfaces/IDAORegistry.sol";

/**
 * @title AppFeeRegistry Tests
 * @notice Tests for the app fee registration and tracking system
 *
 * Core Principle: Network gets 0% - fees go to apps and community
 */
contract AppFeeRegistryTest is Test {
    AppFeeRegistry public registry;

    address public owner = address(0x1);
    address public appOwner = address(0x2);
    address public appContract = address(0x3);
    address public feeRecipient = address(0x4);
    address public feeDistributor = address(0x5);

    bytes32 public testDaoId = keccak256("test-dao");

    event AppRegistered(
        bytes32 indexed appId,
        bytes32 indexed daoId,
        address indexed owner,
        string name,
        address primaryContract
    );

    event AppContractAdded(bytes32 indexed appId, address indexed contractAddr);
    event AppStatsUpdated(bytes32 indexed appId, uint256 transactions, uint256 feesEarned);

    function setUp() public {
        // Deploy with mock DAO registry (address(0) for tests)
        registry = new AppFeeRegistry(address(0), address(0), owner);

        vm.startPrank(owner);
        registry.setFeeDistributor(feeDistributor);
        vm.stopPrank();
    }

    function test_RegisterApp() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0) // No DAO
        );

        assertFalse(appId == bytes32(0), "App ID should not be zero");

        AppFeeRegistry.RegisteredApp memory app = registry.getApp(appId);
        assertEq(app.name, "Test App");
        assertEq(app.description, "A test application");
        assertEq(app.primaryContract, appContract);
        assertEq(app.feeRecipient, feeRecipient);
        assertTrue(app.isActive);

        vm.stopPrank();
    }

    function test_RegisterApp_EmitsEvent() public {
        vm.startPrank(appOwner);

        vm.expectEmit(false, true, true, true);
        emit AppRegistered(bytes32(0), bytes32(0), appOwner, "Test App", appContract);

        registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        vm.stopPrank();
    }

    function test_RegisterApp_RevertsOnDuplicateContract() public {
        vm.startPrank(appOwner);

        registry.registerApp(
            "Test App 1",
            "First app",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        vm.expectRevert(AppFeeRegistry.ContractAlreadyRegistered.selector);
        registry.registerApp(
            "Test App 2",
            "Second app",
            appContract, // Same contract
            feeRecipient,
            bytes32(0)
        );

        vm.stopPrank();
    }

    function test_AddAppContract() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        address additionalContract = address(0x100);

        vm.expectEmit(true, true, false, false);
        emit AppContractAdded(appId, additionalContract);

        registry.addAppContract(appId, additionalContract);

        // Verify both contracts map to the app
        assertEq(registry.contractToApp(appContract), appId);
        assertEq(registry.contractToApp(additionalContract), appId);

        vm.stopPrank();
    }

    function test_IsEligibleForFees() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        assertTrue(registry.isEligibleForFees(appContract));
        assertFalse(registry.isEligibleForFees(address(0x999))); // Unregistered

        vm.stopPrank();
    }

    function test_GetFeeRecipient() public {
        vm.startPrank(appOwner);

        registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        assertEq(registry.getFeeRecipient(appContract), feeRecipient);
        assertEq(registry.getFeeRecipient(address(0x999)), address(0)); // Unregistered

        vm.stopPrank();
    }

    function test_SetFeeRecipient() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        address newRecipient = address(0x999);
        registry.setFeeRecipient(appId, newRecipient);

        assertEq(registry.getFeeRecipient(appContract), newRecipient);

        vm.stopPrank();
    }

    function test_RecordFeeDistribution() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        vm.stopPrank();

        // Record fee distribution (from authorized distributor)
        vm.startPrank(feeDistributor);

        vm.expectEmit(true, false, false, true);
        emit AppStatsUpdated(appId, 1, 1 ether);

        registry.recordFeeDistribution(appContract, 1 ether);

        AppFeeRegistry.AppStats memory stats = registry.getAppStats(appId);
        assertEq(stats.totalTransactions, 1);
        assertEq(stats.totalFeesEarned, 1 ether);

        // Record another distribution
        registry.recordFeeDistribution(appContract, 2 ether);

        stats = registry.getAppStats(appId);
        assertEq(stats.totalTransactions, 2);
        assertEq(stats.totalFeesEarned, 3 ether);

        vm.stopPrank();
    }

    function test_RecordFeeDistribution_OnlyAuthorizedDistributor() public {
        vm.startPrank(appOwner);

        registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        vm.stopPrank();

        // Try to record from unauthorized address
        vm.startPrank(address(0xBEEF));
        vm.expectRevert(AppFeeRegistry.NotAuthorized.selector);
        registry.recordFeeDistribution(appContract, 1 ether);
        vm.stopPrank();
    }

    function test_DeactivateApp() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        assertTrue(registry.isEligibleForFees(appContract));

        registry.deactivateApp(appId);

        assertFalse(registry.isEligibleForFees(appContract));

        vm.stopPrank();
    }

    function test_ReactivateApp() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        registry.deactivateApp(appId);
        assertFalse(registry.isEligibleForFees(appContract));

        registry.reactivateApp(appId);
        assertTrue(registry.isEligibleForFees(appContract));

        vm.stopPrank();
    }

    function test_GetOwnerApps() public {
        vm.startPrank(appOwner);

        bytes32 appId1 = registry.registerApp(
            "App 1",
            "First app",
            address(0x10),
            feeRecipient,
            bytes32(0)
        );

        bytes32 appId2 = registry.registerApp(
            "App 2",
            "Second app",
            address(0x20),
            feeRecipient,
            bytes32(0)
        );

        bytes32[] memory apps = registry.getOwnerApps(appOwner);
        assertEq(apps.length, 2);
        assertEq(apps[0], appId1);
        assertEq(apps[1], appId2);

        vm.stopPrank();
    }

    function test_TooManyContracts() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        // Add maximum number of additional contracts
        for (uint256 i = 0; i < registry.MAX_CONTRACTS_PER_APP(); i++) {
            registry.addAppContract(appId, address(uint160(0x100 + i)));
        }

        // Try to add one more
        vm.expectRevert(AppFeeRegistry.TooManyContracts.selector);
        registry.addAppContract(appId, address(0x999));

        vm.stopPrank();
    }

    function test_OnlyAppOwnerCanModify() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        vm.stopPrank();

        // Try to modify from different address
        vm.startPrank(address(0xBEEF));

        vm.expectRevert(AppFeeRegistry.NotAppOwner.selector);
        registry.setFeeRecipient(appId, address(0x999));

        vm.expectRevert(AppFeeRegistry.NotAppOwner.selector);
        registry.addAppContract(appId, address(0x999));

        vm.expectRevert(AppFeeRegistry.NotAppOwner.selector);
        registry.deactivateApp(appId);

        vm.stopPrank();
    }

    function test_GetAppContracts() public {
        vm.startPrank(appOwner);

        bytes32 appId = registry.registerApp(
            "Test App",
            "A test application",
            appContract,
            feeRecipient,
            bytes32(0)
        );

        registry.addAppContract(appId, address(0x100));
        registry.addAppContract(appId, address(0x200));

        (address primary, address[] memory additional) = registry.getAppContracts(appId);

        assertEq(primary, appContract);
        assertEq(additional.length, 2);
        assertEq(additional[0], address(0x100));
        assertEq(additional[1], address(0x200));

        vm.stopPrank();
    }
}

/**
 * @title Fee Distribution Flow Tests
 * @notice Integration tests for the complete fee distribution flow
 */
contract FeeDistributionFlowTest is Test {
    // This would test the complete flow:
    // 1. App registers
    // 2. User transacts through paymaster
    // 3. Fees are distributed to app, LPs, contributors
    // 4. App claims fees

    function test_FullFeeFlow() public {
        // TODO: Add integration test with mocked paymaster and fee distributor
        // This requires deploying the full contract stack
    }
}


