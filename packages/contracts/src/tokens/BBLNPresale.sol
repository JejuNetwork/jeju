// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BBLNPresale
 * @author Jeju Network
 * @notice BBLN token presale with Continuous Clearing Auction (CCA) mechanics
 * @dev 
 * - Reverse Dutch auction: price starts high, decreases over time
 * - All participants pay the same final clearing price
 * - Cross-chain contributions via Hyperlane message verification
 * - ELIZA OS holder bonus (1.5x allocation multiplier)
 * - 100% liquid at TGE (no vesting for public sale)
 *
 * Based on BBLN Tokenomics:
 * - 10% total supply (100M BBLN) available for public sale
 * - CCA mechanism for fair price discovery
 * - Cross-chain deposits accepted (Ethereum, Base, Arbitrum)
 *
 * @custom:security-contact security@jeju.network
 */
contract BBLNPresale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum AuctionPhase {
        NOT_STARTED,
        EARLY_BIRD,     // ELIZA holders priority
        PUBLIC_AUCTION, // Main CCA phase
        CLEARING,       // Price determination
        DISTRIBUTION,   // Tokens being distributed
        COMPLETED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Bid {
        uint256 ethAmount;      // Total ETH committed
        uint256 maxPrice;       // Maximum price willing to pay (wei per BBLN)
        uint256 allocation;     // Final token allocation (set after clearing)
        uint256 refundAmount;   // ETH to refund (if bid above clearing price)
        uint256 bidTimestamp;   // When bid was placed
        uint32 sourceChainId;   // Chain where contribution originated
        bool isElizaHolder;     // Gets 1.5x allocation bonus
        bool claimed;           // Whether tokens have been claimed
        bool refunded;          // Whether excess ETH has been refunded
    }

    struct AuctionConfig {
        uint256 totalTokensForSale;  // 100M BBLN
        uint256 startPrice;          // Starting price (high)
        uint256 reservePrice;        // Minimum price floor
        uint256 priceDecayRate;      // Price decrease per block (wei)
        uint256 earlyBirdStart;      // ELIZA holder priority start
        uint256 publicStart;         // Public auction start
        uint256 auctionEnd;          // Auction end timestamp
        uint256 clearingDeadline;    // Deadline for price clearing
        uint256 minBidAmount;        // Minimum bid (e.g., 0.01 ETH)
        uint256 maxBidAmount;        // Maximum bid per wallet
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable bblnToken;
    AuctionConfig public config;

    /// @notice Final clearing price (set after auction ends)
    uint256 public clearingPrice;

    /// @notice Total ETH committed (across all chains)
    uint256 public totalCommitted;

    /// @notice Total bids count
    uint256 public totalBidders;

    /// @notice Total tokens allocated
    uint256 public totalAllocated;

    /// @notice Individual bids
    mapping(address => Bid) public bids;

    /// @notice ELIZA OS holder verification (set by oracle)
    mapping(address => bool) public elizaHolders;

    /// @notice Cross-chain contribution tracking
    mapping(uint32 => mapping(bytes32 => bool)) public processedCrossChainBids;

    /// @notice Treasury for receiving funds
    address public treasury;

    /// @notice Cross-chain message verifier (Hyperlane ISM)
    address public crossChainVerifier;

    /// @notice Supported source chains for cross-chain bids
    mapping(uint32 => bool) public supportedChains;

    /// @notice ELIZA holder bonus multiplier (15000 = 1.5x)
    uint256 public constant ELIZA_BONUS_MULTIPLIER = 15000;
    uint256 public constant MULTIPLIER_DENOMINATOR = 10000;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event BidPlaced(
        address indexed bidder,
        uint256 ethAmount,
        uint256 maxPrice,
        uint32 sourceChainId,
        bool isElizaHolder
    );
    event BidIncreased(address indexed bidder, uint256 additionalEth, uint256 newTotal);
    event ClearingPriceSet(uint256 clearingPrice, uint256 totalBids, uint256 totalAllocated);
    event TokensClaimed(address indexed bidder, uint256 amount);
    event RefundClaimed(address indexed bidder, uint256 amount);
    event ElizaHolderVerified(address indexed holder, bool status);
    event CrossChainBidProcessed(uint32 sourceChain, bytes32 messageId, address bidder, uint256 amount);
    event AuctionFinalized(uint256 totalRaised, uint256 clearingPrice);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error AuctionNotActive();
    error EarlyBirdOnly();
    error BelowMinBid();
    error ExceedsMaxBid();
    error AuctionNotEnded();
    error AlreadyCleared();
    error NotCleared();
    error AlreadyClaimed();
    error AlreadyRefunded();
    error NothingToClaim();
    error InvalidConfig();
    error TransferFailed();
    error ZeroAddress();
    error UnsupportedChain();
    error InvalidCrossChainMessage();
    error MessageAlreadyProcessed();
    error OnlyVerifier();
    error PriceTooLow();

    // ═══════════════════════════════════════════════════════════════════════
    //                              MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════

    modifier onlyVerifier() {
        if (msg.sender != crossChainVerifier && msg.sender != owner()) revert OnlyVerifier();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _bblnToken,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_bblnToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        
        bblnToken = IERC20(_bblnToken);
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Configure the CCA auction parameters
     * @param _totalTokens Total BBLN tokens for sale (100M recommended)
     * @param _startPrice Starting price in wei per BBLN
     * @param _reservePrice Minimum price floor in wei per BBLN
     * @param _priceDecayRate Price decrease per block
     * @param _earlyBirdStart ELIZA holder priority start
     * @param _publicStart Public auction start
     * @param _auctionEnd Auction end timestamp
     * @param _minBid Minimum bid amount in ETH
     * @param _maxBid Maximum bid per wallet in ETH
     */
    function configure(
        uint256 _totalTokens,
        uint256 _startPrice,
        uint256 _reservePrice,
        uint256 _priceDecayRate,
        uint256 _earlyBirdStart,
        uint256 _publicStart,
        uint256 _auctionEnd,
        uint256 _minBid,
        uint256 _maxBid
    ) external onlyOwner {
        if (config.earlyBirdStart != 0 && block.timestamp >= config.earlyBirdStart) {
            revert AuctionNotActive();
        }
        if (_startPrice <= _reservePrice) revert InvalidConfig();
        if (_earlyBirdStart >= _publicStart) revert InvalidConfig();
        if (_publicStart >= _auctionEnd) revert InvalidConfig();
        if (_minBid >= _maxBid) revert InvalidConfig();

        config = AuctionConfig({
            totalTokensForSale: _totalTokens,
            startPrice: _startPrice,
            reservePrice: _reservePrice,
            priceDecayRate: _priceDecayRate,
            earlyBirdStart: _earlyBirdStart,
            publicStart: _publicStart,
            auctionEnd: _auctionEnd,
            clearingDeadline: _auctionEnd + 1 days,
            minBidAmount: _minBid,
            maxBidAmount: _maxBid
        });
    }

    /**
     * @notice Set supported chains for cross-chain bids
     */
    function setSupportedChain(uint32 chainId, bool supported) external onlyOwner {
        supportedChains[chainId] = supported;
    }

    /**
     * @notice Set cross-chain message verifier
     */
    function setCrossChainVerifier(address _verifier) external onlyOwner {
        crossChainVerifier = _verifier;
    }

    /**
     * @notice Set ELIZA holder status (called by oracle/verifier)
     */
    function setElizaHolder(address holder, bool status) external onlyVerifier {
        elizaHolders[holder] = status;
        emit ElizaHolderVerified(holder, status);
    }

    /**
     * @notice Batch set ELIZA holders
     */
    function setElizaHolders(address[] calldata holders, bool status) external onlyVerifier {
        for (uint256 i = 0; i < holders.length; i++) {
            elizaHolders[holders[i]] = status;
            emit ElizaHolderVerified(holders[i], status);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              BIDDING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Place a bid in the CCA auction
     * @param maxPrice Maximum price willing to pay (0 = accept any clearing price)
     */
    function bid(uint256 maxPrice) external payable nonReentrant whenNotPaused {
        AuctionPhase phase = currentPhase();
        
        if (phase == AuctionPhase.EARLY_BIRD && !elizaHolders[msg.sender]) {
            revert EarlyBirdOnly();
        }
        if (phase != AuctionPhase.EARLY_BIRD && phase != AuctionPhase.PUBLIC_AUCTION) {
            revert AuctionNotActive();
        }

        _processBid(msg.sender, msg.value, maxPrice, uint32(block.chainid), elizaHolders[msg.sender]);
    }

    /**
     * @notice Increase existing bid amount
     */
    function increaseBid() external payable nonReentrant whenNotPaused {
        AuctionPhase phase = currentPhase();
        if (phase != AuctionPhase.EARLY_BIRD && phase != AuctionPhase.PUBLIC_AUCTION) {
            revert AuctionNotActive();
        }

        Bid storage existingBid = bids[msg.sender];
        if (existingBid.ethAmount == 0) revert NothingToClaim();

        uint256 newTotal = existingBid.ethAmount + msg.value;
        if (newTotal > config.maxBidAmount) revert ExceedsMaxBid();

        existingBid.ethAmount = newTotal;
        totalCommitted += msg.value;

        emit BidIncreased(msg.sender, msg.value, newTotal);
    }

    /**
     * @notice Process a cross-chain bid (called by verifier after Hyperlane message)
     */
    function processCrossChainBid(
        uint32 sourceChainId,
        bytes32 messageId,
        address bidder,
        uint256 ethAmount,
        uint256 maxPrice,
        bool isElizaHolder
    ) external onlyVerifier nonReentrant {
        if (!supportedChains[sourceChainId]) revert UnsupportedChain();
        if (processedCrossChainBids[sourceChainId][messageId]) revert MessageAlreadyProcessed();

        processedCrossChainBids[sourceChainId][messageId] = true;

        _processBid(bidder, ethAmount, maxPrice, sourceChainId, isElizaHolder);

        emit CrossChainBidProcessed(sourceChainId, messageId, bidder, ethAmount);
    }

    /**
     * @notice Internal bid processing
     */
    function _processBid(
        address bidder,
        uint256 ethAmount,
        uint256 maxPrice,
        uint32 sourceChainId,
        bool isElizaHolder
    ) internal {
        Bid storage existingBid = bids[bidder];
        uint256 newTotal = existingBid.ethAmount + ethAmount;

        if (newTotal < config.minBidAmount) revert BelowMinBid();
        if (newTotal > config.maxBidAmount) revert ExceedsMaxBid();

        // If maxPrice specified, must be >= reserve
        if (maxPrice > 0 && maxPrice < config.reservePrice) revert PriceTooLow();

        if (existingBid.ethAmount == 0) {
            totalBidders++;
            bids[bidder] = Bid({
                ethAmount: ethAmount,
                maxPrice: maxPrice,
                allocation: 0,
                refundAmount: 0,
                bidTimestamp: block.timestamp,
                sourceChainId: sourceChainId,
                isElizaHolder: isElizaHolder,
                claimed: false,
                refunded: false
            });
        } else {
            existingBid.ethAmount = newTotal;
            if (maxPrice > 0) {
                existingBid.maxPrice = maxPrice;
            }
            if (isElizaHolder) {
                existingBid.isElizaHolder = true;
            }
        }

        totalCommitted += ethAmount;

        emit BidPlaced(bidder, ethAmount, maxPrice, sourceChainId, isElizaHolder);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CLEARING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Set the clearing price and calculate allocations
     * @dev Called by owner after auction ends. Can be computed off-chain.
     * @param _clearingPrice Final clearing price in wei per BBLN
     * @param bidders List of bidders to process
     */
    function setClearingPrice(uint256 _clearingPrice, address[] calldata bidders) external onlyOwner {
        if (block.timestamp < config.auctionEnd) revert AuctionNotEnded();
        if (clearingPrice != 0) revert AlreadyCleared();
        if (_clearingPrice < config.reservePrice) revert PriceTooLow();

        clearingPrice = _clearingPrice;

        // Process allocations for provided bidders
        for (uint256 i = 0; i < bidders.length; i++) {
            _calculateAllocation(bidders[i]);
        }

        emit ClearingPriceSet(_clearingPrice, totalBidders, totalAllocated);
    }

    /**
     * @notice Calculate allocation for a single bidder (can be called by anyone)
     */
    function calculateAllocation(address bidder) external {
        if (clearingPrice == 0) revert NotCleared();
        _calculateAllocation(bidder);
    }

    function _calculateAllocation(address bidder) internal {
        Bid storage userBid = bids[bidder];
        if (userBid.ethAmount == 0 || userBid.allocation > 0) return;

        // Skip if bid's max price is below clearing price
        if (userBid.maxPrice > 0 && userBid.maxPrice < clearingPrice) {
            userBid.refundAmount = userBid.ethAmount;
            return;
        }

        // Calculate base allocation: ETH / clearing price
        uint256 baseAllocation = (userBid.ethAmount * 1e18) / clearingPrice;

        // Apply ELIZA holder bonus (1.5x)
        uint256 finalAllocation = baseAllocation;
        if (userBid.isElizaHolder) {
            finalAllocation = (baseAllocation * ELIZA_BONUS_MULTIPLIER) / MULTIPLIER_DENOMINATOR;
        }

        // Cap at available tokens
        uint256 remaining = config.totalTokensForSale - totalAllocated;
        if (finalAllocation > remaining) {
            finalAllocation = remaining;
            // Calculate refund for unused ETH
            uint256 usedEth = (finalAllocation * clearingPrice) / 1e18;
            if (userBid.isElizaHolder) {
                // Adjust for bonus
                usedEth = (usedEth * MULTIPLIER_DENOMINATOR) / ELIZA_BONUS_MULTIPLIER;
            }
            userBid.refundAmount = userBid.ethAmount - usedEth;
        }

        userBid.allocation = finalAllocation;
        totalAllocated += finalAllocation;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CLAIMING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim allocated BBLN tokens
     */
    function claimTokens() external nonReentrant {
        if (clearingPrice == 0) revert NotCleared();

        Bid storage userBid = bids[msg.sender];
        if (userBid.claimed) revert AlreadyClaimed();
        if (userBid.allocation == 0) revert NothingToClaim();

        userBid.claimed = true;
        bblnToken.safeTransfer(msg.sender, userBid.allocation);

        emit TokensClaimed(msg.sender, userBid.allocation);
    }

    /**
     * @notice Claim refund for unused ETH
     */
    function claimRefund() external nonReentrant {
        if (clearingPrice == 0) revert NotCleared();

        Bid storage userBid = bids[msg.sender];
        if (userBid.refunded) revert AlreadyRefunded();
        if (userBid.refundAmount == 0) revert NothingToClaim();

        uint256 refundAmount = userBid.refundAmount;
        userBid.refunded = true;

        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit RefundClaimed(msg.sender, refundAmount);
    }

    /**
     * @notice Claim both tokens and refund in one transaction
     */
    function claimAll() external nonReentrant {
        if (clearingPrice == 0) revert NotCleared();

        Bid storage userBid = bids[msg.sender];

        // Claim tokens if available
        if (!userBid.claimed && userBid.allocation > 0) {
            userBid.claimed = true;
            bblnToken.safeTransfer(msg.sender, userBid.allocation);
            emit TokensClaimed(msg.sender, userBid.allocation);
        }

        // Claim refund if available
        if (!userBid.refunded && userBid.refundAmount > 0) {
            uint256 refundAmount = userBid.refundAmount;
            userBid.refunded = true;

            (bool success,) = msg.sender.call{value: refundAmount}("");
            if (!success) revert TransferFailed();

            emit RefundClaimed(msg.sender, refundAmount);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Finalize auction and transfer raised funds to treasury
     */
    function finalize() external onlyOwner {
        if (clearingPrice == 0) revert NotCleared();

        uint256 raisedAmount = totalCommitted; // Simplified: actual calculation considers refunds
        
        (bool success,) = treasury.call{value: address(this).balance}("");
        if (!success) revert TransferFailed();

        emit AuctionFinalized(raisedAmount, clearingPrice);
    }

    /**
     * @notice Withdraw unsold tokens after auction
     */
    function withdrawUnsoldTokens() external onlyOwner {
        if (clearingPrice == 0) revert NotCleared();

        uint256 unsold = config.totalTokensForSale - totalAllocated;
        if (unsold > 0) {
            bblnToken.safeTransfer(treasury, unsold);
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

    function currentPhase() public view returns (AuctionPhase) {
        if (config.earlyBirdStart == 0) return AuctionPhase.NOT_STARTED;
        if (block.timestamp < config.earlyBirdStart) return AuctionPhase.NOT_STARTED;
        if (block.timestamp < config.publicStart) return AuctionPhase.EARLY_BIRD;
        if (block.timestamp < config.auctionEnd) return AuctionPhase.PUBLIC_AUCTION;
        if (clearingPrice == 0) return AuctionPhase.CLEARING;
        if (totalAllocated < config.totalTokensForSale) return AuctionPhase.DISTRIBUTION;
        return AuctionPhase.COMPLETED;
    }

    /**
     * @notice Get current auction price (decreases over time)
     */
    function getCurrentPrice() public view returns (uint256) {
        if (block.timestamp < config.earlyBirdStart) return config.startPrice;
        if (block.timestamp >= config.auctionEnd) return config.reservePrice;

        uint256 elapsed = block.timestamp - config.earlyBirdStart;
        uint256 decay = elapsed * config.priceDecayRate;

        if (config.startPrice > decay + config.reservePrice) {
            return config.startPrice - decay;
        }
        return config.reservePrice;
    }

    function getBid(address bidder) external view returns (
        uint256 ethAmount,
        uint256 maxPrice,
        uint256 allocation,
        uint256 refundAmount,
        bool isElizaHolder,
        bool claimed,
        bool refunded
    ) {
        Bid storage userBid = bids[bidder];
        return (
            userBid.ethAmount,
            userBid.maxPrice,
            userBid.allocation,
            userBid.refundAmount,
            userBid.isElizaHolder,
            userBid.claimed,
            userBid.refunded
        );
    }

    function getAuctionStats() external view returns (
        uint256 totalTokens,
        uint256 committed,
        uint256 allocated,
        uint256 bidders,
        uint256 currentPrice,
        uint256 clearing,
        AuctionPhase phase
    ) {
        return (
            config.totalTokensForSale,
            totalCommitted,
            totalAllocated,
            totalBidders,
            getCurrentPrice(),
            clearingPrice,
            currentPhase()
        );
    }

    function getTimeInfo() external view returns (
        uint256 earlyBirdStart,
        uint256 publicStart,
        uint256 auctionEnd,
        uint256 currentTime
    ) {
        return (config.earlyBirdStart, config.publicStart, config.auctionEnd, block.timestamp);
    }

    /**
     * @notice Preview allocation for a hypothetical bid
     */
    function previewAllocation(uint256 ethAmount, bool isElizaHolder) external view returns (uint256) {
        uint256 price = clearingPrice == 0 ? getCurrentPrice() : clearingPrice;
        uint256 allocation = (ethAmount * 1e18) / price;
        
        if (isElizaHolder) {
            return (allocation * ELIZA_BONUS_MULTIPLIER) / MULTIPLIER_DENOMINATOR;
        }
        return allocation;
    }

    receive() external payable {
        revert("Use bid()");
    }
}
