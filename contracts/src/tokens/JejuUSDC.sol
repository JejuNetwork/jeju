// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title JejuUSDC
 * @author Jeju Network
 * @notice USDC stablecoin implementation for Jeju Network
 * @dev ERC-20 token with:
 *      - 6 decimals (matching Circle USDC)
 *      - EIP-2612 permit support for gasless approvals
 *      - Minting controlled by owner (bridge or treasury)
 *      - Burnable by anyone holding tokens
 *      - EIP-3009 transfer with authorization support (x402 compatible)
 *
 * This contract can be:
 * 1. Deployed as native USDC on Jeju (with Circle attestation if possible)
 * 2. Deployed as bridged USDC (minted when locked on Base)
 * 3. Used for testnet with faucet functionality
 *
 * @custom:security-contact security@jeju.network
 */
contract JejuUSDC is ERC20, ERC20Permit, Ownable {
    // ============ Constants ============

    /// @notice USDC uses 6 decimals (matching Circle USDC)
    uint8 private constant DECIMALS = 6;

    /// @notice EIP-3009 typehash for transferWithAuthorization
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    /// @notice EIP-3009 typehash for receiveWithAuthorization
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    // ============ State Variables ============

    /// @notice Mapping to track used nonces for EIP-3009
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    /// @notice Treasury address authorized to mint
    address public treasury;

    /// @notice Whether testnet faucet is enabled
    bool public faucetEnabled;

    /// @notice Amount distributed per faucet call (default 100 USDC)
    uint256 public faucetAmount = 100 * 10**DECIMALS;

    /// @notice Cooldown period between faucet calls (default 24 hours)
    uint256 public faucetCooldown = 24 hours;

    /// @notice Last faucet claim timestamp per address
    mapping(address => uint256) public lastFaucetClaim;

    // ============ Events ============

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FaucetConfigured(bool enabled, uint256 amount, uint256 cooldown);
    event FaucetClaimed(address indexed recipient, uint256 amount);

    // ============ Errors ============

    error AuthorizationAlreadyUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid(uint256 currentTimestamp, uint256 validAfter);
    error AuthorizationExpired(uint256 currentTimestamp, uint256 validBefore);
    error InvalidAuthorization();
    error FaucetDisabled();
    error FaucetCooldownActive(uint256 remainingTime);
    error FaucetAlreadyClaimed();

    // ============ Constructor ============

    /**
     * @notice Deploys Jeju USDC token
     * @param _treasury Address authorized to mint tokens (bridge or treasury)
     * @param _initialSupply Initial supply to mint to deployer
     * @param _enableFaucet Whether to enable testnet faucet
     */
    constructor(
        address _treasury,
        uint256 _initialSupply,
        bool _enableFaucet
    ) ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") Ownable(msg.sender) {
        require(_treasury != address(0), "Invalid treasury");
        
        treasury = _treasury;
        faucetEnabled = _enableFaucet;

        if (_initialSupply > 0) {
            _mint(msg.sender, _initialSupply);
        }
    }

    // ============ ERC-20 Overrides ============

    /// @notice Returns 6 decimals (matching Circle USDC)
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    // ============ Minting & Burning ============

    /**
     * @notice Mints USDC tokens
     * @param to Recipient address
     * @param amount Amount to mint (6 decimals)
     * @dev Only callable by owner or treasury
     */
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner() || msg.sender == treasury, "Unauthorized");
        _mint(to, amount);
    }

    /**
     * @notice Burns USDC tokens from caller's balance
     * @param amount Amount to burn (6 decimals)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ============ EIP-3009: Transfer With Authorization ============

    /**
     * @notice Execute a transfer with a signed authorization (EIP-3009)
     * @param from Payer's address (Authorizer)
     * @param to Payee's address
     * @param value Amount to be transferred (6 decimals)
     * @param validAfter The time after which this is valid (unix time)
     * @param validBefore The time before which this is valid (unix time)
     * @param nonce Unique nonce
     * @param v Signature v
     * @param r Signature r
     * @param s Signature s
     * @dev This is the core function for x402 payment integration
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

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce
                )
            )
        );

        address signer = ecrecover(digest, v, r, s);
        if (signer != from) revert InvalidAuthorization();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }

    /**
     * @notice Receive a transfer with a signed authorization (EIP-3009)
     * @param from Payer's address (Authorizer)
     * @param to Payee's address (must be msg.sender)
     * @param value Amount to be transferred (6 decimals)
     * @param validAfter The time after which this is valid (unix time)
     * @param validBefore The time before which this is valid (unix time)
     * @param nonce Unique nonce
     * @param v Signature v
     * @param r Signature r
     * @param s Signature s
     * @dev Allows payee to claim a transfer signed by payer
     */
    function receiveWithAuthorization(
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
        require(to == msg.sender, "Caller must be payee");
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce
                )
            )
        );

        address signer = ecrecover(digest, v, r, s);
        if (signer != from) revert InvalidAuthorization();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }

    /**
     * @notice Cancel an authorization by marking nonce as used
     * @param authorizer Authorizer's address
     * @param nonce Nonce to cancel
     * @dev Prevents replay of a signed authorization
     */
    function cancelAuthorization(address authorizer, bytes32 nonce) external {
        require(msg.sender == authorizer, "Only authorizer can cancel");
        require(!authorizationState[authorizer][nonce], "Already used");
        
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    // ============ Testnet Faucet ============

    /**
     * @notice Claims USDC from testnet faucet
     * @dev Only works if faucet is enabled and cooldown has passed
     */
    function faucet() external {
        if (!faucetEnabled) revert FaucetDisabled();
        
        uint256 lastClaim = lastFaucetClaim[msg.sender];
        if (lastClaim > 0) {
            uint256 timeSince = block.timestamp - lastClaim;
            if (timeSince < faucetCooldown) {
                revert FaucetCooldownActive(faucetCooldown - timeSince);
            }
        }

        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
        
        emit FaucetClaimed(msg.sender, faucetAmount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Configures faucet parameters
     * @param enabled Whether faucet is enabled
     * @param amount Amount per faucet claim
     * @param cooldown Cooldown period between claims
     */
    function configureFaucet(
        bool enabled,
        uint256 amount,
        uint256 cooldown
    ) external onlyOwner {
        faucetEnabled = enabled;
        faucetAmount = amount;
        faucetCooldown = cooldown;
        emit FaucetConfigured(enabled, amount, cooldown);
    }

    // ============ Internal Helpers ============

    /**
     * @dev Validates authorization parameters
     */
    function _requireValidAuthorization(
        address authorizer,
        bytes32 nonce,
        uint256 validAfter,
        uint256 validBefore
    ) private view {
        if (authorizationState[authorizer][nonce]) {
            revert AuthorizationAlreadyUsed(authorizer, nonce);
        }
        if (block.timestamp < validAfter) {
            revert AuthorizationNotYetValid(block.timestamp, validAfter);
        }
        if (block.timestamp > validBefore) {
            revert AuthorizationExpired(block.timestamp, validBefore);
        }
    }
}

