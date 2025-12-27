// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ICommerceTypes
 * @notice Type definitions for Coinbase Commerce Protocol implementation
 * @dev Based on the open-source Coinbase Commerce Payments Protocol
 * @custom:security-contact security@jejunetwork.org
 */

/// @notice Payment status enum
enum PaymentStatus {
    None, // Not created
    Authorized, // Funds locked, pending capture
    Captured, // Funds transferred to merchant
    Voided, // Authorization cancelled, funds returned
    Refunded // Captured payment refunded

}

/// @notice Authorization method for token transfers
enum AuthorizationMethod {
    EIP3009, // TransferWithAuthorization (USDC)
    Permit2, // Uniswap Permit2
    Approval // Standard ERC-20 approval

}

/// @notice Payment authorization data
struct PaymentAuthorization {
    bytes32 paymentId; // Unique payment identifier
    address payer; // Buyer address
    address merchant; // Merchant address
    address token; // Payment token
    uint256 amount; // Authorized amount
    uint256 authorizedAt; // Authorization timestamp
    uint256 expiresAt; // Authorization expiry
    PaymentStatus status; // Current status
    bytes32 orderRef; // External order reference
}

/// @notice Capture request data
struct CaptureRequest {
    bytes32 paymentId;
    uint256 captureAmount; // Amount to capture (can be less than authorized)
    bytes32 fulfillmentRef; // Proof of fulfillment
}

/// @notice Refund request data
struct RefundRequest {
    bytes32 paymentId;
    uint256 refundAmount;
    string reason;
}

/// @notice Operator configuration
struct OperatorConfig {
    address operator; // Operator address (pays gas)
    uint256 operatorFeeBps; // Operator fee in basis points
    bool isActive; // Whether operator is active
    uint256 totalProcessed; // Total volume processed
    uint256 totalFees; // Total fees earned
}

/// @notice Events for commerce protocol
interface ICommerceEvents {
    event PaymentAuthorized(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 expiresAt,
        bytes32 orderRef
    );

    event PaymentCaptured(
        bytes32 indexed paymentId,
        address indexed merchant,
        uint256 capturedAmount,
        uint256 operatorFee,
        bytes32 fulfillmentRef
    );

    event PaymentVoided(bytes32 indexed paymentId, address indexed payer, uint256 amount);

    event PaymentRefunded(bytes32 indexed paymentId, address indexed payer, uint256 refundAmount, string reason);

    event OperatorRegistered(address indexed operator, uint256 feeBps);

    event OperatorUpdated(address indexed operator, uint256 newFeeBps, bool isActive);
}
