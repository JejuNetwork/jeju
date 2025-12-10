// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Uniswap V4 PoolManager interface (minimal)
interface IPoolManager {
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

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (int256 amount0, int256 amount1);
}

/// @notice CrossChainPaymaster interface for XLP operations
interface ICrossChainPaymaster {
    function createVoucherRequest(
        address token,
        uint256 amount,
        address destinationToken,
        uint256 destinationChainId,
        address recipient,
        uint256 gasOnDestination,
        uint256 maxFee,
        uint256 feeIncrement
    ) external payable returns (bytes32 requestId);

    function supportedTokens(address token) external view returns (bool);
    function getTotalLiquidity(address token) external view returns (uint256);
}

/**
 * @title CrossChainSwapRouter
 * @author Jeju Network
 * @notice Routes cross-chain swaps through XLP transport + V4 AMM execution
 * @dev Composes two systems for maximum capital efficiency:
 *      - XLP: Cross-chain transport (receives tokens on source, provides on destination)
 *      - V4:  Price discovery and AMM execution on Jeju
 *
 * Flow for cross-chain swap (e.g., ETH on Arbitrum → JEJU token):
 * 1. User on Arbitrum initiates swap with ETH
 * 2. XLP receives ETH on Arbitrum, provides ETH on Jeju
 * 3. This router swaps ETH → JEJU via V4 PoolManager
 * 4. User receives JEJU on Jeju (or back via XLP)
 *
 * Benefits:
 * - V4 LPs earn from cross-chain volume
 * - XLPs earn transport fees
 * - Users get best prices via V4's CPMM
 * - Single liquidity serves both local and cross-chain swaps
 */
