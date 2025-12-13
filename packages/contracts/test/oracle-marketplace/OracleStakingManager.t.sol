// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {OracleStakingManager} from "../../src/oracle-marketplace/OracleStakingManager.sol";
import {IOracleStakingManager} from "../../src/oracle-marketplace/interfaces/IOracleStakingManager.sol";
import {PriceFeedAggregator} from "../../src/oracle-marketplace/PriceFeedAggregator.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock contracts
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockTokenRegistry {
    mapping(address => bool) public isRegistered;

    function setRegistered(address token, bool registered) external {
        isRegistered[token] = registered;
    }
}

contract MockPriceOracle {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}

contract MockIdentityRegistry {
    mapping(uint256 => bool) public agentExists;
    mapping(uint256 => address) public owners;

    function setAgent(uint256 agentId, address owner) external {
        agentExists[agentId] = true;
        owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }
}

contract OracleStakingManagerTest is Test {
    OracleStakingManager public oracleManager;
    PriceFeedAggregator public priceFeedAggregator;
    MockPriceOracle public priceOracle;
    MockTokenRegistry public tokenRegistry;
    MockIdentityRegistry public identityRegistry;
    MockERC20 public stakeToken;

    address public owner = address(1);
    address public oracle1 = address(2);
    address public oracle2 = address(3);
    address public oracle3 = address(4);
    address public oracle4 = address(5);

    bytes32 public constant BTC_USD = keccak256("BTC-USD");
    bytes32 public constant ETH_USD = keccak256("ETH-USD");

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mocks
        stakeToken = new MockERC20("Stake Token", "STK");
        priceOracle = new MockPriceOracle();
        tokenRegistry = new MockTokenRegistry();
        identityRegistry = new MockIdentityRegistry();

        // Configure mocks
        tokenRegistry.setRegistered(address(stakeToken), true);
        priceOracle.setPrice(address(stakeToken), 1e18); // $1 per token

        // Deploy oracle staking manager
        oracleManager = new OracleStakingManager(
            address(tokenRegistry),
            address(priceOracle),
            owner
        );

        // Configure registries
        oracleManager.setIdentityRegistry(address(identityRegistry));

        // Add markets
        oracleManager.addMarket(
            BTC_USD,
            "BTC-USD",
            address(0),
            3600,   // 1 hour heartbeat
            100,    // 1% deviation
            3       // Min 3 oracles
        );

        oracleManager.addMarket(
            ETH_USD,
            "ETH-USD",
            address(0),
            3600,
            100,
            3
        );

        // Deploy price feed aggregator
        priceFeedAggregator = new PriceFeedAggregator(
            address(oracleManager),
            owner
        );

        // Configure price feeds
        priceFeedAggregator.configureFeed(
            "BTC-USD",
            BTC_USD,
            address(0), // No chainlink fallback
            3600,
            200,
            false
        );

        priceFeedAggregator.configureFeed(
            "ETH-USD",
            ETH_USD,
            address(0),
            3600,
            200,
            false
        );

        vm.stopPrank();

        // Fund oracles with stake tokens
        stakeToken.mint(oracle1, 10000 * 1e18);
        stakeToken.mint(oracle2, 10000 * 1e18);
        stakeToken.mint(oracle3, 10000 * 1e18);
        stakeToken.mint(oracle4, 10000 * 1e18);

        // Approve oracle manager
        vm.prank(oracle1);
        stakeToken.approve(address(oracleManager), type(uint256).max);
        vm.prank(oracle2);
        stakeToken.approve(address(oracleManager), type(uint256).max);
        vm.prank(oracle3);
        stakeToken.approve(address(oracleManager), type(uint256).max);
        vm.prank(oracle4);
        stakeToken.approve(address(oracleManager), type(uint256).max);
    }

    // ============ Registration Tests ============

    function testRegisterOracle() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(
            address(stakeToken),
            2000 * 1e18,  // $2000 stake
            0             // No reputation agent
        );

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.operator, oracle1);
        assertEq(node.stakedAmount, 2000 * 1e18);
        assertEq(uint8(node.status), uint8(IOracleStakingManager.OracleStatus.Active));
    }

    function testRegisterOracleWithReputation() public {
        // Set up reputation agent
        identityRegistry.setAgent(1, oracle1);

        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(
            address(stakeToken),
            2000 * 1e18,
            1  // Agent ID 1
        );

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.reputationAgentId, 1);
    }

    function testCannotRegisterBelowMinStake() public {
        // Min stake is $1000, so 500 tokens = $500
        vm.prank(oracle1);
        vm.expectRevert();
        oracleManager.registerOracle(
            address(stakeToken),
            500 * 1e18,
            0
        );
    }

    function testCannotRegisterUnregisteredToken() public {
        MockERC20 badToken = new MockERC20("Bad", "BAD");
        badToken.mint(oracle1, 10000 * 1e18);

        vm.prank(oracle1);
        badToken.approve(address(oracleManager), type(uint256).max);

        vm.prank(oracle1);
        vm.expectRevert(OracleStakingManager.TokenNotRegistered.selector);
        oracleManager.registerOracle(address(badToken), 2000 * 1e18, 0);
    }

    // ============ Price Submission Tests ============

    function testSubmitPrice() public {
        // Register oracle
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        // Submit price
        vm.prank(oracle1);
        oracleManager.submitPrice(oracleId, BTC_USD, 50000 * 1e8);

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.totalSubmissions, 1);
    }

    function testSubmitPricesBatch() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        bytes32[] memory marketIds = new bytes32[](2);
        marketIds[0] = BTC_USD;
        marketIds[1] = ETH_USD;

        uint256[] memory prices = new uint256[](2);
        prices[0] = 50000 * 1e8;
        prices[1] = 3000 * 1e8;

        vm.prank(oracle1);
        oracleManager.submitPricesBatch(oracleId, marketIds, prices);

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.totalSubmissions, 2);
    }

    function testCannotSubmitAsInactiveOracle() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        // Start unbonding
        vm.prank(oracle1);
        oracleManager.startUnbonding(oracleId);

        // Try to submit price
        vm.prank(oracle1);
        vm.expectRevert(OracleStakingManager.OracleNotActive.selector);
        oracleManager.submitPrice(oracleId, BTC_USD, 50000 * 1e8);
    }

    // ============ Consensus Tests ============

    function testConsensusWithThreeOracles() public {
        // Register 3 oracles
        vm.prank(oracle1);
        bytes32 oracleId1 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle2);
        bytes32 oracleId2 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle3);
        bytes32 oracleId3 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        // Submit similar prices
        vm.prank(oracle1);
        oracleManager.submitPrice(oracleId1, BTC_USD, 50000 * 1e8);
        vm.prank(oracle2);
        oracleManager.submitPrice(oracleId2, BTC_USD, 50010 * 1e8);
        vm.prank(oracle3);
        oracleManager.submitPrice(oracleId3, BTC_USD, 49990 * 1e8);

        // Check consensus was reached
        IOracleStakingManager.ConsensusPrice memory consensus = oracleManager.getConsensusPrice(BTC_USD);
        assertGt(consensus.price, 0);
        assertEq(consensus.oracleCount, 3);
    }

    function testNoConsensusWithTwoOracles() public {
        // Register only 2 oracles (min is 3)
        vm.prank(oracle1);
        bytes32 oracleId1 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle2);
        bytes32 oracleId2 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.submitPrice(oracleId1, BTC_USD, 50000 * 1e8);
        vm.prank(oracle2);
        oracleManager.submitPrice(oracleId2, BTC_USD, 50010 * 1e8);

        // No consensus should be reached
        IOracleStakingManager.ConsensusPrice memory consensus = oracleManager.getConsensusPrice(BTC_USD);
        assertEq(consensus.price, 0);
    }

    // ============ Unbonding Tests ============

    function testStartUnbonding() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.startUnbonding(oracleId);

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(uint8(node.status), uint8(IOracleStakingManager.OracleStatus.Unbonding));
    }

    function testCompleteUnbonding() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        uint256 balanceBefore = stakeToken.balanceOf(oracle1);

        vm.prank(oracle1);
        oracleManager.startUnbonding(oracleId);

        // Fast forward past unbonding period (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(oracle1);
        oracleManager.completeUnbonding(oracleId);

        uint256 balanceAfter = stakeToken.balanceOf(oracle1);
        assertEq(balanceAfter - balanceBefore, 2000 * 1e18);

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(uint8(node.status), uint8(IOracleStakingManager.OracleStatus.Inactive));
    }

    function testCannotCompleteUnbondingEarly() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.startUnbonding(oracleId);

        // Only wait 6 days (not enough)
        vm.warp(block.timestamp + 6 days);

        vm.prank(oracle1);
        vm.expectRevert(OracleStakingManager.UnbondingNotComplete.selector);
        oracleManager.completeUnbonding(oracleId);
    }

    // ============ Add Stake Tests ============

    function testAddStake() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.addStake(oracleId, 1000 * 1e18);

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.stakedAmount, 3000 * 1e18);
    }

    function testAddStakeCancelsUnbonding() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.startUnbonding(oracleId);

        IOracleStakingManager.OracleNode memory nodeBefore = oracleManager.getOracleInfo(oracleId);
        assertEq(uint8(nodeBefore.status), uint8(IOracleStakingManager.OracleStatus.Unbonding));

        // Adding stake should cancel unbonding
        vm.prank(oracle1);
        oracleManager.addStake(oracleId, 1000 * 1e18);

        IOracleStakingManager.OracleNode memory nodeAfter = oracleManager.getOracleInfo(oracleId);
        assertEq(uint8(nodeAfter.status), uint8(IOracleStakingManager.OracleStatus.Active));
    }

    // ============ Admin Tests ============

    function testAddMarket() public {
        bytes32 newMarket = keccak256("SOL-USD");

        vm.prank(owner);
        oracleManager.addMarket(
            newMarket,
            "SOL-USD",
            address(0),
            3600,
            100,
            3
        );

        IOracleStakingManager.MarketConfig memory config = oracleManager.getMarketConfig(newMarket);
        assertEq(config.symbol, "SOL-USD");
        assertTrue(config.isActive);
    }

    function testUpdateMarket() public {
        vm.prank(owner);
        oracleManager.updateMarket(BTC_USD, false);

        IOracleStakingManager.MarketConfig memory config = oracleManager.getMarketConfig(BTC_USD);
        assertFalse(config.isActive);
    }

    function testSlashOracle() public {
        vm.prank(oracle1);
        bytes32 oracleId = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(owner);
        oracleManager.slashOracle(oracleId, 1000, "Test slash"); // 10%

        IOracleStakingManager.OracleNode memory node = oracleManager.getOracleInfo(oracleId);
        assertEq(node.stakedAmount, 1800 * 1e18); // 2000 - 10%
    }

    // ============ View Function Tests ============

    function testGetNetworkStats() public {
        vm.prank(oracle1);
        oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle2);
        oracleManager.registerOracle(address(stakeToken), 3000 * 1e18, 0);

        (uint256 totalOracles, uint256 totalStakedUSD, uint256 totalMarkets, uint256 avgAccuracy) =
            oracleManager.getNetworkStats();

        assertEq(totalOracles, 2);
        assertEq(totalStakedUSD, 5000 * 1e18); // $5000 total
        assertEq(totalMarkets, 2);
        assertEq(avgAccuracy, 10000); // 100% default accuracy
    }

    function testGetActiveOracles() public {
        vm.prank(oracle1);
        oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle2);
        oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        bytes32[] memory activeOracles = oracleManager.getActiveOracles();
        assertEq(activeOracles.length, 2);
    }

    function testGetOperatorOracles() public {
        vm.prank(oracle1);
        bytes32 oracleId1 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        // Same operator registers another oracle
        vm.prank(oracle1);
        bytes32 oracleId2 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        bytes32[] memory operatorOracles = oracleManager.getOperatorOracles(oracle1);
        assertEq(operatorOracles.length, 2);
        assertEq(operatorOracles[0], oracleId1);
        assertEq(operatorOracles[1], oracleId2);
    }

    // ============ Price Feed Aggregator Tests ============

    function testPriceFeedAggregatorGetPrice() public {
        // Register 3 oracles and submit prices
        vm.prank(oracle1);
        bytes32 oracleId1 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle2);
        bytes32 oracleId2 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);
        vm.prank(oracle3);
        bytes32 oracleId3 = oracleManager.registerOracle(address(stakeToken), 2000 * 1e18, 0);

        vm.prank(oracle1);
        oracleManager.submitPrice(oracleId1, BTC_USD, 50000 * 1e8);
        vm.prank(oracle2);
        oracleManager.submitPrice(oracleId2, BTC_USD, 50010 * 1e8);
        vm.prank(oracle3);
        oracleManager.submitPrice(oracleId3, BTC_USD, 49990 * 1e8);

        // Get price through aggregator
        (uint256 price, uint256 timestamp, bool isValid) = priceFeedAggregator.getPrice("BTC-USD");
        assertGt(price, 0);
        assertTrue(isValid);
    }
}
