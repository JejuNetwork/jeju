// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ILaunchpadXLPV2Factory, ILaunchpadXLPV2Pair, ILaunchpadWETH} from "./interfaces/ILaunchpadInterfaces.sol";

/**
 * @title BondingCurve
 * @author Jeju Network
 * @notice Pump.fun style bonding curve with graduation to AMM LP
 * @dev Implements virtual x*y=k constant product curve
 *
 * How it works:
 * 1. Token launches with virtual ETH reserves (determines initial price)
 * 2. Users buy tokens with ETH, price increases along curve
 * 3. Users can sell tokens back, price decreases
 * 4. When real ETH reaches graduation target, curve graduates
 * 5. On graduation: tokens + ETH migrate to XLP V2 LP pair
 * 6. LP tokens are locked permanently or sent to creator
 *
 * Price Formula (constant product):
 * - virtualEth * virtualTokens = k (constant)
 * - Price increases as more tokens are bought
 * - Price = virtualEth / virtualTokens
 *
 * No fees on bonding curve (100% goes to the curve)
 * Fees are only on the graduated LP via XLP V2
 */
contract BondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Token being sold on this curve
    IERC20 public immutable token;

    /// @notice XLP V2 Factory for creating LP on graduation
    address public immutable xlpV2Factory;

    /// @notice WETH address for LP pairing
    address public immutable weth;

    /// @notice Launchpad that created this curve
    address public immutable launchpad;

    /// @notice Virtual ETH reserves (never depleted, only increased)
    uint256 public virtualEthReserves;

    /// @notice Virtual token reserves (decreased on buys, increased on sells)
    uint256 public virtualTokenReserves;

    /// @notice Real ETH collected from buys
    uint256 public realEthReserves;

    /// @notice Real tokens available for sale
    uint256 public realTokenReserves;

    /// @notice ETH threshold to trigger graduation
    uint256 public immutable graduationTarget;

    /// @notice Initial virtual ETH (for price calculations)
    uint256 public immutable initialVirtualEth;

    /// @notice Total token supply held by curve at launch
    uint256 public immutable totalTokenSupply;

    /// @notice Whether the curve has graduated to LP
    bool public graduated;

    /// @notice LP pair address (set on graduation)
    address public lpPair;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Buy(
        address indexed buyer,
        uint256 ethIn,
        uint256 tokensOut,
        uint256 newPrice
    );

    event Sell(
        address indexed seller,
        uint256 tokensIn,
        uint256 ethOut,
        uint256 newPrice
    );

    event Graduated(
        address indexed lpPair,
        uint256 ethLiquidity,
        uint256 tokenLiquidity,
        uint256 lpTokensMinted
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error AlreadyGraduated();
    error NotGraduated();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error TransferFailed();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _token,
        uint256 _virtualEthReserves,
        uint256 _graduationTarget,
        address _launchpad,
        address _xlpV2Factory,
        address _weth
    ) {
        token = IERC20(_token);
        virtualEthReserves = _virtualEthReserves;
        initialVirtualEth = _virtualEthReserves;
        graduationTarget = _graduationTarget;
        launchpad = _launchpad;
        xlpV2Factory = _xlpV2Factory;
        weth = _weth;

        // Token supply will be set when tokens are transferred in
        totalTokenSupply = 0; // Set in initialize or derived from balance
    }

    /**
     * @notice Initialize curve with token balance
     * @dev Called after tokens are transferred to this contract
     */
    function initialize() external {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens");
        require(virtualTokenReserves == 0, "Already initialized");
        
        virtualTokenReserves = balance;
        realTokenReserves = balance;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              BUY / SELL
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Buy tokens with ETH
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @return tokensOut Amount of tokens received
     */
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (graduated) revert AlreadyGraduated();
        require(msg.value > 0, "No ETH sent");

        // Calculate tokens out using constant product formula
        // (virtualEth + ethIn) * (virtualTokens - tokensOut) = k
        // k = virtualEth * virtualTokens
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualEth = virtualEthReserves + msg.value;
        uint256 newVirtualTokens = k / newVirtualEth;
        tokensOut = virtualTokenReserves - newVirtualTokens;

        if (tokensOut < minTokensOut) revert InsufficientOutput();
        if (tokensOut > realTokenReserves) revert InsufficientLiquidity();

        // Update state
        virtualEthReserves = newVirtualEth;
        virtualTokenReserves = newVirtualTokens;
        realEthReserves += msg.value;
        realTokenReserves -= tokensOut;

        // Transfer tokens to buyer
        token.safeTransfer(msg.sender, tokensOut);

        emit Buy(msg.sender, msg.value, tokensOut, getCurrentPrice());

        // Check for graduation
        if (realEthReserves >= graduationTarget) {
            _graduate();
        }
    }

    /**
     * @notice Sell tokens for ETH
     * @param tokensIn Amount of tokens to sell
     * @param minEthOut Minimum ETH to receive (slippage protection)
     * @return ethOut Amount of ETH received
     */
    function sell(uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (graduated) revert AlreadyGraduated();
        require(tokensIn > 0, "No tokens");

        // Transfer tokens from seller first
        token.safeTransferFrom(msg.sender, address(this), tokensIn);

        // Calculate ETH out using constant product formula
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualTokens = virtualTokenReserves + tokensIn;
        uint256 newVirtualEth = k / newVirtualTokens;
        ethOut = virtualEthReserves - newVirtualEth;

        if (ethOut < minEthOut) revert InsufficientOutput();
        if (ethOut > realEthReserves) revert InsufficientLiquidity();

        // Update state
        virtualEthReserves = newVirtualEth;
        virtualTokenReserves = newVirtualTokens;
        realEthReserves -= ethOut;
        realTokenReserves += tokensIn;

        // Transfer ETH to seller
        (bool success,) = msg.sender.call{value: ethOut}("");
        if (!success) revert TransferFailed();

        emit Sell(msg.sender, tokensIn, ethOut, getCurrentPrice());
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              GRADUATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Graduate curve to AMM LP
     * @dev Called automatically when graduation target is reached
     *      Migrates all ETH and remaining tokens to XLP V2 LP
     */
    function _graduate() internal {
        graduated = true;

        uint256 ethForLP = realEthReserves;
        uint256 tokensForLP = realTokenReserves;

        // Create or get LP pair
        lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).getPair(address(token), weth);
        if (lpPair == address(0)) {
            lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).createPair(address(token), weth);
        }

        // Wrap ETH to WETH
        ILaunchpadWETH(weth).deposit{value: ethForLP}();

        // Transfer tokens and WETH to pair
        token.safeTransfer(lpPair, tokensForLP);
        ILaunchpadWETH(weth).transfer(lpPair, ethForLP);

        // Mint LP tokens to this contract (can be claimed by launchpad)
        uint256 lpTokens = ILaunchpadXLPV2Pair(lpPair).mint(address(this));

        // Reset reserves
        realEthReserves = 0;
        realTokenReserves = 0;

        emit Graduated(lpPair, ethForLP, tokensForLP, lpTokens);
    }

    /**
     * @notice Force graduation (can be called by launchpad if target reached)
     */
    function graduate() external {
        require(msg.sender == launchpad, "Only launchpad");
        require(realEthReserves >= graduationTarget, "Target not reached");
        if (graduated) revert AlreadyGraduated();
        _graduate();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get current token price in ETH (wei per token)
     */
    function getCurrentPrice() public view returns (uint256) {
        if (virtualTokenReserves == 0) return 0;
        return (virtualEthReserves * 1e18) / virtualTokenReserves;
    }

    /**
     * @notice Calculate tokens out for ETH in
     */
    function getTokensOut(uint256 ethIn) external view returns (uint256) {
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualEth = virtualEthReserves + ethIn;
        uint256 newVirtualTokens = k / newVirtualEth;
        return virtualTokenReserves - newVirtualTokens;
    }

    /**
     * @notice Calculate ETH out for tokens in
     */
    function getEthOut(uint256 tokensIn) external view returns (uint256) {
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualTokens = virtualTokenReserves + tokensIn;
        uint256 newVirtualEth = k / newVirtualTokens;
        return virtualEthReserves - newVirtualEth;
    }

    /**
     * @notice Get graduation progress (0-10000 basis points)
     */
    function getProgress() external view returns (uint256) {
        if (graduated) return 10000;
        return (realEthReserves * 10000) / graduationTarget;
    }

    /**
     * @notice Get curve statistics
     */
    function getStats() external view returns (
        uint256 price,
        uint256 progress,
        uint256 ethCollected,
        uint256 tokensRemaining,
        bool isGraduated
    ) {
        price = getCurrentPrice();
        progress = graduated ? 10000 : (realEthReserves * 10000) / graduationTarget;
        ethCollected = realEthReserves;
        tokensRemaining = realTokenReserves;
        isGraduated = graduated;
    }

    /**
     * @notice Get market cap in ETH
     */
    function getMarketCap() external view returns (uint256) {
        uint256 totalSupply = token.totalSupply();
        return (getCurrentPrice() * totalSupply) / 1e18;
    }

    receive() external payable {}
}
