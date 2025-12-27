// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/work/BountyRegistry.sol";
import "../src/registry/IdentityRegistry.sol";

contract BountyRegistryTest is Test {
    BountyRegistry public bountyRegistry;
    IdentityRegistry public identityRegistry;

    address public owner = address(1);
    address public creator = address(2);
    address public worker = address(3);
    address public treasury = address(4);

    function setUp() public {
        vm.startPrank(owner);

        // Deploy IdentityRegistry first (no constructor args)
        identityRegistry = new IdentityRegistry();

        // Deploy BountyRegistry
        bountyRegistry = new BountyRegistry(address(identityRegistry), treasury, owner);

        vm.stopPrank();

        // Fund test accounts
        vm.deal(creator, 100 ether);
        vm.deal(worker, 10 ether);
    }

    function test_CreateBounty() public {
        vm.startPrank(creator);

        BountyRegistry.TokenAmount[] memory rewards = new BountyRegistry.TokenAmount[](1);
        rewards[0] = BountyRegistry.TokenAmount({
            token: address(0), // ETH
            amount: 1 ether
        });

        string[] memory milestoneTitles = new string[](1);
        milestoneTitles[0] = "Complete Implementation";

        string[] memory milestoneDescs = new string[](1);
        milestoneDescs[0] = "Implement the full feature";

        uint256[] memory milestonePercentages = new uint256[](1);
        milestonePercentages[0] = 10000; // 100%

        string[] memory skills = new string[](2);
        skills[0] = "Solidity";
        skills[1] = "Testing";

        BountyRegistry.CreateBountyParams memory params = BountyRegistry.CreateBountyParams({
            title: "Test Bounty",
            description: "A test bounty for unit testing",
            specUri: "ipfs://Qm...",
            deadline: block.timestamp + 7 days
        });

        // Calculate required stake (10% of reward)
        uint256 stakeAmount = (1 ether * 1000) / 10000; // 0.1 ETH
        uint256 totalRequired = 1 ether + stakeAmount;

        bytes32 bountyId = bountyRegistry.createBounty{value: totalRequired}(
            params, rewards, milestoneTitles, milestoneDescs, milestonePercentages, skills
        );

        vm.stopPrank();

        // Verify bounty was created
        BountyRegistry.Bounty memory bounty = bountyRegistry.getBounty(bountyId);
        assertEq(bounty.creator, creator);
        assertEq(bounty.title, "Test Bounty");
        assertEq(uint8(bounty.status), uint8(BountyRegistry.BountyStatus.OPEN));
    }

    function test_ApplyForBounty() public {
        // First create a bounty
        bytes32 bountyId = _createTestBounty();

        // Worker applies
        vm.startPrank(worker);

        bountyRegistry.applyForBounty(bountyId, "ipfs://proposal...", 7 days);

        vm.stopPrank();

        // Verify application
        BountyRegistry.BountyApplication[] memory apps = bountyRegistry.getApplications(bountyId);
        assertEq(apps.length, 1);
        assertEq(apps[0].applicant, worker);
    }

    function test_AcceptApplication() public {
        bytes32 bountyId = _createTestBounty();

        // Worker applies
        vm.prank(worker);
        bountyRegistry.applyForBounty(bountyId, "ipfs://proposal...", 7 days);

        // Creator accepts
        vm.prank(creator);
        bountyRegistry.acceptApplication(bountyId, 0);

        // Verify assignment
        BountyRegistry.Bounty memory bounty = bountyRegistry.getBounty(bountyId);
        assertEq(bounty.assignee, worker);
        assertEq(uint8(bounty.status), uint8(BountyRegistry.BountyStatus.IN_PROGRESS));
    }

    function test_CancelBounty() public {
        bytes32 bountyId = _createTestBounty();

        uint256 balanceBefore = creator.balance;

        vm.prank(creator);
        bountyRegistry.cancelBounty(bountyId);

        // Verify cancellation and refund
        BountyRegistry.Bounty memory bounty = bountyRegistry.getBounty(bountyId);
        assertEq(uint8(bounty.status), uint8(BountyRegistry.BountyStatus.CANCELLED));

        // Check stake and reward were returned
        assertGt(creator.balance, balanceBefore);
    }

    function test_RevertOnInvalidDeadline() public {
        vm.startPrank(creator);

        BountyRegistry.TokenAmount[] memory rewards = new BountyRegistry.TokenAmount[](1);
        rewards[0] = BountyRegistry.TokenAmount({token: address(0), amount: 1 ether});

        string[] memory milestoneTitles = new string[](1);
        milestoneTitles[0] = "Complete";

        string[] memory milestoneDescs = new string[](1);
        milestoneDescs[0] = "Complete the work";

        uint256[] memory milestonePercentages = new uint256[](1);
        milestonePercentages[0] = 10000;

        string[] memory skills = new string[](1);
        skills[0] = "Solidity";

        BountyRegistry.CreateBountyParams memory params = BountyRegistry.CreateBountyParams({
            title: "Test",
            description: "Test",
            specUri: "ipfs://...",
            deadline: block.timestamp - 1 // Past deadline
        });

        vm.expectRevert(BountyRegistry.DeadlinePassed.selector);
        bountyRegistry.createBounty{value: 1.1 ether}(
            params, rewards, milestoneTitles, milestoneDescs, milestonePercentages, skills
        );

        vm.stopPrank();
    }

    function test_RevertOnInvalidMilestonePercentages() public {
        vm.startPrank(creator);

        BountyRegistry.TokenAmount[] memory rewards = new BountyRegistry.TokenAmount[](1);
        rewards[0] = BountyRegistry.TokenAmount({token: address(0), amount: 1 ether});

        string[] memory milestoneTitles = new string[](2);
        milestoneTitles[0] = "Phase 1";
        milestoneTitles[1] = "Phase 2";

        string[] memory milestoneDescs = new string[](2);
        milestoneDescs[0] = "First phase";
        milestoneDescs[1] = "Second phase";

        uint256[] memory milestonePercentages = new uint256[](2);
        milestonePercentages[0] = 6000; // 60%
        milestonePercentages[1] = 3000; // 30% - total only 90%!

        string[] memory skills = new string[](1);
        skills[0] = "Solidity";

        BountyRegistry.CreateBountyParams memory params = BountyRegistry.CreateBountyParams({
            title: "Test",
            description: "Test",
            specUri: "ipfs://...",
            deadline: block.timestamp + 7 days
        });

        vm.expectRevert(BountyRegistry.MilestonePercentageInvalid.selector);
        bountyRegistry.createBounty{value: 1.1 ether}(
            params, rewards, milestoneTitles, milestoneDescs, milestonePercentages, skills
        );

        vm.stopPrank();
    }

    // Helper function to create a test bounty
    function _createTestBounty() internal returns (bytes32) {
        vm.startPrank(creator);

        BountyRegistry.TokenAmount[] memory rewards = new BountyRegistry.TokenAmount[](1);
        rewards[0] = BountyRegistry.TokenAmount({token: address(0), amount: 1 ether});

        string[] memory milestoneTitles = new string[](1);
        milestoneTitles[0] = "Complete Implementation";

        string[] memory milestoneDescs = new string[](1);
        milestoneDescs[0] = "Implement the full feature";

        uint256[] memory milestonePercentages = new uint256[](1);
        milestonePercentages[0] = 10000;

        string[] memory skills = new string[](1);
        skills[0] = "Solidity";

        BountyRegistry.CreateBountyParams memory params = BountyRegistry.CreateBountyParams({
            title: "Test Bounty",
            description: "A test bounty",
            specUri: "ipfs://...",
            deadline: block.timestamp + 7 days
        });

        bytes32 bountyId = bountyRegistry.createBounty{value: 1.1 ether}(
            params, rewards, milestoneTitles, milestoneDescs, milestonePercentages, skills
        );

        vm.stopPrank();

        return bountyId;
    }
}
