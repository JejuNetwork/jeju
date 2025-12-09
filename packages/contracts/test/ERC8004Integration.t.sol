// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ServiceRegistry} from "../src/services/ServiceRegistry.sol";
import {Bazaar} from "../src/marketplace/Bazaar.sol";
import {MockJejuUSDC} from "../src/tokens/MockJejuUSDC.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockGold is ERC20 {
    constructor() ERC20("Hyperscape Gold", "HG") {
        _mint(msg.sender, 1000000 * 1e18);
    }
}

/**
 * @title ERC8004IntegrationTest
 * @notice Tests ERC-8004 integration across ServiceRegistry, Bazaar, etc.
 */
contract ERC8004IntegrationTest is Test {
    IdentityRegistry public identityRegistry;
    ServiceRegistry public serviceRegistry;
    Bazaar public bazaar;
    MockJejuUSDC public usdc;
    MockGold public gold;

    address public owner;
    address public alice;
    address public bob;
    address public treasury;

    uint256 public aliceAgentId;
    uint256 public bobAgentId;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        treasury = makeAddr("treasury");

        // Deploy IdentityRegistry
        identityRegistry = new IdentityRegistry();

        // Deploy tokens
        usdc = new MockJejuUSDC(owner);
        gold = new MockGold();

        // Deploy ServiceRegistry and link to IdentityRegistry
        serviceRegistry = new ServiceRegistry(treasury);
        serviceRegistry.setIdentityRegistry(address(identityRegistry));

        // Deploy Bazaar and link to IdentityRegistry
        bazaar = new Bazaar(owner, address(gold), address(usdc), treasury);
        bazaar.setIdentityRegistry(address(identityRegistry));

        // Register agents
        vm.prank(alice);
        aliceAgentId = identityRegistry.register("ipfs://alice-agent");

        vm.prank(bob);
        bobAgentId = identityRegistry.register("ipfs://bob-agent");

        // Fund users
        usdc.mint(alice, 10000 * 1e6);
        usdc.mint(bob, 10000 * 1e6);
        gold.transfer(alice, 10000 * 1e18);
        gold.transfer(bob, 10000 * 1e18);
    }

    // ============ ServiceRegistry ERC-8004 Tests ============

    function testServiceRegistry_RegisterWithAgent() public {
        // Register service with agent
        serviceRegistry.registerServiceWithAgent(
            "ai-assistant",
            "ai",
            100 * 1e18, // base price
            50 * 1e18, // min price
            200 * 1e18, // max price
            aliceAgentId
        );

        // Verify service is linked to agent
        assertEq(serviceRegistry.getServiceProviderAgent("ai-assistant"), aliceAgentId);
        assertTrue(serviceRegistry.isVerifiedAgent("ai-assistant"));

        // Verify we can query services by agent
        string[] memory services = serviceRegistry.getServicesByAgent(aliceAgentId);
        assertEq(services.length, 1);
        assertEq(services[0], "ai-assistant");
    }

    function testServiceRegistry_MultipleServicesPerAgent() public {
        // Register multiple services with same agent
        serviceRegistry.registerServiceWithAgent(
            "chat-completion", "ai", 100 * 1e18, 50 * 1e18, 200 * 1e18, aliceAgentId
        );

        serviceRegistry.registerServiceWithAgent(
            "image-generation", "ai", 200 * 1e18, 100 * 1e18, 400 * 1e18, aliceAgentId
        );

        // Verify both services are linked
        string[] memory services = serviceRegistry.getServicesByAgent(aliceAgentId);
        assertEq(services.length, 2);
    }

    function testServiceRegistry_UnverifiedService() public {
        // Register service without agent (traditional method)
        serviceRegistry.registerService("legacy-service", "misc", 100 * 1e18, 50 * 1e18, 200 * 1e18, alice);

        // Verify service is NOT marked as verified
        assertEq(serviceRegistry.getServiceProviderAgent("legacy-service"), 0);
        assertFalse(serviceRegistry.isVerifiedAgent("legacy-service"));
    }

    function testServiceRegistry_RequireAgentRegistration() public {
        // Enable required agent registration
        serviceRegistry.setRequireAgentRegistration(true);

        // Attempt to register without agent should revert
        vm.expectRevert(ServiceRegistry.AgentRequired.selector);
        serviceRegistry.registerService("should-fail", "misc", 100 * 1e18, 50 * 1e18, 200 * 1e18, alice);

        // With agent should succeed
        serviceRegistry.registerServiceWithAgent(
            "should-succeed", "misc", 100 * 1e18, 50 * 1e18, 200 * 1e18, aliceAgentId
        );

        assertTrue(serviceRegistry.isVerifiedAgent("should-succeed"));
    }

    function testServiceRegistry_InvalidAgentId() public {
        vm.expectRevert(ServiceRegistry.InvalidAgentId.selector);
        serviceRegistry.registerServiceWithAgent(
            "invalid-agent",
            "misc",
            100 * 1e18,
            50 * 1e18,
            200 * 1e18,
            999999 // Non-existent agent ID
        );
    }

    // ============ Bazaar ERC-8004 Tests ============

    function testBazaar_LinkListingToAgent() public {
        // Alice creates a listing
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);

        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );

        // Link listing to Alice's agent
        bazaar.linkListingToAgent(listingId, aliceAgentId);
        vm.stopPrank();

        // Verify listing is linked
        assertEq(bazaar.getListingAgentId(listingId), aliceAgentId);
        assertTrue(bazaar.isVerifiedSeller(listingId));

        // Verify we can query listings by agent
        uint256[] memory listings = bazaar.getListingsByAgent(aliceAgentId);
        assertEq(listings.length, 1);
        assertEq(listings[0], listingId);
    }

    function testBazaar_MultipleListingsPerAgent() public {
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);
        usdc.approve(address(bazaar), 100 * 1e6);

        // Create listing with gold
        uint256 listing1 = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );

        // Create listing with USDC (different asset)
        uint256 listing2 = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(usdc), 0, 100 * 1e6, Bazaar.Currency.ETH, address(0), 2 ether, 0
        );

        // Link both to agent
        bazaar.linkListingToAgent(listing1, aliceAgentId);
        bazaar.linkListingToAgent(listing2, aliceAgentId);
        vm.stopPrank();

        // Verify both are linked
        uint256[] memory listings = bazaar.getListingsByAgent(aliceAgentId);
        assertEq(listings.length, 2);
    }

    function testBazaar_UnverifiedListing() public {
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);

        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );
        vm.stopPrank();

        // Without linking, listing is not verified
        assertEq(bazaar.getListingAgentId(listingId), 0);
        assertFalse(bazaar.isVerifiedSeller(listingId));
    }

    function testBazaar_CannotLinkOthersAgent() public {
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);

        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );

        // Try to link Bob's agent to Alice's listing
        vm.expectRevert("Not agent owner");
        bazaar.linkListingToAgent(listingId, bobAgentId);
        vm.stopPrank();
    }

    function testBazaar_OnlySellerCanLink() public {
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);

        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );
        vm.stopPrank();

        // Bob tries to link Alice's listing
        vm.prank(bob);
        vm.expectRevert(Bazaar.NotAssetOwner.selector);
        bazaar.linkListingToAgent(listingId, bobAgentId);
    }

    // ============ Cross-Contract Discovery Tests ============

    function testCrossContractDiscovery() public {
        // Alice registers as a service provider agent
        serviceRegistry.registerServiceWithAgent(
            "alice-ai-service", "ai", 100 * 1e18, 50 * 1e18, 200 * 1e18, aliceAgentId
        );

        // Alice also creates a marketplace listing
        vm.startPrank(alice);
        gold.approve(address(bazaar), 100 * 1e18);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20, address(gold), 0, 100 * 1e18, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );
        bazaar.linkListingToAgent(listingId, aliceAgentId);
        vm.stopPrank();

        // Verify Alice can be discovered via agent ID across contracts
        assertTrue(identityRegistry.agentExists(aliceAgentId));
        assertEq(identityRegistry.ownerOf(aliceAgentId), alice);

        // Found in ServiceRegistry
        string[] memory services = serviceRegistry.getServicesByAgent(aliceAgentId);
        assertEq(services.length, 1);

        // Found in Bazaar
        uint256[] memory listings = bazaar.getListingsByAgent(aliceAgentId);
        assertEq(listings.length, 1);
    }

    // ============ Agent Transfer Tests ============

    function testAgentTransfer_ServiceStillLinked() public {
        // Alice registers service with her agent
        serviceRegistry.registerServiceWithAgent("alice-service", "ai", 100 * 1e18, 50 * 1e18, 200 * 1e18, aliceAgentId);

        // Alice transfers agent to Bob
        vm.prank(alice);
        identityRegistry.transferFrom(alice, bob, aliceAgentId);

        // Service still points to same agent ID (now owned by Bob)
        assertEq(serviceRegistry.getServiceProviderAgent("alice-service"), aliceAgentId);
        assertTrue(serviceRegistry.isVerifiedAgent("alice-service"));

        // But the owner changed
        assertEq(identityRegistry.ownerOf(aliceAgentId), bob);
    }
}
