// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpetualMarket} from "../../src/perps/PerpetualMarket.sol";
import {MarginManager} from "../../src/perps/MarginManager.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {OracleStakingManager} from "../../src/oracle-marketplace/OracleStakingManager.sol";
import {PriceFeedAggregator} from "../../src/oracle-marketplace/PriceFeedAggregator.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20, MockTokenRegistry, MockPriceOracle, MockPriceFeed} from "../mocks/PerpsMocks.sol";

contract PerpetualMarketTest is Test {
    PerpetualMarket public perpMarket;
    MarginManager public marginManager;
    InsuranceFund public insuranceFund;
    LiquidationEngine public liquidationEngine;
    MockPriceFeed public priceFeed;
    MockPriceOracle public priceOracle;
    MockTokenRegistry public tokenRegistry;
    MockERC20 public usdc;

    address public owner = address(1);
    address public trader1 = address(2);
    address public trader2 = address(3);
    address public liquidator = address(4);

    bytes32 public constant BTC_PERP = keccak256("BTC-PERP");
    bytes32 public constant ETH_PERP = keccak256("ETH-PERP");

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mocks
        usdc = new MockERC20("USDC", "USDC");
        priceOracle = new MockPriceOracle();
        tokenRegistry = new MockTokenRegistry();
        priceFeed = new MockPriceFeed();

        // Configure mocks
        tokenRegistry.setRegistered(address(usdc), true);
        priceOracle.setPrice(address(usdc), 1e18); // $1
        priceFeed.setPrice("BTC-USD", 50000 * 1e8, true); // $50,000
        priceFeed.setPrice("ETH-USD", 3000 * 1e8, true); // $3,000

        // Deploy insurance fund
        insuranceFund = new InsuranceFund(address(priceOracle), owner);

        // Deploy margin manager
        marginManager = new MarginManager(address(priceOracle), address(tokenRegistry), owner);

        // Deploy perp market
        perpMarket = new PerpetualMarket(
            address(marginManager),
            address(priceFeed),
            address(insuranceFund),
            owner, // fee receiver
            owner
        );

        // Deploy liquidation engine
        liquidationEngine =
            new LiquidationEngine(address(perpMarket), address(marginManager), address(insuranceFund), owner);

        // Configure permissions
        marginManager.setAuthorizedContract(address(perpMarket), true);
        marginManager.setAuthorizedContract(address(liquidationEngine), true);
        insuranceFund.setAuthorizedDrawer(address(perpMarket), true);
        insuranceFund.setAuthorizedDrawer(address(liquidationEngine), true);

        // Add USDC as collateral
        marginManager.addCollateralToken(address(usdc), 10000, 0); // 100% weight

        // Add insurance fund token support
        insuranceFund.addSupportedToken(address(usdc));

        // Add markets
        perpMarket.addMarket(
            BTC_PERP,
            "BTC-USD",
            address(0),
            20, // 20x max leverage
            500, // 5% maintenance margin
            5, // 0.05% taker fee
            2, // 0.02% maker fee
            1000000 * 1e8 // $1M max OI
        );

        perpMarket.addMarket(ETH_PERP, "ETH-USD", address(0), 20, 500, 5, 2, 1000000 * 1e8);

        vm.stopPrank();

        // Fund traders
        usdc.mint(trader1, 100000 * 1e18);
        usdc.mint(trader2, 100000 * 1e18);
        usdc.mint(liquidator, 10000 * 1e18);

        // Approve margin manager
        vm.prank(trader1);
        usdc.approve(address(marginManager), type(uint256).max);
        vm.prank(trader2);
        usdc.approve(address(marginManager), type(uint256).max);
    }

    // ============ Market Tests ============

    function testMarketCreation() public view {
        IPerpetualMarket.Market memory btcMarket = perpMarket.getMarket(BTC_PERP);
        assertEq(btcMarket.symbol, "BTC-USD");
        assertEq(btcMarket.maxLeverage, 20);
        assertEq(btcMarket.maintenanceMarginBps, 500);
        assertTrue(btcMarket.isActive);
    }

    function testGetAllMarkets() public view {
        bytes32[] memory markets = perpMarket.getAllMarkets();
        assertEq(markets.length, 2);
        assertEq(markets[0], BTC_PERP);
        assertEq(markets[1], ETH_PERP);
    }

    // ============ Collateral Tests ============

    function testDepositCollateral() public {
        vm.prank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        assertEq(marginManager.getCollateralBalance(trader1, address(usdc)), 10000 * 1e18);
    }

    function testWithdrawCollateral() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);
        marginManager.withdraw(address(usdc), 5000 * 1e18);
        vm.stopPrank();

        assertEq(marginManager.getCollateralBalance(trader1, address(usdc)), 5000 * 1e18);
    }

    // ============ Position Tests ============

    function testOpenLongPosition() public {
        // Deposit collateral
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        // Open 10x leveraged long position
        // $10,000 margin * 10x = $100,000 notional
        // At $50,000 BTC, that's 2 BTC
        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            10000 * 1e18, // margin
            2 * 1e8, // size (2 BTC in 8 decimals)
            IPerpetualMarket.PositionSide.Long,
            10 // leverage
        );
        vm.stopPrank();

        // Verify position
        IPerpetualMarket.Position memory pos = perpMarket.getPosition(result.positionId);
        assertTrue(pos.isOpen);
        assertEq(pos.trader, trader1);
        assertEq(uint8(pos.side), uint8(IPerpetualMarket.PositionSide.Long));
        assertEq(pos.size, 2 * 1e8);
        assertEq(pos.entryPrice, 50000 * 1e8);
    }

    function testOpenShortPosition() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            ETH_PERP,
            address(usdc),
            5000 * 1e18,
            10 * 1e8, // 10 ETH
            IPerpetualMarket.PositionSide.Short,
            6 // 6x leverage
        );
        vm.stopPrank();

        IPerpetualMarket.Position memory pos = perpMarket.getPosition(result.positionId);
        assertTrue(pos.isOpen);
        assertEq(uint8(pos.side), uint8(IPerpetualMarket.PositionSide.Short));
    }

    function testClosePosition() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        // Open position
        IPerpetualMarket.TradeResult memory openResult = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            5000 * 1e18,
            1 * 1e8, // 1 BTC
            IPerpetualMarket.PositionSide.Long,
            10
        );

        // Close position
        IPerpetualMarket.TradeResult memory closeResult = perpMarket.decreasePosition(
            openResult.positionId,
            type(uint256).max // Full close
        );
        vm.stopPrank();

        // Verify closed
        IPerpetualMarket.Position memory pos = perpMarket.getPosition(openResult.positionId);
        assertFalse(pos.isOpen);
    }

    function testCannotExceedMaxLeverage() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 1000 * 1e18);

        vm.expectRevert(PerpetualMarket.InvalidLeverage.selector);
        perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            1000 * 1e18,
            10 * 1e8, // Would require > 20x
            IPerpetualMarket.PositionSide.Long,
            25 // 25x > max 20x
        );
        vm.stopPrank();
    }

    // ============ PnL Tests ============

    function testUnrealizedPnlLong() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            5000 * 1e18,
            1 * 1e8, // 1 BTC at $50,000
            IPerpetualMarket.PositionSide.Long,
            10
        );
        vm.stopPrank();

        // Price goes up 10%
        priceFeed.setPrice("BTC-USD", 55000 * 1e8, true);

        (int256 unrealizedPnl,) = perpMarket.getPositionPnl(result.positionId);

        // 1 BTC * ($55,000 - $50,000) = $5,000 profit (in 18 decimals = margin token units)
        assertEq(unrealizedPnl, 5000 * 1e18);
    }

    function testUnrealizedPnlShort() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            5000 * 1e18,
            1 * 1e8, // 1 BTC at $50,000
            IPerpetualMarket.PositionSide.Short,
            10
        );
        vm.stopPrank();

        // Price goes down 10%
        priceFeed.setPrice("BTC-USD", 45000 * 1e8, true);

        (int256 unrealizedPnl,) = perpMarket.getPositionPnl(result.positionId);

        // Short profits when price goes down
        // 1 BTC * ($50,000 - $45,000) = $5,000 profit (in 18 decimals)
        assertEq(unrealizedPnl, 5000 * 1e18);
    }

    // ============ Liquidation Tests ============

    function testLiquidationCheck() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 5000 * 1e18);

        // Open 10x leveraged position
        // $5,000 margin * 10x = $50,000 notional = 1 BTC at $50,000
        // At 10x leverage, ~9-10% adverse move wipes out margin
        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            5000 * 1e18,
            1 * 1e8, // 1 BTC at $50,000
            IPerpetualMarket.PositionSide.Long,
            10 // 10x leverage
        );
        vm.stopPrank();

        // Initially not liquidatable
        (bool canLiq, uint256 healthBefore) = perpMarket.isLiquidatable(result.positionId);
        assertFalse(canLiq);
        assertGt(healthBefore, 1e18); // Health > 1

        // Price drops 10% - should trigger liquidation at 10x leverage
        // 10% drop = 100% of margin as loss (10x leverage)
        // PnL = 1 BTC * -$5,000 = -$5,000 (wipes out margin)
        priceFeed.setPrice("BTC-USD", 45000 * 1e8, true); // -10%

        // Now should be liquidatable (margin wiped out)
        (canLiq,) = perpMarket.isLiquidatable(result.positionId);
        assertTrue(canLiq);
    }

    // ============ Funding Tests ============

    function testFundingRateUpdate() public {
        // Warp time forward
        vm.warp(block.timestamp + 8 hours);

        // Update funding
        perpMarket.updateFunding(BTC_PERP);

        // Check funding rate (should be 0 initially since mark = index)
        int256 rate = perpMarket.getFundingRate(BTC_PERP);
        assertEq(rate, 0);
    }

    // ============ Insurance Fund Tests ============

    function testInsuranceFundDeposit() public {
        usdc.mint(address(this), 10000 * 1e18);
        usdc.approve(address(insuranceFund), 10000 * 1e18);

        insuranceFund.deposit(address(usdc), 10000 * 1e18);

        assertEq(insuranceFund.getBalance(address(usdc)), 10000 * 1e18);
    }

    // ============ View Function Tests ============

    function testGetTraderPositions() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 20000 * 1e18);

        perpMarket.openPosition(BTC_PERP, address(usdc), 5000 * 1e18, 1 * 1e8, IPerpetualMarket.PositionSide.Long, 10);
        perpMarket.openPosition(ETH_PERP, address(usdc), 3000 * 1e18, 10 * 1e8, IPerpetualMarket.PositionSide.Short, 10);
        vm.stopPrank();

        bytes32[] memory positions = perpMarket.getTraderPositions(trader1);
        assertEq(positions.length, 2);
    }

    function testGetOpenInterest() public {
        vm.startPrank(trader1);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        perpMarket.openPosition(BTC_PERP, address(usdc), 5000 * 1e18, 2 * 1e8, IPerpetualMarket.PositionSide.Long, 10);
        vm.stopPrank();

        vm.startPrank(trader2);
        marginManager.deposit(address(usdc), 10000 * 1e18);

        perpMarket.openPosition(BTC_PERP, address(usdc), 5000 * 1e18, 1 * 1e8, IPerpetualMarket.PositionSide.Short, 10);
        vm.stopPrank();

        (uint256 longOI, uint256 shortOI) = perpMarket.getMarketOpenInterest(BTC_PERP);
        assertEq(longOI, 2 * 1e8);
        assertEq(shortOI, 1 * 1e8);
    }
}
