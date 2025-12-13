// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IXLPV2Pair.sol";
import "./interfaces/IXLPV2Factory.sol";
import "./interfaces/IXLPV3Pool.sol";
import "./interfaces/IPermit2.sol";
import "./libraries/TickMath.sol";

/// @title WETH Interface
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title Router Integration Interface
/// @notice Interface for external routers to integrate with XLP
interface IRouterIntegration {
    /// @notice Execute swap on behalf of external router
    function executeSwapForRouter(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata routeData
    ) external returns (uint256 amountOut);

    /// @notice Get quote for external routers
    function quoteForRouter(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint8 poolType, uint24 fee);
}

/// @title XLP Router
/// @author Jeju Network
/// @notice Unified router for V2 and V3 swaps with cross-chain integration
/// @dev Handles routing between V2 constant product pools and V3 CLMM pools
///      Supports Permit2 for gasless approvals and external router integration
contract XLPRouter is ReentrancyGuard, Ownable, IXLPV3SwapCallback, IRouterIntegration {
    using SafeERC20 for IERC20;

    // ============ State ============

    address public immutable v2Factory;
    address public immutable v3Factory;
    address public immutable WETH;

    /// @notice Permit2 contract address
    address public permit2;

    /// @notice Cross-chain paymaster for XLP integration
    address public crossChainPaymaster;

    /// @notice Liquidity aggregator for best route finding
    address public liquidityAggregator;

    /// @notice Router registry for external router integration
    address public routerRegistry;

    /// @notice Fee recipient for router fees
    address public feeRecipient;

    /// @notice Router fee in basis points (default 0, can be set for revenue)
    uint256 public routerFeeBps;

    /// @notice Approved external routers that can call executeSwapForRouter
    mapping(address => bool) public approvedRouters;

    /// @notice Referral tracking for fee sharing
    mapping(address => address) public referrers;
    mapping(address => uint256) public referralVolume;

    // ============ Events ============

    event SwapV2(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event SwapV3(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint24 fee
    );

    event CrossChainSwapInitiated(
        address indexed sender,
        uint256 sourceChainId,
        uint256 destChainId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    );

    event RouterSwapExecuted(
        address indexed router,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event Permit2Updated(address indexed oldPermit2, address indexed newPermit2);
    event AggregatorUpdated(address indexed oldAggregator, address indexed newAggregator);
    event RouterApproved(address indexed router, bool approved);
    event ReferralSet(address indexed user, address indexed referrer);

    // ============ Errors ============

    error InvalidPath();
    error InsufficientOutputAmount();
    error ExcessiveInputAmount();
    error ExpiredDeadline();
    error InvalidPool();
    error TransferFailed();
    error InsufficientLiquidity();
    error NotApprovedRouter();
    error InvalidPermit();

    // ============ Constructor ============

    constructor(
        address _v2Factory,
        address _v3Factory,
        address _WETH,
        address _owner
    ) Ownable(_owner) {
        v2Factory = _v2Factory;
        v3Factory = _v3Factory;
        WETH = _WETH;
        feeRecipient = _owner;
    }

    // ============ Modifiers ============

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert ExpiredDeadline();
        _;
    }

    // ============ V2 Swap Functions ============

    /// @notice Swap exact tokens for tokens using V2 pools
    /// @param amountIn Amount of input tokens
    /// @param amountOutMin Minimum output amount
    /// @param path Array of token addresses for the swap path
    /// @param to Recipient address
    /// @param deadline Transaction deadline
    /// @return amounts Array of amounts for each step in the path
    function swapExactTokensForTokensV2(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        amounts = _getAmountsOutV2(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();
        
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairForV2(path[0], path[1]), amounts[0]);
        _swapV2(amounts, path, to);
        
        emit SwapV2(msg.sender, path[0], path[path.length - 1], amountIn, amounts[amounts.length - 1]);
    }

    /// @notice Swap tokens for exact tokens using V2 pools
    /// @param amountOut Exact output amount desired
    /// @param amountInMax Maximum input amount
    /// @param path Array of token addresses for the swap path
    /// @param to Recipient address
    /// @param deadline Transaction deadline
    /// @return amounts Array of amounts for each step in the path
    function swapTokensForExactTokensV2(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        amounts = _getAmountsInV2(amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount();
        
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairForV2(path[0], path[1]), amounts[0]);
        _swapV2(amounts, path, to);
        
        emit SwapV2(msg.sender, path[0], path[path.length - 1], amounts[0], amountOut);
    }

    /// @notice Swap exact ETH for tokens using V2 pools
    function swapExactETHForTokensV2(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        if (path[0] != WETH) revert InvalidPath();
        amounts = _getAmountsOutV2(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();
        
        IWETH(WETH).deposit{value: amounts[0]}();
        if (!IWETH(WETH).transfer(_pairForV2(path[0], path[1]), amounts[0])) revert TransferFailed();
        _swapV2(amounts, path, to);
        
        emit SwapV2(msg.sender, path[0], path[path.length - 1], msg.value, amounts[amounts.length - 1]);
    }

    /// @notice Swap exact tokens for ETH using V2 pools
    function swapExactTokensForETHV2(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        if (path[path.length - 1] != WETH) revert InvalidPath();
        amounts = _getAmountsOutV2(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();
        
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairForV2(path[0], path[1]), amounts[0]);
        _swapV2(amounts, path, address(this));
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        _safeTransferETH(to, amounts[amounts.length - 1]);
        
        emit SwapV2(msg.sender, path[0], path[path.length - 1], amountIn, amounts[amounts.length - 1]);
    }

    // ============ V3 Swap Functions ============

    /// @notice Swap exact input using V3 pool
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param fee Pool fee tier
    /// @param recipient Recipient address
    /// @param deadline Transaction deadline
    /// @param amountIn Exact input amount
    /// @param amountOutMinimum Minimum output amount
    /// @param sqrtPriceLimitX96 Price limit (0 for no limit)
    /// @return amountOut Output amount
    function exactInputSingleV3(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 deadline,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external ensure(deadline) nonReentrant returns (uint256 amountOut) {
        // Transfer tokens to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Get pool
        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert InvalidPool();

        bool zeroForOne = tokenIn < tokenOut;

        // Approve pool to spend tokens
        IERC20(tokenIn).forceApprove(pool, amountIn);

        // Execute swap
        (int256 amount0, int256 amount1) = IXLPV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(tokenIn, tokenOut, fee)
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        if (amountOut < amountOutMinimum) revert InsufficientOutputAmount();

        emit SwapV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    /// @notice Swap exact output using V3 pool
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param fee Pool fee tier
    /// @param recipient Recipient address
    /// @param deadline Transaction deadline
    /// @param amountOut Exact output amount
    /// @param amountInMaximum Maximum input amount
    /// @param sqrtPriceLimitX96 Price limit
    /// @return amountIn Input amount used
    function exactOutputSingleV3(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 deadline,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external ensure(deadline) nonReentrant returns (uint256 amountIn) {
        // Get pool
        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert InvalidPool();

        // Transfer max tokens to this contract first (will refund excess)
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountInMaximum);

        bool zeroForOne = tokenIn < tokenOut;

        // Approve pool to spend tokens
        IERC20(tokenIn).forceApprove(pool, amountInMaximum);

        // Execute swap (negative amountSpecified for exact output)
        (int256 amount0, int256 amount1) = IXLPV3Pool(pool).swap(
            recipient,
            zeroForOne,
            -int256(amountOut),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(tokenIn, tokenOut, fee)
        );

        amountIn = uint256(zeroForOne ? amount0 : amount1);
        if (amountIn > amountInMaximum) revert ExcessiveInputAmount();

        // Refund excess tokens to user
        uint256 refund = amountInMaximum - amountIn;
        if (refund > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, refund);
        }

        emit SwapV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ============ V3 Callback ============

    /// @notice Callback for V3 swaps
    function xlpV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external override {
        (address tokenIn, address tokenOut, uint24 fee) = abi.decode(data, (address, address, uint24));
        
        // Verify callback is from legitimate pool
        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        require(msg.sender == pool, "Invalid callback");

        // Pay the required amount
        if (amount0Delta > 0) {
            IERC20(tokenIn < tokenOut ? tokenIn : tokenOut).safeTransfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(tokenIn < tokenOut ? tokenOut : tokenIn).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }

    // ============ Multi-Hop Swaps ============

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Multi-hop exact input swap through V3 pools
    /// @param params Swap parameters encoded in path
    /// @return amountOut Output amount
    function exactInputV3(ExactInputParams calldata params)
        external
        ensure(params.deadline)
        nonReentrant
        returns (uint256 amountOut)
    {
        // Decode first token from path (first 20 bytes)
        bytes calldata path = params.path;
        address tokenIn = address(bytes20(path[0:20]));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        amountOut = _exactInputInternal(
            params.amountIn,
            params.recipient,
            params.path
        );

        if (amountOut < params.amountOutMinimum) revert InsufficientOutputAmount();
    }

    // ============ Quote Functions ============

    /// @notice Get V2 output amount for a given input
    /// @param amountIn Input amount
    /// @param path Swap path
    /// @return amounts Output amounts at each step
    function getAmountsOutV2(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        return _getAmountsOutV2(amountIn, path);
    }

    /// @notice Get V2 input amount for a given output
    /// @param amountOut Desired output
    /// @param path Swap path
    /// @return amounts Input amounts at each step
    function getAmountsInV2(uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        return _getAmountsInV2(amountOut, path);
    }

    // ============ Admin Functions ============

    function setCrossChainPaymaster(address _paymaster) external onlyOwner {
        crossChainPaymaster = _paymaster;
    }

    function setPermit2(address _permit2) external onlyOwner {
        emit Permit2Updated(permit2, _permit2);
        permit2 = _permit2;
    }

    function setLiquidityAggregator(address _aggregator) external onlyOwner {
        emit AggregatorUpdated(liquidityAggregator, _aggregator);
        liquidityAggregator = _aggregator;
    }

    function setRouterRegistry(address _registry) external onlyOwner {
        routerRegistry = _registry;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
    }

    function setRouterFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Max 1%");
        routerFeeBps = _feeBps;
    }

    function setRouterApproval(address router, bool approved) external onlyOwner {
        approvedRouters[router] = approved;
        emit RouterApproved(router, approved);
    }

    // ============ Permit2 Swap Functions ============

    /// @notice Swap using Permit2 signature (gasless approval)
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Amount of input token
    /// @param amountOutMin Minimum output amount
    /// @param to Recipient address
    /// @param deadline Transaction deadline
    /// @param permit Permit2 permit data
    /// @param signature Permit2 signature
    function swapWithPermit2V2(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external ensure(deadline) nonReentrant returns (uint256 amountOut) {
        if (permit2 == address(0)) revert InvalidPermit();

        // Transfer tokens via Permit2
        IPermit2(permit2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({
                to: _pairForV2(tokenIn, tokenOut),
                requestedAmount: amountIn
            }),
            msg.sender,
            signature
        );

        // Execute swap
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256[] memory amounts = _getAmountsOutV2(amountIn, path);
        amountOut = amounts[1];
        
        if (amountOut < amountOutMin) revert InsufficientOutputAmount();
        
        _swapV2(amounts, path, to);
        
        emit SwapV2(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Swap V3 using Permit2 signature
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param fee Pool fee tier
    /// @param recipient Recipient address
    /// @param deadline Transaction deadline
    /// @param amountIn Input amount
    /// @param amountOutMinimum Minimum output
    /// @param sqrtPriceLimitX96 Price limit
    /// @param permit Permit2 permit data
    /// @param signature Permit2 signature
    function swapWithPermit2V3(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 deadline,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external ensure(deadline) nonReentrant returns (uint256 amountOut) {
        if (permit2 == address(0)) revert InvalidPermit();

        // Transfer tokens via Permit2 to this contract
        IPermit2(permit2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({
                to: address(this),
                requestedAmount: amountIn
            }),
            msg.sender,
            signature
        );

        // Get pool
        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert InvalidPool();

        bool zeroForOne = tokenIn < tokenOut;

        // Approve pool
        IERC20(tokenIn).forceApprove(pool, amountIn);

        // Execute swap
        (int256 amount0, int256 amount1) = IXLPV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(tokenIn, tokenOut, fee)
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        if (amountOut < amountOutMinimum) revert InsufficientOutputAmount();

        emit SwapV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ============ Router Integration Functions ============

    /// @inheritdoc IRouterIntegration
    /// @notice Execute swap on behalf of external router (e.g., 1inch, Paraswap)
    function executeSwapForRouter(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata routeData
    ) external override nonReentrant returns (uint256 amountOut) {
        if (!approvedRouters[msg.sender]) revert NotApprovedRouter();

        // Decode route data: (uint8 poolType, uint24 fee)
        (uint8 poolType, uint24 fee) = routeData.length >= 4 
            ? abi.decode(routeData, (uint8, uint24))
            : (uint8(0), uint24(3000)); // Default to V2

        // Transfer tokens from router
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        if (poolType == 0) {
            // V2 swap
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            uint256[] memory amounts = _getAmountsOutV2(amountIn, path);
            amountOut = amounts[1];
            
            IERC20(tokenIn).safeTransfer(_pairForV2(tokenIn, tokenOut), amountIn);
            _swapV2(amounts, path, recipient);
        } else {
            // V3 swap
            address pool = _getV3Pool(tokenIn, tokenOut, fee);
            if (pool == address(0)) revert InvalidPool();

            bool zeroForOne = tokenIn < tokenOut;
            IERC20(tokenIn).forceApprove(pool, amountIn);

            (int256 amount0, int256 amount1) = IXLPV3Pool(pool).swap(
                recipient,
                zeroForOne,
                int256(amountIn),
                zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
                abi.encode(tokenIn, tokenOut, fee)
            );

            amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        }

        if (amountOut < minAmountOut) revert InsufficientOutputAmount();

        // Track referral volume
        address referrer = referrers[recipient];
        if (referrer != address(0)) {
            referralVolume[referrer] += amountIn;
        }

        emit RouterSwapExecuted(msg.sender, recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @inheritdoc IRouterIntegration
    /// @notice Get quote for external routers
    function quoteForRouter(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 amountOut, uint8 poolType, uint24 fee) {
        // Try V2 first
        address v2Pair = _pairForV2(tokenIn, tokenOut);
        if (v2Pair != address(0)) {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            uint256[] memory amounts = _getAmountsOutV2(amountIn, path);
            uint256 v2Out = amounts[1];

            // Try V3 pools
            uint24[3] memory feeTiers = [uint24(500), uint24(3000), uint24(10000)];
            uint256 bestV3Out = 0;
            uint24 bestFee = 3000;

            for (uint256 i = 0; i < 3; i++) {
                address pool = _getV3Pool(tokenIn, tokenOut, feeTiers[i]);
                if (pool != address(0)) {
                    uint128 liquidity = IXLPV3Pool(pool).liquidity();
                    if (liquidity > 0) {
                        // Simplified estimate
                        uint256 estimated = amountIn * (1e6 - feeTiers[i]) / 1e6;
                        if (estimated > bestV3Out) {
                            bestV3Out = estimated;
                            bestFee = feeTiers[i];
                        }
                    }
                }
            }

            // Return best option
            if (v2Out >= bestV3Out) {
                return (v2Out, 0, 3000);
            } else {
                return (bestV3Out, 1, bestFee);
            }
        }

        // Only V3 available
        uint24[3] memory v3FeeTiers = [uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i = 0; i < 3; i++) {
            address pool = _getV3Pool(tokenIn, tokenOut, v3FeeTiers[i]);
            if (pool != address(0)) {
                uint128 liquidity = IXLPV3Pool(pool).liquidity();
                if (liquidity > 0) {
                    uint256 estimated = amountIn * (1e6 - v3FeeTiers[i]) / 1e6;
                    return (estimated, 1, v3FeeTiers[i]);
                }
            }
        }

        return (0, 0, 0);
    }

    /// @notice Set referrer for a user
    /// @param referrer Referrer address
    function setReferrer(address referrer) external {
        if (referrers[msg.sender] == address(0) && referrer != msg.sender) {
            referrers[msg.sender] = referrer;
            emit ReferralSet(msg.sender, referrer);
        }
    }

    /// @notice Get referral stats
    /// @param referrer Referrer address
    /// @return volume Total volume referred
    function getReferralVolume(address referrer) external view returns (uint256 volume) {
        return referralVolume[referrer];
    }

    // ============ Internal V2 Functions ============

    function _swapV2(uint256[] memory amounts, address[] memory path, address _to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = _sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address to = i < path.length - 2 ? _pairForV2(output, path[i + 2]) : _to;
            IXLPV2Pair(_pairForV2(input, output)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function _getAmountsOutV2(uint256 amountIn, address[] memory path) internal view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReservesV2(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOutV2(amounts[i], reserveIn, reserveOut);
        }
    }

    function _getAmountsInV2(uint256 amountOut, address[] memory path) internal view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = _getReservesV2(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountInV2(amounts[i], reserveIn, reserveOut);
        }
    }

    function _getAmountOutV2(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0) revert InsufficientLiquidity();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    function _getAmountInV2(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountOut == 0) revert InsufficientLiquidity();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        return (numerator / denominator) + 1;
    }

    function _getReservesV2(address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0,) = _sortTokens(tokenA, tokenB);
        (uint112 reserve0, uint112 reserve1,) = IXLPV2Pair(_pairForV2(tokenA, tokenB)).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _pairForV2(address tokenA, address tokenB) internal view returns (address pair) {
        pair = IXLPV2Factory(v2Factory).getPair(tokenA, tokenB);
    }

    function _sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    // ============ Internal V3 Functions ============

    function _getV3Pool(address tokenA, address tokenB, uint24 fee) internal view returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = IXLPV3Factory(v3Factory).getPool(token0, token1, fee);
    }

    function _exactInputInternal(
        uint256 amountIn,
        address recipient,
        bytes memory path
    ) internal returns (uint256 amountOut) {
        // Decode path: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
        address tokenIn;
        uint24 fee;
        address tokenOut;

        assembly {
            // path starts at offset 32 (length is stored first)
            tokenIn := shr(96, mload(add(path, 32)))
            fee := and(shr(72, mload(add(path, 52))), 0xffffff)
            tokenOut := shr(96, mload(add(path, 55)))
        }

        address pool = _getV3Pool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert InvalidPool();

        bool zeroForOne = tokenIn < tokenOut;

        IERC20(tokenIn).forceApprove(pool, amountIn);

        (int256 amount0, int256 amount1) = IXLPV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            abi.encode(tokenIn, tokenOut, fee)
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
    }

    // ============ Utility Functions ============

    function _safeTransferETH(address to, uint256 value) internal {
        (bool success,) = to.call{value: value}(new bytes(0));
        if (!success) revert TransferFailed();
    }

    receive() external payable {
        // Accept ETH only from WETH contract
        require(msg.sender == WETH);
    }
}

/// @notice V3 Factory interface for getting pools
interface IXLPV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}
