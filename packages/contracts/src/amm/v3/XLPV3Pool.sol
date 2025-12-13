// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IXLPV3Pool.sol";
import "../libraries/TickMath.sol";
import "../libraries/SqrtPriceMath.sol";
import "../libraries/SwapMath.sol";
import "../libraries/TickBitmap.sol";
import "../libraries/Tick.sol";
import "../libraries/Position.sol";
import "../libraries/LiquidityMath.sol";
import "../libraries/FullMath.sol";

/// @title XLP V3 Pool
/// @author Jeju Network
/// @notice Uniswap V3 compatible concentrated liquidity AMM pool
/// @dev Implements tick-based concentrated liquidity with customizable fee tiers
contract XLPV3Pool is IXLPV3Pool {
    using SafeERC20 for IERC20;
    using Tick for mapping(int24 => Tick.Info);
    using TickBitmap for mapping(int16 => uint256);
    using Position for mapping(bytes32 => Position.Info);
    using Position for Position.Info;

    // ============ Immutables ============

    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;
    uint24 public immutable override fee;
    int24 public immutable override tickSpacing;
    uint128 public immutable override maxLiquidityPerTick;

    // ============ State ============

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 observationIndex;
        uint16 observationCardinality;
        uint16 observationCardinalityNext;
        uint8 feeProtocol;
        bool unlocked;
    }

    Slot0 public override slot0;

    uint256 public override feeGrowthGlobal0X128;
    uint256 public override feeGrowthGlobal1X128;

    struct ProtocolFees {
        uint128 token0;
        uint128 token1;
    }

    ProtocolFees public override protocolFees;

    uint128 public override liquidity;

    mapping(int24 => Tick.Info) public override ticks;
    mapping(int16 => uint256) public override tickBitmap;
    mapping(bytes32 => Position.Info) public override positions;

    struct Observation {
        uint32 blockTimestamp;
        int56 tickCumulative;
        uint160 secondsPerLiquidityCumulativeX128;
        bool initialized;
    }

    Observation[65535] public override observations;

    // ============ Errors ============

    error Locked();
    error AlreadyInitialized();
    error InvalidTickRange();
    error InvalidTick();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error PriceLimitReached();
    error NotAuthorized();
    error ZeroLiquidity();

    // ============ Modifiers ============

    modifier lock() {
        if (!slot0.unlocked) revert Locked();
        slot0.unlocked = false;
        _;
        slot0.unlocked = true;
    }

    // ============ Constructor ============

    constructor() {
        int24 _tickSpacing;
        (factory, token0, token1, fee, _tickSpacing) = IXLPV3PoolDeployer(msg.sender).parameters();
        tickSpacing = _tickSpacing;
        maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(_tickSpacing);
    }

    // ============ Initialize ============

    /// @inheritdoc IXLPV3Pool
    function initialize(uint160 sqrtPriceX96) external override {
        if (slot0.sqrtPriceX96 != 0) revert AlreadyInitialized();

        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

        observations[0] = Observation({
            blockTimestamp: uint32(block.timestamp),
            tickCumulative: 0,
            secondsPerLiquidityCumulativeX128: 0,
            initialized: true
        });

        slot0 = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            observationIndex: 0,
            observationCardinality: 1,
            observationCardinalityNext: 1,
            feeProtocol: 0,
            unlocked: true
        });

        emit Initialize(sqrtPriceX96, tick);
    }

    // ============ Mint ============

    /// @inheritdoc IXLPV3Pool
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        override
        lock
        returns (uint256 amount0, uint256 amount1)
    {
        if (amount == 0) revert ZeroLiquidity();

        (, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            ModifyPositionParams({
                owner: recipient,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int128(amount)
            })
        );

        amount0 = uint256(amount0Int);
        amount1 = uint256(amount1Int);

        uint256 balance0Before;
        uint256 balance1Before;
        if (amount0 > 0) balance0Before = _balance0();
        if (amount1 > 0) balance1Before = _balance1();

        IXLPV3MintCallback(msg.sender).xlpV3MintCallback(amount0, amount1, data);

        if (amount0 > 0 && _balance0() < balance0Before + amount0) revert InsufficientInputAmount();
        if (amount1 > 0 && _balance1() < balance1Before + amount1) revert InsufficientInputAmount();

        emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
    }

    // ============ Burn ============

    /// @inheritdoc IXLPV3Pool
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external
        override
        lock
        returns (uint256 amount0, uint256 amount1)
    {
        (Position.Info storage position, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            ModifyPositionParams({
                owner: msg.sender,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int128(amount)
            })
        );

        amount0 = uint256(-amount0Int);
        amount1 = uint256(-amount1Int);

        if (amount0 > 0 || amount1 > 0) {
            (position.tokensOwed0, position.tokensOwed1) =
                (position.tokensOwed0 + uint128(amount0), position.tokensOwed1 + uint128(amount1));
        }

        emit Burn(msg.sender, tickLower, tickUpper, amount, amount0, amount1);
    }

    // ============ Collect ============

    /// @inheritdoc IXLPV3Pool
    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external override lock returns (uint128 amount0, uint128 amount1) {
        Position.Info storage position = positions.get(msg.sender, tickLower, tickUpper);

        amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
        amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

        if (amount0 > 0) {
            position.tokensOwed0 -= amount0;
            IERC20(token0).safeTransfer(recipient, amount0);
        }
        if (amount1 > 0) {
            position.tokensOwed1 -= amount1;
            IERC20(token1).safeTransfer(recipient, amount1);
        }

        emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
    }

    // ============ Swap ============

    /// @inheritdoc IXLPV3Pool
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external override lock returns (int256 amount0, int256 amount1) {
        if (amountSpecified == 0) revert InsufficientInputAmount();

        Slot0 memory slot0Start = slot0;

        if (zeroForOne) {
            if (sqrtPriceLimitX96 >= slot0Start.sqrtPriceX96 || sqrtPriceLimitX96 <= TickMath.MIN_SQRT_RATIO) {
                revert PriceLimitReached();
            }
        } else {
            if (sqrtPriceLimitX96 <= slot0Start.sqrtPriceX96 || sqrtPriceLimitX96 >= TickMath.MAX_SQRT_RATIO) {
                revert PriceLimitReached();
            }
        }

        bool exactInput = amountSpecified > 0;

        SwapState memory state = SwapState({
            amountSpecifiedRemaining: amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: slot0Start.sqrtPriceX96,
            tick: slot0Start.tick,
            feeGrowthGlobalX128: zeroForOne ? feeGrowthGlobal0X128 : feeGrowthGlobal1X128,
            protocolFee: 0,
            liquidity: liquidity
        });

        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96) {
            StepComputations memory step;

            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) =
                tickBitmap.nextInitializedTickWithinOneWord(state.tick, tickSpacing, zeroForOne);

            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                state.sqrtPriceX96,
                (zeroForOne ? step.sqrtPriceNextX96 < sqrtPriceLimitX96 : step.sqrtPriceNextX96 > sqrtPriceLimitX96)
                    ? sqrtPriceLimitX96
                    : step.sqrtPriceNextX96,
                state.liquidity,
                state.amountSpecifiedRemaining,
                fee
            );

            if (exactInput) {
                unchecked {
                    state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                }
                state.amountCalculated -= step.amountOut.toInt256();
            } else {
                unchecked {
                    state.amountSpecifiedRemaining += step.amountOut.toInt256();
                }
                state.amountCalculated += (step.amountIn + step.feeAmount).toInt256();
            }

            // Protocol fee
            if (slot0Start.feeProtocol > 0) {
                unchecked {
                    uint256 delta = step.feeAmount / slot0Start.feeProtocol;
                    step.feeAmount -= delta;
                    state.protocolFee += uint128(delta);
                }
            }

            // Update global fee growth
            if (state.liquidity > 0) {
                unchecked {
                    state.feeGrowthGlobalX128 += FullMath.mulDiv(step.feeAmount, 1 << 128, state.liquidity);
                }
            }

            // Shift tick if we reached the next price
            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                if (step.initialized) {
                    int128 liquidityNet = ticks.cross(
                        step.tickNext,
                        zeroForOne ? state.feeGrowthGlobalX128 : feeGrowthGlobal0X128,
                        zeroForOne ? feeGrowthGlobal1X128 : state.feeGrowthGlobalX128,
                        0, // secondsPerLiquidityCumulativeX128 simplified
                        0, // tickCumulative simplified
                        uint32(block.timestamp)
                    );

                    if (zeroForOne) liquidityNet = -liquidityNet;

                    state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
                }

                unchecked {
                    state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
                }
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
            }
        }

        // Update state
        if (state.tick != slot0Start.tick) {
            slot0.sqrtPriceX96 = state.sqrtPriceX96;
            slot0.tick = state.tick;
        } else {
            slot0.sqrtPriceX96 = state.sqrtPriceX96;
        }

        if (liquidity != state.liquidity) liquidity = state.liquidity;

        if (zeroForOne) {
            feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees.token0 += state.protocolFee;
        } else {
            feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees.token1 += state.protocolFee;
        }

        (amount0, amount1) = zeroForOne == exactInput
            ? (amountSpecified - state.amountSpecifiedRemaining, state.amountCalculated)
            : (state.amountCalculated, amountSpecified - state.amountSpecifiedRemaining);

        // Transfer tokens
        if (zeroForOne) {
            if (amount1 < 0) IERC20(token1).safeTransfer(recipient, uint256(-amount1));

            uint256 balance0Before = _balance0();
            IXLPV3SwapCallback(msg.sender).xlpV3SwapCallback(amount0, amount1, data);
            if (_balance0() < balance0Before + uint256(amount0)) revert InsufficientInputAmount();
        } else {
            if (amount0 < 0) IERC20(token0).safeTransfer(recipient, uint256(-amount0));

            uint256 balance1Before = _balance1();
            IXLPV3SwapCallback(msg.sender).xlpV3SwapCallback(amount0, amount1, data);
            if (_balance1() < balance1Before + uint256(amount1)) revert InsufficientInputAmount();
        }

        emit Swap(msg.sender, recipient, amount0, amount1, state.sqrtPriceX96, state.liquidity, state.tick);
    }

    // ============ Flash ============

    /// @inheritdoc IXLPV3Pool
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external override lock {
        uint128 _liquidity = liquidity;
        if (_liquidity == 0) revert ZeroLiquidity();

        uint256 fee0 = FullMath.mulDivRoundingUp(amount0, fee, 1e6);
        uint256 fee1 = FullMath.mulDivRoundingUp(amount1, fee, 1e6);
        uint256 balance0Before = _balance0();
        uint256 balance1Before = _balance1();

        if (amount0 > 0) IERC20(token0).safeTransfer(recipient, amount0);
        if (amount1 > 0) IERC20(token1).safeTransfer(recipient, amount1);

        IXLPV3FlashCallback(msg.sender).xlpV3FlashCallback(fee0, fee1, data);

        uint256 balance0After = _balance0();
        uint256 balance1After = _balance1();

        if (balance0Before + fee0 > balance0After) revert InsufficientInputAmount();
        if (balance1Before + fee1 > balance1After) revert InsufficientInputAmount();

        uint256 paid0 = balance0After - balance0Before;
        uint256 paid1 = balance1After - balance1Before;

        if (paid0 > 0) {
            uint8 feeProtocol0 = slot0.feeProtocol % 16;
            uint256 fees0 = feeProtocol0 == 0 ? 0 : paid0 / feeProtocol0;
            if (fees0 > 0) protocolFees.token0 += uint128(fees0);
            feeGrowthGlobal0X128 += FullMath.mulDiv(paid0 - fees0, 1 << 128, _liquidity);
        }
        if (paid1 > 0) {
            uint8 feeProtocol1 = slot0.feeProtocol >> 4;
            uint256 fees1 = feeProtocol1 == 0 ? 0 : paid1 / feeProtocol1;
            if (fees1 > 0) protocolFees.token1 += uint128(fees1);
            feeGrowthGlobal1X128 += FullMath.mulDiv(paid1 - fees1, 1 << 128, _liquidity);
        }

        emit Flash(msg.sender, recipient, amount0, amount1, paid0, paid1);
    }

    // ============ Admin ============

    /// @inheritdoc IXLPV3Pool
    function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external override {
        if (msg.sender != IXLPV3Factory(factory).owner()) revert NotAuthorized();
        require(
            (feeProtocol0 == 0 || (feeProtocol0 >= 4 && feeProtocol0 <= 10))
                && (feeProtocol1 == 0 || (feeProtocol1 >= 4 && feeProtocol1 <= 10))
        );
        uint8 feeProtocolOld = slot0.feeProtocol;
        slot0.feeProtocol = feeProtocol0 + (feeProtocol1 << 4);
        emit SetFeeProtocol(feeProtocolOld % 16, feeProtocolOld >> 4, feeProtocol0, feeProtocol1);
    }

    /// @inheritdoc IXLPV3Pool
    function collectProtocol(address recipient, uint128 amount0Requested, uint128 amount1Requested)
        external
        override
        returns (uint128 amount0, uint128 amount1)
    {
        if (msg.sender != IXLPV3Factory(factory).owner()) revert NotAuthorized();

        amount0 = amount0Requested > protocolFees.token0 ? protocolFees.token0 : amount0Requested;
        amount1 = amount1Requested > protocolFees.token1 ? protocolFees.token1 : amount1Requested;

        if (amount0 > 0) {
            protocolFees.token0 -= amount0;
            IERC20(token0).safeTransfer(recipient, amount0);
        }
        if (amount1 > 0) {
            protocolFees.token1 -= amount1;
            IERC20(token1).safeTransfer(recipient, amount1);
        }

        emit CollectProtocol(msg.sender, recipient, amount0, amount1);
    }

    /// @inheritdoc IXLPV3Pool
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external override {
        uint16 observationCardinalityNextOld = slot0.observationCardinalityNext;
        if (observationCardinalityNext <= observationCardinalityNextOld) return;
        slot0.observationCardinalityNext = observationCardinalityNext;
        emit IncreaseObservationCardinalityNext(observationCardinalityNextOld, observationCardinalityNext);
    }

    // ============ Internal ============

    struct ModifyPositionParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    function _modifyPosition(ModifyPositionParams memory params)
        private
        returns (Position.Info storage position, int256 amount0, int256 amount1)
    {
        _checkTicks(params.tickLower, params.tickUpper);

        Slot0 memory _slot0 = slot0;

        position = _updatePosition(params.owner, params.tickLower, params.tickUpper, params.liquidityDelta, _slot0.tick);

        if (params.liquidityDelta != 0) {
            if (_slot0.tick < params.tickLower) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower),
                    TickMath.getSqrtRatioAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            } else if (_slot0.tick < params.tickUpper) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    _slot0.sqrtPriceX96, TickMath.getSqrtRatioAtTick(params.tickUpper), params.liquidityDelta
                );
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower), _slot0.sqrtPriceX96, params.liquidityDelta
                );

                liquidity = LiquidityMath.addDelta(liquidity, params.liquidityDelta);
            } else {
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower),
                    TickMath.getSqrtRatioAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            }
        }
    }

    function _updatePosition(address owner, int24 tickLower, int24 tickUpper, int128 liquidityDelta, int24 tick)
        private
        returns (Position.Info storage position)
    {
        position = positions.get(owner, tickLower, tickUpper);

        uint256 _feeGrowthGlobal0X128 = feeGrowthGlobal0X128;
        uint256 _feeGrowthGlobal1X128 = feeGrowthGlobal1X128;

        bool flippedLower;
        bool flippedUpper;
        if (liquidityDelta != 0) {
            flippedLower = ticks.update(
                tickLower,
                tick,
                liquidityDelta,
                _feeGrowthGlobal0X128,
                _feeGrowthGlobal1X128,
                0,
                0,
                uint32(block.timestamp),
                false,
                maxLiquidityPerTick
            );
            flippedUpper = ticks.update(
                tickUpper,
                tick,
                liquidityDelta,
                _feeGrowthGlobal0X128,
                _feeGrowthGlobal1X128,
                0,
                0,
                uint32(block.timestamp),
                true,
                maxLiquidityPerTick
            );

            if (flippedLower) {
                tickBitmap.flipTick(tickLower, tickSpacing);
            }
            if (flippedUpper) {
                tickBitmap.flipTick(tickUpper, tickSpacing);
            }
        }

        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) =
            ticks.getFeeGrowthInside(tickLower, tickUpper, tick, _feeGrowthGlobal0X128, _feeGrowthGlobal1X128);

        position.update(liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);

        if (liquidityDelta < 0) {
            if (flippedLower) {
                ticks.clear(tickLower);
            }
            if (flippedUpper) {
                ticks.clear(tickUpper);
            }
        }
    }

    function _checkTicks(int24 tickLower, int24 tickUpper) private pure {
        if (tickLower >= tickUpper) revert InvalidTickRange();
        if (tickLower < TickMath.MIN_TICK) revert InvalidTick();
        if (tickUpper > TickMath.MAX_TICK) revert InvalidTick();
    }

    function _balance0() private view returns (uint256) {
        return IERC20(token0).balanceOf(address(this));
    }

    function _balance1() private view returns (uint256) {
        return IERC20(token1).balanceOf(address(this));
    }

    // ============ Swap State Structs ============

    struct SwapState {
        int256 amountSpecifiedRemaining;
        int256 amountCalculated;
        uint160 sqrtPriceX96;
        int24 tick;
        uint256 feeGrowthGlobalX128;
        uint128 protocolFee;
        uint128 liquidity;
    }

    struct StepComputations {
        uint160 sqrtPriceStartX96;
        int24 tickNext;
        bool initialized;
        uint160 sqrtPriceNextX96;
        uint256 amountIn;
        uint256 amountOut;
        uint256 feeAmount;
    }
}

// ============ Helper Extensions ============

library SafeCast {
    function toInt256(uint256 y) internal pure returns (int256 z) {
        require(y < 2 ** 255);
        z = int256(y);
    }
}

using SafeCast for uint256;

// ============ Factory Interface ============

interface IXLPV3PoolDeployer {
    function parameters()
        external
        view
        returns (address factory, address token0, address token1, uint24 fee, int24 tickSpacing);
}

interface IXLPV3Factory {
    function owner() external view returns (address);
}
