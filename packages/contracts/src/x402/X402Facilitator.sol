// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title X402Facilitator
 * @author Jeju Network
 * @notice On-chain settlement for x402 HTTP 402 payments
 * @dev Implements the facilitator role for x402 protocol, handling:
 *      - EIP-712 payment signature verification
 *      - EIP-3009 transferWithAuthorization for gasless USDC transfers
 *      - Settlement tracking and replay prevention
 *      - Multi-token support (USDC, USDT, DAI, etc.)
 *
 * Flow:
 * 1. User signs x402 payment payload (EIP-712)
 * 2. Service verifies signature off-chain
 * 3. Service calls settle() with payment details
 * 4. Contract verifies signature, transfers tokens, emits event
 * 5. Service provides resource to user
 *
 * IMPORTANT LIMITATIONS:
 * - Signature verification hardcodes scheme="exact" and network="jeju"
 * - Payments MUST be signed with these values for verification to succeed
 * - This contract is network-specific to Jeju (chainId 420691)
 * - For multi-network support, deploy separate contracts per network
 *
 * @custom:security-contact security@jeju.network
 */
contract X402Facilitator is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Constants ============

    bytes32 public constant PAYMENT_TYPEHASH = keccak256(
        "Payment(string scheme,string network,address asset,address payTo,uint256 amount,string resource,string nonce,uint256 timestamp)"
    );

    /// @notice Maximum time window for payment validity (5 minutes)
    uint256 public constant MAX_PAYMENT_AGE = 300;

    // ============ State Variables ============

    /// @notice Mapping of nonce => used (prevents replay)
    mapping(bytes32 => bool) public usedNonces;

    /// @notice Mapping of token => supported
    mapping(address => bool) public supportedTokens;

    /// @notice Mapping of token => decimals (for volume normalization)
    mapping(address => uint8) public tokenDecimals;

    /// @notice Mapping of service => authorized to settle
    mapping(address => bool) public authorizedServices;

    /// @notice Protocol fee in basis points (100 = 1%)
    uint256 public protocolFeeBps = 50; // 0.5% default

    /// @notice Protocol fee recipient
    address public feeRecipient;

    /// @notice Total settlements processed
    uint256 public totalSettlements;

    /// @notice Total volume settled (in USD, 18 decimals)
    uint256 public totalVolumeUSD;

    // ============ Events ============

    event PaymentSettled(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 protocolFee,
        string resource,
        uint256 timestamp
    );

    event ServiceAuthorized(address indexed service, bool authorized);
    event TokenSupported(address indexed token, bool supported);
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ============ Errors ============

    error InvalidSignature();
    error PaymentExpired();
    error NonceAlreadyUsed();
    error UnsupportedToken();
    error InvalidAmount();
    error InvalidRecipient();
    error TransferFailed();

    // ============ Constructor ============

    constructor(address _owner, address _feeRecipient, address[] memory _initialTokens)
        Ownable(_owner)
        EIP712("x402 Payment Protocol", "1")
    {
        feeRecipient = _feeRecipient;

        for (uint256 i = 0; i < _initialTokens.length; i++) {
            supportedTokens[_initialTokens[i]] = true;
            emit TokenSupported(_initialTokens[i], true);
        }
    }

    // ============ Settlement Functions ============

    /**
     * @notice Settle an x402 payment
     * @param payer Address that signed the payment
     * @param recipient Address to receive payment
     * @param token Payment token address
     * @param amount Payment amount
     * @param resource Resource being paid for
     * @param nonce Unique payment nonce
     * @param timestamp Payment timestamp
     * @param signature EIP-712 signature from payer
     */
    function settle(
        address payer,
        address recipient,
        address token,
        uint256 amount,
        string calldata resource,
        string calldata nonce,
        uint256 timestamp,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 paymentId) {
        // Validate inputs
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (!supportedTokens[token]) revert UnsupportedToken();

        // Check timestamp (within 5 minutes)
        if (block.timestamp > timestamp + MAX_PAYMENT_AGE) revert PaymentExpired();

        // Check nonce
        bytes32 nonceHash = keccak256(abi.encodePacked(payer, nonce));
        if (usedNonces[nonceHash]) revert NonceAlreadyUsed();

        // Verify signature - accept both "exact" and "upto" schemes
        bytes32 schemeHashExact = keccak256(bytes("exact"));
        bytes32 structHashExact = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                schemeHashExact,
                keccak256(bytes("jeju")), // network
                token,
                recipient,
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        // Try "exact" first, then "upto" if that fails
        bytes32 digestExact = _hashTypedDataV4(structHashExact);
        address signer = ECDSA.recover(digestExact, signature);

        if (signer != payer) {
            // Try "upto" scheme
            bytes32 schemeHashUpto = keccak256(bytes("upto"));
            bytes32 structHashUpto = keccak256(
                abi.encode(
                    PAYMENT_TYPEHASH,
                    schemeHashUpto,
                    keccak256(bytes("jeju")),
                    token,
                    recipient,
                    amount,
                    keccak256(bytes(resource)),
                    keccak256(bytes(nonce)),
                    timestamp
                )
            );
            bytes32 digestUpto = _hashTypedDataV4(structHashUpto);
            signer = ECDSA.recover(digestUpto, signature);
        }

        if (signer != payer) revert InvalidSignature();

        // Mark nonce as used
        usedNonces[nonceHash] = true;

        // Calculate fee
        uint256 protocolFee = (amount * protocolFeeBps) / 10000;
        uint256 recipientAmount = amount - protocolFee;

        // Generate payment ID
        paymentId = keccak256(abi.encodePacked(payer, recipient, nonce, block.timestamp));

        // Transfer tokens
        IERC20(token).safeTransferFrom(payer, recipient, recipientAmount);
        if (protocolFee > 0) {
            IERC20(token).safeTransferFrom(payer, feeRecipient, protocolFee);
        }

        // Update stats
        totalSettlements++;
        // Normalize to 18 decimals for volume tracking
        uint8 decimals = tokenDecimals[token];
        if (decimals == 0) decimals = 6; // Default to USDC-like tokens
        totalVolumeUSD += amount * (10 ** (18 - decimals));

        emit PaymentSettled(paymentId, payer, recipient, token, amount, protocolFee, resource, block.timestamp);
    }

    /**
     * @notice Settle using EIP-3009 transferWithAuthorization (gasless for payer)
     * @dev Payer pre-signs authorization, service submits and pays gas
     */
    function settleWithAuthorization(
        address payer,
        address recipient,
        address token,
        uint256 amount,
        string calldata resource,
        string calldata nonce,
        uint256 timestamp,
        bytes calldata paymentSignature,
        // EIP-3009 authorization params
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        bytes calldata authSignature
    ) external nonReentrant returns (bytes32 paymentId) {
        // Validate inputs
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (!supportedTokens[token]) revert UnsupportedToken();

        // Check payment timestamp
        if (block.timestamp > timestamp + MAX_PAYMENT_AGE) revert PaymentExpired();

        // Check nonce
        bytes32 nonceHash = keccak256(abi.encodePacked(payer, nonce));
        if (usedNonces[nonceHash]) revert NonceAlreadyUsed();

        // Verify payment signature - accept both "exact" and "upto" schemes
        bytes32 schemeHashExact = keccak256(bytes("exact"));
        bytes32 structHashExact = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                schemeHashExact,
                keccak256(bytes("jeju")),
                token,
                recipient,
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        bytes32 digestExact = _hashTypedDataV4(structHashExact);
        address signer = ECDSA.recover(digestExact, paymentSignature);

        if (signer != payer) {
            // Try "upto" scheme
            bytes32 schemeHashUpto = keccak256(bytes("upto"));
            bytes32 structHashUpto = keccak256(
                abi.encode(
                    PAYMENT_TYPEHASH,
                    schemeHashUpto,
                    keccak256(bytes("jeju")),
                    token,
                    recipient,
                    amount,
                    keccak256(bytes(resource)),
                    keccak256(bytes(nonce)),
                    timestamp
                )
            );
            bytes32 digestUpto = _hashTypedDataV4(structHashUpto);
            signer = ECDSA.recover(digestUpto, paymentSignature);
        }

        if (signer != payer) revert InvalidSignature();

        // Mark nonce as used
        usedNonces[nonceHash] = true;

        // Calculate amounts
        uint256 protocolFee = (amount * protocolFeeBps) / 10000;
        uint256 recipientAmount = amount - protocolFee;

        // Generate payment ID
        paymentId = keccak256(abi.encodePacked(payer, recipient, nonce, block.timestamp));

        // Execute EIP-3009 transfer
        // This requires the token to support transferWithAuthorization
        _executeTransferWithAuthorization(
            token, payer, address(this), amount, validAfter, validBefore, authNonce, authSignature
        );

        // Distribute funds
        IERC20(token).safeTransfer(recipient, recipientAmount);
        if (protocolFee > 0) {
            IERC20(token).safeTransfer(feeRecipient, protocolFee);
        }

        // Update stats
        totalSettlements++;
        // Normalize to 18 decimals for volume tracking
        uint8 decimals = tokenDecimals[token];
        if (decimals == 0) decimals = 6; // Default to USDC-like tokens
        totalVolumeUSD += amount * (10 ** (18 - decimals));

        emit PaymentSettled(paymentId, payer, recipient, token, amount, protocolFee, resource, block.timestamp);
    }

    /**
     * @notice Execute EIP-3009 transferWithAuthorization
     */
    function _executeTransferWithAuthorization(
        address token,
        address from,
        address to,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        bytes calldata signature
    ) internal {
        // Call transferWithAuthorization on USDC (EIP-3009)
        // Function signature: transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
        bytes memory data = abi.encodeWithSignature(
            "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
            from,
            to,
            amount,
            validAfter,
            validBefore,
            authNonce,
            signature
        );

        (bool success,) = token.call(data);
        if (!success) revert TransferFailed();
    }

    // ============ View Functions ============

    /**
     * @notice Check if a nonce has been used
     */
    function isNonceUsed(address payer, string calldata nonce) external view returns (bool) {
        return usedNonces[keccak256(abi.encodePacked(payer, nonce))];
    }

    /**
     * @notice Get the EIP-712 domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Hash a payment for signing
     */
    function hashPayment(
        address token,
        address recipient,
        uint256 amount,
        string calldata resource,
        string calldata nonce,
        uint256 timestamp
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes("exact")),
                keccak256(bytes("jeju")),
                token,
                recipient,
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Get facilitator stats
     */
    function getStats()
        external
        view
        returns (uint256 settlements, uint256 volumeUSD, uint256 feeBps, address feeAddr)
    {
        return (totalSettlements, totalVolumeUSD, protocolFeeBps, feeRecipient);
    }

    // ============ Admin Functions ============

    function setTokenSupported(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupported(token, supported);
    }

    function setTokenDecimals(address token, uint8 decimals) external onlyOwner {
        require(decimals <= 18, "Invalid decimals");
        tokenDecimals[token] = decimals;
    }

    function setAuthorizedService(address service, bool authorized) external onlyOwner {
        authorizedServices[service] = authorized;
        emit ServiceAuthorized(service, authorized);
    }

    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1000, "Fee too high"); // Max 10%
        emit ProtocolFeeUpdated(protocolFeeBps, newFeeBps);
        protocolFeeBps = newFeeBps;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Invalid recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Emergency token recovery
     */
    function recoverTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
