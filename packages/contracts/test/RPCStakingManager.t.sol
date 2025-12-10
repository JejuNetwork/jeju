// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/rpc/RPCStakingManager.sol";
import "../src/rpc/IRPCStakingManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockReputationProvider {
    mapping(address => uint256) public discounts;

    function setDiscount(address user, uint256 discount) external {
        discounts[user] = discount;
    }

    function getStakeDiscount(address user) external view returns (uint256) {
        return discounts[user];
    }
}

contract MockPriceOracle {
    int256 public price = 1e7; // $0.10 per JEJU (8 decimals)
    
    function setPrice(int256 _price) external {
        price = _price;
    }
    
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}

contract RPCStakingManagerTest is Test {
    RPCStakingManager public manager;
    MockJEJU public token;
    MockReputationProvider public reputationProvider;
    MockPriceOracle public priceOracle;

    address public owner = address(this);
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public cloudApp = address(0xC100D);

    function setUp() public {
        token = new MockJEJU();
        reputationProvider = new MockReputationProvider();
        priceOracle = new MockPriceOracle();
        manager = new RPCStakingManager(
            address(token),
            address(0),
            address(priceOracle),
            owner
        );

        token.transfer(user1, 100_000 ether);
        token.transfer(user2, 100_000 ether);

        vm.prank(user1);
        token.approve(address(manager), type(uint256).max);
        vm.prank(user2);
        token.approve(address(manager), type(uint256).max);
    }

    // ============ Staking Tests ============

    function testStakeBasicTier() public {
        vm.prank(user1);
        manager.stake(100 ether);

        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 100 ether);
        assertEq(pos.isActive, true);
        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.BASIC));
        assertEq(manager.getRateLimit(user1), 100); // 100 req/min
    }

    function testStakeProTier() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.PRO));
        assertEq(manager.getRateLimit(user1), 1000);
    }

    function testStakeUnlimitedTier() public {
        vm.prank(user1);
        manager.stake(10000 ether);

        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.UNLIMITED));
        assertEq(manager.getRateLimit(user1), 0); // 0 = unlimited
    }

    function testFreeTier() public {
        // User with no stake
        assertEq(uint256(manager.getTier(user2)), uint256(IRPCStakingManager.Tier.FREE));
        assertEq(manager.getRateLimit(user2), 10); // 10 req/min
    }

    function testMultipleStakes() public {
        vm.startPrank(user1);
        manager.stake(100 ether);
        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.BASIC));

        manager.stake(900 ether);
        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.PRO));
        vm.stopPrank();

        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 1000 ether);
    }

    // ============ Unbonding Tests ============

    function testStartUnbonding() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        vm.prank(user1);
        manager.startUnbonding(500 ether);

        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 500 ether);
        assertEq(pos.unbondingAmount, 500 ether);
        assertGt(pos.unbondingStartTime, 0);

        // Tier should drop
        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.BASIC));
    }

    function testCompleteUnstaking() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        vm.prank(user1);
        manager.startUnbonding(1000 ether);

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balanceBefore = token.balanceOf(user1);
        vm.prank(user1);
        manager.completeUnstaking();

        assertEq(token.balanceOf(user1), balanceBefore + 1000 ether);

        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 0);
        assertEq(pos.unbondingAmount, 0);
        assertEq(pos.isActive, false);
    }

    function testCannotUnstakeBeforePeriod() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        vm.prank(user1);
        manager.startUnbonding(1000 ether);

        // Only 3 days passed
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(IRPCStakingManager.StillUnbonding.selector);
        vm.prank(user1);
        manager.completeUnstaking();
    }

    function testCannotStartUnbondingTwice() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        vm.prank(user1);
        manager.startUnbonding(500 ether);

        vm.expectRevert(IRPCStakingManager.StillUnbonding.selector);
        vm.prank(user1);
        manager.startUnbonding(500 ether);
    }

    // ============ Reputation Discount Tests ============

    function testReputationDiscount() public {
        manager.setReputationProvider(address(reputationProvider));

        // Set 50% discount (5000 BPS)
        reputationProvider.setDiscount(user1, 5000);

        // Stake 500 JEJU - should be effective 750 JEJU with 50% bonus
        vm.prank(user1);
        manager.stake(500 ether);

        // Effective stake = 500 * (10000 + 5000) / 10000 = 750
        assertEq(manager.getEffectiveStake(user1), 750 ether);

        // Should qualify for BASIC tier (100 JEJU min) easily
        assertEq(uint256(manager.getTier(user1)), uint256(IRPCStakingManager.Tier.BASIC));
    }

    function testReputationDiscountCapped() public {
        manager.setReputationProvider(address(reputationProvider));

        // Try to set 100% discount - should be capped at 50%
        reputationProvider.setDiscount(user1, 10000);

        vm.prank(user1);
        manager.stake(100 ether);

        // Should be capped at 50% (5000 BPS)
        // Effective stake = 100 * 1.5 = 150
        assertEq(manager.getEffectiveStake(user1), 150 ether);
    }

    function testNoReputationProvider() public {
        // No reputation provider set
        assertEq(manager.getReputationDiscount(user1), 0);

        vm.prank(user1);
        manager.stake(100 ether);

        // Effective stake should equal actual stake
        assertEq(manager.getEffectiveStake(user1), 100 ether);
    }

    // ============ Whitelist Tests ============

    function testWhitelistedUnlimited() public {
        manager.setWhitelisted(cloudApp, true);

        // Whitelisted address gets unlimited even with 0 stake
        assertEq(uint256(manager.getTier(cloudApp)), uint256(IRPCStakingManager.Tier.UNLIMITED));
        assertEq(manager.getRateLimit(cloudApp), 0);
    }

    function testBatchWhitelist() public {
        address[] memory apps = new address[](3);
        apps[0] = address(0xA);
        apps[1] = address(0xB);
        apps[2] = address(0xC);

        manager.batchWhitelist(apps, true);

        assertTrue(manager.whitelisted(address(0xA)));
        assertTrue(manager.whitelisted(address(0xB)));
        assertTrue(manager.whitelisted(address(0xC)));
    }

    // ============ Admin Tests ============

    function testSetTierConfig() public {
        manager.setTierConfig(IRPCStakingManager.Tier.BASIC, 5e8, 200); // $5 USD

        IRPCStakingManager.TierConfig memory config = manager.getTierConfig(IRPCStakingManager.Tier.BASIC);
        assertEq(config.minUsdValue, 5e8);
        assertEq(config.rateLimit, 200);
    }

    function testOnlyOwnerCanSetConfig() public {
        vm.prank(user1);
        vm.expectRevert();
        manager.setTierConfig(IRPCStakingManager.Tier.BASIC, 5e8, 200);
    }

    function testPause() public {
        manager.pause();

        vm.prank(user1);
        vm.expectRevert();
        manager.stake(100 ether);
    }

    // ============ Access Control Tests ============

    function testCanAccess() public {
        assertTrue(manager.canAccess(user1));
        assertTrue(manager.canAccess(user2));
    }

    function testWhitelistedCanAccess() public {
        manager.setWhitelisted(cloudApp, true);
        assertTrue(manager.canAccess(cloudApp));
    }

    // ============ Edge Cases ============

    function testCannotStakeZero() public {
        vm.prank(user1);
        vm.expectRevert(IRPCStakingManager.InvalidAmount.selector);
        manager.stake(0);
    }

    function testCannotUnbondMoreThanStaked() public {
        vm.prank(user1);
        manager.stake(100 ether);

        vm.prank(user1);
        vm.expectRevert(IRPCStakingManager.InsufficientBalance.selector);
        manager.startUnbonding(200 ether);
    }

    function testCannotUnstakeWithoutUnbonding() public {
        vm.prank(user1);
        manager.stake(100 ether);

        vm.prank(user1);
        vm.expectRevert(IRPCStakingManager.NotUnbonding.selector);
        manager.completeUnstaking();
    }

    // ============ Stats Tests ============

    function testTotalStaked() public {
        vm.prank(user1);
        manager.stake(1000 ether);

        vm.prank(user2);
        manager.stake(500 ether);

        (uint256 totalStaked, uint256 totalStakers,,,,) = manager.getStats();
        assertEq(totalStaked, 1500 ether);
        assertEq(totalStakers, 2);
    }

    // ============ Moderation Tests ============

    function testFreezeStake() public {
        // Stake some tokens
        vm.prank(user1);
        manager.stake(1000 ether);
        
        // Owner can freeze
        manager.freezeStake(user1, "Suspected abuse");
        
        assertTrue(manager.isFrozen(user1));
        assertFalse(manager.canAccess(user1));
    }

    function testFrozenCannotUnbond() public {
        // Stake some tokens
        vm.prank(user1);
        manager.stake(1000 ether);
        
        // Freeze stake
        manager.freezeStake(user1, "Suspected abuse");
        
        // Try to unbond - should fail
        vm.prank(user1);
        vm.expectRevert(IRPCStakingManager.StakeIsFrozen.selector);
        manager.startUnbonding(500 ether);
    }

    function testFrozenCannotCompleteUnstaking() public {
        // Stake and start unbonding
        vm.prank(user1);
        manager.stake(1000 ether);
        
        vm.prank(user1);
        manager.startUnbonding(500 ether);
        
        // Freeze stake during unbonding
        manager.freezeStake(user1, "Investigation");
        
        // Warp past unbonding period
        vm.warp(block.timestamp + 8 days);
        
        // Try to complete - should fail
        vm.prank(user1);
        vm.expectRevert(IRPCStakingManager.StakeIsFrozen.selector);
        manager.completeUnstaking();
    }

    function testUnfreezeStake() public {
        vm.prank(user1);
        manager.stake(1000 ether);
        
        // Freeze then unfreeze
        manager.freezeStake(user1, "Investigation");
        manager.unfreezeStake(user1);
        
        assertFalse(manager.isFrozen(user1));
        assertTrue(manager.canAccess(user1));
    }

    function testSlashStake() public {
        address treasury = makeAddr("treasury");
        manager.setTreasury(treasury);
        
        vm.prank(user1);
        manager.stake(1000 ether);
        
        bytes32 reportId = keccak256("report-123");
        manager.slashStake(user1, 300 ether, reportId);
        
        // Check stake reduced
        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 700 ether);
        
        // Check treasury received slashed funds
        assertEq(token.balanceOf(treasury), 300 ether);
    }

    function testModeratorCanFreeze() public {
        address moderator = makeAddr("moderator");
        manager.setModerator(moderator, true);
        
        vm.prank(user1);
        manager.stake(1000 ether);
        
        // Moderator can freeze
        vm.prank(moderator);
        manager.freezeStake(user1, "Reported by community");
        
        assertTrue(manager.isFrozen(user1));
    }

    function testNonModeratorCannotFreeze() public {
        vm.prank(user1);
        manager.stake(1000 ether);
        
        // Non-moderator cannot freeze
        vm.prank(user2);
        vm.expectRevert(IRPCStakingManager.NotModerator.selector);
        manager.freezeStake(user1, "Malicious attempt");
    }

    function testSlashMoreThanStaked() public {
        address treasury = makeAddr("treasury2");
        manager.setTreasury(treasury);
        
        vm.prank(user1);
        manager.stake(100 ether);
        
        bytes32 reportId = keccak256("report-456");
        manager.slashStake(user1, 500 ether, reportId);
        
        IRPCStakingManager.StakePosition memory pos = manager.getPosition(user1);
        assertEq(pos.stakedAmount, 0);
        assertEq(token.balanceOf(treasury), 100 ether);
    }

    // ============ USD Pricing Tests ============

    function testGetJejuPrice() public view {
        // Default price from mock oracle: $0.10 (1e7 with 8 decimals)
        assertEq(manager.getJejuPrice(), 1e7);
    }

    function testStakeUsdValue() public {
        vm.prank(user1);
        manager.stake(100 ether); // 100 JEJU at $0.10 = $10
        
        uint256 usdValue = manager.getStakeUsdValue(user1);
        assertEq(usdValue, 10e8); // $10 with 8 decimals
    }

    function testTierChangesWithPrice() public {
        // Stake 100 JEJU - at $0.10 = $10, should be BASIC tier
        vm.prank(user1);
        manager.stake(100 ether);
        assertEq(uint(manager.getTier(user1)), uint(IRPCStakingManager.Tier.BASIC));
        
        // Price increases to $1, now 100 JEJU = $100 = PRO tier
        priceOracle.setPrice(1e8); // $1.00
        assertEq(uint(manager.getTier(user1)), uint(IRPCStakingManager.Tier.PRO));
        
        // Price increases to $10, now 100 JEJU = $1000 = UNLIMITED tier
        priceOracle.setPrice(10e8); // $10.00
        assertEq(uint(manager.getTier(user1)), uint(IRPCStakingManager.Tier.UNLIMITED));
        
        // Price crashes to $0.01, now 100 JEJU = $1 = FREE tier
        priceOracle.setPrice(1e6); // $0.01
        assertEq(uint(manager.getTier(user1)), uint(IRPCStakingManager.Tier.FREE));
    }

    function testFallbackPrice() public {
        // Deploy manager without oracle
        RPCStakingManager noOracleManager = new RPCStakingManager(
            address(token),
            address(0),
            address(0), // No oracle
            owner
        );
        
        // Should use fallback price of $0.10
        assertEq(noOracleManager.getJejuPrice(), 1e7);
    }

    function testSetPriceOracle() public {
        MockPriceOracle newOracle = new MockPriceOracle();
        newOracle.setPrice(5e7); // $0.50
        
        manager.setPriceOracle(address(newOracle));
        assertEq(manager.getJejuPrice(), 5e7);
    }
}
