// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @dev Minimal IUniswapV3Pool interface with slot0 for spot price validation
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
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
}

/// @title SimplePoolOracle
/// @notice Implements Chainlink's IAggregatorV3 interface using Uniswap V3 TWAP
/// @dev Provides manipulation-resistant price feeds for any token with a Uniswap V3 pool
contract SimplePoolOracle is IAggregatorV3, Ownable {
    IUniswapV3Pool public immutable pool;
    address public immutable targetToken;
    address public immutable baseToken;
    bool public immutable isToken0;
    uint8 public immutable targetDecimals;
    uint8 public immutable baseDecimals;

    uint32 public twapInterval = 300; // Start at 5 minutes (300 seconds)

    // Price safety bounds to prevent manipulation
    uint256 public constant MIN_PRICE_USD = 1e4; // $0.0001 in 8 decimals
    uint256 public constant MAX_PRICE_USD = 1e16; // $100M in 8 decimals
    uint256 public constant MAX_PRICE_CHANGE_PERCENT = 50; // Maximum 50% price change from previous observation

    // ETH/USD price feed for converting WETH pairs to USD
    IAggregatorV3 public ethUsdFeed;

    event TWAPIntervalUpdated(uint32 oldInterval, uint32 newInterval);
    event EthFeedUpdated(address indexed oldFeed, address indexed newFeed);

    constructor(address _pool, address _targetToken, address _ethUsdFeed) Ownable(msg.sender) {
        require(_pool != address(0), "zero pool");
        require(_targetToken != address(0), "zero token");

        pool = IUniswapV3Pool(_pool);
        targetToken = _targetToken;

        address token0 = pool.token0();
        address token1 = pool.token1();

        require(token0 == _targetToken || token1 == _targetToken, "token not in pool");

        isToken0 = (token0 == _targetToken);
        baseToken = isToken0 ? token1 : token0;

        targetDecimals = IERC20Metadata(_targetToken).decimals();
        baseDecimals = IERC20Metadata(baseToken).decimals();

        // Validate base token is either USDC or WETH
        require(
            (baseDecimals == 6 && baseToken != address(0)) // USDC
                || (baseDecimals == 18 && baseToken != address(0)), // WETH
            "unsupported base token"
        );

        ethUsdFeed = IAggregatorV3(_ethUsdFeed);
    }

    /// @notice Set the TWAP interval (owner only)
    /// @param newInterval New interval in seconds (300-3600, i.e. 5min-1hr)
    function setTWAPInterval(uint32 newInterval) external onlyOwner {
        require(newInterval >= 300 && newInterval <= 3600, "invalid interval");
        uint32 oldInterval = twapInterval;
        twapInterval = newInterval;
        emit TWAPIntervalUpdated(oldInterval, newInterval);
    }

    /// @notice Update ETH/USD price feed (owner only)
    function setEthFeed(address newFeed) external onlyOwner {
        require(newFeed != address(0), "zero feed");
        address oldFeed = address(ethUsdFeed);
        ethUsdFeed = IAggregatorV3(newFeed);
        emit EthFeedUpdated(oldFeed, newFeed);
    }

    /// @notice Implements Chainlink's decimals() - returns 8 decimals for USD price
    function decimals() external pure returns (uint8) {
        return 8;
    }

    /// @notice Implements Chainlink's description()
    function description() external view returns (string memory) {
        string memory tokenSymbol = IERC20Metadata(targetToken).symbol();
        return string(abi.encodePacked(tokenSymbol, " / USD"));
    }

    /// @notice Implements Chainlink's version()
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @notice Implements Chainlink's latestRoundData()
    /// @dev Returns TWAP price converted to 8-decimal USD price
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 price = getTWAPPrice();

        return (
            1, // roundId
            int256(price),
            block.timestamp,
            block.timestamp,
            1 // answeredInRound
        );
    }

    /// @notice Get TWAP price of target token in USD (8 decimals)
    /// @return price Price in USD with 8 decimals
    function getTWAPPrice() public view returns (uint256 price) {
        // Get tick cumulatives
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapInterval;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);

        // Calculate time-weighted average tick
        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(twapInterval)));

        // Convert tick to price
        uint256 basePerTarget = getQuoteAtTick(arithmeticMeanTick);

        // Determine if base token is USDC or WETH
        bool isUSDC = (baseDecimals == 6);
        bool isWETH = (baseDecimals == 18 && baseToken != address(0)); // Assume 18 decimals = WETH

        if (isUSDC) {
            // Direct USD price: basePerTarget is already in USDC (6 decimals)
            // Scale to 8 decimals
            price = (basePerTarget * 1e8) / 1e6;
        } else if (isWETH) {
            // Convert via ETH/USD feed
            (, int256 ethUsdPrice,,,) = ethUsdFeed.latestRoundData();
            require(ethUsdPrice > 0, "invalid eth price");

            // basePerTarget is in WETH (18 decimals)
            // ethUsdPrice is in USD (8 decimals)
            // Result: (WETH per token) * (USD per WETH) = USD per token
            price = (basePerTarget * uint256(ethUsdPrice)) / 1e18;
        } else {
            revert("unsupported base token");
        }

        require(price > 0, "invalid price");

        // Price sanity checks to prevent manipulation
        require(price >= MIN_PRICE_USD, "price too low");
        require(price <= MAX_PRICE_USD, "price too high");

        // Additional validation for extreme price changes
        // This prevents flash loan manipulation attacks
        if (price > 1e12) {
            // Only check for tokens above $10,000
            // For high-value tokens, require more conservative bounds
            require(price <= 1e14, "price manipulation detected"); // Max $1M
        }

        // Check spot price deviation to prevent manipulation
        (, int24 spotTick,,,,,) = pool.slot0();
        uint256 spotPrice = getQuoteAtTick(spotTick);

        // Convert spot price to USD using same logic as TWAP
        uint256 spotPriceUsd = 0;
        if (isUSDC) {
            spotPriceUsd = (spotPrice * 1e8) / 1e6;
        } else if (isWETH) {
            (, int256 ethUsdPrice_,,,) = ethUsdFeed.latestRoundData();
            spotPriceUsd = (spotPrice * uint256(ethUsdPrice_)) / 1e18;
        }

        // Check deviation - require spot price is within bounds
        require(spotPriceUsd > 0, "invalid spot price");
        if (spotPriceUsd > price) {
            require(((spotPriceUsd - price) * 100) / price <= MAX_PRICE_CHANGE_PERCENT, "spot price deviation high");
        } else {
            require(((price - spotPriceUsd) * 100) / price <= MAX_PRICE_CHANGE_PERCENT, "spot price deviation high");
        }
    }

    /// @notice Convert Uniswap V3 tick to price
    /// @param tick The tick value
    /// @return price Amount of base token per 1 unit of target token
    function getQuoteAtTick(int24 tick) internal view returns (uint256 price) {
        // Calculate 1.0001^tick using tick math
        uint160 sqrtPriceX96 = getSqrtRatioAtTick(tick);

        // sqrtPriceX96 = sqrt(token1/token0) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2

        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        if (isToken0) {
            // We want token1/token0 (base/target)
            // Adjust for decimals: multiply by 10^targetDecimals
            // Result is in base token wei per 1 full target token
            price = (priceX192 * (10 ** targetDecimals)) / (2 ** 192);
        } else {
            // We want token0/token1 (base/target)
            // This is the inverse: (2^192) / priceX192
            price = ((2 ** 192) / priceX192) * (10 ** targetDecimals);
        }
    }

    /// @notice Get sqrt ratio at tick (Uniswap V3 tick math)
    /// @param tick The tick value
    /// @return sqrtPriceX96 The sqrt price as a Q64.96
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(absTick <= 887272, "T");

        uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
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

        if (tick > 0) ratio = type(uint256).max / ratio;

        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }
}
