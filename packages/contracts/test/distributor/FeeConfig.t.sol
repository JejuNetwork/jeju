// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/distributor/FeeConfig.sol";

contract FeeConfigTest is Test {
    FeeConfig public feeConfig;

    address council = makeAddr("council");
    address ceo = makeAddr("ceo");
    address treasury = makeAddr("treasury");
    address owner = makeAddr("owner");

    function setUp() public {
        vm.startPrank(owner);
        feeConfig = new FeeConfig(council, ceo, treasury, owner);
        vm.stopPrank();
    }

    // ============ Initial Values ============

    function test_InitialDistributionFees() public view {
        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();
        assertEq(fees.appShareBps, 4500);
        assertEq(fees.lpShareBps, 4500);
        assertEq(fees.contributorShareBps, 1000);
        assertEq(fees.ethLpShareBps, 7000);
        assertEq(fees.tokenLpShareBps, 3000);
    }

    function test_InitialComputeFees() public view {
        FeeConfig.ComputeFees memory fees = feeConfig.getComputeFees();
        assertEq(fees.inferencePlatformFeeBps, 500);
        assertEq(fees.rentalPlatformFeeBps, 300);
        assertEq(fees.triggerPlatformFeeBps, 200);
    }

    function test_InitialStorageFees() public view {
        FeeConfig.StorageFees memory fees = feeConfig.getStorageFees();
        assertEq(fees.uploadFeeBps, 200);
        assertEq(fees.retrievalFeeBps, 100);
        assertEq(fees.pinningFeeBps, 100);
    }

    function test_InitialInfrastructureFees() public view {
        FeeConfig.InfrastructureFees memory fees = feeConfig.getInfrastructureFees();
        assertEq(fees.sequencerRevenueShareBps, 500);
        assertEq(fees.oracleTreasuryShareBps, 1000);
        assertEq(fees.rpcPremiumFeeBps, 0);
        assertEq(fees.messagingFeeBps, 10);
    }

    function test_InitialMarketplaceFees() public view {
        FeeConfig.MarketplaceFees memory fees = feeConfig.getMarketplaceFees();
        assertEq(fees.bazaarPlatformFeeBps, 250);
        assertEq(fees.launchpadCreatorFeeBps, 8000);
        assertEq(fees.launchpadCommunityFeeBps, 2000);
        assertEq(fees.x402ProtocolFeeBps, 50);
    }

    // ============ Direct Setters (Owner Only) ============

    function test_SetDistributionFees_Owner() public {
        vm.prank(owner);
        feeConfig.setDistributionFees(5000, 4000, 1000, 6000, 4000);

        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();
        assertEq(fees.appShareBps, 5000);
        assertEq(fees.lpShareBps, 4000);
        assertEq(fees.contributorShareBps, 1000);
    }

    function test_SetDistributionFees_InvalidSum() public {
        vm.prank(owner);
        vm.expectRevert(FeeConfig.InvalidFeeSum.selector);
        feeConfig.setDistributionFees(5000, 5000, 1000, 6000, 4000); // Sum = 11000
    }

    function test_SetComputeFees_Owner() public {
        vm.prank(owner);
        feeConfig.setComputeFees(600, 400, 300);

        FeeConfig.ComputeFees memory fees = feeConfig.getComputeFees();
        assertEq(fees.inferencePlatformFeeBps, 600);
        assertEq(fees.rentalPlatformFeeBps, 400);
        assertEq(fees.triggerPlatformFeeBps, 300);
    }

    function test_SetComputeFees_TooHigh() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(FeeConfig.FeeTooHigh.selector, 3500, 3000));
        feeConfig.setComputeFees(3500, 400, 300); // Max is 3000
    }

    // ============ Governance Proposal Flow ============

    function test_ProposeFeeChange_Council() public {
        bytes memory newValues = abi.encode(uint16(600), uint16(400), uint16(300));

        vm.prank(council);
        bytes32 changeId = feeConfig.proposeFeeChange(keccak256("compute"), newValues);

        assertTrue(changeId != bytes32(0));

        // Since this is an increase, it should have a timelock
        (,, uint256 proposedAt, uint256 effectiveAt,,) = feeConfig.pendingChanges(changeId);
        assertEq(effectiveAt, proposedAt + 3 days);
    }

    function test_ProposeFeeChange_NotCouncil() public {
        bytes memory newValues = abi.encode(uint16(600), uint16(400), uint16(300));

        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(FeeConfig.NotAuthorized.selector);
        feeConfig.proposeFeeChange(keccak256("compute"), newValues);
    }

    function test_ExecuteFeeChange_AfterTimelock() public {
        // Propose a fee increase
        bytes memory newValues = abi.encode(uint16(600), uint16(400), uint16(300));

        vm.prank(council);
        bytes32 changeId = feeConfig.proposeFeeChange(keccak256("compute"), newValues);

        // Get the effective time for expectRevert
        (,,, uint256 effectiveAt,,) = feeConfig.pendingChanges(changeId);

        // Try to execute immediately - should fail with TimelockNotExpired
        vm.prank(ceo);
        vm.expectRevert(abi.encodeWithSelector(FeeConfig.TimelockNotExpired.selector, effectiveAt, block.timestamp));
        feeConfig.executeFeeChange(changeId);

        // Fast forward past timelock
        vm.warp(block.timestamp + 3 days + 1);

        // Execute should succeed
        vm.prank(ceo);
        feeConfig.executeFeeChange(changeId);

        // Verify fees changed
        FeeConfig.ComputeFees memory fees = feeConfig.getComputeFees();
        assertEq(fees.inferencePlatformFeeBps, 600);
    }

    function test_ProposeFeeDecrease_InstantExecution() public {
        // First increase fees
        vm.prank(owner);
        feeConfig.setComputeFees(700, 500, 400);

        // Propose a fee decrease
        bytes memory newValues = abi.encode(uint16(400), uint16(300), uint16(200));

        vm.prank(council);
        bytes32 changeId = feeConfig.proposeFeeChange(keccak256("compute"), newValues);

        // Decreases should have immediate effectiveAt
        (,,, uint256 effectiveAt,,) = feeConfig.pendingChanges(changeId);
        assertEq(effectiveAt, block.timestamp); // Instant

        // Execute immediately
        vm.prank(ceo);
        feeConfig.executeFeeChange(changeId);

        // Verify fees changed
        FeeConfig.ComputeFees memory fees = feeConfig.getComputeFees();
        assertEq(fees.inferencePlatformFeeBps, 400);
    }

    function test_CancelFeeChange() public {
        bytes memory newValues = abi.encode(uint16(600), uint16(400), uint16(300));

        vm.prank(council);
        bytes32 changeId = feeConfig.proposeFeeChange(keccak256("compute"), newValues);

        // Cancel by council
        vm.prank(council);
        feeConfig.cancelFeeChange(changeId);

        // Try to execute - should fail because it's marked as executed
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(ceo);
        vm.expectRevert(FeeConfig.AlreadyExecuted.selector);
        feeConfig.executeFeeChange(changeId);
    }

    // ============ Individual Getters ============

    function test_GetAppShare() public view {
        assertEq(feeConfig.getAppShare(), 4500);
    }

    function test_GetLpShare() public view {
        assertEq(feeConfig.getLpShare(), 4500);
    }

    function test_GetInferenceFee() public view {
        assertEq(feeConfig.getInferenceFee(), 500);
    }

    function test_GetRentalFee() public view {
        assertEq(feeConfig.getRentalFee(), 300);
    }

    function test_GetStorageUploadFee() public view {
        assertEq(feeConfig.getStorageUploadFee(), 200);
    }

    function test_GetSequencerRevenueShare() public view {
        assertEq(feeConfig.getSequencerRevenueShare(), 500);
    }

    function test_GetBazaarFee() public view {
        assertEq(feeConfig.getBazaarFee(), 250);
    }

    function test_GetTreasury() public view {
        assertEq(feeConfig.getTreasury(), treasury);
    }

    // ============ Admin Functions ============

    function test_SetCouncil() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(owner);
        feeConfig.setCouncil(newCouncil);
        assertEq(feeConfig.council(), newCouncil);
    }

    function test_SetCEO() public {
        address newCeo = makeAddr("newCeo");
        vm.prank(owner);
        feeConfig.setCEO(newCeo);
        assertEq(feeConfig.ceo(), newCeo);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        feeConfig.setTreasury(newTreasury);
        assertEq(feeConfig.treasury(), newTreasury);
    }

    function test_SetTreasury_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FeeConfig.InvalidAddress.selector);
        feeConfig.setTreasury(address(0));
    }

    function test_Pause() public {
        vm.prank(owner);
        feeConfig.pause();
        assertTrue(feeConfig.paused());
    }

    function test_Version() public view {
        assertEq(feeConfig.version(), "2.0.0");
    }

    // ============ App-Specific Fee Override Tests ============

    function test_SetAppFeeOverride() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        vm.prank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey, 800); // 8%

        // Verify override was set
        assertTrue(feeConfig.hasAppFeeOverride(daoId, feeKey));
        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 800);
    }

    function test_SetAppFeeOverride_NotAuthorized() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(FeeConfig.NotAuthorized.selector);
        feeConfig.setAppFeeOverride(daoId, feeKey, 800);
    }

    function test_GetEffectiveFee_NoOverride() public view {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        // No override set, should return default
        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 500);
    }

    function test_GetEffectiveFee_WithOverride() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        vm.prank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey, 300); // Lower fee

        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 300);
    }

    function test_RemoveAppFeeOverride() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        // Set override
        vm.prank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey, 800);
        assertTrue(feeConfig.hasAppFeeOverride(daoId, feeKey));

        // Remove override
        vm.prank(council);
        feeConfig.removeAppFeeOverride(daoId, feeKey);
        assertFalse(feeConfig.hasAppFeeOverride(daoId, feeKey));

        // Should return default now
        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 500);
    }

    function test_RemoveAppFeeOverride_InvalidKey() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("invalid.key");

        // Try to remove non-existent override
        vm.prank(council);
        vm.expectRevert(FeeConfig.InvalidFeeKey.selector);
        feeConfig.removeAppFeeOverride(daoId, feeKey);
    }

    function test_ClearAllAppFeeOverrides() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey1 = keccak256("compute.inference");
        bytes32 feeKey2 = keccak256("compute.rental");

        // Set multiple overrides
        vm.startPrank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey1, 600);
        feeConfig.setAppFeeOverride(daoId, feeKey2, 400);
        vm.stopPrank();

        assertTrue(feeConfig.hasAppFeeOverride(daoId, feeKey1));
        assertTrue(feeConfig.hasAppFeeOverride(daoId, feeKey2));

        // Clear all
        vm.prank(council);
        feeConfig.clearAllAppFeeOverrides(daoId);

        assertFalse(feeConfig.hasAppFeeOverride(daoId, feeKey1));
        assertFalse(feeConfig.hasAppFeeOverride(daoId, feeKey2));
    }

    function test_GetAppFeeOverrides() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey1 = keccak256("compute.inference");
        bytes32 feeKey2 = keccak256("compute.rental");

        // Set overrides
        vm.startPrank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey1, 600);
        feeConfig.setAppFeeOverride(daoId, feeKey2, 400);
        vm.stopPrank();

        (bytes32[] memory keys, uint256[] memory values) = feeConfig.getAppFeeOverrides(daoId);

        assertEq(keys.length, 2);
        assertEq(values.length, 2);
    }

    function test_GetDaosWithOverrides() public {
        bytes32 daoId1 = keccak256("dao-1");
        bytes32 daoId2 = keccak256("dao-2");
        bytes32 feeKey = keccak256("compute.inference");

        vm.startPrank(council);
        feeConfig.setAppFeeOverride(daoId1, feeKey, 600);
        feeConfig.setAppFeeOverride(daoId2, feeKey, 700);
        vm.stopPrank();

        bytes32[] memory daos = feeConfig.getDaosWithOverrides();
        assertEq(daos.length, 2);
    }

    function test_MultipleAppsIndependentOverrides() public {
        bytes32 daoId1 = keccak256("dws");
        bytes32 daoId2 = keccak256("bazaar");
        bytes32 feeKey = keccak256("compute.inference");

        // Set different overrides for different apps
        vm.startPrank(council);
        feeConfig.setAppFeeOverride(daoId1, feeKey, 600); // DWS: 6%
        feeConfig.setAppFeeOverride(daoId2, feeKey, 300); // Bazaar: 3%
        vm.stopPrank();

        // Verify each app has its own rate
        assertEq(feeConfig.getEffectiveFee(daoId1, feeKey, 500), 600);
        assertEq(feeConfig.getEffectiveFee(daoId2, feeKey, 500), 300);

        // A third app with no override gets the default
        bytes32 daoId3 = keccak256("crucible");
        assertEq(feeConfig.getEffectiveFee(daoId3, feeKey, 500), 500);
    }

    function test_UpdateAppFeeOverride() public {
        bytes32 daoId = keccak256("test-dao");
        bytes32 feeKey = keccak256("compute.inference");

        // Set initial override
        vm.prank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey, 600);
        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 600);

        // Update override
        vm.prank(council);
        feeConfig.setAppFeeOverride(daoId, feeKey, 800);
        assertEq(feeConfig.getEffectiveFee(daoId, feeKey, 500), 800);
    }
}
