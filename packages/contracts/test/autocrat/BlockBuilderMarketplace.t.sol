// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/autocrat/BlockBuilderMarketplace.sol";

// Mock Identity Registry for testing
contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => bool) public exists;
    mapping(uint256 => bool) public banned;
    uint256 public nextId = 1;

    function createAgent(address owner) external returns (uint256) {
        uint256 id = nextId++;
        owners[id] = owner;
        exists[id] = true;
        return id;
    }

    function banAgent(uint256 agentId) external {
        banned[agentId] = true;
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return exists[agentId];
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function getAgent(uint256 agentId) external view returns (IIdentityRegistry.AgentRegistration memory) {
        return IIdentityRegistry.AgentRegistration({
            agentId: agentId,
            owner: owners[agentId],
            tier: IIdentityRegistry.StakeTier.MEDIUM,
            stakedToken: address(0),
            stakedAmount: 10 ether,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            isBanned: banned[agentId],
            isSlashed: false
        });
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }
}

// Mock Reputation Registry for testing
contract MockReputationRegistry {
    mapping(uint256 => uint8) public reputationScores;

    function setReputation(uint256 agentId, uint8 score) external {
        reputationScores[agentId] = score;
    }

    function getSummary(uint256 agentId, address[] calldata, bytes32, bytes32) external view returns (uint64, uint8) {
        return (10, reputationScores[agentId] > 0 ? reputationScores[agentId] : 75);
    }
}

