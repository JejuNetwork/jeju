// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStorageTypes} from "./IStorageTypes.sol";

/**
 * @title StorageLedgerManager
 * @author Jeju Network
 * @notice Manages user balances and provider escrow for storage payments
 * @dev Users deposit ETH, which is allocated to providers as storage is used
 */
contract StorageLedgerManager is IStorageTypes, ReentrancyGuard {
    // ============ State ============

    mapping(address => Ledger) private _ledgers;
    mapping(address => mapping(address => SubAccount)) private _subAccounts;

    uint256 public refundLockPeriod = 7 days;

    // ============ Events ============

    event LedgerCreated(address indexed user, uint256 initialDeposit);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event TransferredToProvider(address indexed user, address indexed provider, uint256 amount);
    event RefundRequested(address indexed user, address indexed provider, uint256 amount, uint256 unlockTime);
    event RefundClaimed(address indexed user, address indexed provider, uint256 amount);
    event UserAcknowledged(address indexed user, address indexed provider);

    // ============ User Functions ============

    function createLedger() external payable nonReentrant {
        require(_ledgers[msg.sender].createdAt == 0, "Ledger exists");

        _ledgers[msg.sender] =
            Ledger({totalBalance: msg.value, availableBalance: msg.value, lockedBalance: 0, createdAt: block.timestamp});

        emit LedgerCreated(msg.sender, msg.value);
    }

    function deposit() external payable nonReentrant {
        require(_ledgers[msg.sender].createdAt > 0, "Ledger not found");

        _ledgers[msg.sender].totalBalance += msg.value;
        _ledgers[msg.sender].availableBalance += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        Ledger storage ledger = _ledgers[msg.sender];
        require(ledger.availableBalance >= amount, "Insufficient balance");

        ledger.availableBalance -= amount;
        ledger.totalBalance -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function transferToProvider(address provider, uint256 amount) external nonReentrant {
        Ledger storage ledger = _ledgers[msg.sender];
        require(ledger.availableBalance >= amount, "Insufficient balance");

        ledger.availableBalance -= amount;
        ledger.lockedBalance += amount;

        SubAccount storage subAccount = _subAccounts[msg.sender][provider];
        subAccount.balance += amount;

        emit TransferredToProvider(msg.sender, provider, amount);
    }

    function requestRefund(address provider, uint256 amount) external nonReentrant {
        SubAccount storage subAccount = _subAccounts[msg.sender][provider];
        require(subAccount.balance >= amount, "Insufficient sub-account balance");
        require(subAccount.pendingRefund == 0, "Refund already pending");

        subAccount.balance -= amount;
        subAccount.pendingRefund = amount;
        subAccount.refundUnlockTime = block.timestamp + refundLockPeriod;

        emit RefundRequested(msg.sender, provider, amount, subAccount.refundUnlockTime);
    }

    function claimRefund(address provider) external nonReentrant {
        SubAccount storage subAccount = _subAccounts[msg.sender][provider];
        require(subAccount.pendingRefund > 0, "No pending refund");
        require(block.timestamp >= subAccount.refundUnlockTime, "Refund locked");

        uint256 amount = subAccount.pendingRefund;
        subAccount.pendingRefund = 0;
        subAccount.refundUnlockTime = 0;

        Ledger storage ledger = _ledgers[msg.sender];
        ledger.lockedBalance -= amount;
        ledger.availableBalance += amount;

        emit RefundClaimed(msg.sender, provider, amount);
    }

    // ============ Provider Functions ============

    function acknowledgeUser(address user) external {
        _subAccounts[user][msg.sender].acknowledged = true;
        emit UserAcknowledged(user, msg.sender);
    }

    function claimPayment(address user, uint256 amount) external nonReentrant {
        SubAccount storage subAccount = _subAccounts[user][msg.sender];
        require(subAccount.balance >= amount, "Insufficient balance");

        subAccount.balance -= amount;

        Ledger storage ledger = _ledgers[user];
        ledger.lockedBalance -= amount;
        ledger.totalBalance -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // ============ View Functions ============

    function getLedger(address user) external view returns (Ledger memory) {
        return _ledgers[user];
    }

    function getSubAccount(address user, address provider) external view returns (SubAccount memory) {
        return _subAccounts[user][provider];
    }

    function getAvailableBalance(address user) external view returns (uint256) {
        return _ledgers[user].availableBalance;
    }

    function ledgerExists(address user) external view returns (bool) {
        return _ledgers[user].createdAt > 0;
    }
}
