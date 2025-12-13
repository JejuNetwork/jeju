// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {IPerpetualMarket, IInsuranceFund, IMarginManager} from "../../src/perps/interfaces/IPerpetualMarket.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPerpMarket {
    mapping(bytes32 => bool) public liquidatable;
    mapping(bytes32 => uint256) public healthFactors;
    mapping(bytes32 => IPerpetualMarket.Position) public positions;
    mapping(bytes32 => uint256) public markPrices;

    uint256 public liquidationReward = 100e18;

    function setLiquidatable(bytes32 posId, bool isLiq, uint256 health) external {
        liquidatable[posId] = isLiq;
        healthFactors[posId] = health;
    }

    function setPosition(bytes32 posId, uint256 size, uint256 margin, bytes32 marketId) external {
        positions[posId] = IPerpetualMarket.Position({
            positionId: posId,
            trader: address(1),
            marketId: marketId,
            side: IPerpetualMarket.PositionSide.Long,
            marginType: IPerpetualMarket.MarginType.Isolated,
            size: size,
            margin: margin,
            marginToken: address(0),
            entryPrice: 1000e8,
            entryFundingIndex: 0,
            lastUpdateTime: block.timestamp,
            isOpen: true
        });
    }

    function setMarkPrice(bytes32 marketId, uint256 price) external {
        markPrices[marketId] = price;
    }

    function setLiquidationReward(uint256 reward) external {
        liquidationReward = reward;
    }

    function isLiquidatable(bytes32 posId) external view returns (bool, uint256) {
        return (liquidatable[posId], healthFactors[posId]);
    }

    function getPosition(bytes32 posId) external view returns (IPerpetualMarket.Position memory) {
        return positions[posId];
    }

    function getMarkPrice(bytes32 marketId) external view returns (uint256) {
        return markPrices[marketId];
    }

    function liquidate(bytes32) external view returns (uint256) {
        return liquidationReward;
    }
}

contract MockMarginManager {
// Minimal implementation
}

contract MockInsuranceFund {
    uint256 public coverAmount;
    bool public shouldPartialCover;

    function setCoverBehavior(uint256 amount, bool isPartial) external {
        coverAmount = amount;
        shouldPartialCover = isPartial;
    }

    function coverBadDebt(address, uint256 amount) external view returns (uint256) {
        if (shouldPartialCover) {
            return coverAmount < amount ? coverAmount : amount;
        }
        return amount;
    }
}

