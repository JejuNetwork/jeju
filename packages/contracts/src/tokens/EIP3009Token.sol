// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title EIP3009Token
 * @notice ERC20 with EIP-3009 transferWithAuthorization for gasless transfers
 * @dev Implements EIP-3009 standard used by Circle USDC for meta-transactions
 *
 * EIP-3009 allows users to sign transfer authorizations off-chain, enabling:
 * - Gasless token transfers (relayer pays gas)
 * - Batch transfers with single signature per sender
 * - Better UX for users without native tokens
 *
 * Use cases:
 * - x402 gasless payments (user signs, facilitator relays)
 * - Sponsored transactions
 * - Mobile/web wallets without ETH
 */
contract EIP3009Token is ERC20, Ownable, EIP712 {
    using ECDSA for bytes32;

    uint8 private immutable _tokenDecimals;

    // EIP-3009 typehashes
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    // Mapping of authorizer => nonce => used
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    // Events
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    // Errors
    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error InvalidSignature();
    error CallerMustBePayee();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
        EIP712(name_, "1")
    {
        _tokenDecimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    /**
     * @notice Execute a transfer with a signed authorization (EIP-3009)
     * @param from Payer's address (authorizer)
     * @param to Payee's address
     * @param value Amount to transfer
     * @param validAfter Authorization valid after this timestamp
     * @param validBefore Authorization valid before this timestamp
     * @param nonce Unique nonce for this authorization
     * @param signature Signature bytes (r || s || v)
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));

        _verifySignature(from, structHash, signature);
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Execute a transfer with authorization (v, r, s format)
     * @dev Alternative signature format for compatibility
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));

        bytes memory signature = abi.encodePacked(r, s, v);
        _verifySignature(from, structHash, signature);
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Receive a transfer with authorization (caller must be payee)
     * @dev Only the payee can call this, providing additional security
     */
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));

        _verifySignature(from, structHash, signature);
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Cancel an authorization before it's used
     * @param authorizer The address that signed the authorization
     * @param nonce The nonce to cancel
     * @param signature Signature from the authorizer
     */
    function cancelAuthorization(address authorizer, bytes32 nonce, bytes calldata signature) external {
        if (authorizationState[authorizer][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));

        _verifySignature(authorizer, structHash, signature);
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /**
     * @notice Get the EIP-712 domain separator
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============ Owner Functions ============

    /**
     * @notice Mint tokens (owner only)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from sender
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Faucet for testing (gives 100,000 tokens)
     */
    function faucet() external {
        _mint(msg.sender, 100_000 * 10 ** _tokenDecimals);
    }

    // ============ Internal Functions ============

    function _requireValidAuthorization(address authorizer, bytes32 nonce, uint256 validAfter, uint256 validBefore)
        internal
        view
    {
        if (authorizationState[authorizer][nonce]) revert AuthorizationAlreadyUsed();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
    }

    function _verifySignature(address signer, bytes32 structHash, bytes memory signature) internal view {
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != signer) revert InvalidSignature();
    }

    function _markAuthorizationUsed(address authorizer, bytes32 nonce) internal {
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationUsed(authorizer, nonce);
    }
}

// Note: For full-featured tokens, use Token.sol which includes EIP-3009
// along with trading fees, cross-chain, moderation, and more.
