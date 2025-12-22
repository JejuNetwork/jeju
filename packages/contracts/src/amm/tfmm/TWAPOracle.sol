// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "../libraries/TickMath.sol";

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
 *      Uses shared TickMath library for tick-to-price conversion
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

    mapping(address => PoolConfig[]) public poolConfigs;
    mapping(address => uint256) public primaryPoolIndex;
    mapping(address => address) public quoteOracles;

    uint8 public constant OUTPUT_DECIMALS = 8;
    uint256 public minLiquidity = 1000e18;

    // ============ Events ============

    event PoolRegistered(address indexed baseToken, address indexed pool, address quoteToken, uint32 twapPeriod);
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

    function setPrimaryPool(address baseToken, uint256 index) external onlyOwner {
        if (index >= poolConfigs[baseToken].length) revert NoPoolConfigured(baseToken);
        primaryPoolIndex[baseToken] = index;
        emit PrimaryPoolUpdated(baseToken, index);
    }

    function setQuoteOracle(address quoteToken, address oracle) external onlyOwner {
        quoteOracles[quoteToken] = oracle;
    }

    function deactivatePool(address baseToken, uint256 index) external onlyOwner {
        poolConfigs[baseToken][index].active = false;
        emit PoolDeactivated(baseToken, index);
    }

    // ============ Price Functions ============

    function getPrice(address baseToken) external view returns (uint256 price) {
        PriceData memory data = getPriceData(baseToken);
        return data.price;
    }

    function getPriceData(address baseToken) public view returns (PriceData memory) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) revert NoPoolConfigured(baseToken);

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        if (!config.active) revert PoolInactive(baseToken, primaryIdx);

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);

        (int24 currentTick, int24 twapTick) = _getTicks(pool, config.twapPeriod);

        // Use shared TickMath library for tick-to-price conversion
        uint256 rawPrice = _tickToPrice(twapTick, config.isToken0Base);

        uint256 adjustedPrice = _adjustDecimals(
            rawPrice,
            config.baseDecimals,
            config.quoteDecimals,
            config.isToken0Base
        );

        uint256 usdPrice = _convertToUSD(adjustedPrice, config.quoteToken);

        return PriceData({
            price: usdPrice,
            currentTick: currentTick,
            twapTick: twapTick,
            timestamp: block.timestamp
        });
    }

    function getTWAPTick(address pool, uint32 period) external view returns (int24) {
        (, int24 twapTick) = _getTicks(IUniswapV3Pool(pool), period);
        return twapTick;
    }

    function getPriceDeviation(address baseToken) external view returns (uint256 deviation) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) revert NoPoolConfigured(baseToken);

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);
        (int24 currentTick, int24 twapTick) = _getTicks(pool, config.twapPeriod);

        int256 tickDiff = int256(currentTick) - int256(twapTick);
        if (tickDiff < 0) tickDiff = -tickDiff;

        deviation = uint256(tickDiff);
    }

    function isValidTWAP(address baseToken) external view returns (bool) {
        PoolConfig[] storage configs = poolConfigs[baseToken];
        if (configs.length == 0) return false;

        uint256 primaryIdx = primaryPoolIndex[baseToken];
        PoolConfig storage config = configs[primaryIdx];

        if (!config.active) return false;

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);
        (, , , uint16 observationCardinality, , , ) = pool.slot0();

        uint16 requiredObservations = uint16(config.twapPeriod / 12) + 1;
        return observationCardinality >= requiredObservations;
    }

    // ============ Internal Functions ============

    function _getTicks(IUniswapV3Pool pool, uint32 period) internal view returns (int24 current, int24 twap) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = period;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);

        int56 tickDiff = tickCumulatives[1] - tickCumulatives[0];
        twap = int24(tickDiff / int56(int32(period)));

        (, current, , , , , ) = pool.slot0();
    }

    /// @notice Convert tick to price using shared TickMath library
    function _tickToPrice(int24 tick, bool isToken0Base) internal pure returns (uint256) {
        // Use shared TickMath library instead of duplicating the binary exponentiation
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);

        // Convert sqrtPriceX96 to price with 18 decimals
        // sqrtPriceX96 = sqrt(price) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192

        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        // Convert to 18 decimal price
        uint256 price = (priceX192 * 1e18) >> 192;

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
        int256 decimalDiff = int256(uint256(quoteDecimals)) - int256(uint256(baseDecimals));

        if (isToken0Base) {
            if (decimalDiff > 0) {
                price = price * (10 ** uint256(decimalDiff));
            } else if (decimalDiff < 0) {
                price = price / (10 ** uint256(-decimalDiff));
            }
        } else {
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
        if (_isStablecoin(quoteToken)) {
            return price;
        }

        address quoteOracle = quoteOracles[quoteToken];
        if (quoteOracle == address(0)) {
            return price;
        }

        (bool success, bytes memory data) = quoteOracle.staticcall(
            abi.encodeWithSignature("getPrice(address)", quoteToken)
        );

        if (!success || data.length == 0) {
            revert InvalidPrice();
        }

        uint256 quotePrice = abi.decode(data, (uint256));
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

    function getPoolConfigs(address baseToken) external view returns (PoolConfig[] memory) {
        return poolConfigs[baseToken];
    }

    function getPoolCount(address baseToken) external view returns (uint256) {
        return poolConfigs[baseToken].length;
    }
}
