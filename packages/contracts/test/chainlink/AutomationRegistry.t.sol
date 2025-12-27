// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {AutomationRegistry, IAutomationCompatible} from "../../src/chainlink/AutomationRegistry.sol";

contract MockAutomatedContract is IAutomationCompatible {
    uint256 public counter;
    bool public needsUpkeep = true;

    function setNeedsUpkeep(bool _needs) external {
        needsUpkeep = _needs;
    }

    function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData) {
        upkeepNeeded = needsUpkeep;
        performData = abi.encode(counter + 1);
    }

    function performUpkeep(bytes calldata performData) external {
        uint256 newValue = abi.decode(performData, (uint256));
        counter = newValue;
        needsUpkeep = false;
    }
}

contract AutomationRegistryTest is Test {
    AutomationRegistry public registry;
    MockAutomatedContract public target;

    address public owner = address(0x1001);
    address public user = address(0x1002);
    address public keeper = address(0x1003);
    address public governance = address(0x1004);

    function setUp() public {
        vm.startPrank(owner);
        registry = new AutomationRegistry(governance);
        vm.stopPrank();

        target = new MockAutomatedContract();

        // Register and approve keeper
        vm.deal(keeper, 10 ether);
        vm.prank(keeper);
        registry.registerKeeper{value: 0.1 ether}();

        vm.prank(governance);
        registry.approveKeeper(keeper);
    }

    function test_RegisterUpkeep() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.1 ether}(
            address(target),
            500000, // executeGas
            3600, // interval (1 hour)
            "", // checkData
            AutomationRegistry.UpkeepType.CONDITIONAL
        );

        assertEq(upkeepId, 1);

        (address upkeepTarget, uint96 balance, address admin, uint32 executeGas, uint32 interval,,, bool active) =
            registry.getUpkeep(upkeepId);

        assertEq(upkeepTarget, address(target));
        assertEq(balance, 0.1 ether);
        assertEq(admin, user);
        assertEq(executeGas, 500000);
        assertEq(interval, 3600);
        assertTrue(active);
    }

    function test_FundUpkeep() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.1 ether}(
            address(target), 500000, 3600, "", AutomationRegistry.UpkeepType.CONDITIONAL
        );

        vm.prank(user);
        registry.fundUpkeep{value: 0.5 ether}(upkeepId);

        (, uint96 balance,,,,,,) = registry.getUpkeep(upkeepId);
        assertEq(balance, 0.6 ether);
    }

    function test_RegisterKeeper() public {
        address newKeeper = address(5);
        vm.deal(newKeeper, 1 ether);

        vm.prank(newKeeper);
        registry.registerKeeper{value: 0.1 ether}();

        AutomationRegistry.KeeperInfo memory info = registry.getKeeperInfo(newKeeper);
        assertEq(info.keeper, newKeeper);
        assertEq(info.stake, 0.1 ether);
        assertFalse(info.approved); // Not approved yet
    }

    function test_PerformUpkeep() public {
        // Register upkeep
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.5 ether}(
            address(target),
            500000,
            60, // 1 minute interval
            "",
            AutomationRegistry.UpkeepType.CONDITIONAL
        );

        // Skip ahead 2 minutes
        skip(120);

        // Check upkeep
        (bool needed, bytes memory performData) = registry.checkUpkeep(upkeepId, "");
        assertTrue(needed);

        // Perform upkeep as keeper
        uint256 keeperBalanceBefore = keeper.balance;
        vm.prank(keeper);
        registry.performUpkeep(upkeepId, performData);

        // Verify counter incremented
        assertEq(target.counter(), 1);
        assertFalse(target.needsUpkeep());

        // Verify keeper got paid (or at least didn't lose money)
        assertGe(keeper.balance, keeperBalanceBefore);
    }

    function test_CancelUpkeep() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.5 ether}(
            address(target), 500000, 3600, "", AutomationRegistry.UpkeepType.CONDITIONAL
        );

        uint256 balanceBefore = user.balance;

        vm.prank(user);
        registry.cancelUpkeep(upkeepId);

        // User should get refund
        assertEq(user.balance - balanceBefore, 0.5 ether);
    }

    function test_PauseUnpause() public {
        vm.prank(governance);
        registry.pause();

        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.1 ether}(
            address(target), 500000, 60, "", AutomationRegistry.UpkeepType.CONDITIONAL
        );

        skip(120);

        // Should fail while paused
        vm.expectRevert();
        vm.prank(keeper);
        registry.performUpkeep(upkeepId, "");

        // Unpause
        vm.prank(governance);
        registry.unpause();

        // Should work now
        (bool needed,) = registry.checkUpkeep(upkeepId, "");
        assertTrue(needed);
    }

    function test_SlashKeeper() public {
        AutomationRegistry.KeeperInfo memory infoBefore = registry.getKeeperInfo(keeper);
        uint96 stakeBefore = infoBefore.stake;

        vm.prank(governance);
        registry.slashKeeper(keeper, 0.05 ether, "missed upkeep");

        AutomationRegistry.KeeperInfo memory infoAfter = registry.getKeeperInfo(keeper);
        assertEq(infoAfter.stake, stakeBefore - 0.05 ether);
    }

    function test_RevertWhen_NonKeeperCantPerform() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 upkeepId = registry.registerUpkeep{value: 0.1 ether}(
            address(target), 500000, 60, "", AutomationRegistry.UpkeepType.CONDITIONAL
        );

        skip(120);

        // Non-keeper tries to perform - should fail
        vm.expectRevert();
        vm.prank(user);
        registry.performUpkeep(upkeepId, "");
    }

    function test_GetState() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        registry.registerUpkeep{value: 0.1 ether}(
            address(target), 500000, 3600, "", AutomationRegistry.UpkeepType.CONDITIONAL
        );

        (
            uint256 upkeepCount,
            uint256 totalActiveUpkeeps,
            uint256 totalPerforms,
            uint256 totalFeesPaid,
            uint256 keeperCount
        ) = registry.getState();

        assertEq(upkeepCount, 1);
        assertEq(totalActiveUpkeeps, 1);
        assertEq(totalPerforms, 0);
        assertEq(totalFeesPaid, 0);
        assertEq(keeperCount, 1);
    }
}
