// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/moderation/UserBlockRegistry.sol";
import "../../src/tokens/Token.sol";
import "../../src/messaging/MessagingKeyRegistry.sol";
import "../../src/registry/IdentityRegistry.sol";

/**
 * @title BlockingIntegrationTest
 * @notice Integration tests for the blocking system across multiple contracts
 */
contract BlockingIntegrationTest is Test {
    UserBlockRegistry public blockRegistry;
    Token public token;
    MessagingKeyRegistry public messagingRegistry;
    IdentityRegistry public identityRegistry;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xC4417);
    address public owner = address(this);

    uint256 public aliceAgentId;
    uint256 public bobAgentId;

    function setUp() public {
        // Deploy identity registry first
        identityRegistry = new IdentityRegistry();

        // Deploy block registry
        blockRegistry = new UserBlockRegistry(address(identityRegistry));

        // Register agents
        vm.prank(alice);
        aliceAgentId = identityRegistry.register("ipfs://alice");

        vm.prank(bob);
        bobAgentId = identityRegistry.register("ipfs://bob");

        // Deploy token
        token = new Token(
            "Test Token",
            "TEST",
            1000000e18,
            owner,
            0, // maxSupply (0 = unlimited)
            true // isHomeChain
        );
        // Enable ban enforcement: setConfig(maxWalletBps, maxTxBps, banEnabled, paused, faucetEnabled)
        token.setConfig(0, 0, true, false, false);

        // Set block registry on token
        token.setBlockRegistry(address(blockRegistry));

        // Deploy messaging registry
        messagingRegistry = new MessagingKeyRegistry();
        messagingRegistry.setBlockRegistry(address(blockRegistry));

        // Give tokens to alice and bob
        token.transfer(alice, 10000e18);
        token.transfer(bob, 10000e18);
    }

    // ============ Token Transfer Blocking Tests ============

    function test_TokenTransfer_NotBlockedByDefault() public {
        vm.prank(alice);
        token.transfer(bob, 100e18);

        assertEq(token.balanceOf(bob), 10100e18);
    }

    function test_TokenTransfer_BlockedWhenRecipientBlocksSender() public {
        // Bob blocks Alice
        vm.prank(bob);
        blockRegistry.blockAddress(alice);

        // Alice tries to transfer to Bob - should fail
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Token.UserBlocked.selector, alice, bob));
        token.transfer(bob, 100e18);
    }

    function test_TokenTransfer_AllowedAfterUnblock() public {
        // Bob blocks Alice
        vm.prank(bob);
        blockRegistry.blockAddress(alice);

        // Bob unblocks Alice
        vm.prank(bob);
        blockRegistry.unblockAddress(alice);

        // Now Alice can transfer to Bob
        vm.prank(alice);
        token.transfer(bob, 100e18);
        assertEq(token.balanceOf(bob), 10100e18);
    }

    function test_TokenTransfer_BlockIsDirectional() public {
        // Bob blocks Alice
        vm.prank(bob);
        blockRegistry.blockAddress(alice);

        // Bob can still transfer to Alice (block is from Alice TO Bob)
        vm.prank(bob);
        token.transfer(alice, 100e18);
        assertEq(token.balanceOf(alice), 10100e18);
    }

    // ============ Agent-Based Blocking Tests ============

    function test_AgentBlock_BlocksByAgentId() public {
        // Bob's agent blocks Alice's agent
        vm.prank(bob);
        blockRegistry.blockAgent(bobAgentId, aliceAgentId);

        assertTrue(blockRegistry.isAgentBlocked(bobAgentId, aliceAgentId));

        // Check interaction blocked
        assertTrue(blockRegistry.isAgentInteractionBlocked(aliceAgentId, bobAgentId));
    }

    function test_AgentBlock_UnblocksByAgentId() public {
        vm.prank(bob);
        blockRegistry.blockAgent(bobAgentId, aliceAgentId);

        vm.prank(bob);
        blockRegistry.unblockAgent(bobAgentId, aliceAgentId);

        assertFalse(blockRegistry.isAgentBlocked(bobAgentId, aliceAgentId));
    }

    // ============ Mixed Address and Agent Blocking ============

    function test_IsAnyBlockActive_Mixed() public {
        // Block by address
        vm.prank(bob);
        blockRegistry.blockAddress(alice);

        // Check via isAnyBlockActive
        assertTrue(blockRegistry.isAnyBlockActive(alice, bob, 0, 0));

        // Unblock
        vm.prank(bob);
        blockRegistry.unblockAddress(alice);
        assertFalse(blockRegistry.isAnyBlockActive(alice, bob, 0, 0));

        // Block by agent
        vm.prank(bob);
        blockRegistry.blockAgent(bobAgentId, aliceAgentId);
        assertTrue(blockRegistry.isAnyBlockActive(address(0), address(0), aliceAgentId, bobAgentId));
    }

    // ============ Batch Operations ============

    function test_BlockAddresses_Batch() public {
        address[] memory targets = new address[](3);
        targets[0] = address(0x1);
        targets[1] = address(0x2);
        targets[2] = address(0x3);

        vm.prank(alice);
        blockRegistry.blockAddresses(targets);

        for (uint256 i = 0; i < targets.length; i++) {
            assertTrue(blockRegistry.isAddressBlocked(alice, targets[i]));
        }

        address[] memory blocked = blockRegistry.getBlockedAddresses(alice);
        assertEq(blocked.length, 3);
    }

    // ============ View Function Tests ============

    function test_GetBlockedAddresses() public {
        vm.prank(alice);
        blockRegistry.blockAddress(bob);

        vm.prank(alice);
        blockRegistry.blockAddress(charlie);

        address[] memory blocked = blockRegistry.getBlockedAddresses(alice);
        assertEq(blocked.length, 2);
    }

    function test_Version() public view {
        assertEq(blockRegistry.version(), "1.0.0");
    }
}