contract LiquidationEngineTest is Test {
    LiquidationEngine public engine;
    MockPerpMarket public perpMarket;
    MockMarginManager public marginManager;
    MockInsuranceFund public insuranceFund;
    MockERC20 public usdc;

    address public owner = address(1);
    address public keeper = address(2);
    address public unauthorized = address(3);

    bytes32 public constant POSITION_1 = keccak256("position-1");
    bytes32 public constant POSITION_2 = keccak256("position-2");
    bytes32 public constant POSITION_3 = keccak256("position-3");
    bytes32 public constant MARKET_1 = keccak256("BTC-PERP");

    function setUp() public {
        vm.startPrank(owner);

        usdc = new MockERC20();
        perpMarket = new MockPerpMarket();
        marginManager = new MockMarginManager();
        insuranceFund = new MockInsuranceFund();

        engine = new LiquidationEngine(address(perpMarket), address(marginManager), address(insuranceFund), owner);

        // Setup default position
        perpMarket.setPosition(POSITION_1, 1e18, 1000e18, MARKET_1);
        perpMarket.setMarkPrice(MARKET_1, 50000e8);

        vm.stopPrank();
    }

    // ============ Liquidate Single Position Tests ============

    function test_Liquidate_Success() public {
        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidationReward(50e18);

        vm.prank(keeper);
        uint256 reward = engine.liquidate(POSITION_1);

        assertEq(reward, 50e18);
        assertEq(engine.totalLiquidations(), 1);
        assertEq(engine.keeperLiquidations(keeper), 1);
        assertEq(engine.keeperRewards(keeper), 50e18);
    }

    function test_Liquidate_NotLiquidatable_Reverts() public {
        perpMarket.setLiquidatable(POSITION_1, false, 1.5e18);

        vm.prank(keeper);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        engine.liquidate(POSITION_1);
    }

    function test_Liquidate_MultipleKeepers() public {
        address keeper2 = address(100);

        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidationReward(50e18);

        vm.prank(keeper);
        engine.liquidate(POSITION_1);

        // Setup another position for keeper2
        perpMarket.setPosition(POSITION_2, 2e18, 2000e18, MARKET_1);
        perpMarket.setLiquidatable(POSITION_2, true, 0.4e18);
        perpMarket.setLiquidationReward(100e18);

        vm.prank(keeper2);
        engine.liquidate(POSITION_2);

        assertEq(engine.keeperLiquidations(keeper), 1);
        assertEq(engine.keeperLiquidations(keeper2), 1);
        assertEq(engine.totalLiquidations(), 2);
    }

    // ============ Batch Liquidate Tests ============

    function test_BatchLiquidate_AllSuccess() public {
        perpMarket.setPosition(POSITION_1, 1e18, 1000e18, MARKET_1);
        perpMarket.setPosition(POSITION_2, 2e18, 2000e18, MARKET_1);
        perpMarket.setPosition(POSITION_3, 3e18, 3000e18, MARKET_1);

        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidatable(POSITION_2, true, 0.4e18);
        perpMarket.setLiquidatable(POSITION_3, true, 0.3e18);
        perpMarket.setLiquidationReward(50e18);

        bytes32[] memory positions = new bytes32[](3);
        positions[0] = POSITION_1;
        positions[1] = POSITION_2;
        positions[2] = POSITION_3;

        vm.prank(keeper);
        uint256[] memory rewards = engine.batchLiquidate(positions);

        assertEq(rewards.length, 3);
        assertEq(rewards[0], 50e18);
        assertEq(rewards[1], 50e18);
        assertEq(rewards[2], 50e18);
        assertEq(engine.totalLiquidations(), 3);
    }

    function test_BatchLiquidate_SomeSkipped() public {
        perpMarket.setPosition(POSITION_1, 1e18, 1000e18, MARKET_1);
        perpMarket.setPosition(POSITION_2, 2e18, 2000e18, MARKET_1);

        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidatable(POSITION_2, false, 1.5e18); // Not liquidatable
        perpMarket.setLiquidationReward(50e18);

        bytes32[] memory positions = new bytes32[](2);
        positions[0] = POSITION_1;
        positions[1] = POSITION_2;

        vm.prank(keeper);
        uint256[] memory rewards = engine.batchLiquidate(positions);

        assertEq(rewards[0], 50e18);
        assertEq(rewards[1], 0); // Skipped
        assertEq(engine.totalLiquidations(), 1);
    }

    function test_BatchLiquidate_Empty_Reverts() public {
        bytes32[] memory positions = new bytes32[](0);

        vm.prank(keeper);
        vm.expectRevert(LiquidationEngine.EmptyBatch.selector);
        engine.batchLiquidate(positions);
    }

    function test_BatchLiquidate_AllSkipped() public {
        perpMarket.setLiquidatable(POSITION_1, false, 1.5e18);
        perpMarket.setLiquidatable(POSITION_2, false, 1.5e18);

        bytes32[] memory positions = new bytes32[](2);
        positions[0] = POSITION_1;
        positions[1] = POSITION_2;

        vm.prank(keeper);
        uint256[] memory rewards = engine.batchLiquidate(positions);

        assertEq(rewards[0], 0);
        assertEq(rewards[1], 0);
        assertEq(engine.totalLiquidations(), 0);
    }

    // ============ Bad Debt Handling Tests ============

    function test_HandleBadDebt_FullyCovered() public {
        insuranceFund.setCoverBehavior(1000e18, false);

        vm.prank(address(perpMarket));
        engine.handleBadDebt(POSITION_1, address(usdc), 100e18);

        assertEq(engine.totalBadDebt(), 0);
    }

    function test_HandleBadDebt_PartiallyCovered() public {
        insuranceFund.setCoverBehavior(50e18, true);

        vm.prank(address(perpMarket));
        engine.handleBadDebt(POSITION_1, address(usdc), 100e18);

        // 100 - 50 = 50 socialized
        assertEq(engine.totalBadDebt(), 50e18);
    }

    function test_HandleBadDebt_NotCovered() public {
        insuranceFund.setCoverBehavior(0, true);

        vm.prank(address(perpMarket));
        engine.handleBadDebt(POSITION_1, address(usdc), 100e18);

        assertEq(engine.totalBadDebt(), 100e18);
    }

    function test_HandleBadDebt_OnlyPerpMarket() public {
        vm.prank(unauthorized);
        vm.expectRevert(LiquidationEngine.OnlyPerpMarket.selector);
        engine.handleBadDebt(POSITION_1, address(usdc), 100e18);
    }

    // ============ Check Liquidation Tests ============

    function test_CheckLiquidation_Liquidatable() public {
        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);

        (bool canLiq, uint256 health, uint256 reward) = engine.checkLiquidation(POSITION_1);

        assertTrue(canLiq);
        assertEq(health, 0.5e18);
        assertGt(reward, 0);
    }

    function test_CheckLiquidation_NotLiquidatable() public {
        perpMarket.setLiquidatable(POSITION_1, false, 1.5e18);

        (bool canLiq, uint256 health, uint256 reward) = engine.checkLiquidation(POSITION_1);

        assertFalse(canLiq);
        assertEq(health, 1.5e18);
        assertEq(reward, 0);
    }

    // ============ Parameter Configuration Tests ============

    function test_SetLiquidationParams_Valid() public {
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
        engine.setLiquidationParams(1500, 600, 5000); // 21% total
    }

    function test_SetLiquidationParams_MaxAtBoundary() public {
        vm.prank(owner);
        engine.setLiquidationParams(1800, 200, 5000); // Exactly 20%

        (uint256 bonus, uint256 insurance,) = engine.getLiquidationParams();
        assertEq(bonus, 1800);
        assertEq(insurance, 200);
    }

    function test_SetLiquidationParams_InvalidMaxSize_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid max size");
        engine.setLiquidationParams(500, 200, 10001); // Over 100%
    }

    function test_SetLiquidationParams_OnlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        engine.setLiquidationParams(500, 200, 5000);
    }

    // ============ Contract Reference Updates ============

    function test_SetPerpMarket() public {
        address newMarket = address(999);

        vm.prank(owner);
        engine.setPerpMarket(newMarket);

        assertEq(address(engine.perpMarket()), newMarket);
    }

    function test_SetMarginManager() public {
        address newManager = address(998);

        vm.prank(owner);
        engine.setMarginManager(newManager);

        assertEq(address(engine.marginManager()), newManager);
    }

    function test_SetInsuranceFund() public {
        address newFund = address(997);

        vm.prank(owner);
        engine.setInsuranceFund(newFund);

        assertEq(address(engine.insuranceFund()), newFund);
    }

    // ============ Stats Tracking Tests ============

    function test_GetKeeperStats() public {
        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidationReward(50e18);

        vm.prank(keeper);
        engine.liquidate(POSITION_1);

        (uint256 liqs, uint256 rewards) = engine.getKeeperStats(keeper);
        assertEq(liqs, 1);
        assertEq(rewards, 50e18);
    }

    function test_GetGlobalStats() public {
        perpMarket.setPosition(POSITION_1, 1e18, 1000e18, MARKET_1);
        perpMarket.setPosition(POSITION_2, 2e18, 2000e18, MARKET_1);
        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidatable(POSITION_2, true, 0.4e18);
        perpMarket.setLiquidationReward(50e18);

        bytes32[] memory positions = new bytes32[](2);
        positions[0] = POSITION_1;
        positions[1] = POSITION_2;

        vm.prank(keeper);
        engine.batchLiquidate(positions);

        (uint256 totalLiqs, uint256 totalVol, uint256 totalRewards,,) = engine.getGlobalStats();

        assertEq(totalLiqs, 2);
        assertEq(totalVol, 3e18); // 1 + 2
        assertEq(totalRewards, 100e18); // 50 + 50
    }

    // ============ Fuzz Tests ============

    function testFuzz_LiquidationReward(uint128 positionSize, uint128 margin) public {
        vm.assume(positionSize > 0);
        vm.assume(margin > 0);

        perpMarket.setPosition(POSITION_1, positionSize, margin, MARKET_1);
        perpMarket.setLiquidatable(POSITION_1, true, 0.5e18);
        perpMarket.setLiquidationReward(uint256(margin) * 500 / 10000); // 5% of margin

        vm.prank(keeper);
        uint256 reward = engine.liquidate(POSITION_1);

        assertLe(reward, margin, "Reward should not exceed margin");
    }
}
