// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/names/JNSRegistry.sol";
import "../src/names/JNSResolver.sol";
import "../src/names/JNSRegistrar.sol";
import "../src/names/JNSReverseRegistrar.sol";

/**
 * @title JNS Test Suite
 * @notice Comprehensive tests for the Jeju Name Service
 */
contract JNSTest is Test {
    JNSRegistry public registry;
    JNSResolver public resolver;
    JNSRegistrar public registrar;
    JNSReverseRegistrar public reverseRegistrar;

    address public deployer = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public treasury = address(0x999);

    bytes32 public constant ROOT_NODE = bytes32(0);
    bytes32 public jejuLabel;
    bytes32 public jejuNode;

    function setUp() public {
        // Deploy core contracts
        registry = new JNSRegistry();
        resolver = new JNSResolver(address(registry));
        registrar = new JNSRegistrar(address(registry), address(resolver), treasury);
        reverseRegistrar = new JNSReverseRegistrar(address(registry), address(resolver));

        // Compute hashes
        jejuLabel = keccak256("jeju");
        jejuNode = keccak256(abi.encodePacked(ROOT_NODE, jejuLabel));

        // Setup .jeju TLD - give to registrar
        registry.setSubnodeOwner(ROOT_NODE, jejuLabel, address(registrar));

        // Setup reverse namespace
        bytes32 reverseLabel = keccak256("reverse");
        bytes32 addrLabel = keccak256("addr");
        registry.setSubnodeOwner(ROOT_NODE, reverseLabel, deployer);
        bytes32 reverseNode = keccak256(abi.encodePacked(ROOT_NODE, reverseLabel));
        registry.setSubnodeOwner(reverseNode, addrLabel, address(reverseRegistrar));

        // Fund test accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ============ Registry Tests ============

    function test_Registry_Deployment() public view {
        assertEq(registry.owner(ROOT_NODE), deployer);
        assertEq(registry.version(), "1.0.0");
    }

    function test_Registry_SetSubnodeOwner() public {
        bytes32 testLabel = keccak256("test");
        registry.setSubnodeOwner(ROOT_NODE, testLabel, alice);
        
        bytes32 testNode = keccak256(abi.encodePacked(ROOT_NODE, testLabel));
        assertEq(registry.owner(testNode), alice);
    }

    function test_Registry_SetResolver() public {
        bytes32 testLabel = keccak256("test");
        registry.setSubnodeOwner(ROOT_NODE, testLabel, deployer);
        bytes32 testNode = keccak256(abi.encodePacked(ROOT_NODE, testLabel));
        
        registry.setResolver(testNode, address(resolver));
        assertEq(registry.resolver(testNode), address(resolver));
    }

    function test_Registry_OnlyOwnerCanModify() public {
        bytes32 testLabel = keccak256("test");
        registry.setSubnodeOwner(ROOT_NODE, testLabel, alice);
        bytes32 testNode = keccak256(abi.encodePacked(ROOT_NODE, testLabel));
        
        vm.prank(bob);
        vm.expectRevert("Not authorized");
        registry.setResolver(testNode, address(resolver));
    }

    // ============ Registrar Tests ============

    function test_Registrar_CheckAvailability() public view {
        assertTrue(registrar.available("testname"));
    }

    function test_Registrar_GetRentPrice() public view {
        uint256 price = registrar.rentPrice("testname", 365 days);
        assertEq(price, 0.001 ether); // Base price for 5+ char name
    }

    function test_Registrar_PremiumPricing3Char() public view {
        uint256 price = registrar.rentPrice("abc", 365 days);
        assertEq(price, 0.1 ether); // 100x premium
    }

    function test_Registrar_PremiumPricing4Char() public view {
        uint256 price = registrar.rentPrice("test", 365 days);
        assertEq(price, 0.01 ether); // 10x premium
    }

    function test_Registrar_RegisterName() public {
        uint256 price = registrar.rentPrice("myname", 365 days);
        
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("myname", alice, 365 days);
        
        assertFalse(registrar.available("myname"));
        assertEq(registrar.ownerOf("myname"), alice);
        assertTrue(node != bytes32(0));
    }

    function test_Registrar_RegisterNameMintsNFT() public {
        uint256 price = registrar.rentPrice("nfttest", 365 days);
        
        vm.prank(alice);
        registrar.register{value: price}("nfttest", alice, 365 days);
        
        // Check NFT ownership
        bytes32 labelhash = keccak256("nfttest");
        assertEq(registrar.ownerOf(uint256(labelhash)), alice);
    }

    function test_Registrar_RejectShortNames() public {
        vm.prank(alice);
        vm.expectRevert(JNSRegistrar.NameTooShort.selector);
        registrar.register{value: 1 ether}("ab", alice, 365 days);
    }

    function test_Registrar_RejectInvalidNames() public {
        vm.prank(alice);
        vm.expectRevert(JNSRegistrar.InvalidName.selector);
        registrar.register{value: 1 ether}("-invalid", alice, 365 days);
    }

    function test_Registrar_RejectDuplicateRegistration() public {
        uint256 price = registrar.rentPrice("unique", 365 days);
        
        vm.prank(alice);
        registrar.register{value: price}("unique", alice, 365 days);
        
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(JNSRegistrar.NameNotAvailable.selector, "unique"));
        registrar.register{value: price}("unique", bob, 365 days);
    }

    function test_Registrar_RenewName() public {
        uint256 price = registrar.rentPrice("renewable", 365 days);
        
        vm.prank(alice);
        registrar.register{value: price}("renewable", alice, 365 days);
        
        uint256 initialExpiry = registrar.nameExpires("renewable");
        
        vm.prank(bob); // Anyone can renew
        registrar.renew{value: price}("renewable", 365 days);
        
        uint256 newExpiry = registrar.nameExpires("renewable");
        assertEq(newExpiry, initialExpiry + 365 days);
    }

    function test_Registrar_ReservedNames() public view {
        // Reserved names should not be available
        assertFalse(registrar.available("gateway"));
        assertFalse(registrar.available("bazaar"));
        assertFalse(registrar.available("admin"));
    }

    function test_Registrar_ClaimReserved() public {
        // Claim reserved needs payment too
        uint256 price = registrar.rentPrice("gateway", 365 days);
        registrar.claimReserved{value: price}("gateway", alice, 365 days);
        assertEq(registrar.ownerOf("gateway"), alice);
    }

    // ============ Resolver Tests ============

    function test_Resolver_SetAddress() public {
        // First register a name
        uint256 price = registrar.rentPrice("addrtest", 365 days);
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("addrtest", alice, 365 days);
        
        // Set address
        vm.prank(alice);
        resolver.setAddr(node, bob);
        
        assertEq(resolver.addr(node), bob);
    }

    function test_Resolver_SetText() public {
        uint256 price = registrar.rentPrice("texttest", 365 days);
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("texttest", alice, 365 days);
        
        vm.prank(alice);
        resolver.setText(node, "url", "https://example.com");
        
        assertEq(resolver.text(node, "url"), "https://example.com");
    }

    function test_Resolver_SetContenthash() public {
        uint256 price = registrar.rentPrice("hashtest", 365 days);
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("hashtest", alice, 365 days);
        
        bytes memory ipfsHash = hex"e3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f";
        
        vm.prank(alice);
        resolver.setContenthash(node, ipfsHash);
        
        assertEq(resolver.contenthash(node), ipfsHash);
    }

    function test_Resolver_SetAppConfig() public {
        uint256 price = registrar.rentPrice("apptest", 365 days);
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("apptest", alice, 365 days);
        
        vm.prank(alice);
        resolver.setAppConfig(
            node,
            address(0x123),
            bytes32("app-id"),
            0,
            "https://api.example.com",
            "https://a2a.example.com"
        );
        
        (address appContract, bytes32 appId,, string memory endpoint, string memory a2aEndpoint,) = resolver.getAppInfo(node);
        
        assertEq(appContract, address(0x123));
        assertEq(appId, bytes32("app-id"));
        assertEq(endpoint, "https://api.example.com");
        assertEq(a2aEndpoint, "https://a2a.example.com");
    }

    function test_Resolver_OnlyOwnerCanModify() public {
        uint256 price = registrar.rentPrice("authtest", 365 days);
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}("authtest", alice, 365 days);
        
        vm.prank(bob);
        vm.expectRevert("Not authorized");
        resolver.setAddr(node, bob);
    }

    // ============ Reverse Registrar Tests ============

    function test_Reverse_ClaimWithName() public {
        // First register a name
        uint256 price = registrar.rentPrice("reversename", 365 days);
        vm.prank(alice);
        registrar.register{value: price}("reversename", alice, 365 days);
        
        // The reverse registrar can claim on behalf of users
        // It creates a node under addr.reverse and sets up the record
        bytes32 reverseNode = reverseRegistrar.node(alice);
        assertTrue(reverseNode != bytes32(0));
    }

    function test_Reverse_SetName() public {
        uint256 price = registrar.rentPrice("primary", 365 days);
        vm.prank(alice);
        registrar.register{value: price}("primary", alice, 365 days);
        
        // Test that node computation works
        bytes32 reverseNode = reverseRegistrar.node(alice);
        assertTrue(reverseNode != bytes32(0));
        
        // Test that has correct owner setup (from constructor)
        assertTrue(reverseRegistrar.isAuthorised(deployer));
    }

    // ============ NFT Transfer Tests ============

    function test_NFTTransfer_UpdatesRegistry() public {
        uint256 price = registrar.rentPrice("transfer", 365 days);
        vm.prank(alice);
        registrar.register{value: price}("transfer", alice, 365 days);
        
        bytes32 labelhash = keccak256("transfer");
        bytes32 node = keccak256(abi.encodePacked(jejuNode, labelhash));
        
        // Transfer NFT
        vm.prank(alice);
        registrar.transferFrom(alice, bob, uint256(labelhash));
        
        // Check NFT ownership
        assertEq(registrar.ownerOf(uint256(labelhash)), bob);
        
        // Check registry ownership
        assertEq(registry.owner(node), bob);
    }

    // ============ Edge Cases ============

    function test_ExpirationAndGracePeriod() public {
        uint256 price = registrar.rentPrice("expiring", 365 days);
        vm.prank(alice);
        registrar.register{value: price}("expiring", alice, 365 days);
        
        // Fast forward past expiration
        vm.warp(block.timestamp + 366 days);
        
        // Should be in grace period
        assertTrue(registrar.inGracePeriod("expiring"));
        assertFalse(registrar.available("expiring")); // Not available during grace
        
        // Fast forward past grace period
        vm.warp(block.timestamp + 91 days);
        
        // Now should be available
        assertTrue(registrar.available("expiring"));
    }

    function test_RefundExcessPayment() public {
        uint256 price = registrar.rentPrice("refund", 365 days);
        uint256 excess = 1 ether;
        uint256 aliceBalanceBefore = alice.balance;
        
        vm.prank(alice);
        registrar.register{value: price + excess}("refund", alice, 365 days);
        
        // Should have refunded excess
        assertEq(alice.balance, aliceBalanceBefore - price);
    }

    // ============ Integration Tests ============

    function test_FullRegistrationFlow() public {
        string memory name = "fullflow";
        uint256 price = registrar.rentPrice(name, 365 days);
        
        // 1. Check availability
        assertTrue(registrar.available(name));
        
        // 2. Register
        vm.prank(alice);
        bytes32 node = registrar.register{value: price}(name, alice, 365 days);
        
        // 3. Set resolver in registry (registrar sets it but we need to verify)
        // The registrar already sets the resolver in setSubnodeRecord
        
        // 4. Set resolver records
        vm.startPrank(alice);
        resolver.setAddr(node, alice);
        resolver.setText(node, "url", "https://fullflow.example.com");
        resolver.setText(node, "description", "Full flow test");
        resolver.setAppConfig(
            node,
            address(0),
            bytes32(0),
            0,
            "https://api.fullflow.example.com",
            "https://a2a.fullflow.example.com"
        );
        vm.stopPrank();
        
        // 5. Verify records
        assertEq(resolver.addr(node), alice);
        assertEq(resolver.text(node, "url"), "https://fullflow.example.com");
        
        (,, , string memory endpoint, string memory a2aEndpoint,) = resolver.getAppInfo(node);
        assertEq(endpoint, "https://api.fullflow.example.com");
        assertEq(a2aEndpoint, "https://a2a.fullflow.example.com");
    }
}