contract CrossChainSwapRouter is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice Uniswap V4 PoolManager
    IPoolManager public poolManager;

    /// @notice CrossChainPaymaster for XLP operations
    ICrossChainPaymaster public crossChainPaymaster;

    /// @notice Chain ID
    uint256 public immutable chainId;

    /// @notice Default swap fee tier (0.3%)
    uint24 public constant DEFAULT_FEE = 3000;

    /// @notice Default tick spacing for 0.3% fee tier
    int24 public constant DEFAULT_TICK_SPACING = 60;

    /// @notice Fee for using this router (basis points, 10 = 0.1%)
    uint256 public routerFeeBps = 10;

    /// @notice Treasury for router fees
    address public treasury;

    /// @notice Registered pool keys for token pairs
    mapping(bytes32 => PoolKey) public poolKeys;

    /// @notice Optimal route for source chain → destination token
    mapping(uint256 => mapping(address => Route)) public routes;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Route {
        bool exists;
        address intermediateToken; // Token to receive via XLP before V4 swap
        bytes32 poolKeyHash;       // Hash of pool key for V4 swap
        uint256 minLiquidity;      // Minimum XLP liquidity required
    }

    struct SwapRequest {
        address user;
        uint256 sourceChainId;
        address sourceToken;
        uint256 sourceAmount;
        address destinationToken;
        uint256 minOutput;
        uint256 deadline;
        bool completed;
    }

    /// @notice Pending swap requests
    mapping(bytes32 => SwapRequest) public swapRequests;

    // ============ Events ============

    event RouteRegistered(
        uint256 indexed sourceChainId,
        address indexed destinationToken,
        address intermediateToken,
        bytes32 poolKeyHash
    );

    event SwapInitiated(
        bytes32 indexed swapId,
        address indexed user,
        uint256 sourceChainId,
        address sourceToken,
        uint256 amount,
        address destinationToken
    );

    event SwapCompleted(
        bytes32 indexed swapId,
        address indexed user,
        address destinationToken,
        uint256 outputAmount
    );

    event CrossChainSwapExecuted(
        bytes32 indexed voucherRequestId,
        address indexed user,
        uint256 sourceChainId,
        uint256 inputAmount,
        uint256 outputAmount
    );

    event LocalSwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ============ Errors ============

    error InvalidRoute();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error DeadlineExpired();
    error SwapAlreadyCompleted();
    error UnsupportedToken();
    error InvalidAmount();
    error TransferFailed();

    // ============ Constructor ============

    constructor(
        address _poolManager,
        address _crossChainPaymaster,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        poolManager = IPoolManager(_poolManager);
        crossChainPaymaster = ICrossChainPaymaster(_crossChainPaymaster);
        treasury = _treasury;
        chainId = block.chainid;
    }

    // ============ Route Management ============

    /**
     * @notice Register a route for cross-chain swaps
     * @param sourceChainId Source chain ID
     * @param destinationToken Token user wants to receive
     * @param intermediateToken Token received via XLP (usually ETH or USDC)
     * @param poolKey V4 pool key for intermediate → destination swap
     */
    function registerRoute(
        uint256 sourceChainId,
        address destinationToken,
        address intermediateToken,
        PoolKey calldata poolKey
    ) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(poolKey));
        poolKeys[poolKeyHash] = poolKey;

        routes[sourceChainId][destinationToken] = Route({
            exists: true,
            intermediateToken: intermediateToken,
            poolKeyHash: poolKeyHash,
            minLiquidity: 0.1 ether
        });

        emit RouteRegistered(sourceChainId, destinationToken, intermediateToken, poolKeyHash);
    }

    /**
     * @notice Register a V4 pool for local swaps
     * @param poolKey Pool key configuration
     */
    function registerPool(PoolKey calldata poolKey) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(poolKey));
        poolKeys[poolKeyHash] = poolKey;
    }

    // ============ Local Swaps (Same Chain) ============

    /**
     * @notice Execute a swap on the local chain via V4
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum output (slippage protection)
     * @param fee Fee tier (use 0 for default)
     * @return amountOut Actual output amount
     */
    function swapLocal(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint24 fee
    ) external payable nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidAmount();

        // Use default fee if not specified
        if (fee == 0) fee = DEFAULT_FEE;

        // Sort tokens for pool key
        (address currency0, address currency1) = tokenIn < tokenOut
            ? (tokenIn, tokenOut)
            : (tokenOut, tokenIn);

        bool zeroForOne = tokenIn == currency0;

        // Transfer tokens in (ETH handled via msg.value)
        if (tokenIn != address(0)) {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(tokenIn).forceApprove(address(poolManager), amountIn);
        }

        // Build pool key
        IPoolManager.PoolKey memory poolKey = IPoolManager.PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: address(0)
        });

        // Execute swap
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
        });

        (int256 amount0, int256 amount1) = poolManager.swap(poolKey, params, "");

        // Calculate output
        amountOut = uint256(zeroForOne ? -amount1 : -amount0);

        // Check slippage
        if (amountOut < minAmountOut) revert SlippageExceeded();

        // Collect router fee
        uint256 routerFee = (amountOut * routerFeeBps) / 10000;
        amountOut -= routerFee;

        // Transfer output to user
        if (tokenOut == address(0)) {
            (bool success,) = msg.sender.call{value: amountOut}("");
            if (!success) revert TransferFailed();
            if (routerFee > 0) {
                (bool feeSuccess,) = treasury.call{value: routerFee}("");
                if (!feeSuccess) revert TransferFailed();
            }
        } else {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
            if (routerFee > 0) {
                IERC20(tokenOut).safeTransfer(treasury, routerFee);
            }
        }

        emit LocalSwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ============ Cross-Chain Swaps ============

    /**
     * @notice Initiate a cross-chain swap (source chain call)
     * @dev Creates XLP voucher request to transport tokens to Jeju
     * @param destinationToken Token to receive on Jeju
     * @param minOutput Minimum output amount
     * @param maxFee Maximum XLP fee willing to pay
     * @return requestId XLP voucher request ID
     */
    function initiateCrossChainSwap(
        address destinationToken,
        uint256 minOutput,
        uint256 maxFee
    ) external payable nonReentrant returns (bytes32 requestId) {
        if (msg.value == 0) revert InvalidAmount();

        // Get route for this destination token
        Route memory route = routes[chainId][destinationToken];
        if (!route.exists) revert InvalidRoute();

        // Check XLP liquidity
        uint256 xlpLiquidity = crossChainPaymaster.getTotalLiquidity(route.intermediateToken);
        if (xlpLiquidity < route.minLiquidity) revert InsufficientLiquidity();

        // Create voucher request via XLP
        requestId = crossChainPaymaster.createVoucherRequest{value: msg.value}(
            address(0),          // Native ETH
            msg.value - maxFee,  // Amount after fee
            route.intermediateToken,
            chainId,             // Same chain (Jeju)
            address(this),       // This contract receives on destination
            0,                   // No extra gas needed
            maxFee,
            maxFee / 50          // Fee increment (2% per block)
        );

        // Store swap request
        bytes32 swapId = keccak256(abi.encodePacked(requestId, msg.sender, destinationToken));
        swapRequests[swapId] = SwapRequest({
            user: msg.sender,
            sourceChainId: chainId,
            sourceToken: address(0),
            sourceAmount: msg.value - maxFee,
            destinationToken: destinationToken,
            minOutput: minOutput,
            deadline: block.timestamp + 1 hours,
            completed: false
        });

        emit SwapInitiated(swapId, msg.sender, chainId, address(0), msg.value - maxFee, destinationToken);
    }

    /**
     * @notice Complete a cross-chain swap after XLP fulfillment
     * @dev Called after XLP delivers intermediate tokens to this contract
     * @param swapId Swap request ID
     * @param intermediateAmount Amount of intermediate token received
     */
    function completeCrossChainSwap(
        bytes32 swapId,
        uint256 intermediateAmount
    ) external nonReentrant returns (uint256 outputAmount) {
        SwapRequest storage request = swapRequests[swapId];

        if (request.user == address(0)) revert InvalidRoute();
        if (request.completed) revert SwapAlreadyCompleted();
        if (block.timestamp > request.deadline) revert DeadlineExpired();

        // EFFECTS: Mark completed BEFORE external calls (CEI pattern)
        request.completed = true;

        Route memory route = routes[request.sourceChainId][request.destinationToken];

        // Execute V4 swap: intermediate → destination
        PoolKey memory poolKey = poolKeys[route.poolKeyHash];

        bool zeroForOne = route.intermediateToken == poolKey.currency0;

        // Approve PoolManager
        if (route.intermediateToken != address(0)) {
            IERC20(route.intermediateToken).forceApprove(address(poolManager), intermediateAmount);
        }

        IPoolManager.PoolKey memory v4PoolKey = IPoolManager.PoolKey({
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks
        });

        IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(intermediateAmount),
            sqrtPriceLimitX96: zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
        });

        // INTERACTIONS: External call
        (int256 amount0, int256 amount1) = poolManager.swap(v4PoolKey, swapParams, "");

        outputAmount = uint256(zeroForOne ? -amount1 : -amount0);

        // Check slippage (revert if not met - request already marked complete but nonReentrant protects)
        if (outputAmount < request.minOutput) revert SlippageExceeded();

        // Collect router fee
        uint256 routerFee = (outputAmount * routerFeeBps) / 10000;
        outputAmount -= routerFee;

        // Transfer to user
        if (request.destinationToken == address(0)) {
            (bool success,) = request.user.call{value: outputAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(request.destinationToken).safeTransfer(request.user, outputAmount);
        }

        // Transfer fee to treasury
        if (routerFee > 0) {
            if (request.destinationToken == address(0)) {
                (bool feeSuccess,) = treasury.call{value: routerFee}("");
                if (!feeSuccess) revert TransferFailed();
            } else {
                IERC20(request.destinationToken).safeTransfer(treasury, routerFee);
            }
        }

        emit SwapCompleted(swapId, request.user, request.destinationToken, outputAmount);
    }

    // ============ Quote Functions ============

    /**
     * @notice Get quote for a local swap
     * @param amountIn Input amount
     * @param fee Fee tier
     * @return amountOut Expected output (before router fee)
     * @return priceImpact Price impact in basis points
     */
    function quoteLocal(
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 amountIn,
        uint24 fee
    ) external pure returns (uint256 amountOut, uint256 priceImpact) {
        if (fee == 0) fee = DEFAULT_FEE;

        // Simplified quote - in production use quoter contract
        // Fee is in hundredths of a basis point (3000 = 0.3%)
        // amountOut = amountIn * (1 - fee/1000000)
        amountOut = amountIn * (1000000 - fee) / 1000000;
        priceImpact = 10; // 0.1% default estimate
    }

    /**
     * @notice Get quote for cross-chain swap
     * @param sourceChainId Source chain
     * @param destinationToken Destination token
     * @param amountIn Input amount (in source token)
     * @return amountOut Expected output
     * @return xlpFee XLP transport fee
     * @return v4Fee V4 swap fee
     * @return routerFee Router fee
     */
    function quoteCrossChain(
        uint256 sourceChainId,
        address destinationToken,
        uint256 amountIn
    ) external view returns (
        uint256 amountOut,
        uint256 xlpFee,
        uint256 v4Fee,
        uint256 routerFee
    ) {
        Route memory route = routes[sourceChainId][destinationToken];
        if (!route.exists) revert InvalidRoute();

        // Estimate XLP fee (0.05% typical)
        xlpFee = amountIn * 5 / 10000;

        // After XLP fee
        uint256 afterXlp = amountIn - xlpFee;

        // V4 swap fee
        PoolKey memory poolKey = poolKeys[route.poolKeyHash];
        v4Fee = afterXlp * poolKey.fee / 1000000;

        // After V4 fee
        uint256 afterV4 = afterXlp - v4Fee;

        // Router fee
        routerFee = afterV4 * routerFeeBps / 10000;

        amountOut = afterV4 - routerFee;
    }

    /**
     * @notice Check if a route has sufficient liquidity
     * @param sourceChainId Source chain
     * @param destinationToken Destination token
     * @param amount Amount to swap
     * @return hasLiquidity Whether route can handle the amount
     * @return xlpLiquidity Available XLP liquidity
     */
    function checkRouteLiquidity(
        uint256 sourceChainId,
        address destinationToken,
        uint256 amount
    ) external view returns (bool hasLiquidity, uint256 xlpLiquidity) {
        Route memory route = routes[sourceChainId][destinationToken];
        if (!route.exists) return (false, 0);

        xlpLiquidity = crossChainPaymaster.getTotalLiquidity(route.intermediateToken);
        hasLiquidity = xlpLiquidity >= amount && xlpLiquidity >= route.minLiquidity;
    }

    // ============ Admin Functions ============

    function setRouterFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Max 1%");
        routerFeeBps = _feeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function setPoolManager(address _poolManager) external onlyOwner {
        poolManager = IPoolManager(_poolManager);
    }

    function setCrossChainPaymaster(address _paymaster) external onlyOwner {
        crossChainPaymaster = ICrossChainPaymaster(_paymaster);
    }

    function setRouteMinLiquidity(
        uint256 sourceChainId,
        address destinationToken,
        uint256 minLiquidity
    ) external onlyOwner {
        routes[sourceChainId][destinationToken].minLiquidity = minLiquidity;
    }

    // ============ Receive ETH ============

    receive() external payable {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
