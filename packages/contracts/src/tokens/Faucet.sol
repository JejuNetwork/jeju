// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Faucet
 * @author Jeju Network
 * @notice Multi-token testnet faucet with rate limiting
 * @dev Supports both native ETH and ERC20 tokens
 *
 * Features:
 * - Drip multiple tokens in one transaction
 * - Per-address cooldown (default 24h)
 * - Per-token configurable amounts
 * - Allowlist/denylist support
 * - Funded by depositing tokens
 *
 * @custom:security-contact security@jeju.network
 */
contract Faucet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Structs
    // =========================================================================

    struct TokenConfig {
        uint256 amount;         // Amount to drip per claim
        bool enabled;           // Whether this token is active
        uint256 totalDripped;   // Total amount dripped
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice Cooldown between claims (default 24 hours)
    uint256 public cooldown = 24 hours;

    /// @notice Native ETH drip amount
    uint256 public ethDripAmount = 0.1 ether;

    /// @notice Whether ETH dripping is enabled
    bool public ethEnabled = true;

    /// @notice Last claim timestamp per address
    mapping(address => uint256) public lastClaim;

    /// @notice Token configurations
    mapping(address => TokenConfig) public tokens;

    /// @notice List of supported tokens
    address[] public tokenList;

    /// @notice Allowlist (if empty, anyone can claim)
    mapping(address => bool) public allowlist;
    bool public allowlistEnabled;

    /// @notice Denylist (always checked)
    mapping(address => bool) public denylist;

    /// @notice Total ETH dripped
    uint256 public totalEthDripped;

    /// @notice Total claims made
    uint256 public totalClaims;

    // =========================================================================
    // Events
    // =========================================================================

    event Dripped(address indexed recipient, address indexed token, uint256 amount);
    event DrippedETH(address indexed recipient, uint256 amount);
    event TokenConfigured(address indexed token, uint256 amount, bool enabled);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event EthConfigUpdated(uint256 amount, bool enabled);
    event FundsDeposited(address indexed token, address indexed from, uint256 amount);
    event FundsWithdrawn(address indexed token, address indexed to, uint256 amount);
    event AllowlistUpdated(address indexed account, bool allowed);
    event DenylistUpdated(address indexed account, bool denied);

    // =========================================================================
    // Errors
    // =========================================================================

    error CooldownActive(uint256 remainingTime);
    error TokenNotEnabled(address token);
    error InsufficientBalance(address token, uint256 available, uint256 required);
    error NotAllowed();
    error Denied();
    error TransferFailed();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _owner) Ownable(_owner) {}

    // =========================================================================
    // Drip Functions
    // =========================================================================

    /**
     * @notice Claim from faucet (ETH + all enabled tokens)
     */
    function drip() external nonReentrant {
        _drip(msg.sender);
    }

    /**
     * @notice Claim for another address (ETH + all enabled tokens)
     * @param recipient Address to receive funds
     */
    function dripTo(address recipient) external nonReentrant {
        _drip(recipient);
    }

    /**
     * @notice Claim specific token only
     * @param token Token address (address(0) for ETH only)
     */
    function dripToken(address token) external nonReentrant {
        _checkEligibility(msg.sender);
        lastClaim[msg.sender] = block.timestamp;
        totalClaims++;

        if (token == address(0)) {
            _dripEth(msg.sender);
        } else {
            _dripToken(msg.sender, token);
        }
    }

    function _drip(address recipient) internal {
        _checkEligibility(recipient);
        lastClaim[recipient] = block.timestamp;
        totalClaims++;

        // Drip ETH if enabled
        if (ethEnabled && ethDripAmount > 0 && address(this).balance >= ethDripAmount) {
            _dripEth(recipient);
        }

        // Drip all enabled tokens
        for (uint256 i = 0; i < tokenList.length; i++) {
            address token = tokenList[i];
            TokenConfig storage config = tokens[token];
            
            if (config.enabled && config.amount > 0) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance >= config.amount) {
                    _dripToken(recipient, token);
                }
            }
        }
    }

    function _dripEth(address recipient) internal {
        if (!ethEnabled || ethDripAmount == 0) revert TokenNotEnabled(address(0));
        if (address(this).balance < ethDripAmount) {
            revert InsufficientBalance(address(0), address(this).balance, ethDripAmount);
        }

        totalEthDripped += ethDripAmount;
        
        (bool success,) = recipient.call{value: ethDripAmount}("");
        if (!success) revert TransferFailed();
        
        emit DrippedETH(recipient, ethDripAmount);
    }

    function _dripToken(address recipient, address token) internal {
        TokenConfig storage config = tokens[token];
        if (!config.enabled) revert TokenNotEnabled(token);
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < config.amount) {
            revert InsufficientBalance(token, balance, config.amount);
        }

        config.totalDripped += config.amount;
        IERC20(token).safeTransfer(recipient, config.amount);
        
        emit Dripped(recipient, token, config.amount);
    }

    function _checkEligibility(address account) internal view {
        // Check denylist
        if (denylist[account]) revert Denied();
        
        // Check allowlist
        if (allowlistEnabled && !allowlist[account]) revert NotAllowed();
        
        // Check cooldown
        uint256 nextClaimTime = lastClaim[account] + cooldown;
        if (block.timestamp < nextClaimTime) {
            revert CooldownActive(nextClaimTime - block.timestamp);
        }
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Check if address can claim
     */
    function canClaim(address account) external view returns (bool eligible, uint256 cooldownRemaining) {
        if (denylist[account]) return (false, 0);
        if (allowlistEnabled && !allowlist[account]) return (false, 0);
        
        uint256 nextClaimTime = lastClaim[account] + cooldown;
        if (block.timestamp < nextClaimTime) {
            return (false, nextClaimTime - block.timestamp);
        }
        
        return (true, 0);
    }

    /**
     * @notice Get all supported tokens
     */
    function getSupportedTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /**
     * @notice Get token configuration
     */
    function getTokenConfig(address token) external view returns (uint256 amount, bool enabled, uint256 balance, uint256 totalDripped_) {
        TokenConfig storage config = tokens[token];
        uint256 bal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        return (config.amount, config.enabled, bal, config.totalDripped);
    }

    /**
     * @notice Get faucet statistics
     */
    function getStats() external view returns (
        uint256 _totalClaims,
        uint256 _totalEthDripped,
        uint256 ethBalance,
        uint256 tokenCount
    ) {
        return (totalClaims, totalEthDripped, address(this).balance, tokenList.length);
    }

    /**
     * @notice Estimate what a claim will yield
     */
    function estimateDrip(address account) external view returns (
        bool eligible,
        uint256 ethAmount,
        address[] memory tokenAddresses,
        uint256[] memory tokenAmounts
    ) {
        (eligible,) = this.canClaim(account);
        
        ethAmount = (ethEnabled && address(this).balance >= ethDripAmount) ? ethDripAmount : 0;
        
        uint256 count = 0;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].enabled && IERC20(tokenList[i]).balanceOf(address(this)) >= tokens[tokenList[i]].amount) {
                count++;
            }
        }
        
        tokenAddresses = new address[](count);
        tokenAmounts = new uint256[](count);
        
        uint256 j = 0;
        for (uint256 i = 0; i < tokenList.length; i++) {
            address token = tokenList[i];
            if (tokens[token].enabled && IERC20(token).balanceOf(address(this)) >= tokens[token].amount) {
                tokenAddresses[j] = token;
                tokenAmounts[j] = tokens[token].amount;
                j++;
            }
        }
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Configure a token for dripping
     */
    function configureToken(address token, uint256 amount, bool enabled) external onlyOwner {
        if (tokens[token].amount == 0 && amount > 0) {
            tokenList.push(token);
        }
        
        tokens[token] = TokenConfig({
            amount: amount,
            enabled: enabled,
            totalDripped: tokens[token].totalDripped
        });
        
        emit TokenConfigured(token, amount, enabled);
    }

    /**
     * @notice Configure ETH dripping
     */
    function configureEth(uint256 amount, bool enabled) external onlyOwner {
        ethDripAmount = amount;
        ethEnabled = enabled;
        emit EthConfigUpdated(amount, enabled);
    }

    /**
     * @notice Set cooldown period
     */
    function setCooldown(uint256 _cooldown) external onlyOwner {
        uint256 old = cooldown;
        cooldown = _cooldown;
        emit CooldownUpdated(old, _cooldown);
    }

    /**
     * @notice Update allowlist
     */
    function setAllowlist(address account, bool allowed) external onlyOwner {
        allowlist[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    /**
     * @notice Batch update allowlist
     */
    function setAllowlistBatch(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowlist[accounts[i]] = allowed;
            emit AllowlistUpdated(accounts[i], allowed);
        }
    }

    /**
     * @notice Enable/disable allowlist
     */
    function setAllowlistEnabled(bool enabled) external onlyOwner {
        allowlistEnabled = enabled;
    }

    /**
     * @notice Update denylist
     */
    function setDenylist(address account, bool denied) external onlyOwner {
        denylist[account] = denied;
        emit DenylistUpdated(account, denied);
    }

    /**
     * @notice Deposit tokens to faucet
     */
    function depositToken(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit FundsDeposited(token, msg.sender, amount);
    }

    /**
     * @notice Withdraw tokens from faucet
     */
    function withdrawToken(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit FundsWithdrawn(token, to, amount);
    }

    /**
     * @notice Withdraw ETH from faucet
     */
    function withdrawEth(uint256 amount, address to) external onlyOwner {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit FundsWithdrawn(address(0), to, amount);
    }

    /**
     * @notice Receive ETH deposits
     */
    receive() external payable {
        emit FundsDeposited(address(0), msg.sender, msg.value);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}



