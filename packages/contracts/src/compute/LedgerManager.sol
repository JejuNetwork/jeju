// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LedgerManager
 * @author Jeju Network
 * @notice User ledger management for compute marketplace payments
 * @dev Manages user deposits, provider sub-accounts, and refunds
 *
 * Key Features:
 * - User deposit and withdrawal
 * - Provider sub-accounts for prepaid credits
 * - Refund mechanism with timelock
 * - Integration with InferenceServing for settlements
 *
 * Flow:
 * 1. User deposits ETH to create ledger
 * 2. User transfers to provider sub-account
 * 3. Provider acknowledges (sets signer for settlements)
 * 4. InferenceServing settles from sub-account
 * 5. User can request refunds with timelock
 *
 * @custom:security-contact security@jeju.network
 */
contract LedgerManager is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    struct Ledger {
        uint256 totalBalance;
        uint256 availableBalance;
        uint256 lockedBalance;
        uint256 createdAt;
    }

    struct ProviderSubAccount {
        uint256 balance;
        uint256 pendingRefund;
        uint256 refundUnlockTime;
        bool acknowledged;
    }

    // ============ State Variables ============

    /// @notice Minimum deposit amount
    uint256 public constant MIN_DEPOSIT = 0.001 ether;

    /// @notice Refund timelock period
    uint256 public refundTimelockPeriod = 24 hours;

    /// @notice User ledgers
    mapping(address => Ledger) public ledgers;

    /// @notice User => Provider => SubAccount
    mapping(address => mapping(address => ProviderSubAccount)) public subAccounts;

    /// @notice Authorized inference contract (can settle)
    address public inferenceContract;

    /// @notice Compute registry for provider validation
    address public registry;

    /// @notice Authorized CreditManager (can deposit on behalf of users)
    address public creditManager;

    // ============ Events ============

    event LedgerCreated(address indexed user, uint256 initialDeposit);
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount);
    event TransferredToProvider(address indexed user, address indexed provider, uint256 amount);
    event ProviderAcknowledged(address indexed user, address indexed provider);
    event RefundRequested(address indexed user, address indexed provider, uint256 amount, uint256 unlockTime);
    event RefundCompleted(address indexed user, address indexed provider, uint256 amount);
    event RefundCancelled(address indexed user, address indexed provider);
    event Settled(address indexed user, address indexed provider, uint256 amount, bytes32 requestHash);
    event InferenceContractUpdated(address indexed oldContract, address indexed newContract);
    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event RefundTimelockUpdated(uint256 oldPeriod, uint256 newPeriod);
    event CreditManagerUpdated(address indexed oldManager, address indexed newManager);
    event DepositedFromCredit(address indexed user, address indexed creditManager, uint256 amount, uint256 newBalance);

    // ============ Errors ============

    error LedgerAlreadyExists();
    error LedgerNotFound();
    error InsufficientDeposit(uint256 provided, uint256 required);
    error InsufficientBalance(uint256 available, uint256 required);
    error ProviderNotAcknowledged();
    error AlreadyAcknowledged();
    error NoRefundPending();
    error RefundNotUnlocked();
    error RefundAlreadyPending();
    error UnauthorizedCaller();
    error TransferFailed();
    error InvalidAmount();

    // ============ Modifiers ============

    modifier onlyInferenceContract() {
        if (msg.sender != inferenceContract) revert UnauthorizedCaller();
        _;
    }

    modifier onlyCreditManager() {
        if (msg.sender != creditManager) revert UnauthorizedCaller();
        _;
    }

    // ============ Constructor ============

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        registry = _registry;
    }

    // ============ Ledger Management ============

    /**
     * @notice Create a new ledger with initial deposit
     */
    function createLedger() external payable nonReentrant whenNotPaused {
        if (ledgers[msg.sender].createdAt != 0) revert LedgerAlreadyExists();
        if (msg.value < MIN_DEPOSIT) revert InsufficientDeposit(msg.value, MIN_DEPOSIT);

        ledgers[msg.sender] =
            Ledger({totalBalance: msg.value, availableBalance: msg.value, lockedBalance: 0, createdAt: block.timestamp});

        emit LedgerCreated(msg.sender, msg.value);
    }

    /**
     * @notice Deposit additional funds
     */
    function deposit() external payable nonReentrant whenNotPaused {
        Ledger storage ledger = ledgers[msg.sender];
        if (ledger.createdAt == 0) revert LedgerNotFound();

        ledger.totalBalance += msg.value;
        ledger.availableBalance += msg.value;

        emit Deposited(msg.sender, msg.value, ledger.availableBalance);
    }

    /**
     * @notice Deposit on behalf of user from CreditManager
     * @dev Called by authorized CreditManager when user pays with tokens
     * @param user The user to deposit for
     */
    function depositFromCreditManager(address user) external payable nonReentrant whenNotPaused onlyCreditManager {
        if (msg.value == 0) revert InvalidAmount();

        Ledger storage ledger = ledgers[user];

        // Create ledger if doesn't exist
        if (ledger.createdAt == 0) {
            ledger.createdAt = block.timestamp;
        }

        ledger.totalBalance += msg.value;
        ledger.availableBalance += msg.value;

        emit DepositedFromCredit(user, msg.sender, msg.value, ledger.availableBalance);
    }

    /**
     * @notice Withdraw available funds
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        Ledger storage ledger = ledgers[msg.sender];
        if (ledger.createdAt == 0) revert LedgerNotFound();
        if (amount > ledger.availableBalance) revert InsufficientBalance(ledger.availableBalance, amount);

        ledger.totalBalance -= amount;
        ledger.availableBalance -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    // ============ Provider Sub-Accounts ============

    /**
     * @notice Transfer funds to a provider sub-account
     * @param provider Provider address
     * @param amount Amount to transfer
     */
    function transferToProvider(address provider, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        Ledger storage ledger = ledgers[msg.sender];
        if (ledger.createdAt == 0) revert LedgerNotFound();
        if (amount > ledger.availableBalance) revert InsufficientBalance(ledger.availableBalance, amount);

        ledger.availableBalance -= amount;
        ledger.lockedBalance += amount;

        ProviderSubAccount storage subAccount = subAccounts[msg.sender][provider];
        subAccount.balance += amount;

        emit TransferredToProvider(msg.sender, provider, amount);
    }

    /**
     * @notice Provider acknowledges user (enables settlements)
     * @param user User address
     */
    function acknowledgeUser(address user) external {
        ProviderSubAccount storage subAccount = subAccounts[user][msg.sender];
        if (subAccount.acknowledged) revert AlreadyAcknowledged();

        subAccount.acknowledged = true;
        emit ProviderAcknowledged(user, msg.sender);
    }

    /**
     * @notice Request refund from provider sub-account
     * @param provider Provider address
     * @param amount Amount to refund
     */
    function requestRefund(address provider, uint256 amount) external nonReentrant {
        ProviderSubAccount storage subAccount = subAccounts[msg.sender][provider];
        if (subAccount.pendingRefund > 0) revert RefundAlreadyPending();
        if (amount > subAccount.balance) revert InsufficientBalance(subAccount.balance, amount);

        subAccount.balance -= amount;
        subAccount.pendingRefund = amount;
        subAccount.refundUnlockTime = block.timestamp + refundTimelockPeriod;

        emit RefundRequested(msg.sender, provider, amount, subAccount.refundUnlockTime);
    }

    /**
     * @notice Complete refund after timelock
     * @param provider Provider address
     */
    function completeRefund(address provider) external nonReentrant {
        ProviderSubAccount storage subAccount = subAccounts[msg.sender][provider];
        if (subAccount.pendingRefund == 0) revert NoRefundPending();
        if (block.timestamp < subAccount.refundUnlockTime) revert RefundNotUnlocked();

        uint256 amount = subAccount.pendingRefund;
        subAccount.pendingRefund = 0;
        subAccount.refundUnlockTime = 0;

        Ledger storage ledger = ledgers[msg.sender];
        ledger.lockedBalance -= amount;
        ledger.availableBalance += amount;

        emit RefundCompleted(msg.sender, provider, amount);
    }

    /**
     * @notice Cancel pending refund (return to sub-account)
     * @param provider Provider address
     */
    function cancelRefund(address provider) external {
        ProviderSubAccount storage subAccount = subAccounts[msg.sender][provider];
        if (subAccount.pendingRefund == 0) revert NoRefundPending();

        uint256 amount = subAccount.pendingRefund;
        subAccount.pendingRefund = 0;
        subAccount.refundUnlockTime = 0;
        subAccount.balance += amount;

        emit RefundCancelled(msg.sender, provider);
    }

    // ============ Settlement (InferenceServing only) ============

    /**
     * @notice Settle inference payment from user to provider
     * @param user User address
     * @param provider Provider address
     * @param amount Amount to settle
     * @param requestHash Hash of the inference request
     */
    function settle(address user, address provider, uint256 amount, bytes32 requestHash)
        external
        nonReentrant
        onlyInferenceContract
    {
        ProviderSubAccount storage subAccount = subAccounts[user][provider];
        if (!subAccount.acknowledged) revert ProviderNotAcknowledged();
        if (amount > subAccount.balance) revert InsufficientBalance(subAccount.balance, amount);

        subAccount.balance -= amount;

        Ledger storage ledger = ledgers[user];
        ledger.totalBalance -= amount;
        ledger.lockedBalance -= amount;

        // Transfer to provider
        (bool success,) = provider.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Settled(user, provider, amount, requestHash);
    }

    // ============ View Functions ============

    /**
     * @notice Get ledger info
     */
    function getLedger(address user) external view returns (Ledger memory) {
        return ledgers[user];
    }

    /**
     * @notice Get sub-account info
     */
    function getSubAccount(address user, address provider) external view returns (ProviderSubAccount memory) {
        return subAccounts[user][provider];
    }

    /**
     * @notice Get available balance
     */
    function getAvailableBalance(address user) external view returns (uint256) {
        return ledgers[user].availableBalance;
    }

    /**
     * @notice Get provider sub-account balance
     */
    function getProviderBalance(address user, address provider) external view returns (uint256) {
        return subAccounts[user][provider].balance;
    }

    /**
     * @notice Check if provider is acknowledged
     */
    function isAcknowledged(address user, address provider) external view returns (bool) {
        return subAccounts[user][provider].acknowledged;
    }

    /**
     * @notice Check if ledger exists
     */
    function ledgerExists(address user) external view returns (bool) {
        return ledgers[user].createdAt != 0;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set inference contract address
     */
    function setInferenceContract(address _inferenceContract) external onlyOwner {
        address oldContract = inferenceContract;
        inferenceContract = _inferenceContract;
        emit InferenceContractUpdated(oldContract, _inferenceContract);
    }

    /**
     * @notice Set registry address
     */
    function setRegistry(address _registry) external onlyOwner {
        address oldRegistry = registry;
        registry = _registry;
        emit RegistryUpdated(oldRegistry, _registry);
    }

    /**
     * @notice Update refund timelock period
     */
    function setRefundTimelockPeriod(uint256 period) external onlyOwner {
        uint256 oldPeriod = refundTimelockPeriod;
        refundTimelockPeriod = period;
        emit RefundTimelockUpdated(oldPeriod, period);
    }

    /**
     * @notice Set authorized CreditManager
     */
    function setCreditManager(address _creditManager) external onlyOwner {
        address oldManager = creditManager;
        creditManager = _creditManager;
        emit CreditManagerUpdated(oldManager, _creditManager);
    }

    /**
     * @notice Pause/unpause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
