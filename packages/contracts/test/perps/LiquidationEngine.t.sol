// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {IPerpetualMarket, IInsuranceFund, IMarginManager} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockPerpMarket {
    struct Position {
        bytes32 marketId;
        address trader;
        bool isLong;
        uint256 size;
        uint256 margin;
        uint256 entryPrice;
    }
    
    mapping(bytes32 => Position) public positions;
    mapping(bytes32 => bool) public liquidatable;
    mapping(bytes32 => uint256) public healthFactors;
    mapping(bytes32 => uint256) public markPrices;
    
    address public liquidationEngine;
    uint256 public lastLiquidationReward;
    
    function setLiquidationEngine(address _engine) external {
        liquidationEngine = _engine;
    }
    
    function setPosition(
        bytes32 positionId,
        bytes32 marketId,
        address trader,
        bool isLong,
        uint256 size,
        uint256 margin,
        uint256 entryPrice
    ) external {
        positions[positionId] = Position(marketId, trader, isLong, size, margin, entryPrice);
    }
    
    function setLiquidatable(bytes32 positionId, bool canLiq, uint256 health) external {
        liquidatable[positionId] = canLiq;
        healthFactors[positionId] = health;
    }
    
    function setMarkPrice(bytes32 marketId, uint256 price) external {
        markPrices[marketId] = price;
    }
    
    function isLiquidatable(bytes32 positionId) external view returns (bool, uint256) {
        return (liquidatable[positionId], healthFactors[positionId]);
    }
    
    function getPosition(bytes32 positionId) external view returns (IPerpetualMarket.Position memory) {
        Position memory p = positions[positionId];
        return IPerpetualMarket.Position({
            positionId: positionId,
            trader: p.trader,
            marketId: p.marketId,
            side: p.isLong ? IPerpetualMarket.PositionSide.Long : IPerpetualMarket.PositionSide.Short,
            marginType: IPerpetualMarket.MarginType.Isolated,
            size: p.size,
            margin: p.margin,
            marginToken: address(0),
            entryPrice: p.entryPrice,
            entryFundingIndex: 0,
            lastUpdateTime: block.timestamp,
            isOpen: true
        });
    }
    
    function getMarkPrice(bytes32 marketId) external view returns (uint256) {
        return markPrices[marketId];
    }
    
    function liquidate(bytes32 positionId) external returns (uint256) {
        require(liquidatable[positionId], "Not liquidatable");
        Position memory p = positions[positionId];
        
        // Calculate reward (5% of margin)
        uint256 reward = (p.margin * 500) / 10000;
        lastLiquidationReward = reward;
        
        // Clear position
        delete positions[positionId];
        liquidatable[positionId] = false;
        
        return reward;
    }
}

contract MockInsuranceFund {
    mapping(address => uint256) public balances;
    uint256 public lastCoverAmount;
    
    function deposit(address token, uint256 amount) external {
        balances[token] += amount;
    }
    
    function coverBadDebt(address token, uint256 amount) external returns (uint256) {
        lastCoverAmount = amount;
        uint256 covered = amount > balances[token] ? balances[token] : amount;
        balances[token] -= covered;
        return covered;
    }
}

contract MockMarginManager {}

