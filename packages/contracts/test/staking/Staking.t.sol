// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/staking/Staking.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 1000000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner) external {
        owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
}

contract MockBanManager {
    mapping(address => bool) public banned;

    function setBanned(address user, bool status) external {
        banned[user] = status;
    }

    function isAddressBanned(address target) external view returns (bool) {
        return banned[target];
    }
}

contract MockPriceOracle {
    int256 public price;
    uint256 public updatedAt;

    constructor() {
        price = 10e8; // $10 per JEJU
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 _updatedAt,
        uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}

contract StakingTest is Test {
    Staking public staking;
    MockJEJU public jeju;
    MockIdentityRegistry public identityRegistry;
    MockBanManager public banManager;
    MockPriceOracle public primaryOracle;
    MockPriceOracle public secondaryOracle;

    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);
    address public rpcService = address(6);

    event Staked(address indexed user, uint256 amount, Staking.Tier tier);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event TierChanged(address indexed user, Staking.Tier oldTier, Staking.Tier newTier);

    function setUp() public {
        jeju = new MockJEJU();
        identityRegistry = new MockIdentityRegistry();
        banManager = new MockBanManager();
        primaryOracle = new MockPriceOracle();
        secondaryOracle = new MockPriceOracle();

        vm.prank(owner);
        staking = new Staking(
            address(jeju),
            address(identityRegistry),
            address(primaryOracle),
            treasury,
            owner
        );

        // Set secondary oracle
        vm.prank(owner);
        staking.setSecondaryOracle(address(secondaryOracle));

        // Set ban manager
        vm.prank(owner);
        staking.setBanManager(address(banManager));

        // Authorize RPC service
        vm.prank(owner);
        staking.setAuthorizedService(rpcService, true);

        // Distribute tokens
        jeju.transfer(alice, 10000 ether);
        jeju.transfer(bob, 10000 ether);
        jeju.transfer(charlie, 10000 ether);

        // Approve staking contract
        vm.prank(alice);
        jeju.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        jeju.approve(address(staking), type(uint256).max);
        vm.prank(charlie);
        jeju.approve(address(staking), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         STAKING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Stake_Basic() public {
        vm.prank(alice);
        staking.stake(10 ether);

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.stakedAmount, 10 ether);
        assertTrue(pos.isActive);
        assertEq(staking.totalStaked(), 10 ether);
        assertEq(staking.totalStakers(), 1);
    }

    function test_Stake_MinimumRequired() public {
        vm.prank(alice);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.stake(0.00009 ether); // Below MIN_STAKE_AMOUNT
    }

    function test_Stake_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(Staking.InvalidAmount.selector);
        staking.stake(0);
    }

    function test_Stake_BannedUser() public {
        banManager.setBanned(alice, true);

        vm.prank(alice);
        vm.expectRevert(Staking.UserIsBanned.selector);
        staking.stake(10 ether);
    }

    function test_Stake_MultipleTimes() public {
        vm.startPrank(alice);
        staking.stake(10 ether);
        staking.stake(5 ether);
        vm.stopPrank();

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.stakedAmount, 15 ether);
        assertEq(staking.totalStakers(), 1); // Still same user
    }

    function test_StakeWithAgent() public {
        identityRegistry.setOwner(1, alice);

        vm.prank(alice);
        staking.stakeWithAgent(10 ether, 1);

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.linkedAgentId, 1);
    }

    function test_StakeWithAgent_NotOwned() public {
        identityRegistry.setOwner(1, bob); // Bob owns agent 1

        vm.prank(alice);
        vm.expectRevert(Staking.AgentNotOwned.selector);
        staking.stakeWithAgent(10 ether, 1);
    }

    function test_LinkAgent_AfterStaking() public {
        identityRegistry.setOwner(1, alice);

        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(alice);
        staking.linkAgent(1);

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.linkedAgentId, 1);
    }

    function test_LinkAgent_AlreadyLinked() public {
        identityRegistry.setOwner(1, alice);
        identityRegistry.setOwner(2, alice);

        vm.prank(alice);
        staking.stakeWithAgent(10 ether, 1);

        vm.prank(alice);
        vm.expectRevert(Staking.AlreadyLinked.selector);
        staking.linkAgent(2);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         TIER TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Tier_Free() public {
        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.FREE));
    }

    function test_Tier_Builder() public {
        // Need $10 worth of JEJU. At $10/JEJU, need 1 JEJU
        vm.prank(alice);
        staking.stake(1 ether);

        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.BUILDER));
    }

    function test_Tier_Pro() public {
        // Need $100 worth. At $10/JEJU, need 10 JEJU
        vm.prank(alice);
        staking.stake(10 ether);

        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.PRO));
    }

    function test_Tier_Unlimited() public {
        // Need $1000 worth. At $10/JEJU, need 100 JEJU
        vm.prank(alice);
        staking.stake(100 ether);

        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.UNLIMITED));
    }

    function test_Tier_Whitelisted() public {
        vm.prank(owner);
        staking.setWhitelisted(alice, true);

        // No stake but still unlimited
        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.UNLIMITED));
    }

    function test_Tier_ChangeEmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit TierChanged(alice, Staking.Tier.FREE, Staking.Tier.BUILDER);
        staking.stake(1 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION BONUS TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_ReputationBonus() public {
        vm.prank(alice);
        staking.stake(10 ether);

        // At $10/JEJU, 10 JEJU = $100 = PRO tier
        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.PRO));

        // Add 50% reputation bonus (5000 BPS)
        vm.prank(owner);
        staking.updateReputationBonus(alice, 5000);

        // Now effective value = $100 * 1.5 = $150, still PRO
        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.PRO));

        // Stake more to get near $1000 threshold
        vm.prank(alice);
        staking.stake(57 ether); // Now 67 JEJU = $670

        // With 50% bonus: $670 * 1.5 = $1005 = UNLIMITED
        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.UNLIMITED));
    }

    function test_ReputationBonus_MaxCapped() public {
        vm.prank(owner);
        staking.updateReputationBonus(alice, 10000); // Try 100% bonus

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.reputationBonus, 5000); // Capped at 50%
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ORACLE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Oracle_UsesPrimaryPrice() public {
        // Set both oracles to same price to avoid deviation check failure
        primaryOracle.setPrice(20e8); // $20
        secondaryOracle.setPrice(20e8); // $20 (same)

        // At $20/JEJU, 50 JEJU = $1000 = UNLIMITED
        vm.prank(alice);
        staking.stake(50 ether);

        assertEq(uint(staking.getTier(alice)), uint(Staking.Tier.UNLIMITED));
    }

    function test_Oracle_StalenessCheck() public {
        // Warp time forward first to avoid underflow
        vm.warp(block.timestamp + 10 hours);
        
        // Update secondary oracle to be fresh
        secondaryOracle.setUpdatedAt(block.timestamp);
        
        // Make primary oracle stale (> 1 hour old)
        primaryOracle.setUpdatedAt(block.timestamp - 2 hours);

        // Should fall back to secondary which is still fresh
        uint256 price = staking.getJejuPrice();
        
        // Secondary is still fresh at $10
        assertEq(price, 10e8);
    }

    function test_Oracle_FallbackOnBothStale() public {
        // Warp time forward first to avoid underflow
        vm.warp(block.timestamp + 100 hours);
        
        // Update the last known good price first
        staking.updateLastKnownGoodPrice();
        
        // Make both oracles stale
        primaryOracle.setUpdatedAt(block.timestamp - 2 hours);
        secondaryOracle.setUpdatedAt(block.timestamp - 2 hours);

        uint256 price = staking.getJejuPrice();
        
        // Should use last known good price or fallback
        assertTrue(price > 0);
    }

    function test_Oracle_NegativePrice() public {
        primaryOracle.setPrice(-100);

        // Should not use negative price
        uint256 price = staking.getJejuPrice();
        assertTrue(int256(price) > 0);
    }

    function test_Oracle_BoundsCheck() public {
        // Set price way above max bounds ($10,000)
        primaryOracle.setPrice(100000e8); // $100,000

        // Should use secondary or fallback
        uint256 price = staking.getJejuPrice();
        assertTrue(price <= 1e12); // Max allowed price
    }

    function test_Oracle_SecondaryFallback() public {
        // Primary gives invalid price
        primaryOracle.setPrice(0);
        
        // Secondary has valid price
        secondaryOracle.setPrice(15e8);

        uint256 price = staking.getJejuPrice();
        assertEq(price, 15e8);
    }

    function test_UpdateLastKnownGoodPrice() public {
        primaryOracle.setPrice(25e8);

        staking.updateLastKnownGoodPrice();

        (,uint256 lastGoodPrice,,,) = staking.getPriceInfo();
        assertEq(lastGoodPrice, 25e8);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         UNBONDING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Unbonding_Start() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(alice);
        staking.startUnbonding(5 ether);

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.unbondingAmount, 5 ether);
        assertEq(pos.stakedAmount, 5 ether);
        assertEq(pos.unbondingStartTime, block.timestamp);
    }

    function test_Unbonding_CannotWhileFrozen() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(owner);
        staking.freezeStake(alice, "Test freeze");

        vm.prank(alice);
        vm.expectRevert(Staking.StakeIsFrozen.selector);
        staking.startUnbonding(5 ether);
    }

    function test_Unbonding_CompleteAfterPeriod() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(alice);
        staking.startUnbonding(10 ether);

        // Cannot complete before 7 days
        vm.prank(alice);
        vm.expectRevert(Staking.StillUnbonding.selector);
        staking.completeUnstaking();

        // Warp 7 days
        vm.warp(block.timestamp + 7 days);

        uint256 aliceBalanceBefore = jeju.balanceOf(alice);

        vm.prank(alice);
        staking.completeUnstaking();

        assertEq(jeju.balanceOf(alice) - aliceBalanceBefore, 10 ether);
        
        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertFalse(pos.isActive);
        assertEq(pos.unbondingAmount, 0);
    }

    function test_Unbonding_InsufficientBalance() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(alice);
        vm.expectRevert(Staking.InsufficientBalance.selector);
        staking.startUnbonding(15 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ALLOCATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Allocation_GetLimits() public {
        vm.prank(alice);
        staking.stake(10 ether); // PRO tier

        (uint256 limit, uint256 used, uint256 remaining) = staking.getAllocation(alice, Staking.Service.RPC);
        
        assertEq(limit, 1000); // PRO tier RPC limit
        assertEq(used, 0);
        assertEq(remaining, 1000);
    }

    function test_Allocation_Unlimited() public {
        vm.prank(alice);
        staking.stake(100 ether); // UNLIMITED tier

        (uint256 limit, uint256 used, uint256 remaining) = staking.getAllocation(alice, Staking.Service.RPC);
        
        assertEq(limit, 0); // 0 means unlimited
        assertEq(remaining, type(uint256).max);
    }

    function test_ConsumeAllocation() public {
        vm.prank(alice);
        staking.stake(10 ether); // PRO tier, 1000 RPC limit

        // RPC service consumes allocation
        vm.prank(rpcService);
        staking.consumeAllocation(alice, Staking.Service.RPC, 100);

        (,uint256 used,) = staking.getAllocation(alice, Staking.Service.RPC);
        assertEq(used, 100);
    }

    function test_ConsumeAllocation_ExceedsLimit() public {
        vm.prank(alice);
        staking.stake(1 ether); // BUILDER tier, 100 RPC limit

        vm.prank(rpcService);
        vm.expectRevert(Staking.AllocationExceededError.selector);
        staking.consumeAllocation(alice, Staking.Service.RPC, 150);
    }

    function test_ConsumeAllocation_NotAuthorized() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(bob); // Not authorized
        vm.expectRevert(Staking.NotAuthorized.selector);
        staking.consumeAllocation(alice, Staking.Service.RPC, 100);
    }

    function test_HasAllocation() public {
        vm.prank(alice);
        staking.stake(1 ether); // BUILDER tier, 100 RPC limit

        assertTrue(staking.hasAllocation(alice, Staking.Service.RPC, 50));
        assertFalse(staking.hasAllocation(alice, Staking.Service.RPC, 150));
    }

    function test_RecordUsage() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(rpcService);
        staking.recordUsage(alice, Staking.Service.COMPUTE, 50);

        (,uint256 used,) = staking.getAllocation(alice, Staking.Service.COMPUTE);
        assertEq(used, 50);
    }

    function test_ReduceStorageUsage() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(rpcService);
        staking.recordUsage(alice, Staking.Service.STORAGE, 100);

        vm.prank(rpcService);
        staking.reduceStorageUsage(alice, 30);

        (,uint256 used,) = staking.getAllocation(alice, Staking.Service.STORAGE);
        assertEq(used, 70);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         MODERATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_FreezeStake() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(owner);
        staking.freezeStake(alice, "Violation");

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertTrue(pos.isFrozen);
    }

    function test_UnfreezeStake() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(owner);
        staking.freezeStake(alice, "Violation");

        vm.prank(owner);
        staking.unfreezeStake(alice);

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertFalse(pos.isFrozen);
    }

    function test_Slash() public {
        vm.prank(alice);
        staking.stake(10 ether);

        uint256 treasuryBefore = jeju.balanceOf(treasury);

        vm.prank(owner);
        staking.slash(alice, 3 ether, "Bad behavior");

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.stakedAmount, 7 ether);
        assertEq(jeju.balanceOf(treasury) - treasuryBefore, 3 ether);
    }

    function test_Slash_MoreThanStaked() public {
        vm.prank(alice);
        staking.stake(10 ether);

        vm.prank(owner);
        staking.slash(alice, 15 ether, "Full slash");

        Staking.StakePosition memory pos = staking.getPosition(alice);
        assertEq(pos.stakedAmount, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_SetTierConfig() public {
        vm.prank(owner);
        staking.setTierConfig(
            Staking.Tier.BUILDER,
            20e8, // $20
            200,  // 200 req/min
            2000, // 2GB storage
            200,  // 200 compute
            20    // 20 GB CDN
        );

        Staking.TierConfig memory config = staking.getTierConfig(Staking.Tier.BUILDER);
        assertEq(config.minUsdValue, 20e8);
        assertEq(config.rpcRateLimit, 200);
    }

    function test_SetPriceBounds() public {
        vm.prank(owner);
        staking.setPriceBounds(1e5, 1e10);

        // Set price outside bounds
        primaryOracle.setPrice(1e4); // Below min

        uint256 price = staking.getJejuPrice();
        // Should use secondary or fallback
        assertTrue(price >= 1e5 || price == staking.fallbackPrice());
    }

    function test_SetFallbackPrice() public {
        vm.prank(owner);
        staking.setFallbackPrice(5e8);

        assertEq(staking.fallbackPrice(), 5e8);
    }

    function test_SetFallbackPrice_InvalidBounds() public {
        vm.prank(owner);
        vm.expectRevert(Staking.InvalidPriceBounds.selector);
        staking.setFallbackPrice(1); // Below minAllowedPrice
    }

    function test_Pause() public {
        vm.prank(owner);
        staking.pause();

        vm.prank(alice);
        vm.expectRevert();
        staking.stake(10 ether);

        vm.prank(owner);
        staking.unpause();

        vm.prank(alice);
        staking.stake(10 ether);
    }

    function test_Version() public view {
        assertEq(staking.version(), "2.0.0");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_GetRateLimit() public {
        vm.prank(alice);
        staking.stake(10 ether); // PRO tier

        uint256 rateLimit = staking.getRateLimit(alice);
        assertEq(rateLimit, 1000);
    }

    function test_GetStakeRequirement() public {
        (uint256 usdValue, uint256 jejuAmount) = staking.getStakeRequirement(Staking.Tier.PRO);
        
        assertEq(usdValue, 100e8); // $100
        // At $10/JEJU, need 10 JEJU
        assertEq(jejuAmount, 10 ether);
    }

    function test_GetPriceInfo() public {
        primaryOracle.setPrice(25e8);
        staking.updateLastKnownGoodPrice();

        (
            uint256 currentPrice,
            uint256 lastGoodPrice,
            uint256 lastUpdateTime,
            address primary,
            address secondary
        ) = staking.getPriceInfo();

        assertEq(currentPrice, 25e8);
        assertEq(lastGoodPrice, 25e8);
        assertTrue(lastUpdateTime > 0);
        assertEq(primary, address(primaryOracle));
        assertEq(secondary, address(secondaryOracle));
    }
}

