// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/stage2/SequencerRegistry.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";
import "../../src/distributor/FeeConfig.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SequencerRegistryTest is Test {
    SequencerRegistry public registry;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    FeeConfig public feeConfig;
    MockJEJU public jejuToken;

    address public owner;
    address public treasury;
    address public sequencer1;
    address public sequencer2;
    address public council;
    address public ceo;

    uint256 constant MIN_STAKE = 1000 ether;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        sequencer1 = makeAddr("sequencer1");
        sequencer2 = makeAddr("sequencer2");
        council = makeAddr("council");
        ceo = makeAddr("ceo");

        // Deploy token
        jejuToken = new MockJEJU();

        // Deploy registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));

        // Deploy FeeConfig with 5% sequencer revenue share
        feeConfig = new FeeConfig(council, ceo, treasury, owner);

        // Deploy SequencerRegistry
        registry = new SequencerRegistry(
            address(jejuToken),
            address(identityRegistry),
            address(reputationRegistry),
            treasury,
            owner
        );

        // Connect FeeConfig
        registry.setFeeConfig(address(feeConfig));

        // Fund sequencers
        jejuToken.mint(sequencer1, 10000 ether);
        jejuToken.mint(sequencer2, 10000 ether);

        // Register agents for sequencers (returns agentId)
        vm.prank(sequencer1);
        identityRegistry.register();

        vm.prank(sequencer2);
        identityRegistry.register();

        // Fund the registry with ETH for revenue simulation
        vm.deal(address(registry), 100 ether);
    }

    // ============ Registration Tests ============

    function test_RegisterSequencer() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(1, MIN_STAKE);
        vm.stopPrank();

        (uint256 agentId, uint256 stake,, uint256 registeredAt,,,,,, bool isActive,) = registry.sequencers(sequencer1);
        assertEq(agentId, 1);
        assertEq(stake, MIN_STAKE);
        assertGt(registeredAt, 0);
        assertTrue(isActive);
    }

    function test_RegisterSequencer_InsufficientStake() public {
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), 100 ether);
        vm.expectRevert(SequencerRegistry.InsufficientStake.selector);
        registry.register(1, 100 ether);
        vm.stopPrank();
    }

    // ============ Revenue Sharing Tests ============

    function test_DepositRevenue() public {
        uint256 amount = 10 ether;
        uint256 initialRevenue = registry.epochAccumulatedRevenue();

        registry.depositRevenue{value: amount}();

        assertEq(registry.epochAccumulatedRevenue(), initialRevenue + amount);
        assertEq(registry.totalRevenueCollected(), amount);
    }

    function test_ReceiveETH() public {
        uint256 amount = 5 ether;
        
        (bool success,) = address(registry).call{value: amount}("");
        assertTrue(success);
        
        assertEq(registry.epochAccumulatedRevenue(), amount);
    }

    function test_FinalizeEpoch_DistributesRevenue() public {
        // Register sequencers
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(1, MIN_STAKE);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(2, MIN_STAKE);
        vm.stopPrank();

        // Simulate block production
        registry.recordBlockProposed(sequencer1, 100);
        registry.recordBlockProposed(sequencer1, 101);
        registry.recordBlockProposed(sequencer2, 102);

        // Deposit revenue
        uint256 revenue = 10 ether;
        registry.depositRevenue{value: revenue}();

        // Advance time past epoch
        vm.warp(block.timestamp + 1 days + 1);

        // Trigger epoch advancement by depositing 0
        registry.depositRevenue{value: 0}();

        // Finalize epoch
        uint256 treasuryBalanceBefore = treasury.balance;
        registry.finalizeEpoch(0);

        // Get epoch data
        (
            uint256 epochNumber,
            uint256 totalBlocksProduced,
            uint256 totalRevenue,
            uint256 sequencerShare,
            uint256 treasuryShare,
            uint256 distributedAt,
            bool distributed
        ) = registry.revenueEpochs(0);

        assertTrue(distributed);
        assertEq(totalBlocksProduced, 3);
        assertEq(totalRevenue, revenue);

        // Verify shares calculated correctly
        uint256 sharesBps = feeConfig.getSequencerRevenueShare(); // 500 = 5%
        uint256 expectedSequencerShare = (revenue * sharesBps) / 10000;
        uint256 expectedTreasuryShare = revenue - expectedSequencerShare;

        assertEq(sequencerShare, expectedSequencerShare);
        assertEq(treasuryShare, expectedTreasuryShare);

        // Verify treasury received its share
        assertEq(treasury.balance - treasuryBalanceBefore, expectedTreasuryShare);
    }

    function test_ClaimRewards() public {
        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(1, MIN_STAKE);
        vm.stopPrank();

        // Simulate block production (only sequencer1)
        registry.recordBlockProposed(sequencer1, 100);
        registry.recordBlockProposed(sequencer1, 101);
        registry.recordBlockProposed(sequencer1, 102);

        // Deposit revenue
        uint256 revenue = 10 ether;
        registry.depositRevenue{value: revenue}();

        // Advance time and trigger epoch advancement
        vm.warp(block.timestamp + 1 days + 1);
        registry.depositRevenue{value: 0}();
        registry.finalizeEpoch(0);

        // Check pending rewards
        uint256 pending = registry.getPendingRewards(sequencer1);
        assertGt(pending, 0);

        // Claim rewards
        uint256 balanceBefore = sequencer1.balance;
        vm.prank(sequencer1);
        registry.claimRewards();

        assertEq(sequencer1.balance - balanceBefore, pending);
        assertEq(registry.getPendingRewards(sequencer1), 0);
    }

    function test_RewardsProportionalToBlocks() public {
        // Register both sequencers
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(1, MIN_STAKE);
        vm.stopPrank();

        vm.startPrank(sequencer2);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(2, MIN_STAKE);
        vm.stopPrank();

        // Sequencer1 produces 3 blocks, Sequencer2 produces 1 block
        registry.recordBlockProposed(sequencer1, 100);
        registry.recordBlockProposed(sequencer1, 101);
        registry.recordBlockProposed(sequencer1, 102);
        registry.recordBlockProposed(sequencer2, 103);

        // Deposit revenue
        uint256 revenue = 10 ether;
        registry.depositRevenue{value: revenue}();

        // Advance time, trigger epoch advancement, and finalize
        vm.warp(block.timestamp + 1 days + 1);
        registry.depositRevenue{value: 0}();
        registry.finalizeEpoch(0);

        // Get pending rewards
        uint256 pending1 = registry.getPendingRewards(sequencer1);
        uint256 pending2 = registry.getPendingRewards(sequencer2);

        // Sequencer1 should get 3/4 of sequencer share, Sequencer2 should get 1/4
        uint256 sharesBps = feeConfig.getSequencerRevenueShare();
        uint256 totalSequencerShare = (revenue * sharesBps) / 10000;

        assertEq(pending1, (totalSequencerShare * 3) / 4);
        assertEq(pending2, totalSequencerShare / 4);
    }

    function test_GetEffectiveRevenueShareBps() public view {
        // Should read from FeeConfig
        uint256 expected = feeConfig.getSequencerRevenueShare();
        assertEq(registry.getEffectiveRevenueShareBps(), expected);
    }

    function test_SetFeeConfig() public {
        FeeConfig newConfig = new FeeConfig(council, ceo, treasury, owner);
        registry.setFeeConfig(address(newConfig));
        assertEq(address(registry.feeConfig()), address(newConfig));
    }

    function test_SetSequencerRevenueShare_Fallback() public {
        // Remove FeeConfig to use fallback
        registry.setFeeConfig(address(0));
        
        registry.setSequencerRevenueShare(1000); // 10%
        assertEq(registry.getEffectiveRevenueShareBps(), 1000);
    }

    // ============ Edge Cases ============

    function test_FinalizeEpoch_NoRevenue() public {
        // Register sequencer
        vm.startPrank(sequencer1);
        jejuToken.approve(address(registry), MIN_STAKE);
        registry.register(1, MIN_STAKE);
        vm.stopPrank();

        registry.recordBlockProposed(sequencer1, 100);

        // Advance time, trigger epoch advancement, and finalize with no revenue
        vm.warp(block.timestamp + 1 days + 1);
        registry.depositRevenue{value: 0}();
        registry.finalizeEpoch(0);

        // Should complete without error
        (,,,,,, bool distributed) = registry.revenueEpochs(0);
        assertTrue(distributed);
    }

    function test_ClaimRewards_NoRewards() public {
        vm.prank(sequencer1);
        vm.expectRevert("No rewards");
        registry.claimRewards();
    }
}
