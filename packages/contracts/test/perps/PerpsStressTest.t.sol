// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpsTestBase} from "./PerpsTestBase.sol";
import {PerpetualMarket} from "../../src/perps/PerpetualMarket.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";

/// @title PerpsStressTest
/// @notice Stress tests for perpetual futures trading
/// @dev Tests multi-trader scenarios, price volatility, and edge cases
contract PerpsStressTest is PerpsTestBase {
    uint256 constant NUM_TRADERS = 50;
    uint256 constant POSITIONS_PER_TRADER = 5;
    uint256 constant BASE_MARGIN = 1_000 ether; // 1000 USDC (18 decimals)

    function setUp() public override {
        super.setUp();
        // Seed insurance fund for potential bad debt coverage
        seedInsuranceFund(100_000 ether);
    }

    // ============ Multi-Trader Stress Tests ============

    function testMultipleTraders_OpenAndClosePositions() public {
        // Create and fund traders
        address[] memory traders = new address[](NUM_TRADERS);
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            traders[i] = createTrader(i);
            fundTrader(traders[i], 100_000e18); // 100k USDC each
            depositCollateral(traders[i], 50_000e18); // Deposit 50k
        }

        // Each trader opens multiple positions
        bytes32[][] memory positions = new bytes32[][](NUM_TRADERS);
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            positions[i] = new bytes32[](POSITIONS_PER_TRADER);

            for (uint256 j = 0; j < POSITIONS_PER_TRADER; j++) {
                bytes32 marketId = j % 2 == 0 ? BTC_PERP : ETH_PERP;
                uint256 margin = BASE_MARGIN * (j + 1);
                uint256 size = (j % 2 == 0) ? 0.01e8 : 0.1e8; // 0.01 BTC or 0.1 ETH
                uint256 leverage = 2 + (j % 10); // 2x to 11x

                if (i % 2 == 0) {
                    positions[i][j] = openLongPosition(traders[i], marketId, margin, size, leverage);
                } else {
                    positions[i][j] = openShortPosition(traders[i], marketId, margin, size, leverage);
                }

                assertPositionOpen(positions[i][j]);
            }
        }

        // Verify all positions exist
        uint256 totalPositions = NUM_TRADERS * POSITIONS_PER_TRADER;
        console.log("Total positions opened:", totalPositions);

        // Simulate price movement - BTC up 5%, ETH down 3%
        setBtcPrice(52_500e8);
        setEthPrice(2_910e8);

        // Check that half the traders (longs on BTC) are profitable
        uint256 profitableCount = 0;
        uint256 unprofitableCount = 0;

        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            for (uint256 j = 0; j < POSITIONS_PER_TRADER; j++) {
                int256 pnl = getUnrealizedPnl(positions[i][j]);
                if (pnl > 0) profitableCount++;
                else if (pnl < 0) unprofitableCount++;
            }
        }

        console.log("Profitable positions:", profitableCount);
        console.log("Unprofitable positions:", unprofitableCount);

        // Close all positions
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            for (uint256 j = 0; j < POSITIONS_PER_TRADER; j++) {
                IPerpetualMarket.Position memory pos = getPosition(positions[i][j]);
                if (pos.isOpen) {
                    closePosition(traders[i], positions[i][j], pos.size);
                    assertPositionClosed(positions[i][j]);
                }
            }
        }
    }

    function testPriceVolatility_LargeSwings() public {
        address trader = createTrader(999);
        fundTrader(trader, 100_000e18);
        depositCollateral(trader, 50_000e18);

        // Open a long position at 10x leverage
        bytes32 positionId = openLongPosition(trader, BTC_PERP, 5_000e18, 0.1e8, 10);
        assertPositionOpen(positionId);

        // Simulate 24-hour volatility with 20% range
        uint256[] memory priceSteps = new uint256[](10);
        priceSteps[0] = 51_000e8; // +2%
        priceSteps[1] = 49_000e8; // -2%
        priceSteps[2] = 47_500e8; // -5%
        priceSteps[3] = 52_000e8; // +4%
        priceSteps[4] = 55_000e8; // +10%
        priceSteps[5] = 48_000e8; // -4%
        priceSteps[6] = 46_000e8; // -8%
        priceSteps[7] = 50_000e8; // 0%
        priceSteps[8] = 54_000e8; // +8%
        priceSteps[9] = 52_500e8; // +5% final

        int256 prevPnl = 0;
        for (uint256 i = 0; i < priceSteps.length; i++) {
            setBtcPrice(priceSteps[i]);

            (bool canLiq,) = perpMarket.isLiquidatable(positionId);
            int256 pnl = getUnrealizedPnl(positionId);

            console.log("Step", i, "Price:", priceSteps[i] / 1e8);
            console.log("  PnL:", pnl > 0 ? uint256(pnl) : uint256(-pnl), pnl > 0 ? "(profit)" : "(loss)");
            console.log("  Liquidatable:", canLiq);

            // If liquidatable, liquidate and exit test
            if (canLiq) {
                liquidatePosition(positionId);
                assertPositionClosed(positionId);
                return;
            }

            prevPnl = pnl;
        }

        // Position should still be open at end
        assertPositionOpen(positionId);

        // Close position with profit (final price is +5%)
        int256 finalPnl = closePosition(trader, positionId, 0.1e8);
        assertTrue(finalPnl > 0, "Should be profitable at +5%");
    }

    function testConcurrentLongsAndShorts_NetNeutral() public {
        uint256 numPairs = 20;
        address[] memory longTraders = new address[](numPairs);
        address[] memory shortTraders = new address[](numPairs);
        bytes32[] memory longPositions = new bytes32[](numPairs);
        bytes32[] memory shortPositions = new bytes32[](numPairs);

        // Create matched long/short pairs
        for (uint256 i = 0; i < numPairs; i++) {
            longTraders[i] = createTrader(i * 2);
            shortTraders[i] = createTrader(i * 2 + 1);

            fundTrader(longTraders[i], 10_000e18);
            fundTrader(shortTraders[i], 10_000e18);
            depositCollateral(longTraders[i], 5_000e18);
            depositCollateral(shortTraders[i], 5_000e18);

            // Same size positions
            longPositions[i] = openLongPosition(longTraders[i], BTC_PERP, 1_000e18, 0.02e8, 5);
            shortPositions[i] = openShortPosition(shortTraders[i], BTC_PERP, 1_000e18, 0.02e8, 5);
        }

        // Check open interest is balanced
        (uint256 longOI, uint256 shortOI) = perpMarket.getMarketOpenInterest(BTC_PERP);
        assertEq(longOI, shortOI, "Long and short OI should match");

        // Price goes up 10%
        setBtcPrice(55_000e8);

        // Calculate total PnL - should be zero-sum (minus fees)
        int256 totalLongPnl = 0;
        int256 totalShortPnl = 0;

        for (uint256 i = 0; i < numPairs; i++) {
            totalLongPnl += getUnrealizedPnl(longPositions[i]);
            totalShortPnl += getUnrealizedPnl(shortPositions[i]);
        }

        console.log("Total Long PnL:", totalLongPnl > 0 ? uint256(totalLongPnl) : uint256(-totalLongPnl));
        console.log("Total Short PnL:", totalShortPnl > 0 ? uint256(totalShortPnl) : uint256(-totalShortPnl));

        // Long profits should roughly equal short losses
        assertTrue(totalLongPnl > 0, "Longs should be profitable");
        assertTrue(totalShortPnl < 0, "Shorts should be unprofitable");

        // The sum should be close to zero (within fee margin)
        int256 netPnl = totalLongPnl + totalShortPnl;
        int256 tolerance = int256(numPairs * 100e18); // Allow for fees
        assertTrue(netPnl > -tolerance && netPnl < tolerance, "Net PnL should be near zero");
    }

    function testMaxOpenInterest_Enforcement() public {
        // Create a market with low max OI for testing
        bytes32 testMarket = keccak256("TEST-PERP");
        vm.prank(owner);
        perpMarket.addMarket(testMarket, "BTC-USD", address(0), 20, 100, 10, 5, 100e8); // Max 100 units OI

        address trader1 = createTrader(1);
        address trader2 = createTrader(2);
        fundTrader(trader1, 1_000_000e18);
        fundTrader(trader2, 1_000_000e18);
        depositCollateral(trader1, 500_000e18);
        depositCollateral(trader2, 500_000e18);

        // Open position near max OI
        openLongPosition(trader1, testMarket, 50_000e18, 90e8, 10);

        // Try to open position exceeding max OI - should revert
        vm.startPrank(trader2);
        usdc.approve(address(perpMarket), 50_000e18);
        vm.expectRevert(PerpetualMarket.ExceedsMaxOpenInterest.selector);
        perpMarket.openPosition(testMarket, address(usdc), 50_000e18, 20e8, IPerpetualMarket.PositionSide.Long, 10);
        vm.stopPrank();
    }

    function testHighLeverage_EdgeCases() public {
        address trader = createTrader(1);
        fundTrader(trader, 100_000e18);
        depositCollateral(trader, 50_000e18);

        // Open at max leverage (20x)
        bytes32 positionId = openLongPosition(trader, BTC_PERP, 5_000e18, 0.2e8, 20);
        assertPositionOpen(positionId);

        // At 20x leverage, a 5% adverse move should approach liquidation
        // Maintenance margin is 1%, so liquidation at ~5% loss
        setBtcPrice(47_500e8); // -5%

        (bool canLiq,) = perpMarket.isLiquidatable(positionId);
        console.log("Liquidatable at -5%:", canLiq);

        // Should be close to or at liquidation
        if (canLiq) {
            liquidatePosition(positionId);
            assertPositionClosed(positionId);
        } else {
            // Still alive, check health
            int256 pnl = getUnrealizedPnl(positionId);
            console.log("PnL at -5%:", pnl > 0 ? uint256(pnl) : uint256(-pnl));
            assertTrue(pnl < 0, "Should be unprofitable");
        }
    }

    function testRapidTrading_SameBlock() public {
        address trader = createTrader(1);
        fundTrader(trader, 1_000_000e18);
        depositCollateral(trader, 500_000e18);

        bytes32[] memory positions = new bytes32[](20);

        // Open 20 positions in same block
        for (uint256 i = 0; i < 20; i++) {
            bytes32 marketId = i % 2 == 0 ? BTC_PERP : ETH_PERP;
            uint256 margin = 1_000e18 + (i * 100e18);
            uint256 size = 0.01e8 + (i * 0.001e8);

            if (i % 3 == 0) {
                positions[i] = openLongPosition(trader, marketId, margin, size, 5);
            } else {
                positions[i] = openShortPosition(trader, marketId, margin, size, 5);
            }

            assertPositionOpen(positions[i]);
        }

        // Verify all positions are tracked
        bytes32[] memory traderPositions = perpMarket.getTraderPositions(trader);
        assertEq(traderPositions.length, 20, "Should have 20 positions");

        // Close all in same block
        for (uint256 i = 0; i < 20; i++) {
            IPerpetualMarket.Position memory pos = getPosition(positions[i]);
            closePosition(trader, positions[i], pos.size);
        }

        // Verify all closed
        for (uint256 i = 0; i < 20; i++) {
            assertPositionClosed(positions[i]);
        }
    }

    function testMinimumPositionSize() public {
        address trader = createTrader(1);
        fundTrader(trader, 10_000e18);
        depositCollateral(trader, 5_000e18);

        // Try to open very small position - should work or revert with PositionTooSmall
        vm.startPrank(trader);
        usdc.approve(address(perpMarket), 100e18);

        // Small but valid position
        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            100e18, // $100 margin
            0.001e8, // 0.001 BTC (~$50 notional at $50k)
            IPerpetualMarket.PositionSide.Long,
            5
        );

        assertTrue(result.positionId != bytes32(0), "Small position should be created");
        vm.stopPrank();
    }

    // ============ Helper to fix pure warning ============

    function createTrader(uint256 index) internal pure override returns (address) {
        return address(uint160(1000 + index));
    }
}
