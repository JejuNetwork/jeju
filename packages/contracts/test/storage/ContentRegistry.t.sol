// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ContentRegistry} from "../../src/storage/ContentRegistry.sol";
import {IContentRegistry} from "../../src/storage/IContentRegistry.sol";

contract ContentRegistryTest is Test {
    ContentRegistry public registry;

    address public owner = address(1);
    address public uploader = address(2);
    address public seeder = address(3);
    address public reporter = address(4);
    address public treasury = address(6);

    // Use actual keypair for oracle
    uint256 public oraclePrivateKey = 0xA11CE;
    address public oracle;

    bytes32 public contentHash = keccak256("test content");
    bytes32 public infohash = keccak256("test infohash");
    uint64 public contentSize = 1024 * 1024; // 1 MB

    function setUp() public {
        // Derive oracle address from private key
        oracle = vm.addr(oraclePrivateKey);

        vm.deal(owner, 100 ether);
        vm.deal(uploader, 100 ether);
        vm.deal(seeder, 100 ether);
        vm.deal(reporter, 100 ether);

        vm.prank(owner);
        registry = new ContentRegistry(owner);

        vm.prank(owner);
        registry.setSeedingOracle(oracle);

        vm.prank(owner);
        registry.setTreasury(treasury);
    }

    // ============ Content Registration Tests ============

    function test_RegisterContent() public {
        uint128 rewardPool = 0.05 ether;

        vm.prank(uploader);
        IContentRegistry.ContentStatus status = registry.registerContent{value: rewardPool}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        assertEq(uint8(status), uint8(IContentRegistry.ContentStatus.APPROVED));

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(record.contentHash, contentHash);
        assertEq(record.uploader, uploader);
        assertEq(record.size, contentSize);
        assertEq(record.rewardPool, rewardPool);
        assertEq(uint8(record.tier), uint8(IContentRegistry.ContentTier.STANDARD));
    }

    function test_RegisterContent_NetworkFree() public {
        vm.prank(uploader);
        IContentRegistry.ContentStatus status = registry.registerContent(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.NETWORK_FREE
        );

        assertEq(uint8(status), uint8(IContentRegistry.ContentStatus.APPROVED));

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(record.rewardPool, 0);
    }

    function test_RevertWhen_DuplicateRegistration() public {
        uint128 rewardPool = 0.05 ether;

        vm.prank(uploader);
        registry.registerContent{value: rewardPool}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(uploader);
        vm.expectRevert("Already registered");
        registry.registerContent{value: rewardPool}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );
    }

    // ============ Moderation Tests ============

    function test_FlagContent() public {
        // Register content first
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        // Flag it
        bytes32 evidenceHash = keccak256("evidence");
        vm.prank(reporter);
        registry.flagContent(contentHash, IContentRegistry.ViolationType.COPYRIGHT, evidenceHash);

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(uint8(record.status), uint8(IContentRegistry.ContentStatus.FLAGGED));
        assertEq(uint8(record.violationType), uint8(IContentRegistry.ViolationType.COPYRIGHT));
    }

    function test_FlagContent_CSAM_AutoBan() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        bytes32 evidenceHash = keccak256("evidence");
        vm.prank(reporter);
        registry.flagContent(contentHash, IContentRegistry.ViolationType.CSAM, evidenceHash);

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(uint8(record.status), uint8(IContentRegistry.ContentStatus.BANNED));
        assertTrue(registry.isBlocked(contentHash));
    }

    function test_BanContent() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        // Flag first
        vm.prank(reporter);
        registry.flagContent(contentHash, IContentRegistry.ViolationType.SPAM, keccak256("evidence"));

        // Ban
        vm.prank(owner);
        registry.banContent(contentHash);

        assertTrue(registry.isBlocked(contentHash));
        assertFalse(registry.canServe(contentHash));
    }

    function test_ClearContent() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(reporter);
        registry.flagContent(contentHash, IContentRegistry.ViolationType.COPYRIGHT, keccak256("evidence"));

        vm.prank(owner);
        registry.clearContent(contentHash);

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(uint8(record.status), uint8(IContentRegistry.ContentStatus.APPROVED));
    }

    // ============ Seeding Tests ============

    function test_StartSeeding() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(seeder);
        registry.startSeeding(infohash);

        assertTrue(registry.isSeeding(infohash, seeder));

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(record.seedCount, 1);
    }

    function test_StopSeeding() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(seeder);
        registry.startSeeding(infohash);

        vm.prank(seeder);
        registry.stopSeeding(infohash);

        assertFalse(registry.isSeeding(infohash, seeder));

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(record.seedCount, 0);
    }

    function test_ReportSeeding() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(seeder);
        registry.startSeeding(infohash);

        // Create oracle signature
        uint128 bytesServed = 1024 * 1024 * 100; // 100 MB
        bytes32 messageHash = keccak256(
            abi.encodePacked(seeder, infohash, bytesServed, block.timestamp / 3600)
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(seeder);
        registry.reportSeeding(infohash, bytesServed, signature);

        IContentRegistry.SeederStats memory stats = registry.getSeederStats(seeder);
        assertTrue(stats.pendingRewards > 0);
        assertEq(stats.totalBytesServed, bytesServed);
    }

    function test_ClaimRewards() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.1 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(seeder);
        registry.startSeeding(infohash);

        // Report seeding
        uint128 bytesServed = 1024 * 1024 * 1024; // 1 GB
        bytes32 messageHash = keccak256(
            abi.encodePacked(seeder, infohash, bytesServed, block.timestamp / 3600)
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(seeder);
        registry.reportSeeding(infohash, bytesServed, signature);

        uint256 balanceBefore = seeder.balance;

        vm.prank(seeder);
        registry.claimRewards();

        uint256 balanceAfter = seeder.balance;
        assertTrue(balanceAfter > balanceBefore);

        IContentRegistry.SeederStats memory stats = registry.getSeederStats(seeder);
        assertEq(stats.pendingRewards, 0);
    }

    // ============ Blocklist Tests ============

    function test_GetBlocklist() public {
        // Ban some content
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        vm.prank(owner);
        registry.addToBlocklist(contentHash);

        assertEq(registry.getBlocklistLength(), 1);

        bytes32[] memory batch = registry.getBlocklistBatch(0, 10);
        assertEq(batch.length, 1);
        assertEq(batch[0], contentHash);
    }

    // ============ View Function Tests ============

    function test_CanServe() public {
        assertTrue(registry.canServe(contentHash)); // Unknown content can be served

        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        assertTrue(registry.canServe(contentHash)); // Approved content can be served

        vm.prank(owner);
        registry.addToBlocklist(contentHash);

        assertFalse(registry.canServe(contentHash)); // Blocked content cannot be served
    }

    function test_GetRewardRate() public view {
        uint128 standardRate = registry.getRewardRate(IContentRegistry.ContentTier.STANDARD);
        uint128 premiumRate = registry.getRewardRate(IContentRegistry.ContentTier.PREMIUM_HOT);

        assertTrue(premiumRate > standardRate);
        assertEq(registry.getRewardRate(IContentRegistry.ContentTier.NETWORK_FREE), 0);
    }

    // ============ Admin Tests ============

    function test_SetRewardRate() public {
        uint128 newRate = 0.01 ether;

        vm.prank(owner);
        registry.setRewardRate(IContentRegistry.ContentTier.STANDARD, newRate);

        assertEq(registry.getRewardRate(IContentRegistry.ContentTier.STANDARD), newRate);
    }

    function test_TopUpRewardPool() public {
        vm.prank(uploader);
        registry.registerContent{value: 0.05 ether}(
            contentHash,
            infohash,
            contentSize,
            IContentRegistry.ContentTier.STANDARD
        );

        uint128 topUp = 0.1 ether;
        vm.prank(uploader);
        registry.topUpRewardPool{value: topUp}(contentHash);

        IContentRegistry.ContentRecord memory record = registry.getContent(contentHash);
        assertEq(record.rewardPool, 0.15 ether);
    }
}
