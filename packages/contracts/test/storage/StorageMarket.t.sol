// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {StorageMarket} from "../../src/storage/StorageMarket.sol";
import {StorageProviderRegistry} from "../../src/storage/StorageProviderRegistry.sol";
import {IStorageTypes} from "../../src/storage/IStorageTypes.sol";

contract StorageMarketTest is Test, IStorageTypes {
    StorageProviderRegistry public registry;
    StorageMarket public market;

    address public owner = makeAddr("owner");
    address public provider = makeAddr("provider");
    address public user = makeAddr("user");

    uint256 constant STAKE = 0.1 ether;
    uint256 constant SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
    uint256 constant DURATION = 30; // 30 days

    function setUp() public {
        vm.startPrank(owner);
        registry = new StorageProviderRegistry(owner, address(0));
        market = new StorageMarket(address(registry));
        vm.stopPrank();

        // Register provider
        vm.deal(provider, 10 ether);
        vm.startPrank(provider);
        registry.register{value: STAKE}("Test Provider", "http://localhost:3100", 0, bytes32(0));
        registry.updatePricing(
            0.001 ether, // pricePerGBMonth
            0.0001 ether, // retrievalPricePerGB
            0.0002 ether // uploadPricePerGB
        );
        registry.updateCapacity(1000, 0); // 1000 GB available
        vm.stopPrank();

        // Fund user
        vm.deal(user, 10 ether);
    }

    // ========== Registration Tests ==========

    function test_ProviderIsRegistered() public view {
        assertTrue(registry.isActive(provider));

        IStorageTypes.Provider memory p = registry.getProvider(provider);
        assertEq(p.name, "Test Provider");
        assertEq(p.endpoint, "http://localhost:3100");
        assertEq(p.stake, STAKE);
        assertTrue(p.active);
    }

    function test_ProviderPricingSet() public view {
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider);
        assertEq(info.pricing.pricePerGBMonth, 0.001 ether);
        assertEq(info.pricing.retrievalPricePerGB, 0.0001 ether);
        assertEq(info.pricing.uploadPricePerGB, 0.0002 ether);
    }

    // ========== Deal Cost Tests ==========

    function test_CalculateDealCost() public view {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1); // WARM tier
        assertGt(cost, 0);
        console.log("Cost for 1GB/30days (WARM):", cost);
    }

    function test_TierCostDifferences() public view {
        uint256 hotCost = market.calculateDealCost(provider, SIZE, DURATION, 0);
        uint256 warmCost = market.calculateDealCost(provider, SIZE, DURATION, 1);
        uint256 coldCost = market.calculateDealCost(provider, SIZE, DURATION, 2);

        // HOT > WARM > COLD
        assertGt(hotCost, warmCost, "HOT should cost more than WARM");
        assertGt(warmCost, coldCost, "WARM should cost more than COLD");

        console.log("HOT:", hotCost);
        console.log("WARM:", warmCost);
        console.log("COLD:", coldCost);
    }

    function test_PermanentTierCost() public view {
        uint256 permanentCost = market.calculateDealCost(provider, SIZE, DURATION, 3);
        uint256 warmCost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        // Permanent should be much more expensive (one-time)
        assertGt(permanentCost, warmCost * 10, "Permanent should be >> WARM");
        console.log("PERMANENT:", permanentCost);
    }

    // ========== Deal Creation Tests ==========

    function test_CreateDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.startPrank(user);
        bytes32 dealId = market.createDeal{value: cost}(
            provider,
            "QmTestCid123456",
            SIZE,
            DURATION,
            1, // WARM tier
            1 // replication factor
        );
        vm.stopPrank();

        assertNotEq(dealId, bytes32(0));

        IStorageTypes.StorageDeal memory deal = market.getDeal(dealId);
        assertEq(deal.user, user);
        assertEq(deal.provider, provider);
        assertEq(uint8(deal.status), uint8(DealStatus.PENDING));
        assertEq(deal.cid, "QmTestCid123456");
        assertEq(deal.sizeBytes, SIZE);
        assertEq(deal.totalCost, cost);
    }

    function test_CreateDealRefundsExcess() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);
        uint256 excess = 0.5 ether;
        uint256 balanceBefore = user.balance;

        vm.startPrank(user);
        market.createDeal{value: cost + excess}(provider, "QmTestCid", SIZE, DURATION, 1, 1);
        vm.stopPrank();

        // User should get excess refunded
        uint256 balanceAfter = user.balance;
        assertEq(balanceBefore - balanceAfter, cost);
    }

    function test_RevertInsufficientPayment() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.startPrank(user);
        vm.expectRevert("Insufficient payment");
        market.createDeal{value: cost - 1}(provider, "QmTestCid", SIZE, DURATION, 1, 1);
        vm.stopPrank();
    }

    function test_RevertInactiveProvider() public {
        // Deactivate provider
        vm.prank(provider);
        registry.deactivate();

        vm.startPrank(user);
        vm.expectRevert("Provider not active");
        market.createDeal{value: 1 ether}(provider, "QmTestCid", SIZE, DURATION, 1, 1);
        vm.stopPrank();
    }

    // ========== Deal Lifecycle Tests ==========

    function test_ConfirmDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        // Provider confirms
        vm.prank(provider);
        market.confirmDeal(dealId);

        IStorageTypes.StorageDeal memory deal = market.getDeal(dealId);
        assertEq(uint8(deal.status), uint8(DealStatus.ACTIVE));
        assertGt(deal.startTime, 0);
        assertGt(deal.endTime, deal.startTime);
    }

    function test_TerminatePendingDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);
        uint256 userBalanceBefore = user.balance;

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        // Terminate pending deal - full refund
        vm.prank(user);
        market.terminateDeal(dealId);

        IStorageTypes.StorageDeal memory deal = market.getDeal(dealId);
        assertEq(uint8(deal.status), uint8(DealStatus.TERMINATED));

        // Full refund
        assertEq(user.balance, userBalanceBefore);
    }

    function test_TerminateActiveDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        // Fast forward 15 days (half the duration)
        vm.warp(block.timestamp + 15 days);

        vm.prank(user);
        market.terminateDeal(dealId);

        IStorageTypes.StorageDeal memory deal = market.getDeal(dealId);
        assertEq(uint8(deal.status), uint8(DealStatus.TERMINATED));

        // Partial refund (50% of remaining time, /2 for early termination penalty)
        assertGt(deal.refundedAmount, 0);
        assertLt(deal.refundedAmount, cost / 2); // Should be ~25% refund
    }

    function test_CompleteDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);
        uint256 providerBalanceBefore = provider.balance;

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        // Fast forward past end time
        vm.warp(block.timestamp + 31 days);

        vm.prank(provider);
        market.completeDeal(dealId);

        IStorageTypes.StorageDeal memory deal = market.getDeal(dealId);
        assertEq(uint8(deal.status), uint8(DealStatus.EXPIRED));

        // Provider gets paid
        assertEq(provider.balance, providerBalanceBefore + cost);
    }

    // ========== Rating Tests ==========

    function test_RateDeal() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        vm.warp(block.timestamp + 31 days);

        vm.prank(provider);
        market.completeDeal(dealId);

        // Rate the deal
        vm.prank(user);
        market.rateDeal(dealId, 85, "Great service!");

        IStorageTypes.ProviderRecord memory record = market.getProviderRecord(provider);
        assertEq(record.avgRating, 85);
        assertEq(record.ratingCount, 1);
    }

    // ========== User/Provider Records ==========

    function test_UserRecordsUpdated() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        IStorageTypes.UserRecord memory record = market.getUserRecord(user);
        assertEq(record.totalDeals, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        record = market.getUserRecord(user);
        assertEq(record.activeDeals, 1);

        vm.warp(block.timestamp + 31 days);

        vm.prank(provider);
        market.completeDeal(dealId);

        record = market.getUserRecord(user);
        assertEq(record.activeDeals, 0);
        assertEq(record.completedDeals, 1);
        assertEq(record.totalSpent, cost);
    }

    function test_ProviderRecordsUpdated() public {
        uint256 cost = market.calculateDealCost(provider, SIZE, DURATION, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid", SIZE, DURATION, 1, 1);

        IStorageTypes.ProviderRecord memory record = market.getProviderRecord(provider);
        assertEq(record.totalDeals, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        record = market.getProviderRecord(provider);
        assertEq(record.activeDeals, 1);

        vm.warp(block.timestamp + 31 days);

        vm.prank(provider);
        market.completeDeal(dealId);

        record = market.getProviderRecord(provider);
        assertEq(record.activeDeals, 0);
        assertEq(record.completedDeals, 1);
        assertEq(record.totalEarnings, cost);
    }

    // ========== Quote Tests ==========

    function test_GetQuote() public view {
        IStorageTypes.StorageQuote memory quote = market.getQuote(provider, SIZE, DURATION, 1);

        assertEq(quote.provider, provider);
        assertEq(quote.sizeBytes, SIZE);
        assertEq(quote.durationDays, DURATION);
        assertEq(uint8(quote.tier), 1);
        assertGt(quote.cost, 0);
        assertGt(quote.expiresAt, block.timestamp);

        // Cost breakdown
        assertGt(quote.costBreakdown.storageCost, 0);
        assertGt(quote.costBreakdown.bandwidth, 0);
    }
}