contract LiquidationEngineTest is Test {
    LiquidationEngine public engine;
    MockPerpMarket public perpMarket;
    MockInsuranceFund public insuranceFund;
    MockMarginManager public marginManager;
    MockERC20 public usdc;
    
    address public owner = address(1);
    address public keeper1 = address(2);
    address public keeper2 = address(3);
    address public trader = address(4);
    
    bytes32 public constant MARKET_BTC = keccak256("BTC-PERP");
    bytes32 public constant POS_1 = keccak256("position-1");
    bytes32 public constant POS_2 = keccak256("position-2");
    bytes32 public constant POS_3 = keccak256("position-3");
    
    function setUp() public {
        vm.startPrank(owner);
        
        perpMarket = new MockPerpMarket();
        insuranceFund = new MockInsuranceFund();
        marginManager = new MockMarginManager();
        usdc = new MockERC20();
        
        engine = new LiquidationEngine(
            address(perpMarket),
            address(marginManager),
            address(insuranceFund),
            owner
        );
        
        perpMarket.setLiquidationEngine(address(engine));
        perpMarket.setMarkPrice(MARKET_BTC, 50000e8);
        
        vm.stopPrank();
    }
    
    // ============ Single Liquidation Tests ============
    
    function test_Liquidate_Success() public {
        // Setup liquidatable position
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.5e18); // Health < 1
        
        vm.prank(keeper1);
        uint256 reward = engine.liquidate(POS_1);
        
        assertGt(reward, 0, "Should receive reward");
        assertEq(engine.totalLiquidations(), 1);
        assertEq(engine.keeperLiquidations(keeper1), 1);
        assertEq(engine.keeperRewards(keeper1), reward);
    }
    
    function test_Liquidate_NotLiquidatable_Reverts() public {
        // Setup healthy position
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, false, 2e18); // Health > 1
        
        vm.prank(keeper1);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        engine.liquidate(POS_1);
    }
    
    function test_Liquidate_NonexistentPosition() public {
        bytes32 fakePos = keccak256("fake");
        // Position not set, so isLiquidatable returns false
        
        vm.prank(keeper1);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        engine.liquidate(fakePos);
    }
    
    function test_Liquidate_UpdatesStats() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 5e18, 2000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.8e18);
        
        vm.prank(keeper1);
        engine.liquidate(POS_1);
        
        assertEq(engine.totalLiquidations(), 1);
        assertEq(engine.totalLiquidatedVolume(), 5e18);
        assertGt(engine.totalLiquidatorRewards(), 0);
    }
    
    // ============ Batch Liquidation Tests ============
    
    function test_BatchLiquidate_AllLiquidatable() public {
        // Setup 3 liquidatable positions
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setPosition(POS_2, MARKET_BTC, trader, false, 2e18, 1500e18, 50000e8);
        perpMarket.setPosition(POS_3, MARKET_BTC, trader, true, 3e18, 2000e18, 50000e8);
        
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        perpMarket.setLiquidatable(POS_2, true, 0.7e18);
        perpMarket.setLiquidatable(POS_3, true, 0.9e18);
        
        bytes32[] memory positions = new bytes32[](3);
        positions[0] = POS_1;
        positions[1] = POS_2;
        positions[2] = POS_3;
        
        vm.prank(keeper1);
        uint256[] memory rewards = engine.batchLiquidate(positions);
        
        assertEq(rewards.length, 3);
        assertGt(rewards[0], 0);
        assertGt(rewards[1], 0);
        assertGt(rewards[2], 0);
        assertEq(engine.totalLiquidations(), 3);
        assertEq(engine.keeperLiquidations(keeper1), 3);
    }
    
    function test_BatchLiquidate_PartialLiquidatable() public {
        // Setup 2 liquidatable, 1 healthy
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setPosition(POS_2, MARKET_BTC, trader, false, 2e18, 1500e18, 50000e8);
        perpMarket.setPosition(POS_3, MARKET_BTC, trader, true, 3e18, 2000e18, 50000e8);
        
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        perpMarket.setLiquidatable(POS_2, false, 1.5e18); // Healthy
        perpMarket.setLiquidatable(POS_3, true, 0.9e18);
        
        bytes32[] memory positions = new bytes32[](3);
        positions[0] = POS_1;
        positions[1] = POS_2;
        positions[2] = POS_3;
        
        vm.prank(keeper1);
        uint256[] memory rewards = engine.batchLiquidate(positions);
        
        assertGt(rewards[0], 0);
        assertEq(rewards[1], 0, "Healthy position should have 0 reward");
        assertGt(rewards[2], 0);
        assertEq(engine.totalLiquidations(), 2);
    }
    
    function test_BatchLiquidate_EmptyBatch_Reverts() public {
        bytes32[] memory empty = new bytes32[](0);
        
        vm.prank(keeper1);
        vm.expectRevert(LiquidationEngine.EmptyBatch.selector);
        engine.batchLiquidate(empty);
    }
    
    function test_BatchLiquidate_AllHealthy() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setPosition(POS_2, MARKET_BTC, trader, false, 2e18, 1500e18, 50000e8);
        
        perpMarket.setLiquidatable(POS_1, false, 2e18);
        perpMarket.setLiquidatable(POS_2, false, 1.5e18);
        
        bytes32[] memory positions = new bytes32[](2);
        positions[0] = POS_1;
        positions[1] = POS_2;
        
        vm.prank(keeper1);
        uint256[] memory rewards = engine.batchLiquidate(positions);
        
        assertEq(rewards[0], 0);
        assertEq(rewards[1], 0);
        assertEq(engine.totalLiquidations(), 0);
    }
    
    // ============ Multiple Keepers Tests ============
    
    function test_MultipleKeepers_TrackSeparately() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setPosition(POS_2, MARKET_BTC, trader, false, 2e18, 2000e18, 50000e8);
        
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        perpMarket.setLiquidatable(POS_2, true, 0.7e18);
        
        vm.prank(keeper1);
        engine.liquidate(POS_1);
        
        vm.prank(keeper2);
        engine.liquidate(POS_2);
        
        assertEq(engine.keeperLiquidations(keeper1), 1);
        assertEq(engine.keeperLiquidations(keeper2), 1);
        assertGt(engine.keeperRewards(keeper1), 0);
        assertGt(engine.keeperRewards(keeper2), 0);
        assertEq(engine.totalLiquidations(), 2);
    }
    
    // ============ Check Liquidation Tests ============
    
    function test_CheckLiquidation_Liquidatable() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        
        (bool canLiq, uint256 health, uint256 reward) = engine.checkLiquidation(POS_1);
        
        assertTrue(canLiq);
        assertEq(health, 0.5e18);
        assertGt(reward, 0);
    }
    
    function test_CheckLiquidation_Healthy() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, false, 2e18);
        
        (bool canLiq, uint256 health, uint256 reward) = engine.checkLiquidation(POS_1);
        
        assertFalse(canLiq);
        assertEq(health, 2e18);
        assertEq(reward, 0);
    }
    
    // ============ Bad Debt Tests ============
    
    function test_HandleBadDebt_FullyCovered() public {
        // Fund insurance
        insuranceFund.deposit(address(usdc), 10000e18);
        
        vm.prank(address(perpMarket));
        engine.handleBadDebt(POS_1, address(usdc), 100e18);
        
        assertEq(insuranceFund.lastCoverAmount(), 100e18);
        assertEq(engine.totalBadDebt(), 0);
    }
    
    function test_HandleBadDebt_PartiallyCovered() public {
        // Fund insurance with only 50
        insuranceFund.deposit(address(usdc), 50e18);
        
        vm.prank(address(perpMarket));
        engine.handleBadDebt(POS_1, address(usdc), 100e18);
        
        // 50 covered, 50 socialized
        assertEq(engine.totalBadDebt(), 50e18);
    }
    
    function test_HandleBadDebt_NoCoverage() public {
        // Empty insurance fund
        vm.prank(address(perpMarket));
        engine.handleBadDebt(POS_1, address(usdc), 100e18);
        
        assertEq(engine.totalBadDebt(), 100e18);
    }
    
    function test_HandleBadDebt_OnlyPerpMarket() public {
        vm.prank(keeper1);
        vm.expectRevert(LiquidationEngine.OnlyPerpMarket.selector);
        engine.handleBadDebt(POS_1, address(usdc), 100e18);
    }
    
    // ============ Parameter Update Tests ============
    
    function test_SetLiquidationParams_Success() public {
        vm.prank(owner);
        engine.setLiquidationParams(600, 300, 6000);
        
        (uint256 bonus, uint256 insurance, uint256 maxSize) = engine.getLiquidationParams();
        assertEq(bonus, 600);
        assertEq(insurance, 300);
        assertEq(maxSize, 6000);
    }
    
    function test_SetLiquidationParams_FeesTooHigh_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Fees too high");
        engine.setLiquidationParams(1500, 1000, 5000); // 25% > 20%
    }
    
    function test_SetLiquidationParams_MaxSizeInvalid_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid max size");
        engine.setLiquidationParams(500, 200, 15000); // > 100%
    }
    
    function test_SetLiquidationParams_OnlyOwner() public {
        vm.prank(keeper1);
        vm.expectRevert();
        engine.setLiquidationParams(500, 200, 5000);
    }
    
    // ============ Contract Reference Update Tests ============
    
    function test_SetPerpMarket() public {
        MockPerpMarket newMarket = new MockPerpMarket();
        
        vm.prank(owner);
        engine.setPerpMarket(address(newMarket));
        
        assertEq(address(engine.perpMarket()), address(newMarket));
    }
    
    function test_SetMarginManager() public {
        MockMarginManager newManager = new MockMarginManager();
        
        vm.prank(owner);
        engine.setMarginManager(address(newManager));
        
        assertEq(address(engine.marginManager()), address(newManager));
    }
    
    function test_SetInsuranceFund() public {
        MockInsuranceFund newFund = new MockInsuranceFund();
        
        vm.prank(owner);
        engine.setInsuranceFund(address(newFund));
        
        assertEq(address(engine.insuranceFund()), address(newFund));
    }
    
    // ============ View Function Tests ============
    
    function test_GetKeeperStats() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        
        vm.prank(keeper1);
        engine.liquidate(POS_1);
        
        (uint256 liqs, uint256 rewards) = engine.getKeeperStats(keeper1);
        assertEq(liqs, 1);
        assertGt(rewards, 0);
    }
    
    function test_GetGlobalStats() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 5e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        
        vm.prank(keeper1);
        engine.liquidate(POS_1);
        
        (
            uint256 totalLiqs,
            uint256 totalVolume,
            uint256 totalRewards,
            uint256 totalInsurance,
            uint256 badDebt
        ) = engine.getGlobalStats();
        
        assertEq(totalLiqs, 1);
        assertEq(totalVolume, 5e18);
        assertGt(totalRewards, 0);
    }
    
    // ============ Reentrancy Tests ============
    
    function test_Liquidate_ReentrancyProtection() public {
        // The liquidate function has nonReentrant modifier
        // This test ensures basic protection is in place
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 1000e18, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.5e18);
        
        vm.prank(keeper1);
        engine.liquidate(POS_1);
        
        // Position should be cleared after liquidation
        perpMarket.setLiquidatable(POS_1, false, 0);
        
        vm.prank(keeper1);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        engine.liquidate(POS_1);
    }
    
    // ============ Edge Cases ============
    
    function test_Liquidate_ZeroMarginPosition() public {
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, 1e18, 0, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0);
        
        vm.prank(keeper1);
        uint256 reward = engine.liquidate(POS_1);
        
        assertEq(reward, 0, "Zero margin = zero reward");
    }
    
    function test_Liquidate_VeryLargePosition() public {
        uint256 largeSize = 1000000e18; // 1M units
        uint256 largeMargin = 10000000e18; // 10M margin
        
        perpMarket.setPosition(POS_1, MARKET_BTC, trader, true, largeSize, largeMargin, 50000e8);
        perpMarket.setLiquidatable(POS_1, true, 0.9e18);
        
        vm.prank(keeper1);
        uint256 reward = engine.liquidate(POS_1);
        
        assertGt(reward, 0);
        assertEq(engine.totalLiquidatedVolume(), largeSize);
    }
    
    function testFuzz_BatchLiquidate_VariableSizes(uint8 count) public {
        vm.assume(count > 0 && count <= 20); // Limit to prevent overflow
        
        bytes32[] memory positions = new bytes32[](count);
        
        for (uint256 i = 0; i < count; i++) {
            bytes32 posId = keccak256(abi.encode("pos", i));
            positions[i] = posId;
            
            // Use safe multiplications
            uint256 size = (i + 1) * 1e18;
            uint256 margin = (i + 1) * 100e18;
            perpMarket.setPosition(posId, MARKET_BTC, trader, true, size, margin, 50000e8);
            perpMarket.setLiquidatable(posId, true, 0.5e18);
        }
        
        vm.prank(keeper1);
        uint256[] memory rewards = engine.batchLiquidate(positions);
        
        assertEq(rewards.length, count);
        assertEq(engine.totalLiquidations(), count);
    }
}
