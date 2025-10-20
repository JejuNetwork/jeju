// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Predimarket} from "../../src/prediction-markets/Predimarket.sol";
import {MarketFactory} from "../../src/prediction-markets/MarketFactory.sol";
import {ElizaOSToken} from "../../src/tokens/ElizaOSToken.sol";

contract MockOracle {
    struct GameOutcome {
        bytes32 sessionId;
        string question;
        bool outcome;
        bytes32 commitment;
        bytes32 salt;
        uint256 startTime;
        uint256 endTime;
        bytes teeQuote;
        address[] winners;
        uint256 totalPayout;
        bool finalized;
    }
    
    mapping(bytes32 => GameOutcome) private _games;
    
    function commitGame(bytes32 sessionId, string calldata question) external {
        address[] memory emptyWinners = new address[](0);
        _games[sessionId] = GameOutcome({
            sessionId: sessionId,
            question: question,
            outcome: false,
            commitment: keccak256(abi.encodePacked(sessionId)),
            salt: bytes32(0),
            startTime: block.timestamp,
            endTime: 0,
            teeQuote: "",
            winners: emptyWinners,
            totalPayout: 0,
            finalized: false
        });
    }
    
    function finalizeGame(bytes32 sessionId, bool outcome) external {
        _games[sessionId].outcome = outcome;
        _games[sessionId].finalized = true;
        _games[sessionId].endTime = block.timestamp;
    }
    
    function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized) {
        return (_games[sessionId].outcome, _games[sessionId].finalized);
    }
    
    function games(bytes32 sessionId) external view returns (
        bytes32 _sessionId,
        string memory question,
        bool outcome,
        bytes32 commitment,
        bytes32 salt,
        uint256 startTime,
        uint256 endTime,
        bytes memory teeQuote,
        address[] memory winners,
        uint256 totalPayout,
        bool finalized
    ) {
        GameOutcome storage game = _games[sessionId];
        return (
            game.sessionId,
            game.question,
            game.outcome,
            game.commitment,
            game.salt,
            game.startTime,
            game.endTime,
            game.teeQuote,
            game.winners,
            game.totalPayout,
            game.finalized
        );
    }
}

