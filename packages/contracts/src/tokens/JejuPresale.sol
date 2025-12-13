// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title JejuPresale
 * @notice Token presale with vesting
 */
contract JejuPresale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum PresalePhase {
        NOT_STARTED,
        WHITELIST,
        PUBLIC,
        ENDED,
        FAILED,
        DISTRIBUTED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Contribution {
        uint256 ethAmount;
        uint256 tokenAllocation;
        uint256 bonusTokens;
        uint256 claimedTokens;
        uint256 contributedAt;
        bool refunded;
    }

    struct VestingSchedule {
        uint256 tgePercent;      // Percentage unlocked at TGE (basis points)
        uint256 cliffDuration;   // Cliff period in seconds
        uint256 vestingDuration; // Total vesting duration in seconds
    }

    struct PresaleConfig {
        uint256 softCap;         // Minimum ETH to raise
        uint256 hardCap;         // Maximum ETH to raise
        uint256 minContribution; // Minimum contribution per wallet
        uint256 maxContribution; // Maximum contribution per wallet
        uint256 tokenPrice;      // Price per token in wei
        uint256 whitelistStart;  // Whitelist phase start timestamp
        uint256 publicStart;     // Public phase start timestamp
        uint256 presaleEnd;      // Presale end timestamp
        uint256 tgeTimestamp;    // Token Generation Event timestamp
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable jejuToken;
    PresaleConfig public config;
    VestingSchedule public vesting;

    uint256 public totalRaised;
    uint256 public totalParticipants;
    uint256 public totalTokensSold;

    mapping(address => Contribution) public contributions;
    mapping(address => bool) public whitelist;

    address public treasury;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event ContributionReceived(address indexed contributor, uint256 ethAmount, uint256 tokenAllocation);
    event TokensClaimed(address indexed contributor, uint256 amount);
    event Refunded(address indexed contributor, uint256 amount);
    event PresaleFinalized(uint256 totalRaised, uint256 totalParticipants);
    event WhitelistUpdated(address indexed account, bool status);
    event TGEExecuted(uint256 timestamp);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error PresaleNotActive();
    error NotWhitelisted();
    error BelowMinContribution();
    error ExceedsMaxContribution();
    error HardCapReached();
    error SoftCapNotReached();
    error AlreadyRefunded();
    error NothingToClaim();
    error TGENotReached();
    error PresaleNotEnded();
    error InvalidConfig();
    error TransferFailed();
    error ZeroAddress();
    error PresaleAlreadyConfigured();
    error ZeroTokenPrice();
    error ZeroVestingDuration();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _jejuToken,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_jejuToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        jejuToken = IERC20(_jejuToken);
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════

    function configure(
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _minContribution,
        uint256 _maxContribution,
        uint256 _tokenPrice,
        uint256 _whitelistStart,
        uint256 _publicStart,
        uint256 _presaleEnd,
        uint256 _tgeTimestamp
    ) external onlyOwner {
        // Prevent reconfiguration after presale has started
        if (config.whitelistStart != 0 && block.timestamp >= config.whitelistStart) {
            revert PresaleAlreadyConfigured();
        }
        if (_tokenPrice == 0) revert ZeroTokenPrice();
        if (_softCap >= _hardCap) revert InvalidConfig();
        if (_minContribution >= _maxContribution) revert InvalidConfig();
        if (_whitelistStart >= _publicStart) revert InvalidConfig();
        if (_publicStart >= _presaleEnd) revert InvalidConfig();
        if (_presaleEnd >= _tgeTimestamp) revert InvalidConfig();

        config = PresaleConfig({
            softCap: _softCap,
            hardCap: _hardCap,
            minContribution: _minContribution,
            maxContribution: _maxContribution,
            tokenPrice: _tokenPrice,
            whitelistStart: _whitelistStart,
            publicStart: _publicStart,
            presaleEnd: _presaleEnd,
            tgeTimestamp: _tgeTimestamp
        });
    }

    function setVesting(
        uint256 _tgePercent,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) external onlyOwner {
        if (_tgePercent > 10000) revert InvalidConfig();
        // If not 100% TGE, must have vesting duration
        if (_tgePercent < 10000 && _vestingDuration == 0) revert ZeroVestingDuration();
        vesting = VestingSchedule({
            tgePercent: _tgePercent,
            cliffDuration: _cliffDuration,
            vestingDuration: _vestingDuration
        });
    }

    function setWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            whitelist[accounts[i]] = status;
            emit WhitelistUpdated(accounts[i], status);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONTRIBUTE
    // ═══════════════════════════════════════════════════════════════════════

    function contribute() external payable nonReentrant whenNotPaused {
        PresalePhase phase = currentPhase();
        if (phase != PresalePhase.WHITELIST && phase != PresalePhase.PUBLIC) {
            revert PresaleNotActive();
        }

        if (phase == PresalePhase.WHITELIST && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }

        uint256 existingContribution = contributions[msg.sender].ethAmount;
        uint256 newTotal = existingContribution + msg.value;

        if (newTotal < config.minContribution) revert BelowMinContribution();
        if (newTotal > config.maxContribution) revert ExceedsMaxContribution();
        if (totalRaised + msg.value > config.hardCap) revert HardCapReached();

        uint256 tokenAmount = (msg.value * 1e18) / config.tokenPrice;
        uint256 bonus = calculateBonus(msg.value);

        if (existingContribution == 0) {
            totalParticipants++;
        }

        contributions[msg.sender].ethAmount = newTotal;
        contributions[msg.sender].tokenAllocation += tokenAmount;
        contributions[msg.sender].bonusTokens += bonus;
        contributions[msg.sender].contributedAt = block.timestamp;

        totalRaised += msg.value;
        totalTokensSold += tokenAmount + bonus;

        emit ContributionReceived(msg.sender, msg.value, tokenAmount + bonus);
    }

    function calculateBonus(uint256 ethAmount) public view returns (uint256) {
        uint256 tokenAmount = (ethAmount * 1e18) / config.tokenPrice;
        
        // Early bird bonus during whitelist phase
        if (currentPhase() == PresalePhase.WHITELIST) {
            return (tokenAmount * 1000) / 10000; // 10% bonus
        }
        
        // Volume bonus for public phase
        if (ethAmount >= 10 ether) {
            return (tokenAmount * 500) / 10000; // 5% bonus for 10+ ETH
        }
        if (ethAmount >= 5 ether) {
            return (tokenAmount * 300) / 10000; // 3% bonus for 5+ ETH
        }
        if (ethAmount >= 1 ether) {
            return (tokenAmount * 100) / 10000; // 1% bonus for 1+ ETH
        }
        
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CLAIMING
    // ═══════════════════════════════════════════════════════════════════════

    function claim() external nonReentrant {
        if (block.timestamp < config.tgeTimestamp) revert TGENotReached();
        if (totalRaised < config.softCap) revert SoftCapNotReached();

        Contribution storage contrib = contributions[msg.sender];
        if (contrib.refunded) revert AlreadyRefunded();

        uint256 claimable = getClaimableAmount(msg.sender);
        if (claimable == 0) revert NothingToClaim();

        contrib.claimedTokens += claimable;
        jejuToken.safeTransfer(msg.sender, claimable);

        emit TokensClaimed(msg.sender, claimable);
    }

    function getClaimableAmount(address account) public view returns (uint256) {
        Contribution storage contrib = contributions[account];
        if (contrib.refunded || contrib.tokenAllocation == 0) return 0;
        if (block.timestamp < config.tgeTimestamp) return 0;

        uint256 totalAllocation = contrib.tokenAllocation + contrib.bonusTokens;
        uint256 vestedAmount = calculateVestedAmount(totalAllocation);
        
        return vestedAmount > contrib.claimedTokens ? vestedAmount - contrib.claimedTokens : 0;
    }

    function calculateVestedAmount(uint256 totalAllocation) public view returns (uint256) {
        if (block.timestamp < config.tgeTimestamp) return 0;

        // TGE unlock
        uint256 tgeUnlock = (totalAllocation * vesting.tgePercent) / 10000;
        
        // If 100% TGE or no vesting duration, return full amount
        if (vesting.tgePercent == 10000 || vesting.vestingDuration == 0) {
            return totalAllocation;
        }
        
        uint256 timeSinceTGE = block.timestamp - config.tgeTimestamp;
        
        // During cliff period, only TGE amount is available
        if (timeSinceTGE < vesting.cliffDuration) {
            return tgeUnlock;
        }

        // After cliff, linear vesting
        uint256 vestingElapsed = timeSinceTGE - vesting.cliffDuration;
        uint256 vestingAmount = totalAllocation - tgeUnlock;

        if (vestingElapsed >= vesting.vestingDuration) {
            return totalAllocation; // Fully vested
        }

        uint256 vestedFromSchedule = (vestingAmount * vestingElapsed) / vesting.vestingDuration;
        return tgeUnlock + vestedFromSchedule;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              REFUNDS
    // ═══════════════════════════════════════════════════════════════════════

    function refund() external nonReentrant {
        if (currentPhase() != PresalePhase.FAILED) revert SoftCapNotReached();

        Contribution storage contrib = contributions[msg.sender];
        if (contrib.refunded) revert AlreadyRefunded();
        if (contrib.ethAmount == 0) revert NothingToClaim();

        uint256 refundAmount = contrib.ethAmount;
        contrib.refunded = true;

        (bool success, ) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit Refunded(msg.sender, refundAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function finalize() external onlyOwner {
        if (block.timestamp < config.presaleEnd) revert PresaleNotEnded();
        if (totalRaised < config.softCap) revert SoftCapNotReached();

        // Transfer raised ETH to treasury
        (bool success, ) = treasury.call{value: address(this).balance}("");
        if (!success) revert TransferFailed();

        emit PresaleFinalized(totalRaised, totalParticipants);
    }

    function withdrawUnsoldTokens() external onlyOwner {
        if (block.timestamp < config.tgeTimestamp) revert TGENotReached();
        
        uint256 balance = jejuToken.balanceOf(address(this));
        // Safe check: only withdraw if balance exceeds sold tokens
        if (balance > totalTokensSold) {
            uint256 unsold = balance - totalTokensSold;
            jejuToken.safeTransfer(treasury, unsold);
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function currentPhase() public view returns (PresalePhase) {
        if (config.whitelistStart == 0) return PresalePhase.NOT_STARTED;
        if (block.timestamp < config.whitelistStart) return PresalePhase.NOT_STARTED;
        
        if (block.timestamp >= config.presaleEnd) {
            if (totalRaised < config.softCap) return PresalePhase.FAILED;
            if (block.timestamp >= config.tgeTimestamp) return PresalePhase.DISTRIBUTED;
            return PresalePhase.ENDED;
        }
        
        if (block.timestamp < config.publicStart) return PresalePhase.WHITELIST;
        return PresalePhase.PUBLIC;
    }

    function getContribution(address account) external view returns (
        uint256 ethAmount,
        uint256 tokenAllocation,
        uint256 bonusTokens,
        uint256 claimedTokens,
        uint256 claimable,
        bool refunded
    ) {
        Contribution storage contrib = contributions[account];
        return (
            contrib.ethAmount,
            contrib.tokenAllocation,
            contrib.bonusTokens,
            contrib.claimedTokens,
            getClaimableAmount(account),
            contrib.refunded
        );
    }

    function getPresaleStats() external view returns (
        uint256 raised,
        uint256 participants,
        uint256 tokensSold,
        uint256 softCap,
        uint256 hardCap,
        PresalePhase phase
    ) {
        return (
            totalRaised,
            totalParticipants,
            totalTokensSold,
            config.softCap,
            config.hardCap,
            currentPhase()
        );
    }

    function getTimeInfo() external view returns (
        uint256 whitelistStart,
        uint256 publicStart,
        uint256 presaleEnd,
        uint256 tgeTimestamp,
        uint256 currentTime
    ) {
        return (
            config.whitelistStart,
            config.publicStart,
            config.presaleEnd,
            config.tgeTimestamp,
            block.timestamp
        );
    }

    receive() external payable {
        revert("Use contribute()");
    }
}
