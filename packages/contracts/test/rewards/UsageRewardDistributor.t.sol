// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {UsageRewardDistributor} from "../../src/rewards/UsageRewardDistributor.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJejuToken is ERC20 {
    constructor() ERC20("Jeju Token", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UsageRewardDistributorTest is Test {
    UsageRewardDistributor public distributor;
    MockJejuToken public jejuToken;

    address public owner;
    address public provider1;
    address public provider2;
    address public provider3;
    address public reporter;
    address public treasury;
    address public rewardsPool;
    address public user;

    function setUp() public {
        owner = makeAddr("owner");
        provider1 = makeAddr("provider1");
        provider2 = makeAddr("provider2");
        provider3 = makeAddr("provider3");
        reporter = makeAddr("reporter");
        treasury = makeAddr("treasury");
        rewardsPool = makeAddr("rewardsPool");
        user = makeAddr("user");

        vm.deal(owner, 100 ether);

        vm.startPrank(owner);
        jejuToken = new MockJejuToken();
        distributor = new UsageRewardDistributor(
            address(jejuToken),
            treasury,
            owner
        );
        
        // Transfer tokens to contract for rewards
        jejuToken.transfer(address(distributor), 100_000 ether);
        
        // Configure RPC service
        distributor.configureService(
            UsageRewardDistributor.ServiceType.RPC,
            address(0),
            5000, // 50% weight
            true
        );
        
        // Configure Bandwidth service
        distributor.configureService(
            UsageRewardDistributor.ServiceType.Bandwidth,
            address(0),
            3000, // 30% weight
            true
        );
        vm.stopPrank();
    }

    // ============ Service Configuration Tests ============

    function test_ConfigureService() public {
        vm.prank(owner);
        distributor.configureService(
            UsageRewardDistributor.ServiceType.CDN,
            makeAddr("cdnRegistry"),
            2000,
            true
        );

        (address registry, uint256 weight, bool enabled) = distributor.serviceConfigs(
            UsageRewardDistributor.ServiceType.CDN
        );
        
        assertEq(registry, makeAddr("cdnRegistry"));
        assertEq(weight, 2000);
        assertTrue(enabled);
    }

    function test_ConfigureService_RevertIfInvalidWeight() public {
        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.InvalidWeight.selector);
        distributor.configureService(
            UsageRewardDistributor.ServiceType.CDN,
            address(0),
            10001, // > 10000
            true
        );
    }

    // ============ Epoch Management Tests ============

    function test_StartEpoch() public {
        vm.prank(owner);
        distributor.startEpoch(
            UsageRewardDistributor.ServiceType.RPC,
            1000 ether,
            1 days
        );

        uint256 currentEpoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        assertEq(currentEpoch, 1);

        UsageRewardDistributor.EpochConfig memory config = distributor.getEpochInfo(
            UsageRewardDistributor.ServiceType.RPC,
            1
        );
        assertEq(config.rewardPool, 1000 ether);
        assertEq(config.duration, 1 days);
        assertFalse(config.finalized);
    }

    function test_StartEpoch_RevertIfDurationTooShort() public {
        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.InvalidDuration.selector);
        distributor.startEpoch(
            UsageRewardDistributor.ServiceType.RPC,
            1000 ether,
            30 minutes // < 1 hour
        );
    }

    function test_StartEpoch_RevertIfDurationTooLong() public {
        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.InvalidDuration.selector);
        distributor.startEpoch(
            UsageRewardDistributor.ServiceType.RPC,
            1000 ether,
            31 days // > 30 days
        );
    }

    function test_FinalizeEpoch() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        UsageRewardDistributor.EpochConfig memory config = distributor.getEpochInfo(
            UsageRewardDistributor.ServiceType.RPC,
            1
        );
        assertTrue(config.finalized);
    }

    function test_FinalizeEpoch_RevertIfAlreadyFinalized() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.EpochAlreadyFinalized.selector);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);
    }

    // ============ Usage Recording Tests ============

    function test_RecordUsage() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider1,
            1000,
            9000 // 90% reputation
        );

        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        (uint256 amount, uint256 timestamp, uint256 reputation) = distributor.usageRecords(
            UsageRewardDistributor.ServiceType.RPC,
            epoch,
            provider1
        );

        assertEq(amount, 1000);
        assertGt(timestamp, 0);
        assertEq(reputation, 9000);
    }

    function test_RecordUsage_Accumulates() public {
        _setupEpoch();

        vm.startPrank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 9000);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 500, 9000);
        vm.stopPrank();

        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        (uint256 amount, , ) = distributor.usageRecords(
            UsageRewardDistributor.ServiceType.RPC,
            epoch,
            provider1
        );

        assertEq(amount, 1500);
    }

    function test_RecordUsage_RevertIfServiceNotEnabled() public {
        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.ServiceNotEnabled.selector);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.Compute, // Not enabled
            provider1,
            1000,
            9000
        );
    }

    function test_RecordUsage_RevertIfZeroAmount() public {
        _setupEpoch();

        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.ZeroAmount.selector);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider1,
            0,
            9000
        );
    }

    function test_RecordUsage_RevertIfNotAuthorized() public {
        _setupEpoch();

        vm.prank(user);
        vm.expectRevert(UsageRewardDistributor.NotAuthorizedReporter.selector);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider1,
            1000,
            9000
        );
    }

    function test_RecordUsage_AuthorizedReporter() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.setReporter(reporter, true);

        vm.prank(reporter);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider1,
            1000,
            9000
        );

        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        (uint256 amount, , ) = distributor.usageRecords(
            UsageRewardDistributor.ServiceType.RPC,
            epoch,
            provider1
        );

        assertEq(amount, 1000);
    }

    function test_BatchRecordUsage() public {
        _setupEpoch();

        address[] memory providers = new address[](3);
        providers[0] = provider1;
        providers[1] = provider2;
        providers[2] = provider3;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1000;
        amounts[1] = 2000;
        amounts[2] = 3000;

        uint256[] memory reputations = new uint256[](3);
        reputations[0] = 9000;
        reputations[1] = 8000;
        reputations[2] = 7000;

        vm.prank(owner);
        distributor.batchRecordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            providers,
            amounts,
            reputations
        );

        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        
        (uint256 amount1, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, epoch, provider1);
        (uint256 amount2, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, epoch, provider2);
        (uint256 amount3, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, epoch, provider3);

        assertEq(amount1, 1000);
        assertEq(amount2, 2000);
        assertEq(amount3, 3000);
    }

    // ============ Reward Calculation Tests ============

    function test_GetPendingRewards() public {
        _setupEpochWithUsage();

        // Finalize epoch
        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending1 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 pending2 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider2);

        // Provider1 has higher reputation, should get more rewards
        assertGt(pending1, 0);
        assertGt(pending2, 0);
    }

    function test_GetPendingRewards_ProportionalToUsage() public {
        _setupEpoch();

        // Provider1 has 3x the usage of provider2
        vm.startPrank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 3000, 10000);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider2, 1000, 10000);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);
        vm.stopPrank();

        uint256 pending1 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 pending2 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider2);

        // Provider1 should get ~3x provider2's rewards
        assertGt(pending1, pending2 * 2);
        assertLt(pending1, pending2 * 4);
    }

    function test_GetPendingRewards_WeightedByReputation() public {
        _setupEpoch();

        // Same usage, different reputation
        vm.startPrank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 10000); // 100% rep
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider2, 1000, 5000);  // 50% rep
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);
        vm.stopPrank();

        uint256 pending1 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 pending2 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider2);

        // Provider1 should get ~2x provider2's rewards
        assertGt(pending1, pending2);
    }

    // ============ Claim Tests ============

    function test_ClaimRewards() public {
        _setupEpochWithUsage();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 balanceBefore = jejuToken.balanceOf(provider1);

        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        uint256 balanceAfter = jejuToken.balanceOf(provider1);
        
        // Should receive pending - protocol fee (5%)
        uint256 expectedNet = pending - (pending * 500 / 10000);
        assertEq(balanceAfter - balanceBefore, expectedNet);
    }

    function test_ClaimRewards_UpdatesProviderStats() public {
        _setupEpochWithUsage();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        (uint256 totalClaimed, uint256 pendingRewards, uint256 lastClaimTime, , uint256 lastClaimedEpoch) = 
            distributor.getProviderStats(UsageRewardDistributor.ServiceType.RPC, provider1);

        assertGt(totalClaimed, 0);
        assertEq(pendingRewards, 0); // Should be 0 after claiming
        assertEq(lastClaimTime, block.timestamp);
        assertEq(lastClaimedEpoch, 1);
    }

    function test_ClaimRewards_PreventDoubleClaim() public {
        _setupEpochWithUsage();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        // First claim
        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        // Second claim should fail - nothing to claim
        vm.prank(provider1);
        vm.expectRevert(UsageRewardDistributor.NothingToClaim.selector);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);
    }

    function test_ClaimRewards_RevertIfNothingToClaim() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        // Provider with no usage
        vm.prank(provider3);
        vm.expectRevert(UsageRewardDistributor.NothingToClaim.selector);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);
    }

    function test_ClaimRewards_ProtocolFeeSentToTreasury() public {
        _setupEpochWithUsage();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 treasuryBefore = jejuToken.balanceOf(treasury);

        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        uint256 treasuryAfter = jejuToken.balanceOf(treasury);
        uint256 expectedFee = pending * 500 / 10000;
        
        assertEq(treasuryAfter - treasuryBefore, expectedFee);
    }

    // ============ Admin Tests ============

    function test_SetReporter() public {
        vm.prank(owner);
        distributor.setReporter(reporter, true);

        assertTrue(distributor.authorizedReporters(reporter));
    }

    function test_SetReporter_Revoke() public {
        vm.prank(owner);
        distributor.setReporter(reporter, true);

        vm.prank(owner);
        distributor.setReporter(reporter, false);

        assertFalse(distributor.authorizedReporters(reporter));
    }

    function test_SetProtocolFee() public {
        vm.prank(owner);
        distributor.setProtocolFee(1000); // 10%

        assertEq(distributor.protocolFeeBps(), 1000);
    }

    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        distributor.setProtocolFee(2001); // > 20%
    }

    function test_SetRewardsPool() public {
        vm.prank(owner);
        distributor.setRewardsPool(rewardsPool);

        assertEq(distributor.rewardsPool(), rewardsPool);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        
        vm.prank(owner);
        distributor.setTreasury(newTreasury);

        assertEq(distributor.treasury(), newTreasury);
    }

    function test_Pause() public {
        // Pause is inherited but doesn't affect recordUsage since it uses onlyReporter modifier
        vm.prank(owner);
        distributor.pause();
        
        // Should still work for owner (also a reporter)
        _setupEpoch();
        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 9000);
    }

    // ============ View Tests ============

    function test_Version() public view {
        assertEq(distributor.version(), "1.0.0");
    }

    function test_Constants() public view {
        assertEq(distributor.BPS(), 10000);
        assertEq(distributor.MAX_EPOCH_DURATION(), 30 days);
        assertEq(distributor.MIN_EPOCH_DURATION(), 1 hours);
    }

    function test_GetProviderStats() public {
        _setupEpochWithUsage();

        (uint256 totalClaimed, uint256 pendingRewards, uint256 lastClaimTime, uint256 lastUsageRecorded, uint256 lastClaimedEpoch) = 
            distributor.getProviderStats(UsageRewardDistributor.ServiceType.RPC, provider1);

        assertEq(totalClaimed, 0);
        assertEq(pendingRewards, 0); // Not finalized yet
        assertEq(lastClaimTime, 0);
        assertGt(lastUsageRecorded, 0);
        assertEq(lastClaimedEpoch, 0);
    }

    // ============ Edge Case Tests ============

    function test_StartEpoch_ConsecutiveEpochs() public {
        // Start epoch 1
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 1 days);
        assertEq(distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC), 1);

        // Start epoch 2
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 2000 ether, 1 days);
        assertEq(distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC), 2);

        // Start epoch 3
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 3000 ether, 1 days);
        assertEq(distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC), 3);
    }

    function test_StartEpoch_BoundaryDurations() public {
        // Minimum duration (1 hour)
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 1 hours);

        // Maximum duration (30 days)
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 30 days);

        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        assertEq(epoch, 2);
    }

    function test_RecordUsage_MultipleProvidersSameEpoch() public {
        _setupEpoch();

        // Store addresses for later lookup
        address[] memory providers = new address[](10);
        for (uint i = 0; i < 10; i++) {
            providers[i] = makeAddr(string(abi.encodePacked("provider", vm.toString(i))));
        }

        vm.startPrank(owner);
        for (uint i = 0; i < 10; i++) {
            distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, providers[i], 1000 + i * 100, 9000);
        }
        vm.stopPrank();

        // Verify first and last using the same addresses
        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        (uint256 amount0, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, epoch, providers[0]);
        (uint256 amount9, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, epoch, providers[9]);

        assertEq(amount0, 1000);
        assertEq(amount9, 1900);
    }

    function test_RecordUsage_CrossServiceIsolation() public {
        // Setup both services
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 1 days);
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.Bandwidth, 500 ether, 1 days);

        // Record usage for both services
        vm.startPrank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 9000);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.Bandwidth, provider1, 2000, 8000);
        vm.stopPrank();

        // Verify isolation
        uint256 rpcEpoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        uint256 bwEpoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.Bandwidth);

        (uint256 rpcAmount, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.RPC, rpcEpoch, provider1);
        (uint256 bwAmount, , ) = distributor.usageRecords(UsageRewardDistributor.ServiceType.Bandwidth, bwEpoch, provider1);

        assertEq(rpcAmount, 1000);
        assertEq(bwAmount, 2000);
    }

    function test_BatchRecordUsage_EmptyArrays() public {
        _setupEpoch();

        address[] memory providers = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        uint256[] memory reputations = new uint256[](0);

        // Should not revert with empty arrays
        vm.prank(owner);
        distributor.batchRecordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            providers,
            amounts,
            reputations
        );
    }

    function test_BatchRecordUsage_LargeArrays() public {
        _setupEpoch();

        uint256 count = 50;
        address[] memory providers = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256[] memory reputations = new uint256[](count);

        for (uint i = 0; i < count; i++) {
            providers[i] = makeAddr(string(abi.encodePacked("p", i)));
            amounts[i] = 1000;
            reputations[i] = 9000;
        }

        vm.prank(owner);
        distributor.batchRecordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            providers,
            amounts,
            reputations
        );

        // Verify random samples
        uint256 epoch = distributor.currentEpoch(UsageRewardDistributor.ServiceType.RPC);
        (uint256 amount, , ) = distributor.usageRecords(
            UsageRewardDistributor.ServiceType.RPC,
            epoch,
            providers[25]
        );
        assertEq(amount, 1000);
    }

    function test_GetPendingRewards_AcrossMultipleEpochs() public {
        // Epoch 1
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 1 days);

        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 10000);

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending1 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);

        // Epoch 2
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 2000 ether, 1 days);

        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 2000, 10000);

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 2);

        uint256 pending2 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);

        // Pending should increase (epoch2 rewards added to unclaimed epoch1)
        assertGt(pending2, pending1);
    }

    function test_ClaimRewards_AcrossMultipleEpochs() public {
        // Setup and record epoch 1
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 1000 ether, 1 days);
        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 10000);
        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        // Setup and record epoch 2
        vm.prank(owner);
        distributor.startEpoch(UsageRewardDistributor.ServiceType.RPC, 2000 ether, 1 days);
        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 2000, 10000);
        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 2);

        // Claim should get rewards from both epochs
        uint256 totalPending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 balanceBefore = jejuToken.balanceOf(provider1);

        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        uint256 balanceAfter = jejuToken.balanceOf(provider1);
        uint256 received = balanceAfter - balanceBefore;

        // Should receive both epochs' rewards minus fees
        assertGt(received, 0);
        uint256 expectedNet = totalPending - (totalPending * 500 / 10000);
        assertEq(received, expectedNet);
    }

    function test_ClaimRewards_ZeroReputation() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 0); // 0 reputation

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);

        // Should still get some rewards (usage weighted by 0 rep = 0 share)
        assertEq(pending, 0);
    }

    function test_ClaimRewards_MaxReputation() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 10000); // Max reputation

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);

        // Should get full pool (only provider with max rep)
        assertGt(pending, 0);
        // Full pool is 1000 ether
        assertEq(pending, 1000 ether);
    }

    function test_ClaimRewards_LargeUsageAmount() public {
        _setupEpoch();

        uint256 largeUsage = type(uint128).max;
        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, largeUsage, 10000);

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        assertGt(pending, 0);
    }

    function test_FinalizeEpoch_TwiceRevert() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        vm.prank(owner);
        vm.expectRevert(UsageRewardDistributor.EpochAlreadyFinalized.selector);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);
    }

    function test_ConfigureService_UpdateExisting() public {
        // RPC is already configured in setUp
        (address registry, uint256 weight, bool enabled) = distributor.serviceConfigs(
            UsageRewardDistributor.ServiceType.RPC
        );
        assertEq(weight, 5000);
        assertTrue(enabled);

        // Update config
        vm.prank(owner);
        distributor.configureService(
            UsageRewardDistributor.ServiceType.RPC,
            makeAddr("newRegistry"),
            7500,
            false
        );

        (registry, weight, enabled) = distributor.serviceConfigs(
            UsageRewardDistributor.ServiceType.RPC
        );
        assertEq(registry, makeAddr("newRegistry"));
        assertEq(weight, 7500);
        assertFalse(enabled);
    }

    function test_SetProtocolFee_BoundaryValues() public {
        // Min fee (0%)
        vm.prank(owner);
        distributor.setProtocolFee(0);
        assertEq(distributor.protocolFeeBps(), 0);

        // Max fee (20%)
        vm.prank(owner);
        distributor.setProtocolFee(2000);
        assertEq(distributor.protocolFeeBps(), 2000);
    }

    function test_SetReporter_MultipleReporters() public {
        address reporter2 = makeAddr("reporter2");
        address reporter3 = makeAddr("reporter3");

        vm.startPrank(owner);
        distributor.setReporter(reporter, true);
        distributor.setReporter(reporter2, true);
        distributor.setReporter(reporter3, true);
        vm.stopPrank();

        assertTrue(distributor.authorizedReporters(reporter));
        assertTrue(distributor.authorizedReporters(reporter2));
        assertTrue(distributor.authorizedReporters(reporter3));
    }

    function test_GetEpochInfo_NonExistentEpoch() public {
        UsageRewardDistributor.EpochConfig memory config = distributor.getEpochInfo(
            UsageRewardDistributor.ServiceType.RPC,
            999 // Non-existent epoch
        );

        assertEq(config.rewardPool, 0);
        assertEq(config.duration, 0);
        assertEq(config.startTime, 0);
        assertFalse(config.finalized);
    }

    function test_RecordUsage_UpdatesLastUsageRecorded() public {
        _setupEpoch();

        vm.prank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 9000);

        (, , , uint256 lastUsageRecorded, ) = distributor.getProviderStats(
            UsageRewardDistributor.ServiceType.RPC,
            provider1
        );

        assertEq(lastUsageRecorded, block.timestamp);
    }

    function test_ClaimRewards_VerifyProtocolFeeCalculation() public {
        _setupEpochWithUsage();

        vm.prank(owner);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);

        uint256 pending = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 expectedFee = pending * 500 / 10000; // 5% fee
        uint256 expectedNet = pending - expectedFee;

        uint256 treasuryBefore = jejuToken.balanceOf(treasury);
        uint256 providerBefore = jejuToken.balanceOf(provider1);

        vm.prank(provider1);
        distributor.claimRewards(UsageRewardDistributor.ServiceType.RPC);

        uint256 treasuryAfter = jejuToken.balanceOf(treasury);
        uint256 providerAfter = jejuToken.balanceOf(provider1);

        assertEq(treasuryAfter - treasuryBefore, expectedFee);
        assertEq(providerAfter - providerBefore, expectedNet);
    }

    function test_RewardDistribution_ProportionalityVerification() public {
        _setupEpoch();

        // Provider1: 1000 usage, 10000 rep => weighted = 10,000,000
        // Provider2: 1000 usage, 5000 rep => weighted = 5,000,000
        // Provider3: 2000 usage, 5000 rep => weighted = 10,000,000
        // Total weighted = 25,000,000

        vm.startPrank(owner);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider1, 1000, 10000);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider2, 1000, 5000);
        distributor.recordUsage(UsageRewardDistributor.ServiceType.RPC, provider3, 2000, 5000);
        distributor.finalizeEpoch(UsageRewardDistributor.ServiceType.RPC, 1);
        vm.stopPrank();

        uint256 pending1 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider1);
        uint256 pending2 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider2);
        uint256 pending3 = distributor.getPendingRewards(UsageRewardDistributor.ServiceType.RPC, provider3);

        // Provider1 and Provider3 should have equal shares (40% each)
        // Provider2 should have 20%
        assertEq(pending1, pending3); // Equal weighted usage
        assertEq(pending2 * 2, pending1); // Provider2 is half of Provider1
    }

    // ============ Helpers ============

    function _setupEpoch() internal {
        vm.prank(owner);
        distributor.startEpoch(
            UsageRewardDistributor.ServiceType.RPC,
            1000 ether,
            1 days
        );
    }

    function _setupEpochWithUsage() internal {
        _setupEpoch();

        vm.startPrank(owner);
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider1,
            1000,
            9000
        );
        distributor.recordUsage(
            UsageRewardDistributor.ServiceType.RPC,
            provider2,
            500,
            8000
        );
        vm.stopPrank();
    }
}
