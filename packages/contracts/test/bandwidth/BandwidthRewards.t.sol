// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {BandwidthRewards} from "../../src/bandwidth/BandwidthRewards.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJejuToken is ERC20 {
    constructor() ERC20("Jeju Token", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BandwidthRewardsTest is Test {
    BandwidthRewards public rewards;
    MockJejuToken public jejuToken;

    address public owner;
    address public node1;
    address public node2;
    address public node3;
    address public reporter;
    address public treasury;
    address public rewardsPool;
    address public user;

    uint256 constant GB = 1073741824; // 1 GB in bytes

    function setUp() public {
        owner = makeAddr("owner");
        node1 = makeAddr("node1");
        node2 = makeAddr("node2");
        node3 = makeAddr("node3");
        reporter = makeAddr("reporter");
        treasury = makeAddr("treasury");
        rewardsPool = makeAddr("rewardsPool");
        user = makeAddr("user");

        vm.deal(owner, 100 ether);
        vm.deal(node1, 100 ether);
        vm.deal(node2, 100 ether);
        vm.deal(node3, 100 ether);
        vm.deal(user, 100 ether);

        vm.startPrank(owner);
        jejuToken = new MockJejuToken();
        rewards = new BandwidthRewards(
            address(jejuToken),
            treasury,
            owner
        );
        
        // Transfer tokens to contract for rewards
        jejuToken.transfer(address(rewards), 100_000 ether);
        vm.stopPrank();
    }

    // ============ Registration Tests ============

    function test_RegisterNode() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.operator, node1);
        assertEq(node.stake, 0.1 ether);
        assertEq(uint8(node.nodeType), uint8(BandwidthRewards.NodeType.Residential));
        assertEq(node.region, "us-east");
        assertTrue(node.isActive);
        assertFalse(node.isFrozen);
    }

    function test_RegisterNode_RevertIfInsufficientStake() public {
        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.InsufficientStake.selector);
        rewards.registerNode{value: 0.001 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );
    }

    function test_RegisterNode_RevertIfAlreadyRegistered() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.AlreadyRegistered.selector);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "eu-west"
        );
    }

    function test_RegisterNodeWithAgent() public {
        uint256 agentId = 12345;
        
        vm.prank(node1);
        rewards.registerNodeWithAgent{value: 0.1 ether}(
            BandwidthRewards.NodeType.Mobile,
            "asia-pacific",
            agentId
        );

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.agentId, agentId);
        assertEq(uint8(node.nodeType), uint8(BandwidthRewards.NodeType.Mobile));
    }

    function test_DeactivateNode() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(node1);
        rewards.deactivateNode();

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertFalse(node.isActive);
    }

    function test_DeactivateNode_RevertIfNotActive() public {
        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.NodeNotActive.selector);
        rewards.deactivateNode();
    }

    // ============ Bandwidth Reporting Tests ============

    function test_ReportBandwidth() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        // Owner is authorized by default
        vm.prank(owner);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.totalBytesShared, 5 * GB);
        assertEq(node.totalSessions, 100);
    }

    function test_ReportBandwidth_Accumulates() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        vm.prank(owner);
        rewards.reportBandwidth(node1, 3 * GB, 50);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.totalBytesShared, 8 * GB);
        assertEq(node.totalSessions, 150);
    }

    function test_ReportBandwidth_RevertIfNotActive() public {
        vm.prank(owner);
        vm.expectRevert(BandwidthRewards.NodeNotActive.selector);
        rewards.reportBandwidth(node1, 5 * GB, 100);
    }

    function test_ReportBandwidth_RevertIfFrozen() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.setNodeFrozen(node1, true);

        vm.prank(owner);
        vm.expectRevert(BandwidthRewards.NodeIsFrozen.selector);
        rewards.reportBandwidth(node1, 5 * GB, 100);
    }

    function test_ReportBandwidth_RevertIfNotAuthorized() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(user);
        vm.expectRevert(BandwidthRewards.NotAuthorizedReporter.selector);
        rewards.reportBandwidth(node1, 5 * GB, 100);
    }

    function test_ReportBandwidth_AuthorizedReporter() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.setReporter(reporter, true);

        vm.prank(reporter);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.totalBytesShared, 5 * GB);
    }

    // ============ Performance Reporting Tests ============

    function test_ReportPerformance() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportPerformance(node1, 9500, 9800, 50, 100);

        (uint256 uptime, uint256 successRate, uint256 latency, uint256 bandwidth, uint256 updated) = rewards.nodePerformance(node1);
        assertEq(uptime, 9500);
        assertEq(successRate, 9800);
        assertEq(latency, 50);
        assertEq(bandwidth, 100);
        assertGt(updated, 0);
    }

    function test_ReportPerformance_RevertIfInvalidScore() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        vm.expectRevert(BandwidthRewards.InvalidScore.selector);
        rewards.reportPerformance(node1, 10001, 9800, 50, 100); // Uptime > 10000
    }

    // ============ Reward Claiming Tests ============

    function test_ClaimRewards() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        // Report bandwidth (need at least 100 MB = config.minBytesForClaim)
        vm.prank(owner);
        rewards.reportBandwidth(node1, 2 * GB, 50);

        // Warp time past claim period
        vm.warp(block.timestamp + 2 hours);

        uint256 balanceBefore = jejuToken.balanceOf(node1);

        vm.prank(node1);
        rewards.claimRewards();

        uint256 balanceAfter = jejuToken.balanceOf(node1);
        assertGt(balanceAfter, balanceBefore);
    }

    function test_ClaimRewards_RevertIfNothingToClaim() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.warp(block.timestamp + 2 hours);

        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.NothingToClaim.selector);
        rewards.claimRewards();
    }

    function test_ClaimRewards_RevertIfInsufficientContribution() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        // Report small amount (less than 100 MB)
        vm.prank(owner);
        rewards.reportBandwidth(node1, 10 * 1024 * 1024, 10); // 10 MB

        vm.warp(block.timestamp + 2 hours);

        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.InsufficientContribution.selector);
        rewards.claimRewards();
    }

    function test_ClaimRewards_RevertIfTooSoon() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportBandwidth(node1, 2 * GB, 50);

        // Don't warp time - claim immediately
        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.ClaimTooSoon.selector);
        rewards.claimRewards();
    }

    function test_ClaimRewards_RevertIfFrozen() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportBandwidth(node1, 2 * GB, 50);

        vm.prank(owner);
        rewards.setNodeFrozen(node1, true);

        vm.warp(block.timestamp + 2 hours);

        vm.prank(node1);
        vm.expectRevert(BandwidthRewards.NodeIsFrozen.selector);
        rewards.claimRewards();
    }

    function test_ClaimRewards_ResidentialMultiplier() public {
        // Register residential node
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        // Register datacenter node
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-west"
        );

        // Report same bandwidth for both
        vm.startPrank(owner);
        rewards.reportBandwidth(node1, 10 * GB, 100);
        rewards.reportBandwidth(node2, 10 * GB, 100);
        vm.stopPrank();

        // Warp time
        vm.warp(block.timestamp + 2 hours);

        // Check estimated rewards - residential should be 1.5x
        uint256 residentialReward = rewards.getEstimatedReward(node1);
        uint256 datacenterReward = rewards.getEstimatedReward(node2);

        // Residential should have 1.5x multiplier
        assertGt(residentialReward, datacenterReward);
    }

    function test_ClaimRewards_QualityBonus() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-east"
        );

        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-west"
        );

        vm.startPrank(owner);
        // Report same bandwidth
        rewards.reportBandwidth(node1, 10 * GB, 100);
        rewards.reportBandwidth(node2, 10 * GB, 100);

        // Node1 has excellent performance, node2 has none
        rewards.reportPerformance(node1, 9500, 9800, 30, 200);
        // node2 has no performance data
        vm.stopPrank();

        // Node with performance data should have quality bonus
        uint256 node1Reward = rewards.getEstimatedReward(node1);
        uint256 node2Reward = rewards.getEstimatedReward(node2);

        assertGt(node1Reward, node2Reward);
    }

    // ============ Query Tests ============

    function test_GetActiveNodes() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");

        address[] memory active = rewards.getActiveNodes();
        assertEq(active.length, 2);
    }

    function test_GetActiveNodes_ExcludesDeactivated() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");

        vm.prank(node2);
        rewards.deactivateNode();

        address[] memory active = rewards.getActiveNodes();
        assertEq(active.length, 1);
        assertEq(active[0], node1);
    }

    function test_GetNodesByType() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");
        
        vm.prank(node3);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "asia");

        address[] memory residential = rewards.getNodesByType(BandwidthRewards.NodeType.Residential);
        address[] memory datacenter = rewards.getNodesByType(BandwidthRewards.NodeType.Datacenter);

        assertEq(residential.length, 2);
        assertEq(datacenter.length, 1);
    }

    function test_GetPendingReward() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        vm.prank(owner);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        BandwidthRewards.PendingReward memory pending = rewards.getPendingReward(node1);
        assertEq(pending.bytesContributed, 5 * GB);
        assertEq(pending.sessionsHandled, 100);
        assertGt(pending.calculatedReward, 0);
    }

    // ============ Admin Tests ============

    function test_SetReporter() public {
        vm.prank(owner);
        rewards.setReporter(reporter, true);

        assertTrue(rewards.authorizedReporters(reporter));
    }

    function test_SetReporter_Revoke() public {
        vm.prank(owner);
        rewards.setReporter(reporter, true);

        vm.prank(owner);
        rewards.setReporter(reporter, false);

        assertFalse(rewards.authorizedReporters(reporter));
    }

    function test_SetConfig() public {
        vm.prank(owner);
        rewards.setConfig(
            2e18,       // 2 JEJU per GB
            20000,      // 2x residential
            25000,      // 2.5x mobile
            7500,       // 75% max quality bonus
            2 hours,    // 2 hour min claim period
            200 * 1024 * 1024  // 200 MB min
        );

        (uint256 baseRate,,,,,) = rewards.config();
        assertEq(baseRate, 2e18);
    }

    function test_SlashNode() public {
        vm.prank(node1);
        rewards.registerNode{value: 1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        uint256 treasuryBalanceBefore = treasury.balance;

        vm.prank(owner);
        rewards.slashNode(node1, 0.5 ether, "Abuse detected");

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.stake, 0.5 ether);
        assertTrue(node.isFrozen);
        assertEq(treasury.balance, treasuryBalanceBefore + 0.5 ether);
    }

    function test_SlashNode_CappedAtStake() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        vm.prank(owner);
        rewards.slashNode(node1, 10 ether, "Major violation");

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.stake, 0);
    }

    function test_SetNodeFrozen() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        vm.prank(owner);
        rewards.setNodeFrozen(node1, true);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertTrue(node.isFrozen);
    }

    function test_SetRewardsPool() public {
        vm.prank(owner);
        rewards.setRewardsPool(rewardsPool);

        assertEq(rewards.rewardsPool(), rewardsPool);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        
        vm.prank(owner);
        rewards.setTreasury(newTreasury);

        assertEq(rewards.treasury(), newTreasury);
    }

    function test_Pause() public {
        vm.prank(owner);
        rewards.pause();

        vm.prank(node1);
        vm.expectRevert();
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
    }

    function test_Unpause() public {
        vm.prank(owner);
        rewards.pause();

        vm.prank(owner);
        rewards.unpause();

        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertTrue(node.isActive);
    }

    // ============ View Tests ============

    function test_Version() public view {
        assertEq(rewards.version(), "1.0.0");
    }

    function test_Constants() public view {
        assertEq(rewards.BPS(), 10000);
        assertEq(rewards.MIN_STAKE(), 0.01 ether);
        assertEq(rewards.BYTES_PER_GB(), 1073741824);
    }

    function test_TotalStats() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");

        assertEq(rewards.totalNodesRegistered(), 2);

        vm.prank(owner);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        assertEq(rewards.totalBytesShared(), 5 * GB);
    }

    // ============ Edge Case Tests ============

    function test_RegisterNode_MobileType() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Mobile,
            "us-mobile"
        );

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(uint8(node.nodeType), uint8(BandwidthRewards.NodeType.Mobile));
    }

    function test_RegisterNode_MaxStake() public {
        vm.deal(node1, 1000 ether);
        vm.prank(node1);
        rewards.registerNode{value: 100 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-east"
        );

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.stake, 100 ether);
    }

    function test_RegisterNode_MinimumStakeBoundary() public {
        // Exactly minimum stake should work
        vm.prank(node1);
        rewards.registerNode{value: 0.01 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.stake, 0.01 ether);
    }

    function test_ReportBandwidth_ZeroBytesNonZeroSessions() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportBandwidth(node1, 0, 100);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.totalBytesShared, 0);
        assertEq(node.totalSessions, 100);
    }

    function test_ReportBandwidth_LargeValues() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        uint256 terabyte = 1024 * GB; // 1 TB
        vm.prank(owner);
        rewards.reportBandwidth(node1, terabyte, 1_000_000);

        BandwidthRewards.BandwidthNode memory node = rewards.getNode(node1);
        assertEq(node.totalBytesShared, terabyte);
        assertEq(node.totalSessions, 1_000_000);
    }

    function test_ClaimRewards_MobileMultiplier() public {
        // Register mobile node - should get 2x multiplier
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Mobile,
            "us-mobile"
        );

        // Register datacenter node
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-west"
        );

        // Report same bandwidth for both
        vm.startPrank(owner);
        rewards.reportBandwidth(node1, 10 * GB, 100);
        rewards.reportBandwidth(node2, 10 * GB, 100);
        vm.stopPrank();

        // Mobile should have 2x multiplier vs datacenter 1x
        uint256 mobileReward = rewards.getEstimatedReward(node1);
        uint256 datacenterReward = rewards.getEstimatedReward(node2);

        // Mobile should be ~2x datacenter
        assertGt(mobileReward, datacenterReward);
        assertGt(mobileReward, datacenterReward * 150 / 100); // At least 1.5x
    }

    function test_ClaimRewards_VerifyActualTokenTransfer() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportBandwidth(node1, 5 * GB, 100);

        vm.warp(block.timestamp + 2 hours);

        uint256 estimated = rewards.getEstimatedReward(node1);
        uint256 balanceBefore = jejuToken.balanceOf(node1);

        vm.prank(node1);
        rewards.claimRewards();

        uint256 balanceAfter = jejuToken.balanceOf(node1);
        uint256 received = balanceAfter - balanceBefore;

        // Received should be close to estimated (might differ slightly due to timing)
        assertGt(received, 0);
        assertLe(received, estimated + 1 ether); // Allow small variance
    }

    function test_ClaimRewards_MultipleClaims() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        // First contribution and claim
        vm.prank(owner);
        rewards.reportBandwidth(node1, 2 * GB, 50);

        vm.warp(block.timestamp + 2 hours);

        uint256 balance1 = jejuToken.balanceOf(node1);
        vm.prank(node1);
        rewards.claimRewards();
        uint256 balance2 = jejuToken.balanceOf(node1);
        uint256 claim1 = balance2 - balance1;

        // Second contribution - warp MORE time to avoid ClaimTooSoon
        vm.warp(block.timestamp + 3 hours); // Need to wait claim period again

        vm.prank(owner);
        rewards.reportBandwidth(node1, 3 * GB, 75);

        vm.warp(block.timestamp + 2 hours); // Wait for second claim period

        vm.prank(node1);
        rewards.claimRewards();
        uint256 balance3 = jejuToken.balanceOf(node1);
        uint256 claim2 = balance3 - balance2;

        // Both claims should be non-zero
        assertGt(claim1, 0);
        assertGt(claim2, 0);
    }

    function test_ClaimRewards_HighPerformanceBonus() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-east"
        );

        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Datacenter,
            "us-west"
        );

        vm.startPrank(owner);
        rewards.reportBandwidth(node1, 10 * GB, 100);
        rewards.reportBandwidth(node2, 10 * GB, 100);

        // Node1: Perfect scores (100% quality bonus)
        rewards.reportPerformance(node1, 10000, 10000, 10, 500);
        // Node2: Poor scores (0% quality bonus)
        rewards.reportPerformance(node2, 5000, 5000, 500, 10);
        vm.stopPrank();

        uint256 node1Reward = rewards.getEstimatedReward(node1);
        uint256 node2Reward = rewards.getEstimatedReward(node2);

        // Node1 should get significantly more due to quality bonus
        assertGt(node1Reward, node2Reward);
    }

    function test_SlashNode_RevertIfNotOwner() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        vm.prank(user);
        vm.expectRevert();
        rewards.slashNode(node1, 0.05 ether, "Unauthorized");
    }

    function test_SlashNode_UnregisteredNodeNoEffect() public {
        uint256 treasuryBefore = treasury.balance;

        // Slashing unregistered node should have no effect
        vm.prank(owner);
        rewards.slashNode(node1, 0.05 ether, "Not registered");

        // Treasury shouldn't receive anything
        assertEq(treasury.balance, treasuryBefore);
    }

    function test_SlashNode_ZeroAmount() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        uint256 stakeBefore = rewards.getNode(node1).stake;

        vm.prank(owner);
        rewards.slashNode(node1, 0, "Zero slash");

        uint256 stakeAfter = rewards.getNode(node1).stake;
        assertEq(stakeBefore, stakeAfter);
    }

    function test_DeactivateNode_PreventsFurtherReports() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(node1);
        rewards.deactivateNode();

        vm.prank(owner);
        vm.expectRevert(BandwidthRewards.NodeNotActive.selector);
        rewards.reportBandwidth(node1, 1 * GB, 10);
    }

    function test_GetNodesByType_AllTypes() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");
        
        vm.prank(node3);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Mobile, "asia");

        address[] memory residential = rewards.getNodesByType(BandwidthRewards.NodeType.Residential);
        address[] memory datacenter = rewards.getNodesByType(BandwidthRewards.NodeType.Datacenter);
        address[] memory mobile = rewards.getNodesByType(BandwidthRewards.NodeType.Mobile);

        assertEq(residential.length, 1);
        assertEq(datacenter.length, 1);
        assertEq(mobile.length, 1);
    }

    function test_GetPendingReward_NoContribution() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");

        BandwidthRewards.PendingReward memory pending = rewards.getPendingReward(node1);
        assertEq(pending.bytesContributed, 0);
        assertEq(pending.calculatedReward, 0);
    }

    function test_SetConfig_AllZeros() public {
        vm.prank(owner);
        // Setting 0 values should work but produce 0 rewards
        rewards.setConfig(0, 0, 0, 0, 0, 0);

        (uint256 baseRate,,,,,) = rewards.config();
        assertEq(baseRate, 0);
    }

    function test_SetConfig_MaxValues() public {
        vm.prank(owner);
        rewards.setConfig(
            type(uint256).max,  // baseRewardPerGB
            type(uint256).max,  // residentialMultiplier
            type(uint256).max,  // mobileMultiplier
            type(uint256).max,  // maxQualityBonus
            type(uint256).max,  // minClaimPeriod
            type(uint256).max   // minBytesForClaim
        );

        (uint256 baseRate,,,,,) = rewards.config();
        assertEq(baseRate, type(uint256).max);
    }

    function test_ReportPerformance_AllZeros() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportPerformance(node1, 0, 0, 0, 0);

        (uint256 uptime, uint256 successRate, uint256 latency, uint256 bandwidth, ) = rewards.nodePerformance(node1);
        assertEq(uptime, 0);
        assertEq(successRate, 0);
        assertEq(latency, 0);
        assertEq(bandwidth, 0);
    }

    function test_ReportPerformance_MaxLatency() public {
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(
            BandwidthRewards.NodeType.Residential,
            "us-east"
        );

        vm.prank(owner);
        rewards.reportPerformance(node1, 9000, 9000, type(uint256).max, 100);

        (,, uint256 latency,,) = rewards.nodePerformance(node1);
        assertEq(latency, type(uint256).max);
    }

    function test_ConcurrentRegistrations() public {
        // Register multiple nodes in same transaction
        vm.prank(node1);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Residential, "us-east");
        
        vm.prank(node2);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Datacenter, "eu-west");
        
        vm.prank(node3);
        rewards.registerNode{value: 0.1 ether}(BandwidthRewards.NodeType.Mobile, "asia");

        assertEq(rewards.totalNodesRegistered(), 3);
        
        address[] memory active = rewards.getActiveNodes();
        assertEq(active.length, 3);
    }
}
