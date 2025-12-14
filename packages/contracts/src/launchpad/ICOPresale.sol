// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import "./LPLocker.sol";
import {ILaunchpadXLPV2Factory, ILaunchpadXLPV2Pair, ILaunchpadWETH} from "./interfaces/ILaunchpadInterfaces.sol";

/// @title ICOPresale
/// @notice ICO-style presale that funds LP with raised ETH
/// @dev Buyer tokens locked separately from LP. Refund if soft cap not met.
contract ICOPresale is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Contribution {
        uint256 ethAmount;
        uint256 tokenAllocation;
        uint256 claimedTokens;
        bool refunded;
    }

    struct Config {
        uint256 presaleAllocationBps;
        uint256 presalePrice;
        uint256 lpFundingBps;
        uint256 lpLockDuration;
        uint256 buyerLockDuration;
        uint256 softCap;
        uint256 hardCap;
        uint256 presaleDuration;
    }

    IERC20 public immutable token;
    address public immutable creator;
    address public immutable xlpV2Factory;
    address public immutable weth;
    LPLocker public immutable lpLocker;

    Config public config;
    uint256 public presaleStart;
    uint256 public presaleEnd;
    uint256 public totalRaised;
    uint256 public totalParticipants;
    uint256 public tokensForPresale;
    uint256 public tokensForLP;
    bool public finalized;
    bool public failed;
    address public lpPair;
    uint256 public buyerClaimStart;

    mapping(address => Contribution) public contributions;

    event PresaleStarted(uint256 startTime, uint256 endTime);
    event ContributionReceived(address indexed contributor, uint256 ethAmount, uint256 tokenAllocation);
    event PresaleFinalized(uint256 totalRaised, address lpPair, uint256 lpTokensLocked);
    event PresaleFailed(uint256 totalRaised, uint256 softCap);
    event TokensClaimed(address indexed contributor, uint256 amount);
    event Refunded(address indexed contributor, uint256 amount);

    error PresaleNotActive();
    error PresaleNotEnded();
    error HardCapReached();
    error SoftCapNotReached();
    error AlreadyRefunded();
    error NothingToClaim();
    error NotYetClaimable();
    error AlreadyFinalized();
    error TransferFailed();

    constructor(
        address _token,
        address _creator,
        address _xlpV2Factory,
        address _weth,
        address _lpLocker,
        Config memory _config
    ) {
        token = IERC20(_token);
        creator = _creator;
        xlpV2Factory = _xlpV2Factory;
        weth = _weth;
        lpLocker = LPLocker(_lpLocker);
        config = _config;
    }

    function startPresale() external {
        require(msg.sender == creator, "Only creator");
        require(presaleStart == 0, "Already started");

        uint256 balance = token.balanceOf(address(this));
        uint256 totalWithLP = (balance * 10000) / (config.presaleAllocationBps + 2000);
        tokensForPresale = (totalWithLP * config.presaleAllocationBps) / 10000;
        tokensForLP = balance - tokensForPresale;

        presaleStart = block.timestamp;
        presaleEnd = block.timestamp + config.presaleDuration;
        emit PresaleStarted(presaleStart, presaleEnd);
    }

    function contribute() external payable nonReentrant whenNotPaused {
        if (block.timestamp < presaleStart || block.timestamp > presaleEnd) revert PresaleNotActive();
        if (totalRaised + msg.value > config.hardCap) revert HardCapReached();

        uint256 tokenAmount = (msg.value * 1e18) / config.presalePrice;
        if (contributions[msg.sender].ethAmount == 0) totalParticipants++;

        contributions[msg.sender].ethAmount += msg.value;
        contributions[msg.sender].tokenAllocation += tokenAmount;
        totalRaised += msg.value;

        emit ContributionReceived(msg.sender, msg.value, tokenAmount);
    }

    function finalize() external nonReentrant {
        if (block.timestamp < presaleEnd) revert PresaleNotEnded();
        if (finalized) revert AlreadyFinalized();
        finalized = true;

        if (totalRaised < config.softCap) {
            failed = true;
            emit PresaleFailed(totalRaised, config.softCap);
            return;
        }

        uint256 ethForLP = (totalRaised * config.lpFundingBps) / 10000;
        uint256 ethForCreator = totalRaised - ethForLP;

        lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).getPair(address(token), weth);
        if (lpPair == address(0)) {
            lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).createPair(address(token), weth);
        }

        ILaunchpadWETH(weth).deposit{value: ethForLP}();
        token.safeTransfer(lpPair, tokensForLP);
        require(ILaunchpadWETH(weth).transfer(lpPair, ethForLP), "WETH transfer failed");

        uint256 lpTokens = ILaunchpadXLPV2Pair(lpPair).mint(address(this));
        IERC20(lpPair).approve(address(lpLocker), lpTokens);
        lpLocker.lock(IERC20(lpPair), lpTokens, creator, config.lpLockDuration);

        if (ethForCreator > 0) {
            (bool success,) = creator.call{value: ethForCreator}("");
            if (!success) revert TransferFailed();
        }

        buyerClaimStart = block.timestamp + config.buyerLockDuration;
        emit PresaleFinalized(totalRaised, lpPair, lpTokens);
    }

    function claim() external nonReentrant {
        require(finalized && !failed, "Not finalized or failed");
        if (block.timestamp < buyerClaimStart) revert NotYetClaimable();

        Contribution storage contrib = contributions[msg.sender];
        if (contrib.refunded) revert AlreadyRefunded();

        uint256 claimable = contrib.tokenAllocation - contrib.claimedTokens;
        if (claimable == 0) revert NothingToClaim();

        contrib.claimedTokens = contrib.tokenAllocation;
        token.safeTransfer(msg.sender, claimable);
        emit TokensClaimed(msg.sender, claimable);
    }

    function refund() external nonReentrant {
        require(finalized && failed, "Not failed");

        Contribution storage contrib = contributions[msg.sender];
        if (contrib.refunded) revert AlreadyRefunded();
        if (contrib.ethAmount == 0) revert NothingToClaim();

        uint256 refundAmount = contrib.ethAmount;
        contrib.refunded = true;

        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();
        emit Refunded(msg.sender, refundAmount);
    }

    function getContribution(address contributor)
        external
        view
        returns (uint256 ethAmount, uint256 tokenAllocation, uint256 claimedTokens, uint256 claimable, bool isRefunded)
    {
        Contribution storage c = contributions[contributor];
        return (
            c.ethAmount,
            c.tokenAllocation,
            c.claimedTokens,
            block.timestamp >= buyerClaimStart ? c.tokenAllocation - c.claimedTokens : 0,
            c.refunded
        );
    }

    function getStatus()
        external
        view
        returns (
            uint256 raised,
            uint256 participants,
            uint256 progress,
            uint256 timeRemaining,
            bool isActive,
            bool isFinalized,
            bool isFailed
        )
    {
        return (
            totalRaised,
            totalParticipants,
            config.hardCap > 0 ? (totalRaised * 10000) / config.hardCap : 0,
            block.timestamp < presaleEnd ? presaleEnd - block.timestamp : 0,
            block.timestamp >= presaleStart && block.timestamp <= presaleEnd,
            finalized,
            failed
        );
    }

    receive() external payable {}
}