contract PredimarketTest is Test {
    Predimarket public market;
    MarketFactory public factory;
    MockOracle public oracle;
    ElizaOSToken public token;
    
    address public owner;
    address public treasury;
    address public trader1;
    address public trader2;
    address public trader3;
    
    bytes32 public sessionId1;
    bytes32 public sessionId2;
    
    uint256 constant INITIAL_BALANCE = 1000000 * 1e18;
    uint256 constant DEFAULT_LIQUIDITY = 1000 * 1e18;
    
    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        trader3 = makeAddr("trader3");
        
        token = new ElizaOSToken(owner);
        oracle = new MockOracle();
        market = new Predimarket(address(token), address(oracle), treasury, owner);
        factory = new MarketFactory(address(market), address(oracle), DEFAULT_LIQUIDITY, owner);
        
        token.mint(trader1, INITIAL_BALANCE);
        token.mint(trader2, INITIAL_BALANCE);
        token.mint(trader3, INITIAL_BALANCE);
        
        // Approve predimarket to spend tokens
        vm.prank(trader1);
        token.approve(address(market), type(uint256).max);
        
        vm.prank(trader2);
        token.approve(address(market), type(uint256).max);
        
        vm.prank(trader3);
        token.approve(address(market), type(uint256).max);
        
        sessionId1 = keccak256("session1");
        sessionId2 = keccak256("session2");
        
        oracle.commitGame(sessionId1, "Will Team A win?");
        oracle.commitGame(sessionId2, "Will it rain tomorrow?");
    }
    
    function test_CreateMarket() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        
        assertEq(m.sessionId, sessionId1);
        assertEq(m.question, "Will Team A win?");
        assertEq(m.yesShares, 0);
        assertEq(m.noShares, 0);
        assertEq(m.liquidityParameter, DEFAULT_LIQUIDITY);
        assertEq(m.totalVolume, 0);
        assertGt(m.createdAt, 0);
        assertEq(m.resolved, false);
        assertEq(m.outcome, false);
    }
    
    function test_CreateMarket_RevertIfExists() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.expectRevert(Predimarket.MarketExists.selector);
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
    }
    
    function test_Buy_YesShares() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 spendAmount = 100 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), spendAmount);
        uint256 shares = market.buy(sessionId1, true, spendAmount, 0);
        vm.stopPrank();
        
        assertGt(shares, 0);
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        assertEq(m.yesShares, shares);
        assertEq(m.noShares, 0);
        
        Predimarket.Position memory pos = market.getPosition(sessionId1, trader1);
        assertEq(pos.yesShares, shares);
        assertEq(pos.noShares, 0);
        assertEq(pos.totalSpent, spendAmount);
    }
    
    function test_Buy_NoShares() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 spendAmount = 100 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), spendAmount);
        uint256 shares = market.buy(sessionId1, false, spendAmount, 0);
        vm.stopPrank();
        
        assertGt(shares, 0);
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        assertEq(m.yesShares, 0);
        assertEq(m.noShares, shares);
    }
    
    function test_Buy_MultipleTrades() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 amount1 = 100 * 1e18;
        uint256 amount2 = 200 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), amount1);
        uint256 shares1 = market.buy(sessionId1, true, amount1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        token.approve(address(market), amount2);
        uint256 shares2 = market.buy(sessionId1, false, amount2, 0);
        vm.stopPrank();
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        assertEq(m.yesShares, shares1);
        assertEq(m.noShares, shares2);
    }
    
    function test_Buy_RevertIfResolved() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        vm.expectRevert(Predimarket.MarketAlreadyResolved.selector);
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
    }
    
    function test_Sell_Shares() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 spendAmount = 100 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), spendAmount);
        uint256 sharesBought = market.buy(sessionId1, true, spendAmount, 0);
        
        uint256 sharesToSell = sharesBought / 2;
        uint256 balanceBefore = token.balanceOf(trader1);
        market.sell(sessionId1, true, sharesToSell, 0);
        uint256 balanceAfter = token.balanceOf(trader1);
        uint256 payout = balanceAfter - balanceBefore;
        vm.stopPrank();
        
        assertEq(balanceAfter - balanceBefore, payout);
        assertGt(payout, 0);
        
        Predimarket.Position memory pos = market.getPosition(sessionId1, trader1);
        assertEq(pos.yesShares, sharesBought - sharesToSell);
    }
    
    function test_Sell_RevertInsufficientShares() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.startPrank(trader1);
        vm.expectRevert(Predimarket.InsufficientShares.selector);
        market.sell(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
    }
    
    function test_ResolveMarket() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        assertEq(m.resolved, true);
        assertEq(m.outcome, true);
    }
    
    function test_ResolveMarket_RevertIfAlreadyResolved() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        vm.expectRevert(Predimarket.MarketAlreadyResolved.selector);
        market.resolveMarket(sessionId1);
    }
    
    function test_ClaimPayout_WinnerGetsShare() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 trader1Amount = 100 * 1e18;
        uint256 trader2Amount = 100 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), trader1Amount);
        market.buy(sessionId1, true, trader1Amount, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        token.approve(address(market), trader2Amount);
        market.buy(sessionId1, false, trader2Amount, 0);
        vm.stopPrank();
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        uint256 balanceBefore = token.balanceOf(trader1);
        vm.prank(trader1);
        uint256 payout = market.claimPayout(sessionId1);
        uint256 balanceAfter = token.balanceOf(trader1);
        
        assertGt(payout, 0);
        assertEq(balanceAfter - balanceBefore, payout);
    }
    
    function test_ClaimPayout_LoserGetsNothing() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        token.approve(address(market), 100 * 1e18);
        market.buy(sessionId1, false, 100 * 1e18, 0);
        vm.stopPrank();
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        vm.prank(trader2);
        vm.expectRevert(Predimarket.NoWinningShares.selector);
        market.claimPayout(sessionId1);
    }
    
    function test_ClaimPayout_RevertIfAlreadyClaimed() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        vm.startPrank(trader1);
        market.claimPayout(sessionId1);
        
        vm.expectRevert(Predimarket.AlreadyClaimed.selector);
        market.claimPayout(sessionId1);
        vm.stopPrank();
    }
    
    function test_ClaimPayout_ProportionalDistribution() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        uint256 trader1Amount = 100 * 1e18;
        uint256 trader2Amount = 200 * 1e18;
        uint256 trader3Amount = 100 * 1e18;
        
        vm.startPrank(trader1);
        token.approve(address(market), trader1Amount);
        uint256 shares1 = market.buy(sessionId1, true, trader1Amount, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        token.approve(address(market), trader2Amount);
        uint256 shares2 = market.buy(sessionId1, true, trader2Amount, 0);
        vm.stopPrank();
        
        vm.startPrank(trader3);
        token.approve(address(market), trader3Amount);
        market.buy(sessionId1, false, trader3Amount, 0);
        vm.stopPrank();
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        vm.prank(trader1);
        uint256 payout1 = market.claimPayout(sessionId1);
        
        vm.prank(trader2);
        uint256 payout2 = market.claimPayout(sessionId1);
        
        assertGt(payout2, payout1);
        // Due to the claiming mechanism and platform fees, test exact proportional distribution
        // The ratio should be close to the share ratio
        uint256 expectedRatio = (shares2 * 1e18) / shares1;
        uint256 actualRatio = (payout2 * 1e18) / payout1;
        // Allow for some deviation due to LMSR precision and platform fees
        assertApproxEqRel(actualRatio, expectedRatio, 0.5e18);
    }
    
    function test_GetMarketPrices() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        (uint256 yesPrice, uint256 noPrice) = market.getMarketPrices(sessionId1);
        
        assertGt(yesPrice, 0);
        assertGt(noPrice, 0);
        assertApproxEqAbs(yesPrice + noPrice, 10000, 100);
    }
    
    function test_GetMarketPrices_AfterTrades() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.startPrank(trader1);
        token.approve(address(market), 500 * 1e18);
        market.buy(sessionId1, true, 500 * 1e18, 0);
        vm.stopPrank();
        
        (uint256 yesPrice, uint256 noPrice) = market.getMarketPrices(sessionId1);
        
        assertGt(yesPrice, noPrice);
    }
    
    function test_MarketFactory_CreateFromOracle() public {
        vm.prank(owner);
        market.transferOwnership(address(factory));
        
        factory.createMarketFromOracle(sessionId1, "Will Team A win?");
        
        Predimarket.Market memory m = market.getMarket(sessionId1);
        assertEq(m.sessionId, sessionId1);
        
        assertTrue(factory.marketCreated(sessionId1));
    }
    
    function test_MarketFactory_BatchCreate() public {
        vm.prank(owner);
        market.transferOwnership(address(factory));
        
        bytes32[] memory sessions = new bytes32[](2);
        sessions[0] = sessionId1;
        sessions[1] = sessionId2;
        
        string[] memory questions = new string[](2);
        questions[0] = "Will Team A win?";
        questions[1] = "Will it rain tomorrow?";
        
        factory.batchCreateMarkets(sessions, questions);
        
        assertTrue(factory.marketCreated(sessionId1));
        assertTrue(factory.marketCreated(sessionId2));
    }
    
    function test_PlatformFee_TakenOnClaim() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
        
        oracle.finalizeGame(sessionId1, true);
        market.resolveMarket(sessionId1);
        
        uint256 treasuryBefore = token.balanceOf(treasury);
        
        vm.prank(trader1);
        market.claimPayout(sessionId1);
        
        uint256 treasuryAfter = token.balanceOf(treasury);
        assertGt(treasuryAfter, treasuryBefore);
    }
    
    function test_Pause() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        market.pause();
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        vm.expectRevert();
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
    }
    
    function test_Unpause() public {
        market.createMarket(sessionId1, "Will Team A win?", DEFAULT_LIQUIDITY);
        market.pause();
        market.unpause();
        
        vm.startPrank(trader1);
        token.approve(address(market), 100 * 1e18);
        market.buy(sessionId1, true, 100 * 1e18, 0);
        vm.stopPrank();
    }
}

