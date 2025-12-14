// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMarginManager} from "./interfaces/IPerpetualMarket.sol";
import {ISimplePriceOracle} from "../interfaces/IPriceOracle.sol";
import {ITokenRegistry} from "../interfaces/IPaymaster.sol";
import {ICrossChainPaymaster} from "../eil/IEIL.sol";

/**
 * @title MarginManager
 * @notice Manages collateral deposits and margin accounting for perps trading
 */
contract MarginManager is IMarginManager, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct CollateralToken {
        bool isAccepted;
        uint256 weight;
        uint256 maxDeposit;
        uint8 decimals;
    }

    struct TraderAccount {
        mapping(address => uint256) balances;
        mapping(address => uint256) reserved;
        uint256 totalValueUSD;
        uint256 lastUpdateTime;
    }

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant VALUE_PRECISION = 1e18;

    ISimplePriceOracle public priceOracle;
    ITokenRegistry public tokenRegistry;

    // Collateral configuration
    mapping(address => CollateralToken) public collateralTokens;
    address[] public acceptedTokens;

    // Trader accounts
    mapping(address => TraderAccount) internal traderAccounts;

    // Authorized contracts that can reserve margin
    mapping(address => bool) public authorizedContracts;

    // Global stats
    uint256 public totalDepositsUSD;
    mapping(address => uint256) public totalDeposits; // token => total

    // EIL CrossChainPaymaster for cross-chain deposits
    address public crossChainPaymaster;

    // Track used vouchers to prevent double-spending
    mapping(bytes32 => bool) public usedVouchers;

    error TokenNotAccepted();
    error InsufficientBalance();
    error InsufficientAvailableMargin();
    error ExceedsMaxDeposit();
    error Unauthorized();
    error InvalidAmount();
    error InvalidWeight();
    error TokenAlreadyAccepted();
    error VoucherAlreadyUsed();
    error VoucherNotFulfilled();
    error VoucherRecipientMismatch();
    error VoucherTokenMismatch();
    error VoucherAmountMismatch();

    constructor(address _priceOracle, address _tokenRegistry, address initialOwner) Ownable(initialOwner) {
        priceOracle = ISimplePriceOracle(_priceOracle);
        tokenRegistry = ITokenRegistry(_tokenRegistry);
    }

    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!collateralTokens[token].isAccepted) revert TokenNotAccepted();

        CollateralToken storage ct = collateralTokens[token];
        TraderAccount storage account = traderAccounts[msg.sender];

        // Check max deposit
        if (ct.maxDeposit > 0 && account.balances[token] + amount > ct.maxDeposit) {
            revert ExceedsMaxDeposit();
        }

        // Transfer tokens
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update balances
        account.balances[token] += amount;
        totalDeposits[token] += amount;

        // Update USD value
        uint256 valueUSD = _calculateTokenValueUSD(token, amount);
        totalDepositsUSD += valueUSD;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    function depositCrossChain(address token, uint256 amount, bytes32 voucherId) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!collateralTokens[token].isAccepted) revert TokenNotAccepted();
        if (crossChainPaymaster == address(0)) revert Unauthorized();

        // Prevent double-spending of vouchers
        if (usedVouchers[voucherId]) revert VoucherAlreadyUsed();

        // Verify voucher from CrossChainPaymaster
        ICrossChainPaymaster paymaster = ICrossChainPaymaster(crossChainPaymaster);
        ICrossChainPaymaster.Voucher memory voucher = paymaster.getVoucher(voucherId);

        // Voucher must be fulfilled (XLP has delivered tokens)
        if (!voucher.fulfilled) revert VoucherNotFulfilled();

        // Verify voucher parameters match the deposit request
        // The voucher's request should have this contract as recipient
        ICrossChainPaymaster.VoucherRequest memory request = paymaster.getRequest(voucher.requestId);
        if (request.recipient != address(this)) revert VoucherRecipientMismatch();
        if (request.destinationToken != token) revert VoucherTokenMismatch();
        if (request.amount != amount) revert VoucherAmountMismatch();
        if (request.requester != msg.sender) revert Unauthorized();

        // Mark voucher as used
        usedVouchers[voucherId] = true;

        CollateralToken storage ct = collateralTokens[token];
        TraderAccount storage account = traderAccounts[msg.sender];

        if (ct.maxDeposit > 0 && account.balances[token] + amount > ct.maxDeposit) {
            revert ExceedsMaxDeposit();
        }

        // Credit the balance (tokens already transferred via EIL fulfillment)
        account.balances[token] += amount;
        totalDeposits[token] += amount;

        uint256 valueUSD = _calculateTokenValueUSD(token, amount);
        totalDepositsUSD += valueUSD;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        TraderAccount storage account = traderAccounts[msg.sender];
        uint256 available = _getAvailableBalance(msg.sender, token);

        if (amount > available) revert InsufficientAvailableMargin();

        // Update balances
        account.balances[token] -= amount;
        totalDeposits[token] -= amount;

        uint256 valueUSD = _calculateTokenValueUSD(token, amount);
        if (totalDepositsUSD >= valueUSD) {
            totalDepositsUSD -= valueUSD;
        }

        // Transfer tokens
        IERC20(token).safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    /**
     * @notice Reserve margin for a position
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to reserve
     */
    function reserveMargin(address trader, address token, uint256 amount) external onlyAuthorized {
        TraderAccount storage account = traderAccounts[trader];
        uint256 available = account.balances[token] - account.reserved[token];

        if (amount > available) revert InsufficientAvailableMargin();

        account.reserved[token] += amount;
    }

    /**
     * @notice Release reserved margin
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to release
     */
    function releaseMargin(address trader, address token, uint256 amount) external onlyAuthorized {
        TraderAccount storage account = traderAccounts[trader];

        if (amount > account.reserved[token]) {
            amount = account.reserved[token];
        }

        account.reserved[token] -= amount;
    }

    /**
     * @notice Transfer margin for position (used for isolated margin)
     * @param from Source trader
     * @param to Destination (usually insurance fund or another trader)
     * @param token Margin token
     * @param amount Amount to transfer
     */
    function transferMargin(address from, address to, address token, uint256 amount) external onlyAuthorized {
        TraderAccount storage fromAccount = traderAccounts[from];

        if (amount > fromAccount.balances[token]) revert InsufficientBalance();

        fromAccount.balances[token] -= amount;

        if (amount > fromAccount.reserved[token]) {
            fromAccount.reserved[token] = 0;
        } else {
            fromAccount.reserved[token] -= amount;
        }

        // If transferring to another trader, credit their account
        // If transferring to insurance fund, just transfer tokens
        if (to != address(0) && to != address(this)) {
            if (_isContract(to)) {
                // Transfer to contract (e.g., insurance fund)
                IERC20(token).safeTransfer(to, amount);
            } else {
                // Credit to trader account
                traderAccounts[to].balances[token] += amount;
            }
        }
    }

    /**
     * @notice Deduct margin for fees/losses
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to deduct
     * @param recipient Fee recipient
     */
    function deductMargin(address trader, address token, uint256 amount, address recipient) external onlyAuthorized {
        TraderAccount storage account = traderAccounts[trader];

        if (amount > account.balances[token]) {
            amount = account.balances[token];
        }

        account.balances[token] -= amount;

        if (amount > account.reserved[token]) {
            account.reserved[token] = 0;
        } else {
            account.reserved[token] -= amount;
        }

        totalDeposits[token] -= amount;

        // Transfer to recipient
        if (recipient != address(0)) {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /**
     * @notice Credit margin (e.g., from PnL)
     * @param trader Trader address
     * @param token Margin token
     * @param amount Amount to credit
     */
    function creditMargin(address trader, address token, uint256 amount) external onlyAuthorized {
        traderAccounts[trader].balances[token] += amount;
        totalDeposits[token] += amount;
    }

    function getCollateralBalance(address trader, address token) external view returns (uint256 balance) {
        return traderAccounts[trader].balances[token];
    }

    function getReservedBalance(address trader, address token) external view returns (uint256 reserved) {
        return traderAccounts[trader].reserved[token];
    }

    function getTotalCollateralValue(address trader) external view returns (uint256 totalValueUSD) {
        return _calculateTotalValueUSD(trader);
    }

    function getAvailableCollateral(address trader, address token) external view returns (uint256 available) {
        return _getAvailableBalance(trader, token);
    }

    function getAvailableCollateralValue(address trader) external view returns (uint256 availableUSD) {
        uint256 total = 0;

        for (uint256 i = 0; i < acceptedTokens.length; i++) {
            address token = acceptedTokens[i];
            uint256 available = _getAvailableBalance(trader, token);
            if (available > 0) {
                total += _calculateWeightedValueUSD(token, available);
            }
        }

        return total;
    }

    function isCollateralAccepted(address token) external view returns (bool accepted, uint256 weight) {
        CollateralToken storage ct = collateralTokens[token];
        return (ct.isAccepted, ct.weight);
    }

    function getCollateralInfo(address trader, address token) external view returns (CollateralInfo memory info) {
        TraderAccount storage account = traderAccounts[trader];
        CollateralToken storage ct = collateralTokens[token];

        info.token = token;
        info.balance = account.balances[token];
        info.valueUSD = _calculateTokenValueUSD(token, info.balance);
        info.weight = ct.weight;
    }

    function getAllCollateralInfo(address trader) external view returns (CollateralInfo[] memory infos) {
        infos = new CollateralInfo[](acceptedTokens.length);

        for (uint256 i = 0; i < acceptedTokens.length; i++) {
            address token = acceptedTokens[i];
            TraderAccount storage account = traderAccounts[trader];
            CollateralToken storage ct = collateralTokens[token];

            infos[i] = CollateralInfo({
                token: token,
                balance: account.balances[token],
                valueUSD: _calculateTokenValueUSD(token, account.balances[token]),
                weight: ct.weight
            });
        }
    }

    function _getAvailableBalance(address trader, address token) internal view returns (uint256) {
        TraderAccount storage account = traderAccounts[trader];
        uint256 balance = account.balances[token];
        uint256 reserved = account.reserved[token];

        if (balance <= reserved) return 0;
        return balance - reserved;
    }

    function _calculateTotalValueUSD(address trader) internal view returns (uint256 total) {
        for (uint256 i = 0; i < acceptedTokens.length; i++) {
            address token = acceptedTokens[i];
            uint256 balance = traderAccounts[trader].balances[token];
            if (balance > 0) {
                total += _calculateWeightedValueUSD(token, balance);
            }
        }
    }

    function _calculateTokenValueUSD(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;

        uint256 price = priceOracle.getPrice(token);
        CollateralToken storage ct = collateralTokens[token];

        // Normalize to 18 decimals then to USD value
        uint256 normalizedAmount = amount * (10 ** (18 - ct.decimals));

        // price has 18 decimals, normalizedAmount has 18 decimals
        // result should be in USD with 18 decimals
        return (normalizedAmount * price) / VALUE_PRECISION;
    }

    function _calculateWeightedValueUSD(address token, uint256 amount) internal view returns (uint256) {
        uint256 valueUSD = _calculateTokenValueUSD(token, amount);
        uint256 weight = collateralTokens[token].weight;

        return (valueUSD * weight) / BPS_DENOMINATOR;
    }

    function _isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }

    /**
     * @notice Add a new collateral token
     * @param token Token address
     * @param weight Collateral weight (10000 = 100%)
     * @param maxDeposit Max deposit per user (0 = unlimited)
     */
    function addCollateralToken(address token, uint256 weight, uint256 maxDeposit) external onlyOwner {
        if (collateralTokens[token].isAccepted) revert TokenAlreadyAccepted();
        if (weight == 0 || weight > BPS_DENOMINATOR) revert InvalidWeight();

        uint8 decimals = 18;
        // Try to get decimals from token
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (success && data.length >= 32) {
            decimals = abi.decode(data, (uint8));
        }

        collateralTokens[token] =
            CollateralToken({isAccepted: true, weight: weight, maxDeposit: maxDeposit, decimals: decimals});

        acceptedTokens.push(token);

        emit CollateralTokenAdded(token, weight);
    }

    /**
     * @notice Update collateral token parameters
     * @param token Token address
     * @param weight New weight
     * @param maxDeposit New max deposit
     */
    function updateCollateralToken(address token, uint256 weight, uint256 maxDeposit) external onlyOwner {
        if (!collateralTokens[token].isAccepted) revert TokenNotAccepted();
        if (weight == 0 || weight > BPS_DENOMINATOR) revert InvalidWeight();

        collateralTokens[token].weight = weight;
        collateralTokens[token].maxDeposit = maxDeposit;
    }

    /**
     * @notice Remove a collateral token (existing deposits still valid)
     * @param token Token address
     */
    function removeCollateralToken(address token) external onlyOwner {
        collateralTokens[token].isAccepted = false;
    }

    /**
     * @notice Authorize a contract to manage margin
     * @param contractAddr Contract address
     * @param authorized Whether authorized
     */
    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
    }

    /**
     * @notice Set the cross-chain paymaster for EIL deposits
     * @param _paymaster Paymaster address
     */
    function setCrossChainPaymaster(address _paymaster) external onlyOwner {
        crossChainPaymaster = _paymaster;
    }

    /**
     * @notice Update price oracle
     * @param _oracle New oracle address
     */
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = ISimplePriceOracle(_oracle);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    function getAcceptedTokens() external view returns (address[] memory) {
        return acceptedTokens;
    }

    function getGlobalStats() external view returns (uint256 _totalDepositsUSD, uint256 tokenCount) {
        return (totalDepositsUSD, acceptedTokens.length);
    }
}
