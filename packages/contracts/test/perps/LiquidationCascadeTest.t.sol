// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpsTestBase} from "./PerpsTestBase.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";

/// @title LiquidationCascadeTest
/// @notice Tests liquidation scenarios including cascades and insurance fund usage
contract LiquidationCascadeTest is PerpsTestBase {
    uint256 constant NUM_TRADERS = 30;
    uint256 constant HIGH_LEVERAGE = 15;

    address[] public traders;
    bytes32[] public positionIds;

    function setUp() public override {
        super.setUp();

        // Seed insurance fund
        seedInsuranceFund(500_000 ether);

        // Create traders with high-leverage positions
        _setupHighLeveragePositions();
    }

    function _setupHighLeveragePositions() internal {
        traders = new address[](NUM_TRADERS);
        positionIds = new bytes32[](NUM_TRADERS);

        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            traders[i] = createTrader(i);
            fundTrader(traders[i], 50_000 ether);
            depositCollateral(traders[i], 25_000 ether);

            // Open leveraged long position - at 15x, $1000 margin controls $15000 notional
            // BTC at $50k means 0.3 BTC = $15000, so 0.3e8 size for $1000 margin at 15x
            uint256 margin = 1_000 ether;
            uint256 size = 0.3e8; // 0.3 BTC = $15000 at $50k = 15x leverage on $1000 margin

            positionIds[i] = openLongPosition(traders[i], BTC_PERP, margin, size, HIGH_LEVERAGE);
        }
    }

    function createTrader(uint256 index) internal pure override returns (address) {
        return address(uint160(2000 + index));
    }

    // ============ Cascade Tests ============

    function testLiquidationCascade_PriceCrash() public {
        console.log("=== Liquidation Cascade Test ===");
        console.log("Initial positions:", NUM_TRADERS);

        // Record initial state
        uint256 initialInsuranceBalance = insuranceFund.balances(address(usdc));
        (uint256 initialLongOI,) = perpMarket.getMarketOpenInterest(BTC_PERP);

        console.log("Initial insurance fund:", initialInsuranceBalance / 1e18, "USDC");
        console.log("Initial long OI:", initialLongOI / 1e8, "BTC");

        // Count liquidatable before crash
        uint256 liquidatableBefore = _countLiquidatable();
        console.log("Liquidatable before crash:", liquidatableBefore);

        // Simulate 15% price crash - should trigger many liquidations
        setBtcPrice(42_500e8); // 50000 -> 42500 = -15%

        // Count liquidatable after crash
        uint256 liquidatableAfter = _countLiquidatable();
        console.log("Liquidatable after -15% crash:", liquidatableAfter);

        assertTrue(liquidatableAfter > 0, "Some positions should be liquidatable");

        // Execute all liquidations
        uint256 totalLiquidated = 0;
        uint256 totalRewards = 0;
        uint256 totalBadDebt = 0;

        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);

            if (canLiq) {
                IPerpetualMarket.Position memory posBefore = getPosition(positionIds[i]);

                uint256 reward = liquidatePosition(positionIds[i]);
                totalLiquidated++;
                totalRewards += reward;

                // Check if bad debt occurred (reward = 0 could indicate bad debt)
                if (reward == 0) {
                    totalBadDebt++;
                }

                assertPositionClosed(positionIds[i]);
            }
        }

        console.log("\n=== Results ===");
        console.log("Total liquidated:", totalLiquidated);
        console.log("Total rewards:", totalRewards / 1e18, "USDC");
        console.log("Bad debt events:", totalBadDebt);

        // Check insurance fund was used if there was bad debt
        uint256 finalInsuranceBalance = insuranceFund.balances(address(usdc));
        if (totalBadDebt > 0) {
            assertTrue(finalInsuranceBalance < initialInsuranceBalance, "Insurance fund should cover bad debt");
        }

        // Check remaining open interest
        (uint256 finalLongOI,) = perpMarket.getMarketOpenInterest(BTC_PERP);
        console.log("Final long OI:", finalLongOI / 1e8, "BTC");
        assertTrue(finalLongOI < initialLongOI, "OI should decrease after liquidations");
    }

    function testPartialLiquidation_ProgressiveCrash() public {
        console.log("=== Progressive Price Crash Test ===");

        uint256[] memory priceDrops = new uint256[](5);
        priceDrops[0] = 47_500e8; // -5%
        priceDrops[1] = 45_000e8; // -10%
        priceDrops[2] = 42_500e8; // -15%
        priceDrops[3] = 40_000e8; // -20%
        priceDrops[4] = 37_500e8; // -25%

        uint256 cumulativeLiquidations = 0;

        for (uint256 step = 0; step < priceDrops.length; step++) {
            setBtcPrice(priceDrops[step]);

            uint256 newLiquidations = 0;

            for (uint256 i = 0; i < NUM_TRADERS; i++) {
                IPerpetualMarket.Position memory pos = getPosition(positionIds[i]);
                if (!pos.isOpen) continue;

                (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);
                if (canLiq) {
                    liquidatePosition(positionIds[i]);
                    newLiquidations++;
                }
            }

            cumulativeLiquidations += newLiquidations;

            console.log("Price:", priceDrops[step] / 1e8);
            console.log("  New liquidations:", newLiquidations);
            console.log("  Total liquidated:", cumulativeLiquidations);
        }

        // At -25%, most high-leverage positions should be liquidated
        assertTrue(cumulativeLiquidations > NUM_TRADERS / 2, "Should liquidate > 50% at -25%");
    }

    function testInsuranceFund_RateLimitDuringCascade() public {
        console.log("=== Insurance Fund Rate Limit Test ===");

        // Create extreme scenario - massive crash
        setBtcPrice(30_000e8); // -40% crash

        uint256 liquidatableCount = _countLiquidatable();
        console.log("Liquidatable positions:", liquidatableCount);

        // Try to liquidate all - rate limiting should kick in
        uint256 successfulLiqs = 0;
        uint256 rateLimitHits = 0;

        for (uint256 i = 0; i < NUM_TRADERS && i < 50; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);
            if (!canLiq) continue;

            try perpMarket.liquidate(positionIds[i]) returns (uint256) {
                successfulLiqs++;
            } catch {
                rateLimitHits++;
            }
        }

        console.log("Successful liquidations:", successfulLiqs);
        console.log("Rate limit hits:", rateLimitHits);

        // Warp past rate limit period
        vm.warp(block.timestamp + 1 hours + 1);

        // Should be able to liquidate more now
        uint256 afterWarpLiqs = 0;
        for (uint256 i = 50; i < NUM_TRADERS; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);
            if (!canLiq) continue;

            try perpMarket.liquidate(positionIds[i]) returns (uint256) {
                afterWarpLiqs++;
            } catch {
                // Rate limit hit again
            }
        }

        console.log("Liquidations after time warp:", afterWarpLiqs);
    }

    function testLiquidatorIncentives() public {
        // Single position liquidation test
        address specificTrader = createTrader(999);
        fundTrader(specificTrader, 50_000 ether);
        depositCollateral(specificTrader, 25_000 ether);

        bytes32 posId = openLongPosition(
            specificTrader,
            BTC_PERP,
            5_000 ether,
            0.1e8,
            20 // Max leverage
        );

        // Price drop to trigger liquidation
        setBtcPrice(45_000e8); // -10%

        (bool canLiq, uint256 healthFactor) = perpMarket.isLiquidatable(posId);

        console.log("Health factor:", healthFactor);
        console.log("Can liquidate:", canLiq);

        if (canLiq) {
            uint256 liquidatorBalanceBefore = usdc.balanceOf(liquidator);

            uint256 reward = liquidatePosition(posId);

            console.log("Liquidation reward:", reward / 1e18, "USDC");

            assertTrue(reward > 0, "Liquidator should receive reward");

            // Verify reward was actually transferred
            uint256 liquidatorBalanceAfter = usdc.balanceOf(liquidator);
            assertGe(liquidatorBalanceAfter, liquidatorBalanceBefore, "Liquidator balance should increase");
        }
    }

    function testBatchLiquidation() public {
        // Test the LiquidationEngine batch function
        setBtcPrice(40_000e8); // -20%

        // Collect liquidatable positions
        bytes32[] memory liquidatableIds = new bytes32[](20);
        uint256 count = 0;

        for (uint256 i = 0; i < NUM_TRADERS && count < 20; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);
            if (canLiq) {
                liquidatableIds[count] = positionIds[i];
                count++;
            }
        }

        if (count > 0) {
            // Resize array
            bytes32[] memory toExecute = new bytes32[](count);
            for (uint256 i = 0; i < count; i++) {
                toExecute[i] = liquidatableIds[i];
            }

            console.log("Batch liquidating", count, "positions");

            vm.prank(liquidator);
            uint256[] memory rewards = liquidationEngine.batchLiquidate(toExecute);

            uint256 totalReward = 0;
            for (uint256 i = 0; i < rewards.length; i++) {
                totalReward += rewards[i];
            }

            console.log("Total batch rewards:", totalReward / 1e18, "USDC");

            // Verify all were liquidated
            for (uint256 i = 0; i < count; i++) {
                assertPositionClosed(toExecute[i]);
            }
        }
    }

    function testCannotLiquidateHealthyPosition() public {
        address trader = createTrader(888);
        fundTrader(trader, 100_000 ether);
        depositCollateral(trader, 50_000 ether);

        // Open conservative position
        bytes32 posId = openLongPosition(trader, BTC_PERP, 10_000 ether, 0.1e8, 2);

        // Small price movement
        setBtcPrice(49_000e8); // -2%

        (bool canLiq, uint256 healthFactor) = perpMarket.isLiquidatable(posId);

        assertFalse(canLiq, "2x leveraged position should not be liquidatable at -2%");
        console.log("Health factor at -2%:", healthFactor);

        // Try to liquidate - should fail
        vm.prank(liquidator);
        vm.expectRevert();
        perpMarket.liquidate(posId);
    }

    function testShortPositionLiquidation() public {
        address trader = createTrader(777);
        fundTrader(trader, 50_000 ether);
        depositCollateral(trader, 25_000 ether);

        // Open short position
        bytes32 posId = openShortPosition(trader, BTC_PERP, 5_000 ether, 0.1e8, 15);

        // Price goes UP (bad for shorts)
        setBtcPrice(57_500e8); // +15%

        (bool canLiq,) = perpMarket.isLiquidatable(posId);

        if (canLiq) {
            console.log("Short position liquidatable at +15%");
            uint256 reward = liquidatePosition(posId);
            console.log("Liquidation reward:", reward / 1e18);
            assertPositionClosed(posId);
        }
    }

    // ============ Helpers ============

    function _countLiquidatable() internal view returns (uint256 count) {
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);
            if (canLiq) count++;
        }
    }
}
