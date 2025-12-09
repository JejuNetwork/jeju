// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ComputeRental} from "../../src/compute/ComputeRental.sol";

contract ComputeRentalTest is Test {
    ComputeRental public rental;

    address public owner;
    address public treasury;
    address public provider;
    address public user;
    address public arbitrator;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        provider = makeAddr("provider");
        user = makeAddr("user");
        arbitrator = makeAddr("arbitrator");

        rental = new ComputeRental(owner, treasury);

        // Fund test accounts
        vm.deal(provider, 100 ether);
        vm.deal(user, 100 ether);

        // Add arbitrator
        rental.addArbitrator(arbitrator);
    }

    // ============ Provider Registration Tests ============

    function test_setProviderResources() public {
        vm.startPrank(provider);

        ComputeRental.ComputeResources memory resources = ComputeRental.ComputeResources({
            gpuType: ComputeRental.GPUType.NVIDIA_A100_80GB,
            gpuCount: 4,
            gpuVram: 80,
            cpuCores: 64,
            memoryGb: 512,
            storageGb: 2000,
            bandwidthMbps: 10000,
            teeCapable: true
        });

        ComputeRental.ResourcePricing memory pricing = ComputeRental.ResourcePricing({
            pricePerHour: 0.1 ether,
            pricePerGpuHour: 0.05 ether,
            minimumRentalHours: 1,
            maximumRentalHours: 720
        });

        string[] memory images = new string[](2);
        images[0] = "nvidia/cuda:12.0-runtime";
        images[1] = "ubuntu:22.04";

        rental.setProviderResources(resources, pricing, 10, images, true, true);

        (
            ComputeRental.ComputeResources memory resOut,
            ComputeRental.ResourcePricing memory pricingOut,
            uint256 maxConcurrent,
            uint256 active,
            bool sshEnabled,
            bool dockerEnabled
        ) = rental.getProviderResources(provider);

        assertEq(uint8(resOut.gpuType), uint8(ComputeRental.GPUType.NVIDIA_A100_80GB));
        assertEq(resOut.gpuCount, 4);
        assertEq(pricingOut.pricePerHour, 0.1 ether);
        assertEq(maxConcurrent, 10);
        assertEq(active, 0);
        assertTrue(sshEnabled);
        assertTrue(dockerEnabled);

        vm.stopPrank();
    }

    // ============ Rental Creation Tests ============

    function test_createRental() public {
        _setupProvider();

        vm.startPrank(user);

        uint256 cost = rental.calculateRentalCost(provider, 2);

        bytes32 rentalId = rental.createRental{value: cost}(
            provider,
            2, // 2 hours
            "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDtest user@test",
            "nvidia/cuda:12.0-runtime",
            "#!/bin/bash\necho hello"
        );

        ComputeRental.Rental memory r = rental.getRental(rentalId);

        assertEq(r.user, user);
        assertEq(r.provider, provider);
        assertEq(uint8(r.status), uint8(ComputeRental.RentalStatus.PENDING));
        assertEq(r.totalCost, cost);
        assertEq(r.paidAmount, cost);

        vm.stopPrank();
    }

    function test_createRental_bannedUser() public {
        _setupProvider();

        // Ban user
        rental.banUser(user, "Testing ban");

        vm.startPrank(user);

        uint256 cost = rental.calculateRentalCost(provider, 2);

        vm.expectRevert(ComputeRental.UserBannedError.selector);
        rental.createRental{value: cost}(provider, 2, "ssh-rsa test", "", "");

        vm.stopPrank();
    }

    function test_createRental_bannedProvider() public {
        _setupProvider();

        // Ban provider
        rental.banProvider(provider, "Testing ban");

        vm.startPrank(user);

        uint256 cost = 1 ether; // Estimate since provider is banned

        vm.expectRevert(ComputeRental.ProviderBannedError.selector);
        rental.createRental{value: cost}(provider, 2, "ssh-rsa test", "", "");

        vm.stopPrank();
    }

    // ============ Rental Lifecycle Tests ============

    function test_startRental() public {
        bytes32 rentalId = _createTestRental();

        vm.startPrank(provider);
        rental.startRental(rentalId, "192.168.1.100", 2222, "container-123");
        vm.stopPrank();

        ComputeRental.Rental memory r = rental.getRental(rentalId);

        assertEq(uint8(r.status), uint8(ComputeRental.RentalStatus.ACTIVE));
        assertEq(r.sshHost, "192.168.1.100");
        assertEq(r.sshPort, 2222);
        assertGt(r.startTime, 0);
        assertGt(r.endTime, r.startTime);
    }

    function test_completeRental() public {
        bytes32 rentalId = _createAndStartRental();

        // Skip forward 1 hour
        vm.warp(block.timestamp + 1 hours);

        uint256 treasuryBefore = treasury.balance;
        uint256 providerBefore = provider.balance;

        vm.startPrank(provider);
        rental.completeRental(rentalId);
        vm.stopPrank();

        ComputeRental.Rental memory r = rental.getRental(rentalId);
        assertEq(uint8(r.status), uint8(ComputeRental.RentalStatus.COMPLETED));

        // Check payments
        assertGt(treasury.balance, treasuryBefore, "Treasury should receive fee");
        assertGt(provider.balance, providerBefore, "Provider should receive payment");

        // Check provider record updated
        ComputeRental.ProviderRecord memory pr = rental.getProviderRecord(provider);
        assertEq(pr.completedRentals, 1);
        assertEq(pr.totalRentals, 1);
        assertGt(pr.totalEarnings, 0);
    }

    function test_cancelRental() public {
        bytes32 rentalId = _createTestRental();

        uint256 userBefore = user.balance;
        ComputeRental.Rental memory rBefore = rental.getRental(rentalId);

        vm.startPrank(user);
        rental.cancelRental(rentalId);
        vm.stopPrank();

        ComputeRental.Rental memory r = rental.getRental(rentalId);
        assertEq(uint8(r.status), uint8(ComputeRental.RentalStatus.CANCELLED));
        assertEq(user.balance, userBefore + rBefore.paidAmount, "User should get full refund");

        // Check user record
        ComputeRental.UserRecord memory ur = rental.getUserRecord(user);
        assertEq(ur.cancelledRentals, 1);
    }

    // ============ Rating Tests ============

    function test_rateRental() public {
        bytes32 rentalId = _createAndCompleteRental();

        vm.startPrank(user);
        rental.rateRental(rentalId, 85, "Great service!");
        vm.stopPrank();

        ComputeRental.RentalRating memory rating = rental.getRentalRating(rentalId);
        assertEq(rating.score, 85);
        assertEq(rating.comment, "Great service!");
        assertGt(rating.ratedAt, 0);

        // Check provider avg rating updated
        ComputeRental.ProviderRecord memory pr = rental.getProviderRecord(provider);
        assertEq(pr.ratingCount, 1);
        assertEq(pr.avgRating, 8500); // 85 * 100
    }

    function test_rateRental_invalidScore() public {
        bytes32 rentalId = _createAndCompleteRental();

        vm.startPrank(user);
        vm.expectRevert("Score must be 0-100");
        rental.rateRental(rentalId, 150, "Too high");
        vm.stopPrank();
    }

    function test_rateRental_notCompleted() public {
        bytes32 rentalId = _createTestRental();

        vm.startPrank(user);
        vm.expectRevert(ComputeRental.RentalNotCompleted.selector);
        rental.rateRental(rentalId, 85, "Not done yet");
        vm.stopPrank();
    }

    // ============ Dispute Tests ============

    function test_createDispute() public {
        bytes32 rentalId = _createAndStartRental();

        vm.startPrank(user);

        uint256 bond = rental.disputeBond();
        bytes32 disputeId =
            rental.createDispute{value: bond}(rentalId, ComputeRental.DisputeReason.PROVIDER_OFFLINE, "ipfs://Qm...");

        vm.stopPrank();

        ComputeRental.Dispute memory d = rental.getDispute(disputeId);
        assertEq(d.rentalId, rentalId);
        assertEq(d.initiator, user);
        assertEq(d.defendant, provider);
        assertEq(uint8(d.reason), uint8(ComputeRental.DisputeReason.PROVIDER_OFFLINE));
        assertFalse(d.resolved);

        // Check rental is now disputed
        ComputeRental.Rental memory r = rental.getRental(rentalId);
        assertEq(uint8(r.status), uint8(ComputeRental.RentalStatus.DISPUTED));
    }

    function test_resolveDispute_inFavorOfInitiator() public {
        bytes32 rentalId = _createAndStartRental();

        vm.startPrank(user);
        uint256 bond = rental.disputeBond();
        bytes32 disputeId =
            rental.createDispute{value: bond}(rentalId, ComputeRental.DisputeReason.PROVIDER_OFFLINE, "ipfs://Qm...");
        vm.stopPrank();

        uint256 userBefore = user.balance;

        // Get the rental payment amount for comparison
        ComputeRental.Rental memory rBefore = rental.getRental(rentalId);
        uint256 rentalRefund = rBefore.paidAmount - rBefore.refundedAmount;

        vm.startPrank(arbitrator);
        rental.resolveDispute(disputeId, true, 0);
        vm.stopPrank();

        ComputeRental.Dispute memory d = rental.getDispute(disputeId);
        assertTrue(d.resolved);
        assertTrue(d.inFavorOfInitiator);

        // User should get bond back + rental refund
        assertEq(user.balance, userBefore + bond + rentalRefund, "User should get bond + rental refund");

        // Provider should have failed rental recorded
        ComputeRental.ProviderRecord memory pr = rental.getProviderRecord(provider);
        assertEq(pr.failedRentals, 1);
    }

    function test_resolveDispute_inFavorOfDefendant() public {
        bytes32 rentalId = _createAndStartRental();

        vm.startPrank(user);
        uint256 bond = rental.disputeBond();
        bytes32 disputeId =
            rental.createDispute{value: bond}(rentalId, ComputeRental.DisputeReason.PROVIDER_OFFLINE, "ipfs://Qm...");
        vm.stopPrank();

        uint256 treasuryBefore = treasury.balance;

        vm.startPrank(arbitrator);
        rental.resolveDispute(disputeId, false, 0);
        vm.stopPrank();

        ComputeRental.Dispute memory d = rental.getDispute(disputeId);
        assertTrue(d.resolved);
        assertFalse(d.inFavorOfInitiator);

        // Treasury gets the bond (loser pays)
        assertEq(treasury.balance, treasuryBefore + bond, "Treasury should get bond");
    }

    // ============ Abuse Reporting Tests ============

    function test_reportAbuse() public {
        bytes32 rentalId = _createAndStartRental();

        vm.startPrank(provider);
        rental.reportAbuse(rentalId, ComputeRental.DisputeReason.USER_ABUSE, "ipfs://evidence");
        vm.stopPrank();

        ComputeRental.UserRecord memory ur = rental.getUserRecord(user);
        assertEq(ur.abuseReports, 1);
        assertFalse(ur.banned); // Not banned yet (threshold is 3)
    }

    function test_reportAbuse_autoBan() public {
        // Create and start 3 rentals, report abuse on each
        for (uint256 i = 0; i < 3; i++) {
            bytes32 rentalId = _createAndStartRental();

            vm.startPrank(provider);
            rental.reportAbuse(rentalId, ComputeRental.DisputeReason.USER_ABUSE, "ipfs://evidence");
            vm.stopPrank();
        }

        ComputeRental.UserRecord memory ur = rental.getUserRecord(user);
        assertEq(ur.abuseReports, 3);
        assertTrue(ur.banned, "User should be auto-banned");
        assertGt(ur.bannedAt, 0);
    }

    function test_reportAbuse_invalidReason() public {
        bytes32 rentalId = _createAndStartRental();

        vm.startPrank(provider);
        vm.expectRevert("Invalid abuse reason");
        rental.reportAbuse(rentalId, ComputeRental.DisputeReason.PROVIDER_OFFLINE, "ipfs://evidence");
        vm.stopPrank();
    }

    // ============ Validation Tests ============

    function test_InvalidDuration() public {
        _setupProvider();

        // Update provider to have min 2 hours
        vm.startPrank(provider);
        ComputeRental.ComputeResources memory resources = ComputeRental.ComputeResources({
            gpuType: ComputeRental.GPUType.NVIDIA_A100_80GB,
            gpuCount: 1,
            gpuVram: 80,
            cpuCores: 16,
            memoryGb: 64,
            storageGb: 500,
            bandwidthMbps: 1000,
            teeCapable: false
        });

        ComputeRental.ResourcePricing memory pricing = ComputeRental.ResourcePricing({
            pricePerHour: 0.1 ether,
            pricePerGpuHour: 0.05 ether,
            minimumRentalHours: 2, // Min 2 hours
            maximumRentalHours: 24
        });

        string[] memory images = new string[](0);
        rental.setProviderResources(resources, pricing, 5, images, true, true);
        vm.stopPrank();

        // Try to create 1 hour rental when minimum is 2
        uint256 cost = rental.calculateRentalCost(provider, 1);

        vm.startPrank(user);
        vm.expectRevert(ComputeRental.InvalidDuration.selector);
        rental.createRental{value: cost}(provider, 1, "ssh-rsa test", "", "");
        vm.stopPrank();
    }

    // ============ Admin Tests ============

    function test_banUnbanUser() public {
        rental.banUser(user, "Test ban");

        ComputeRental.UserRecord memory ur = rental.getUserRecord(user);
        assertTrue(ur.banned);
        assertEq(ur.banReason, "Test ban");

        rental.unbanUser(user);

        ur = rental.getUserRecord(user);
        assertFalse(ur.banned);
    }

    function test_banProvider() public {
        _setupProvider();

        rental.banProvider(provider, "Test ban");

        ComputeRental.ProviderRecord memory pr = rental.getProviderRecord(provider);
        assertTrue(pr.banned);
    }

    // ============ Helper Functions ============

    function _setupProvider() internal {
        vm.startPrank(provider);

        ComputeRental.ComputeResources memory resources = ComputeRental.ComputeResources({
            gpuType: ComputeRental.GPUType.NVIDIA_A100_80GB,
            gpuCount: 1,
            gpuVram: 80,
            cpuCores: 16,
            memoryGb: 64,
            storageGb: 500,
            bandwidthMbps: 1000,
            teeCapable: false
        });

        ComputeRental.ResourcePricing memory pricing = ComputeRental.ResourcePricing({
            pricePerHour: 0.1 ether,
            pricePerGpuHour: 0.05 ether,
            minimumRentalHours: 1,
            maximumRentalHours: 24
        });

        string[] memory images = new string[](1);
        images[0] = "ubuntu:22.04";

        rental.setProviderResources(resources, pricing, 5, images, true, true);

        vm.stopPrank();
    }

    function _createTestRental() internal returns (bytes32) {
        _setupProvider();

        vm.startPrank(user);

        uint256 cost = rental.calculateRentalCost(provider, 2);
        bytes32 rentalId = rental.createRental{value: cost}(provider, 2, "ssh-rsa test", "", "");

        vm.stopPrank();
        return rentalId;
    }

    function _createAndStartRental() internal returns (bytes32) {
        bytes32 rentalId = _createTestRental();

        vm.startPrank(provider);
        rental.startRental(rentalId, "192.168.1.100", 2222, "container-123");
        vm.stopPrank();

        return rentalId;
    }

    function _createAndCompleteRental() internal returns (bytes32) {
        bytes32 rentalId = _createAndStartRental();

        vm.warp(block.timestamp + 2 hours);

        vm.startPrank(provider);
        rental.completeRental(rentalId);
        vm.stopPrank();

        return rentalId;
    }
}