contract BlockBuilderMarketplaceTest is Test {
    BlockBuilderMarketplace public marketplace;
    MockIdentityRegistry public identityRegistry;
    MockReputationRegistry public reputationRegistry;

    address public admin = address(0x1);
    address public sequencer = address(0x2);
    address public treasuryAddr = address(0x3);
    address public builder1 = address(0x4);
    address public builder2 = address(0x5);
    address public attacker = address(0x6);

    uint256 public agentId1;
    uint256 public agentId2;

    uint256 constant MIN_BID = 0.001 ether;
    uint256 constant BRONZE_STAKE = 1 ether;
    uint256 constant SILVER_STAKE = 5 ether;
    uint256 constant GOLD_STAKE = 25 ether;
    uint256 constant PLATINUM_STAKE = 100 ether;

    function setUp() public {
        // Deploy mock registries
        identityRegistry = new MockIdentityRegistry();
        reputationRegistry = new MockReputationRegistry();

        // Register agents
        vm.prank(builder1);
        agentId1 = identityRegistry.createAgent(builder1);

        vm.prank(builder2);
        agentId2 = identityRegistry.createAgent(builder2);

        // Set reputation
        reputationRegistry.setReputation(agentId1, 85);
        reputationRegistry.setReputation(agentId2, 60);

        // Deploy marketplace
        vm.prank(admin);
        marketplace = new BlockBuilderMarketplace(
            address(identityRegistry), address(reputationRegistry), treasuryAddr, sequencer, admin
        );

        // Fund builders
        vm.deal(builder1, 200 ether);
        vm.deal(builder2, 200 ether);
    }

    // =========================================================================
    // Registration Tests
    // =========================================================================

    function test_RegisterBuilder() public {
        vm.prank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        (
            uint256 agentId,
            address owner,
            BlockBuilderMarketplace.AccessTier tier,
            uint256 stakeAmount,
            ,
            ,
            ,
            ,
            ,
            ,
            , // 7 skipped: submitted, included, failed, feePaid, slashed, registeredAt, lastActivityAt
            bool isActive,
            // isSlashed
        ) = marketplace.builders(agentId1);

        assertEq(agentId, agentId1);
        assertEq(owner, builder1);
        assertEq(stakeAmount, GOLD_STAKE);
        assertTrue(isActive);
        assertTrue(uint8(tier) > 0); // At least BRONZE tier
    }

    function testRevert_RegisterBuilder_AlreadyRegistered() public {
        vm.prank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        vm.prank(builder1);
        vm.expectRevert(BlockBuilderMarketplace.BuilderAlreadyRegistered.selector);
        marketplace.registerBuilder{value: 1 ether}(agentId1);
    }

    function testRevert_RegisterBuilder_NotAgentOwner() public {
        vm.prank(builder2);
        vm.expectRevert(BlockBuilderMarketplace.NotAgentOwner.selector);
        marketplace.registerBuilder{value: 1 ether}(agentId1); // agentId1 owned by builder1
    }

    function testRevert_RegisterBuilder_AgentBanned() public {
        identityRegistry.banAgent(agentId1);

        vm.prank(builder1);
        vm.expectRevert(BlockBuilderMarketplace.AgentBanned.selector);
        marketplace.registerBuilder{value: 1 ether}(agentId1);
    }

    // =========================================================================
    // Stake Management Tests
    // =========================================================================

    function test_IncreaseStake() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: BRONZE_STAKE}(agentId1);
        marketplace.increaseStake{value: SILVER_STAKE}(agentId1);
        vm.stopPrank();

        (,,, uint256 stakeAmount,,,,,,,,,) = marketplace.builders(agentId1);
        assertEq(stakeAmount, BRONZE_STAKE + SILVER_STAKE);
    }

    function test_WithdrawStake() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        uint256 balanceBefore = builder1.balance;
        marketplace.withdrawStake(agentId1, 5 ether);

        assertEq(builder1.balance, balanceBefore + 5 ether);
        (,,, uint256 stakeAmount,,,,,,,,,) = marketplace.builders(agentId1);
        assertEq(stakeAmount, GOLD_STAKE - 5 ether);
        vm.stopPrank();
    }

    function testRevert_WithdrawStake_Insufficient() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: BRONZE_STAKE}(agentId1);

        vm.expectRevert("Insufficient stake");
        marketplace.withdrawStake(agentId1, BRONZE_STAKE + 1 ether);
        vm.stopPrank();
    }

    // =========================================================================
    // Bundle Submission Tests
    // =========================================================================

    function test_SubmitBundle() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        bytes32 bundleHash = keccak256("test bundle");
        uint256 targetBlock = block.number + 1;
        uint256 bid = 0.1 ether;

        bytes32 bundleId = marketplace.submitBundle{value: bid}(agentId1, targetBlock, bundleHash, 100 gwei);
        vm.stopPrank();

        assertTrue(bundleId != bytes32(0));

        (
            bytes32 id,
            uint256 builderId,
            uint256 target,
            uint256 bidAmount,
            bytes32 hash,
            ,
            ,
            BlockBuilderMarketplace.BundleStatus status,
        ) = marketplace.bundles(bundleId);

        assertEq(id, bundleId);
        assertEq(builderId, agentId1);
        assertEq(target, targetBlock);
        assertEq(bidAmount, bid);
        assertEq(hash, bundleHash);
        assertEq(uint8(status), uint8(BlockBuilderMarketplace.BundleStatus.PENDING));
    }

    function testRevert_SubmitBundle_NotRegistered() public {
        vm.prank(builder1);
        vm.expectRevert(BlockBuilderMarketplace.BuilderNotRegistered.selector);
        marketplace.submitBundle{value: 0.1 ether}(agentId1, block.number + 1, keccak256("test"), 100 gwei);
    }

    function testRevert_SubmitBundle_InsufficientBid() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        vm.expectRevert(BlockBuilderMarketplace.InvalidBid.selector);
        marketplace.submitBundle{value: 0.0001 ether}( // Below MIN_BUNDLE_BID
        agentId1, block.number + 1, keccak256("test"), 100 gwei);
        vm.stopPrank();
    }

    function testRevert_SubmitBundle_InvalidTargetBlock() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        vm.expectRevert(BlockBuilderMarketplace.InvalidTargetBlock.selector);
        marketplace.submitBundle{value: 0.1 ether}(
            agentId1,
            block.number, // Current block, invalid
            keccak256("test"),
            100 gwei
        );
        vm.stopPrank();
    }

    // =========================================================================
    // Bundle Execution Tests
    // =========================================================================

    function test_MarkBundleIncluded() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        uint256 bid = 0.1 ether;
        bytes32 bundleId = marketplace.submitBundle{value: bid}(agentId1, block.number + 1, keccak256("test"), 100 gwei);
        vm.stopPrank();

        bytes32 inclusionTxHash = keccak256("inclusion tx");

        vm.prank(sequencer);
        marketplace.markBundleIncluded(bundleId, inclusionTxHash);

        // Check bundle status
        (,,,,,,, BlockBuilderMarketplace.BundleStatus status, bytes32 txHash) = marketplace.bundles(bundleId);
        assertEq(uint8(status), uint8(BlockBuilderMarketplace.BundleStatus.INCLUDED));
        assertEq(txHash, inclusionTxHash);

        // Check builder stats updated
        (,,,, uint256 submitted, uint256 included,,,,,,,) = marketplace.builders(agentId1);
        assertEq(submitted, 1);
        assertEq(included, 1);
    }

    function test_MarkBundleFailed() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        bytes32 bundleId =
            marketplace.submitBundle{value: 0.1 ether}(agentId1, block.number + 1, keccak256("test"), 100 gwei);
        vm.stopPrank();

        vm.prank(sequencer);
        marketplace.markBundleFailed(bundleId, "Execution failed", false);

        (,,,,,,, BlockBuilderMarketplace.BundleStatus status,) = marketplace.bundles(bundleId);
        assertEq(uint8(status), uint8(BlockBuilderMarketplace.BundleStatus.FAILED));

        (,,,, uint256 submitted,, uint256 failed,,,,,,) = marketplace.builders(agentId1);
        assertEq(submitted, 1);
        assertEq(failed, 1);
    }

    function testRevert_MarkBundle_NotSequencer() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);
        bytes32 bundleId =
            marketplace.submitBundle{value: 0.1 ether}(agentId1, block.number + 1, keccak256("test"), 100 gwei);
        vm.stopPrank();

        vm.prank(attacker);
        vm.expectRevert(BlockBuilderMarketplace.OnlySequencer.selector);
        marketplace.markBundleIncluded(bundleId, keccak256("tx"));
    }

    // =========================================================================
    // Deactivation Tests
    // =========================================================================

    function test_DeactivateBuilder() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        uint256 balanceBefore = builder1.balance;
        marketplace.deactivateBuilder(agentId1);
        vm.stopPrank();

        (,,,,,,,,,,, bool isActive,) = marketplace.builders(agentId1);
        assertFalse(isActive);

        // Stake refunded
        assertEq(builder1.balance, balanceBefore + GOLD_STAKE);
    }

    // =========================================================================
    // View Functions Tests
    // =========================================================================

    function test_GetBundlesForBlock() public {
        vm.startPrank(builder1);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        uint256 targetBlock = block.number + 1;

        bytes32 bundleId1 =
            marketplace.submitBundle{value: 0.1 ether}(agentId1, targetBlock, keccak256("bundle1"), 100 gwei);

        bytes32 bundleId2 =
            marketplace.submitBundle{value: 0.2 ether}(agentId1, targetBlock, keccak256("bundle2"), 100 gwei);
        vm.stopPrank();

        bytes32[] memory bundleIds = marketplace.getBundlesForBlock(targetBlock);
        assertEq(bundleIds.length, 2);
        assertEq(bundleIds[0], bundleId1);
        assertEq(bundleIds[1], bundleId2);
    }

    // =========================================================================
    // Admin Functions Tests
    // =========================================================================

    function test_SetSequencer() public {
        address newSequencer = address(0x999);

        vm.prank(admin);
        marketplace.setSequencer(newSequencer);

        assertEq(marketplace.sequencer(), newSequencer);
    }

    function testRevert_SetSequencer_NotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        marketplace.setSequencer(attacker);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_RegisterBuilder(uint96 stakeAmount) public {
        vm.assume(stakeAmount > 0 && stakeAmount <= 100 ether);
        vm.deal(builder1, stakeAmount);

        vm.prank(builder1);
        marketplace.registerBuilder{value: stakeAmount}(agentId1);

        (,,, uint256 stake,,,,,,,,,) = marketplace.builders(agentId1);
        assertEq(stake, stakeAmount);
    }

    function testFuzz_SubmitBundle(uint96 bidAmount) public {
        vm.assume(bidAmount >= MIN_BID && bidAmount <= 10 ether);

        vm.startPrank(builder1);
        vm.deal(builder1, GOLD_STAKE + bidAmount);
        marketplace.registerBuilder{value: GOLD_STAKE}(agentId1);

        bytes32 bundleId =
            marketplace.submitBundle{value: bidAmount}(agentId1, block.number + 1, keccak256("test"), 100 gwei);
        vm.stopPrank();

        (,,, uint256 bid,,,,,) = marketplace.bundles(bundleId);
        assertEq(bid, bidAmount);
    }
}
