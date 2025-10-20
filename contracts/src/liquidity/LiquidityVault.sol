// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LiquidityVault
 * @author Jeju Network
 * @notice Dual-pool liquidity vault enabling decentralized paymaster operations
 * @dev Manages separate ETH and elizaOS liquidity pools where liquidity providers earn
 *      proportional fees from paymaster transactions. ETH is used to sponsor gas costs,
 *      while elizaOS collected from users is distributed as fees.
 * 
 * Architecture:
 * - Two independent pools: ETH (for gas) and elizaOS (optional diversification)
 * - Share-based accounting similar to Uniswap LP tokens
 * - Proportional fee distribution based on LP share ownership
 * - Utilization limits protect against over-deployment
 * 
 * Fee Distribution Model:
 * - LPs earn 50% of all transaction fees (split 70/30 between ETH/elizaOS LPs)
 * - Fees are immediately credited per-share (no time-based vesting)
 * - Gas-efficient accounting using accumulated fees per share
 * - LPs can claim fees anytime without unstaking
 * 
 * Security Features:
 * - Maximum utilization cap (80%) prevents liquidity exhaustion
 * - Minimum liquidity requirement ensures operational buffer
 * - Share-based accounting prevents dilution attacks
 * - Pausable for emergency situations
 * - Protected withdrawal/deposit flows with reentrancy guards
 * 
 * @custom:security-contact security@jeju.network
 */
