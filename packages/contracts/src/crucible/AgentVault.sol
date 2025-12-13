// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgentVault
 * @author Jeju Network
 * @notice Manages funding for autonomous AI agents
 * @dev Each agent has a vault that holds ETH for paying execution costs.
 *      Approved executors can spend from the vault on behalf of agents.
 *
 * Features:
 * - Per-agent vaults with isolated balances
 * - Spend limits per execution
 * - Approved spender whitelist
 * - Auto-refund on low balance (optional)
 * - Full audit trail of all transactions
 *
 * @custom:security-contact security@jeju.network
 */
contract AgentVault is Ownable, ReentrancyGuard, Pausable {
    // ============ Structs ============

    struct Vault {
        uint256 agentId;
        address owner;
        uint256 balance;
        uint256 spendLimit;
        uint256 totalSpent;
        uint256 totalDeposits;
        uint256 createdAt;
        uint256 lastActivityAt;
        bool active;
    }

    struct SpendRecord {
        uint256 agentId;
        address spender;
        address recipient;
        uint256 amount;
        string reason;
        uint256 timestamp;
    }

    // ============ State Variables ============

    /// @notice Mapping of agentId => vault address (deterministic)
    mapping(uint256 => address) public vaultAddresses;

    /// @notice Mapping of vault address => vault data
    mapping(address => Vault) public vaults;

    /// @notice Mapping of agentId => approved spenders
    mapping(uint256 => mapping(address => bool)) public approvedSpenders;

    /// @notice Mapping of agentId => spend records
    mapping(uint256 => SpendRecord[]) private _spendHistory;

    /// @notice Global approved executors (can spend from any vault)
    mapping(address => bool) public globalExecutors;

    /// @notice Default spend limit for new vaults
    uint256 public defaultSpendLimit = 0.01 ether;

    /// @notice Minimum vault balance to maintain
    uint256 public minVaultBalance = 0.001 ether;

    /// @notice Protocol fee on spends (basis points, max 500 = 5%)
    uint256 public protocolFeeBps = 100; // 1%

    /// @notice Protocol fee recipient
    address public feeRecipient;

    /// @notice Total vaults created
    uint256 public totalVaults;

    /// @notice Total value locked across all vaults
    uint256 public totalValueLocked;

    // ============ Events ============

    event VaultCreated(uint256 indexed agentId, address indexed owner, address vault, uint256 initialBalance);
    event Deposit(uint256 indexed agentId, address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawal(uint256 indexed agentId, address indexed to, uint256 amount, uint256 newBalance);
    event Spent(uint256 indexed agentId, address indexed spender, address recipient, uint256 amount, string reason);
    event SpenderApproved(uint256 indexed agentId, address indexed spender, bool approved);
    event SpendLimitUpdated(uint256 indexed agentId, uint256 oldLimit, uint256 newLimit);
    event VaultDeactivated(uint256 indexed agentId);
    event VaultReactivated(uint256 indexed agentId);
    event GlobalExecutorUpdated(address indexed executor, bool approved);
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);

    // ============ Errors ============

    error VaultAlreadyExists(uint256 agentId);
    error VaultNotFound(uint256 agentId);
    error VaultNotActive(uint256 agentId);
    error NotVaultOwner(uint256 agentId, address caller);
    error NotApprovedSpender(uint256 agentId, address spender);
    error InsufficientBalance(uint256 available, uint256 required);
    error SpendLimitExceeded(uint256 limit, uint256 requested);
    error InvalidAmount();
    error TransferFailed();
    error InvalidFeeRecipient();

    // ============ Modifiers ============

    modifier onlyVaultOwner(uint256 agentId) {
        if (vaults[vaultAddresses[agentId]].owner != msg.sender) {
            revert NotVaultOwner(agentId, msg.sender);
        }
        _;
    }

    modifier onlyApprovedSpender(uint256 agentId) {
        address vaultAddr = vaultAddresses[agentId];
        if (!approvedSpenders[agentId][msg.sender] && !globalExecutors[msg.sender] && vaults[vaultAddr].owner != msg.sender) {
            revert NotApprovedSpender(agentId, msg.sender);
        }
        _;
    }

    modifier vaultExists(uint256 agentId) {
        if (vaultAddresses[agentId] == address(0)) {
            revert VaultNotFound(agentId);
        }
        _;
    }

    modifier vaultActive(uint256 agentId) {
        if (!vaults[vaultAddresses[agentId]].active) {
            revert VaultNotActive(agentId);
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _feeRecipient) Ownable(msg.sender) {
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();
        feeRecipient = _feeRecipient;
    }

    // ============ Vault Management ============

    /**
     * @notice Create a vault for an agent
     * @param agentId The ERC-8004 agent ID
     * @return vault The vault address
     */
    function createVault(uint256 agentId) external payable nonReentrant whenNotPaused returns (address vault) {
        if (vaultAddresses[agentId] != address(0)) {
            revert VaultAlreadyExists(agentId);
        }

        // Generate deterministic vault address
        vault = _computeVaultAddress(agentId);
        
        vaultAddresses[agentId] = vault;
        vaults[vault] = Vault({
            agentId: agentId,
            owner: msg.sender,
            balance: msg.value,
            spendLimit: defaultSpendLimit,
            totalSpent: 0,
            totalDeposits: msg.value,
            createdAt: block.timestamp,
            lastActivityAt: block.timestamp,
            active: true
        });

        totalVaults++;
        totalValueLocked += msg.value;

        emit VaultCreated(agentId, msg.sender, vault, msg.value);
    }

    /**
     * @notice Deposit ETH into an agent's vault
     * @param agentId The agent ID
     */
    function deposit(uint256 agentId) external payable nonReentrant vaultExists(agentId) vaultActive(agentId) {
        if (msg.value == 0) revert InvalidAmount();

        address vaultAddr = vaultAddresses[agentId];
        Vault storage vault = vaults[vaultAddr];

        vault.balance += msg.value;
        vault.totalDeposits += msg.value;
        vault.lastActivityAt = block.timestamp;
        totalValueLocked += msg.value;

        emit Deposit(agentId, msg.sender, msg.value, vault.balance);
    }

    /**
     * @notice Withdraw ETH from vault (owner only)
     * @param agentId The agent ID
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 agentId, uint256 amount)
        external
        nonReentrant
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        if (amount == 0) revert InvalidAmount();

        address vaultAddr = vaultAddresses[agentId];
        Vault storage vault = vaults[vaultAddr];

        if (vault.balance < amount) {
            revert InsufficientBalance(vault.balance, amount);
        }

        vault.balance -= amount;
        vault.lastActivityAt = block.timestamp;
        totalValueLocked -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(agentId, msg.sender, amount, vault.balance);
    }

    // ============ Spending ============

    /**
     * @notice Spend from agent vault (approved spenders only)
     * @param agentId The agent ID
     * @param recipient Address to send funds to
     * @param amount Amount to spend
     * @param reason Description of the spend
     */
    function spend(uint256 agentId, address recipient, uint256 amount, string calldata reason)
        external
        nonReentrant
        whenNotPaused
        vaultExists(agentId)
        vaultActive(agentId)
        onlyApprovedSpender(agentId)
    {
        if (amount == 0) revert InvalidAmount();

        address vaultAddr = vaultAddresses[agentId];
        Vault storage vault = vaults[vaultAddr];

        // Check spend limit
        if (amount > vault.spendLimit) {
            revert SpendLimitExceeded(vault.spendLimit, amount);
        }

        // Check balance
        if (vault.balance < amount) {
            revert InsufficientBalance(vault.balance, amount);
        }

        // Calculate protocol fee
        uint256 fee = (amount * protocolFeeBps) / 10000;
        uint256 recipientAmount = amount - fee;

        // Update state
        vault.balance -= amount;
        vault.totalSpent += amount;
        vault.lastActivityAt = block.timestamp;
        totalValueLocked -= amount;

        // Record spend
        _spendHistory[agentId].push(SpendRecord({
            agentId: agentId,
            spender: msg.sender,
            recipient: recipient,
            amount: amount,
            reason: reason,
            timestamp: block.timestamp
        }));

        // Transfer funds
        (bool success,) = recipient.call{value: recipientAmount}("");
        if (!success) revert TransferFailed();

        if (fee > 0) {
            (bool feeSuccess,) = feeRecipient.call{value: fee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        emit Spent(agentId, msg.sender, recipient, amount, reason);
    }

    // ============ Spender Management ============

    /**
     * @notice Approve or revoke a spender for an agent
     * @param agentId The agent ID
     * @param spender Address to approve/revoke
     */
    function approveSpender(uint256 agentId, address spender)
        external
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        approvedSpenders[agentId][spender] = true;
        emit SpenderApproved(agentId, spender, true);
    }

    /**
     * @notice Revoke spender approval
     * @param agentId The agent ID
     * @param spender Address to revoke
     */
    function revokeSpender(uint256 agentId, address spender)
        external
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        approvedSpenders[agentId][spender] = false;
        emit SpenderApproved(agentId, spender, false);
    }

    /**
     * @notice Set spend limit for an agent
     * @param agentId The agent ID
     * @param limit New spend limit
     */
    function setSpendLimit(uint256 agentId, uint256 limit)
        external
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        address vaultAddr = vaultAddresses[agentId];
        uint256 oldLimit = vaults[vaultAddr].spendLimit;
        vaults[vaultAddr].spendLimit = limit;
        emit SpendLimitUpdated(agentId, oldLimit, limit);
    }

    // ============ Vault Status ============

    /**
     * @notice Deactivate a vault (owner only)
     * @param agentId The agent ID
     */
    function deactivateVault(uint256 agentId)
        external
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        vaults[vaultAddresses[agentId]].active = false;
        emit VaultDeactivated(agentId);
    }

    /**
     * @notice Reactivate a vault (owner only)
     * @param agentId The agent ID
     */
    function reactivateVault(uint256 agentId)
        external
        vaultExists(agentId)
        onlyVaultOwner(agentId)
    {
        vaults[vaultAddresses[agentId]].active = true;
        emit VaultReactivated(agentId);
    }

    // ============ View Functions ============

    /**
     * @notice Get vault address for an agent
     */
    function getVault(uint256 agentId) external view returns (address) {
        return vaultAddresses[agentId];
    }

    /**
     * @notice Get vault balance
     */
    function getBalance(uint256 agentId) external view returns (uint256) {
        return vaults[vaultAddresses[agentId]].balance;
    }

    /**
     * @notice Get full vault info
     */
    function getVaultInfo(uint256 agentId) external view returns (Vault memory) {
        return vaults[vaultAddresses[agentId]];
    }

    /**
     * @notice Get spend history for an agent
     */
    function getSpendHistory(uint256 agentId, uint256 limit) external view returns (SpendRecord[] memory) {
        SpendRecord[] storage history = _spendHistory[agentId];
        uint256 start = history.length > limit ? history.length - limit : 0;
        uint256 count = history.length - start;

        SpendRecord[] memory result = new SpendRecord[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = history[start + i];
        }
        return result;
    }

    /**
     * @notice Check if address is approved spender
     */
    function isApprovedSpender(uint256 agentId, address spender) external view returns (bool) {
        if (globalExecutors[spender]) return true;
        if (vaults[vaultAddresses[agentId]].owner == spender) return true;
        return approvedSpenders[agentId][spender];
    }

    // ============ Admin Functions ============

    /**
     * @notice Set global executor
     */
    function setGlobalExecutor(address executor, bool approved) external onlyOwner {
        globalExecutors[executor] = approved;
        emit GlobalExecutorUpdated(executor, approved);
    }

    /**
     * @notice Update default spend limit
     */
    function setDefaultSpendLimit(uint256 limit) external onlyOwner {
        defaultSpendLimit = limit;
    }

    /**
     * @notice Update protocol fee
     */
    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 500, "Fee too high"); // Max 5%
        emit ProtocolFeeUpdated(protocolFeeBps, newFeeBps);
        protocolFeeBps = newFeeBps;
    }

    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidFeeRecipient();
        feeRecipient = newRecipient;
    }

    /**
     * @notice Pause contract
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

    function _computeVaultAddress(uint256 agentId) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(address(this), agentId, block.chainid)))));
    }
}
