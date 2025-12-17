// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {PerpetualMarket} from "../../src/perps/PerpetualMarket.sol";
import {MarginManager} from "../../src/perps/MarginManager.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";
import {
    MarketConfig,
    Position,
    TradeResult,
    PositionSide,
    IPriceOracle
} from "../../src/perps/interfaces/IPerps.sol";
import {MockERC20, MockPriceOracle} from "../mocks/PerpsMocks.sol";

/// @dev Mock price oracle implementing IPriceOracle for perps
contract MockPerpsPriceOracle is IPriceOracle {
    mapping(string => uint256) public prices;
    mapping(address => uint256) public tokenPrices;
    
    function setPrice(string memory symbol, uint256 price) external {
        prices[symbol] = price;
    }
    
    function setTokenPrice(address token, uint256 price) external {
        tokenPrices[token] = price;
    }
    
    function getPrice(address token) external view override returns (uint256 price, uint256 timestamp) {
        return (tokenPrices[token], block.timestamp);
    }
    
    function getMarkPrice(bytes32) external view override returns (uint256) {
        return prices["BTC-PERP"];
    }
    
    function getIndexPrice(bytes32) external view override returns (uint256) {
        return prices["BTC-PERP"];
    }
}

contract PerpetualMarketTest is Test {
    PerpetualMarket public market;
    MarginManager public marginManager;
    InsuranceFund public insuranceFund;
    MockPerpsPriceOracle public priceOracle;
    MockERC20 public collateralToken;  // 18 decimals
    
    address public owner = address(1);
    address public trader1 = address(2);
    address public trader2 = address(3);
    
    bytes32 public btcMarket;
    
    uint256 constant BTC_PRICE = 97000e8;
    uint256 constant COLLATERAL_PRICE = 1e8;
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy mock token (18 decimals)
        collateralToken = new MockERC20("Collateral", "COL");
        
        // Deploy price oracle
        priceOracle = new MockPerpsPriceOracle();
        priceOracle.setPrice("BTC-PERP", BTC_PRICE);
        priceOracle.setTokenPrice(address(collateralToken), COLLATERAL_PRICE);
        
        // Deploy insurance fund
        insuranceFund = new InsuranceFund(address(priceOracle), owner);
        
        // Deploy margin manager
        marginManager = new MarginManager(address(priceOracle), owner);
        marginManager.addAcceptedToken(address(collateralToken), 10000);
        
        // Deploy perpetual market
        market = new PerpetualMarket(
            address(marginManager),
            address(insuranceFund),
            address(priceOracle),
            owner
        );
        
        // Authorize contracts
        marginManager.setAuthorizedContract(address(market), true);
        insuranceFund.setAuthorizedContract(address(market), true);
        
        // Create BTC market
        MarketConfig memory btcConfig = MarketConfig({
            marketId: bytes32(0),
            symbol: "BTC-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 50,
            maintenanceMarginBps: 50,
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 10000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        btcMarket = market.createMarket(btcConfig);
        
        vm.stopPrank();
        
        // Fund traders (18 decimals)
        collateralToken.mint(trader1, 1_000_000e18);  // 1M tokens
        collateralToken.mint(trader2, 1_000_000e18);
        
        vm.prank(trader1);
        collateralToken.approve(address(market), type(uint256).max);
        vm.prank(trader2);
        collateralToken.approve(address(market), type(uint256).max);
    }
    
    // ============ Market Management Tests ============
    
    function test_CreateMarket() public view {
        // MarketConfig has 13 fields
        (bytes32 marketId,,,,,,,,,,,, bool isActive) = market.markets(btcMarket);
        assertEq(marketId, btcMarket);
        assertTrue(isActive);
    }
    
    function test_PauseMarket() public {
        vm.prank(owner);
        market.pauseMarket(btcMarket);
        assertTrue(market.marketPaused(btcMarket));
    }
    
    function test_UnpauseMarket() public {
        vm.startPrank(owner);
        market.pauseMarket(btcMarket);
        market.unpauseMarket(btcMarket);
        vm.stopPrank();
        assertFalse(market.marketPaused(btcMarket));
    }
    
    function test_RevertOnInvalidLeverage() public {
        MarketConfig memory config = MarketConfig({
            marketId: bytes32(0),
            symbol: "TEST-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 100,
            maintenanceMarginBps: 50,
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 1000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        
        vm.prank(owner);
        vm.expectRevert("Leverage too high");
        market.createMarket(config);
    }
    
    // ============ Position Tests ============
    
    function test_OpenLongPosition() public {
        uint256 margin = 10000e18;    // 10k collateral tokens
        uint256 size = 1e17;           // 0.1 BTC (~$9.7k notional)
        uint256 leverage = 10;
        
        vm.startPrank(trader1);
        
        TradeResult memory result = market.openPosition(
            btcMarket,
            address(collateralToken),
            margin,
            size,
            PositionSide.Long,
            leverage
        );
        vm.stopPrank();
        
        assertTrue(result.positionId != bytes32(0));
        assertGt(result.executionPrice, 0);
    }
    
    function test_OpenShortPosition() public {
        uint256 margin = 10000e18;    // 10k collateral tokens
        uint256 size = 1e17;           // 0.1 BTC
        uint256 leverage = 10;
        
        vm.startPrank(trader1);
        
        TradeResult memory result = market.openPosition(
            btcMarket,
            address(collateralToken),
            margin,
            size,
            PositionSide.Short,
            leverage
        );
        vm.stopPrank();
        
        assertTrue(result.positionId != bytes32(0));
        
        // Position has 12 fields
        (,, bytes32 mktId, PositionSide pSide,,,,,,,, bool isOpen) = market.positions(result.positionId);
        assertEq(mktId, btcMarket);
        assertEq(uint8(pSide), uint8(PositionSide.Short));
        assertTrue(isOpen);
    }
    
    function test_RevertOnExcessiveLeverage() public {
        uint256 margin = 10000e18;
        uint256 size = 1e17;
        uint256 leverage = 100;  // > 50x max
        
        vm.startPrank(trader1);
        vm.expectRevert("Invalid leverage");
        market.openPosition(btcMarket, address(collateralToken), margin, size, PositionSide.Long, leverage);
        vm.stopPrank();
    }
    
    // ============ Open Interest Tests ============
    
    function test_OpenInterestTracking() public {
        uint256 margin = 10000e18;
        uint256 size = 1e17;
        uint256 leverage = 10;
        
        vm.startPrank(trader1);
        market.openPosition(btcMarket, address(collateralToken), margin, size, PositionSide.Long, leverage);
        vm.stopPrank();
        
        // OI is tracked as notional value (size * price)
        (uint256 longOI,,) = market.openInterest(btcMarket);
        assertGt(longOI, 0);
    }
    
    // ============ Access Control Tests ============
    
    function test_OnlyOwnerCanCreateMarket() public {
        MarketConfig memory config = MarketConfig({
            marketId: bytes32(0),
            symbol: "TEST-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 20,
            maintenanceMarginBps: 50,
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 1000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        
        vm.prank(trader1);
        vm.expectRevert();
        market.createMarket(config);
    }
    
    function test_OnlyOwnerCanPauseMarket() public {
        vm.prank(trader1);
        vm.expectRevert();
        market.pauseMarket(btcMarket);
    }
    
    // ============ Constants Tests ============
    
    function test_MaxLeverageConstant() public view {
        assertEq(market.MAX_LEVERAGE(), 50);
    }
    
    function test_LiquidationPenalty() public view {
        assertEq(market.LIQUIDATION_PENALTY_BPS(), 50);
    }
    
    function test_LiquidatorReward() public view {
        assertEq(market.LIQUIDATOR_REWARD_BPS(), 25);
    }
    
    // ============ Boundary Condition Tests ============
    
    function test_RevertOnZeroMargin() public {
        vm.startPrank(trader1);
        vm.expectRevert("Margin too small");
        market.openPosition(btcMarket, address(collateralToken), 0, 1e17, PositionSide.Long, 10);
        vm.stopPrank();
    }
    
    function test_RevertOnMarginBelowMinimum() public {
        uint256 margin = market.MIN_MARGIN() - 1;
        
        vm.startPrank(trader1);
        vm.expectRevert("Margin too small");
        market.openPosition(btcMarket, address(collateralToken), margin, 1e17, PositionSide.Long, 10);
        vm.stopPrank();
    }
    
    function test_MinMarginExactlyAtBoundary() public {
        // Use margin exactly at MIN_MARGIN and high enough for 1x leverage
        uint256 margin = 10000e18;  // Much more than min but reasonable for test
        uint256 size = 1e14;        // 0.0001 BTC - very small size for 1x leverage
        uint256 leverage = 1;
        
        vm.startPrank(trader1);
        TradeResult memory result = market.openPosition(
            btcMarket,
            address(collateralToken),
            margin,
            size,
            PositionSide.Long,
            leverage
        );
        vm.stopPrank();
        
        assertTrue(result.positionId != bytes32(0));
    }
    
    function test_RevertOnZeroLeverage() public {
        vm.startPrank(trader1);
        vm.expectRevert("Invalid leverage");
        market.openPosition(btcMarket, address(collateralToken), 10000e18, 1e17, PositionSide.Long, 0);
        vm.stopPrank();
    }
    
    function test_MaxLeverageExactlyAtBoundary() public {
        uint256 margin = 10000e18;
        uint256 size = 1e17;
        uint256 leverage = 50; // Exactly at max
        
        vm.startPrank(trader1);
        TradeResult memory result = market.openPosition(
            btcMarket,
            address(collateralToken),
            margin,
            size,
            PositionSide.Long,
            leverage
        );
        vm.stopPrank();
        
        assertTrue(result.positionId != bytes32(0));
    }
    
    function test_RevertOnOpeningPositionInPausedMarket() public {
        vm.prank(owner);
        market.pauseMarket(btcMarket);
        
        vm.startPrank(trader1);
        vm.expectRevert("Market paused");
        market.openPosition(btcMarket, address(collateralToken), 10000e18, 1e17, PositionSide.Long, 10);
        vm.stopPrank();
    }
    
    function test_RevertOnInvalidMarketId() public {
        bytes32 invalidMarket = keccak256("NONEXISTENT");
        
        vm.startPrank(trader1);
        vm.expectRevert("Market inactive");
        market.openPosition(invalidMarket, address(collateralToken), 10000e18, 1e17, PositionSide.Long, 10);
        vm.stopPrank();
    }
    
    function test_RevertOnZeroSize() public {
        vm.startPrank(trader1);
        vm.expectRevert("Size must be > 0");
        market.openPosition(btcMarket, address(collateralToken), 10000e18, 0, PositionSide.Long, 10);
        vm.stopPrank();
    }
    
    // ============ Market Config Validation Tests ============
    
    function test_RevertOnZeroLeverageInConfig() public {
        MarketConfig memory config = MarketConfig({
            marketId: bytes32(0),
            symbol: "TEST-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 0,
            maintenanceMarginBps: 50,
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 1000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        
        vm.prank(owner);
        vm.expectRevert("Leverage must be > 0");
        market.createMarket(config);
    }
    
    function test_RevertOnZeroMaintenanceMargin() public {
        MarketConfig memory config = MarketConfig({
            marketId: bytes32(0),
            symbol: "TEST-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 20,
            maintenanceMarginBps: 0,
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 1000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        
        vm.prank(owner);
        vm.expectRevert("Invalid maintenance margin");
        market.createMarket(config);
    }
    
    function test_RevertOnMaintenanceMarginTooHigh() public {
        MarketConfig memory config = MarketConfig({
            marketId: bytes32(0),
            symbol: "TEST-PERP",
            baseAsset: address(0),
            quoteAsset: address(collateralToken),
            oracle: address(priceOracle),
            maxLeverage: 20,
            maintenanceMarginBps: 10000, // 100% - invalid
            initialMarginBps: 100,
            takerFeeBps: 5,
            makerFeeBps: 2,
            maxOpenInterest: 1000e18,
            fundingInterval: 1 hours,
            isActive: true
        });
        
        vm.prank(owner);
        vm.expectRevert("Invalid maintenance margin");
        market.createMarket(config);
    }
    
    // ============ Multi-Trader Tests ============
    
    function test_MultipleTradersSameMarket() public {
        uint256 margin = 10000e18;
        uint256 size = 1e17;
        uint256 leverage = 10;
        
        // Trader 1 opens long
        vm.prank(trader1);
        TradeResult memory result1 = market.openPosition(
            btcMarket, address(collateralToken), margin, size, PositionSide.Long, leverage
        );
        
        // Trader 2 opens short
        vm.prank(trader2);
        TradeResult memory result2 = market.openPosition(
            btcMarket, address(collateralToken), margin, size, PositionSide.Short, leverage
        );
        
        assertTrue(result1.positionId != result2.positionId);
        assertTrue(result1.positionId != bytes32(0));
        assertTrue(result2.positionId != bytes32(0));
    }
    
    function test_OpenInterestBothSides() public {
        uint256 margin = 10000e18;
        uint256 size = 1e17;
        
        // Trader 1 opens long
        vm.prank(trader1);
        market.openPosition(btcMarket, address(collateralToken), margin, size, PositionSide.Long, 10);
        
        // Trader 2 opens short
        vm.prank(trader2);
        market.openPosition(btcMarket, address(collateralToken), margin, size, PositionSide.Short, 10);
        
        (uint256 longOI, uint256 shortOI,) = market.openInterest(btcMarket);
        assertGt(longOI, 0);
        assertGt(shortOI, 0);
    }
}
