// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITokenRegistry {
    function isRegistered(address token) external view returns (bool);
}

interface ISwapRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

interface IModerationMarketplace {
    function stakeTokens(uint256 amount) external;
    function stakingToken() external view returns (address);
}

/**
 * @title JejuStakingHelper
 * @notice Zero-friction JEJU acquisition and staking for ModerationMarketplace
 * @dev Accepts any paymaster token, swaps to JEJU, and stakes in one transaction
 *
 * User Flow:
 * 1. User approves this contract for their token (USDC, elizaOS, etc.)
 * 2. User calls swapAndStake(token, amount) or stakeWithETH()
 * 3. Helper swaps their token → JEJU via XLP router
 * 4. Helper stakes JEJU in ModerationMarketplace ON USER'S BEHALF
 *    (by transferring to user first, then user needs to stake - OR using permit)
 *
 * Alternative simpler flow (what this implements):
 * 1. User sends any token
 * 2. Contract swaps to JEJU
 * 3. Contract sends JEJU to user's wallet
 * 4. User stakes in ModerationMarketplace separately (frontend handles)
 *
 * Why JEJU?
 * - Conviction lock: banned users can't withdraw JEJU from ModerationMarketplace
 * - This creates strong economic incentives for good behavior
 * - Any token → JEJU makes it frictionless to participate
 */
contract JejuStakingHelper is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Core contracts
    IERC20 public immutable jejuToken;
    ITokenRegistry public immutable tokenRegistry;
    ISwapRouter public immutable swapRouter;
    address public immutable weth;

    // Slippage tolerance (basis points, 100 = 1%)
    uint256 public slippageTolerance = 100;

    // Fee for the swap service (basis points, 0 = free)
    uint256 public swapFeeBps = 0;
    address public feeRecipient;

    // Events
    event SwappedToJeju(address indexed user, address indexed inputToken, uint256 inputAmount, uint256 jejuReceived);
    event SwappedETHToJeju(address indexed user, uint256 ethAmount, uint256 jejuReceived);
    event SlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    // Errors
    error TokenNotSupported();
    error InsufficientOutput();
    error InvalidAmount();
    error SwapFailed();

    constructor(address _jejuToken, address _tokenRegistry, address _swapRouter, address _weth, address initialOwner)
        Ownable(initialOwner)
    {
        jejuToken = IERC20(_jejuToken);
        tokenRegistry = ITokenRegistry(_tokenRegistry);
        swapRouter = ISwapRouter(_swapRouter);
        weth = _weth;
        feeRecipient = initialOwner;
    }

    /**
     * @notice Swap ETH to JEJU and send to user
     * @dev User receives JEJU in their wallet, ready to stake in ModerationMarketplace
     */
    function swapETHToJeju() external payable nonReentrant whenNotPaused returns (uint256 jejuAmount) {
        if (msg.value == 0) revert InvalidAmount();

        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(jejuToken);

        uint256[] memory expectedAmounts = swapRouter.getAmountsOut(msg.value, path);
        uint256 minOut = (expectedAmounts[1] * (10000 - slippageTolerance)) / 10000;

        uint256[] memory amounts =
            swapRouter.swapExactETHForTokens{value: msg.value}(minOut, path, address(this), block.timestamp + 300);

        jejuAmount = amounts[1];

        // Take fee if set
        uint256 fee = (jejuAmount * swapFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            jejuToken.safeTransfer(feeRecipient, fee);
            jejuAmount -= fee;
        }

        // Send JEJU to user
        jejuToken.safeTransfer(msg.sender, jejuAmount);

        emit SwappedETHToJeju(msg.sender, msg.value, jejuAmount);
    }

    /**
     * @notice Swap any paymaster token to JEJU
     * @param token Input token address
     * @param amount Amount of input token
     * @return jejuAmount Amount of JEJU received
     */
    function swapToJeju(address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 jejuAmount)
    {
        if (amount == 0) revert InvalidAmount();

        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // If already JEJU, just return it (minus fee)
        if (token == address(jejuToken)) {
            jejuAmount = amount;
        } else {
            // Verify token is registered
            if (!tokenRegistry.isRegistered(token)) revert TokenNotSupported();

            // Swap to JEJU
            jejuAmount = _swapToJeju(token, amount);
        }

        // Take fee if set
        uint256 fee = (jejuAmount * swapFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            jejuToken.safeTransfer(feeRecipient, fee);
            jejuAmount -= fee;
        }

        // Send JEJU to user
        jejuToken.safeTransfer(msg.sender, jejuAmount);

        emit SwappedToJeju(msg.sender, token, amount, jejuAmount);
    }

    /**
     * @notice Get quote for how much JEJU you'd receive
     * @param token Input token (address(0) for ETH)
     * @param amount Amount of input token
     */
    function getJejuQuote(address token, uint256 amount)
        external
        view
        returns (uint256 jejuAmount, uint256 feeAmount)
    {
        if (token == address(jejuToken)) {
            jejuAmount = amount;
        } else {
            address inputToken = token == address(0) ? weth : token;
            address[] memory path = _getSwapPath(inputToken);
            uint256[] memory amounts = swapRouter.getAmountsOut(amount, path);
            jejuAmount = amounts[amounts.length - 1];
        }

        feeAmount = (jejuAmount * swapFeeBps) / 10000;
        jejuAmount -= feeAmount;
    }

    /**
     * @notice Check if a token is supported for swapping
     */
    function isTokenSupported(address token) external view returns (bool) {
        if (token == address(0)) return true; // ETH
        if (token == address(jejuToken)) return true; // JEJU
        return tokenRegistry.isRegistered(token);
    }

    // ============ Internal Functions ============

    function _swapToJeju(address tokenIn, uint256 amountIn) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeIncreaseAllowance(address(swapRouter), amountIn);

        address[] memory path = _getSwapPath(tokenIn);
        uint256[] memory expectedAmounts = swapRouter.getAmountsOut(amountIn, path);
        uint256 expectedOut = expectedAmounts[expectedAmounts.length - 1];
        uint256 minOut = (expectedOut * (10000 - slippageTolerance)) / 10000;

        uint256[] memory amounts =
            swapRouter.swapExactTokensForTokens(amountIn, minOut, path, address(this), block.timestamp + 300);

        amountOut = amounts[amounts.length - 1];
        if (amountOut < minOut) revert InsufficientOutput();
    }

    function _getSwapPath(address tokenIn) internal view returns (address[] memory path) {
        if (tokenIn == weth) {
            path = new address[](2);
            path[0] = weth;
            path[1] = address(jejuToken);
        } else {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = weth;
            path[2] = address(jejuToken);
        }
    }

    // ============ Admin Functions ============

    function setSlippageTolerance(uint256 newSlippage) external onlyOwner {
        require(newSlippage <= 1000, "Max 10% slippage");
        emit SlippageUpdated(slippageTolerance, newSlippage);
        slippageTolerance = newSlippage;
    }

    function setSwapFee(uint256 newFeeBps, address newFeeRecipient) external onlyOwner {
        require(newFeeBps <= 100, "Max 1% fee");
        emit FeeUpdated(swapFeeBps, newFeeBps);
        swapFeeBps = newFeeBps;
        feeRecipient = newFeeRecipient;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    function rescueETH() external onlyOwner {
        (bool success,) = owner().call{value: address(this).balance}("");
        require(success, "ETH transfer failed");
    }

    receive() external payable {}
}
