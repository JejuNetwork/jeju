// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import "./LPLocker.sol";
import {ILaunchpadXLPV2Factory, ILaunchpadXLPV2Pair, ILaunchpadWETH} from "./interfaces/ILaunchpadInterfaces.sol";

/**
 * @title ICOPresale
 * @author Jeju Network
 * @notice ICO-style presale that funds LP with raised ETH
 * @dev Key features:
 *      - Presale with configurable allocation (max 50% of supply)
 *      - Portion of raised ETH funds LP
 *      - LP tokens locked for configurable duration
 *      - Buyer tokens locked SEPARATELY from LP
 *      - Soft cap / hard cap mechanics
 *      - Refund if soft cap not met
 *
 * Token Allocation Example (1B total supply):
 * - 50% (500M) to presale buyers (locked, then vested)
 * - 20% (200M) to LP (paired with ETH)
 * - 30% (300M) to creator
 *
 * ETH Flow:
 * - 80% of raised ETH → LP
 * - 20% of raised ETH → Creator
 */
contract ICOPresale is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Contribution {
        uint256 ethAmount;
        uint256 tokenAllocation;
        uint256 claimedTokens;
        bool refunded;
    }

    struct Config {
        uint256 presaleAllocationBps;  // % of supply for presale (max 5000)
        uint256 presalePrice;           // Price per token in wei
        uint256 lpFundingBps;           // % of raised ETH going to LP
        uint256 lpLockDuration;         // How long LP tokens are locked
        uint256 buyerLockDuration;      // How long buyer tokens are locked
        uint256 softCap;                // Minimum ETH to raise
        uint256 hardCap;                // Maximum ETH to raise
        uint256 presaleDuration;        // Duration in seconds
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

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

    mapping(address => Contribution) public contributions;

    bool public finalized;
    bool public failed;
    address public lpPair;
    uint256 public buyerClaimStart; // When buyers can start claiming

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PresaleStarted(uint256 startTime, uint256 endTime);
    event ContributionReceived(address indexed contributor, uint256 ethAmount, uint256 tokenAllocation);
    event PresaleFinalized(uint256 totalRaised, address lpPair, uint256 lpTokensLocked);
    event PresaleFailed(uint256 totalRaised, uint256 softCap);
    event TokensClaimed(address indexed contributor, uint256 amount);
    event Refunded(address indexed contributor, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error PresaleNotActive();
    error PresaleNotEnded();
    error HardCapReached();
    error SoftCapNotReached();
    error AlreadyRefunded();
    error NothingToClaim();
    error NotYetClaimable();
    error AlreadyFinalized();
    error TransferFailed();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════
    //                              START PRESALE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Start the presale
     * @dev Can only be called once. Sets start/end times.
     */
    function startPresale() external {
        require(msg.sender == creator, "Only creator");
        require(presaleStart == 0, "Already started");

        // Calculate token allocations from balance
        uint256 balance = token.balanceOf(address(this));
        uint256 totalWithLP = (balance * 10000) / (config.presaleAllocationBps + 2000); // presale + 20% LP
        tokensForPresale = (totalWithLP * config.presaleAllocationBps) / 10000;
        tokensForLP = balance - tokensForPresale;

        presaleStart = block.timestamp;
        presaleEnd = block.timestamp + config.presaleDuration;

        emit PresaleStarted(presaleStart, presaleEnd);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONTRIBUTE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Contribute ETH to presale
     */
    function contribute() external payable nonReentrant whenNotPaused {
        if (block.timestamp < presaleStart || block.timestamp > presaleEnd) {
            revert PresaleNotActive();
        }
        if (totalRaised + msg.value > config.hardCap) {
            revert HardCapReached();
        }

        uint256 tokenAmount = (msg.value * 1e18) / config.presalePrice;

        if (contributions[msg.sender].ethAmount == 0) {
            totalParticipants++;
        }

        contributions[msg.sender].ethAmount += msg.value;
        contributions[msg.sender].tokenAllocation += tokenAmount;
        totalRaised += msg.value;

        emit ContributionReceived(msg.sender, msg.value, tokenAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              FINALIZE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Finalize presale and create LP
     * @dev Can only be called after presale ends
     */
    function finalize() external nonReentrant {
        if (block.timestamp < presaleEnd) revert PresaleNotEnded();
        if (finalized) revert AlreadyFinalized();

        finalized = true;

        // Check soft cap
        if (totalRaised < config.softCap) {
            failed = true;
            emit PresaleFailed(totalRaised, config.softCap);
            return;
        }

        // Calculate ETH split
        uint256 ethForLP = (totalRaised * config.lpFundingBps) / 10000;
        uint256 ethForCreator = totalRaised - ethForLP;

        // Create LP pair
        lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).getPair(address(token), weth);
        if (lpPair == address(0)) {
            lpPair = ILaunchpadXLPV2Factory(xlpV2Factory).createPair(address(token), weth);
        }

        // Wrap ETH
        ILaunchpadWETH(weth).deposit{value: ethForLP}();

        // Transfer to LP
        token.safeTransfer(lpPair, tokensForLP);
        ILaunchpadWETH(weth).transfer(lpPair, ethForLP);

        // Mint LP tokens to locker
        uint256 lpTokens = ILaunchpadXLPV2Pair(lpPair).mint(address(lpLocker));

        // Lock LP tokens
        lpLocker.lock(
            IERC20(lpPair),
            lpTokens,
            creator,
            config.lpLockDuration
        );

        // Transfer remaining ETH to creator
        if (ethForCreator > 0) {
            (bool success,) = creator.call{value: ethForCreator}("");
            if (!success) revert TransferFailed();
        }

        // Set buyer claim start time (after lock duration)
        buyerClaimStart = block.timestamp + config.buyerLockDuration;

        emit PresaleFinalized(totalRaised, lpPair, lpTokens);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CLAIM / REFUND
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim tokens after lock period
     */
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

    /**
     * @notice Get refund if presale failed
     */
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

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getContribution(address contributor) external view returns (
        uint256 ethAmount,
        uint256 tokenAllocation,
        uint256 claimedTokens,
        uint256 claimable,
        bool isRefunded
    ) {
        Contribution storage c = contributions[contributor];
        ethAmount = c.ethAmount;
        tokenAllocation = c.tokenAllocation;
        claimedTokens = c.claimedTokens;
        claimable = block.timestamp >= buyerClaimStart ? c.tokenAllocation - c.claimedTokens : 0;
        isRefunded = c.refunded;
    }

    function getStatus() external view returns (
        uint256 raised,
        uint256 participants,
        uint256 progress,
        uint256 timeRemaining,
        bool isActive,
        bool isFinalized,
        bool isFailed
    ) {
        raised = totalRaised;
        participants = totalParticipants;
        progress = config.hardCap > 0 ? (totalRaised * 10000) / config.hardCap : 0;
        timeRemaining = block.timestamp < presaleEnd ? presaleEnd - block.timestamp : 0;
        isActive = block.timestamp >= presaleStart && block.timestamp <= presaleEnd;
        isFinalized = finalized;
        isFailed = failed;
    }

    receive() external payable {}
}
