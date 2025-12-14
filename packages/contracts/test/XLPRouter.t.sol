// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {XLPV2Factory} from "../src/amm/v2/XLPV2Factory.sol";
import {XLPV2Pair} from "../src/amm/v2/XLPV2Pair.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPV3Pool} from "../src/amm/v3/XLPV3Pool.sol";
import {XLPRouter} from "../src/amm/XLPRouter.sol";
import {TestERC20} from "../src/mocks/TestERC20.sol";
import {TickMath} from "../src/amm/libraries/TickMath.sol";
import {IXLPV3MintCallback} from "../src/amm/interfaces/IXLPV3Pool.sol";

// Mock WETH for testing
contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad);
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value);
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value);
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= value);
            allowance[from][msg.sender] -= value;
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}

contract XLPRouterTest is Test, IXLPV3MintCallback {
    XLPV2Factory public v2Factory;
    XLPV3Factory public v3Factory;
    XLPRouter public router;
    MockWETH public weth;

    TestERC20 public tokenA;
    TestERC20 public tokenB;
    TestERC20 public tokenC;

    address public v2PairAB;
    address public v2PairBC;
    address public v3PoolAB;

    address public alice = address(0x1);
    address public bob = address(0x2);

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function setUp() public {
        // Deploy infrastructure
        weth = new MockWETH();
        v2Factory = new XLPV2Factory(address(this));
        v3Factory = new XLPV3Factory();
        router = new XLPRouter(address(v2Factory), address(v3Factory), address(weth), address(this));

        // Deploy tokens
        tokenA = new TestERC20("Token A", "TKA", 18);
        tokenB = new TestERC20("Token B", "TKB", 18);
        tokenC = new TestERC20("Token C", "TKC", 18);

        // Ensure proper ordering for pairs
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        // Create V2 pairs
        v2PairAB = v2Factory.createPair(address(tokenA), address(tokenB));
        v2PairBC = v2Factory.createPair(address(tokenB), address(tokenC));

        // Create and initialize V3 pool
        v3PoolAB = v3Factory.createPool(address(tokenA), address(tokenB), 3000);
        XLPV3Pool(v3PoolAB).initialize(SQRT_PRICE_1_1);

        // Fund accounts
        tokenA.mint(address(this), 10000000 ether);
        tokenB.mint(address(this), 10000000 ether);
        tokenC.mint(address(this), 10000000 ether);
        tokenA.mint(alice, 1000000 ether);
        tokenB.mint(alice, 1000000 ether);
        tokenC.mint(alice, 1000000 ether);
        tokenA.mint(bob, 1000000 ether);
        tokenB.mint(bob, 1000000 ether);
        tokenC.mint(bob, 1000000 ether);

        // Setup V2 liquidity
        _addV2Liquidity(v2PairAB, 10000 ether, 10000 ether);
        _addV2Liquidity(v2PairBC, 10000 ether, 10000 ether);

        // Setup V3 liquidity
        _addV3Liquidity(v3PoolAB, -887220, 887220, 100000000000000000);

        // Give ETH to test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ============ V2 Router Tests ============

    function testV2SwapExactTokensForTokens() public {
        uint256 swapAmount = 1 ether;

        // Approve router
        vm.startPrank(alice);
        tokenA.approve(address(router), swapAmount);

        // Get quote
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        uint256[] memory amounts = router.getAmountsOutV2(swapAmount, path);

        uint256 balanceBefore = tokenB.balanceOf(alice);

        // Execute swap
        router.swapExactTokensForTokensV2(
            swapAmount,
            amounts[1] * 99 / 100, // 1% slippage
            path,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        assertEq(tokenB.balanceOf(alice), balanceBefore + amounts[1], "Output amount mismatch");
    }

    function testV2MultiHopSwap() public {
        uint256 swapAmount = 1 ether;

        vm.startPrank(alice);
        tokenA.approve(address(router), swapAmount);

        // A -> B -> C
        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(tokenC);

        uint256[] memory amounts = router.getAmountsOutV2(swapAmount, path);
        uint256 balanceCBefore = tokenC.balanceOf(alice);

        router.swapExactTokensForTokensV2(swapAmount, amounts[2] * 99 / 100, path, alice, block.timestamp + 1 hours);
        vm.stopPrank();

        assertEq(tokenC.balanceOf(alice), balanceCBefore + amounts[2], "Multi-hop output mismatch");
    }

    function testV2SwapExactETHForTokens() public {
        // Create WETH pair
        address wethPair = v2Factory.createPair(address(weth), address(tokenA));

        // Add liquidity (need to wrap ETH first)
        vm.deal(address(this), 100 ether);
        weth.deposit{value: 10 ether}();
        weth.transfer(wethPair, 10 ether);
        tokenA.transfer(wethPair, 10000 ether);
        XLPV2Pair(wethPair).mint(address(this));

        // Swap ETH for tokenA
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(tokenA);

        uint256 balanceBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        router.swapExactETHForTokensV2{value: 1 ether}(
            0, // any amount out
            path,
            alice,
            block.timestamp + 1 hours
        );

        assertGt(tokenA.balanceOf(alice), balanceBefore, "Should receive tokens");
    }

    // ============ V3 Router Tests ============

    function testV3ExactInputSingle() public {
        uint256 swapAmount = 1 ether;

        vm.startPrank(alice);
        tokenA.approve(address(router), swapAmount);

        uint256 balanceBefore = tokenB.balanceOf(alice);

        uint256 amountOut = router.exactInputSingleV3(
            address(tokenA),
            address(tokenB),
            3000,
            alice,
            block.timestamp + 1 hours,
            swapAmount,
            0, // min amount out
            0 // no price limit
        );
        vm.stopPrank();

        assertGt(amountOut, 0, "Should receive tokens");
        assertEq(tokenB.balanceOf(alice), balanceBefore + amountOut);
    }

    // ============ Quote Accuracy Tests ============

    function testV2QuoteAccuracy() public {
        uint256[] memory testAmounts = new uint256[](5);
        testAmounts[0] = 0.01 ether;
        testAmounts[1] = 0.1 ether;
        testAmounts[2] = 1 ether;
        testAmounts[3] = 10 ether;
        testAmounts[4] = 100 ether;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        for (uint256 i = 0; i < testAmounts.length; i++) {
            uint256 swapAmount = testAmounts[i];

            // Get quote
            uint256[] memory quoted = router.getAmountsOutV2(swapAmount, path);

            // Execute actual swap
            vm.startPrank(alice);
            tokenA.approve(address(router), swapAmount);
            uint256 balanceBefore = tokenB.balanceOf(alice);

            router.swapExactTokensForTokensV2(swapAmount, 0, path, alice, block.timestamp + 1 hours);

            uint256 actualOut = tokenB.balanceOf(alice) - balanceBefore;
            vm.stopPrank();

            // Quote should exactly match actual output
            assertEq(actualOut, quoted[1], "Quote mismatch for amount");

            console.log("Swap amount (ETH):", swapAmount / 1e18);
            console.log("  Quoted output:", quoted[1]);
            console.log("  Actual output:", actualOut);
        }
    }

    // ============ Fuzz Tests ============

    function testFuzz_V2Swap(uint96 amount) public {
        amount = uint96(bound(amount, 0.001 ether, 100 ether));

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256[] memory amounts = router.getAmountsOutV2(amount, path);
        if (amounts[1] == 0) return; // Skip if no output

        vm.startPrank(alice);
        tokenA.approve(address(router), amount);

        uint256 balanceBefore = tokenB.balanceOf(alice);

        router.swapExactTokensForTokensV2(amount, 0, path, alice, block.timestamp + 1 hours);

        assertEq(tokenB.balanceOf(alice), balanceBefore + amounts[1]);
        vm.stopPrank();
    }

    // ============ Deadline Tests ============

    function testSwapExpiredDeadline() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), 1 ether);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // Set deadline in the past
        vm.expectRevert(XLPRouter.ExpiredDeadline.selector);
        router.swapExactTokensForTokensV2(1 ether, 0, path, alice, block.timestamp - 1);
        vm.stopPrank();
    }

    // ============ Slippage Protection Tests ============

    function testSlippageProtection() public {
        uint256 swapAmount = 1 ether;

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256[] memory amounts = router.getAmountsOutV2(swapAmount, path);

        vm.startPrank(alice);
        tokenA.approve(address(router), swapAmount);

        // Try to get more than possible - should revert
        vm.expectRevert(XLPRouter.InsufficientOutputAmount.selector);
        router.swapExactTokensForTokensV2(
            swapAmount,
            amounts[1] * 2, // Require 2x output
            path,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();
    }

    // ============ Integration: V2 vs V3 Comparison ============

    function testV2vsV3PriceComparison() public {
        uint256 swapAmount = 1 ether;

        // V2 quote
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        uint256[] memory v2Quote = router.getAmountsOutV2(swapAmount, path);

        // V3 actual swap (we can't easily quote V3 without the quoter, so we just swap)
        vm.startPrank(alice);
        tokenA.approve(address(router), swapAmount);

        uint256 v3Out = router.exactInputSingleV3(
            address(tokenA), address(tokenB), 3000, alice, block.timestamp + 1 hours, swapAmount, 0, 0
        );
        vm.stopPrank();

        console.log("V2 output:", v2Quote[1]);
        console.log("V3 output:", v3Out);

        // Both should give positive outputs - exact amounts depend on liquidity configuration
        assertGt(v2Quote[1], 0, "V2 output should be positive");
        assertGt(v3Out, 0, "V3 output should be positive");
    }

    // ============ Helpers ============

    function _addV2Liquidity(address pairAddr, uint256 amount0, uint256 amount1) internal {
        (address t0, address t1) = XLPV2Pair(pairAddr).token0() < XLPV2Pair(pairAddr).token1()
            ? (XLPV2Pair(pairAddr).token0(), XLPV2Pair(pairAddr).token1())
            : (XLPV2Pair(pairAddr).token1(), XLPV2Pair(pairAddr).token0());

        TestERC20(t0).transfer(pairAddr, amount0);
        TestERC20(t1).transfer(pairAddr, amount1);
        XLPV2Pair(pairAddr).mint(address(this));
    }

    function _addV3Liquidity(address poolAddr, int24 tickLower, int24 tickUpper, uint128 liquidity) internal {
        XLPV3Pool(poolAddr).mint(address(this), tickLower, tickUpper, liquidity, "");
    }

    // V3 callback
    function xlpV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external override {
        address t0 = XLPV3Pool(msg.sender).token0();
        address t1 = XLPV3Pool(msg.sender).token1();
        if (amount0Owed > 0) TestERC20(t0).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) TestERC20(t1).transfer(msg.sender, amount1Owed);
    }

    receive() external payable {}
}
