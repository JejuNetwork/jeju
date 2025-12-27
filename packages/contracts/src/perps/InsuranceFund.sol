// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IInsuranceFund, IPriceOracle} from "./interfaces/IPerps.sol";

/**
 * @title InsuranceFund
 * @notice Protocol safety net for covering underwater positions
 * @dev Accumulates fees from liquidations and covers deficits when traders default
 */
contract InsuranceFund is IInsuranceFund, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Price oracle for valuation
    IPriceOracle public priceOracle;

    // Authorized contracts that can withdraw/cover deficits
    mapping(address => bool) public authorizedContracts;

    // Token balances
    mapping(address => uint256) public tokenBalances;
    address[] public supportedTokens;
    mapping(address => bool) public isSupported;

    // Statistics
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public totalDeficitsCovered;

    // SECURITY: Timelocks and limits
    uint256 public constant ORACLE_CHANGE_DELAY = 24 hours;
    uint256 public constant WITHDRAWAL_DELAY = 48 hours;
    uint256 public constant DAILY_WITHDRAWAL_LIMIT_BPS = 1000; // 10% max per day

    address public pendingOracle;
    uint256 public oracleChangeTime;

    struct PendingWithdrawal {
        address token;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
    }

    mapping(bytes32 => PendingWithdrawal) public pendingWithdrawals;
    mapping(uint256 => uint256) public dailyWithdrawals; // day => amount withdrawn

    event OracleChangeProposed(address indexed newOracle, uint256 executeAfter);
    event OracleChangeExecuted(address indexed oldOracle, address indexed newOracle);
    event WithdrawalProposed(bytes32 indexed withdrawalId, address token, uint256 amount, uint256 executeAfter);
    event WithdrawalExecuted(bytes32 indexed withdrawalId, address token, uint256 amount);
    event WithdrawalCancelled(bytes32 indexed withdrawalId);

    error OracleChangePending();
    error NoOracleChangePending();
    error OracleChangeNotReady();
    error WithdrawalNotFound();
    error WithdrawalNotReady();
    error WithdrawalAlreadyExecuted();
    error ExceedsDailyLimit();

    constructor(address _priceOracle, address _owner) Ownable(_owner) {
        priceOracle = IPriceOracle(_priceOracle);
    }

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    // ============ Admin Functions ============

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
    }

    /// @notice Propose a new oracle - requires 24-hour delay
    /// @dev SECURITY: Prevents instant oracle manipulation
    function proposePriceOracle(address _priceOracle) public onlyOwner {
        require(_priceOracle != address(0), "Invalid oracle");
        if (pendingOracle != address(0)) revert OracleChangePending();

        pendingOracle = _priceOracle;
        oracleChangeTime = block.timestamp + ORACLE_CHANGE_DELAY;
        emit OracleChangeProposed(_priceOracle, oracleChangeTime);
    }

    /// @notice Execute oracle change after timelock
    function executePriceOracleChange() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleChangePending();
        if (block.timestamp < oracleChangeTime) revert OracleChangeNotReady();

        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(pendingOracle);
        emit OracleChangeExecuted(oldOracle, pendingOracle);

        pendingOracle = address(0);
        oracleChangeTime = 0;
    }

    /// @notice Legacy setPriceOracle - now requires timelock
    function setPriceOracle(address _priceOracle) external onlyOwner {
        proposePriceOracle(_priceOracle);
    }

    function addSupportedToken(address token) external onlyOwner {
        if (!isSupported[token]) {
            supportedTokens.push(token);
            isSupported[token] = true;
        }
    }

    // ============ Fund Operations ============

    /**
     * @notice Deposit funds into the insurance fund
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        tokenBalances[token] += amount;
        totalDeposits += amount;

        if (!isSupported[token]) {
            supportedTokens.push(token);
            isSupported[token] = true;
        }

        emit FundDeposit(token, amount);
    }

    /**
     * @notice Propose withdrawing funds - requires 48-hour delay + daily limit
     * @dev SECURITY: Prevents instant fund drainage
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function proposeWithdraw(address token, uint256 amount) public onlyOwner returns (bytes32 withdrawalId) {
        require(tokenBalances[token] >= amount, "Insufficient balance");

        // Check daily limit (10% of total balance per day)
        uint256 dailyLimit = (tokenBalances[token] * DAILY_WITHDRAWAL_LIMIT_BPS) / 10000;
        uint256 today = block.timestamp / 1 days;
        if (dailyWithdrawals[today] + amount > dailyLimit) revert ExceedsDailyLimit();

        withdrawalId = keccak256(abi.encodePacked(token, amount, block.timestamp));
        pendingWithdrawals[withdrawalId] = PendingWithdrawal({
            token: token,
            amount: amount,
            executeAfter: block.timestamp + WITHDRAWAL_DELAY,
            executed: false
        });

        emit WithdrawalProposed(withdrawalId, token, amount, block.timestamp + WITHDRAWAL_DELAY);
    }

    /// @notice Execute pending withdrawal after timelock
    function executeWithdraw(bytes32 withdrawalId) external onlyOwner nonReentrant {
        PendingWithdrawal storage w = pendingWithdrawals[withdrawalId];
        if (w.executeAfter == 0) revert WithdrawalNotFound();
        if (w.executed) revert WithdrawalAlreadyExecuted();
        if (block.timestamp < w.executeAfter) revert WithdrawalNotReady();

        w.executed = true;

        // Re-check balance and daily limit
        require(tokenBalances[w.token] >= w.amount, "Insufficient balance");
        uint256 today = block.timestamp / 1 days;
        uint256 dailyLimit = (tokenBalances[w.token] * DAILY_WITHDRAWAL_LIMIT_BPS) / 10000;
        if (dailyWithdrawals[today] + w.amount > dailyLimit) revert ExceedsDailyLimit();

        tokenBalances[w.token] -= w.amount;
        totalWithdrawals += w.amount;
        dailyWithdrawals[today] += w.amount;

        IERC20(w.token).safeTransfer(msg.sender, w.amount);

        emit WithdrawalExecuted(withdrawalId, w.token, w.amount);
        emit FundWithdraw(w.token, w.amount);
    }

    /// @notice Cancel pending withdrawal
    function cancelWithdraw(bytes32 withdrawalId) external onlyOwner {
        PendingWithdrawal storage w = pendingWithdrawals[withdrawalId];
        if (w.executeAfter == 0) revert WithdrawalNotFound();
        if (w.executed) revert WithdrawalAlreadyExecuted();

        delete pendingWithdrawals[withdrawalId];
        emit WithdrawalCancelled(withdrawalId);
    }

    /**
     * @notice Legacy withdraw - now requires timelock + daily limit
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        proposeWithdraw(token, amount);
    }

    /**
     * @notice Cover a trading deficit (called by trading contract)
     * @param token Token needed to cover deficit
     * @param amount Amount of deficit to cover
     */
    function coverDeficit(address token, uint256 amount) external onlyAuthorized nonReentrant {
        uint256 balance = tokenBalances[token];
        uint256 toCover = amount > balance ? balance : amount;

        if (toCover > 0) {
            tokenBalances[token] -= toCover;
            totalDeficitsCovered += toCover;

            IERC20(token).safeTransfer(msg.sender, toCover);

            emit DeficitCovered(bytes32(0), toCover);
        }
    }

    // ============ View Functions ============

    function getBalance(address token) external view returns (uint256) {
        return tokenBalances[token];
    }

    function getTotalValue() external view returns (uint256 totalValueUSD) {
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 balance = tokenBalances[token];

            if (balance > 0) {
                (uint256 price,) = priceOracle.getPrice(token);
                totalValueUSD += (balance * price) / 1e18;
            }
        }
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    function getStats() external view returns (uint256 deposits, uint256 withdrawals, uint256 deficitsCovered) {
        return (totalDeposits, totalWithdrawals, totalDeficitsCovered);
    }
}
