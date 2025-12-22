// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ITFMMPool
 * @author Jeju Network
 * @notice Interface for Temporal Function Market Maker pools
 */
interface ITFMMPool {
    // ============ Structs ============

    struct GuardRails {
        uint256 minWeight;           // Minimum weight per token (18 decimals)
        uint256 maxWeight;           // Maximum weight per token (18 decimals)
        uint256 maxWeightChangeBps;  // Max change per update in basis points
        uint256 minUpdateInterval;   // Minimum blocks between updates
    }

    struct PoolState {
        address[] tokens;
        uint256[] balances;
        uint256[] currentWeights;
        uint256[] targetWeights;
        int256[] weightDeltas;
        uint256 lastUpdateBlock;
        uint256 swapFeeBps;
        uint256 totalSupply;
    }

    // ============ Events ============

    event WeightsUpdated(
        uint256[] oldWeights,
        uint256[] newWeights,
        uint256 blocksToTarget,
        uint256 indexed blockNumber
    );

    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount
    );

    event LiquidityAdded(
        address indexed provider,
        uint256[] amounts,
        uint256 lpTokensMinted
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256[] amounts,
        uint256 lpTokensBurned
    );

    event StrategyRuleUpdated(address indexed oldRule, address indexed newRule);
    event GuardRailsUpdated(GuardRails newGuardRails);

    // ============ Errors ============

    error InvalidWeight();
    error WeightChangeTooLarge(uint256 change, uint256 maxAllowed);
    error UpdateTooSoon(uint256 blocksRemaining);
    error InsufficientLiquidity();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error InvalidToken();
    error Unauthorized();
    error ZeroAmount();

    // ============ Weight Management ============

    /**
     * @notice Get current normalized weights (interpolated)
     */
    function getNormalizedWeights() external view returns (uint256[] memory);

    /**
     * @notice Update pool weights to new targets
     * @param newWeights New target weights (must sum to 1e18)
     * @param blocksToTarget Number of blocks to interpolate over
     */
    function updateWeights(uint256[] calldata newWeights, uint256 blocksToTarget) external;

    /**
     * @notice Get guard rail parameters
     */
    function getGuardRails() external view returns (uint256 minWeight, uint256 maxWeight, uint256 maxWeightChangeBps);

    // ============ Pool State ============

    /**
     * @notice Get pool tokens
     */
    function getTokens() external view returns (address[] memory);

    /**
     * @notice Get token balances
     */
    function getBalances() external view returns (uint256[] memory);

    /**
     * @notice Get full pool state
     */
    function getPoolState() external view returns (PoolState memory);

    /**
     * @notice Get block number of last weight update
     */
    function lastUpdateBlock() external view returns (uint256);

    /**
     * @notice Get strategy rule contract address
     */
    function strategyRule() external view returns (address);

    // ============ Trading ============

    /**
     * @notice Swap tokens
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum output amount (slippage protection)
     * @return amountOut Actual output amount
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);

    /**
     * @notice Get expected output for a swap
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint256 feeAmount);

    /**
     * @notice Get spot price of tokenIn in terms of tokenOut
     */
    function getSpotPrice(address tokenIn, address tokenOut) external view returns (uint256 price);

    // ============ Liquidity ============

    /**
     * @notice Add liquidity proportionally
     * @param amounts Token amounts to deposit
     * @param minLpTokens Minimum LP tokens to receive
     * @return lpTokens LP tokens minted
     */
    function addLiquidity(
        uint256[] calldata amounts,
        uint256 minLpTokens
    ) external returns (uint256 lpTokens);

    /**
     * @notice Remove liquidity proportionally
     * @param lpTokens LP tokens to burn
     * @param minAmounts Minimum token amounts to receive
     * @return amounts Token amounts received
     */
    function removeLiquidity(
        uint256 lpTokens,
        uint256[] calldata minAmounts
    ) external returns (uint256[] memory amounts);

    // ============ Fees ============

    /**
     * @notice Get swap fee in basis points
     */
    function swapFeeBps() external view returns (uint256);

    /**
     * @notice Collect accumulated protocol fees
     */
    function collectFees() external returns (uint256[] memory fees);

    /**
     * @notice Set swap fee (governance only)
     * @param newFeeBps New fee in basis points
     */
    function setSwapFee(uint256 newFeeBps) external;

    /**
     * @notice Set protocol fee share (governance only)
     * @param newFeeBps New protocol fee in basis points
     */
    function setProtocolFee(uint256 newFeeBps) external;
}

