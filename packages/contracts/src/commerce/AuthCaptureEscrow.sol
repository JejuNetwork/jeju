// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {
    PaymentStatus,
    AuthorizationMethod,
    PaymentAuthorization,
    CaptureRequest,
    RefundRequest,
    OperatorConfig,
    ICommerceEvents
} from "./ICommerceTypes.sol";
import {BlockingMixin} from "../moderation/BlockingMixin.sol";

/**
 * @title AuthCaptureEscrow
 * @author Jeju Network
 * @notice Two-phase payment escrow implementing Coinbase Commerce Protocol
 * @dev Enables authorize-and-capture payment flow for e-commerce:
 *      - Buyer authorizes payment (funds locked in escrow)
 *      - Merchant fulfills order
 *      - Merchant captures payment (funds released)
 *      - Supports void (before capture) and refund (after capture)
 *
 * Key Features:
 * - Gasless for buyers via EIP-3009 or Permit2
 * - Operator-sponsored gas (credit card model)
 * - Configurable operator fees
 * - Partial captures and refunds
 * - Time-limited authorizations
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract AuthCaptureEscrow is Ownable, ReentrancyGuard, EIP712, ICommerceEvents {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using BlockingMixin for BlockingMixin.Data;

    /// @notice Blocking registry for user-to-user blocks
    BlockingMixin.Data public blocking;

    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "PaymentAuthorization(address merchant,address token,uint256 amount,uint256 deadline,bytes32 orderRef,uint256 nonce)"
    );

    /// @notice Default authorization validity period (7 days)
    uint256 public constant DEFAULT_AUTH_DURATION = 7 days;

    /// @notice Maximum authorization duration (30 days)
    uint256 public constant MAX_AUTH_DURATION = 30 days;

    /// @notice Maximum operator fee (5%)
    uint256 public constant MAX_OPERATOR_FEE_BPS = 500;

    mapping(bytes32 => PaymentAuthorization) public authorizations;

    mapping(bytes32 => uint256) public capturedAmounts;
    mapping(bytes32 => uint256) public refundedAmounts;
    mapping(address => bool) public supportedTokens;
    mapping(address => bool) public registeredMerchants;
    mapping(address => OperatorConfig) public operators;
    mapping(address => uint256) public nonces;
    uint256 public protocolFeeBps = 100;
    address public feeRecipient;
    uint256 public totalProtocolFees;
    uint256 public totalVolume;

    error InvalidMerchant();
    error InvalidToken();
    error InvalidAmount();
    error InvalidPayment();
    error PaymentExpired();
    error PaymentAlreadyCaptured();
    error PaymentNotCaptured();
    error PaymentAlreadyVoided();
    error InsufficientCaptureAmount();
    error ExcessiveCapture();
    error ExcessiveRefund();
    error InvalidSignature();
    error InvalidOperator();
    error OperatorFeeTooHigh();
    error TransferFailed();
    error UserBlocked();

    constructor(address _owner, address _feeRecipient, address[] memory _initialTokens)
        Ownable(_owner)
        EIP712("Jeju Commerce Protocol", "1")
    {
        feeRecipient = _feeRecipient;

        for (uint256 i = 0; i < _initialTokens.length; i++) {
            supportedTokens[_initialTokens[i]] = true;
        }
    }

    /**
     * @notice Authorize a payment (lock funds in escrow)
     * @param merchant Merchant address
     * @param token Payment token
     * @param amount Amount to authorize
     * @param duration Authorization validity duration
     * @param orderRef External order reference
     * @return paymentId Unique payment identifier
     */
    function authorize(address merchant, address token, uint256 amount, uint256 duration, bytes32 orderRef)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        if (!registeredMerchants[merchant]) revert InvalidMerchant();
        if (!supportedTokens[token]) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (duration > MAX_AUTH_DURATION) duration = MAX_AUTH_DURATION;
        if (duration == 0) duration = DEFAULT_AUTH_DURATION;

        // Check if merchant has blocked the payer
        if (blocking.isBlocked(msg.sender, merchant)) revert UserBlocked();

        paymentId = keccak256(abi.encodePacked(msg.sender, merchant, token, amount, block.timestamp, orderRef));

        // Transfer tokens to escrow
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        authorizations[paymentId] = PaymentAuthorization({
            paymentId: paymentId,
            payer: msg.sender,
            merchant: merchant,
            token: token,
            amount: amount,
            authorizedAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            status: PaymentStatus.Authorized,
            orderRef: orderRef
        });

        emit PaymentAuthorized(paymentId, msg.sender, merchant, token, amount, block.timestamp + duration, orderRef);
    }

    /**
     * @notice Authorize payment with EIP-712 signature (gasless for payer)
     * @param payer Payer address
     * @param merchant Merchant address
     * @param token Payment token
     * @param amount Amount to authorize
     * @param deadline Signature deadline
     * @param orderRef External order reference
     * @param signature EIP-712 signature
     * @return paymentId Unique payment identifier
     */
    function authorizeWithSignature(
        address payer,
        address merchant,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes32 orderRef,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 paymentId) {
        if (!registeredMerchants[merchant]) revert InvalidMerchant();
        if (!supportedTokens[token]) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert PaymentExpired();

        // Check if merchant has blocked the payer
        if (blocking.isBlocked(payer, merchant)) revert UserBlocked();

        // Verify signature
        uint256 nonce = nonces[payer]++;
        bytes32 structHash =
            keccak256(abi.encode(AUTHORIZATION_TYPEHASH, merchant, token, amount, deadline, orderRef, nonce));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != payer) revert InvalidSignature();

        paymentId = keccak256(abi.encodePacked(payer, merchant, token, amount, block.timestamp, orderRef));

        // Transfer tokens to escrow
        IERC20(token).safeTransferFrom(payer, address(this), amount);

        uint256 expiresAt = block.timestamp + DEFAULT_AUTH_DURATION;

        authorizations[paymentId] = PaymentAuthorization({
            paymentId: paymentId,
            payer: payer,
            merchant: merchant,
            token: token,
            amount: amount,
            authorizedAt: block.timestamp,
            expiresAt: expiresAt,
            status: PaymentStatus.Authorized,
            orderRef: orderRef
        });

        emit PaymentAuthorized(paymentId, payer, merchant, token, amount, expiresAt, orderRef);
    }

    /**
     * @notice Capture an authorized payment (transfer to merchant)
     * @param paymentId Payment to capture
     * @param captureAmount Amount to capture (can be partial)
     * @param fulfillmentRef Proof of fulfillment
     */
    function capture(bytes32 paymentId, uint256 captureAmount, bytes32 fulfillmentRef) external nonReentrant {
        PaymentAuthorization storage auth = authorizations[paymentId];

        if (auth.status != PaymentStatus.Authorized) revert InvalidPayment();
        if (block.timestamp > auth.expiresAt) revert PaymentExpired();
        if (msg.sender != auth.merchant) revert InvalidMerchant();
        if (captureAmount == 0) revert InvalidAmount();

        uint256 remainingAmount = auth.amount - capturedAmounts[paymentId];
        if (captureAmount > remainingAmount) revert ExcessiveCapture();

        capturedAmounts[paymentId] += captureAmount;

        // Calculate fees
        uint256 protocolFee = (captureAmount * protocolFeeBps) / 10000;
        uint256 operatorFee = 0;

        // Check if called by operator
        OperatorConfig storage opConfig = operators[msg.sender];
        if (opConfig.isActive && msg.sender != auth.merchant) {
            operatorFee = (captureAmount * opConfig.operatorFeeBps) / 10000;
            opConfig.totalProcessed += captureAmount;
            opConfig.totalFees += operatorFee;
        }

        uint256 merchantAmount = captureAmount - protocolFee - operatorFee;

        // Transfer to merchant
        IERC20(auth.token).safeTransfer(auth.merchant, merchantAmount);

        // Transfer protocol fee
        if (protocolFee > 0 && feeRecipient != address(0)) {
            IERC20(auth.token).safeTransfer(feeRecipient, protocolFee);
            totalProtocolFees += protocolFee;
        }

        // Transfer operator fee
        if (operatorFee > 0) {
            IERC20(auth.token).safeTransfer(msg.sender, operatorFee);
        }

        // Update status if fully captured
        if (capturedAmounts[paymentId] >= auth.amount) {
            auth.status = PaymentStatus.Captured;
        }

        totalVolume += captureAmount;

        emit PaymentCaptured(paymentId, auth.merchant, captureAmount, operatorFee, fulfillmentRef);
    }

    /**
     * @notice Capture via operator (merchant delegates to operator)
     * @param request Capture request details
     * @param merchantSignature Merchant's signature authorizing capture
     */
    function captureForMerchant(CaptureRequest calldata request, bytes calldata merchantSignature)
        external
        nonReentrant
    {
        OperatorConfig storage opConfig = operators[msg.sender];
        if (!opConfig.isActive) revert InvalidOperator();

        PaymentAuthorization storage auth = authorizations[request.paymentId];
        if (auth.status != PaymentStatus.Authorized) revert InvalidPayment();
        if (block.timestamp > auth.expiresAt) revert PaymentExpired();

        // Verify merchant signature (simplified for this implementation)
        bytes32 captureHash =
            keccak256(abi.encodePacked(request.paymentId, request.captureAmount, request.fulfillmentRef));
        address signer = ECDSA.recover(captureHash.toEthSignedMessageHash(), merchantSignature);
        if (signer != auth.merchant) revert InvalidMerchant();

        // Execute capture (reuse logic)
        _executeCapture(auth, request.captureAmount, request.fulfillmentRef, opConfig);
    }

    /**
     * @notice Void an authorization (return funds to payer)
     * @param paymentId Payment to void
     */
    function void_(bytes32 paymentId) external nonReentrant {
        PaymentAuthorization storage auth = authorizations[paymentId];

        if (auth.status != PaymentStatus.Authorized) revert InvalidPayment();
        if (msg.sender != auth.payer && msg.sender != auth.merchant && msg.sender != owner()) {
            revert InvalidMerchant();
        }

        // Can only void uncaptured amount
        uint256 captured = capturedAmounts[paymentId];
        if (captured >= auth.amount) revert PaymentAlreadyCaptured();

        uint256 refundAmount = auth.amount - captured;
        auth.status = PaymentStatus.Voided;

        // Return funds to payer
        IERC20(auth.token).safeTransfer(auth.payer, refundAmount);

        emit PaymentVoided(paymentId, auth.payer, refundAmount);
    }

    /**
     * @notice Void expired authorization (anyone can call)
     * @param paymentId Expired payment to void
     */
    function voidExpired(bytes32 paymentId) external nonReentrant {
        PaymentAuthorization storage auth = authorizations[paymentId];

        if (auth.status != PaymentStatus.Authorized) revert InvalidPayment();
        if (block.timestamp <= auth.expiresAt) revert PaymentExpired();

        uint256 captured = capturedAmounts[paymentId];
        uint256 refundAmount = auth.amount - captured;

        auth.status = PaymentStatus.Voided;

        if (refundAmount > 0) {
            IERC20(auth.token).safeTransfer(auth.payer, refundAmount);
        }

        emit PaymentVoided(paymentId, auth.payer, refundAmount);
    }

    /**
     * @notice Refund a captured payment
     * @param paymentId Payment to refund
     * @param refundAmount Amount to refund
     * @param reason Refund reason
     */
    function refund(bytes32 paymentId, uint256 refundAmount, string calldata reason) external nonReentrant {
        PaymentAuthorization storage auth = authorizations[paymentId];

        if (auth.status != PaymentStatus.Captured && auth.status != PaymentStatus.Authorized) {
            revert InvalidPayment();
        }
        if (msg.sender != auth.merchant) revert InvalidMerchant();
        if (refundAmount == 0) revert InvalidAmount();

        uint256 captured = capturedAmounts[paymentId];
        uint256 alreadyRefunded = refundedAmounts[paymentId];
        if (refundAmount > captured - alreadyRefunded) revert ExcessiveRefund();

        refundedAmounts[paymentId] += refundAmount;

        // Merchant must have approved tokens for refund
        IERC20(auth.token).safeTransferFrom(msg.sender, auth.payer, refundAmount);

        if (refundedAmounts[paymentId] >= captured) {
            auth.status = PaymentStatus.Refunded;
        }

        emit PaymentRefunded(paymentId, auth.payer, refundAmount, reason);
    }

    /**
     * @notice Get payment details
     */
    function getPayment(bytes32 paymentId)
        external
        view
        returns (PaymentAuthorization memory auth, uint256 captured, uint256 refunded, uint256 available)
    {
        auth = authorizations[paymentId];
        captured = capturedAmounts[paymentId];
        refunded = refundedAmounts[paymentId];
        available = auth.amount > captured ? auth.amount - captured : 0;
    }

    /**
     * @notice Get operator stats
     */
    function getOperatorStats(address operator)
        external
        view
        returns (uint256 processed, uint256 fees, uint256 feeBps, bool active)
    {
        OperatorConfig storage config = operators[operator];
        return (config.totalProcessed, config.totalFees, config.operatorFeeBps, config.isActive);
    }

    /**
     * @notice Get protocol stats
     */
    function getProtocolStats() external view returns (uint256 volume, uint256 fees, uint256 feeBps) {
        return (totalVolume, totalProtocolFees, protocolFeeBps);
    }

    function registerMerchant(address merchant, bool registered) external onlyOwner {
        registeredMerchants[merchant] = registered;
    }

    function registerOperator(address operator, uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_OPERATOR_FEE_BPS) revert OperatorFeeTooHigh();

        operators[operator] = OperatorConfig({
            operator: operator,
            operatorFeeBps: feeBps,
            isActive: true,
            totalProcessed: 0,
            totalFees: 0
        });

        emit OperatorRegistered(operator, feeBps);
    }

    function updateOperator(address operator, uint256 feeBps, bool active) external onlyOwner {
        if (feeBps > MAX_OPERATOR_FEE_BPS) revert OperatorFeeTooHigh();

        OperatorConfig storage config = operators[operator];
        config.operatorFeeBps = feeBps;
        config.isActive = active;

        emit OperatorUpdated(operator, feeBps, active);
    }

    function setTokenSupported(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 500, "Fee too high"); // Max 5%
        protocolFeeBps = feeBps;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        feeRecipient = recipient;
    }

    function setBlockRegistry(address _blockRegistry) external onlyOwner {
        blocking.setBlockRegistry(_blockRegistry);
    }

    function isPaymentBlocked(address payer, address merchant) external view returns (bool) {
        return blocking.isBlocked(payer, merchant);
    }

    function _executeCapture(
        PaymentAuthorization storage auth,
        uint256 captureAmount,
        bytes32 fulfillmentRef,
        OperatorConfig storage opConfig
    ) internal {
        uint256 remainingAmount = auth.amount - capturedAmounts[auth.paymentId];
        if (captureAmount > remainingAmount) revert ExcessiveCapture();

        capturedAmounts[auth.paymentId] += captureAmount;

        uint256 protocolFee = (captureAmount * protocolFeeBps) / 10000;
        uint256 operatorFee = (captureAmount * opConfig.operatorFeeBps) / 10000;
        uint256 merchantAmount = captureAmount - protocolFee - operatorFee;

        IERC20(auth.token).safeTransfer(auth.merchant, merchantAmount);

        if (protocolFee > 0 && feeRecipient != address(0)) {
            IERC20(auth.token).safeTransfer(feeRecipient, protocolFee);
            totalProtocolFees += protocolFee;
        }

        if (operatorFee > 0) {
            IERC20(auth.token).safeTransfer(opConfig.operator, operatorFee);
            opConfig.totalFees += operatorFee;
        }

        opConfig.totalProcessed += captureAmount;

        if (capturedAmounts[auth.paymentId] >= auth.amount) {
            auth.status = PaymentStatus.Captured;
        }

        totalVolume += captureAmount;

        emit PaymentCaptured(auth.paymentId, auth.merchant, captureAmount, operatorFee, fulfillmentRef);
    }
}
