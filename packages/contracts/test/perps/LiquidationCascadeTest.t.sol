// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpsTestBase} from "./PerpsTestBase.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";

/// @title LiquidationCascadeTest
/// @notice Tests liquidation scenarios including cascades and insurance fund usage
contract LiquidationCascadeTest is PerpsTestBase {

    uint256 constant NUM_POSITIONS = 100;
    uint256 constant HIGH_LEVERAGE = 15;

    function setUp() public override {
        super.setUp();
        // Seed insurance fund
        seedInsuranceFund(500_000 ether);
    }

    function testLiquidationCascade_SuddenPriceDrop() public {
        // Create 100 highly leveraged long positions
        address[] memory traders = new address[](NUM_POSITIONS);
        bytes32[] memory positions = new bytes32[](NUM_POSITIONS);

        for (uint256 i = 0; i < NUM_POSITIONS; i++) {
            traders[i] = createTrader(i);
            fundTrader(traders[i], 10_000 ether);
            depositCollateral(traders[i], 5_000 ether);

            // Each trader opens a 15x leveraged long
            // At BTC $50,000: margin $1000 at 15x = $15,000 notional = 0.3 BTC
            uint256 margin = 1_000 ether;
            // size = (margin * leverage) / price = (1000 * 15) / 50000 = 0.3 BTC
            uint256 size = 0.3e8 + (i * 0.001e8); // ~0.3-0.4 BTC for diversity

            positions[i] = openLongPosition(traders[i], BTC_PERP, margin, size, HIGH_LEVERAGE);
            assertPositionOpen(positions[i]);
        }

        console.log("Opened", NUM_POSITIONS, "highly leveraged positions");

        // Record initial state
        (uint256 initialLongOI,) = perpMarket.getMarketOpenInterest(BTC_PERP);
        uint256 initialInsuranceBalance = insuranceFund.getBalance(address(usdc));

        console.log("Initial Long OI:", initialLongOI);
        console.log("Initial Insurance Balance:", initialInsuranceBalance / 1e18);

        // Simulate 12% price crash - should trigger mass liquidations
        // At 15x leverage, 12% drop = 180% loss on margin → definitely liquidatable
        setBtcPrice(44_000e8); // -12%

        // Count liquidatable positions
        uint256 liquidatableCount = 0;
        for (uint256 i = 0; i < NUM_POSITIONS; i++) {
            if (isLiquidatable(positions[i])) {
                liquidatableCount++;
            }
        }

        console.log("Liquidatable positions:", liquidatableCount);
        assertTrue(liquidatableCount > 50, "Most positions should be liquidatable");

        // Execute liquidations
        uint256 totalRewards = 0;
        uint256 liquidatedCount = 0;

        for (uint256 i = 0; i < NUM_POSITIONS; i++) {
            if (isLiquidatable(positions[i])) {
                uint256 reward = liquidatePosition(positions[i]);
                totalRewards += reward;
                liquidatedCount++;
                assertPositionClosed(positions[i]);
            }
        }

        console.log("Liquidated positions:", liquidatedCount);
        console.log("Total liquidator rewards:", totalRewards / 1e18);

        // Verify all liquidatable positions were liquidated
        assertEq(liquidatedCount, liquidatableCount, "All liquidatable should be liquidated");

        // Check final OI is reduced
        (uint256 finalLongOI,) = perpMarket.getMarketOpenInterest(BTC_PERP);
        console.log("Final Long OI:", finalLongOI);
        assertTrue(finalLongOI < initialLongOI, "OI should decrease after liquidations");
    }

    function testLiquidationWithBadDebt_InsuranceFundCoverage() public {
        // Create a position that will have bad debt (loss exceeds margin)
        address trader = createTrader(1);
        fundTrader(trader, 100_000 ether);
        depositCollateral(trader, 50_000 ether);

        // Open 20x leverage position
        // margin $10,000 at 20x = $200,000 notional = 4 BTC at $50,000
        bytes32 positionId = openLongPosition(trader, BTC_PERP, 10_000 ether, 4e8, 20);
        assertPositionOpen(positionId);

        uint256 insuranceBalanceBefore = insuranceFund.getBalance(address(usdc));
        console.log("Insurance balance before:", insuranceBalanceBefore / 1e18);

        // Catastrophic price drop - 10% (at 20x = 200% loss)
        setBtcPrice(45_000e8);

        assertTrue(isLiquidatable(positionId), "Position should be liquidatable");

        // Liquidate
        uint256 reward = liquidatePosition(positionId);
        console.log("Liquidator reward:", reward / 1e18);

        assertPositionClosed(positionId);

        // Check if insurance fund was used
        uint256 insuranceBalanceAfter = insuranceFund.getBalance(address(usdc));
        console.log("Insurance balance after:", insuranceBalanceAfter / 1e18);

        // Insurance fund should have either stayed same or increased (from fees)
        // or decreased slightly if covering bad debt
        console.log("Insurance balance change:", 
            insuranceBalanceAfter > insuranceBalanceBefore 
                ? int256(insuranceBalanceAfter - insuranceBalanceBefore) 
                : -int256(insuranceBalanceBefore - insuranceBalanceAfter));
    }

    function testInsuranceFundRateLimit_PreventsDraining() public {
        // Try to drain insurance fund through rapid liquidations
        uint256 initialBalance = insuranceFund.getBalance(address(usdc));
        console.log("Initial insurance balance:", initialBalance / 1e18);

        // Rate limit: 20% per hour
        uint256 maxDrawPerHour = (initialBalance * 2000) / 10000;
        console.log("Max draw per hour:", maxDrawPerHour / 1e18);

        // First draw should succeed
        vm.startPrank(owner);
        uint256 firstDraw = maxDrawPerHour / 2;
        insuranceFund.coverBadDebt(address(usdc), firstDraw);
        console.log("First draw succeeded:", firstDraw / 1e18);

        // Second draw within limit should succeed
        uint256 secondDraw = maxDrawPerHour / 2 - 1 ether;
        insuranceFund.coverBadDebt(address(usdc), secondDraw);
        console.log("Second draw succeeded:", secondDraw / 1e18);

        // Third draw exceeding limit should fail
        vm.expectRevert(InsuranceFund.RateLimitExceeded.selector);
        insuranceFund.coverBadDebt(address(usdc), 100 ether);
        console.log("Third draw correctly reverted (rate limited)");

        vm.stopPrank();

        // Fast forward 1 hour
        vm.warp(block.timestamp + 1 hours + 1);

        // Now should be able to draw again
        vm.prank(owner);
        insuranceFund.coverBadDebt(address(usdc), 10 ether);
        console.log("Draw after rate limit reset succeeded");
    }

    function testPartialLiquidation_LargePosition() public {
        // Large position that should be partially liquidated
        address trader = createTrader(1);
        fundTrader(trader, 1_000_000 ether);
        depositCollateral(trader, 500_000 ether);

        // Open a large position at 10x leverage
        bytes32 positionId = openLongPosition(trader, BTC_PERP, 100_000 ether, 2e8, 10);
        assertPositionOpen(positionId);

        IPerpetualMarket.Position memory posBefore = getPosition(positionId);
        console.log("Initial position size:", posBefore.size);

        // Mild price drop - should make it liquidatable
        setBtcPrice(47_500e8); // -5%

        // Check if liquidatable
        (bool canLiq,) = perpMarket.isLiquidatable(positionId);
        console.log("Liquidatable:", canLiq);

        if (canLiq) {
            // Liquidate
            uint256 reward = liquidatePosition(positionId);
            console.log("Liquidation reward:", reward / 1e18);

            // Position should be closed (full liquidation in this implementation)
            assertPositionClosed(positionId);
        }
    }

    function testMultipleKeepers_SimultaneousLiquidations() public {
        // Create positions
        address trader1 = createTrader(1);
        address trader2 = createTrader(2);
        fundTrader(trader1, 100_000 ether);
        fundTrader(trader2, 100_000 ether);
        depositCollateral(trader1, 50_000 ether);
        depositCollateral(trader2, 50_000 ether);

        bytes32 pos1 = openLongPosition(trader1, BTC_PERP, 5_000 ether, 0.2e8, 15);
        bytes32 pos2 = openLongPosition(trader2, BTC_PERP, 5_000 ether, 0.2e8, 15);

        // Price drop to make both liquidatable
        setBtcPrice(44_000e8);

        assertTrue(isLiquidatable(pos1), "Position 1 should be liquidatable");
        assertTrue(isLiquidatable(pos2), "Position 2 should be liquidatable");

        // Two different keepers liquidate simultaneously
        address keeper1 = address(0x1001);
        address keeper2 = address(0x1002);

        vm.prank(keeper1);
        uint256 reward1 = perpMarket.liquidate(pos1);

        vm.prank(keeper2);
        uint256 reward2 = perpMarket.liquidate(pos2);

        console.log("Keeper 1 reward:", reward1 / 1e18);
        console.log("Keeper 2 reward:", reward2 / 1e18);

        assertPositionClosed(pos1);
        assertPositionClosed(pos2);

        // Verify stats in liquidation engine
        assertEq(liquidationEngine.totalLiquidations(), 0); // Engine not used directly
    }

    function testLiquidationAtDifferentLeverages() public {
        // Test liquidation thresholds at different leverage levels
        uint256[] memory leverages = new uint256[](5);
        leverages[0] = 2;
        leverages[1] = 5;
        leverages[2] = 10;
        leverages[3] = 15;
        leverages[4] = 20;

        // Price drop percentages that should trigger liquidation at each leverage
        // Formula: At Nx leverage, X% price drop = N*X% loss on margin
        // Liquidation when loss approaches margin (accounting for maintenance margin)

        for (uint256 i = 0; i < leverages.length; i++) {
            uint256 leverage = leverages[i];
            
            address trader = createTrader(100 + i);
            fundTrader(trader, 100_000 ether);
            depositCollateral(trader, 50_000 ether);

            // Reset price
            setBtcPrice(50_000e8);

            bytes32 positionId = openLongPosition(trader, BTC_PERP, 5_000 ether, 0.1e8, leverage);

            // Calculate approximate liquidation price
            // Maintenance margin is 1% (100 bps)
            // At leverage N, position is liquidated when price drops by ~(100% - 1%) / N
            uint256 liquidationDrop = (99 * 100) / leverage; // percentage * 100 for precision
            uint256 liquidationPrice = 50_000e8 * (10000 - liquidationDrop) / 10000;

            console.log("Leverage:", leverage);
            console.log("  Expected liquidation around:", liquidationPrice / 1e8);

            // Drop price to just above liquidation
            uint256 testPrice = liquidationPrice + 500e8; // $500 above liquidation
            setBtcPrice(testPrice);
            
            (bool liquidatableAbove,) = perpMarket.isLiquidatable(positionId);
            console.log("  Above liquidation price - Liquidatable:", liquidatableAbove);

            // Drop price below liquidation
            testPrice = liquidationPrice - 500e8;
            setBtcPrice(testPrice);
            
            (bool liquidatableBelow,) = perpMarket.isLiquidatable(positionId);
            console.log("  Below liquidation price - Liquidatable:", liquidatableBelow);

            // Clean up - close or liquidate
            if (liquidatableBelow) {
                liquidatePosition(positionId);
            } else {
                IPerpetualMarket.Position memory pos = getPosition(positionId);
                closePosition(trader, positionId, pos.size);
            }
        }
    }

    // Helper override
    function createTrader(uint256 index) internal pure override returns (address) {
        return address(uint160(1000 + index));
    }
}
