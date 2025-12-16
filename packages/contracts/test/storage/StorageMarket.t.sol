// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/storage/StorageMarket.sol";
import "../../src/storage/StorageProviderRegistry.sol";
import "../../src/distributor/FeeConfig.sol";

contract StorageMarketTest is Test {
    StorageMarket public market;
    StorageProviderRegistry public registry;
    FeeConfig public feeConfig;

    address public owner;
    address public treasury;
    address public provider;
    address public user;
    address public council;
    address public ceo;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        provider = makeAddr("provider");
        user = makeAddr("user");
        council = makeAddr("council");
        ceo = makeAddr("ceo");

        vm.deal(user, 100 ether);
        vm.deal(provider, 10 ether);

        // Deploy registry (new constructor: owner, identityRegistry, banManager, minProviderStake)
        registry = new StorageProviderRegistry(owner, address(0), address(0), 0.1 ether);

        // Deploy FeeConfig (2% storage upload fee by default)
        feeConfig = new FeeConfig(council, ceo, treasury, owner);

        // Deploy market
        market = new StorageMarket(address(registry), treasury, owner);
        market.setFeeConfig(address(feeConfig));

        // Register provider (type 1 = IPFS, attestation hash)
        vm.prank(provider);
        registry.register{value: 0.1 ether}("TestProvider", "https://storage.test", 1, bytes32(uint256(1)));
    }

    function test_CreateDeal() public {
        vm.prank(user);
        bytes32 dealId = market.createDeal{value: 1 ether}(
            provider,
            "QmTestCid123",
            1024 * 1024 * 1024, // 1 GB
            30, // 30 days
            1, // tier
            1 // replication
        );

        assertTrue(dealId != bytes32(0));
    }

    function test_CompleteDealWithPlatformFee() public {
        // Create deal - calculate cost first
        uint256 cost = market.calculateDealCost(provider, 1024 * 1024 * 1024, 30, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid123", 1024 * 1024 * 1024, 30, 1, 1);

        // Confirm deal
        vm.prank(provider);
        market.confirmDeal(dealId);

        // Fast forward past deal end
        vm.warp(block.timestamp + 31 days);

        // Record balances
        uint256 providerBalanceBefore = provider.balance;
        uint256 treasuryBalanceBefore = treasury.balance;

        // Complete deal
        vm.prank(provider);
        market.completeDeal(dealId);

        // Get fee rate from FeeConfig
        uint256 feeBps = feeConfig.getStorageUploadFee(); // 200 = 2%

        // The total payment is the deal cost
        uint256 totalPayment = cost;
        uint256 platformFee = (totalPayment * feeBps) / 10000;
        uint256 providerPayment = totalPayment - platformFee;

        // Verify provider received payment minus platform fee
        assertEq(provider.balance - providerBalanceBefore, providerPayment, "Provider should receive payment minus fee");

        // Verify treasury received platform fee
        assertEq(treasury.balance - treasuryBalanceBefore, platformFee, "Treasury should receive platform fee");

        // Verify tracking
        assertEq(market.totalPlatformFeesCollected(), platformFee, "Platform fees should be tracked");
    }

    function test_SetFeeConfig() public {
        FeeConfig newConfig = new FeeConfig(council, ceo, treasury, owner);
        market.setFeeConfig(address(newConfig));
        assertEq(address(market.feeConfig()), address(newConfig));
    }

    function test_FallbackToLocalFee() public {
        // Remove FeeConfig
        market.setFeeConfig(address(0));

        // Set local fee
        market.setPlatformFee(500); // 5%

        // Create and complete deal - calculate cost first
        uint256 cost = market.calculateDealCost(provider, 1024 * 1024 * 1024, 30, 1);

        vm.prank(user);
        bytes32 dealId = market.createDeal{value: cost}(provider, "QmTestCid456", 1024 * 1024 * 1024, 30, 1, 1);

        vm.prank(provider);
        market.confirmDeal(dealId);

        vm.warp(block.timestamp + 31 days);

        uint256 treasuryBalanceBefore = treasury.balance;

        vm.prank(provider);
        market.completeDeal(dealId);

        // Should use local 5% fee
        uint256 platformFee = (cost * 500) / 10000;
        assertEq(treasury.balance - treasuryBalanceBefore, platformFee);
    }
}
