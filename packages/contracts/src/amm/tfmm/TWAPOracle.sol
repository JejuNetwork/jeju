// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IUniswapV3Pool
 * @notice Minimal interface for Uniswap V3 pools
 */
interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * @title TWAPOracle
 * @author Jeju Network
 * @notice On-chain TWAP oracle using Uniswap V3 pools
 * @dev Provides manipulation-resistant price feeds as a fallback oracle source
 *
 * Features:
 * - Configurable TWAP periods (e.g., 15 min, 1 hour)
 * - Multiple pool support per token pair
 * - Quote token normalization (e.g., USDC, WETH)
 * - Volatility detection
 */
contract TWAPOracle is Ownable {

    // ============ Structs ============

    struct PoolConfig {
        address pool;           // Uniswap V3 pool address
        address quoteToken;     // Quote token (e.g., USDC, WETH)
        uint8 baseDecimals;     // Decimals of base token
        uint8 quoteDecimals;    // Decimals of quote token
        uint32 twapPeriod;      // TWAP period in seconds
        bool isToken0Base;      // True if base token is token0
        bool active;
    }

    struct PriceData {
        uint256 price;          // Price in 8 decimals
        int24 currentTick;      // Current tick
        int24 twapTick;         // TWAP tick
        uint256 timestamp;      // Block timestamp
    }

    // ============ State Variables ============

    /// @notice Pool configurations by base token
    mapping(address => PoolConfig[]) public poolConfigs;

    /// @notice Primary pool index for each base token
    mapping(address => uint256) public primaryPoolIndex;

    /// @notice Quote token price oracles (for cross-pair pricing)
    mapping(address => address) public quoteOracles;

    /// @notice Target decimals for output
    uint8 public constant OUTPUT_DECIMALS = 8;

    /// @notice Minimum liquidity threshold for valid prices
    uint256 public minLiquidity = 1000e18; // $1000 minimum

    // ============ Events ============

    event PoolRegistered(
        address indexed baseToken,
        address indexed pool,
        address quoteToken,
        uint32 twapPeriod
    );
    event PoolDeactivated(address indexed baseToken, uint256 index);
    event PrimaryPoolUpdated(address indexed baseToken, uint256 index);

    // ============ Errors ============

    error NoPoolConfigured(address token);
    error PoolInactive(address token, uint256 index);
    error InvalidTWAPPeriod(uint32 period);
    error InsufficientLiquidity(address pool);
    error InvalidPrice();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Pool Management ============

    /**
     * @notice Register a Uniswap V3 pool for TWAP pricing
     * @param baseToken The token to get the price for
     * @param pool The Uniswap V3 pool address
     * @param quoteToken The quote token (e.g., USDC)
     * @param twapPeriod TWAP period in seconds
     */
    function registerPool(
        address baseToken,
        address pool,
        address quoteToken,
        uint32 twapPeriod,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) external onlyOwner {
        if (twapPeriod < 60 || twapPeriod > 86400) revert InvalidTWAPPeriod(twapPeriod);

        IUniswapV3Pool uniPool = IUniswapV3Pool(pool);
        bool isToken0Base = uniPool.token0() == baseToken;

        PoolConfig memory config = PoolConfig({
            pool: pool,
            quoteToken: quoteToken,
            baseDecimals: baseDecimals,
            quoteDecimals: quoteDecimals,
            twapPeriod: twapPeriod,
            isToken0Base: isToken0Base,
            active: true
        });

        poolConfigs[baseToken].push(config);

        emit PoolRegistered(baseToken, pool, quoteToken, twapPeriod);
    }

    /**
     * @notice Set the primary pool for a token
     */
    function setPrimaryPool(address baseToken, uint256 index) external onlyOwner {
        if (index >= poolConfigs[baseToken].length) revert NoPoolConfigured(baseToken);
        primaryPoolIndex[baseToken] = index;
        emit PrimaryPoolUpdated(baseToken, index);
    }

    /**
     * @notice Set quote token oracle for cross-pair pricing
     */
    function setQuoteOracle(address quoteToken, address oracle) external onlyOwner {
        quoteOracles[quoteToken] = oracle;
    }

    /**
     * @notice Deactivate a pool
     */
    function deactivatePool(address baseToken, uint256 index) external onlyOwner {
        poolConfigs[baseToken][index].active = false;
        emit PoolDeactivated(baseToken, index);
    }

    // ============ Price Functions ============

    /**
     * @notice Get TWAP price for a token in USD (8 decimals)
     * @param baseToken The token to price
     * @return price Price in 8 decimals (e.g., $3000 = 300000000000)
     */
    function getPrice(address baseToken) external view returns (uint256 price) {
        PriceData memory data = getPriceData(baseToken);
        return data.price;
    }

    /**
     * @notice Get full TWAP price data
     */
    function getPriceData(address baseToken) public view returns (PriceData memory) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) revert NoPoolConfigured(baseToken);

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        if (!config.active) revert PoolInactive(baseToken, primaryIdx);

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);

        // Get current and TWAP ticks
        (int24 currentTick, int24 twapTick) = _getTicks(pool, config.twapPeriod);

        // Convert TWAP tick to price
        uint256 rawPrice = _tickToPrice(twapTick, config.isToken0Base);

        // Adjust for token decimals
        uint256 adjustedPrice = _adjustDecimals(
            rawPrice,
            config.baseDecimals,
            config.quoteDecimals,
            config.isToken0Base
        );

        // If quote token is not USD, convert via quote oracle
        uint256 usdPrice = _convertToUSD(adjustedPrice, config.quoteToken);

        return PriceData({
            price: usdPrice,
            currentTick: currentTick,
            twapTick: twapTick,
            timestamp: block.timestamp
        });
    }

    /**
     * @notice Get TWAP tick for a pool
     */
    function getTWAPTick(address pool, uint32 period) external view returns (int24) {
        (, int24 twapTick) = _getTicks(IUniswapV3Pool(pool), period);
        return twapTick;
    }

    /**
     * @notice Check if current price deviates significantly from TWAP
     * @return deviation Deviation in basis points
     */
    function getPriceDeviation(address baseToken) external view returns (uint256 deviation) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) revert NoPoolConfigured(baseToken);

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);
        (int24 currentTick, int24 twapTick) = _getTicks(pool, config.twapPeriod);

        // Calculate tick deviation
        int256 tickDiff = int256(currentTick) - int256(twapTick);
        if (tickDiff < 0) tickDiff = -tickDiff;

        // Each tick is ~0.01% (1 bps)
        deviation = uint256(tickDiff);
    }

    /**
     * @notice Check if the TWAP is valid (sufficient observations)
     */
    function isValidTWAP(address baseToken) external view returns (bool) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) return false;

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        if (!config.active) return false;

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);
        
        // Check observation cardinality
        (, , , uint16 observationCardinality, , , ) = pool.slot0();
        
        // Need at least enough observations for the TWAP period
        // Assume ~12 second blocks, need observations for the full period
        uint16 requiredObservations = uint16(config.twapPeriod / 12) + 1;
        
        return observationCardinality >= requiredObservations;
    }

    // ============ Internal Functions ============

    function _getTicks(IUniswapV3Pool pool, uint32 period) internal view returns (int24 current, int24 twap) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = period;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);

        // TWAP tick
        int56 tickDiff = tickCumulatives[1] - tickCumulatives[0];
        twap = int24(tickDiff / int56(int32(period)));

        // Current tick from slot0
        (, current, , , , , ) = pool.slot0();
    }

    function _tickToPrice(int24 tick, bool isToken0Base) internal pure returns (uint256) {
        // price = 1.0001^tick
        // For precision, we use fixed point math
        
        uint256 absTick = tick >= 0 ? uint256(int256(tick)) : uint256(-int256(tick));
        
        // Calculate 1.0001^|tick| using binary exponentiation
        // We use Q128.128 fixed point
        uint256 ratio = absTick & 0x1 != 0 
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        // Invert if tick is positive
        if (tick > 0) {
            ratio = type(uint256).max / ratio;
        }

        // Convert from Q128.128 to regular price with 18 decimals
        uint256 price = (ratio >> 32) * 1e18 >> 96;

        // If token0 is base, price is correct; otherwise invert
        if (!isToken0Base && price > 0) {
            price = 1e36 / price;
        }

        return price;
    }

    function _adjustDecimals(
        uint256 price,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        bool isToken0Base
    ) internal pure returns (uint256) {
        // Price is in 18 decimals, representing quote/base
        // Need to adjust for token decimal differences

        int256 decimalDiff = int256(uint256(quoteDecimals)) - int256(uint256(baseDecimals));

        if (isToken0Base) {
            // price = token1/token0, so adjust for quote decimals
            if (decimalDiff > 0) {
                price = price * (10 ** uint256(decimalDiff));
            } else if (decimalDiff < 0) {
                price = price / (10 ** uint256(-decimalDiff));
            }
        } else {
            // price = token0/token1 (inverted), opposite adjustment
            if (decimalDiff > 0) {
                price = price / (10 ** uint256(decimalDiff));
            } else if (decimalDiff < 0) {
                price = price * (10 ** uint256(-decimalDiff));
            }
        }

        // Convert from 18 decimals to OUTPUT_DECIMALS (8)
        return price / 1e10;
    }

    function _convertToUSD(uint256 price, address quoteToken) internal view returns (uint256) {
        // Common stablecoin addresses (we assume they're $1)
        // USDC, USDT, DAI on various chains
        
        // Check for stablecoin quote (returns price as-is)
        if (_isStablecoin(quoteToken)) {
            return price;
        }

        // Get quote token price from oracle
        address quoteOracle = quoteOracles[quoteToken];
        if (quoteOracle == address(0)) {
            // No oracle configured, assume 1:1 (for testing)
            return price;
        }

        // Fetch quote price (assumes oracle returns 8 decimals)
        (bool success, bytes memory data) = quoteOracle.staticcall(
            abi.encodeWithSignature("getPrice(address)", quoteToken)
        );

        if (!success || data.length == 0) {
            revert InvalidPrice();
        }

        uint256 quotePrice = abi.decode(data, (uint256));

        // price (8 decimals) * quotePrice (8 decimals) / 1e8 = final price (8 decimals)
        return (price * quotePrice) / 1e8;
    }

    function _isStablecoin(address token) internal pure returns (bool) {
        // Mainnet stablecoins
        if (token == 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) return true; // USDC
        if (token == 0xdAC17F958D2ee523a2206206994597C13D831ec7) return true; // USDT
        if (token == 0x6B175474E89094C44Da98b954EedeAC495271d0F) return true; // DAI

        // Base stablecoins
        if (token == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) return true; // USDC
        if (token == 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb) return true; // DAI

        // Arbitrum stablecoins
        if (token == 0xaf88d065e77c8cC2239327C5EDb3A432268e5831) return true; // USDC
        if (token == 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9) return true; // USDT

        // Optimism stablecoins
        if (token == 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85) return true; // USDC
        if (token == 0x94b008aA00579c1307B0EF2c499aD98a8ce58e58) return true; // USDT

        // BSC stablecoins
        if (token == 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d) return true; // USDC
        if (token == 0x55d398326f99059fF775485246999027B3197955) return true; // USDT

        return false;
    }

    // ============ View Functions ============

    /**
     * @notice Get all pool configs for a token
     */
    function getPoolConfigs(address baseToken) external view returns (PoolConfig[] memory) {
        return poolConfigs[baseToken];
    }

    /**
     * @notice Get number of pools for a token
     */
    function getPoolCount(address baseToken) external view returns (uint256) {
        return poolConfigs[baseToken].length;
    }
}

