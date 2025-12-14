// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {XLPV2Factory} from "../src/amm/v2/XLPV2Factory.sol";
import {XLPV2Pair} from "../src/amm/v2/XLPV2Pair.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPV3Pool} from "../src/amm/v3/XLPV3Pool.sol";
import {XLPRouter} from "../src/amm/XLPRouter.sol";
import {LiquidityAggregator} from "../src/amm/LiquidityAggregator.sol";
import {RouterRegistry} from "../src/amm/RouterRegistry.sol";
import {TestERC20} from "../src/mocks/TestERC20.sol";
import {TickMath} from "../src/amm/libraries/TickMath.sol";
import {IXLPV3MintCallback} from "../src/amm/interfaces/IXLPV3Pool.sol";

contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad);
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= value;
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

contract RouterIntegrationTest is Test, IXLPV3MintCallback {
    XLPV2Factory public v2Factory;
    XLPV3Factory public v3Factory;
    XLPRouter public router;
    LiquidityAggregator public aggregator;
    RouterRegistry public registry;
    MockWETH public weth;

    TestERC20 public tokenA;
    TestERC20 public tokenB;
    TestERC20 public tokenC;

    address public v2PairAB;
    address public v3PoolAB;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public externalRouter = address(0x1111);

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function setUp() public {
        // Deploy infrastructure
        weth = new MockWETH();
        v2Factory = new XLPV2Factory(address(this));
        v3Factory = new XLPV3Factory();
        router = new XLPRouter(address(v2Factory), address(v3Factory), address(weth), address(this));

        // Deploy aggregator and registry
        aggregator = new LiquidityAggregator(
            address(v2Factory),
            address(v3Factory),
            address(0), // No paymaster for this test
            address(router)
        );

        registry = new RouterRegistry();

        // Configure router
        router.setLiquidityAggregator(address(aggregator));
        router.setRouterRegistry(address(registry));
        router.setRouterApproval(externalRouter, true);

        // Deploy tokens
        tokenA = new TestERC20("Token A", "TKA", 18);
        tokenB = new TestERC20("Token B", "TKB", 18);
        tokenC = new TestERC20("Token C", "TKC", 18);

        // Ensure proper ordering
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        // Create V2 pair
        v2PairAB = v2Factory.createPair(address(tokenA), address(tokenB));

        // Create and initialize V3 pool
        v3PoolAB = v3Factory.createPool(address(tokenA), address(tokenB), 3000);
        XLPV3Pool(v3PoolAB).initialize(SQRT_PRICE_1_1);

        // Fund accounts
        tokenA.mint(address(this), 10000000 ether);
        tokenB.mint(address(this), 10000000 ether);
        tokenC.mint(address(this), 10000000 ether);
        tokenA.mint(alice, 1000000 ether);
        tokenB.mint(alice, 1000000 ether);
        tokenA.mint(bob, 1000000 ether);
        tokenB.mint(bob, 1000000 ether);
        tokenA.mint(externalRouter, 1000000 ether);
        tokenB.mint(externalRouter, 1000000 ether);

        // Setup V2 liquidity
        tokenA.transfer(v2PairAB, 10000 ether);
        tokenB.transfer(v2PairAB, 10000 ether);
        XLPV2Pair(v2PairAB).mint(address(this));

        // Setup V3 liquidity
        XLPV3Pool(v3PoolAB).mint(address(this), -887220, 887220, 100000000000000000, "");

        // Register tokens in aggregator
        aggregator.registerToken(address(tokenA));
        aggregator.registerToken(address(tokenB));
    }

    // ============ Aggregator Tests ============

    function testAggregatorBestQuote() public view {
        uint256 amountIn = 1 ether;

        LiquidityAggregator.Quote memory quote = aggregator.getBestQuote(address(tokenA), address(tokenB), amountIn);

        assertGt(quote.amountOut, 0, "Should get positive output");
        assertTrue(quote.pool != address(0), "Should have pool address");
    }

    function testAggregatorAllQuotes() public view {
        uint256 amountIn = 1 ether;

        LiquidityAggregator.Quote[] memory quotes = aggregator.getAllQuotes(address(tokenA), address(tokenB), amountIn);

        // Should have at least one quote (V2 is always available)
        assertGe(quotes.length, 1, "Should have at least 1 quote");
        assertGt(quotes[0].amountOut, 0, "First quote should have output");
    }

    function testAggregatorLiquidityInfo() public view {
        LiquidityAggregator.LiquidityInfo[] memory infos = aggregator.getLiquidityInfo(address(tokenA), address(tokenB));

        assertGe(infos.length, 2, "Should have liquidity info from V2 and V3");
    }

    function testAggregatorOptimalPath() public view {
        uint256 amountIn = 1 ether;

        (LiquidityAggregator.PoolType poolType, address pool, uint256 expectedOut) =
            aggregator.getOptimalPath(address(tokenA), address(tokenB), amountIn);

        assertGt(expectedOut, 0, "Should have expected output");
        assertTrue(pool != address(0), "Should have pool");
    }

    // ============ Router Registry Tests ============

    function testRegisterRouter() public {
        uint256[] memory chains = new uint256[](2);
        chains[0] = 1;
        chains[1] = 420691;

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        registry.registerRouter(address(router), "XLP Router", "1.0.0", chains, tokens, address(this));

        assertTrue(registry.isRegisteredRouter(address(router)));

        RouterRegistry.RouterInfo memory info = registry.getRouter(address(router));
        assertEq(info.name, "XLP Router");
        assertTrue(info.isActive);
    }

    function testSetChainRouter() public {
        registry.setChainRouter(
            420691,
            address(router),
            address(aggregator),
            address(0x123), // Mock input settler
            address(0x456) // Mock output settler
        );

        RouterRegistry.ChainRouter memory chainRouter = registry.getChainRouter(420691);
        assertEq(chainRouter.router, address(router));
        assertEq(chainRouter.aggregator, address(aggregator));
        assertTrue(chainRouter.isActive);
    }

    function testRouteAvailability() public {
        // Setup chains
        registry.setChainRouter(1, address(router), address(aggregator), address(0x1), address(0x2));
        registry.setChainRouter(420691, address(router), address(aggregator), address(0x3), address(0x4));

        assertTrue(registry.isRouteAvailable(1, 420691));
        assertFalse(registry.isRouteAvailable(1, 999)); // Unsupported chain
    }

    // ============ Router Integration Tests ============

    function testExternalRouterSwap() public {
        uint256 swapAmount = 1 ether;

        // Approve router to spend external router's tokens
        vm.startPrank(externalRouter);
        tokenA.approve(address(router), swapAmount);

        uint256 balanceBefore = tokenB.balanceOf(alice);

        // Execute swap through external router interface
        uint256 amountOut = router.executeSwapForRouter(
            address(tokenA),
            address(tokenB),
            swapAmount,
            0, // min amount out
            alice,
            abi.encode(uint8(0), uint24(3000)) // V2 pool
        );
        vm.stopPrank();

        assertGt(amountOut, 0, "Should receive output");
        assertEq(tokenB.balanceOf(alice), balanceBefore + amountOut);
    }

    function testExternalRouterSwapV3() public {
        uint256 swapAmount = 1 ether;

        vm.startPrank(externalRouter);
        tokenA.approve(address(router), swapAmount);

        uint256 balanceBefore = tokenB.balanceOf(alice);

        // Execute V3 swap
        uint256 amountOut = router.executeSwapForRouter(
            address(tokenA),
            address(tokenB),
            swapAmount,
            0,
            alice,
            abi.encode(uint8(1), uint24(3000)) // V3 pool with 0.3% fee
        );
        vm.stopPrank();

        assertGt(amountOut, 0, "Should receive output");
        assertEq(tokenB.balanceOf(alice), balanceBefore + amountOut);
    }

    function testQuoteForRouter() public view {
        uint256 amountIn = 1 ether;

        (uint256 amountOut, uint8 poolType,) = router.quoteForRouter(address(tokenA), address(tokenB), amountIn);

        assertGt(amountOut, 0, "Should get quote");
        assertTrue(poolType == 0 || poolType == 1, "Should be V2 or V3");
    }

    function testUnauthorizedRouter() public {
        address unauthorizedRouter = address(0xBad);

        vm.startPrank(unauthorizedRouter);

        vm.expectRevert(XLPRouter.NotApprovedRouter.selector);
        router.executeSwapForRouter(address(tokenA), address(tokenB), 1 ether, 0, alice, "");
        vm.stopPrank();
    }

    // ============ Referral Tests ============

    function testReferralTracking() public {
        // Set referrer
        vm.prank(alice);
        router.setReferrer(bob);

        assertEq(router.referrers(alice), bob);

        // Execute swap through external router with alice as recipient
        uint256 swapAmount = 10 ether;

        vm.startPrank(externalRouter);
        tokenA.approve(address(router), swapAmount);

        router.executeSwapForRouter(
            address(tokenA), address(tokenB), swapAmount, 0, alice, abi.encode(uint8(0), uint24(3000))
        );
        vm.stopPrank();

        // Check referral volume tracked
        assertEq(router.getReferralVolume(bob), swapAmount);
    }

    // ============ V3 Callback ============

    function xlpV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external override {
        address t0 = XLPV3Pool(msg.sender).token0();
        address t1 = XLPV3Pool(msg.sender).token1();
        if (amount0Owed > 0) TestERC20(t0).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) TestERC20(t1).transfer(msg.sender, amount1Owed);
    }

    receive() external payable {}
}
