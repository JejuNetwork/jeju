// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CCALauncher
 * @notice Continuous Clearing Auction (CCA) for fair token distribution
 */
contract CCALauncher is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;


    error ZeroAddress();
    error ZeroAmount();
    error AuctionNotActive();
    error AuctionNotEnded();
    error AuctionAlreadyEnded();
    error AuctionAlreadyStarted();
    error BidBelowMinimum();
    error BidExceedsMax();
    error PriceBelowReserve();
    error NothingToClaim();
    error AlreadyMigrated();
    error InsufficientTokens();


    event AuctionConfigured(
        uint256 startTime, uint256 duration, uint256 startPriceUsd, uint256 reservePriceUsd, uint256 totalTokens
    );
    event BidPlaced(address indexed bidder, uint256 amount, uint256 maxPriceUsd, uint256 block_);
    event BidSettled(address indexed bidder, uint256 tokensReceived, uint256 paymentUsed, uint256 clearingPriceUsd);
    event AuctionEnded(uint256 totalRaised, uint256 tokensSold, uint256 finalPriceUsd);
    event LiquidityMigrated(address pool, uint256 tokenAmount, uint256 ethAmount);
    event FeesDistributed(uint256 platformFee, uint256 referralFee, uint256 creatorAmount);

    struct Bid {
        address bidder;
        uint256 amount;
        uint256 maxPriceUsd;
        uint256 blockPlaced;
        bool settled;
        uint256 tokensReceived;
        address referrer;
    }

    struct AuctionConfig {
        uint256 startTime;
        uint256 duration;
        uint256 startPriceUsd;
        uint256 reservePriceUsd;
        uint256 totalTokens;
        uint256 tokensPerBlock;
        uint256 avgBlockTime;
        bool isDutch;
    }

    struct FeeConfig {
        uint16 platformFeeBps;
        uint16 referralFeeBps;
        address platformFeeRecipient;
        address creatorRecipient;
    }

    IERC20 public immutable auctionToken;
    address public immutable paymentToken;
    AuctionConfig public config;
    FeeConfig public fees;
    Bid[] public bids;

    /// @notice Bids by user
    mapping(address => uint256[]) public userBids;

    /// @notice Total ETH/tokens committed
    uint256 public totalCommitted;

    /// @notice Total tokens sold
    uint256 public totalSold;

    /// @notice Clearing price at each block (USD)
    mapping(uint256 => uint256) public blockClearingPrice;

    /// @notice Tokens sold at each block
    mapping(uint256 => uint256) public blockTokensSold;

    /// @notice Whether auction has ended
    bool public ended;

    /// @notice Whether liquidity has been migrated
    bool public migrated;

    /// @notice Final clearing price (USD)
    uint256 public finalPriceUsd;

    /// @notice Minimum bid amount
    uint256 public minBidAmount;

    /// @notice Maximum bid amount (0 = no limit)
    uint256 public maxBidAmount;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _auctionToken Token to sell
     * @param _paymentToken Payment token (address(0) for ETH)
     * @param _owner Contract owner
     */
    constructor(IERC20 _auctionToken, address _paymentToken, address _owner) Ownable(_owner) {
        if (address(_auctionToken) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        auctionToken = _auctionToken;
        paymentToken = _paymentToken;
    }

    // =============================================================================
    // CONFIGURATION
    // =============================================================================

    /**
     * @notice Configure auction parameters
     */
    function configureAuction(
        uint256 startTime,
        uint256 duration,
        uint256 startPriceUsd,
        uint256 reservePriceUsd,
        uint256 totalTokens,
        uint256 avgBlockTime,
        bool isDutch
    ) external onlyOwner {
        if (config.startTime != 0 && block.timestamp >= config.startTime) {
            revert AuctionAlreadyStarted();
        }

        uint256 expectedBlocks = duration / avgBlockTime;
        uint256 tokensPerBlock = expectedBlocks > 0 ? totalTokens / expectedBlocks : totalTokens;

        config = AuctionConfig({
            startTime: startTime,
            duration: duration,
            startPriceUsd: startPriceUsd,
            reservePriceUsd: reservePriceUsd,
            totalTokens: totalTokens,
            tokensPerBlock: tokensPerBlock,
            avgBlockTime: avgBlockTime,
            isDutch: isDutch
        });

        emit AuctionConfigured(startTime, duration, startPriceUsd, reservePriceUsd, totalTokens);
    }

    /**
     * @notice Configure fees
     */
    function configureFees(
        uint16 platformFeeBps,
        uint16 referralFeeBps,
        address platformFeeRecipient,
        address creatorRecipient
    ) external onlyOwner {
        if (platformFeeRecipient == address(0) && platformFeeBps > 0) revert ZeroAddress();
        if (creatorRecipient == address(0)) revert ZeroAddress();

        fees = FeeConfig({
            platformFeeBps: platformFeeBps,
            referralFeeBps: referralFeeBps,
            platformFeeRecipient: platformFeeRecipient,
            creatorRecipient: creatorRecipient
        });
    }

    /**
     * @notice Set bid limits
     */
    function setBidLimits(uint256 _minBidAmount, uint256 _maxBidAmount) external onlyOwner {
        minBidAmount = _minBidAmount;
        maxBidAmount = _maxBidAmount;
    }

    // =============================================================================
    // BIDDING
    // =============================================================================

    /**
     * @notice Place a bid with ETH
     * @param maxPriceUsd Maximum price willing to pay per token (8 decimals)
     * @param referrer Optional referrer for fee sharing
     */
    function bidETH(uint256 maxPriceUsd, address referrer) external payable nonReentrant {
        require(paymentToken == address(0), "Use bidToken for ERC20");
        _placeBid(msg.sender, msg.value, maxPriceUsd, referrer);
    }

    /**
     * @notice Place a bid with ERC20 (e.g., USDC)
     */
    function bidToken(uint256 amount, uint256 maxPriceUsd, address referrer) external nonReentrant {
        require(paymentToken != address(0), "Use bidETH for native");
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        _placeBid(msg.sender, amount, maxPriceUsd, referrer);
    }

    function _placeBid(address bidder, uint256 amount, uint256 maxPriceUsd, address referrer) internal {
        if (block.timestamp < config.startTime) revert AuctionNotActive();
        if (block.timestamp >= config.startTime + config.duration) revert AuctionAlreadyEnded();
        if (ended) revert AuctionAlreadyEnded();
        if (amount < minBidAmount) revert BidBelowMinimum();
        if (maxBidAmount > 0 && amount > maxBidAmount) revert BidExceedsMax();
        if (maxPriceUsd < config.reservePriceUsd) revert PriceBelowReserve();

        uint256 bidId = bids.length;

        bids.push(
            Bid({
                bidder: bidder,
                amount: amount,
                maxPriceUsd: maxPriceUsd,
                blockPlaced: block.number,
                settled: false,
                tokensReceived: 0,
                referrer: referrer
            })
        );

        userBids[bidder].push(bidId);
        totalCommitted += amount;

        emit BidPlaced(bidder, amount, maxPriceUsd, block.number);

        // Immediate clearing for this block
        _clearBlock(block.number);
    }

    /**
     * @dev Clear bids for a specific block
     */
    function _clearBlock(uint256 blockNum) internal {
        // Calculate current price based on auction progress
        uint256 elapsed = block.timestamp - config.startTime;
        uint256 progress = (elapsed * 1e18) / config.duration;
        if (progress > 1e18) progress = 1e18;

        uint256 currentPrice;
        if (config.isDutch) {
            // Dutch: starts high, decreases
            uint256 priceRange = config.startPriceUsd - config.reservePriceUsd;
            currentPrice = config.startPriceUsd - (priceRange * progress / 1e18);
        } else {
            // English: starts low, increases
            uint256 priceRange = config.startPriceUsd - config.reservePriceUsd;
            currentPrice = config.reservePriceUsd + (priceRange * progress / 1e18);
        }

        if (currentPrice < config.reservePriceUsd) currentPrice = config.reservePriceUsd;

        blockClearingPrice[blockNum] = currentPrice;

        // Calculate available tokens for this block
        uint256 elapsedBlocks = (elapsed / config.avgBlockTime) + 1;
        uint256 totalAvailable = elapsedBlocks * config.tokensPerBlock;
        if (totalAvailable > config.totalTokens) totalAvailable = config.totalTokens;

        uint256 availableForBlock = totalAvailable > totalSold ? totalAvailable - totalSold : 0;

        // Settle bids at this block that are at or above clearing price
        for (uint256 i = 0; i < bids.length;) {
            Bid storage bid = bids[i];
            if (bid.blockPlaced == blockNum && !bid.settled && bid.maxPriceUsd >= currentPrice) {
                // Calculate tokens for this bid
                uint256 tokens = (bid.amount * 1e8) / currentPrice; // Simplified - needs proper decimals handling

                if (tokens > availableForBlock) {
                    tokens = availableForBlock;
                }

                if (tokens > 0) {
                    bid.settled = true;
                    bid.tokensReceived = tokens;
                    totalSold += tokens;
                    availableForBlock -= tokens;
                    blockTokensSold[blockNum] += tokens;

                    emit BidSettled(bid.bidder, tokens, bid.amount, currentPrice);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    // =============================================================================
    // SETTLEMENT
    // =============================================================================

    /**
     * @notice End the auction and finalize
     */
    function endAuction() external {
        if (block.timestamp < config.startTime + config.duration) revert AuctionNotEnded();
        if (ended) revert AuctionAlreadyEnded();

        ended = true;

        // Set final price based on auction type
        if (config.isDutch) {
            finalPriceUsd = config.reservePriceUsd;
        } else {
            finalPriceUsd = config.startPriceUsd;
        }

        // Distribute fees
        _distributeFees();

        emit AuctionEnded(totalCommitted, totalSold, finalPriceUsd);
    }

    /**
     * @notice Claim tokens from settled bids
     */
    function claim() external nonReentrant {
        uint256[] storage bidIds = userBids[msg.sender];
        uint256 totalTokens = 0;
        uint256 refundAmount = 0;

        for (uint256 i = 0; i < bidIds.length;) {
            Bid storage bid = bids[bidIds[i]];

            if (bid.settled && bid.tokensReceived > 0) {
                totalTokens += bid.tokensReceived;
                bid.tokensReceived = 0; // Mark as claimed
            } else if (!bid.settled && ended) {
                // Bid not filled - refund
                refundAmount += bid.amount;
                bid.settled = true;
            }

            unchecked {
                ++i;
            }
        }

        if (totalTokens == 0 && refundAmount == 0) revert NothingToClaim();

        if (totalTokens > 0) {
            auctionToken.safeTransfer(msg.sender, totalTokens);
        }

        if (refundAmount > 0) {
            if (paymentToken == address(0)) {
                (bool success,) = msg.sender.call{value: refundAmount}("");
                require(success, "ETH transfer failed");
            } else {
                IERC20(paymentToken).safeTransfer(msg.sender, refundAmount);
            }
        }
    }

    /**
     * @dev Distribute platform and referral fees
     */
    function _distributeFees() internal {
        uint256 totalRaised = totalCommitted;
        uint256 platformFee = (totalRaised * fees.platformFeeBps) / 10000;
        uint256 referralFeeTotal = 0;

        // Calculate referral fees
        for (uint256 i = 0; i < bids.length;) {
            Bid storage bid = bids[i];
            if (bid.settled && bid.referrer != address(0)) {
                uint256 referralFee = (bid.amount * fees.referralFeeBps) / 10000;
                referralFeeTotal += referralFee;

                // Pay referrer
                if (paymentToken == address(0)) {
                    (bool success,) = bid.referrer.call{value: referralFee}("");
                    require(success, "Referral payment failed");
                } else {
                    IERC20(paymentToken).safeTransfer(bid.referrer, referralFee);
                }
            }
            unchecked {
                ++i;
            }
        }

        // Platform fee (minus referral already paid)
        uint256 netPlatformFee = platformFee > referralFeeTotal ? platformFee - referralFeeTotal : 0;

        if (netPlatformFee > 0 && fees.platformFeeRecipient != address(0)) {
            if (paymentToken == address(0)) {
                (bool success,) = fees.platformFeeRecipient.call{value: netPlatformFee}("");
                require(success, "Platform fee payment failed");
            } else {
                IERC20(paymentToken).safeTransfer(fees.platformFeeRecipient, netPlatformFee);
            }
        }

        // Creator gets the rest
        uint256 creatorAmount = totalRaised - platformFee;

        if (creatorAmount > 0) {
            if (paymentToken == address(0)) {
                (bool success,) = fees.creatorRecipient.call{value: creatorAmount}("");
                require(success, "Creator payment failed");
            } else {
                IERC20(paymentToken).safeTransfer(fees.creatorRecipient, creatorAmount);
            }
        }

        emit FeesDistributed(netPlatformFee, referralFeeTotal, creatorAmount);
    }

    // =============================================================================
    // LIQUIDITY MIGRATION
    // =============================================================================

    /**
     * @notice Migrate remaining tokens and funds to Uniswap V4 pool
     * @dev Called after auction ends to create initial liquidity
     *
     * @param poolManager Address of the Uniswap V4 PoolManager or custom hook
     * @param tokenAmount Amount of auction tokens to add as liquidity
     * @param ethAmount Amount of ETH to pair with tokens
     */
    function migrateLiquidity(address poolManager, uint256 tokenAmount, uint256 ethAmount) external onlyOwner {
        if (!ended) revert AuctionNotEnded();
        if (migrated) revert AlreadyMigrated();
        if (poolManager == address(0)) revert ZeroAddress();

        uint256 tokenBalance = auctionToken.balanceOf(address(this));
        if (tokenAmount > tokenBalance) revert InsufficientTokens();

        uint256 ethBalance = paymentToken == address(0) ? address(this).balance : 0;
        if (ethAmount > ethBalance) revert ZeroAmount();

        migrated = true;

        // Transfer tokens to pool manager for liquidity provision
        if (tokenAmount > 0) {
            auctionToken.safeTransfer(poolManager, tokenAmount);
        }

        // Transfer ETH to pool manager (if ETH-based auction)
        if (ethAmount > 0 && paymentToken == address(0)) {
            (bool success,) = poolManager.call{value: ethAmount}("");
            require(success, "ETH transfer failed");
        }

        emit LiquidityMigrated(poolManager, tokenAmount, ethAmount);
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get current clearing price
     */
    function getCurrentPrice() external view returns (uint256) {
        if (block.timestamp < config.startTime) return config.startPriceUsd;
        if (ended) return finalPriceUsd;

        uint256 elapsed = block.timestamp - config.startTime;
        if (elapsed >= config.duration) return config.isDutch ? config.reservePriceUsd : config.startPriceUsd;

        uint256 progress = (elapsed * 1e18) / config.duration;

        if (config.isDutch) {
            uint256 priceRange = config.startPriceUsd - config.reservePriceUsd;
            return config.startPriceUsd - (priceRange * progress / 1e18);
        } else {
            uint256 priceRange = config.startPriceUsd - config.reservePriceUsd;
            return config.reservePriceUsd + (priceRange * progress / 1e18);
        }
    }

    /**
     * @notice Get tokens available for sale
     */
    function getAvailableTokens() external view returns (uint256) {
        if (block.timestamp < config.startTime) return 0;

        uint256 elapsed = block.timestamp - config.startTime;
        if (elapsed > config.duration) elapsed = config.duration;

        uint256 elapsedBlocks = (elapsed / config.avgBlockTime) + 1;
        uint256 totalAvailable = elapsedBlocks * config.tokensPerBlock;
        if (totalAvailable > config.totalTokens) totalAvailable = config.totalTokens;

        return totalAvailable > totalSold ? totalAvailable - totalSold : 0;
    }

    /**
     * @notice Get auction status
     */
    function getStatus()
        external
        view
        returns (bool isActive, bool hasEnded, uint256 raised, uint256 sold, uint256 currentPrice)
    {
        isActive =
            block.timestamp >= config.startTime && block.timestamp < config.startTime + config.duration && !ended;
        hasEnded = ended;
        raised = totalCommitted;
        sold = totalSold;

        if (ended) {
            currentPrice = finalPriceUsd;
        } else if (isActive) {
            currentPrice = this.getCurrentPrice();
        } else {
            currentPrice = config.startPriceUsd;
        }
    }

    /**
     * @notice Get user's bids
     */
    function getUserBids(address user) external view returns (Bid[] memory) {
        uint256[] storage bidIds = userBids[user];
        Bid[] memory result = new Bid[](bidIds.length);

        for (uint256 i = 0; i < bidIds.length;) {
            result[i] = bids[bidIds[i]];
            unchecked {
                ++i;
            }
        }

        return result;
    }

    /**
     * @notice Get total bid count
     */
    function getBidCount() external view returns (uint256) {
        return bids.length;
    }

    // =============================================================================
    // ADMIN
    // =============================================================================

    /**
     * @notice Recover unsold tokens after auction
     */
    function recoverUnsoldTokens(address to) external onlyOwner {
        if (!ended) revert AuctionNotEnded();

        uint256 balance = auctionToken.balanceOf(address(this));
        uint256 unsold = config.totalTokens - totalSold;

        if (unsold > 0 && balance >= unsold) {
            auctionToken.safeTransfer(to, unsold);
        }
    }

    receive() external payable {}
}







