// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import "../interfaces/IXLPV3Pool.sol";
import "../libraries/TickMath.sol";
import "../libraries/SqrtPriceMath.sol";
import "../libraries/LiquidityMath.sol";
import "../libraries/FullMath.sol";

/// @title XLP Position Manager
/// @author Jeju Network
/// @notice NFT-based position manager for V3 concentrated liquidity positions
/// @dev Each position is represented as an ERC721 NFT
contract XLPPositionManager is ERC721Enumerable, ReentrancyGuard, Multicall, IXLPV3MintCallback {
    using SafeERC20 for IERC20;

    // ============ State ============

    address public immutable factory;
    address public immutable WETH;

    /// @notice Counter for token IDs
    uint256 private _nextId = 1;

    /// @notice Position data stored for each NFT
    struct Position {
        uint96 nonce;
        address operator;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    /// @notice Mapping from token ID to position
    mapping(uint256 => Position) private _positions;

    /// @notice Struct for mint parameters
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    /// @notice Struct for increase liquidity parameters
    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Struct for decrease liquidity parameters
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Struct for collect parameters
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    // ============ Events ============

    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);

    // ============ Errors ============

    error InvalidToken();
    error NotApproved();
    error NotCleared();
    error InvalidPool();
    error PriceLimitExceeded();
    error DeadlineExpired();
    error InvalidRecipient();

    // ============ Constructor ============

    constructor(address _factory, address _WETH) ERC721("XLP V3 Positions", "XLP-V3-POS") {
        factory = _factory;
        WETH = _WETH;
    }

    // ============ Modifiers ============

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender) && getApproved(tokenId) != msg.sender) {
            revert NotApproved();
        }
        _;
    }

    // ============ View Functions ============

    /// @notice Returns the position information for a given token ID
    /// @param tokenId The ID of the token representing the position
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position memory position = _positions[tokenId];
        if (position.token0 == address(0)) revert InvalidToken();
        return (
            position.nonce,
            position.operator,
            position.token0,
            position.token1,
            position.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    // ============ Liquidity Management ============

    /// @notice Creates a new position wrapped in an NFT
    /// @param params The params for creating a new position
    /// @return tokenId The ID of the newly minted NFT
    /// @return liquidity The amount of liquidity added
    /// @return amount0 The amount of token0 deposited
    /// @return amount1 The amount of token1 deposited
    function mint(MintParams calldata params)
        external
        payable
        nonReentrant
        checkDeadline(params.deadline)
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        address pool = _getPool(params.token0, params.token1, params.fee);
        if (pool == address(0)) revert InvalidPool();

        // Calculate optimal liquidity
        (liquidity, amount0, amount1) = _addLiquidity(
            AddLiquidityParams({
                pool: pool,
                token0: params.token0,
                token1: params.token1,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min
            })
        );

        // Mint NFT
        tokenId = _nextId++;
        _mint(params.recipient, tokenId);

        // Get fee growth
        (uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128) =
            _getFeeGrowthInside(pool, params.tickLower, params.tickUpper);

        // Store position
        _positions[tokenId] = Position({
            nonce: 0,
            operator: address(0),
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            feeGrowthInside0LastX128: feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: feeGrowthInside1LastX128,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    /// @notice Increases the liquidity of a position
    /// @param params The params for increasing liquidity
    /// @return liquidity The new liquidity amount
    /// @return amount0 The amount of token0 added
    /// @return amount1 The amount of token1 added
    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        nonReentrant
        checkDeadline(params.deadline)
        isAuthorizedForToken(params.tokenId)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        Position storage position = _positions[params.tokenId];
        address pool = _getPool(position.token0, position.token1, position.fee);

        (liquidity, amount0, amount1) = _addLiquidity(
            AddLiquidityParams({
                pool: pool,
                token0: position.token0,
                token1: position.token1,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min
            })
        );

        // Update position
        _updateFees(position, pool);
        position.liquidity += liquidity;

        emit IncreaseLiquidity(params.tokenId, liquidity, amount0, amount1);
    }

    /// @notice Decreases the liquidity of a position
    /// @param params The params for decreasing liquidity
    /// @return amount0 The amount of token0 withdrawn
    /// @return amount1 The amount of token1 withdrawn
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        nonReentrant
        checkDeadline(params.deadline)
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = _positions[params.tokenId];
        require(position.liquidity >= params.liquidity, "Insufficient liquidity");

        address pool = _getPool(position.token0, position.token1, position.fee);

        // Burn liquidity
        (amount0, amount1) = IXLPV3Pool(pool).burn(position.tickLower, position.tickUpper, params.liquidity);

        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage");

        // Update position
        _updateFees(position, pool);
        position.liquidity -= params.liquidity;
        position.tokensOwed0 += uint128(amount0);
        position.tokensOwed1 += uint128(amount1);

        emit DecreaseLiquidity(params.tokenId, params.liquidity, amount0, amount1);
    }

    /// @notice Collects tokens owed to a position
    /// @param params The params for collecting
    /// @return amount0 The amount of token0 collected
    /// @return amount1 The amount of token1 collected
    function collect(CollectParams calldata params)
        external
        nonReentrant
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        if (params.recipient == address(0)) revert InvalidRecipient();

        Position storage position = _positions[params.tokenId];
        address pool = _getPool(position.token0, position.token1, position.fee);

        // Update fees first
        _updateFees(position, pool);

        uint128 tokensOwed0 = position.tokensOwed0;
        uint128 tokensOwed1 = position.tokensOwed1;

        // Calculate amounts to collect
        amount0 = params.amount0Max > tokensOwed0 ? tokensOwed0 : params.amount0Max;
        amount1 = params.amount1Max > tokensOwed1 ? tokensOwed1 : params.amount1Max;

        // Collect from pool
        (uint128 collected0, uint128 collected1) = IXLPV3Pool(pool).collect(
            params.recipient, position.tickLower, position.tickUpper, uint128(amount0), uint128(amount1)
        );

        // Update position
        position.tokensOwed0 -= collected0;
        position.tokensOwed1 -= collected1;

        emit Collect(params.tokenId, params.recipient, collected0, collected1);
        return (collected0, collected1);
    }

    /// @notice Burns a token ID, which deletes it from the NFT contract
    /// @param tokenId The ID of the token to burn
    function burn(uint256 tokenId) external isAuthorizedForToken(tokenId) {
        Position storage position = _positions[tokenId];
        if (position.liquidity != 0 || position.tokensOwed0 != 0 || position.tokensOwed1 != 0) {
            revert NotCleared();
        }
        delete _positions[tokenId];
        _burn(tokenId);
    }

    // ============ Callback ============

    /// @inheritdoc IXLPV3MintCallback
    function xlpV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external override {
        (address token0, address token1, uint24 fee, address payer) =
            abi.decode(data, (address, address, uint24, address));

        // Verify callback is from legitimate pool
        address pool = _getPool(token0, token1, fee);
        require(msg.sender == pool, "Invalid callback");

        // Transfer tokens
        if (amount0Owed > 0) {
            _pay(token0, payer, msg.sender, amount0Owed);
        }
        if (amount1Owed > 0) {
            _pay(token1, payer, msg.sender, amount1Owed);
        }
    }

    // ============ Internal Functions ============

    struct AddLiquidityParams {
        address pool;
        address token0;
        address token1;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
    }

    function _addLiquidity(AddLiquidityParams memory params)
        internal
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Calculate optimal liquidity amount
        (uint160 sqrtPriceX96,,,,,,) = IXLPV3Pool(params.pool).slot0();

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(params.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(params.tickUpper);

        liquidity = _getLiquidityForAmounts(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, params.amount0Desired, params.amount1Desired
        );

        // Mint liquidity
        (amount0, amount1) = IXLPV3Pool(params.pool).mint(
            address(this),
            params.tickLower,
            params.tickUpper,
            liquidity,
            abi.encode(params.token0, params.token1, IXLPV3Pool(params.pool).fee(), msg.sender)
        );

        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage");
    }

    function _getLiquidityForAmounts(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            liquidity = _getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            uint128 liquidity0 = _getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
            uint128 liquidity1 = _getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            liquidity = _getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
        }
    }

    function _getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount0)
        internal
        pure
        returns (uint128 liquidity)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        uint256 intermediate = FullMath.mulDiv(sqrtRatioAX96, sqrtRatioBX96, 1 << 96);
        return uint128(FullMath.mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96));
    }

    function _getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount1)
        internal
        pure
        returns (uint128 liquidity)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        return uint128(FullMath.mulDiv(amount1, 1 << 96, sqrtRatioBX96 - sqrtRatioAX96));
    }

    function _updateFees(Position storage position, address pool) internal {
        (uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128) =
            _getFeeGrowthInside(pool, position.tickLower, position.tickUpper);

        position.tokensOwed0 += uint128(
            FullMath.mulDiv(feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128, position.liquidity, 1 << 128)
        );
        position.tokensOwed1 += uint128(
            FullMath.mulDiv(feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128, position.liquidity, 1 << 128)
        );

        position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
    }

    function _getFeeGrowthInside(address pool, int24 tickLower, int24 tickUpper)
        internal
        view
        returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)
    {
        (, int24 tickCurrent,,,,,) = IXLPV3Pool(pool).slot0();

        (,, uint256 lowerFeeGrowthOutside0X128, uint256 lowerFeeGrowthOutside1X128,,,,) =
            IXLPV3Pool(pool).ticks(tickLower);

        (,, uint256 upperFeeGrowthOutside0X128, uint256 upperFeeGrowthOutside1X128,,,,) =
            IXLPV3Pool(pool).ticks(tickUpper);

        uint256 feeGrowthGlobal0X128 = IXLPV3Pool(pool).feeGrowthGlobal0X128();
        uint256 feeGrowthGlobal1X128 = IXLPV3Pool(pool).feeGrowthGlobal1X128();

        uint256 feeGrowthBelow0X128;
        uint256 feeGrowthBelow1X128;
        if (tickCurrent >= tickLower) {
            feeGrowthBelow0X128 = lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = lowerFeeGrowthOutside1X128;
        } else {
            feeGrowthBelow0X128 = feeGrowthGlobal0X128 - lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = feeGrowthGlobal1X128 - lowerFeeGrowthOutside1X128;
        }

        uint256 feeGrowthAbove0X128;
        uint256 feeGrowthAbove1X128;
        if (tickCurrent < tickUpper) {
            feeGrowthAbove0X128 = upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = upperFeeGrowthOutside1X128;
        } else {
            feeGrowthAbove0X128 = feeGrowthGlobal0X128 - upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = feeGrowthGlobal1X128 - upperFeeGrowthOutside1X128;
        }

        feeGrowthInside0X128 = feeGrowthGlobal0X128 - feeGrowthBelow0X128 - feeGrowthAbove0X128;
        feeGrowthInside1X128 = feeGrowthGlobal1X128 - feeGrowthBelow1X128 - feeGrowthAbove1X128;
    }

    function _getPool(address token0, address token1, uint24 fee) internal view returns (address) {
        return IXLPV3FactoryFull(factory).getPool(token0, token1, fee);
    }

    function _pay(address token, address payer, address recipient, uint256 value) internal {
        if (payer == address(this)) {
            IERC20(token).safeTransfer(recipient, value);
        } else {
            IERC20(token).safeTransferFrom(payer, recipient, value);
        }
    }
}

interface IXLPV3FactoryFull {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}
