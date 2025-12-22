// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Treasury
 * @notice Base treasury contract with rate-limited withdrawals and operator management
 */
contract Treasury is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant COUNCIL_ROLE = keccak256("COUNCIL_ROLE");
    uint256 public dailyWithdrawalLimit;
    uint256 public withdrawnToday;
    uint256 public lastWithdrawalDay;
    mapping(address => uint256) public tokenDeposits;
    uint256 public totalEthDeposits;
    event FundsDeposited(address indexed from, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed to, address indexed token, uint256 amount);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);
    event EmergencyWithdrawal(address indexed token, address indexed to, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 requested);
    error ExceedsDailyLimit(uint256 limit, uint256 requested, uint256 remaining);
    error TransferFailed();

    constructor(uint256 _dailyLimit, address _admin) {
        if (_admin == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(COUNCIL_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        dailyWithdrawalLimit = _dailyLimit;
    }

    receive() external payable {
        totalEthDeposits += msg.value;
        emit FundsDeposited(msg.sender, address(0), msg.value);
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        totalEthDeposits += msg.value;
        emit FundsDeposited(msg.sender, address(0), msg.value);
    }

    function depositToken(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenDeposits[token] += amount;

        emit FundsDeposited(msg.sender, token, amount);
    }

    function withdrawETH(uint256 amount, address to)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) {
            revert InsufficientBalance(address(this).balance, amount);
        }

        _enforceWithdrawalLimit(amount);

        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FundsWithdrawn(to, address(0), amount);
    }

    function withdrawToken(address token, uint256 amount, address to)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) {
            revert InsufficientBalance(balance, amount);
        }

        IERC20(token).safeTransfer(to, amount);

        emit FundsWithdrawn(to, token, amount);
    }

    function _enforceWithdrawalLimit(uint256 amount) internal {
        uint256 currentDay = block.timestamp / 1 days;

        if (currentDay > lastWithdrawalDay) {
            withdrawnToday = 0;
            lastWithdrawalDay = currentDay;
        }

        uint256 remaining = dailyWithdrawalLimit > withdrawnToday
            ? dailyWithdrawalLimit - withdrawnToday
            : 0;

        if (amount > remaining) {
            revert ExceedsDailyLimit(dailyWithdrawalLimit, amount, remaining);
        }

        withdrawnToday += amount;
    }

    function setDailyLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = dailyWithdrawalLimit;
        dailyWithdrawalLimit = newLimit;
        emit DailyLimitUpdated(oldLimit, newLimit);
    }

    function addOperator(address operator) external onlyRole(COUNCIL_ROLE) {
        if (operator == address(0)) revert ZeroAddress();
        _grantRole(OPERATOR_ROLE, operator);
        emit OperatorAdded(operator);
    }

    function removeOperator(address operator) external onlyRole(COUNCIL_ROLE) {
        _revokeRole(OPERATOR_ROLE, operator);
        emit OperatorRemoved(operator);
    }

    function addCouncilMember(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (member == address(0)) revert ZeroAddress();
        _grantRole(COUNCIL_ROLE, member);
        emit CouncilMemberAdded(member);
    }

    function removeCouncilMember(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(COUNCIL_ROLE, member);
        emit CouncilMemberRemoved(member);
    }

    function emergencyWithdraw(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            if (address(this).balance < amount) {
                revert InsufficientBalance(address(this).balance, amount);
            }
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) {
                revert InsufficientBalance(balance, amount);
            }
            IERC20(token).safeTransfer(to, amount);
        }

        emit EmergencyWithdrawal(token, to, amount);
    }

    function pause() external onlyRole(COUNCIL_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(COUNCIL_ROLE) {
        _unpause();
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function getWithdrawalInfo()
        external
        view
        returns (uint256 limit, uint256 usedToday, uint256 remaining)
    {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 todayWithdrawn = currentDay > lastWithdrawalDay ? 0 : withdrawnToday;
        uint256 remainingToday = dailyWithdrawalLimit > todayWithdrawn
            ? dailyWithdrawalLimit - todayWithdrawn
            : 0;

        return (dailyWithdrawalLimit, todayWithdrawn, remainingToday);
    }

    function isOperator(address account) external view returns (bool) {
        return hasRole(OPERATOR_ROLE, account);
    }

    function isCouncilMember(address account) external view returns (bool) {
        return hasRole(COUNCIL_ROLE, account);
    }

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }
}
