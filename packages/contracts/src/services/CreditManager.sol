// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

interface ILedgerManager {
    function depositFromCreditManager(address user) external payable;
}

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
contract CreditManager is Ownable, Pausable, ReentrancyGuard {
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

    /// @notice ERC-8004 Identity Registry for agent tracking (optional)
    IIdentityRegistry public identityRegistry;

    /// @notice Mapping of agent ID => token => balance (agent-based credit)
    mapping(uint256 => mapping(address => uint256)) public agentBalances;

    /// @notice Mapping of agent ID => total spent across all tokens (for reputation)
    mapping(uint256 => uint256) public agentTotalSpent;

    /// @notice LedgerManager for compute marketplace integration
    ILedgerManager public ledgerManager;

    // ============ Events ============

    event CreditDeposited(address indexed user, address indexed token, uint256 amount, uint256 newBalance);
    event CreditDeducted(
        address indexed user, address indexed service, address indexed token, uint256 amount, uint256 remainingBalance
    );
    event BalanceLow(address indexed user, address indexed token, uint256 balance, uint256 recommended);
    event ServiceAuthorized(address indexed service, bool authorized);
    event MinBalanceUpdated(uint256 oldMin, uint256 newMin);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentCreditDeposited(uint256 indexed agentId, address indexed token, uint256 amount, uint256 newBalance);
    event AgentCreditDeducted(
        uint256 indexed agentId,
        address indexed service,
        address indexed token,
        uint256 amount,
        uint256 remainingBalance
    );
    event LedgerManagerUpdated(address indexed oldManager, address indexed newManager);
    event ComputePayment(address indexed user, uint256 ethAmount, uint256 tokenAmount, address token);
    event LiquidityDeposited(address indexed depositor, uint256 amount, uint256 newBalance);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount, uint256 newBalance);

    // ============ Errors ============

    error InsufficientCredit(address user, address token, uint256 required, uint256 available);
    error UnauthorizedService(address service);
    error InvalidToken(address token);
    error InvalidAmount(uint256 amount);
    error ZeroAmount();
    error UnsupportedToken(address token);

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

    // ============ Compute Integration ============

    /**
     * @notice Pay for compute by transferring ETH credits to LedgerManager
     * @dev Deducts from user's ETH credit balance and deposits to LedgerManager
     * @param ethAmount Amount in wei to transfer to compute ledger
     */
    function payForCompute(uint256 ethAmount) external nonReentrant whenNotPaused {
        if (address(ledgerManager) == address(0)) revert UnauthorizedService(address(0));

        uint256 userEthBalance = balances[msg.sender][ETH_ADDRESS];
        if (userEthBalance < ethAmount) {
            revert InsufficientCredit(msg.sender, ETH_ADDRESS, ethAmount, userEthBalance);
        }

        // Deduct from credit balance
        balances[msg.sender][ETH_ADDRESS] -= ethAmount;

        // Deposit to LedgerManager on user's behalf
        ledgerManager.depositFromCreditManager{value: ethAmount}(msg.sender);

        emit ComputePayment(msg.sender, ethAmount, 0, ETH_ADDRESS);
        emit CreditDeducted(
            msg.sender, address(ledgerManager), ETH_ADDRESS, ethAmount, balances[msg.sender][ETH_ADDRESS]
        );
    }

    /**
     * @notice Pay for compute with any supported token (converted to ETH)
     * @dev For non-ETH tokens, requires price oracle to determine ETH value
     * @param token Token to pay with (USDC, elizaOS)
     * @param tokenAmount Amount of token to spend
     * @param minEthAmount Minimum ETH to receive (slippage protection)
     */
    function payForComputeWithToken(address token, uint256 tokenAmount, uint256 minEthAmount)
        external
        nonReentrant
        whenNotPaused
    {
        if (address(ledgerManager) == address(0)) revert UnauthorizedService(address(0));
        if (token == ETH_ADDRESS) revert ZeroAmount(); // Use payForCompute for ETH

        uint256 userBalance = balances[msg.sender][token];
        if (userBalance < tokenAmount) {
            revert InsufficientCredit(msg.sender, token, tokenAmount, userBalance);
        }

        // Simple conversion rate (in production, use oracle)
        // 1 USDC = 0.0003 ETH, 1 elizaOS = 0.0001 ETH (example rates)
        uint256 ethValue = 0;
        if (token == address(usdc)) {
            ethValue = (tokenAmount * 3e14) / 1e6; // USDC has 6 decimals
        } else if (token == address(elizaOS)) {
            ethValue = (tokenAmount * 1e14) / 1e18; // elizaOS has 18 decimals
        } else {
            revert UnsupportedToken(token);
        }

        if (ethValue < minEthAmount) revert InsufficientCredit(msg.sender, ETH_ADDRESS, minEthAmount, ethValue);
        if (ethValue > address(this).balance) {
            revert InsufficientCredit(address(this), ETH_ADDRESS, ethValue, address(this).balance);
        }

        // Deduct token from credit balance
        balances[msg.sender][token] -= tokenAmount;

        // Deposit ETH equivalent to LedgerManager
        ledgerManager.depositFromCreditManager{value: ethValue}(msg.sender);

        emit ComputePayment(msg.sender, ethValue, tokenAmount, token);
        emit CreditDeducted(msg.sender, address(ledgerManager), token, tokenAmount, balances[msg.sender][token]);
    }

    // ============ Withdrawal Functions ============

    /**
     * @notice Withdraw credits back to user wallet
     * @param token Token to withdraw (USDC, elizaOS, or ETH)
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        uint256 userBalance = balances[msg.sender][token];
        if (userBalance < amount) {
            revert InsufficientCredit(msg.sender, token, amount, userBalance);
        }

        balances[msg.sender][token] -= amount;

        if (token == ETH_ADDRESS) {
            (bool success,) = msg.sender.call{value: amount}("");
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
    function getAllBalances(address user)
        external
        view
        returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)
    {
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
     * @notice Set LedgerManager for compute integration
     * @param _ledgerManager LedgerManager contract address
     */
    function setLedgerManager(address _ledgerManager) external onlyOwner {
        address oldManager = address(ledgerManager);
        ledgerManager = ILedgerManager(_ledgerManager);
        emit LedgerManagerUpdated(oldManager, _ledgerManager);
    }

    /**
     * @notice Deposit ETH liquidity for token-to-ETH conversions
     * @dev Anyone can provide liquidity to enable payForComputeWithToken
     */
    function depositLiquidity() external payable {
        if (msg.value == 0) revert ZeroAmount();
        emit LiquidityDeposited(msg.sender, msg.value, address(this).balance);
    }

    /**
     * @notice Withdraw ETH liquidity (owner only)
     * @param amount Amount of ETH to withdraw
     */
    function withdrawLiquidity(uint256 amount) external onlyOwner {
        if (amount > address(this).balance) {
            revert InsufficientCredit(address(this), ETH_ADDRESS, amount, address(this).balance);
        }
        (bool success,) = owner().call{value: amount}("");
        require(success, "ETH transfer failed");
        emit LiquidityWithdrawn(owner(), amount, address(this).balance);
    }

    /**
     * @notice Get current ETH liquidity available for token conversions
     */
    function getLiquidity() external view returns (uint256) {
        return address(this).balance;
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
     * @notice Emergency withdraw stuck tokens
     * @dev Only owner can call, only when paused
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused(), "Must be paused");

        if (token == ETH_ADDRESS) {
            (bool success,) = owner().call{value: amount}("");
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

    // ============ ERC-8004 Integration ============

    error InvalidAgentId();
    error NotAgentOwner();

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Deposit credits for an ERC-8004 agent
     * @param agentId The agent ID to credit
     * @param token Token to deposit (address(0) for ETH)
     * @param amount Amount to deposit
     */
    function depositForAgent(uint256 agentId, address token, uint256 amount) external payable whenNotPaused {
        if (address(identityRegistry) == address(0)) revert InvalidToken(address(0));
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        if (token == ETH_ADDRESS) {
            require(msg.value == amount, "ETH amount mismatch");
            agentBalances[agentId][ETH_ADDRESS] += amount;
        } else if (token == address(usdc)) {
            usdc.safeTransferFrom(msg.sender, address(this), amount);
            agentBalances[agentId][address(usdc)] += amount;
        } else if (token == address(elizaOS)) {
            elizaOS.safeTransferFrom(msg.sender, address(this), amount);
            agentBalances[agentId][address(elizaOS)] += amount;
        } else {
            revert InvalidToken(token);
        }

        emit AgentCreditDeposited(agentId, token, amount, agentBalances[agentId][token]);
    }

    /**
     * @notice Deduct credits from an ERC-8004 agent
     * @param agentId Agent ID to deduct from
     * @param token Token to deduct
     * @param amount Amount to deduct
     */
    function deductAgentCredit(uint256 agentId, address token, uint256 amount) external nonReentrant whenNotPaused {
        if (!authorizedServices[msg.sender]) revert UnauthorizedService(msg.sender);

        uint256 available = agentBalances[agentId][token];
        if (available < amount) revert InsufficientCredit(address(0), token, amount, available);

        agentBalances[agentId][token] -= amount;
        agentTotalSpent[agentId] += amount;

        emit AgentCreditDeducted(agentId, msg.sender, token, amount, agentBalances[agentId][token]);
    }

    /**
     * @notice Check agent's credit balance
     * @param agentId Agent ID to check
     * @param token Token to check
     * @return balance Current balance
     */
    function getAgentBalance(uint256 agentId, address token) external view returns (uint256) {
        return agentBalances[agentId][token];
    }

    /**
     * @notice Get total amount spent by an agent (for reputation tracking)
     * @param agentId Agent ID to check
     * @return totalSpent Total spent across all tokens
     */
    function getAgentTotalSpent(uint256 agentId) external view returns (uint256) {
        return agentTotalSpent[agentId];
    }

    /**
     * @notice Check if agent has sufficient credit
     * @param agentId Agent ID to check
     * @param token Token to check
     * @param amount Required amount
     * @return sufficient Whether balance is sufficient
     * @return available Current balance
     */
    function hasAgentSufficientCredit(uint256 agentId, address token, uint256 amount)
        external
        view
        returns (bool sufficient, uint256 available)
    {
        available = agentBalances[agentId][token];
        sufficient = available >= amount;
    }
}
