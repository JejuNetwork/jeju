// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PerpetualMarket} from "../../src/perps/PerpetualMarket.sol";
import {MarginManager} from "../../src/perps/MarginManager.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {IPerpetualMarket} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {MockERC20, MockTokenRegistry, MockPriceOracle, MockPriceFeed} from "../mocks/PerpsMocks.sol";

/**
 * @title PerpsIntegrationTest
 * @notice Integration test for perps stack
 */
contract PerpsIntegrationTest is Test {
    // Core contracts
    PerpetualMarket public perpMarket;
    MarginManager public marginManager;
    InsuranceFund public insuranceFund;
    LiquidationEngine public liquidationEngine;

    // Mock dependencies
    MockERC20 public usdc;
    MockTokenRegistry public tokenRegistry;
    MockPriceOracle public priceOracle;
    MockPriceFeed public priceFeed;

    // Test actors
    address public owner = address(1);
    address public trader1 = address(2);
    address public trader2 = address(3);
    address public liquidator = address(7);

    // Market IDs
    bytes32 public constant BTC_PERP = keccak256("BTC-PERP");

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock dependencies
        usdc = new MockERC20("USDC", "USDC");
        tokenRegistry = new MockTokenRegistry();
        priceOracle = new MockPriceOracle();
        priceFeed = new MockPriceFeed();

        // Configure mocks
        tokenRegistry.setRegistered(address(usdc), true);
        priceOracle.setPrice(address(usdc), 1e18);
        priceFeed.setPrice("BTC-USD", 50000e8, true);

        // Deploy Perps Stack
        insuranceFund = new InsuranceFund(address(priceOracle), owner);
        insuranceFund.addSupportedToken(address(usdc));

        marginManager = new MarginManager(address(priceOracle), address(tokenRegistry), owner);
        marginManager.addCollateralToken(address(usdc), 10000, 0);

        perpMarket =
            new PerpetualMarket(address(marginManager), address(priceFeed), address(insuranceFund), owner, owner);

        perpMarket.addMarket(BTC_PERP, "BTC-USD", address(0), 20, 100, 10, 5, 1000000 ether);

        liquidationEngine =
            new LiquidationEngine(address(perpMarket), address(marginManager), address(insuranceFund), owner);

        // Set authorizations
        marginManager.setAuthorizedContract(address(perpMarket), true);
        marginManager.setAuthorizedContract(address(liquidationEngine), true);
        insuranceFund.setAuthorizedDrawer(address(perpMarket), true);
        insuranceFund.setAuthorizedDrawer(address(liquidationEngine), true);

        // Fund test accounts
        usdc.mint(trader1, 100_000e18);
        usdc.mint(trader2, 100_000e18);
        usdc.mint(owner, 100_000e18);

        vm.stopPrank();
    }

    function testFullTradingFlow() public {
        // Step 1: Trader deposits collateral
        vm.startPrank(trader1);
        usdc.approve(address(marginManager), 10_000e18);
        marginManager.deposit(address(usdc), 10_000e18);

        uint256 balance = marginManager.getCollateralBalance(trader1, address(usdc));
        assertEq(balance, 10_000e18, "Trader should have 10k USDC deposited");

        // Step 2: Open position
        usdc.approve(address(perpMarket), 1_000e18);

        IPerpetualMarket.TradeResult memory result = perpMarket.openPosition(
            BTC_PERP,
            address(usdc),
            1_000e18, // 1000 USDC margin
            1e8, // 1 BTC size
            IPerpetualMarket.PositionSide.Long,
            10 // 10x leverage
        );

        assertTrue(result.positionId != bytes32(0), "Position should be created");
        vm.stopPrank();

        // Step 3: Price goes up 5%
        priceFeed.setPrice("BTC-USD", 52500e8, true);

        // Step 4: Check unrealized PnL
        (int256 unrealizedPnl,) = perpMarket.getPositionPnl(result.positionId);
        assertTrue(unrealizedPnl > 0, "Long position should be profitable");

        // Step 5: Close position
        vm.prank(trader1);
        IPerpetualMarket.TradeResult memory closeResult = perpMarket.decreasePosition(result.positionId, 1e8);

        assertTrue(closeResult.realizedPnl > 0, "Should have realized profit");
    }

    function testLiquidationFlow() public {
        // Trader opens leveraged position
        vm.startPrank(trader1);
        usdc.approve(address(marginManager), 10_000e18);
        marginManager.deposit(address(usdc), 10_000e18);
        usdc.approve(address(perpMarket), 1_000e18);

        IPerpetualMarket.TradeResult memory result =
            perpMarket.openPosition(BTC_PERP, address(usdc), 1_000e18, 1e8, IPerpetualMarket.PositionSide.Long, 10);
        vm.stopPrank();

        // Price crashes 10% - should trigger liquidation
        priceFeed.setPrice("BTC-USD", 45000e8, true);

        // Check if liquidatable
        (bool canLiquidate,) = perpMarket.isLiquidatable(result.positionId);
        assertTrue(canLiquidate, "Position should be liquidatable after 10% drop at 10x leverage");

        // Liquidator liquidates
        vm.prank(liquidator);
        uint256 reward = perpMarket.liquidate(result.positionId);
        assertTrue(reward > 0, "Liquidator should receive reward");

        // Verify position is closed
        IPerpetualMarket.Position memory pos = perpMarket.getPosition(result.positionId);
        assertFalse(pos.isOpen, "Position should be closed");
    }

    function testInsuranceFundRateLimit() public {
        // Deposit to insurance fund
        vm.startPrank(owner);
        usdc.approve(address(insuranceFund), 10_000e18);
        insuranceFund.deposit(address(usdc), 10_000e18);

        // Try to draw more than 20% - should fail
        vm.expectRevert(InsuranceFund.RateLimitExceeded.selector);
        insuranceFund.coverBadDebt(address(usdc), 3_000e18);

        // Draw exactly 20% - should succeed
        uint256 covered = insuranceFund.coverBadDebt(address(usdc), 2_000e18);
        assertEq(covered, 2_000e18, "Should cover 2000 USDC");

        // Try to draw more in same period - should fail
        vm.expectRevert(InsuranceFund.RateLimitExceeded.selector);
        insuranceFund.coverBadDebt(address(usdc), 100e18);

        // Warp past rate limit period
        vm.warp(block.timestamp + 1 hours + 1);

        // Should now be able to draw again
        covered = insuranceFund.coverBadDebt(address(usdc), 1_000e18);
        assertEq(covered, 1_000e18, "Should cover 1000 USDC after period reset");

        vm.stopPrank();
    }

    function testMarginManagerCrossChainVoucherValidation() public {
        // This test verifies the voucher validation in depositCrossChain
        // Since we don't have a real CrossChainPaymaster, we just verify the error path

        vm.startPrank(owner);
        marginManager.setCrossChainPaymaster(address(0x1234)); // Fake paymaster
        vm.stopPrank();

        vm.startPrank(trader1);
        // Should revert because paymaster.getVoucher will fail
        vm.expectRevert();
        marginManager.depositCrossChain(address(usdc), 1000e18, bytes32(uint256(1)));
        vm.stopPrank();
    }
}
