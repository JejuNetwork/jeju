// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IOTC} from "./interfaces/IOTC.sol";

/// @title OTC-like Token Sale Desk - Multi-Token Support
/// @notice Permissionless consignment creation, approver-gated approvals, price snapshot on creation using Chainlink.
///         Multi-token support with per-token consignments. Supports ETH or USDC payments.
contract OTC is IOTC, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    enum PaymentCurrency {
        ETH,
        USDC
    }

    struct RegisteredToken {
        address tokenAddress;
        uint8 decimals;
        bool isActive;
        address priceOracle;
    }

    struct Consignment {
        bytes32 tokenId;
        address consigner;
        uint256 totalAmount;
        uint256 remainingAmount;
        bool isNegotiable;
        uint16 fixedDiscountBps;
        uint32 fixedLockupDays;
        uint16 minDiscountBps;
        uint16 maxDiscountBps;
        uint32 minLockupDays;
        uint32 maxLockupDays;
        uint256 minDealAmount;
        uint256 maxDealAmount;
        uint16 maxPriceVolatilityBps;
        bool isActive;
        uint256 createdAt;
    }

    struct Offer {
        uint256 consignmentId;
        bytes32 tokenId;
        address beneficiary;
        uint256 tokenAmount;
        uint256 discountBps;
        uint256 createdAt;
        uint256 unlockTime;
        uint256 priceUsdPerToken;
        uint256 maxPriceDeviation;
        uint256 ethUsdPrice;
        PaymentCurrency currency;
        bool approved;
        bool paid;
        bool fulfilled;
        bool cancelled;
        address payer;
        uint256 amountPaid;
    }

    // Multi-token registry
    mapping(bytes32 => RegisteredToken) public tokens;
    bytes32[] public tokenList;

    // Consignments
    mapping(uint256 => Consignment) public consignments;
    uint256 public nextConsignmentId = 1;

    // Shared
    IERC20 public immutable usdc;
    IAggregatorV3 public ethUsdFeed;

    // Limits and controls
    uint256 public minUsdAmount = 5 * 1e8; // $5 with 8 decimals
    uint256 public maxTokenPerOrder = 10_000 * 1e18; // 10,000 tokens
    uint256 public quoteExpirySeconds = 30 minutes;
    uint256 public defaultUnlockDelaySeconds = 0; // can be set by admin
    uint256 public maxFeedAgeSeconds = 1 hours; // max allowed staleness for price feeds
    uint256 public maxLockupSeconds = 365 days; // max 1 year lockup
    uint256 public constant MAX_OPEN_OFFERS_TO_RETURN = 100; // limit for getOpenOfferIds()

    // Optional restriction: if true, only beneficiary/agent/approver may fulfill
    bool public restrictFulfillToBeneficiaryOrApprover = false;
    // If true, only the agent or an approver may fulfill. Takes precedence over restrictFulfillToBeneficiaryOrApprover.
    bool public requireApproverToFulfill = false;

    // Treasury tracking (per-token)
    mapping(bytes32 => uint256) public tokenDeposited;
    mapping(bytes32 => uint256) public tokenReserved;

    // Gas prepayment tracking (per consignment)
    mapping(uint256 => uint256) public consignmentGasDeposit;
    uint256 public requiredGasDepositPerConsignment = 0.001 ether; // Default: 0.001 ETH per consignment

    // Roles
    address public agent;
    mapping(address => bool) public isApprover; // distributors/approvers
    uint256 public requiredApprovals = 1; // Number of approvals needed (for multi-sig)
    mapping(uint256 => mapping(address => bool)) public offerApprovals; // offerId => approver => approved
    mapping(uint256 => uint256) public approvalCount; // offerId => count

    // Offers
    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) public offers; // id => Offer
    uint256[] public openOfferIds;
    mapping(address => uint256[]) private _beneficiaryOfferIds;

    // Emergency recovery
    bool public emergencyRefundsEnabled = false;
    uint256 public emergencyRefundDeadline = 30 days; // Time after creation when emergency refund is allowed (reduced from 90d for better UX)

    // Events
    event TokenRegistered(bytes32 indexed tokenId, address indexed tokenAddress, address indexed priceOracle);
    event ConsignmentCreated(
        uint256 indexed consignmentId, bytes32 indexed tokenId, address indexed consigner, uint256 amount
    );
    event ConsignmentUpdated(uint256 indexed consignmentId);
    event ConsignmentWithdrawn(uint256 indexed consignmentId, uint256 amount);
    event GasDepositMade(uint256 indexed consignmentId, uint256 amount);
    event GasDepositRefunded(uint256 indexed consignmentId, address indexed consigner, uint256 amount);
    event GasDepositWithdrawn(address indexed agent, uint256 amount);
    event RequiredGasDepositUpdated(uint256 newAmount);
    event AgentUpdated(address indexed previous, address indexed newAgent);
    event ApproverUpdated(address indexed approver, bool allowed);
    event StableWithdrawn(address indexed to, uint256 usdcAmount, uint256 ethAmount);
    event OfferCreated(
        uint256 indexed id,
        address indexed beneficiary,
        uint256 tokenAmount,
        uint256 discountBps,
        PaymentCurrency currency
    );
    event OfferApproved(uint256 indexed id, address indexed by);
    event OfferCancelled(uint256 indexed id, address indexed by);
    event OfferPaid(uint256 indexed id, address indexed payer, uint256 amountPaid);
    event TokensClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event FeedsUpdated(address indexed tokenUsdFeed, address indexed ethUsdFeed);
    event LimitsUpdated(
        uint256 minUsdAmount, uint256 maxTokenPerOrder, uint256 quoteExpirySeconds, uint256 defaultUnlockDelaySeconds
    );
    event MaxFeedAgeUpdated(uint256 maxFeedAgeSeconds);
    event RestrictFulfillUpdated(bool enabled);
    event RequireApproverFulfillUpdated(bool enabled);
    event EmergencyRefundEnabled(bool enabled);
    event EmergencyRefund(uint256 indexed offerId, address indexed recipient, uint256 amount, PaymentCurrency currency);
    event StorageCleaned(uint256 offersRemoved);
    event RefundFailed(address indexed payer, uint256 amount);

    modifier onlyApproverRole() {
        require(msg.sender == agent || isApprover[msg.sender], "Not approver");
        _;
    }

    constructor(address owner_, IERC20 usdc_, IAggregatorV3 ethUsdFeed_, address agent_) Ownable(owner_) {
        require(address(usdc_) != address(0), "bad usdc");
        require(agent_ != address(0), "bad agent");
        usdc = usdc_;
        ethUsdFeed = ethUsdFeed_;
        agent = agent_;
        require(ethUsdFeed.decimals() == 8, "eth feed decimals");
        require(IERC20Metadata(address(usdc_)).decimals() == 6, "usdc decimals");
    }

    // Admin
    function setAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "zero agent");
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function setApprover(address a, bool allowed) external onlyOwner {
        isApprover[a] = allowed;
        emit ApproverUpdated(a, allowed);
    }

    function setRequiredApprovals(uint256 required) external onlyOwner {
        require(required > 0 && required <= 10, "invalid required approvals");
        requiredApprovals = required;
    }

    function setEthFeed(IAggregatorV3 ethUsd) external onlyOwner {
        require(ethUsd.decimals() == 8, "eth feed decimals");
        ethUsdFeed = ethUsd;
        emit FeedsUpdated(address(0), address(ethUsd));
    }

    function setMaxFeedAge(uint256 secs) external onlyOwner {
        maxFeedAgeSeconds = secs;
        emit MaxFeedAgeUpdated(secs);
    }

    function setLimits(uint256 minUsd, uint256 maxToken, uint256 expirySecs, uint256 unlockDelaySecs)
        external
        onlyOwner
    {
        require(unlockDelaySecs <= maxLockupSeconds, "lockup too long");
        minUsdAmount = minUsd;
        maxTokenPerOrder = maxToken;
        quoteExpirySeconds = expirySecs;
        defaultUnlockDelaySeconds = unlockDelaySecs;
        emit LimitsUpdated(minUsdAmount, maxTokenPerOrder, quoteExpirySeconds, defaultUnlockDelaySeconds);
    }

    function setMaxLockup(uint256 maxSecs) external onlyOwner {
        maxLockupSeconds = maxSecs;
    }

    function setRequiredGasDeposit(uint256 amount) external onlyOwner {
        require(amount <= 0.1 ether, "gas deposit too high");
        requiredGasDepositPerConsignment = amount;
        emit RequiredGasDepositUpdated(amount);
    }

    function setRestrictFulfill(bool enabled) external onlyOwner {
        restrictFulfillToBeneficiaryOrApprover = enabled;
        emit RestrictFulfillUpdated(enabled);
    }

    function setRequireApproverToFulfill(bool enabled) external onlyOwner {
        requireApproverToFulfill = enabled;
        emit RequireApproverFulfillUpdated(enabled);
    }

    function setEmergencyRefund(bool enabled) external onlyOwner {
        emergencyRefundsEnabled = enabled;
        emit EmergencyRefundEnabled(enabled);
    }

    function setEmergencyRefundDeadline(uint256 days_) external onlyOwner {
        emergencyRefundDeadline = days_ * 1 days;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Multi-token management
    function registerToken(bytes32 tokenId, address tokenAddress, address priceOracle) external onlyOwner {
        require(tokens[tokenId].tokenAddress == address(0), "token exists");
        require(tokenAddress != address(0), "zero address");
        uint8 decimals = IERC20Metadata(tokenAddress).decimals();
        require(decimals <= 18, "invalid decimals");
        tokens[tokenId] =
            RegisteredToken({tokenAddress: tokenAddress, decimals: decimals, isActive: true, priceOracle: priceOracle});
        tokenList.push(tokenId);
        emit TokenRegistered(tokenId, tokenAddress, priceOracle);
    }

    function createConsignment(
        bytes32 tokenId,
        uint256 amount,
        bool isNegotiable,
        uint16 fixedDiscountBps,
        uint32 fixedLockupDays,
        uint16 minDiscountBps,
        uint16 maxDiscountBps,
        uint32 minLockupDays,
        uint32 maxLockupDays,
        uint256 minDealAmount,
        uint256 maxDealAmount,
        uint16 maxPriceVolatilityBps
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        RegisteredToken memory tkn = tokens[tokenId];
        require(tkn.isActive, "token not active");
        require(amount > 0, "zero amount");
        require(minDealAmount <= maxDealAmount, "invalid deal amounts");
        require(minDiscountBps <= maxDiscountBps, "invalid discount range");
        require(minLockupDays <= maxLockupDays, "invalid lockup range");
        require(msg.value >= requiredGasDepositPerConsignment, "insufficient gas deposit");

        uint256 balanceBefore = IERC20(tkn.tokenAddress).balanceOf(address(this));
        IERC20(tkn.tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(tkn.tokenAddress).balanceOf(address(this));
        uint256 actualAmount = balanceAfter - balanceBefore;
        require(actualAmount > 0, "zero amount received");

        // Update tracked deposit with actual amount received
        tokenDeposited[tokenId] += actualAmount;

        uint256 consignmentId = nextConsignmentId++;
        consignments[consignmentId] = Consignment({
            tokenId: tokenId,
            consigner: msg.sender,
            totalAmount: actualAmount,
            remainingAmount: actualAmount,
            isNegotiable: isNegotiable,
            fixedDiscountBps: fixedDiscountBps,
            fixedLockupDays: fixedLockupDays,
            minDiscountBps: minDiscountBps,
            maxDiscountBps: maxDiscountBps,
            minLockupDays: minLockupDays,
            maxLockupDays: maxLockupDays,
            minDealAmount: minDealAmount,
            maxDealAmount: maxDealAmount,
            maxPriceVolatilityBps: maxPriceVolatilityBps,
            isActive: true,
            createdAt: block.timestamp
        });

        // Store ONLY the required gas deposit (not excess)
        consignmentGasDeposit[consignmentId] = requiredGasDepositPerConsignment;
        emit GasDepositMade(consignmentId, requiredGasDepositPerConsignment);

        // Refund excess ETH if any
        if (msg.value > requiredGasDepositPerConsignment) {
            uint256 refund = msg.value - requiredGasDepositPerConsignment;
            (bool success,) = payable(msg.sender).call{value: refund}("");
            require(success, "refund failed");
        }

        emit ConsignmentCreated(consignmentId, tokenId, msg.sender, actualAmount);
        return consignmentId;
    }

    function withdrawConsignment(uint256 consignmentId) external nonReentrant {
        Consignment storage c = consignments[consignmentId];
        require(c.consigner == msg.sender, "not consigner");
        require(c.isActive, "not active");
        uint256 withdrawAmount = c.remainingAmount;
        require(withdrawAmount > 0, "nothing to withdraw");

        // CEI: Cache all values first
        bytes32 tokenId_ = c.tokenId;
        uint256 gasDeposit = consignmentGasDeposit[consignmentId];

        RegisteredToken memory tkn = tokens[tokenId_];
        require(tkn.tokenAddress != address(0), "invalid token");
        require(tokenDeposited[tokenId_] >= withdrawAmount, "insufficient deposited balance");

        // CEI: Update ALL state before ANY external calls
        c.isActive = false;
        c.remainingAmount = 0;
        tokenDeposited[tokenId_] -= withdrawAmount;
        consignmentGasDeposit[consignmentId] = 0; // Zero out before external calls

        // External call 1: Token transfer
        IERC20(tkn.tokenAddress).safeTransfer(msg.sender, withdrawAmount);

        // External call 2: ETH refund (if any)
        if (gasDeposit > 0) {
            (bool success,) = payable(msg.sender).call{value: gasDeposit}("");
            require(success, "gas refund failed");
            emit GasDepositRefunded(consignmentId, msg.sender, gasDeposit);
        }

        emit ConsignmentWithdrawn(consignmentId, withdrawAmount);
    }

    // Treasury management
    function withdrawStable(address to, uint256 usdcAmount, uint256 ethAmount) external nonReentrant onlyOwner {
        require(to != address(0), "zero addr");
        if (usdcAmount > 0) usdc.safeTransfer(to, usdcAmount);
        if (ethAmount > 0) {
            (bool ok,) = payable(to).call{value: ethAmount}("");
            require(ok, "eth xfer");
        }
        emit StableWithdrawn(to, usdcAmount, ethAmount);
    }

    function withdrawGasDeposits(uint256[] calldata consignmentIds) external nonReentrant onlyApproverRole {
        require(consignmentIds.length <= 50, "batch too large");
        uint256 totalWithdrawn = 0;
        for (uint256 i = 0; i < consignmentIds.length; i++) {
            uint256 id = consignmentIds[i];
            Consignment storage c = consignments[id];
            // Only allow withdrawal if consignment is inactive (withdrawn or depleted)
            if (!c.isActive && consignmentGasDeposit[id] > 0) {
                uint256 amount = consignmentGasDeposit[id];
                consignmentGasDeposit[id] = 0;
                totalWithdrawn += amount;
            }
        }
        require(totalWithdrawn > 0, "no gas deposits to withdraw");
        (bool success,) = payable(msg.sender).call{value: totalWithdrawn}("");
        require(success, "withdrawal failed");
        emit GasDepositWithdrawn(msg.sender, totalWithdrawn);
    }

    function availableTokenInventoryForToken(bytes32 tokenId) public view returns (uint256) {
        RegisteredToken memory tkn = tokens[tokenId];
        require(tkn.tokenAddress != address(0), "token not registered");
        uint256 bal = IERC20(tkn.tokenAddress).balanceOf(address(this));
        if (bal < tokenReserved[tokenId]) return 0;
        return bal - tokenReserved[tokenId];
    }

    // Multi-token offer creation
    function createOfferFromConsignment(
        uint256 consignmentId,
        uint256 tokenAmount,
        uint256 discountBps,
        PaymentCurrency currency,
        uint256 lockupSeconds
    ) external nonReentrant whenNotPaused returns (uint256) {
        Consignment storage c = consignments[consignmentId];
        require(c.isActive, "consignment not active");
        require(tokenAmount >= c.minDealAmount && tokenAmount <= c.maxDealAmount, "amount out of range");
        require(tokenAmount <= c.remainingAmount, "insufficient remaining");

        if (c.isNegotiable) {
            require(discountBps >= c.minDiscountBps && discountBps <= c.maxDiscountBps, "discount out of range");
            uint256 lockupDays = lockupSeconds / 1 days;
            require(lockupDays >= c.minLockupDays && lockupDays <= c.maxLockupDays, "lockup out of range");
        } else {
            require(discountBps == c.fixedDiscountBps, "must use fixed discount");
            uint256 lockupDays = lockupSeconds / 1 days;
            require(lockupDays == c.fixedLockupDays, "must use fixed lockup");
        }

        RegisteredToken memory tkn = tokens[c.tokenId];
        uint256 priceUsdPerToken = _readTokenPrice(c.tokenId);

        uint256 tokenDecimalsFactor = 10 ** tkn.decimals;
        uint256 totalUsd = _mulDiv(tokenAmount, priceUsdPerToken, tokenDecimalsFactor);
        totalUsd = (totalUsd * (10_000 - discountBps)) / 10_000;
        require(totalUsd >= minUsdAmount, "min usd not met");

        c.remainingAmount -= tokenAmount;
        tokenReserved[c.tokenId] += tokenAmount;
        if (c.remainingAmount == 0) c.isActive = false;

        uint256 offerId = nextOfferId++;
        offers[offerId] = Offer({
            consignmentId: consignmentId,
            tokenId: c.tokenId,
            beneficiary: msg.sender,
            tokenAmount: tokenAmount,
            discountBps: discountBps,
            createdAt: block.timestamp,
            unlockTime: block.timestamp + lockupSeconds,
            priceUsdPerToken: priceUsdPerToken,
            maxPriceDeviation: c.maxPriceVolatilityBps,
            ethUsdPrice: currency == PaymentCurrency.ETH ? _readEthUsdPrice() : 0,
            currency: currency,
            approved: false,
            paid: false,
            fulfilled: false,
            cancelled: false,
            payer: address(0),
            amountPaid: 0
        });

        _beneficiaryOfferIds[msg.sender].push(offerId);
        openOfferIds.push(offerId);
        emit OfferCreated(offerId, msg.sender, tokenAmount, discountBps, currency);
        return offerId;
    }

    function approveOffer(uint256 offerId) external onlyApproverRole whenNotPaused {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(!o.cancelled && !o.paid, "bad state");
        require(!offerApprovals[offerId][msg.sender], "already approved by you");

        RegisteredToken memory tkn = tokens[o.tokenId];
        require(tkn.tokenAddress != address(0), "token not registered");
        uint256 currentPrice = _readTokenPrice(o.tokenId);

        uint256 priceDiff =
            currentPrice > o.priceUsdPerToken ? currentPrice - o.priceUsdPerToken : o.priceUsdPerToken - currentPrice;
        uint256 deviationBps = (priceDiff * 10000) / o.priceUsdPerToken;
        require(deviationBps <= o.maxPriceDeviation, "price volatility exceeded");

        offerApprovals[offerId][msg.sender] = true;
        approvalCount[offerId]++;

        if (approvalCount[offerId] >= requiredApprovals) {
            o.approved = true;
        }

        emit OfferApproved(offerId, msg.sender);
    }

    function cancelOffer(uint256 offerId) external nonReentrant whenNotPaused {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(!o.paid && !o.fulfilled, "already paid");
        require(
            msg.sender == o.beneficiary || msg.sender == owner() || msg.sender == agent || isApprover[msg.sender],
            "no auth"
        );
        // Users can cancel after expiry window
        if (msg.sender == o.beneficiary) {
            require(block.timestamp >= o.createdAt + quoteExpirySeconds, "not expired");
        }
        o.cancelled = true;
        tokenReserved[o.tokenId] -= o.tokenAmount;

        if (o.consignmentId > 0) {
            Consignment storage c = consignments[o.consignmentId];
            c.remainingAmount += o.tokenAmount;
            if (!c.isActive) {
                c.isActive = true;
            }
        }

        emit OfferCancelled(offerId, msg.sender);
    }

    function totalUsdForOffer(uint256 offerId) public view returns (uint256) {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");

        RegisteredToken memory tkn = tokens[o.tokenId];
        require(tkn.tokenAddress != address(0), "token not registered");
        uint256 tokenDecimalsFactor = 10 ** tkn.decimals;

        uint256 totalUsd = _mulDiv(o.tokenAmount, o.priceUsdPerToken, tokenDecimalsFactor);
        totalUsd = (totalUsd * (10_000 - o.discountBps)) / 10_000;
        return totalUsd;
    }

    function fulfillOffer(uint256 offerId) external payable nonReentrant whenNotPaused {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.approved, "not appr");
        require(!o.cancelled && !o.paid && !o.fulfilled, "bad state");
        require(block.timestamp <= o.createdAt + quoteExpirySeconds, "expired");

        if (requireApproverToFulfill) {
            require(msg.sender == agent || isApprover[msg.sender], "fulfill approver only");
        } else if (restrictFulfillToBeneficiaryOrApprover) {
            require(msg.sender == o.beneficiary || msg.sender == agent || isApprover[msg.sender], "fulfill restricted");
        }

        RegisteredToken memory tkn = tokens[o.tokenId];
        require(tkn.tokenAddress != address(0), "token not registered");
        uint256 currentPrice = _readTokenPrice(o.tokenId);
        uint256 priceDiff =
            currentPrice > o.priceUsdPerToken ? currentPrice - o.priceUsdPerToken : o.priceUsdPerToken - currentPrice;
        uint256 deviationBps = (priceDiff * 10000) / o.priceUsdPerToken;
        require(deviationBps <= o.maxPriceDeviation, "price volatility exceeded");

        uint256 usd = totalUsdForOffer(offerId);
        uint256 refundAmount = 0;

        if (o.currency == PaymentCurrency.ETH) {
            uint256 ethUsd = o.ethUsdPrice > 0 ? o.ethUsdPrice : _readEthUsdPrice();
            uint256 weiAmount = _mulDivRoundingUp(usd, 1e18, ethUsd);
            require(msg.value >= weiAmount, "insufficient eth");

            // CEI: Update state BEFORE external calls
            o.amountPaid = weiAmount;
            o.payer = msg.sender;
            o.paid = true;
            refundAmount = msg.value - weiAmount;
        } else {
            uint256 usdcAmount = _mulDivRoundingUp(usd, 1e6, 1e8);

            // CEI: Update state BEFORE external calls
            o.amountPaid = usdcAmount;
            o.payer = msg.sender;
            o.paid = true;

            // External call after state update
            usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        }

        // Emit event before potential ETH refund
        emit OfferPaid(offerId, msg.sender, o.amountPaid);

        // ETH refund at the very end
        if (refundAmount > 0) {
            (bool refunded,) = payable(msg.sender).call{value: refundAmount}("");
            if (!refunded) {
                emit RefundFailed(msg.sender, refundAmount);
            }
        }
    }

    function claim(uint256 offerId) external nonReentrant whenNotPaused {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.paid && !o.cancelled && !o.fulfilled, "bad state");
        require(block.timestamp >= o.unlockTime, "locked");
        require(msg.sender == o.beneficiary, "not beneficiary");

        // CEI: Cache values and update state before external call
        address beneficiary = o.beneficiary;
        uint256 tokenAmount = o.tokenAmount;
        bytes32 tokenId_ = o.tokenId;

        o.fulfilled = true;
        tokenReserved[tokenId_] -= tokenAmount;
        tokenDeposited[tokenId_] -= tokenAmount; // Fix: decrement deposited on claim

        RegisteredToken memory tkn = tokens[tokenId_];
        require(tkn.tokenAddress != address(0), "token not registered");
        IERC20(tkn.tokenAddress).safeTransfer(beneficiary, tokenAmount);

        emit TokensClaimed(offerId, beneficiary, tokenAmount);
    }

    function autoClaim(uint256[] calldata offerIds) external nonReentrant onlyApproverRole whenNotPaused {
        require(offerIds.length <= 50, "batch too large");
        for (uint256 i = 0; i < offerIds.length; i++) {
            uint256 id = offerIds[i];
            if (id == 0 || id >= nextOfferId) continue;
            Offer storage o = offers[id];
            if (o.beneficiary == address(0) || !o.paid || o.cancelled || o.fulfilled) continue;
            if (block.timestamp < o.unlockTime) continue;

            RegisteredToken memory tkn = tokens[o.tokenId];
            if (tkn.tokenAddress == address(0)) continue; // Skip if token not registered

            // CEI: Update state BEFORE external call
            address beneficiary = o.beneficiary;
            uint256 tokenAmount = o.tokenAmount;
            bytes32 tknId = o.tokenId;

            o.fulfilled = true;
            tokenReserved[tknId] -= tokenAmount;
            tokenDeposited[tknId] -= tokenAmount; // Fix: decrement deposited on claim

            // External call after state updates
            IERC20(tkn.tokenAddress).safeTransfer(beneficiary, tokenAmount);

            emit TokensClaimed(id, beneficiary, tokenAmount);
        }
    }

    function getOpenOfferIds() external view returns (uint256[] memory) {
        uint256 total = openOfferIds.length;
        // Start from the end for more recent offers
        uint256 startIdx = total > MAX_OPEN_OFFERS_TO_RETURN ? total - MAX_OPEN_OFFERS_TO_RETURN : 0;
        uint256 count = 0;

        // First pass: count valid offers
        for (uint256 i = startIdx; i < total && count < MAX_OPEN_OFFERS_TO_RETURN; i++) {
            Offer storage o = offers[openOfferIds[i]];
            if (!o.cancelled && !o.paid && block.timestamp <= o.createdAt + quoteExpirySeconds) count++;
        }

        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;

        // Second pass: collect valid offers
        for (uint256 j = startIdx; j < total && idx < count; j++) {
            Offer storage o2 = offers[openOfferIds[j]];
            if (!o2.cancelled && !o2.paid && block.timestamp <= o2.createdAt + quoteExpirySeconds) {
                result[idx++] = openOfferIds[j];
            }
        }
        return result;
    }

    function getOffersForBeneficiary(address who) external view returns (uint256[] memory) {
        return _beneficiaryOfferIds[who];
    }

    function _readTokenPrice(bytes32 tokenId) internal view returns (uint256) {
        RegisteredToken memory tkn = tokens[tokenId];
        return _readTokenUsdPriceFromOracle(tkn.priceOracle);
    }

    function _readTokenUsdPriceFromOracle(address oracle) internal view returns (uint256) {
        IAggregatorV3 feed = IAggregatorV3(oracle);
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "bad price");
        require(answeredInRound >= roundId, "stale round");
        require(updatedAt > 0 && block.timestamp - updatedAt <= maxFeedAgeSeconds, "stale price");
        return uint256(answer);
    }

    function _readEthUsdPrice() internal view returns (uint256) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();
        require(answer > 0, "bad price");
        require(answeredInRound >= roundId, "stale round");
        require(updatedAt > 0 && block.timestamp - updatedAt <= maxFeedAgeSeconds, "stale price");
        return uint256(answer);
    }

    function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return Math.mulDiv(a, b, d);
    }

    function _mulDivRoundingUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return Math.mulDiv(a, b, d, Math.Rounding.Ceil);
    }

    // View helpers for off-chain integrations
    function requiredEthWei(uint256 offerId) external view returns (uint256) {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.currency == PaymentCurrency.ETH, "not ETH");
        uint256 usd = totalUsdForOffer(offerId);
        uint256 ethUsd = o.ethUsdPrice > 0 ? o.ethUsdPrice : _readEthUsdPrice();
        return _mulDivRoundingUp(usd, 1e18, ethUsd);
    }

    function requiredUsdcAmount(uint256 offerId) external view returns (uint256) {
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.currency == PaymentCurrency.USDC, "not USDC");
        uint256 usd = totalUsdForOffer(offerId);
        return _mulDivRoundingUp(usd, 1e6, 1e8);
    }

    // Emergency functions
    function emergencyRefund(uint256 offerId) external nonReentrant {
        require(emergencyRefundsEnabled, "emergency refunds disabled");
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.paid && !o.fulfilled && !o.cancelled, "invalid state for refund");
        require(
            msg.sender == o.payer || msg.sender == o.beneficiary || msg.sender == owner() || msg.sender == agent
                || isApprover[msg.sender],
            "not authorized for refund"
        );

        // Check if enough time has passed for emergency refund
        require(
            block.timestamp >= o.createdAt + emergencyRefundDeadline || block.timestamp >= o.unlockTime + 30 days, // Or 30 days after unlock
            "too early for emergency refund"
        );

        // CEI: Cache values before state changes
        uint256 consignmentId = o.consignmentId;
        bytes32 tokenId_ = o.tokenId;
        uint256 tokenAmount = o.tokenAmount;
        address payer = o.payer;
        uint256 amountPaid = o.amountPaid;
        PaymentCurrency currency = o.currency;

        // Mark as cancelled to prevent double refund
        o.cancelled = true;

        // Release reserved tokens
        tokenReserved[tokenId_] -= tokenAmount;

        // Return tokens to consignment (if it exists)
        if (consignmentId > 0) {
            Consignment storage c = consignments[consignmentId];
            c.remainingAmount += tokenAmount;
            if (!c.isActive) {
                c.isActive = true;
            }
        }

        // Refund payment (external calls at the end)
        if (currency == PaymentCurrency.ETH) {
            (bool success,) = payable(payer).call{value: amountPaid}("");
            require(success, "ETH refund failed");
        } else {
            usdc.safeTransfer(payer, amountPaid);
        }

        emit EmergencyRefund(offerId, payer, amountPaid, currency);
    }

    function adminEmergencyWithdraw(uint256 offerId) external nonReentrant onlyOwner {
        // Only for truly stuck funds after all parties have been given chance to claim
        Offer storage o = offers[offerId];
        require(o.beneficiary != address(0), "no offer");
        require(o.paid && !o.fulfilled && !o.cancelled, "invalid state");
        require(block.timestamp >= o.unlockTime + 180 days, "must wait 180 days after unlock");

        // CEI: Cache values before state changes
        address recipient = o.beneficiary;
        if (recipient == address(0)) recipient = owner(); // Fallback to owner
        uint256 tokenAmount = o.tokenAmount;
        bytes32 tokenId_ = o.tokenId;

        // Mark as fulfilled to prevent double withdrawal
        o.fulfilled = true;

        // Release reserved tokens and update accounting
        tokenReserved[tokenId_] -= tokenAmount;
        tokenDeposited[tokenId_] -= tokenAmount;

        RegisteredToken memory tkn = tokens[tokenId_];
        IERC20(tkn.tokenAddress).safeTransfer(recipient, tokenAmount);
        emit TokensClaimed(offerId, recipient, tokenAmount);
    }

    function _cleanupOldOffers() private {
        uint256 currentTime = block.timestamp;
        uint256 removed = 0;
        uint256 newLength = 0;

        // Create new array without old expired/completed offers
        for (uint256 i = 0; i < openOfferIds.length && removed < 100; i++) {
            uint256 id = openOfferIds[i];
            Offer storage o = offers[id];

            // Keep if still active and not expired
            bool shouldKeep = o.beneficiary != address(0) && !o.cancelled && !o.paid
                && currentTime <= o.createdAt + quoteExpirySeconds + 1 days;

            if (shouldKeep) {
                if (newLength != i) {
                    openOfferIds[newLength] = id;
                }
                newLength++;
            } else {
                removed++;
            }
        }

        // Resize array
        while (openOfferIds.length > newLength) {
            openOfferIds.pop();
        }

        if (removed > 0) {
            emit StorageCleaned(removed);
        }
    }

    function cleanupExpiredOffers(uint256 maxToClean) external whenNotPaused {
        // Public function to allow anyone to help clean storage
        require(maxToClean > 0 && maxToClean <= 100, "invalid max");
        uint256 currentTime = block.timestamp;
        uint256 cleaned = 0;

        for (uint256 i = 0; i < openOfferIds.length && cleaned < maxToClean; i++) {
            uint256 id = openOfferIds[i];
            Offer storage o = offers[id];

            if (
                o.beneficiary != address(0) && !o.paid && !o.cancelled
                    && currentTime > o.createdAt + quoteExpirySeconds + 1 days
            ) {
                // Mark as cancelled to clean up
                o.cancelled = true;
                tokenReserved[o.tokenId] -= o.tokenAmount;

                if (o.consignmentId > 0) {
                    Consignment storage c = consignments[o.consignmentId];
                    c.remainingAmount += o.tokenAmount;
                    if (!c.isActive) {
                        c.isActive = true;
                    }
                }

                cleaned++;
            }
        }

        if (cleaned > 0) {
            _cleanupOldOffers();
        }
    }

    receive() external payable {}
}
