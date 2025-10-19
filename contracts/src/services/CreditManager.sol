// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CreditManager
 * @author Jeju Network
 * @notice Manages prepaid balances for agents across all services
 * @dev Supports USDC, ETH, and elizaOS tokens for zero-latency payments
 *
 * Architecture:
 * - Users deposit tokens (USDC/ETH/elizaOS) to build credit balance
 * - Services deduct from balance (off-chain signature or on-chain)
 * - Overpayments automatically credit user account
 * - Low balance triggers new payment requirement
 * - Multi-token support with automatic conversion via oracle
 *
 * Benefits:
 * - Zero latency for most API calls (just balance check)
 * - Only need blockchain tx when topping up
 * - Overpayments don't require refunds
 * - Works across all services (Cloud, MCP, Caliguland, etc.)
 *
 * @custom:security-contact security@jeju.network
 */
contract CreditManager is Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /// @notice elizaOS token contract
    IERC20 public immutable elizaOS;

    /// @notice Mapping of user -> token -> balance
    mapping(address => mapping(address => uint256)) public balances;

    /// @notice Minimum balance to maintain (prevents dust)
    uint256 public minBalance = 1e6; // $1 in USDC or equivalent

    /// @notice Recommended top-up amount
    uint256 public recommendedTopUp = 10e6; // $10

    /// @notice Authorized services that can deduct credits
    mapping(address => bool) public authorizedServices;

    /// @notice ETH address constant
    address public constant ETH_ADDRESS = address(0);

    // ============ Events ============

    event CreditDeposited(address indexed user, address indexed token, uint256 amount, uint256 newBalance);
    event CreditDeducted(address indexed user, address indexed service, address indexed token, uint256 amount, uint256 remainingBalance);
    event BalanceLow(address indexed user, address indexed token, uint256 balance, uint256 recommended);
    event ServiceAuthorized(address indexed service, bool authorized);
    event MinBalanceUpdated(uint256 oldMin, uint256 newMin);

    // ============ Errors ============

    error InsufficientCredit(address user, address token, uint256 required, uint256 available);
    error UnauthorizedService(address service);
    error InvalidToken(address token);
    error InvalidAmount(uint256 amount);

    // ============ Constructor ============

    constructor(address _usdc, address _elizaOS) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_elizaOS != address(0), "Invalid elizaOS");
        
        usdc = IERC20(_usdc);
        elizaOS = IERC20(_elizaOS);
    }

    // ============ Deposit Functions ============

    /**
     * @notice Deposit USDC to build credit balance
     * @param amount Amount in USDC (6 decimals)
     */
    function depositUSDC(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount(amount);
        
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        balances[msg.sender][address(usdc)] += amount;
        
        emit CreditDeposited(msg.sender, address(usdc), amount, balances[msg.sender][address(usdc)]);
    }

    /**
     * @notice Deposit elizaOS tokens to build credit balance
     * @param amount Amount in elizaOS (18 decimals)
     */
    function depositElizaOS(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount(amount);
        
        elizaOS.safeTransferFrom(msg.sender, address(this), amount);
        
        balances[msg.sender][address(elizaOS)] += amount;
        
        emit CreditDeposited(msg.sender, address(elizaOS), amount, balances[msg.sender][address(elizaOS)]);
    }

    /**
     * @notice Deposit ETH to build credit balance
     */
    function depositETH() external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount(msg.value);
        
        balances[msg.sender][ETH_ADDRESS] += msg.value;
        
        emit CreditDeposited(msg.sender, ETH_ADDRESS, msg.value, balances[msg.sender][ETH_ADDRESS]);
    }

    /**
     * @notice Deposit any supported token (USDC, elizaOS, or ETH)
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external payable whenNotPaused {
        if (token == ETH_ADDRESS) {
            require(msg.value == amount, "ETH amount mismatch");
            balances[msg.sender][ETH_ADDRESS] += amount;
        } else if (token == address(usdc)) {
            usdc.safeTransferFrom(msg.sender, address(this), amount);
            balances[msg.sender][address(usdc)] += amount;
        } else if (token == address(elizaOS)) {
            elizaOS.safeTransferFrom(msg.sender, address(this), amount);
            balances[msg.sender][address(elizaOS)] += amount;
        } else {
            revert InvalidToken(token);
        }
        
        emit CreditDeposited(msg.sender, token, amount, balances[msg.sender][token]);
    }

    // ============ Deduction Functions (Service Only) ============

    /**
     * @notice Deduct credits for service usage
     * @param user User address
     * @param token Token to deduct from (USDC, elizaOS, or ETH)
     * @param amount Amount to deduct
     * @dev Only callable by authorized services
     */
    function deductCredit(address user, address token, uint256 amount) external whenNotPaused {
        if (!authorizedServices[msg.sender]) revert UnauthorizedService(msg.sender);
        
        uint256 userBalance = balances[user][token];
        if (userBalance < amount) {
            revert InsufficientCredit(user, token, amount, userBalance);
        }
        
        balances[user][token] -= amount;
        
        emit CreditDeducted(user, msg.sender, token, amount, balances[user][token]);
        
        // Emit warning if balance is low
        if (balances[user][token] < minBalance) {
            emit BalanceLow(user, token, balances[user][token], recommendedTopUp);
        }
    }

    /**
     * @notice Try to deduct credit, return false if insufficient (no revert)
     * @param user User address
     * @param token Token to deduct
     * @param amount Amount to deduct
     * @return success Whether deduction succeeded
     * @return remaining Remaining balance after deduction
     */
    function tryDeductCredit(address user, address token, uint256 amount) 
        external 
        whenNotPaused 
        returns (bool success, uint256 remaining) 
    {
        if (!authorizedServices[msg.sender]) revert UnauthorizedService(msg.sender);
        
        uint256 userBalance = balances[user][token];
        
        if (userBalance < amount) {
            return (false, userBalance);
        }
        
        balances[user][token] -= amount;
        
        emit CreditDeducted(user, msg.sender, token, amount, balances[user][token]);
        
        if (balances[user][token] < minBalance) {
            emit BalanceLow(user, token, balances[user][token], recommendedTopUp);
        }
        
        return (true, balances[user][token]);
    }

    // ============ Withdrawal Functions ============

    /**
     * @notice Withdraw credits back to user wallet
     * @param token Token to withdraw (USDC, elizaOS, or ETH)
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) external {
        uint256 userBalance = balances[msg.sender][token];
        if (userBalance < amount) {
            revert InsufficientCredit(msg.sender, token, amount, userBalance);
        }
        
        balances[msg.sender][token] -= amount;
        
        if (token == ETH_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        
        emit CreditDeducted(msg.sender, address(0), token, amount, balances[msg.sender][token]);
    }

    // ============ View Functions ============

    /**
     * @notice Get user's credit balance for a token
     * @param user User address
     * @param token Token address (address(0) for ETH)
     * @return balance User's balance in atomic units
     */
    function getBalance(address user, address token) external view returns (uint256 balance) {
        return balances[user][token];
    }

    /**
     * @notice Get user's balances for all supported tokens
     * @param user User address
     * @return usdcBalance USDC balance (6 decimals)
     * @return elizaBalance elizaOS balance (18 decimals)
     * @return ethBalance ETH balance (18 decimals)
     */
    function getAllBalances(address user) external view returns (
        uint256 usdcBalance,
        uint256 elizaBalance,
        uint256 ethBalance
    ) {
        usdcBalance = balances[user][address(usdc)];
        elizaBalance = balances[user][address(elizaOS)];
        ethBalance = balances[user][ETH_ADDRESS];
    }

    /**
     * @notice Check if user has sufficient credit
     * @param user User address
     * @param token Token address
     * @param amount Required amount
     * @return sufficient Whether user has enough credit
     * @return available Available balance
     */
    function hasSufficientCredit(address user, address token, uint256 amount) 
        external 
        view 
        returns (bool sufficient, uint256 available) 
    {
        available = balances[user][token];
        sufficient = available >= amount;
    }

    /**
     * @notice Check if balance is low and needs top-up
     * @param user User address
     * @param token Token address
     * @return isLow Whether balance is below minimum
     * @return balance Current balance
     * @return recommended Recommended top-up amount
     */
    function isBalanceLow(address user, address token) 
        external 
        view 
        returns (bool isLow, uint256 balance, uint256 recommended) 
    {
        balance = balances[user][token];
        isLow = balance < minBalance;
        recommended = recommendedTopUp;
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize a service to deduct credits
     * @param service Service contract address
     * @param authorized Whether service is authorized
     */
    function setServiceAuthorization(address service, bool authorized) external onlyOwner {
        authorizedServices[service] = authorized;
        emit ServiceAuthorized(service, authorized);
    }

    /**
     * @notice Update minimum balance threshold
     * @param newMin New minimum balance
     */
    function setMinBalance(uint256 newMin) external onlyOwner {
        uint256 oldMin = minBalance;
        minBalance = newMin;
        emit MinBalanceUpdated(oldMin, newMin);
    }

    /**
     * @notice Update recommended top-up amount
     * @param newAmount New recommended amount
     */
    function setRecommendedTopUp(uint256 newAmount) external onlyOwner {
        recommendedTopUp = newAmount;
    }

    /**
     * @notice Pause credit operations
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause credit operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw (owner only)
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == ETH_ADDRESS) {
            (bool success, ) = owner().call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Allow direct ETH deposits
        balances[msg.sender][ETH_ADDRESS] += msg.value;
        emit CreditDeposited(msg.sender, ETH_ADDRESS, msg.value, balances[msg.sender][ETH_ADDRESS]);
    }
}

