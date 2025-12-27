// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/moderation/UserBlockRegistry.sol";
import "../../src/registry/IdentityRegistry.sol";

contract UserBlockRegistryTest is Test {
    UserBlockRegistry public registry;
    IdentityRegistry public identityRegistry;

    address public alice = address(1);
    address public bob = address(2);
    address public charlie = address(3);

    uint256 public aliceAgentId;
    uint256 public bobAgentId;
    uint256 public charlieAgentId;

    event AddressBlocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AddressUnblocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AgentBlocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);
    event AgentUnblocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);

    function setUp() public {
        // Deploy identity registry
        identityRegistry = new IdentityRegistry();

        // Deploy block registry
        registry = new UserBlockRegistry(address(identityRegistry));

        // Register agents for each user
        vm.prank(alice);
        aliceAgentId = identityRegistry.register("ipfs://alice");

        vm.prank(bob);
        bobAgentId = identityRegistry.register("ipfs://bob");

        vm.prank(charlie);
        charlieAgentId = identityRegistry.register("ipfs://charlie");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         ADDRESS BLOCKING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_BlockAddress() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AddressBlocked(alice, bob, block.timestamp);
        registry.blockAddress(bob);

        assertTrue(registry.isAddressBlocked(alice, bob));
        assertFalse(registry.isAddressBlocked(bob, alice));
        assertEq(registry.blockCount(alice), 1);
    }

    function test_BlockAddress_ChecksInteraction() public {
        vm.prank(alice);
        registry.blockAddress(bob);

        // Bob trying to interact with Alice should be blocked
        assertTrue(registry.isInteractionBlocked(bob, alice));
        // Alice trying to interact with Bob should NOT be blocked
        assertFalse(registry.isInteractionBlocked(alice, bob));
    }

    function test_BlockAddress_CannotBlockSelf() public {
        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.CannotBlockSelf.selector);
        registry.blockAddress(alice);
    }

    function test_BlockAddress_CannotBlockZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.InvalidAddress.selector);
        registry.blockAddress(address(0));
    }

    function test_BlockAddress_CannotBlockTwice() public {
        vm.prank(alice);
        registry.blockAddress(bob);

        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.AlreadyBlocked.selector);
        registry.blockAddress(bob);
    }

    function test_UnblockAddress() public {
        vm.prank(alice);
        registry.blockAddress(bob);
        assertTrue(registry.isAddressBlocked(alice, bob));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AddressUnblocked(alice, bob, block.timestamp);
        registry.unblockAddress(bob);

        assertFalse(registry.isAddressBlocked(alice, bob));
        assertEq(registry.blockCount(alice), 0);
    }

    function test_UnblockAddress_NotBlocked() public {
        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.NotBlocked.selector);
        registry.unblockAddress(bob);
    }

    function test_BlockAddresses_Batch() public {
        address[] memory toBlock = new address[](2);
        toBlock[0] = bob;
        toBlock[1] = charlie;

        vm.prank(alice);
        registry.blockAddresses(toBlock);

        assertTrue(registry.isAddressBlocked(alice, bob));
        assertTrue(registry.isAddressBlocked(alice, charlie));
        assertEq(registry.blockCount(alice), 2);
    }

    function test_BlockAddresses_SkipsDuplicates() public {
        vm.prank(alice);
        registry.blockAddress(bob);

        address[] memory toBlock = new address[](2);
        toBlock[0] = bob; // Already blocked
        toBlock[1] = charlie;

        vm.prank(alice);
        registry.blockAddresses(toBlock);

        assertEq(registry.blockCount(alice), 2); // Only charlie was added
    }

    function test_GetBlockedAddresses() public {
        vm.prank(alice);
        registry.blockAddress(bob);
        vm.prank(alice);
        registry.blockAddress(charlie);

        address[] memory blocked = registry.getBlockedAddresses(alice);
        assertEq(blocked.length, 2);
        assertTrue(blocked[0] == bob || blocked[1] == bob);
        assertTrue(blocked[0] == charlie || blocked[1] == charlie);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         AGENT BLOCKING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_BlockAgent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AgentBlocked(aliceAgentId, bobAgentId, block.timestamp);
        registry.blockAgent(aliceAgentId, bobAgentId);

        assertTrue(registry.isAgentBlocked(aliceAgentId, bobAgentId));
        assertFalse(registry.isAgentBlocked(bobAgentId, aliceAgentId));
        assertEq(registry.agentBlockCount(aliceAgentId), 1);
    }

    function test_BlockAgent_ChecksInteraction() public {
        vm.prank(alice);
        registry.blockAgent(aliceAgentId, bobAgentId);

        // Bob's agent trying to interact with Alice's agent should be blocked
        assertTrue(registry.isAgentInteractionBlocked(bobAgentId, aliceAgentId));
        // Alice's agent trying to interact with Bob's agent should NOT be blocked
        assertFalse(registry.isAgentInteractionBlocked(aliceAgentId, bobAgentId));
    }

    function test_BlockAgent_CannotBlockSelf() public {
        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.CannotBlockSelf.selector);
        registry.blockAgent(aliceAgentId, aliceAgentId);
    }

    function test_BlockAgent_OnlyOwnerCanBlock() public {
        vm.prank(bob); // Bob doesn't own Alice's agent
        vm.expectRevert(UserBlockRegistry.NotAgentOwner.selector);
        registry.blockAgent(aliceAgentId, bobAgentId);
    }

    function test_UnblockAgent() public {
        vm.prank(alice);
        registry.blockAgent(aliceAgentId, bobAgentId);
        assertTrue(registry.isAgentBlocked(aliceAgentId, bobAgentId));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AgentUnblocked(aliceAgentId, bobAgentId, block.timestamp);
        registry.unblockAgent(aliceAgentId, bobAgentId);

        assertFalse(registry.isAgentBlocked(aliceAgentId, bobAgentId));
        assertEq(registry.agentBlockCount(aliceAgentId), 0);
    }

    function test_GetBlockedAgents() public {
        vm.prank(alice);
        registry.blockAgent(aliceAgentId, bobAgentId);
        vm.prank(alice);
        registry.blockAgent(aliceAgentId, charlieAgentId);

        uint256[] memory blocked = registry.getBlockedAgents(aliceAgentId);
        assertEq(blocked.length, 2);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         COMBINED CHECKING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_IsAnyBlockActive_AddressOnly() public {
        vm.prank(alice);
        registry.blockAddress(bob);

        assertTrue(registry.isAnyBlockActive(bob, alice, 0, 0));
        assertFalse(registry.isAnyBlockActive(alice, bob, 0, 0));
    }

    function test_IsAnyBlockActive_AgentOnly() public {
        vm.prank(alice);
        registry.blockAgent(aliceAgentId, bobAgentId);

        assertTrue(registry.isAnyBlockActive(address(0), address(0), bobAgentId, aliceAgentId));
        assertFalse(registry.isAnyBlockActive(address(0), address(0), aliceAgentId, bobAgentId));
    }

    function test_IsAnyBlockActive_Mixed() public {
        vm.prank(alice);
        registry.blockAddress(bob);

        // Even with agentIds provided, address block should still trigger
        assertTrue(registry.isAnyBlockActive(bob, alice, bobAgentId, aliceAgentId));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         MAX BLOCKS TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_MaxBlocks() public {
        // Block MAX_BLOCKS_PER_USER addresses
        uint256 max = registry.MAX_BLOCKS_PER_USER();

        vm.startPrank(alice);
        for (uint256 i = 0; i < max; i++) {
            address toBlock = address(uint160(1000 + i));
            registry.blockAddress(toBlock);
        }
        vm.stopPrank();

        assertEq(registry.blockCount(alice), max);

        // Next block should fail
        vm.prank(alice);
        vm.expectRevert(UserBlockRegistry.MaxBlocksReached.selector);
        registry.blockAddress(address(uint160(2000)));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         PAGINATION TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_GetBlockedAddressesPaginated() public {
        // Block 5 addresses
        vm.startPrank(alice);
        for (uint256 i = 0; i < 5; i++) {
            registry.blockAddress(address(uint160(100 + i)));
        }
        vm.stopPrank();

        // Get first 3
        address[] memory first3 = registry.getBlockedAddressesPaginated(alice, 0, 3);
        assertEq(first3.length, 3);

        // Get next 3 (should only be 2)
        address[] memory next3 = registry.getBlockedAddressesPaginated(alice, 3, 3);
        assertEq(next3.length, 2);

        // Get out of bounds
        address[] memory outOfBounds = registry.getBlockedAddressesPaginated(alice, 10, 3);
        assertEq(outOfBounds.length, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                         VERSION TEST
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }
}
