// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Presale
 * @author Jeju Network
 * @notice Universal presale contract supporting fixed price and CCA (Continuous Clearing Auction)
 * @dev
 * Modes:
 * 1. Fixed Price: Traditional presale with set token price
 * 2. CCA Auction: Reverse Dutch auction where price decays, all pay clearing price
 *
 * Features:
 * - Whitelist/early bird phase with bonus
 * - Volume-based bonuses
 * - Holder bonuses (e.g., existing token holders get multiplier)
 * - Vesting with TGE unlock, cliff, and linear vesting
 * - Cross-chain contribution support
 * - Refund mechanism for failed presales
 */
contract Presale is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum PresaleMode {
        FIXED_PRICE,
        CCA_AUCTION
    }

    enum Phase {
        NOT_STARTED,
        WHITELIST,
        PUBLIC,
        ENDED,
        CLEARING, // CCA only: price being determined
        DISTRIBUTION,
        FAILED
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    struct Config {
        PresaleMode mode;
        uint256 totalTokens; // Total tokens for sale
        uint256 softCap; // Minimum ETH to raise
        uint256 hardCap; // Maximum ETH to raise
        uint256 minContribution;
        uint256 maxContribution;
        uint256 tokenPrice; // Fixed price mode: wei per token
        uint256 startPrice; // CCA: starting price
        uint256 reservePrice; // CCA: minimum price floor
        uint256 priceDecayPerBlock; // CCA: price decrease per block
        uint256 whitelistStart;
        uint256 publicStart;
        uint256 presaleEnd;
        uint256 tgeTimestamp;
    }

    struct VestingConfig {
        uint256 tgeUnlockBps; // % unlocked at TGE (basis points)
        uint256 cliffDuration; // Cliff period in seconds
        uint256 vestingDuration; // Total vesting after cliff
    }

    struct BonusConfig {
        uint256 whitelistBonusBps; // Bonus for whitelist participants
        uint256 holderBonusBps; // Bonus for qualifying holders
        uint256 volume1EthBonusBps; // Bonus for 1+ ETH
        uint256 volume5EthBonusBps; // Bonus for 5+ ETH
        uint256 volume10EthBonusBps; // Bonus for 10+ ETH
        address holderToken; // Token to check for holder bonus
        uint256 holderMinBalance; // Minimum balance for holder bonus
    }

    struct Contribution {
        uint256 ethAmount;
        uint256 maxPrice; // CCA: max price willing to pay
        uint256 tokenAllocation;
        uint256 bonusTokens;
        uint256 claimedTokens;
        uint256 refundAmount;
        uint256 timestamp;
        bool isWhitelisted;
        bool isHolder;
        bool claimed;
        bool refunded;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════════

    IERC20 public immutable token;
    Config public config;
    VestingConfig public vesting;
    BonusConfig public bonuses;

    uint256 public totalRaised;
    uint256 public totalParticipants;
    uint256 public totalTokensSold;
    uint256 public clearingPrice; // CCA: final price

    address public treasury;
    address public crossChainVerifier;

    mapping(address => Contribution) public contributions;
    mapping(address => bool) public whitelist;
    mapping(uint32 => bool) public supportedChains;
    mapping(uint32 => mapping(bytes32 => bool)) public processedMessages;

    // ═══════════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event ContributionReceived(address indexed contributor, uint256 ethAmount, uint256 tokenAmount, uint256 bonus);
    event ClearingPriceSet(uint256 price, uint256 totalAllocated);
    event TokensClaimed(address indexed contributor, uint256 amount);
    event RefundClaimed(address indexed contributor, uint256 amount);
    event Finalized(uint256 totalRaised, uint256 totalParticipants);
    event WhitelistUpdated(address indexed account, bool status);
    event CrossChainContribution(uint32 indexed chain, bytes32 messageId, address bidder, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error NotActive();
    error NotWhitelisted();
    error BelowMin();
    error ExceedsMax();
    error HardCapReached();
    error SoftCapNotReached();
    error AlreadyClaimed();
    error AlreadyRefunded();
    error NothingToClaim();
    error TGENotReached();
    error NotEnded();
    error InvalidConfig();
    error TransferFailed();
    error NotCleared();
    error AlreadyCleared();
    error PriceTooLow();
    error OnlyVerifier();
    error UnsupportedChain();
    error MessageAlreadyProcessed();

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address _token, address _treasury, address _owner) Ownable(_owner) {
        token = IERC20(_token);
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    function configure(
        PresaleMode _mode,
        uint256 _totalTokens,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _minContribution,
        uint256 _maxContribution,
        uint256 _tokenPrice,
        uint256 _startPrice,
        uint256 _reservePrice,
        uint256 _priceDecayPerBlock,
        uint256 _whitelistStart,
        uint256 _publicStart,
        uint256 _presaleEnd,
        uint256 _tgeTimestamp
    ) external onlyOwner {
        if (config.whitelistStart != 0 && block.timestamp >= config.whitelistStart) revert InvalidConfig();
        if (_softCap >= _hardCap) revert InvalidConfig();
        if (_minContribution >= _maxContribution) revert InvalidConfig();
        if (_whitelistStart >= _publicStart) revert InvalidConfig();
        if (_publicStart >= _presaleEnd) revert InvalidConfig();
        if (_presaleEnd >= _tgeTimestamp) revert InvalidConfig();

        if (_mode == PresaleMode.FIXED_PRICE && _tokenPrice == 0) revert InvalidConfig();
        if (_mode == PresaleMode.CCA_AUCTION && _startPrice <= _reservePrice) revert InvalidConfig();

        config = Config({
            mode: _mode,
            totalTokens: _totalTokens,
            softCap: _softCap,
            hardCap: _hardCap,
            minContribution: _minContribution,
            maxContribution: _maxContribution,
            tokenPrice: _tokenPrice,
            startPrice: _startPrice,
            reservePrice: _reservePrice,
            priceDecayPerBlock: _priceDecayPerBlock,
            whitelistStart: _whitelistStart,
            publicStart: _publicStart,
            presaleEnd: _presaleEnd,
            tgeTimestamp: _tgeTimestamp
        });
    }

    function setVesting(uint256 _tgeUnlockBps, uint256 _cliffDuration, uint256 _vestingDuration) external onlyOwner {
        if (_tgeUnlockBps > 10000) revert InvalidConfig();
        if (_tgeUnlockBps < 10000 && _vestingDuration == 0) revert InvalidConfig();
        vesting = VestingConfig(_tgeUnlockBps, _cliffDuration, _vestingDuration);
    }

    function setBonuses(
        uint256 _whitelistBps,
        uint256 _holderBps,
        uint256 _vol1Bps,
        uint256 _vol5Bps,
        uint256 _vol10Bps,
        address _holderToken,
        uint256 _holderMinBalance
    ) external onlyOwner {
        bonuses = BonusConfig(_whitelistBps, _holderBps, _vol1Bps, _vol5Bps, _vol10Bps, _holderToken, _holderMinBalance);
    }

    function setWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            whitelist[accounts[i]] = status;
            emit WhitelistUpdated(accounts[i], status);
        }
    }

    function setSupportedChain(uint32 chainId, bool supported) external onlyOwner {
        supportedChains[chainId] = supported;
    }

    function setCrossChainVerifier(address _verifier) external onlyOwner {
        crossChainVerifier = _verifier;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CONTRIBUTE
    // ═══════════════════════════════════════════════════════════════════════════

    function contribute() external payable nonReentrant whenNotPaused {
        _contribute(msg.sender, msg.value, 0);
    }

    function contributeWithMaxPrice(uint256 maxPrice) external payable nonReentrant whenNotPaused {
        _contribute(msg.sender, msg.value, maxPrice);
    }

    function processCrossChainContribution(
        uint32 sourceChain,
        bytes32 messageId,
        address contributor,
        uint256 ethAmount,
        uint256 maxPrice
    ) external nonReentrant {
        if (msg.sender != crossChainVerifier && msg.sender != owner()) revert OnlyVerifier();
        if (!supportedChains[sourceChain]) revert UnsupportedChain();
        if (processedMessages[sourceChain][messageId]) revert MessageAlreadyProcessed();

        processedMessages[sourceChain][messageId] = true;
        _contribute(contributor, ethAmount, maxPrice);
        emit CrossChainContribution(sourceChain, messageId, contributor, ethAmount);
    }

    function _contribute(address contributor, uint256 ethAmount, uint256 maxPrice) internal {
        Phase phase = currentPhase();
        if (phase != Phase.WHITELIST && phase != Phase.PUBLIC) revert NotActive();
        if (phase == Phase.WHITELIST && !whitelist[contributor]) revert NotWhitelisted();

        Contribution storage c = contributions[contributor];
        uint256 newTotal = c.ethAmount + ethAmount;

        if (newTotal < config.minContribution) revert BelowMin();
        if (newTotal > config.maxContribution) revert ExceedsMax();
        if (totalRaised + ethAmount > config.hardCap) revert HardCapReached();

        // CCA: validate max price
        if (config.mode == PresaleMode.CCA_AUCTION && maxPrice > 0 && maxPrice < config.reservePrice) {
            revert PriceTooLow();
        }

        // Check holder status
        bool isHolder = false;
        if (bonuses.holderToken != address(0) && bonuses.holderMinBalance > 0) {
            isHolder = IERC20(bonuses.holderToken).balanceOf(contributor) >= bonuses.holderMinBalance;
        }

        if (c.ethAmount == 0) {
            totalParticipants++;
            c.timestamp = block.timestamp;
            c.isWhitelisted = whitelist[contributor];
            c.isHolder = isHolder;
        }

        // Calculate tokens for fixed price mode
        if (config.mode == PresaleMode.FIXED_PRICE) {
            uint256 tokenAmount = (ethAmount * 1e18) / config.tokenPrice;
            uint256 calculatedBonus = _calculateBonus(ethAmount, tokenAmount, phase == Phase.WHITELIST, isHolder);
            c.tokenAllocation += tokenAmount;
            c.bonusTokens += calculatedBonus;
            totalTokensSold += tokenAmount + calculatedBonus;
        }

        c.ethAmount = newTotal;
        c.maxPrice = maxPrice;
        totalRaised += ethAmount;

        uint256 emitBonus = config.mode == PresaleMode.FIXED_PRICE ? c.bonusTokens : 0;
        emit ContributionReceived(contributor, ethAmount, c.tokenAllocation, emitBonus);
    }

    function _calculateBonus(uint256 ethAmount, uint256 tokenAmount, bool isWhitelist, bool isHolder)
        internal
        view
        returns (uint256 bonus)
    {
        if (isWhitelist && bonuses.whitelistBonusBps > 0) {
            bonus += (tokenAmount * bonuses.whitelistBonusBps) / 10000;
        }
        if (isHolder && bonuses.holderBonusBps > 0) {
            bonus += (tokenAmount * bonuses.holderBonusBps) / 10000;
        }

        // Volume bonuses
        if (ethAmount >= 10 ether && bonuses.volume10EthBonusBps > 0) {
            bonus += (tokenAmount * bonuses.volume10EthBonusBps) / 10000;
        } else if (ethAmount >= 5 ether && bonuses.volume5EthBonusBps > 0) {
            bonus += (tokenAmount * bonuses.volume5EthBonusBps) / 10000;
        } else if (ethAmount >= 1 ether && bonuses.volume1EthBonusBps > 0) {
            bonus += (tokenAmount * bonuses.volume1EthBonusBps) / 10000;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CCA CLEARING
    // ═══════════════════════════════════════════════════════════════════════════

    function setClearingPrice(uint256 _clearingPrice, address[] calldata contributors) external onlyOwner {
        if (config.mode != PresaleMode.CCA_AUCTION) revert InvalidConfig();
        if (block.timestamp < config.presaleEnd) revert NotEnded();
        if (clearingPrice != 0) revert AlreadyCleared();
        if (_clearingPrice < config.reservePrice) revert PriceTooLow();

        clearingPrice = _clearingPrice;

        for (uint256 i = 0; i < contributors.length; i++) {
            _calculateCCAAllocation(contributors[i]);
        }

        emit ClearingPriceSet(_clearingPrice, totalTokensSold);
    }

    function calculateCCAAllocation(address contributor) external {
        if (clearingPrice == 0) revert NotCleared();
        _calculateCCAAllocation(contributor);
    }

    function _calculateCCAAllocation(address contributor) internal {
        Contribution storage c = contributions[contributor];
        if (c.ethAmount == 0 || c.tokenAllocation > 0) return;

        // Skip if max price below clearing
        if (c.maxPrice > 0 && c.maxPrice < clearingPrice) {
            c.refundAmount = c.ethAmount;
            return;
        }

        uint256 baseAllocation = (c.ethAmount * 1e18) / clearingPrice;
        uint256 bonus = _calculateBonus(c.ethAmount, baseAllocation, c.isWhitelisted, c.isHolder);
        uint256 totalAllocation = baseAllocation + bonus;

        // Cap at remaining tokens
        uint256 remaining = config.totalTokens - totalTokensSold;
        if (totalAllocation > remaining) {
            totalAllocation = remaining;
            bonus = totalAllocation > baseAllocation ? totalAllocation - baseAllocation : 0;
            baseAllocation = totalAllocation - bonus;

            // Calculate refund
            uint256 usedEth = (baseAllocation * clearingPrice) / 1e18;
            c.refundAmount = c.ethAmount > usedEth ? c.ethAmount - usedEth : 0;
        }

        c.tokenAllocation = baseAllocation;
        c.bonusTokens = bonus;
        totalTokensSold += totalAllocation;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CLAIMING
    // ═══════════════════════════════════════════════════════════════════════════

    function claim() external nonReentrant {
        if (block.timestamp < config.tgeTimestamp) revert TGENotReached();
        if (config.mode == PresaleMode.CCA_AUCTION && clearingPrice == 0) revert NotCleared();
        if (totalRaised < config.softCap) revert SoftCapNotReached();

        Contribution storage c = contributions[msg.sender];
        if (c.claimed) revert AlreadyClaimed();

        uint256 claimable = getClaimableAmount(msg.sender);
        if (claimable == 0) revert NothingToClaim();

        c.claimedTokens += claimable;
        if (c.claimedTokens >= c.tokenAllocation + c.bonusTokens) {
            c.claimed = true;
        }

        token.safeTransfer(msg.sender, claimable);
        emit TokensClaimed(msg.sender, claimable);
    }

    function claimRefund() external nonReentrant {
        if (config.mode == PresaleMode.CCA_AUCTION && clearingPrice == 0) revert NotCleared();

        Phase phase = currentPhase();
        Contribution storage c = contributions[msg.sender];

        // Can refund if: failed presale OR has refund from CCA
        bool canRefund = phase == Phase.FAILED || c.refundAmount > 0;
        if (!canRefund) revert NothingToClaim();
        if (c.refunded) revert AlreadyRefunded();

        uint256 refundAmount = phase == Phase.FAILED ? c.ethAmount : c.refundAmount;
        c.refunded = true;

        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit RefundClaimed(msg.sender, refundAmount);
    }

    function getClaimableAmount(address account) public view returns (uint256) {
        Contribution storage c = contributions[account];
        if (c.refunded || c.tokenAllocation == 0) return 0;
        if (block.timestamp < config.tgeTimestamp) return 0;

        uint256 totalAllocation = c.tokenAllocation + c.bonusTokens;
        uint256 vested = _calculateVested(totalAllocation);
        return vested > c.claimedTokens ? vested - c.claimedTokens : 0;
    }

    function _calculateVested(uint256 totalAllocation) internal view returns (uint256) {
        if (block.timestamp < config.tgeTimestamp) return 0;

        uint256 tgeUnlock = (totalAllocation * vesting.tgeUnlockBps) / 10000;

        if (vesting.tgeUnlockBps == 10000 || vesting.vestingDuration == 0) {
            return totalAllocation;
        }

        uint256 elapsed = block.timestamp - config.tgeTimestamp;
        if (elapsed < vesting.cliffDuration) return tgeUnlock;

        uint256 vestingElapsed = elapsed - vesting.cliffDuration;
        uint256 vestingAmount = totalAllocation - tgeUnlock;

        if (vestingElapsed >= vesting.vestingDuration) return totalAllocation;

        return tgeUnlock + (vestingAmount * vestingElapsed) / vesting.vestingDuration;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════════

    function finalize() external onlyOwner {
        if (block.timestamp < config.presaleEnd) revert NotEnded();
        if (totalRaised < config.softCap) revert SoftCapNotReached();
        if (config.mode == PresaleMode.CCA_AUCTION && clearingPrice == 0) revert NotCleared();

        (bool success,) = treasury.call{value: address(this).balance}("");
        if (!success) revert TransferFailed();

        emit Finalized(totalRaised, totalParticipants);
    }

    function withdrawUnsoldTokens() external onlyOwner {
        if (block.timestamp < config.tgeTimestamp) revert TGENotReached();

        uint256 unsold = config.totalTokens - totalTokensSold;
        if (unsold > 0) {
            token.safeTransfer(treasury, unsold);
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function currentPhase() public view returns (Phase) {
        if (config.whitelistStart == 0) return Phase.NOT_STARTED;
        if (block.timestamp < config.whitelistStart) return Phase.NOT_STARTED;

        if (block.timestamp >= config.presaleEnd) {
            if (totalRaised < config.softCap) return Phase.FAILED;
            if (config.mode == PresaleMode.CCA_AUCTION && clearingPrice == 0) return Phase.CLEARING;
            if (block.timestamp >= config.tgeTimestamp) return Phase.DISTRIBUTION;
            return Phase.ENDED;
        }

        if (block.timestamp < config.publicStart) return Phase.WHITELIST;
        return Phase.PUBLIC;
    }

    function getCurrentPrice() public view returns (uint256) {
        if (config.mode == PresaleMode.FIXED_PRICE) return config.tokenPrice;
        if (clearingPrice != 0) return clearingPrice;

        if (block.timestamp < config.whitelistStart) return config.startPrice;
        if (block.timestamp >= config.presaleEnd) return config.reservePrice;

        uint256 elapsed = block.timestamp - config.whitelistStart;
        uint256 decay = elapsed * config.priceDecayPerBlock;

        if (config.startPrice > decay + config.reservePrice) {
            return config.startPrice - decay;
        }
        return config.reservePrice;
    }

    function getContribution(address account)
        external
        view
        returns (
            uint256 ethAmount,
            uint256 tokenAllocation,
            uint256 bonusTokens,
            uint256 claimedTokens,
            uint256 claimable,
            uint256 refundAmount,
            bool claimed,
            bool refunded
        )
    {
        Contribution storage c = contributions[account];
        return (
            c.ethAmount,
            c.tokenAllocation,
            c.bonusTokens,
            c.claimedTokens,
            getClaimableAmount(account),
            c.refundAmount,
            c.claimed,
            c.refunded
        );
    }

    function getPresaleStats()
        external
        view
        returns (
            uint256 raised,
            uint256 participants,
            uint256 tokensSold,
            uint256 softCap,
            uint256 hardCap,
            uint256 price,
            Phase phase
        )
    {
        return (
            totalRaised,
            totalParticipants,
            totalTokensSold,
            config.softCap,
            config.hardCap,
            getCurrentPrice(),
            currentPhase()
        );
    }

    function previewAllocation(uint256 ethAmount, bool isWhitelist, bool isHolder) external view returns (uint256) {
        uint256 price = getCurrentPrice();
        uint256 baseAllocation = (ethAmount * 1e18) / price;
        uint256 bonus = _calculateBonus(ethAmount, baseAllocation, isWhitelist, isHolder);
        return baseAllocation + bonus;
    }

    receive() external payable {
        revert("Use contribute()");
    }
}
