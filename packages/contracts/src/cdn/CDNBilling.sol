// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICDNTypes} from "./ICDNTypes.sol";

/**
 * @title CDNBilling
 * @author Jeju Network
 * @notice Billing and settlement for CDN services
 * @dev Handles:
 *      - Prepaid balance management for app deployers
 *      - Usage-based billing per provider
 *      - Automatic settlement between users and providers
 *      - Protocol fee collection
 */
contract CDNBilling is ICDNTypes, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice Payment token (address(0) for ETH)
    address public paymentToken;

    /// @notice Protocol fee in basis points (e.g., 300 = 3%)
    uint256 public protocolFeeBps = 300;

    /// @notice Minimum balance required for active service
    uint256 public minBalance = 0.001 ether;

    /// @notice Settlement period in seconds
    uint256 public settlementPeriod = 1 days;

    /// @notice User balances
    mapping(address => uint256) private _balances;

    /// @notice Provider earnings (pending settlement)
    mapping(address => uint256) private _providerEarnings;

    /// @notice Provider settled earnings
    mapping(address => uint256) private _providerSettled;

    /// @notice User to provider usage tracking
    mapping(address => mapping(address => UsageAccumulator)) private _userProviderUsage;

    /// @notice Last settlement timestamp per user-provider pair
    mapping(address => mapping(address => uint256)) private _lastSettlement;

    /// @notice Billing records
    mapping(bytes32 => BillingRecord) private _billingRecords;

    /// @notice User billing record IDs
    mapping(address => bytes32[]) private _userBillingRecords;

    /// @notice Provider billing record IDs
    mapping(address => bytes32[]) private _providerBillingRecords;

    /// @notice Total protocol fees collected
    uint256 public totalProtocolFees;

    /// @notice Treasury address for protocol fees
    address public treasury;

    // ============ Structs ============

    struct UsageAccumulator {
        uint256 bytesEgress;
        uint256 requests;
        uint256 storageBytes;
        uint256 lastUpdate;
        uint256 pendingCost;
    }

    struct ProviderRates {
        uint256 pricePerGBEgress;
        uint256 pricePerMillionRequests;
        uint256 pricePerGBStorage;
    }

    // ============ Events ============

    event BalanceDeposited(address indexed user, uint256 amount);
    event BalanceWithdrawn(address indexed user, uint256 amount);
    event UsageRecorded(
        address indexed user,
        address indexed provider,
        uint256 bytesEgress,
        uint256 requests,
        uint256 cost
    );
    event SettlementProcessed(
        bytes32 indexed billingId,
        address indexed user,
        address indexed provider,
        uint256 amount,
        uint256 protocolFee
    );
    event ProviderWithdrawal(address indexed provider, uint256 amount);
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ============ Errors ============

    error InsufficientBalance(uint256 available, uint256 required);
    error InvalidAmount();
    error TransferFailed();
    error NotAuthorized();
    error NoPendingEarnings();
    error SettlementTooSoon();

    // ============ Constructor ============

    constructor(address _owner, address _treasury, address _paymentToken) Ownable(_owner) {
        treasury = _treasury;
        paymentToken = _paymentToken;
    }

    // ============ User Balance Management ============

    /**
     * @notice Deposit funds for CDN usage
     */
    function deposit() external payable nonReentrant {
        if (paymentToken != address(0)) revert InvalidAmount();
        if (msg.value == 0) revert InvalidAmount();

        _balances[msg.sender] += msg.value;

        emit BalanceDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Deposit ERC20 tokens for CDN usage
     */
    function depositToken(uint256 amount) external nonReentrant {
        if (paymentToken == address(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        _balances[msg.sender] += amount;

        emit BalanceDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw unused balance
     */
    function withdraw(uint256 amount) external nonReentrant {
        uint256 balance = _balances[msg.sender];
        if (balance < amount) revert InsufficientBalance(balance, amount);

        _balances[msg.sender] = balance - amount;

        if (paymentToken == address(0)) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(paymentToken).safeTransfer(msg.sender, amount);
        }

        emit BalanceWithdrawn(msg.sender, amount);
    }

    // ============ Usage Recording ============

    /**
     * @notice Record usage from a CDN provider
     * @dev Called by authorized providers/coordinators
     */
    function recordUsage(
        address user,
        address provider,
        uint256 bytesEgress,
        uint256 requests,
        uint256 storageBytes,
        ProviderRates calldata rates
    ) external {
        // Calculate cost
        uint256 egressCost = (bytesEgress * rates.pricePerGBEgress) / (1024 * 1024 * 1024);
        uint256 requestsCost = (requests * rates.pricePerMillionRequests) / 1_000_000;
        uint256 storageCost = (storageBytes * rates.pricePerGBStorage) / (1024 * 1024 * 1024);
        uint256 totalCost = egressCost + requestsCost + storageCost;

        // Update usage accumulator
        UsageAccumulator storage usage = _userProviderUsage[user][provider];
        usage.bytesEgress += bytesEgress;
        usage.requests += requests;
        usage.storageBytes = storageBytes; // Current storage, not cumulative
        usage.pendingCost += totalCost;
        usage.lastUpdate = block.timestamp;

        emit UsageRecorded(user, provider, bytesEgress, requests, totalCost);

        // Auto-settle if period elapsed
        if (block.timestamp >= _lastSettlement[user][provider] + settlementPeriod) {
            _settleUserProvider(user, provider);
        }
    }

    // ============ Settlement ============

    /**
     * @notice Settle pending usage between user and provider
     */
    function settle(address user, address provider) external nonReentrant {
        uint256 lastSettle = _lastSettlement[user][provider];
        if (block.timestamp < lastSettle + settlementPeriod) {
            revert SettlementTooSoon();
        }

        _settleUserProvider(user, provider);
    }

    /**
     * @notice Batch settle multiple user-provider pairs
     */
    function batchSettle(address[] calldata users, address[] calldata providers) external nonReentrant {
        require(users.length == providers.length, "Length mismatch");

        for (uint256 i = 0; i < users.length; i++) {
            if (block.timestamp >= _lastSettlement[users[i]][providers[i]] + settlementPeriod) {
                _settleUserProvider(users[i], providers[i]);
            }
        }
    }

    function _settleUserProvider(address user, address provider) internal {
        UsageAccumulator storage usage = _userProviderUsage[user][provider];
        uint256 totalCost = usage.pendingCost;

        if (totalCost == 0) return;

        // Check user balance
        uint256 userBalance = _balances[user];
        uint256 actualCost = totalCost > userBalance ? userBalance : totalCost;

        if (actualCost == 0) return;

        // Calculate protocol fee
        uint256 protocolFee = (actualCost * protocolFeeBps) / 10000;
        uint256 providerAmount = actualCost - protocolFee;

        // Update balances
        _balances[user] -= actualCost;
        _providerEarnings[provider] += providerAmount;
        totalProtocolFees += protocolFee;

        // Create billing record
        bytes32 billingId = keccak256(abi.encodePacked(user, provider, block.timestamp, block.number));

        _billingRecords[billingId] = BillingRecord({
            billingId: billingId,
            user: user,
            provider: provider,
            periodStart: _lastSettlement[user][provider],
            periodEnd: block.timestamp,
            egressGB: usage.bytesEgress / (1024 * 1024 * 1024),
            requestsM: usage.requests / 1_000_000,
            storageGB: usage.storageBytes / (1024 * 1024 * 1024),
            egressCost: 0, // Could track individually
            requestsCost: 0,
            storageCost: 0,
            totalCost: actualCost,
            paid: true,
            paidAt: block.timestamp
        });

        _userBillingRecords[user].push(billingId);
        _providerBillingRecords[provider].push(billingId);

        // Reset accumulator
        usage.bytesEgress = 0;
        usage.requests = 0;
        usage.pendingCost = totalCost - actualCost; // Carry over unpaid amount
        _lastSettlement[user][provider] = block.timestamp;

        emit SettlementProcessed(billingId, user, provider, actualCost, protocolFee);
        emit BillingSettled(billingId, user, provider, actualCost);
    }

    // ============ Provider Withdrawals ============

    /**
     * @notice Provider withdraws earned funds
     */
    function providerWithdraw() external nonReentrant {
        uint256 earnings = _providerEarnings[msg.sender];
        if (earnings == 0) revert NoPendingEarnings();

        _providerEarnings[msg.sender] = 0;
        _providerSettled[msg.sender] += earnings;

        if (paymentToken == address(0)) {
            (bool success,) = msg.sender.call{value: earnings}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(paymentToken).safeTransfer(msg.sender, earnings);
        }

        emit ProviderWithdrawal(msg.sender, earnings);
    }

    /**
     * @notice Withdraw protocol fees to treasury
     */
    function withdrawProtocolFees() external nonReentrant {
        if (msg.sender != treasury && msg.sender != owner()) revert NotAuthorized();

        uint256 fees = totalProtocolFees;
        totalProtocolFees = 0;

        if (paymentToken == address(0)) {
            (bool success,) = treasury.call{value: fees}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(paymentToken).safeTransfer(treasury, fees);
        }
    }

    // ============ View Functions ============

    function getBalance(address user) external view returns (uint256) {
        return _balances[user];
    }

    function getProviderEarnings(address provider) external view returns (uint256 pending, uint256 settled) {
        return (_providerEarnings[provider], _providerSettled[provider]);
    }

    function getPendingUsage(address user, address provider) external view returns (UsageAccumulator memory) {
        return _userProviderUsage[user][provider];
    }

    function getBillingRecord(bytes32 billingId) external view returns (BillingRecord memory) {
        return _billingRecords[billingId];
    }

    function getUserBillingRecords(address user) external view returns (bytes32[] memory) {
        return _userBillingRecords[user];
    }

    function getProviderBillingRecords(address provider) external view returns (bytes32[] memory) {
        return _providerBillingRecords[provider];
    }

    function getLastSettlement(address user, address provider) external view returns (uint256) {
        return _lastSettlement[user][provider];
    }

    function estimateCost(
        uint256 bytesEgress,
        uint256 requests,
        uint256 storageBytes,
        ProviderRates calldata rates
    ) external pure returns (uint256) {
        uint256 egressCost = (bytesEgress * rates.pricePerGBEgress) / (1024 * 1024 * 1024);
        uint256 requestsCost = (requests * rates.pricePerMillionRequests) / 1_000_000;
        uint256 storageCost = (storageBytes * rates.pricePerGBStorage) / (1024 * 1024 * 1024);
        return egressCost + requestsCost + storageCost;
    }

    // ============ Admin Functions ============

    function setProtocolFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high"); // Max 10%
        uint256 oldFee = protocolFeeBps;
        protocolFeeBps = _feeBps;
        emit ProtocolFeeUpdated(oldFee, _feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    function setMinBalance(uint256 _minBalance) external onlyOwner {
        minBalance = _minBalance;
    }

    function setSettlementPeriod(uint256 _period) external onlyOwner {
        require(_period >= 1 hours, "Period too short");
        settlementPeriod = _period;
    }

    function setPaymentToken(address _token) external onlyOwner {
        paymentToken = _token;
    }

    // ============ Emergency Functions ============

    /**
     * @notice Emergency withdrawal of stuck funds
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success,) = owner().call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    receive() external payable {
        if (paymentToken == address(0)) {
            _balances[msg.sender] += msg.value;
            emit BalanceDeposited(msg.sender, msg.value);
        }
    }
}

