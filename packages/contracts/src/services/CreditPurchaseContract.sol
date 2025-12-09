// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals);
    function isPriceFresh(address token) external view returns (bool);
}

interface IElizaOSToken {
    function mint(address to, uint256 amount) external;
}

/**
 * @title CreditPurchaseContract
 * @author Jeju Network
 * @notice Enables direct crypto purchases of elizaOS credits with multiple payment tokens
 * @dev Users can purchase elizaOS tokens (cloud credits) by paying with ETH, USDC, USDT, or DAI.
 *      Prices are determined by oracle and converted to elizaOS at current rates.
 *
 * Purchase Flow:
 * 1. User calls getQuote() to see how many credits they'll receive
 * 2. User approves payment token (if ERC20)
 * 3. User calls purchaseCredits() with payment
 * 4. Contract verifies oracle price freshness
 * 5. Contract transfers payment tokens to treasury
 * 6. Contract mints elizaOS tokens directly to user's wallet
 * 7. Event emitted for indexing and analytics
 *
 * Supported Tokens:
 * - ETH (native)
 * - USDC (6 decimals)
 * - USDT (6 decimals)
 * - DAI (18 decimals)
 *
 * Security Features:
 * - Oracle price staleness checks
 * - Slippage protection via minCreditsOut
 * - Reentrancy guards
 * - Pausable for emergencies
 * - Non-custodial (immediate minting)
 *
 * @custom:security-contact security@jeju.network
 */
