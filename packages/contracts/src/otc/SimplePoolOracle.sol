// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {TickMath} from "../amm/libraries/TickMath.sol";
import {OracleLib} from "../libraries/OracleLib.sol";

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
/// @author Jeju Network
/// @notice Implements Chainlink's IAggregatorV3 interface using Uniswap V3 TWAP
/// @dev Provides manipulation-resistant price feeds for any token with a Uniswap V3 pool
///      Uses shared TickMath library for tick-to-price conversion
contract SimplePoolOracle is IAggregatorV3, Ownable {
    IUniswapV3Pool public immutable pool;
    address public immutable targetToken;
    address public immutable baseToken;
    bool public immutable isToken0;
    uint8 public immutable targetDecimals;
    uint8 public immutable baseDecimals;

    uint32 public twapInterval = 300; // 5 minutes

    uint256 public constant MIN_PRICE_USD = 1e4; // $0.0001 in 8 decimals
    uint256 public constant MAX_PRICE_USD = 1e16; // $100M in 8 decimals
    uint256 public constant MAX_PRICE_CHANGE_PERCENT = 50;
    uint256 public constant MAX_FEED_STALENESS = 1 hours;

    IAggregatorV3 public ethUsdFeed;

    event TWAPIntervalUpdated(uint32 oldInterval, uint32 newInterval);
    event EthFeedUpdated(address indexed oldFeed, address indexed newFeed);

    error InvalidPool();
    error InvalidToken();
    error TokenNotInPool();
    error UnsupportedBaseToken();
    error InvalidPrice();
    error PriceTooLow();
    error PriceTooHigh();
    error PriceManipulationDetected();
    error SpotPriceDeviationHigh();
    error InvalidInterval();
    error ZeroAddress();

    constructor(address _pool, address _targetToken, address _ethUsdFeed) Ownable(msg.sender) {
        if (_pool == address(0)) revert InvalidPool();
        if (_targetToken == address(0)) revert InvalidToken();

        pool = IUniswapV3Pool(_pool);
        targetToken = _targetToken;

        address token0 = pool.token0();
        address token1 = pool.token1();

        if (token0 != _targetToken && token1 != _targetToken) revert TokenNotInPool();

        isToken0 = (token0 == _targetToken);
        baseToken = isToken0 ? token1 : token0;

        targetDecimals = IERC20Metadata(_targetToken).decimals();
        baseDecimals = IERC20Metadata(baseToken).decimals();

        // Validate base token is either USDC (6) or WETH (18)
        if (!((baseDecimals == 6) || (baseDecimals == 18))) revert UnsupportedBaseToken();

        ethUsdFeed = IAggregatorV3(_ethUsdFeed);
    }

    function setTWAPInterval(uint32 newInterval) external onlyOwner {
        if (newInterval < 300 || newInterval > 3600) revert InvalidInterval();
        uint32 oldInterval = twapInterval;
        twapInterval = newInterval;
        emit TWAPIntervalUpdated(oldInterval, newInterval);
    }

    function setEthFeed(address newFeed) external onlyOwner {
        if (newFeed == address(0)) revert ZeroAddress();
        address oldFeed = address(ethUsdFeed);
        ethUsdFeed = IAggregatorV3(newFeed);
        emit EthFeedUpdated(oldFeed, newFeed);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external view returns (string memory) {
        string memory tokenSymbol = IERC20Metadata(targetToken).symbol();
        return string(abi.encodePacked(tokenSymbol, " / USD"));
    }

    function version() external pure returns (uint256) {
        return 2;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 price = getTWAPPrice();
        return (1, int256(price), block.timestamp, block.timestamp, 1);
    }

    function getTWAPPrice() public view returns (uint256 price) {
        // Get tick cumulatives for TWAP calculation
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapInterval;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);

        // Calculate time-weighted average tick
        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(twapInterval)));

        // Convert tick to price using shared TickMath library
        uint256 basePerTarget = _getQuoteAtTick(arithmeticMeanTick);

        // Convert to USD based on base token type
        bool isUSDC = (baseDecimals == 6);
        bool isWETH = (baseDecimals == 18);

        if (isUSDC) {
            price = (basePerTarget * 1e8) / 1e6;
        } else if (isWETH) {
            // Use OracleLib for validated ETH price reading
            OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
                feed: address(ethUsdFeed),
                maxStaleness: MAX_FEED_STALENESS,
                expectedDecimals: 8
            });
            (uint256 ethUsdPrice,) = OracleLib.readChainlinkPriceStrict(config);
            price = (basePerTarget * ethUsdPrice) / 1e18;
        }

        if (price == 0) revert InvalidPrice();
        if (price < MIN_PRICE_USD) revert PriceTooLow();
        if (price > MAX_PRICE_USD) revert PriceTooHigh();

        // High-value token additional check
        if (price > 1e12 && price > 1e14) revert PriceManipulationDetected();

        // Validate spot price deviation
        _validateSpotDeviation(price, isUSDC, isWETH);
    }

    function _validateSpotDeviation(uint256 twapPrice, bool isUSDC, bool isWETH) internal view {
        (, int24 spotTick,,,,,) = pool.slot0();
        uint256 spotPrice = _getQuoteAtTick(spotTick);

        uint256 spotPriceUsd;
        if (isUSDC) {
            spotPriceUsd = (spotPrice * 1e8) / 1e6;
        } else if (isWETH) {
            (, int256 ethUsdPrice_,,,) = ethUsdFeed.latestRoundData();
            spotPriceUsd = (spotPrice * uint256(ethUsdPrice_)) / 1e18;
        }

        if (spotPriceUsd == 0) revert InvalidPrice();

        uint256 deviationBps = OracleLib.calculateDeviationBps(spotPriceUsd, twapPrice);
        if (deviationBps > MAX_PRICE_CHANGE_PERCENT * 100) revert SpotPriceDeviationHigh();
    }

    /// @notice Convert tick to price using shared TickMath library
    function _getQuoteAtTick(int24 tick) internal view returns (uint256 price) {
        // Use shared TickMath library instead of duplicating the math
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);

        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        if (isToken0) {
            price = (priceX192 * (10 ** targetDecimals)) / (2 ** 192);
        } else {
            price = ((2 ** 192) / priceX192) * (10 ** targetDecimals);
        }
    }
}
