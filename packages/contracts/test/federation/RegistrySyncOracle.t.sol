// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RegistrySyncOracle} from "../../src/federation/RegistrySyncOracle.sol";

/**
 * @title RegistrySyncOracleTest
 * @notice Tests for cross-chain registry synchronization oracle
 *
 * Tests cover:
 * - Single update submission
 * - Batch update submission
 * - Entry-level updates
 * - Rate limiting
 * - Relayer authorization
 * - Cross-chain sync scenarios
 */
contract RegistrySyncOracleTest is Test {
    RegistrySyncOracle oracle;

    address owner;
    address relayer1;
    address relayer2;
    address unauthorized;

    uint256 constant CHAIN_ID_JEJU = 420690;
    uint256 constant CHAIN_ID_FORK1 = 420691;
    uint256 constant CHAIN_ID_FORK2 = 420692;
    uint256 constant CHAIN_ID_SOLANA = 1; // Wormhole Solana

    function setUp() public {
        owner = makeAddr("owner");
        relayer1 = makeAddr("relayer1");
        relayer2 = makeAddr("relayer2");
        unauthorized = makeAddr("unauthorized");

        // Start at a reasonable timestamp to avoid rate limit on first update
        vm.warp(100);

        vm.startPrank(owner);
        oracle = new RegistrySyncOracle();
        oracle.setRelayer(relayer1, true);
        oracle.setRelayer(relayer2, true);
        vm.stopPrank();
    }

    // ============ Basic Update Tests ============

    function test_SubmitUpdate() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));
        bytes32 merkleRoot = keccak256("merkle-root");

        vm.prank(relayer1);
        oracle.submitUpdate(
            CHAIN_ID_JEJU,
            RegistrySyncOracle.RegistryType.IDENTITY,
            registryAddress,
            1000, // entry count
            merkleRoot,
            12345 // block number
        );

        // Verify update stored
        RegistrySyncOracle.RegistryUpdate memory update =
            oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY);

        assertEq(update.sourceChainId, CHAIN_ID_JEJU);
        assertEq(uint8(update.registryType), uint8(RegistrySyncOracle.RegistryType.IDENTITY));
        assertEq(update.entryCount, 1000);
        assertEq(update.merkleRoot, merkleRoot);
        assertEq(update.blockNumber, 12345);
        assertEq(oracle.totalUpdates(), 1);
    }

    function test_SubmitUpdate_MultipleRegistryTypes() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.startPrank(relayer1);

        // Identity registry
        oracle.submitUpdate(
            CHAIN_ID_JEJU,
            RegistrySyncOracle.RegistryType.IDENTITY,
            registryAddress,
            100,
            keccak256("identity-root"),
            1000
        );

        // Wait for rate limit
        vm.warp(block.timestamp + 61);

        // Compute registry - different type, same chain
        oracle.submitUpdate(
            CHAIN_ID_JEJU,
            RegistrySyncOracle.RegistryType.COMPUTE,
            registryAddress,
            200,
            keccak256("compute-root"),
            1001
        );

        vm.stopPrank();

        // Verify both stored
        RegistrySyncOracle.RegistryUpdate memory identityUpdate =
            oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY);
        RegistrySyncOracle.RegistryUpdate memory computeUpdate =
            oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.COMPUTE);

        assertEq(identityUpdate.entryCount, 100);
        assertEq(computeUpdate.entryCount, 200);
        assertEq(oracle.totalUpdates(), 2);
    }

    // ============ Cross-Chain Sync Tests ============

    function test_CrossChainSync_MultipleNetworks() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.startPrank(relayer1);

        // Jeju mainnet
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 1000, keccak256("jeju-root"), 100
        );

        // Fork network 1
        oracle.submitUpdate(
            CHAIN_ID_FORK1, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 500, keccak256("fork1-root"), 50
        );

        // Fork network 2
        oracle.submitUpdate(
            CHAIN_ID_FORK2, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 250, keccak256("fork2-root"), 25
        );

        // Solana (cross-ecosystem)
        oracle.submitUpdate(
            CHAIN_ID_SOLANA,
            RegistrySyncOracle.RegistryType.IDENTITY,
            bytes32(uint256(0x123456)), // Solana program ID
            2000,
            keccak256("solana-root"),
            200
        );

        vm.stopPrank();

        // Verify all networks synced
        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 1000);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_FORK1, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 500);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_FORK2, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 250);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_SOLANA, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 2000);
        assertEq(oracle.totalUpdates(), 4);
    }

    // ============ Batch Update Tests ============

    function test_SubmitBatchUpdates() public {
        RegistrySyncOracle.RegistryType[] memory types = new RegistrySyncOracle.RegistryType[](4);
        types[0] = RegistrySyncOracle.RegistryType.IDENTITY;
        types[1] = RegistrySyncOracle.RegistryType.COMPUTE;
        types[2] = RegistrySyncOracle.RegistryType.STORAGE;
        types[3] = RegistrySyncOracle.RegistryType.SOLVER;

        bytes32[] memory addresses = new bytes32[](4);
        addresses[0] = bytes32(uint256(1));
        addresses[1] = bytes32(uint256(2));
        addresses[2] = bytes32(uint256(3));
        addresses[3] = bytes32(uint256(4));

        uint256[] memory counts = new uint256[](4);
        counts[0] = 100;
        counts[1] = 200;
        counts[2] = 300;
        counts[3] = 400;

        bytes32[] memory roots = new bytes32[](4);
        roots[0] = keccak256("root1");
        roots[1] = keccak256("root2");
        roots[2] = keccak256("root3");
        roots[3] = keccak256("root4");

        vm.prank(relayer1);
        oracle.submitBatchUpdates(CHAIN_ID_JEJU, types, addresses, counts, roots, 1000);

        // Verify all updates stored
        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 100);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.COMPUTE).entryCount, 200);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.STORAGE).entryCount, 300);
        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.SOLVER).entryCount, 400);
        assertEq(oracle.totalUpdates(), 4);
    }

    function test_SubmitBatchUpdates_RevertOnMismatchedArrays() public {
        RegistrySyncOracle.RegistryType[] memory types = new RegistrySyncOracle.RegistryType[](2);
        types[0] = RegistrySyncOracle.RegistryType.IDENTITY;
        types[1] = RegistrySyncOracle.RegistryType.COMPUTE;

        bytes32[] memory addresses = new bytes32[](1); // Mismatched length
        addresses[0] = bytes32(uint256(1));

        uint256[] memory counts = new uint256[](2);
        counts[0] = 100;
        counts[1] = 200;

        bytes32[] memory roots = new bytes32[](2);
        roots[0] = keccak256("root1");
        roots[1] = keccak256("root2");

        vm.prank(relayer1);
        vm.expectRevert(RegistrySyncOracle.InvalidUpdate.selector);
        oracle.submitBatchUpdates(CHAIN_ID_JEJU, types, addresses, counts, roots, 1000);
    }

    // ============ Entry Update Tests ============

    function test_SubmitEntryUpdate() public {
        bytes32 updateId = oracle.computeUpdateId(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, 1000);
        bytes32 entryId = keccak256("entry-1");
        bytes32 originId = keccak256("origin-1");

        vm.prank(relayer1);
        oracle.submitEntryUpdate(updateId, entryId, originId, "Test Agent", "ipfs://metadata", true);

        RegistrySyncOracle.EntryUpdate memory entry = oracle.getEntryUpdate(entryId);

        assertEq(entry.updateId, updateId);
        assertEq(entry.entryId, entryId);
        assertEq(entry.originId, originId);
        assertEq(entry.name, "Test Agent");
        assertEq(entry.metadataUri, "ipfs://metadata");
        assertTrue(entry.isActive);
        assertEq(oracle.totalEntryUpdates(), 1);
    }

    function test_SubmitBatchEntryUpdates() public {
        bytes32 updateId = oracle.computeUpdateId(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, 1000);

        bytes32[] memory entryIds = new bytes32[](3);
        entryIds[0] = keccak256("entry-1");
        entryIds[1] = keccak256("entry-2");
        entryIds[2] = keccak256("entry-3");

        bytes32[] memory originIds = new bytes32[](3);
        originIds[0] = keccak256("origin-1");
        originIds[1] = keccak256("origin-2");
        originIds[2] = keccak256("origin-3");

        string[] memory names = new string[](3);
        names[0] = "Agent 1";
        names[1] = "Agent 2";
        names[2] = "Agent 3";

        string[] memory uris = new string[](3);
        uris[0] = "ipfs://1";
        uris[1] = "ipfs://2";
        uris[2] = "ipfs://3";

        bool[] memory isActives = new bool[](3);
        isActives[0] = true;
        isActives[1] = true;
        isActives[2] = false;

        vm.prank(relayer1);
        oracle.submitBatchEntryUpdates(updateId, entryIds, originIds, names, uris, isActives);

        // Verify all entries stored
        assertEq(oracle.getEntryUpdate(entryIds[0]).name, "Agent 1");
        assertEq(oracle.getEntryUpdate(entryIds[1]).name, "Agent 2");
        assertEq(oracle.getEntryUpdate(entryIds[2]).name, "Agent 3");
        assertFalse(oracle.getEntryUpdate(entryIds[2]).isActive);
        assertEq(oracle.totalEntryUpdates(), 3);
    }

    // ============ Rate Limiting Tests ============

    function test_RateLimiting() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.startPrank(relayer1);

        // First update succeeds
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root1"), 1000
        );

        // Immediate second update fails (too soon)
        vm.expectRevert(RegistrySyncOracle.TooSoon.selector);
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("root2"), 1001
        );

        // Wait for rate limit
        vm.warp(block.timestamp + 61);

        // Now it succeeds
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("root2"), 1001
        );

        vm.stopPrank();

        assertEq(oracle.getLatestUpdate(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY).entryCount, 200);
    }

    function test_RateLimiting_DifferentChainsNotAffected() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.startPrank(relayer1);

        // Update chain 1
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root1"), 1000
        );

        // Immediate update to different chain succeeds
        oracle.submitUpdate(
            CHAIN_ID_FORK1, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("root2"), 1001
        );

        vm.stopPrank();

        assertEq(oracle.totalUpdates(), 2);
    }

    function test_SetSyncInterval() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        // Owner sets shorter interval
        vm.prank(owner);
        oracle.setSyncInterval(30); // 30 seconds

        vm.startPrank(relayer1);

        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root1"), 1000
        );

        // 31 seconds later
        vm.warp(block.timestamp + 31);

        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("root2"), 1001
        );

        vm.stopPrank();

        assertEq(oracle.totalUpdates(), 2);
    }

    // ============ Authorization Tests ============

    function test_RevertWhen_UnauthorizedRelayer() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.prank(unauthorized);
        vm.expectRevert(RegistrySyncOracle.NotRelayer.selector);
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root"), 1000
        );
    }

    function test_RelayerManagement() public {
        address newRelayer = makeAddr("newRelayer");
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        // Initially unauthorized
        vm.prank(newRelayer);
        vm.expectRevert(RegistrySyncOracle.NotRelayer.selector);
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root"), 1000
        );

        // Authorize
        vm.prank(owner);
        oracle.setRelayer(newRelayer, true);

        // Now succeeds
        vm.prank(newRelayer);
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("root"), 1000
        );

        // Revoke
        vm.prank(owner);
        oracle.setRelayer(newRelayer, false);

        // Wait for rate limit
        vm.warp(block.timestamp + 61);

        // Fails again
        vm.prank(newRelayer);
        vm.expectRevert(RegistrySyncOracle.NotRelayer.selector);
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("root2"), 1001
        );
    }

    // ============ View Function Tests ============

    function test_ComputeUpdateId() public view {
        bytes32 id1 = oracle.computeUpdateId(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, 1000);
        bytes32 id2 = oracle.computeUpdateId(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, 1000);
        bytes32 id3 = oracle.computeUpdateId(CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, 1001);
        bytes32 id4 = oracle.computeUpdateId(CHAIN_ID_FORK1, RegistrySyncOracle.RegistryType.IDENTITY, 1000);

        // Same inputs = same ID
        assertEq(id1, id2);
        // Different block = different ID
        assertTrue(id1 != id3);
        // Different chain = different ID
        assertTrue(id1 != id4);
    }

    function test_GetRecentUpdates() public {
        bytes32 registryAddress = bytes32(uint256(uint160(address(0x1234))));

        vm.startPrank(relayer1);

        // Create multiple updates across chains
        oracle.submitUpdate(
            CHAIN_ID_JEJU, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 100, keccak256("1"), 1
        );
        oracle.submitUpdate(
            CHAIN_ID_FORK1, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 200, keccak256("2"), 2
        );
        oracle.submitUpdate(
            CHAIN_ID_FORK2, RegistrySyncOracle.RegistryType.IDENTITY, registryAddress, 300, keccak256("3"), 3
        );

        vm.stopPrank();

        // Get recent 2
        bytes32[] memory recent = oracle.getRecentUpdates(2);
        assertEq(recent.length, 2);

        // Get all
        bytes32[] memory all = oracle.getAllUpdateIds();
        assertEq(all.length, 3);
    }

    function test_Version() public view {
        assertEq(oracle.version(), "1.0.0");
    }
}
