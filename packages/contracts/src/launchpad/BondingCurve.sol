// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ILaunchpadXLPV2Factory, ILaunchpadXLPV2Pair, ILaunchpadWETH} from "./interfaces/ILaunchpadInterfaces.sol";

/// @title BondingCurve
/// @notice Pump.fun style bonding curve with graduation to AMM LP
/// @dev Virtual x*y=k constant product curve. Graduates to LP when target reached.
contract BondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable xlpV2Factory;
    address public immutable weth;
    address public immutable launchpad;
    uint256 public immutable graduationTarget;
    uint256 public immutable initialVirtualEth;
    uint256 public immutable totalTokenSupply;

    uint256 public virtualEthReserves;
    uint256 public virtualTokenReserves;
    uint256 public realEthReserves;
    uint256 public realTokenReserves;
    bool public graduated;
    address public lpPair;

    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 newPrice);
    event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 newPrice);
    event Graduated(address indexed lpPair, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 lpTokensMinted);

    error AlreadyGraduated();
    error NotGraduated();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error TransferFailed();

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
        totalTokenSupply = 0;
    }

    function initialize() external {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens");
        require(virtualTokenReserves == 0, "Already initialized");
        virtualTokenReserves = balance;
        realTokenReserves = balance;
    }

    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (graduated) revert AlreadyGraduated();
        require(msg.value > 0, "No ETH sent");

        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualEth = virtualEthReserves + msg.value;
        uint256 newVirtualTokens = k / newVirtualEth;
        tokensOut = virtualTokenReserves - newVirtualTokens;

        if (tokensOut < minTokensOut) revert InsufficientOutput();
        if (tokensOut > realTokenReserves) revert InsufficientLiquidity();

        virtualEthReserves = newVirtualEth;
        virtualTokenReserves = newVirtualTokens;
        realEthReserves += msg.value;
        realTokenReserves -= tokensOut;

        token.safeTransfer(msg.sender, tokensOut);
        emit Buy(msg.sender, msg.value, tokensOut, getCurrentPrice());

        if (realEthReserves >= graduationTarget) _graduate();
    }

    function sell(uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (graduated) revert AlreadyGraduated();
        require(tokensIn > 0, "No tokens");

        token.safeTransferFrom(msg.sender, address(this), tokensIn);

        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualTokens = virtualTokenReserves + tokensIn;
        uint256 newVirtualEth = k / newVirtualTokens;
        ethOut = virtualEthReserves - newVirtualEth;

        if (ethOut < minEthOut) revert InsufficientOutput();
        if (ethOut > realEthReserves) revert InsufficientLiquidity();

        virtualEthReserves = newVirtualEth;
        virtualTokenReserves = newVirtualTokens;
        realEthReserves -= ethOut;
        realTokenReserves += tokensIn;

        (bool success,) = msg.sender.call{value: ethOut}("");
        if (!success) revert TransferFailed();

        emit Sell(msg.sender, tokensIn, ethOut, getCurrentPrice());
    }

    function _graduate() internal {
        graduated = true;
        uint256 ethForLP = realEthReserves;
        uint256 tokensForLP = realTokenReserves;

        lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).getPair(address(token), weth);
        if (lpPair == address(0)) {
            lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).createPair(address(token), weth);
        }

        ILaunchpadWETH(weth).deposit{value: ethForLP}();
        token.safeTransfer(lpPair, tokensForLP);
        require(ILaunchpadWETH(weth).transfer(lpPair, ethForLP), "WETH transfer failed");

        uint256 lpTokens = ILaunchpadXLPV2Pair(lpPair).mint(address(this));
        realEthReserves = 0;
        realTokenReserves = 0;

        emit Graduated(lpPair, ethForLP, tokensForLP, lpTokens);
    }

    function graduate() external {
        require(msg.sender == launchpad, "Only launchpad");
        require(realEthReserves >= graduationTarget, "Target not reached");
        if (graduated) revert AlreadyGraduated();
        _graduate();
    }

    function getCurrentPrice() public view returns (uint256) {
        if (virtualTokenReserves == 0) return 0;
        return (virtualEthReserves * 1e18) / virtualTokenReserves;
    }

    function getTokensOut(uint256 ethIn) external view returns (uint256) {
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualEth = virtualEthReserves + ethIn;
        return virtualTokenReserves - (k / newVirtualEth);
    }

    function getEthOut(uint256 tokensIn) external view returns (uint256) {
        uint256 k = virtualEthReserves * virtualTokenReserves;
        uint256 newVirtualTokens = virtualTokenReserves + tokensIn;
        return virtualEthReserves - (k / newVirtualTokens);
    }

    function getProgress() external view returns (uint256) {
        if (graduated) return 10000;
        return (realEthReserves * 10000) / graduationTarget;
    }

    function getStats() external view returns (
        uint256 price, uint256 progress, uint256 ethCollected, uint256 tokensRemaining, bool isGraduated
    ) {
        return (getCurrentPrice(), graduated ? 10000 : (realEthReserves * 10000) / graduationTarget,
            realEthReserves, realTokenReserves, graduated);
    }

    function getMarketCap() external view returns (uint256) {
        return (getCurrentPrice() * token.totalSupply()) / 1e18;
    }

    receive() external payable {}
}