contract CreditPurchaseContract is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice elizaOS token contract for minting credits
    IElizaOSToken public immutable ElizaOSToken;

    /// @notice Price oracle for getting token/USD rates
    IPriceOracle public priceOracle;

    /// @notice Treasury address receiving payment tokens
    address public treasury;

    /// @notice Platform fee in basis points (100 = 1%)
    uint256 public platformFeeBps = 300; // 3% default

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Supported payment tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Token decimals cache to avoid repeated calls
    mapping(address => uint8) public tokenDecimals;

    /// @notice Minimum purchase amount in USD (18 decimals)
    uint256 public minPurchaseUSD = 10 * 1e18; // $10 minimum

    /// @notice Maximum purchase amount in USD (18 decimals)
    uint256 public maxPurchaseUSD = 100000 * 1e18; // $100k maximum

    /// @notice Maximum allowed slippage in basis points
    uint256 public maxSlippageBps = 500; // 5% maximum slippage

    /// @notice ETH address constant
    address public constant ETH = address(0);

    /// @notice Pending ETH withdrawals for failed transfers (pull-over-push pattern)
    mapping(address => uint256) public pendingWithdrawals;

    // ============ Events ============

    event CreditsPurchased(
        address indexed buyer,
        address indexed recipient,
        address paymentToken,
        uint256 paymentAmount,
        uint256 creditsReceived,
        uint256 platformFee,
        uint256 pricePerCredit
    );

    event QuoteGenerated(
        address indexed user,
        address paymentToken,
        uint256 paymentAmount,
        uint256 creditsOut,
        uint256 pricePerCredit,
        uint256 slippageBps
    );

    event PriceOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PlatformFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event TokenSupportUpdated(address indexed token, bool supported);
    event PurchaseLimitsUpdated(uint256 minUSD, uint256 maxUSD);
    event WithdrawalRecorded(address indexed recipient, uint256 amount);
    event WithdrawalClaimed(address indexed recipient, uint256 amount);

    // ============ Errors ============

    error InvalidPriceOracle();
    error InvalidTreasury();
    error InvalidElizaOSToken();
    error UnsupportedToken(address token);
    error StalePriceData(address token);
    error PurchaseAmountTooLow(uint256 amount, uint256 minimum);
    error PurchaseAmountTooHigh(uint256 amount, uint256 maximum);
    error SlippageExceeded(uint256 creditsOut, uint256 minCreditsOut);
    error InvalidSlippage(uint256 slippageBps);
    error InsufficientPayment(uint256 provided, uint256 required);
    error InvalidRecipient();
    error InvalidFee(uint256 feeBps);

    // ============ Constructor ============

    constructor(IElizaOSToken _elizaOSToken, IPriceOracle _priceOracle, address _treasury) Ownable(msg.sender) {
        if (address(_elizaOSToken) == address(0)) revert InvalidElizaOSToken();
        if (address(_priceOracle) == address(0)) revert InvalidPriceOracle();
        if (_treasury == address(0)) revert InvalidTreasury();

        ElizaOSToken = _elizaOSToken;
        priceOracle = _priceOracle;
        treasury = _treasury;

        // Enable ETH by default
        supportedTokens[ETH] = true;
        tokenDecimals[ETH] = 18;
    }

    // ============ Core Purchase Functions ============

    /**
     * @notice Purchase credits by paying with supported tokens
     * @param paymentToken Address of token to pay with (address(0) for ETH)
     * @param paymentAmount Amount of payment token to spend
     * @param minCreditsOut Minimum credits to receive (slippage protection)
     * @param recipient Address to receive the minted credits
     * @return creditsReceived Amount of elizaOS tokens minted
     */
    function purchaseCredits(address paymentToken, uint256 paymentAmount, uint256 minCreditsOut, address recipient)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 creditsReceived)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (!supportedTokens[paymentToken]) revert UnsupportedToken(paymentToken);

        // Verify payment
        if (paymentToken == ETH) {
            if (msg.value != paymentAmount) revert InsufficientPayment(msg.value, paymentAmount);
        } else {
            if (msg.value > 0) revert InsufficientPayment(0, msg.value);
        }

        // Get current quote
        (uint256 creditsOut, uint256 pricePerCredit,, uint256 usdValue) = _calculateQuote(paymentToken, paymentAmount);

        // Verify purchase limits
        if (usdValue < minPurchaseUSD) {
            revert PurchaseAmountTooLow(usdValue, minPurchaseUSD);
        }
        if (usdValue > maxPurchaseUSD) {
            revert PurchaseAmountTooHigh(usdValue, maxPurchaseUSD);
        }

        // Verify slippage protection
        if (creditsOut < minCreditsOut) {
            revert SlippageExceeded(creditsOut, minCreditsOut);
        }

        // Calculate platform fee
        uint256 platformFee = (paymentAmount * platformFeeBps) / BASIS_POINTS;
        uint256 netPayment = paymentAmount - platformFee;

        // CEI PATTERN: Set return value FIRST, then mint (reentrancy protection)
        creditsReceived = creditsOut;

        // Mint tokens BEFORE external calls to untrusted addresses (reentrancy safe)
        ElizaOSToken.mint(recipient, creditsOut);

        // EXTERNAL CALLS LAST (to treasury which could be malicious contract)
        if (paymentToken == ETH) {
            // CEI: Cache owner address before external calls
            address ownerAddr = owner();
            
            // Pull-over-push pattern: record failed transfers instead of reverting
            (bool treasurySuccess,) = treasury.call{value: netPayment}("");
            if (!treasurySuccess) {
                pendingWithdrawals[treasury] += netPayment;
                emit WithdrawalRecorded(treasury, netPayment);
            }

            // Platform fee to owner
            if (platformFee > 0) {
                (bool feeSuccess,) = ownerAddr.call{value: platformFee}("");
                if (!feeSuccess) {
                    pendingWithdrawals[ownerAddr] += platformFee;
                    emit WithdrawalRecorded(ownerAddr, platformFee);
                }
            }
        } else {
            IERC20(paymentToken).safeTransferFrom(msg.sender, treasury, netPayment);
            if (platformFee > 0) {
                IERC20(paymentToken).safeTransferFrom(msg.sender, owner(), platformFee);
            }
        }

        emit CreditsPurchased(
            msg.sender, recipient, paymentToken, paymentAmount, creditsReceived, platformFee, pricePerCredit
        );
    }

    /**
     * @notice Get a purchase quote showing expected credits out
     * @param paymentToken Token to pay with
     * @param paymentAmount Amount of payment token
     * @return creditsOut Expected elizaOS credits to receive
     * @return pricePerCredit Price per credit in payment token
     * @return slippageBps Current slippage in basis points
     * @return totalCostUSD Total cost in USD (18 decimals)
     */
    function getQuote(address paymentToken, uint256 paymentAmount)
        external
        view
        returns (uint256 creditsOut, uint256 pricePerCredit, uint256 slippageBps, uint256 totalCostUSD)
    {
        if (!supportedTokens[paymentToken]) revert UnsupportedToken(paymentToken);

        return _calculateQuote(paymentToken, paymentAmount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update price oracle contract
     * @param _newOracle New oracle address
     */
    function setPriceOracle(IPriceOracle _newOracle) external onlyOwner {
        if (address(_newOracle) == address(0)) revert InvalidPriceOracle();

        address oldOracle = address(priceOracle);
        priceOracle = _newOracle;

        emit PriceOracleUpdated(oldOracle, address(_newOracle));
    }

    /**
     * @notice Update treasury address
     * @param _newTreasury New treasury address
     */
    function setTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert InvalidTreasury();

        address oldTreasury = treasury;
        treasury = _newTreasury;

        emit TreasuryUpdated(oldTreasury, _newTreasury);
    }

    /**
     * @notice Update platform fee
     * @param _newFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 _newFeeBps) external onlyOwner {
        if (_newFeeBps > 1000) revert InvalidFee(_newFeeBps); // Max 10%

        uint256 oldFeeBps = platformFeeBps;
        platformFeeBps = _newFeeBps;

        emit PlatformFeeUpdated(oldFeeBps, _newFeeBps);
    }

    /**
     * @notice Add or remove supported payment token
     * @param token Token address
     * @param supported Whether token is supported
     * @param decimals Token decimals (only needed when adding)
     */
    function setTokenSupport(address token, bool supported, uint8 decimals) external onlyOwner {
        supportedTokens[token] = supported;
        if (supported && decimals > 0) {
            tokenDecimals[token] = decimals;
        }

        emit TokenSupportUpdated(token, supported);
    }

    /**
     * @notice Update purchase limits
     * @param _minPurchaseUSD Minimum purchase in USD (18 decimals)
     * @param _maxPurchaseUSD Maximum purchase in USD (18 decimals)
     */
    function setPurchaseLimits(uint256 _minPurchaseUSD, uint256 _maxPurchaseUSD) external onlyOwner {
        require(_minPurchaseUSD < _maxPurchaseUSD, "Invalid limits");

        minPurchaseUSD = _minPurchaseUSD;
        maxPurchaseUSD = _maxPurchaseUSD;

        emit PurchaseLimitsUpdated(_minPurchaseUSD, _maxPurchaseUSD);
    }

    /**
     * @notice Update maximum allowed slippage
     * @param _maxSlippageBps Maximum slippage in basis points
     */
    function setMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        if (_maxSlippageBps > 1000) revert InvalidSlippage(_maxSlippageBps); // Max 10%

        maxSlippageBps = _maxSlippageBps;
    }

    /**
     * @notice Pause contract (emergency)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate purchase quote with current oracle prices
     * @param paymentToken Token to pay with
     * @param paymentAmount Amount of payment token
     * @return creditsOut Credits to receive
     * @return pricePerCredit Price per credit in payment token
     * @return slippageBps Current slippage
     * @return usdValue USD value of purchase
     */
    function _calculateQuote(address paymentToken, uint256 paymentAmount)
        internal
        view
        returns (uint256 creditsOut, uint256 pricePerCredit, uint256 slippageBps, uint256 usdValue)
    {
        // Get payment token price from oracle
        (uint256 paymentTokenPriceUSD, uint256 paymentDecimals) = priceOracle.getPrice(paymentToken);
        if (!priceOracle.isPriceFresh(paymentToken)) {
            revert StalePriceData(paymentToken);
        }

        // Get elizaOS price from oracle
        (uint256 elizaPriceUSD,) = priceOracle.getPrice(address(ElizaOSToken));
        if (!priceOracle.isPriceFresh(address(ElizaOSToken))) {
            revert StalePriceData(address(ElizaOSToken));
        }

        // Calculate USD value of payment (normalize to 18 decimals)
        uint8 paymentTokenDecimals = tokenDecimals[paymentToken];
        usdValue = (paymentAmount * paymentTokenPriceUSD * 1e18) / (10 ** paymentTokenDecimals * 10 ** paymentDecimals);

        // Subtract platform fee from USD value
        uint256 netUsdValue = usdValue - ((usdValue * platformFeeBps) / BASIS_POINTS);

        // Calculate credits out
        // Note: both netUsdValue and elizaPriceUSD are in 18 decimals
        // Result will be in elizaOS token decimals (18)
        creditsOut = (netUsdValue * 1e18) / elizaPriceUSD;

        // Calculate price per credit in payment token
        pricePerCredit = (paymentAmount * 1e18) / creditsOut;

        // Calculate current slippage (simplified - would be more complex in production)
        slippageBps = 0; // Assuming oracle provides exact price
    }

    // ============ Withdrawal Functions (Pull-Over-Push Pattern) ============

    /**
     * @notice Withdraw pending ETH that failed to transfer
     * @dev Anyone can call to claim their own pending withdrawals
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");

        // Clear pending withdrawal before transfer (prevent reentrancy)
        pendingWithdrawals[msg.sender] = 0;

        // Transfer ETH to recipient
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit WithdrawalClaimed(msg.sender, amount);
    }

    /**
     * @notice Get pending withdrawal amount for an address
     * @param account Address to check
     * @return amount Pending withdrawal amount
     */
    function getPendingWithdrawal(address account) external view returns (uint256 amount) {
        return pendingWithdrawals[account];
    }

    // ============ Emergency Functions ============

    /**
     * @notice Emergency withdraw stuck tokens
     * @dev Only owner can call, only when paused
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused(), "Must be paused");

        if (token == ETH) {
            // Note: This does not withdraw pending withdrawals
            // Users must call withdraw() themselves to claim pending amounts
            (bool success,) = owner().call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Check if a token is supported
     * @param token Token address to check
     * @return supported Whether token is supported
     */
    function isTokenSupported(address token) external view returns (bool supported) {
        return supportedTokens[token];
    }

    /**
     * @notice Get current purchase limits
     * @return minUSD Minimum purchase in USD
     * @return maxUSD Maximum purchase in USD
     */
    function getPurchaseLimits() external view returns (uint256 minUSD, uint256 maxUSD) {
        return (minPurchaseUSD, maxPurchaseUSD);
    }

    /**
     * @notice Calculate slippage for a quote
     * @param expectedOut Expected credits out
     * @param actualOut Actual credits out
     * @return slippageBps Slippage in basis points
     */
    function calculateSlippage(uint256 expectedOut, uint256 actualOut) public pure returns (uint256 slippageBps) {
        if (actualOut >= expectedOut) return 0;

        uint256 difference = expectedOut - actualOut;
        slippageBps = (difference * BASIS_POINTS) / expectedOut;
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Allow contract to receive ETH
    }
}
