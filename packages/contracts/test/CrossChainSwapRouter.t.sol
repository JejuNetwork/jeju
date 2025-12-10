// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {CrossChainSwapRouter} from "../src/liquidity/CrossChainSwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock PoolManager for testing
contract MockPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    uint256 public swapCallCount;
    int256 public lastAmount0;
    int256 public lastAmount1;

    // Mock 1:1 swap ratio for simplicity
    function swap(PoolKey calldata, SwapParams calldata params, bytes calldata)
        external
        returns (int256 amount0, int256 amount1)
    {
        swapCallCount++;
        
        if (params.zeroForOne) {
            amount0 = params.amountSpecified;
            amount1 = -params.amountSpecified; // Output is negative
        } else {
            amount0 = -params.amountSpecified;
            amount1 = params.amountSpecified;
        }
        
        lastAmount0 = amount0;
        lastAmount1 = amount1;
    }
}

// Mock CrossChainPaymaster for testing
contract MockCrossChainPaymaster {
    mapping(address => uint256) public liquidity;
    uint256 public requestCount;
    
    function createVoucherRequest(
        address,
        uint256,
        address,
        uint256,
        address,
        uint256,
        uint256,
        uint256
    ) external payable returns (bytes32) {
        requestCount++;
        return keccak256(abi.encodePacked(requestCount, msg.sender));
    }
    
    function supportedTokens(address) external pure returns (bool) {
        return true;
    }
    
    function getTotalLiquidity(address token) external view returns (uint256) {
        return liquidity[token];
    }
    
    function setLiquidity(address token, uint256 amount) external {
        liquidity[token] = amount;
    }
}

// Mock ERC20 for testing
contract MockERC20 is IERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    
    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply += amount;
    }
    
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }
    
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }
}

contract CrossChainSwapRouterTest is Test {
    CrossChainSwapRouter public router;
    MockPoolManager public poolManager;
    MockCrossChainPaymaster public paymaster;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    address public owner = address(this);
    address public treasury = address(0x999);
    address public user = address(0x1);
    
    function setUp() public {
        poolManager = new MockPoolManager();
        paymaster = new MockCrossChainPaymaster();
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        
        router = new CrossChainSwapRouter(
            address(poolManager),
            address(paymaster),
            treasury,
            owner
        );
        
        // Fund user
        vm.deal(user, 100 ether);
        tokenA.mint(user, 1000 ether);
        tokenA.mint(address(router), 1000 ether); // For output
        tokenB.mint(address(router), 1000 ether);
        
        // Set XLP liquidity
        paymaster.setLiquidity(address(0), 100 ether);
    }
    
    // ============ Route Registration ============
    
    function test_RegisterRoute() public {
        CrossChainSwapRouter.PoolKey memory poolKey = CrossChainSwapRouter.PoolKey({
            currency0: address(tokenA),
            currency1: address(tokenB),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        
        router.registerRoute(
            1, // sourceChainId
            address(tokenB), // destinationToken
            address(tokenA), // intermediateToken
            poolKey
        );
        
        (bool exists,,,) = router.routes(1, address(tokenB));
        assertTrue(exists);
    }
    
    function test_RegisterPool() public {
        CrossChainSwapRouter.PoolKey memory poolKey = CrossChainSwapRouter.PoolKey({
            currency0: address(tokenA),
            currency1: address(tokenB),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        
        router.registerPool(poolKey);
        
        bytes32 poolKeyHash = keccak256(abi.encode(poolKey));
        (address c0,,,,) = router.poolKeys(poolKeyHash);
        assertEq(c0, address(tokenA));
    }
    
    // ============ Quote Functions ============
    
    function test_QuoteLocal() public view {
        (uint256 amountOut, uint256 priceImpact) = router.quoteLocal(
            address(tokenA),
            address(tokenB),
            1 ether,
            3000 // 0.3% fee (in hundredths of a basis point)
        );
        
        // Should be input minus 0.3% fee
        // 1 ether * (1000000 - 3000) / 1000000 = 0.997 ether
        assertEq(amountOut, 1 ether * 997000 / 1000000);
        assertEq(priceImpact, 10);
    }
    
    function test_QuoteCrossChain() public {
        // Register route first
        CrossChainSwapRouter.PoolKey memory poolKey = CrossChainSwapRouter.PoolKey({
            currency0: address(tokenA),
            currency1: address(tokenB),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        
        router.registerRoute(
            block.chainid,
            address(tokenB),
            address(tokenA),
            poolKey
        );
        
        (uint256 amountOut, uint256 xlpFee, uint256 v4Fee, uint256 routerFee) = 
            router.quoteCrossChain(block.chainid, address(tokenB), 10 ether);
        
        // XLP fee: 0.05%
        assertEq(xlpFee, 10 ether * 5 / 10000);
        
        // V4 fee: 0.3% of remaining
        uint256 afterXlp = 10 ether - xlpFee;
        assertEq(v4Fee, afterXlp * 3000 / 1000000);
        
        // Router fee: 0.1% of remaining
        uint256 afterV4 = afterXlp - v4Fee;
        assertEq(routerFee, afterV4 * 10 / 10000);
        
        assertEq(amountOut, afterV4 - routerFee);
    }
    
    // ============ Liquidity Check ============
    
    function test_CheckRouteLiquidity() public {
        CrossChainSwapRouter.PoolKey memory poolKey = CrossChainSwapRouter.PoolKey({
            currency0: address(0),
            currency1: address(tokenB),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        
        router.registerRoute(
            block.chainid,
            address(tokenB),
            address(0), // ETH intermediate
            poolKey
        );
        
        (bool hasLiquidity, uint256 xlpLiquidity) = router.checkRouteLiquidity(
            block.chainid,
            address(tokenB),
            10 ether
        );
        
        assertTrue(hasLiquidity);
        assertEq(xlpLiquidity, 100 ether);
    }
    
    function test_CheckRouteLiquidity_Insufficient() public {
        CrossChainSwapRouter.PoolKey memory poolKey = CrossChainSwapRouter.PoolKey({
            currency0: address(0),
            currency1: address(tokenB),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        
        router.registerRoute(
            block.chainid,
            address(tokenB),
            address(0),
            poolKey
        );
        
        // Set low liquidity
        paymaster.setLiquidity(address(0), 0.01 ether);
        
        (bool hasLiquidity,) = router.checkRouteLiquidity(
            block.chainid,
            address(tokenB),
            10 ether
        );
        
        assertFalse(hasLiquidity);
    }
    
    // ============ Admin Functions ============
    
    function test_SetRouterFee() public {
        router.setRouterFee(50); // 0.5%
        assertEq(router.routerFeeBps(), 50);
    }
    
    function test_SetRouterFee_MaxExceeded() public {
        vm.expectRevert("Max 1%");
        router.setRouterFee(101);
    }
    
    function test_SetTreasury() public {
        address newTreasury = address(0x888);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }
    
    function test_OnlyOwnerCanSetFee() public {
        vm.prank(user);
        vm.expectRevert();
        router.setRouterFee(50);
    }
    
    // ============ Version ============
    
    function test_Version() public view {
        assertEq(router.version(), "1.0.0");
    }
}
