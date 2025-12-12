// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpetualMarket} from "../../src/perps/PerpetualMarket.sol";
import {MarginManager} from "../../src/perps/MarginManager.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {MockERC20, MockTokenRegistry, MockPriceOracle, MockPriceFeed} from "../mocks/PerpsMocks.sol";

/// @title PerpsTestBase
/// @notice Base contract for perps tests with common setup and utilities
abstract contract PerpsTestBase is Test {
    // Core contracts
    PerpetualMarket public perpMarket;
    MarginManager public marginManager;
    InsuranceFund public insuranceFund;
    LiquidationEngine public liquidationEngine;

    // Mocks
    MockPriceFeed public priceFeed;
    MockPriceOracle public priceOracle;
    MockTokenRegistry public tokenRegistry;
    MockERC20 public usdc;
    MockERC20 public weth;

    // Test actors
    address public owner = address(1);
    address public feeReceiver = address(2);
    address public liquidator = address(100);

    // Market IDs
    bytes32 public constant BTC_PERP = keccak256("BTC-PERP");
    bytes32 public constant ETH_PERP = keccak256("ETH-PERP");

    // Default market parameters
    uint256 public constant DEFAULT_MAX_LEVERAGE = 20;
    uint256 public constant DEFAULT_MAINTENANCE_MARGIN_BPS = 100; // 1%
    uint256 public constant DEFAULT_MAKER_FEE_BPS = 10; // 0.1%
    uint256 public constant DEFAULT_TAKER_FEE_BPS = 5; // 0.05%
    uint256 public constant DEFAULT_MAX_OI = 1_000_000 ether;

    // Initial prices (8 decimals)
    uint256 public constant BTC_PRICE = 50_000e8;
    uint256 public constant ETH_PRICE = 3_000e8;

    function setUp() public virtual {
        vm.startPrank(owner);

        // Deploy mocks (using 18 decimals for consistency)
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");
        priceOracle = new MockPriceOracle();
        tokenRegistry = new MockTokenRegistry();
        priceFeed = new MockPriceFeed();

        // Configure mocks
        tokenRegistry.setRegistered(address(usdc), true);
        tokenRegistry.setRegistered(address(weth), true);
        priceOracle.setPrice(address(usdc), 1e18); // $1
        priceOracle.setPrice(address(weth), 3_000e18); // $3000
        priceFeed.setPrice("BTC-USD", BTC_PRICE, true);
        priceFeed.setPrice("ETH-USD", ETH_PRICE, true);

        // Deploy InsuranceFund
        insuranceFund = new InsuranceFund(address(priceOracle), owner);
        insuranceFund.addSupportedToken(address(usdc));
        insuranceFund.addSupportedToken(address(weth));

        // Deploy MarginManager
        marginManager = new MarginManager(
            address(priceOracle),
            address(tokenRegistry),
            owner
        );
        marginManager.addCollateralToken(address(usdc), 10000, 0); // 100% weight, no max
        marginManager.addCollateralToken(address(weth), 9500, 0); // 95% weight

        // Deploy PerpetualMarket
        perpMarket = new PerpetualMarket(
            address(marginManager),
            address(priceFeed),
            address(insuranceFund),
            feeReceiver,
            owner
        );

        // Add markets
        perpMarket.addMarket(BTC_PERP, "BTC-USD", address(0), DEFAULT_MAX_LEVERAGE, DEFAULT_MAINTENANCE_MARGIN_BPS, DEFAULT_MAKER_FEE_BPS, DEFAULT_TAKER_FEE_BPS, DEFAULT_MAX_OI);
        perpMarket.addMarket(ETH_PERP, "ETH-USD", address(0), DEFAULT_MAX_LEVERAGE, DEFAULT_MAINTENANCE_MARGIN_BPS, DEFAULT_MAKER_FEE_BPS, DEFAULT_TAKER_FEE_BPS, DEFAULT_MAX_OI);

        // Deploy LiquidationEngine
        liquidationEngine = new LiquidationEngine(
            address(perpMarket),
            address(marginManager),
            address(insuranceFund),
            owner
        );

        // Set authorizations
        marginManager.setAuthorizedContract(address(perpMarket), true);
        marginManager.setAuthorizedContract(address(liquidationEngine), true);
        insuranceFund.setAuthorizedDrawer(address(perpMarket), true);
        insuranceFund.setAuthorizedDrawer(address(liquidationEngine), true);

        vm.stopPrank();
    }

    // ============ Helper Functions ============

    function createTrader(uint256 index) internal pure virtual returns (address) {
        return address(uint160(1000 + index));
    }

    function fundTrader(address trader, uint256 usdcAmount) internal {
        usdc.mint(trader, usdcAmount);
    }

    function fundTraderWeth(address trader, uint256 wethAmount) internal {
        weth.mint(trader, wethAmount);
    }

    function depositCollateral(address trader, uint256 amount) internal {
        vm.startPrank(trader);
        usdc.approve(address(marginManager), amount);
        marginManager.deposit(address(usdc), amount);
        vm.stopPrank();
    }

    function openLongPosition(
        address trader,
        bytes32 marketId,
        uint256 margin,
        uint256 size,
        uint256 leverage
    ) internal returns (bytes32 positionId) {
        vm.startPrank(trader);
        usdc.approve(address(perpMarket), margin);
        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            marketId,
            address(usdc),
            margin,
            size,
            IPerpetualMarket.PositionSide.Long,
            leverage
        );
        positionId = result.positionId;
        vm.stopPrank();
    }

    function openShortPosition(
        address trader,
        bytes32 marketId,
        uint256 margin,
        uint256 size,
        uint256 leverage
    ) internal returns (bytes32 positionId) {
        vm.startPrank(trader);
        usdc.approve(address(perpMarket), margin);
        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            marketId,
            address(usdc),
            margin,
            size,
            IPerpetualMarket.PositionSide.Short,
            leverage
        );
        positionId = result.positionId;
        vm.stopPrank();
    }

    function closePosition(address trader, bytes32 positionId, uint256 size) internal returns (int256 pnl) {
        vm.startPrank(trader);
        IPerpetualMarket.TradeResult memory result = perpMarket.decreasePosition(positionId, size);
        pnl = result.realizedPnl;
        vm.stopPrank();
    }

    function setPrice(string memory asset, uint256 price) internal {
        priceFeed.setPrice(asset, price, true);
    }

    function setBtcPrice(uint256 price) internal {
        setPrice("BTC-USD", price);
    }

    function setEthPrice(uint256 price) internal {
        setPrice("ETH-USD", price);
    }

    function liquidatePosition(bytes32 positionId) internal returns (uint256 reward) {
        vm.prank(liquidator);
        reward = perpMarket.liquidate(positionId);
    }

    function isLiquidatable(bytes32 positionId) internal view returns (bool) {
        (bool canLiq,) = perpMarket.isLiquidatable(positionId);
        return canLiq;
    }

    function getPosition(bytes32 positionId) internal view returns (IPerpetualMarket.Position memory) {
        return perpMarket.getPosition(positionId);
    }

    function getUnrealizedPnl(bytes32 positionId) internal view returns (int256 pnl) {
        (pnl,) = perpMarket.getPositionPnl(positionId);
    }

    function seedInsuranceFund(uint256 amount) internal {
        vm.startPrank(owner);
        usdc.mint(owner, amount);
        usdc.approve(address(insuranceFund), amount);
        insuranceFund.deposit(address(usdc), amount);
        vm.stopPrank();
    }

    // ============ Assertions ============

    function assertPositionOpen(bytes32 positionId) internal view {
        IPerpetualMarket.Position memory pos = getPosition(positionId);
        assertTrue(pos.isOpen, "Position should be open");
    }

    function assertPositionClosed(bytes32 positionId) internal view {
        IPerpetualMarket.Position memory pos = getPosition(positionId);
        assertFalse(pos.isOpen, "Position should be closed");
    }

    function assertProfitable(bytes32 positionId) internal view {
        int256 pnl = getUnrealizedPnl(positionId);
        assertTrue(pnl > 0, "Position should be profitable");
    }

    function assertUnprofitable(bytes32 positionId) internal view {
        int256 pnl = getUnrealizedPnl(positionId);
        assertTrue(pnl < 0, "Position should be unprofitable");
    }
}

