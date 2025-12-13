// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Contest} from "src/games/Contest.sol";
import {Predimarket} from "src/prediction-markets/Predimarket.sol";
import {MarketFactory} from "src/prediction-markets/MarketFactory.sol";
import {IPredictionOracle} from "src/prediction-markets/IPredictionOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ContestIntegration Test
 * @notice Full integration tests for Contest → Predimarket flow
 * @dev Tests complete lifecycle with betting, grace period, and payouts
 */
contract ContestIntegrationTest is Test {
    Contest public contest;
    Predimarket public predimarket;
    MarketFactory public factory;
    MockERC20 public token;

    address owner = address(this);
    address teePublisher = address(0x1);
    address trader1 = address(0x2);
    address trader2 = address(0x3);
    address trader3 = address(0x4);
    address treasury = address(0x5);

    bytes32 testContainerHash;
    string[] testOptions;

    uint256 constant INITIAL_BALANCE = 10000 ether;
    uint256 constant BET_AMOUNT = 100 ether;

    function setUp() public {
        // Deploy token
        token = new MockERC20("Test Token", "TEST");
        token.mint(trader1, INITIAL_BALANCE);
        token.mint(trader2, INITIAL_BALANCE);
        token.mint(trader3, INITIAL_BALANCE);

        // Deploy Contest oracle
        contest = new Contest(teePublisher);

        // Setup container hash
        testContainerHash = keccak256(abi.encodePacked("ehorse-tee:v1.0.0"));
        contest.approveContainerHash(testContainerHash, true);

        // Deploy Predimarket
        predimarket = new Predimarket(
            address(token),
            address(contest), // Contest implements IPredictionOracle
            treasury,
            owner
        );

        // Deploy MarketFactory
        factory = new MarketFactory(
            address(predimarket),
            address(contest),
            1000 ether, // Default liquidity
            owner
        );

        // Transfer Predimarket ownership to factory
        predimarket.transferOwnership(address(factory));

        // Setup test options
        testOptions = new string[](4);
        testOptions[0] = "Thunder";
        testOptions[1] = "Lightning";
        testOptions[2] = "Storm";
        testOptions[3] = "Blaze";
    }

    // ============ Full Flow Integration Tests ============

    function testCompleteContestWithBetting() public {
        // 1. ANNOUNCE CONTEST
        vm.prank(teePublisher);
        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // 2. START CONTEST (trading opens)
        vm.warp(startTime);
        vm.prank(teePublisher);
        contest.startContest(contestId);

        // 3. CREATE MARKET
        vm.prank(owner);
        string memory question = "Will Storm or Blaze win?";
        factory.createMarketFromOracle(contestId, question);

        // Verify market exists
        Predimarket.Market memory market = predimarket.getMarket(contestId);
        assertEq(market.sessionId, contestId);
        assertTrue(market.createdAt > 0);

        // 4. TRADERS BET
        // Trader1 bets YES (Storm/Blaze will win)
        vm.startPrank(trader1);
        token.approve(address(predimarket), type(uint256).max);
        predimarket.buy(contestId, true, BET_AMOUNT, 0);
        vm.stopPrank();

        // Trader2 bets NO (Thunder/Lightning will win)
        vm.startPrank(trader2);
        token.approve(address(predimarket), type(uint256).max);
        predimarket.buy(contestId, false, BET_AMOUNT, 0);
        vm.stopPrank();

        // Trader3 also bets YES
        vm.startPrank(trader3);
        token.approve(address(predimarket), type(uint256).max);
        predimarket.buy(contestId, true, BET_AMOUNT, 0);
        vm.stopPrank();

        // 5. GRACE PERIOD (trading frozen)
        vm.warp(startTime + 60);
        vm.prank(teePublisher);
        contest.startGracePeriod(contestId);

        // Verify trading is rejected during grace period
        vm.startPrank(trader1);
        vm.expectRevert(Predimarket.TradingFrozen.selector);
        predimarket.buy(contestId, true, BET_AMOUNT, 0);
        vm.stopPrank();

        // 6. PUBLISH RESULTS (Storm wins - index 2)
        vm.warp(startTime + 90);
        vm.prank(teePublisher);
        contest.publishResults(contestId, 2, testContainerHash, "attestation", "signature");

        // 7. RESOLVE MARKET
        predimarket.resolveMarket(contestId);

        // Verify resolution
        market = predimarket.getMarket(contestId);
        assertTrue(market.resolved);
        assertTrue(market.outcome); // Storm (index 2) >= midpoint (2) = YES

        // 8. WINNERS CLAIM PAYOUTS
        uint256 trader1BalanceBefore = token.balanceOf(trader1);
        uint256 trader3BalanceBefore = token.balanceOf(trader3);

        vm.prank(trader1);
        predimarket.claimPayout(contestId);

        vm.prank(trader3);
        predimarket.claimPayout(contestId);

        // Verify winners received payouts
        assertGt(token.balanceOf(trader1), trader1BalanceBefore);
        assertGt(token.balanceOf(trader3), trader3BalanceBefore);

        // 9. LOSER CANNOT CLAIM
        vm.prank(trader2);
        vm.expectRevert();
        predimarket.claimPayout(contestId);
    }

    function testMultipleRacesWithDifferentOutcomes() public {
        vm.startPrank(teePublisher);

        // Race 1: Thunder wins (index 0 = NO)
        uint256 startTime1 = block.timestamp + 30;
        bytes32 contestId1 =
            contest.announceContest(testOptions, startTime1, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime1);
        contest.startContest(contestId1);

        vm.warp(startTime1 + 60);
        contest.startGracePeriod(contestId1);

        vm.warp(startTime1 + 90);
        contest.publishResults(contestId1, 0, testContainerHash, "", ""); // Thunder

        // Race 2: Blaze wins (index 3 = YES)
        uint256 startTime2 = block.timestamp + 30;
        bytes32 contestId2 =
            contest.announceContest(testOptions, startTime2, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime2);
        contest.startContest(contestId2);

        vm.warp(startTime2 + 60);
        contest.startGracePeriod(contestId2);

        vm.warp(startTime2 + 90);
        contest.publishResults(contestId2, 3, testContainerHash, "", ""); // Blaze

        vm.stopPrank();

        // Verify different outcomes
        (bool outcome1,) = contest.getOutcome(contestId1);
        (bool outcome2,) = contest.getOutcome(contestId2);

        assertFalse(outcome1); // Thunder = NO
        assertTrue(outcome2); // Blaze = YES
    }

    function testMarketFactoryAutoCreation() public {
        // Announce contest
        vm.prank(teePublisher);
        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Start contest
        vm.warp(startTime);
        vm.prank(teePublisher);
        contest.startContest(contestId);

        // MarketFactory should be able to create market
        string memory question = "Will Storm or Blaze win?";
        factory.createMarketFromOracle(contestId, question);

        // Verify market was created
        assertTrue(factory.marketCreated(contestId));

        Predimarket.Market memory market = predimarket.getMarket(contestId);
        assertTrue(market.createdAt > 0);
    }

    function testGracePeriodInIntegration() public {
        // Setup contest
        vm.prank(teePublisher);
        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        vm.prank(teePublisher);
        contest.startContest(contestId);

        // Create market and place bet
        factory.createMarketFromOracle(contestId, "Will Storm or Blaze win?");

        vm.startPrank(trader1);
        token.approve(address(predimarket), type(uint256).max);
        predimarket.buy(contestId, true, BET_AMOUNT, 0);
        vm.stopPrank();

        // Enter grace period
        vm.warp(startTime + 60);
        vm.prank(teePublisher);
        contest.startGracePeriod(contestId);

        // Verify state is GRACE_PERIOD (provides MEV protection)
        (IPredictionOracle.ContestState state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.GRACE_PERIOD));

        // After grace period, results can be published
        vm.warp(startTime + 90); // 30s after grace started
        vm.prank(teePublisher);
        contest.publishResults(contestId, 2, testContainerHash, "", "");

        // Verify results published
        (uint256 winner, bool finalized) = contest.getWinner(contestId);
        assertEq(winner, 2);
        assertTrue(finalized);

        // Note: Grace period timing enforcement is tested in Contest.t.sol::testPublishResultsTooEarly
    }
}

// Mock ERC20 for testing
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balances[from] >= amount, "Insufficient balance");
        require(allowances[from][msg.sender] >= amount, "Insufficient allowance");

        balances[from] -= amount;
        balances[to] += amount;
        allowances[from][msg.sender] -= amount;

        emit Transfer(from, to, amount);
        return true;
    }
}
