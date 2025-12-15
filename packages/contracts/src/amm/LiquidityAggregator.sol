// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IXLPV2Pair.sol";
import "./interfaces/IXLPV2Factory.sol";
import "./interfaces/IXLPV3Pool.sol";

/// @title Liquidity Aggregator
/// @author Jeju Network
/// @notice Aggregates liquidity from V2 pools, V3 pools, and CrossChainPaymaster
/// @dev Enables external routers to query best rates across all XLP liquidity sources
contract LiquidityAggregator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Pool Types ============

    enum PoolType {
        V2, // Constant product (xy=k)
        V3, // Concentrated liquidity
        PAYMASTER // CrossChainPaymaster embedded AMM

    }

    // ============ State Variables ============

    /// @notice V2 Factory address
    address public v2Factory;

    /// @notice V3 Factory address
    address public v3Factory;

    /// @notice CrossChainPaymaster address
    address public paymaster;

    /// @notice XLP Router address
    address public router;

    /// @notice Registered tokens for aggregation
    address[] public registeredTokens;
    mapping(address => bool) public isRegisteredToken;

    /// @notice Preferred pool type per token pair
    mapping(bytes32 => PoolType) public preferredPoolType;

    // ============ Structs ============

    struct Quote {
        PoolType poolType;
        address pool;
        uint256 amountOut;
        uint256 priceImpactBps;
        uint24 fee;
    }

    struct LiquidityInfo {
        PoolType poolType;
        address pool;
        uint256 reserve0;
        uint256 reserve1;
        uint256 liquidity;
        uint24 fee;
    }

    // ============ Events ============

    event TokenRegistered(address indexed token);
    event TokenDeregistered(address indexed token);
    event FactoriesUpdated(address v2Factory, address v3Factory);
    event PaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event PreferredPoolSet(address indexed token0, address indexed token1, PoolType poolType);

    // ============ Errors ============

    error InvalidAddress();
    error TokenNotRegistered();
    error NoLiquidityFound();
    error InsufficientLiquidity();

    // ============ Constructor ============

    constructor(address _v2Factory, address _v3Factory, address _paymaster, address _router) Ownable(msg.sender) {
        v2Factory = _v2Factory;
        v3Factory = _v3Factory;
        paymaster = _paymaster;
        router = _router;
    }

    // ============ Admin Functions ============

    function setFactories(address _v2Factory, address _v3Factory) external onlyOwner {
        v2Factory = _v2Factory;
        v3Factory = _v3Factory;
        emit FactoriesUpdated(_v2Factory, _v3Factory);
    }

    function setPaymaster(address _paymaster) external onlyOwner {
        emit PaymasterUpdated(paymaster, _paymaster);
        paymaster = _paymaster;
    }

    function setRouter(address _router) external onlyOwner {
        emit RouterUpdated(router, _router);
        router = _router;
    }

    function registerToken(address token) external onlyOwner {
        if (isRegisteredToken[token]) return;
        registeredTokens.push(token);
        isRegisteredToken[token] = true;
        emit TokenRegistered(token);
    }

    function deregisterToken(address token) external onlyOwner {
        isRegisteredToken[token] = false;
        emit TokenDeregistered(token);
    }

    function setPreferredPool(address token0, address token1, PoolType poolType) external onlyOwner {
        bytes32 pairKey = _getPairKey(token0, token1);
        preferredPoolType[pairKey] = poolType;
        emit PreferredPoolSet(token0, token1, poolType);
    }

    // ============ Quote Functions ============

    /// @notice Get best quote across all liquidity sources
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Amount of input token
    /// @return bestQuote The best quote found
    function getBestQuote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (Quote memory bestQuote)
    {
        Quote[] memory quotes = getAllQuotes(tokenIn, tokenOut, amountIn);

        uint256 bestAmount = 0;
        for (uint256 i = 0; i < quotes.length; i++) {
            if (quotes[i].amountOut > bestAmount) {
                bestAmount = quotes[i].amountOut;
                bestQuote = quotes[i];
            }
        }
    }

    /// @notice Get quotes from all available liquidity sources
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Amount of input token
    /// @return quotes Array of quotes from each source
    function getAllQuotes(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (Quote[] memory quotes)
    {
        // Count available quotes
        uint256 count = 0;
        Quote memory v2Quote = _getV2Quote(tokenIn, tokenOut, amountIn);
        if (v2Quote.amountOut > 0) count++;

        Quote memory v3Quote500 = _getV3Quote(tokenIn, tokenOut, amountIn, 500);
        if (v3Quote500.amountOut > 0) count++;

        Quote memory v3Quote3000 = _getV3Quote(tokenIn, tokenOut, amountIn, 3000);
        if (v3Quote3000.amountOut > 0) count++;

        Quote memory v3Quote10000 = _getV3Quote(tokenIn, tokenOut, amountIn, 10000);
        if (v3Quote10000.amountOut > 0) count++;

        Quote memory paymasterQuote = _getPaymasterQuote(tokenIn, tokenOut, amountIn);
        if (paymasterQuote.amountOut > 0) count++;

        // Build quotes array
        quotes = new Quote[](count);
        uint256 idx = 0;

        if (v2Quote.amountOut > 0) quotes[idx++] = v2Quote;
        if (v3Quote500.amountOut > 0) quotes[idx++] = v3Quote500;
        if (v3Quote3000.amountOut > 0) quotes[idx++] = v3Quote3000;
        if (v3Quote10000.amountOut > 0) quotes[idx++] = v3Quote10000;
        if (paymasterQuote.amountOut > 0) quotes[idx++] = paymasterQuote;
    }

    /// @notice Get liquidity info for a token pair across all sources
    /// @param token0 First token
    /// @param token1 Second token
    /// @return infos Array of liquidity info from each source
    function getLiquidityInfo(address token0, address token1) external view returns (LiquidityInfo[] memory infos) {
        // Count available pools
        uint256 count = 0;

        address v2Pair = _getV2Pair(token0, token1);
        if (v2Pair != address(0)) count++;

        address v3Pool500 = _getV3Pool(token0, token1, 500);
        if (v3Pool500 != address(0)) count++;

        address v3Pool3000 = _getV3Pool(token0, token1, 3000);
        if (v3Pool3000 != address(0)) count++;

        address v3Pool10000 = _getV3Pool(token0, token1, 10000);
        if (v3Pool10000 != address(0)) count++;

        // Always include paymaster if set
        if (paymaster != address(0)) count++;

        infos = new LiquidityInfo[](count);
        uint256 idx = 0;

        // V2 Pair
        if (v2Pair != address(0)) {
            (uint112 r0, uint112 r1,) = IXLPV2Pair(v2Pair).getReserves();
            infos[idx++] = LiquidityInfo({
                poolType: PoolType.V2,
                pool: v2Pair,
                reserve0: r0,
                reserve1: r1,
                liquidity: _sqrt(uint256(r0) * uint256(r1)),
                fee: 3000 // 0.3% fixed
            });
        }

        // V3 Pools
        if (v3Pool500 != address(0)) {
            infos[idx++] = _getV3PoolInfo(v3Pool500, 500);
        }
        if (v3Pool3000 != address(0)) {
            infos[idx++] = _getV3PoolInfo(v3Pool3000, 3000);
        }
        if (v3Pool10000 != address(0)) {
            infos[idx++] = _getV3PoolInfo(v3Pool10000, 10000);
        }

        // Paymaster
        if (paymaster != address(0)) {
            infos[idx++] = _getPaymasterInfo(token0, token1);
        }
    }

    /// @notice Get total liquidity across all sources for a token
    /// @param token Token to check
    /// @return totalLiquidity Sum of all liquidity
    function getTotalLiquidity(address token) external view returns (uint256 totalLiquidity) {
        // Check all registered tokens for pairs
        for (uint256 i = 0; i < registeredTokens.length; i++) {
            address otherToken = registeredTokens[i];
            if (otherToken == token) continue;

            // V2
            address v2Pair = _getV2Pair(token, otherToken);
            if (v2Pair != address(0)) {
                (uint112 r0, uint112 r1,) = IXLPV2Pair(v2Pair).getReserves();
                address token0 = IXLPV2Pair(v2Pair).token0();
                totalLiquidity += token == token0 ? r0 : r1;
            }

            // V3 (check 0.3% tier)
            address v3Pool = _getV3Pool(token, otherToken, 3000);
            if (v3Pool != address(0)) {
                totalLiquidity += IXLPV3Pool(v3Pool).liquidity();
            }
        }

        // Paymaster liquidity
        if (paymaster != address(0)) {
            if (token == address(0)) {
                totalLiquidity += _getPaymasterETH();
            } else {
                totalLiquidity += _getPaymasterTokenLiquidity(token);
            }
        }
    }

    // ============ Router Integration ============

    /// @notice Get optimal swap path for maximum output
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Amount to swap
    /// @return poolType Best pool type
    /// @return pool Best pool address
    /// @return expectedOut Expected output amount
    function getOptimalPath(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (PoolType poolType, address pool, uint256 expectedOut)
    {
        Quote memory quote = this.getBestQuote(tokenIn, tokenOut, amountIn);
        return (quote.poolType, quote.pool, quote.amountOut);
    }

    /// @notice Check if router can execute a swap
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Input amount
    /// @param minAmountOut Minimum output
    /// @return canSwap Whether swap is possible
    /// @return reason Reason if cannot swap
    function canExecuteSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        view
        returns (bool canSwap, string memory reason)
    {
        Quote memory quote = this.getBestQuote(tokenIn, tokenOut, amountIn);

        if (quote.pool == address(0)) {
            return (false, "No liquidity");
        }
        if (quote.amountOut < minAmountOut) {
            return (false, "Insufficient output");
        }
        return (true, "");
    }

    // ============ Internal Quote Functions ============

    function _getV2Quote(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (Quote memory v2Quote)
    {
        if (v2Factory == address(0)) return v2Quote;

        address pair = _getV2Pair(tokenIn, tokenOut);
        if (pair == address(0)) return v2Quote;

        (uint112 reserve0, uint112 reserve1,) = IXLPV2Pair(pair).getReserves();
        address token0 = IXLPV2Pair(pair).token0();

        (uint256 reserveIn, uint256 reserveOut) =
            tokenIn == token0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));

        if (reserveIn == 0 || reserveOut == 0) return v2Quote;

        uint256 amountInWithFee = amountIn * 997;
        uint256 amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        uint256 priceImpact = (amountIn * 10000) / reserveIn;

        v2Quote = Quote({poolType: PoolType.V2, pool: pair, amountOut: amountOut, priceImpactBps: priceImpact, fee: 3000});
    }

    function _getV3Quote(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee)
        internal
        view
        returns (Quote memory v3Quote)
    {
        if (v3Factory == address(0)) return v3Quote;

        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        if (pool == address(0)) return v3Quote;

        uint128 liquidity = IXLPV3Pool(pool).liquidity();
        if (liquidity == 0) return v3Quote;

        // Simplified quote - in production use QuoterV2
        (uint160 sqrtPriceX96,,,,,,) = IXLPV3Pool(pool).slot0();
        if (sqrtPriceX96 == 0) return v3Quote;

        // Estimate output based on current price and liquidity
        // This is a simplification - actual output depends on tick range
        bool zeroForOne = tokenIn < tokenOut;
        uint256 price = zeroForOne
            ? (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192
            : (1 << 192) / (uint256(sqrtPriceX96) * uint256(sqrtPriceX96));

        uint256 amountOutEstimate = (amountIn * price) >> 96;
        amountOutEstimate = amountOutEstimate * (1e6 - fee) / 1e6;

        // Very rough price impact estimate
        uint256 priceImpact = (amountIn * 10000) / (uint256(liquidity) + amountIn);

        v3Quote = Quote({
            poolType: PoolType.V3,
            pool: pool,
            amountOut: amountOutEstimate,
            priceImpactBps: priceImpact,
            fee: fee
        });
    }

    function _getPaymasterQuote(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (Quote memory pmQuote)
    {
        if (paymaster == address(0)) return pmQuote;

        // Query paymaster's embedded AMM
        (bool success, bytes memory data) = paymaster.staticcall(
            abi.encodeWithSignature("getSwapQuote(address,address,uint256)", tokenIn, tokenOut, amountIn)
        );

        if (success && data.length >= 64) {
            (uint256 amountOut, uint256 priceImpact) = abi.decode(data, (uint256, uint256));
            pmQuote = Quote({
                poolType: PoolType.PAYMASTER,
                pool: paymaster,
                amountOut: amountOut,
                priceImpactBps: priceImpact,
                fee: 30 // 0.3%
            });
        }
    }

    // ============ Internal Helper Functions ============

    function _getV2Pair(address tokenA, address tokenB) internal view returns (address) {
        if (v2Factory == address(0)) return address(0);
        return IXLPV2Factory(v2Factory).getPair(tokenA, tokenB);
    }

    function _getV3Pool(address tokenA, address tokenB, uint24 fee) internal view returns (address) {
        if (v3Factory == address(0)) return address(0);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (bool success, bytes memory data) =
            v3Factory.staticcall(abi.encodeWithSignature("getPool(address,address,uint24)", token0, token1, fee));
        if (!success || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }

    function _getV3PoolInfo(address pool, uint24 fee) internal view returns (LiquidityInfo memory info) {
        uint128 liquidity = IXLPV3Pool(pool).liquidity();
        return LiquidityInfo({
            poolType: PoolType.V3,
            pool: pool,
            reserve0: 0, // V3 doesn't have simple reserves
            reserve1: 0,
            liquidity: liquidity,
            fee: fee
        });
    }

    function _getPaymasterInfo(address token0, address token1) internal view returns (LiquidityInfo memory info) {
        (bool success, bytes memory data) =
            paymaster.staticcall(abi.encodeWithSignature("getReserves(address,address)", token0, token1));

        uint256 r0;
        uint256 r1;
        if (success && data.length >= 64) {
            (r0, r1) = abi.decode(data, (uint256, uint256));
        }

        return LiquidityInfo({
            poolType: PoolType.PAYMASTER,
            pool: paymaster,
            reserve0: r0,
            reserve1: r1,
            liquidity: _sqrt(r0 * r1),
            fee: 30
        });
    }

    function _getPaymasterETH() internal view returns (uint256) {
        (bool success, bytes memory data) =
            paymaster.staticcall(abi.encodeWithSignature("getTotalLiquidity(address)", address(0)));
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        return 0;
    }

    function _getPaymasterTokenLiquidity(address token) internal view returns (uint256) {
        (bool success, bytes memory data) =
            paymaster.staticcall(abi.encodeWithSignature("getTotalLiquidity(address)", token));
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        return 0;
    }

    function _getPairKey(address token0, address token1) internal pure returns (bytes32) {
        return
            token0 < token1 ? keccak256(abi.encodePacked(token0, token1)) : keccak256(abi.encodePacked(token1, token0));
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    // ============ View Functions ============

    function getRegisteredTokens() external view returns (address[] memory) {
        return registeredTokens;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ============ External Aggregator Interfaces ============
    // These functions enable external DEX aggregators (1inch, Paraswap, 0x, etc.)
    // to discover and route through our liquidity pools

    /// @notice 1inch/Paraswap compatible quote interface
    /// @dev Returns the expected output amount for a swap
    /// @param srcToken Source token address
    /// @param dstToken Destination token address  
    /// @param amount Amount of source token
    /// @return returnAmount Expected output amount
    /// @return routeData Encoded route data for execution
    function getAmountOut(
        address srcToken,
        address dstToken,
        uint256 amount
    ) external view returns (uint256 returnAmount, bytes memory routeData) {
        Quote memory bestQuote = this.getBestQuote(srcToken, dstToken, amount);
        return (bestQuote.amountOut, abi.encode(bestQuote.pool, bestQuote.poolType, bestQuote.fee));
    }

    /// @notice Multi-hop quote for complex routes
    /// @param tokens Array of tokens in the path
    /// @param amounts Array of amounts (first is input)
    /// @return finalAmount Expected final output
    function getAmountsOut(
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external view returns (uint256 finalAmount) {
        if (tokens.length < 2 || amounts.length == 0) return 0;
        
        uint256 currentAmount = amounts[0];
        for (uint256 i = 0; i < tokens.length - 1; i++) {
            Quote memory hopQuote = this.getBestQuote(tokens[i], tokens[i + 1], currentAmount);
            if (hopQuote.amountOut == 0) return 0;
            currentAmount = hopQuote.amountOut;
        }
        return currentAmount;
    }

    /// @notice 0x-compatible quote structure
    /// @param takerToken Token being sold
    /// @param makerToken Token being bought
    /// @param takerTokenAmount Amount of taker token
    /// @return makerTokenAmount Expected output
    /// @return sources Array of liquidity sources used
    /// @return gasEstimate Estimated gas for execution
    function quote(
        address takerToken,
        address makerToken,
        uint256 takerTokenAmount
    ) external view returns (
        uint256 makerTokenAmount,
        string[] memory sources,
        uint256 gasEstimate
    ) {
        Quote[] memory quotes = getAllQuotes(takerToken, makerToken, takerTokenAmount);
        
        uint256 bestAmount = 0;
        uint256 sourceCount = 0;
        
        for (uint256 i = 0; i < quotes.length; i++) {
            if (quotes[i].amountOut > bestAmount) {
                bestAmount = quotes[i].amountOut;
            }
            if (quotes[i].amountOut > 0) {
                sourceCount++;
            }
        }
        
        sources = new string[](sourceCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < quotes.length && idx < sourceCount; i++) {
            if (quotes[i].amountOut > 0) {
                if (quotes[i].poolType == PoolType.V2) {
                    sources[idx++] = "XLP_V2";
                } else if (quotes[i].poolType == PoolType.V3) {
                    sources[idx++] = "XLP_V3";
                } else {
                    sources[idx++] = "XLP_PAYMASTER";
                }
            }
        }
        
        // Gas estimate: ~100k for V2, ~150k for V3, ~200k for Paymaster
        gasEstimate = 150000;
        
        return (bestAmount, sources, gasEstimate);
    }

    /// @notice Get all available pools for a token pair
    /// @dev Used by aggregators to discover routing options
    /// @param tokenA First token
    /// @param tokenB Second token
    /// @return pools Array of pool addresses
    /// @return poolTypes Array of pool types
    /// @return fees Array of pool fees (in basis points)
    function getPools(
        address tokenA,
        address tokenB
    ) external view returns (
        address[] memory pools,
        uint8[] memory poolTypes,
        uint24[] memory fees
    ) {
        LiquidityInfo[] memory infos = this.getLiquidityInfo(tokenA, tokenB);
        
        pools = new address[](infos.length);
        poolTypes = new uint8[](infos.length);
        fees = new uint24[](infos.length);
        
        for (uint256 i = 0; i < infos.length; i++) {
            pools[i] = infos[i].pool;
            poolTypes[i] = uint8(infos[i].poolType);
            fees[i] = infos[i].fee;
        }
    }

    /// @notice Check if a specific swap is supported
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @return supported Whether the swap is supported
    /// @return bestPool Best pool for the swap
    function isSwapSupported(
        address tokenIn,
        address tokenOut
    ) external view returns (bool supported, address bestPool) {
        Quote memory supportQuote = this.getBestQuote(tokenIn, tokenOut, 1e18);
        return (supportQuote.pool != address(0), supportQuote.pool);
    }

    /// @notice Get protocol metadata for aggregator registration
    /// @return name Protocol name
    /// @return protocolVersion Version string
    /// @return chainId Current chain ID
    /// @return supportedFeatures Bitmap of supported features
    function getProtocolInfo() external view returns (
        string memory name,
        string memory protocolVersion,
        uint256 chainId,
        uint256 supportedFeatures
    ) {
        return (
            "Jeju XLP Aggregator",
            "2.0.0",
            block.chainid,
            // Features: 1=V2, 2=V3, 4=Paymaster, 8=CrossChain
            (v2Factory != address(0) ? 1 : 0) |
            (v3Factory != address(0) ? 2 : 0) |
            (paymaster != address(0) ? 12 : 0) // 4+8 for paymaster+crosschain
        );
    }
}