contract LiquidityVault is ReentrancyGuard, Ownable, Pausable {
    // ============ State Variables ============
    
    /// @notice Reward token contract (used for fee distribution)
    IERC20 public immutable rewardToken;
    
    // ============ ETH Liquidity Pool ============
    
    /// @notice Total ETH liquidity shares issued
    /// @dev Similar to LP tokens in Uniswap - represents proportional ownership
    uint256 public totalETHLiquidity;
    
    /// @notice ETH shares owned by each LP
    mapping(address => uint256) public ethShares;
    
    // ============ elizaOS Liquidity Pool ============
    
    /// @notice Total elizaOS liquidity shares issued
    uint256 public totalElizaLiquidity;
    
    /// @notice elizaOS shares owned by each LP
    mapping(address => uint256) public elizaShares;
    
    // ============ Fee Tracking (Per-Share Accounting) ============
    
    /// @notice Accumulated fees per ETH share (scaled by PRECISION)
    /// @dev Increases when fees are distributed, used to calculate pending rewards
    uint256 public ethFeesPerShare;
    
    /// @notice Accumulated fees per elizaOS share (scaled by PRECISION)
    uint256 public elizaFeesPerShare;
    
    /// @notice Last ethFeesPerShare value when LP last updated fees
    /// @dev Used to calculate fees earned since last claim
    mapping(address => uint256) public ethFeesPerSharePaid;
    
    /// @notice Last elizaFeesPerShare value when LP last updated fees
    mapping(address => uint256) public elizaFeesPerSharePaid;
    
    /// @notice Pending fees accumulated for each LP (in elizaOS tokens)
    mapping(address => uint256) public pendingETHFees;
    
    /// @notice Pending fees accumulated for elizaOS pool LPs
    mapping(address => uint256) public pendingElizaFees;
    
    // ============ Access Control ============
    
    /// @notice Paymaster contract authorized to request ETH for gas
    address public paymaster;
    
    /// @notice Fee distributor contract authorized to distribute fees
    address public feeDistributor;
    
    // ============ Safety Parameters ============
    
    /// @notice Maximum percentage of ETH that can be deployed (80%)
    /// @dev Prevents over-deployment, maintains operational buffer
    uint256 public constant MAX_UTILIZATION = 80;
    
    /// @notice Minimum ETH that must remain in vault for withdrawals
    /// @dev Configurable by owner. Default 10 ETH.
    uint256 public minETHLiquidity = 10 ether;
    
    /// @notice Precision multiplier for per-share calculations
    /// @dev Using 1e18 to maintain accuracy in fee distributions
    uint256 private constant PRECISION = 1e18;
    
    // ============ Events ============
    
    event ETHAdded(address indexed provider, uint256 amount, uint256 shares);
    event ETHRemoved(address indexed provider, uint256 amount, uint256 shares);
    event ElizaAdded(address indexed provider, uint256 amount, uint256 shares);
    event ElizaRemoved(address indexed provider, uint256 amount, uint256 shares);
    event FeesDistributed(uint256 ethPoolFees, uint256 elizaPoolFees);
    event FeesClaimed(address indexed provider, uint256 amount);
    event PaymasterSet(address indexed paymaster);
    event FeeDistributorSet(address indexed feeDistributor);
    
    // ============ Errors ============
    
    error InsufficientLiquidity();
    error BelowMinimumLiquidity();
    error InvalidAmount();
    error OnlyPaymaster();
    error TransferFailed();
    error InsufficientShares(uint256 actual, uint256 minimum);
    
    // ============ Constructor ============
    
    /**
     * @notice Constructs the LiquidityVault with reward token address
     * @param _rewardToken Address of the reward token contract
     * @param initialOwner Address that will own the contract
     * @dev Validates reward token address is non-zero
     */
    constructor(address _rewardToken, address initialOwner) Ownable(initialOwner) {
        require(_rewardToken != address(0), "Invalid reward token address");
        rewardToken = IERC20(_rewardToken);
    }
    
    // ============ Modifiers ============
    
    modifier onlyPaymaster() {
        if (msg.sender != paymaster) revert OnlyPaymaster();
        _;
    }
    
    modifier onlyFeeDistributor() {
        require(msg.sender == feeDistributor, "Only fee distributor");
        _;
    }
    
    modifier updateFees(address account) {
        _updatePendingFees(account);
        _;
    }
    
    // ============ Liquidity Provision Functions ============
    
    /**
     * @notice Deposit ETH to become a liquidity provider and earn fees (backwards compatible)
     * @dev Calls addETHLiquidity with minShares = 0 for backwards compatibility
     */
    function addETHLiquidity() external payable {
        this.addETHLiquidity{value: msg.value}(0);
    }
    
    /**
     * @notice Deposit ETH to become a liquidity provider and earn fees
     * @dev Mints shares proportional to contribution using constant product formula.
     *      First deposit gets 1:1 shares, subsequent deposits are proportional to pool.
     *      Includes slippage protection via minShares parameter to prevent sandwich attacks.
     * 
     * @param minShares Minimum shares expected (slippage protection, use 0 to skip)
     * 
     * Share Calculation:
     * - First LP: shares = amount (1:1 ratio)
     * - Later LPs: shares = (amount * totalShares) / balanceBeforeDeposit
     * 
     * Example: Pool has 10 ETH total shares and 10 ETH balance:
     * - LP deposits 5 ETH with minShares = 4.9 ether
     * - Shares = (5 * 10) / 10 = 5 shares
     * - LP owns 5/15 = 33.3% of pool
     * - If sandwich attack causes shares to drop below 4.9, transaction reverts
     * 
     * @custom:security Uses balance before deposit to prevent donation attacks
     * @custom:security Requires minShares to prevent slippage/sandwich attacks
     */
    function addETHLiquidity(uint256 minShares) public payable nonReentrant whenNotPaused updateFees(msg.sender) {
        if (msg.value == 0) revert InvalidAmount();
        
        uint256 shares;
        if (totalETHLiquidity == 0) {
            // First deposit: 1:1 ratio
            shares = msg.value;
        } else {
            // Subsequent deposits: proportional to pool
            // Use balance BEFORE deposit to calculate shares
            uint256 balanceBeforeDeposit = address(this).balance - msg.value;
            shares = (msg.value * totalETHLiquidity) / balanceBeforeDeposit;
        }
        
        // Slippage protection
        if (shares < minShares) revert InsufficientShares(shares, minShares);
        
        ethShares[msg.sender] += shares;
        totalETHLiquidity += shares;
        
        emit ETHAdded(msg.sender, msg.value, shares);
    }
    
    /**
     * @notice Withdraw ETH liquidity by burning shares
     * @param shares Number of shares to burn and redeem for ETH
     * @dev Redeems proportional amount of ETH based on current pool balance.
     *      Must respect minimum liquidity requirement.
     * 
     * Redemption Calculation:
     * - ethAmount = (shares * currentBalance) / totalShares
     * 
     * Example: LP has 5 shares, pool has 15 shares and 20 ETH:
     * - Withdraw 5 shares
     * - Receives = (5 * 20) / 15 = 6.67 ETH
     * 
     * @custom:security Checks minimum liquidity before allowing withdrawal
     */
    function removeETHLiquidity(uint256 shares) external nonReentrant updateFees(msg.sender) {
        if (shares == 0) revert InvalidAmount();
        if (ethShares[msg.sender] < shares) revert InsufficientLiquidity();
        
        uint256 ethAmount = (shares * address(this).balance) / totalETHLiquidity;
        
        // Check minimum liquidity requirement
        if (address(this).balance - ethAmount < minETHLiquidity) {
            revert BelowMinimumLiquidity();
        }
        
        ethShares[msg.sender] -= shares;
        totalETHLiquidity -= shares;
        
        (bool success, ) = msg.sender.call{value: ethAmount}("");
        if (!success) revert TransferFailed();
        
        emit ETHRemoved(msg.sender, ethAmount, shares);
    }
    
    /**
     * @notice Deposit reward tokens to earn a portion of LP fees (backwards compatible)
     * @param amount Amount of reward tokens to deposit
     * @dev Calls addElizaLiquidity with minShares = 0 for backwards compatibility
     */
    function addElizaLiquidity(uint256 amount) external {
        this.addElizaLiquidity(amount, 0);
    }
    
    /**
     * @notice Deposit reward tokens to earn a portion of LP fees
     * @param amount Amount of reward tokens to deposit
     * @param minShares Minimum shares expected (slippage protection, use 0 to skip)
     * @dev Mints shares proportional to contribution. First deposit is 1:1.
     *      Requires prior approval of this contract to spend tokens.
     *      Includes slippage protection to prevent sandwich attacks.
     * 
     * Share Calculation (same as ETH pool):
     * - First LP: shares = amount
     * - Later LPs: shares = (amount * totalShares) / balanceBeforeDeposit
     * 
     * Fee Earning:
     * - Token LPs earn 30% of the LP portion (15% of total fees)
     * - Lower than ETH LPs because they take less risk
     * 
     * @custom:security Uses balance before transfer to prevent donation attacks
     * @custom:security Requires ERC20 approval before calling
     * @custom:security Requires minShares to prevent slippage/sandwich attacks
     */
    function addElizaLiquidity(uint256 amount, uint256 minShares) public nonReentrant whenNotPaused updateFees(msg.sender) {
        if (amount == 0) revert InvalidAmount();
        
        // Get balance before transfer
        uint256 balanceBeforeDeposit = rewardToken.balanceOf(address(this));
        
        // Transfer tokens first
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        uint256 shares;
        if (totalElizaLiquidity == 0 || balanceBeforeDeposit == 0) {
            // First deposit: 1:1 ratio
            shares = amount;
        } else {
            // Subsequent deposits: proportional to pool
            shares = (amount * totalElizaLiquidity) / balanceBeforeDeposit;
        }
        
        // Slippage protection
        if (shares < minShares) revert InsufficientShares(shares, minShares);
        
        elizaShares[msg.sender] += shares;
        totalElizaLiquidity += shares;
        
        emit ElizaAdded(msg.sender, amount, shares);
    }
    
    /**
     * @notice Withdraw reward token liquidity by burning shares
     * @param shares Number of token shares to burn
     * @dev Redeems proportional amount of reward tokens from pool.
     *      Includes both principal and any earned fees not yet claimed.
     */
    function removeElizaLiquidity(uint256 shares) external nonReentrant updateFees(msg.sender) {
        if (shares == 0) revert InvalidAmount();
        if (elizaShares[msg.sender] < shares) revert InsufficientLiquidity();
        
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        uint256 elizaAmount = (shares * currentBalance) / totalElizaLiquidity;
        
        elizaShares[msg.sender] -= shares;
        totalElizaLiquidity -= shares;
        
        require(rewardToken.transfer(msg.sender, elizaAmount), "Transfer failed");
        
        emit ElizaRemoved(msg.sender, elizaAmount, shares);
    }
    
    /**
     * @notice Claim all accumulated fees from both ETH and token pools
     * @dev Fees are paid in reward tokens. Updates pending fees before claiming.
     *      Can be called anytime without unstaking LP position.
     * 
     * Fee Sources:
     * - ETH pool LPs: 35% of all transaction fees (70% of LP's 50%)
     * - Token pool LPs: 15% of all transaction fees (30% of LP's 50%)
     */
    function claimFees() external nonReentrant updateFees(msg.sender) {
        uint256 totalFees = pendingETHFees[msg.sender] + pendingElizaFees[msg.sender];
        if (totalFees == 0) return;
        
        pendingETHFees[msg.sender] = 0;
        pendingElizaFees[msg.sender] = 0;
        
        require(rewardToken.transfer(msg.sender, totalFees), "Fee transfer failed");
        
        emit FeesClaimed(msg.sender, totalFees);
    }
    
    // ============ Paymaster Functions ============
    
    /**
     * @notice Provide ETH to paymaster for gas sponsorship
     * @param amount Amount of ETH requested (in wei)
     * @return bool True if transfer succeeded
     * @dev Only callable by authorized paymaster contract.
     *      Respects utilization limits and available balance.
     * 
     * @custom:security Only paymaster can call to prevent fund drainage
     * @custom:security Limited by availableETH() which enforces utilization cap
     */
    function provideETHForGas(uint256 amount) external onlyPaymaster returns (bool) {
        uint256 available = availableETH();
        if (amount > available) revert InsufficientLiquidity();
        
        (bool success, ) = paymaster.call{value: amount}("");
        return success;
    }
    
    /**
     * @notice Distribute transaction fees to liquidity providers
     * @param ethPoolFees Amount of reward tokens for ETH pool LPs
     * @param tokenPoolFees Amount of reward tokens for token pool LPs
     * @dev Only callable by authorized fee distributor contract.
     *      Updates per-share fee accumulators so LPs can claim proportional rewards.
     * 
     * Distribution Mechanism:
     * 1. Transfer fees from distributor to vault
     * 2. Calculate fees per share: (fees * PRECISION) / totalShares
     * 3. Add to accumulated fees per share
     * 4. LPs can claim based on their share ownership
     * 
     * Example: 100 tokens fees for ETH pool with 50 total shares:
     * - ethFeesPerShare += (100 * 1e18) / 50 = 2e18
     * - LP with 10 shares earns: (10 * 2e18) / 1e18 = 20 tokens
     * 
     * @custom:security Only fee distributor can call
     * @custom:security Proper accounting prevents fee inflation
     */
    function distributeFees(
        uint256 ethPoolFees,
        uint256 tokenPoolFees
    ) external onlyFeeDistributor nonReentrant {
        uint256 totalFees = ethPoolFees + tokenPoolFees;
        require(totalFees > 0, "No fees to distribute");
        
        // Transfer fees from distributor to this contract
        require(
            rewardToken.transferFrom(msg.sender, address(this), totalFees),
            "Fee transfer failed"
        );
        
        /**
         * @dev Distribute fees proportionally to all LPs based on their share ownership.
         *      Uses per-share accumulator pattern for gas-efficient reward distribution.
         *      ETH LPs earn from ethPoolFees, token LPs earn from tokenPoolFees.
         *      Fees are calculated when LPs claim or when their position changes.
         */
        if (totalETHLiquidity > 0 && ethPoolFees > 0) {
            ethFeesPerShare += (ethPoolFees * PRECISION) / totalETHLiquidity;
        }
        if (totalElizaLiquidity > 0 && tokenPoolFees > 0) {
            elizaFeesPerShare += (tokenPoolFees * PRECISION) / totalElizaLiquidity;
        }
        
        emit FeesDistributed(ethPoolFees, tokenPoolFees);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Calculate available ETH that can be deployed for gas
     * @return Amount of ETH available (in wei)
     * @dev Enforces both utilization limit and minimum liquidity requirement.
     * 
     * Calculation:
     * 1. Check balance meets minimum requirement
     * 2. Calculate usable: balance - minimum
     * 3. Calculate max allowed: balance * MAX_UTILIZATION / 100
     * 4. Return the smaller of usable and max allowed
     * 
     * Example: 20 ETH balance, 10 ETH minimum, 80% max utilization:
     * - Usable: 20 - 10 = 10 ETH
     * - Max allowed: 20 * 0.8 = 16 ETH
     * - Available: min(10, 16) = 10 ETH
     */
    function availableETH() public view returns (uint256) {
        uint256 balance = address(this).balance;
        uint256 maxUsable = (balance * MAX_UTILIZATION) / 100;
        
        if (balance < minETHLiquidity) return 0;
        
        uint256 usable = balance - minETHLiquidity;
        return usable < maxUsable ? usable : maxUsable;
    }
    
    /**
     * @notice Calculate total pending fees for an LP across both pools
     * @param account Address of the liquidity provider
     * @return Total claimable fees in elizaOS tokens
     * @dev Combines fees from both ETH and elizaOS pool positions
     */
    function pendingFees(address account) public view returns (uint256) {
        uint256 ethFees = _calculatePendingETHFees(account);
        uint256 elizaFees = _calculatePendingElizaFees(account);
        return ethFees + elizaFees;
    }
    
    /**
     * @notice Get detailed information about an LP's position
     * @param account Address of the liquidity provider
     * @return ethShareBalance Number of ETH pool shares owned
     * @return ethValue Current ETH value of those shares
     * @return elizaShareBalance Number of token pool shares owned
     * @return elizaValue Current token value of those shares
     * @return pendingFeeAmount Total claimable fees in reward tokens
     * @dev Useful for frontends to display LP dashboard information
     */
    function getLPPosition(address account) external view returns (
        uint256 ethShareBalance,
        uint256 ethValue,
        uint256 elizaShareBalance,
        uint256 elizaValue,
        uint256 pendingFeeAmount
    ) {
        ethShareBalance = ethShares[account];
        elizaShareBalance = elizaShares[account];
        
        if (totalETHLiquidity > 0) {
            ethValue = (ethShareBalance * address(this).balance) / totalETHLiquidity;
        }
        
        if (totalElizaLiquidity > 0) {
            elizaValue = (elizaShareBalance * rewardToken.balanceOf(address(this))) / totalElizaLiquidity;
        }
        
        pendingFeeAmount = pendingFees(account);
    }
    
    /**
     * @notice Get vault health and operational status metrics
     * @return ethBalance Total ETH in vault
     * @return tokenBalance Total reward tokens in vault
     * @return ethUtilization Percentage of ETH currently deployed
     * @return isHealthy Whether vault meets minimum liquidity requirement
     * @dev Used for monitoring and determining if paymaster can operate
     */
    function getVaultHealth() external view returns (
        uint256 ethBalance,
        uint256 tokenBalance,
        uint256 ethUtilization,
        bool isHealthy
    ) {
        ethBalance = address(this).balance;
        tokenBalance = rewardToken.balanceOf(address(this));
        
        if (ethBalance > 0) {
            ethUtilization = ((ethBalance - availableETH()) * 100) / ethBalance;
        }
        
        isHealthy = ethBalance >= minETHLiquidity;
    }
    
    // ============ Internal Functions ============
    
    function _updatePendingFees(address account) internal {
        if (account == address(0)) return;
        
        pendingETHFees[account] += _calculatePendingETHFees(account);
        pendingElizaFees[account] += _calculatePendingElizaFees(account);
        
        ethFeesPerSharePaid[account] = ethFeesPerShare;
        elizaFeesPerSharePaid[account] = elizaFeesPerShare;
    }
    
    function _calculatePendingETHFees(address account) internal view returns (uint256) {
        uint256 shares = ethShares[account];
        if (shares == 0) return 0;
        
        uint256 feesDelta = ethFeesPerShare - ethFeesPerSharePaid[account];
        return (shares * feesDelta) / PRECISION;
    }
    
    function _calculatePendingElizaFees(address account) internal view returns (uint256) {
        uint256 shares = elizaShares[account];
        if (shares == 0) return 0;
        
        uint256 feesDelta = elizaFeesPerShare - elizaFeesPerSharePaid[account];
        return (shares * feesDelta) / PRECISION;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Set the authorized paymaster contract address
     * @param _paymaster Address of the paymaster contract
     * @dev Only callable by owner. Paymaster can request ETH for gas operations.
     * @custom:security Ensure paymaster contract is audited before setting
     */
    function setPaymaster(address _paymaster) external onlyOwner {
        require(_paymaster != address(0), "Invalid paymaster");
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }
    
    /**
     * @notice Set the authorized fee distributor contract address
     * @param _feeDistributor Address of the fee distributor contract
     * @dev Only callable by owner. Distributor can distribute fees to LPs.
     */
    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        require(_feeDistributor != address(0), "Invalid distributor");
        feeDistributor = _feeDistributor;
        emit FeeDistributorSet(_feeDistributor);
    }
    
    /**
     * @notice Update the minimum ETH that must remain in vault
     * @param _minETH New minimum ETH amount in wei
     * @dev Only callable by owner. Affects withdrawal limits and available liquidity.
     */
    function setMinETHLiquidity(uint256 _minETH) external onlyOwner {
        minETHLiquidity = _minETH;
    }
    
    /**
     * @notice Pause vault operations in case of emergency
     * @dev Only callable by owner. Prevents new deposits (withdrawals still allowed).
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Resume vault operations after emergency pause
     * @dev Only callable by owner. Re-enables deposits.
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============ Receive ETH ============
    
    /**
     * @notice Fallback to accept ETH deposits and refunds
     * @dev Allows direct ETH transfers for paymaster refunds or emergency funding
     */
    receive() external payable {
        // Accept ETH from paymaster refunds or direct deposits
    }
    
    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

