// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title TieredPresale
 * @notice Multi-tier presale contract with whitelist support and soft/hard caps
 * @dev Supports multiple payment tokens (ETH, USDC, etc.) with configurable tiers
 *      and Chainlink price feeds for USD-denominated caps
 *
 * Features:
 * - Multiple tiers with different discounts and limits
 * - Merkle proof whitelist verification
 * - Soft cap (minimum to proceed) and hard cap (maximum raise)
 * - Multi-token support with Chainlink USD pricing
 * - Refunds if soft cap not met
 * - Vesting integration for purchased tokens
 *
 * For ETH-only presales with fixed price or CCA auction,
 * see tokens/Presale.sol instead.
 */
contract TieredPresale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ERRORS
    // =============================================================================

    error ZeroAddress();
    error ZeroAmount();
    error PresaleNotActive();
    error PresaleEnded();
    error PresaleNotEnded();
    error HardCapReached();
    error SoftCapNotMet();
    error NotWhitelisted();
    error ExceedsTierLimit();
    error BelowMinimum();
    error InvalidTier();
    error TokenNotAccepted();
    error NothingToClaim();
    error RefundsDisabled();
    error AlreadyFinalized();

    // =============================================================================
    // EVENTS
    // =============================================================================

    event TierCreated(uint8 indexed tierId, string name, uint256 discount, uint256 minAmount, uint256 maxAmount);
    event ContributionMade(
        address indexed contributor,
        uint8 indexed tier,
        address paymentToken,
        uint256 paymentAmount,
        uint256 tokenAmount
    );
    event TokensClaimed(address indexed contributor, uint256 amount);
    event Refunded(address indexed contributor, address paymentToken, uint256 amount);
    event PresaleFinalized(bool success, uint256 totalRaised, uint256 tokensDistributed);
    event PaymentTokenAdded(address token, address priceFeed);

    // =============================================================================
    // TYPES
    // =============================================================================

    struct Tier {
        string name;
        /// @notice Discount in basis points (1000 = 10% discount)
        uint16 discountBps;
        /// @notice Minimum contribution in USD (scaled by 1e8)
        uint256 minContributionUsd;
        /// @notice Maximum contribution in USD (scaled by 1e8)
        uint256 maxContributionUsd;
        /// @notice Merkle root for whitelist (0 = no whitelist)
        bytes32 whitelistRoot;
        /// @notice Whether tier is active
        bool active;
    }

    struct Contribution {
        /// @notice Payment token used
        address paymentToken;
        /// @notice Amount paid
        uint256 paymentAmount;
        /// @notice Tokens allocated
        uint256 tokenAmount;
        /// @notice Tier used
        uint8 tier;
        /// @notice Whether claimed (or refunded)
        bool claimed;
    }

    struct PaymentToken {
        /// @notice Whether accepted
        bool accepted;
        /// @notice Chainlink price feed (token/USD)
        address priceFeed;
        /// @notice Token decimals
        uint8 decimals;
    }

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Token being sold
    IERC20 public immutable saleToken;

    /// @notice Sale token decimals
    uint8 public immutable saleTokenDecimals;

    /// @notice Base price per token in USD (scaled by 1e8)
    uint256 public priceUsd;

    /// @notice Presale start time
    uint256 public startTime;

    /// @notice Presale end time
    uint256 public endTime;

    /// @notice Soft cap in USD (scaled by 1e8)
    uint256 public softCapUsd;

    /// @notice Hard cap in USD (scaled by 1e8)
    uint256 public hardCapUsd;

    /// @notice Total raised in USD (scaled by 1e8)
    uint256 public totalRaisedUsd;

    /// @notice Total tokens allocated
    uint256 public totalTokensAllocated;

    /// @notice Whether presale has been finalized
    bool public finalized;

    /// @notice Whether refunds are enabled (soft cap not met)
    bool public refundsEnabled;

    /// @notice Vesting contract to send tokens to
    address public vestingContract;

    /// @notice Tiers
    Tier[] public tiers;

    /// @notice Payment tokens accepted
    mapping(address => PaymentToken) public paymentTokens;

    /// @notice List of accepted payment token addresses
    address[] public paymentTokenList;

    /// @notice Contributions by user
    mapping(address => Contribution[]) public contributions;

    /// @notice Total contribution in USD per user per tier
    mapping(address => mapping(uint8 => uint256)) public userTierContributions;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _saleToken Token being sold
     * @param _priceUsd Price per token in USD (8 decimals)
     * @param _softCapUsd Soft cap in USD (8 decimals)
     * @param _hardCapUsd Hard cap in USD (8 decimals)
     * @param _startTime Presale start timestamp
     * @param _endTime Presale end timestamp
     * @param _owner Contract owner
     */
    constructor(
        IERC20 _saleToken,
        uint256 _priceUsd,
        uint256 _softCapUsd,
        uint256 _hardCapUsd,
        uint256 _startTime,
        uint256 _endTime,
        address _owner
    ) Ownable(_owner) {
        if (address(_saleToken) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        if (_priceUsd == 0) revert ZeroAmount();

        saleToken = _saleToken;
        saleTokenDecimals = 18; // Assume 18, can be made dynamic
        priceUsd = _priceUsd;
        softCapUsd = _softCapUsd;
        hardCapUsd = _hardCapUsd;
        startTime = _startTime;
        endTime = _endTime;
    }

    // =============================================================================
    // CONFIGURATION
    // =============================================================================

    /**
     * @notice Add a presale tier
     */
    function addTier(
        string calldata name,
        uint16 discountBps,
        uint256 minContributionUsd,
        uint256 maxContributionUsd,
        bytes32 whitelistRoot
    ) external onlyOwner {
        uint8 tierId = uint8(tiers.length);
        tiers.push(
            Tier({
                name: name,
                discountBps: discountBps,
                minContributionUsd: minContributionUsd,
                maxContributionUsd: maxContributionUsd,
                whitelistRoot: whitelistRoot,
                active: true
            })
        );
        emit TierCreated(tierId, name, discountBps, minContributionUsd, maxContributionUsd);
    }

    /**
     * @notice Update tier whitelist
     */
    function updateTierWhitelist(uint8 tierId, bytes32 whitelistRoot) external onlyOwner {
        if (tierId >= tiers.length) revert InvalidTier();
        tiers[tierId].whitelistRoot = whitelistRoot;
    }

    /**
     * @notice Set tier active status
     */
    function setTierActive(uint8 tierId, bool active) external onlyOwner {
        if (tierId >= tiers.length) revert InvalidTier();
        tiers[tierId].active = active;
    }

    /**
     * @notice Add accepted payment token
     * @param token Token address (address(0) for native ETH)
     * @param priceFeed Chainlink price feed address
     * @param decimals Token decimals
     */
    function addPaymentToken(address token, address priceFeed, uint8 decimals) external onlyOwner {
        paymentTokens[token] = PaymentToken({accepted: true, priceFeed: priceFeed, decimals: decimals});
        paymentTokenList.push(token);
        emit PaymentTokenAdded(token, priceFeed);
    }

    /**
     * @notice Set vesting contract
     */
    function setVestingContract(address _vestingContract) external onlyOwner {
        vestingContract = _vestingContract;
    }

    // =============================================================================
    // CONTRIBUTION
    // =============================================================================

    /**
     * @notice Contribute to presale with ETH
     */
    function contributeETH(uint8 tierId, bytes32[] calldata merkleProof) external payable nonReentrant {
        if (!paymentTokens[address(0)].accepted) revert TokenNotAccepted();
        _contribute(msg.sender, tierId, address(0), msg.value, merkleProof);
    }

    /**
     * @notice Contribute to presale with ERC20
     */
    function contributeToken(uint8 tierId, address paymentToken, uint256 amount, bytes32[] calldata merkleProof)
        external
        nonReentrant
    {
        if (!paymentTokens[paymentToken].accepted) revert TokenNotAccepted();
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        _contribute(msg.sender, tierId, paymentToken, amount, merkleProof);
    }

    function _contribute(
        address contributor,
        uint8 tierId,
        address paymentToken,
        uint256 paymentAmount,
        bytes32[] calldata merkleProof
    ) internal {
        if (block.timestamp < startTime) revert PresaleNotActive();
        if (block.timestamp > endTime) revert PresaleEnded();
        if (finalized) revert AlreadyFinalized();
        if (tierId >= tiers.length) revert InvalidTier();

        Tier storage tier = tiers[tierId];
        if (!tier.active) revert InvalidTier();

        // Verify whitelist if set
        if (tier.whitelistRoot != bytes32(0)) {
            bytes32 leaf = keccak256(abi.encodePacked(contributor));
            if (!MerkleProof.verify(merkleProof, tier.whitelistRoot, leaf)) {
                revert NotWhitelisted();
            }
        }

        // Get USD value of contribution
        uint256 contributionUsd = _getUsdValue(paymentToken, paymentAmount);

        // Check limits
        if (contributionUsd < tier.minContributionUsd) revert BelowMinimum();

        uint256 newTierTotal = userTierContributions[contributor][tierId] + contributionUsd;
        if (newTierTotal > tier.maxContributionUsd) revert ExceedsTierLimit();

        // Check hard cap
        if (totalRaisedUsd + contributionUsd > hardCapUsd) revert HardCapReached();

        // Calculate tokens with discount
        uint256 effectivePrice = priceUsd - (priceUsd * tier.discountBps / 10000);
        uint256 tokenAmount = (contributionUsd * (10 ** saleTokenDecimals)) / effectivePrice;

        // Record contribution
        contributions[contributor].push(
            Contribution({
                paymentToken: paymentToken,
                paymentAmount: paymentAmount,
                tokenAmount: tokenAmount,
                tier: tierId,
                claimed: false
            })
        );

        userTierContributions[contributor][tierId] = newTierTotal;
        totalRaisedUsd += contributionUsd;
        totalTokensAllocated += tokenAmount;

        emit ContributionMade(contributor, tierId, paymentToken, paymentAmount, tokenAmount);
    }

    /**
     * @dev Get USD value of payment using Chainlink price feeds
     * @param paymentToken Token address (address(0) for ETH)
     * @param amount Amount in token's native decimals
     * @return USD value with 8 decimals
     */
    function _getUsdValue(address paymentToken, uint256 amount) internal view returns (uint256) {
        PaymentToken storage pt = paymentTokens[paymentToken];

        // No price feed configured - assume stablecoin with 1:1 USD peg
        if (pt.priceFeed == address(0)) {
            return (amount * 1e8) / (10 ** pt.decimals);
        }

        // Query Chainlink price feed
        (, int256 price,,,) = AggregatorV3Interface(pt.priceFeed).latestRoundData();
        if (price <= 0) revert ZeroAmount();

        // Chainlink returns price with 8 decimals
        // Convert: (amount * price) / (10^decimals) = USD value with 8 decimals
        return (amount * uint256(price)) / (10 ** pt.decimals);
    }

    // =============================================================================
    // FINALIZATION
    // =============================================================================

    /**
     * @notice Finalize presale after end time
     */
    function finalize() external onlyOwner {
        if (block.timestamp <= endTime) revert PresaleNotEnded();
        if (finalized) revert AlreadyFinalized();

        finalized = true;

        if (totalRaisedUsd < softCapUsd) {
            // Soft cap not met - enable refunds
            refundsEnabled = true;
            emit PresaleFinalized(false, totalRaisedUsd, 0);
        } else {
            // Success - tokens can be claimed
            emit PresaleFinalized(true, totalRaisedUsd, totalTokensAllocated);
        }
    }

    /**
     * @notice Claim purchased tokens (after successful finalization)
     */
    function claim() external nonReentrant {
        if (!finalized) revert PresaleNotEnded();
        if (refundsEnabled) revert SoftCapNotMet();

        Contribution[] storage userContribs = contributions[msg.sender];
        uint256 totalToClaim = 0;

        for (uint256 i = 0; i < userContribs.length;) {
            if (!userContribs[i].claimed) {
                userContribs[i].claimed = true;
                totalToClaim += userContribs[i].tokenAmount;
            }
            unchecked {
                ++i;
            }
        }

        if (totalToClaim == 0) revert NothingToClaim();

        // Transfer tokens (or to vesting contract)
        if (vestingContract != address(0)) {
            saleToken.safeTransfer(vestingContract, totalToClaim);
            // Vesting contract should be pre-configured with schedules
        } else {
            saleToken.safeTransfer(msg.sender, totalToClaim);
        }

        emit TokensClaimed(msg.sender, totalToClaim);
    }

    /**
     * @notice Get refund (if soft cap not met)
     */
    function refund() external nonReentrant {
        if (!finalized) revert PresaleNotEnded();
        if (!refundsEnabled) revert RefundsDisabled();

        Contribution[] storage userContribs = contributions[msg.sender];

        for (uint256 i = 0; i < userContribs.length;) {
            Contribution storage contrib = userContribs[i];
            if (!contrib.claimed) {
                contrib.claimed = true;

                if (contrib.paymentToken == address(0)) {
                    // ETH refund
                    (bool success,) = msg.sender.call{value: contrib.paymentAmount}("");
                    require(success, "ETH refund failed");
                } else {
                    // Token refund
                    IERC20(contrib.paymentToken).safeTransfer(msg.sender, contrib.paymentAmount);
                }

                emit Refunded(msg.sender, contrib.paymentToken, contrib.paymentAmount);
            }
            unchecked {
                ++i;
            }
        }
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get user's total contribution and allocation
     */
    function getUserInfo(address user)
        external
        view
        returns (uint256 totalContributedUsd, uint256 totalTokensAllocated_, bool hasClaimed)
    {
        Contribution[] storage userContribs = contributions[user];
        bool allClaimed = true;

        for (uint256 i = 0; i < userContribs.length;) {
            totalContributedUsd += _getUsdValue(userContribs[i].paymentToken, userContribs[i].paymentAmount);
            totalTokensAllocated_ += userContribs[i].tokenAmount;
            if (!userContribs[i].claimed) allClaimed = false;
            unchecked {
                ++i;
            }
        }

        hasClaimed = allClaimed && userContribs.length > 0;
    }

    /**
     * @notice Get number of tiers
     */
    function getTierCount() external view returns (uint256) {
        return tiers.length;
    }

    /**
     * @notice Get presale progress
     */
    function getProgress()
        external
        view
        returns (
            uint256 raised,
            uint256 softCap,
            uint256 hardCap,
            uint256 tokensAllocated,
            bool isActive,
            bool isFinalized
        )
    {
        raised = totalRaisedUsd;
        softCap = softCapUsd;
        hardCap = hardCapUsd;
        tokensAllocated = totalTokensAllocated;
        isActive = block.timestamp >= startTime && block.timestamp <= endTime && !finalized;
        isFinalized = finalized;
    }

    // =============================================================================
    // ADMIN
    // =============================================================================

    /**
     * @notice Withdraw raised funds (after successful finalization)
     */
    function withdrawFunds(address to) external onlyOwner {
        if (!finalized) revert PresaleNotEnded();
        if (refundsEnabled) revert SoftCapNotMet();

        // Withdraw ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool success,) = to.call{value: ethBalance}("");
            require(success, "ETH withdraw failed");
        }

        // Withdraw all payment tokens
        for (uint256 i = 0; i < paymentTokenList.length;) {
            address token = paymentTokenList[i];
            if (token != address(0)) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance > 0) {
                    IERC20(token).safeTransfer(to, balance);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Recover unsold tokens (after finalization)
     */
    function recoverUnsoldTokens(address to) external onlyOwner {
        if (!finalized) revert PresaleNotEnded();

        uint256 balance = saleToken.balanceOf(address(this));
        uint256 unsold = balance > totalTokensAllocated ? balance - totalTokensAllocated : 0;

        if (unsold > 0) {
            saleToken.safeTransfer(to, unsold);
        }
    }

    receive() external payable {}
}
