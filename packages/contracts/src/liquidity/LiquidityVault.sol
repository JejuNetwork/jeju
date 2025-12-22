// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LiquidityVault
 * @notice ETH and token liquidity vault for paymaster gas sponsorship
 */
contract LiquidityVault is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;
    uint256 public totalETHLiquidity;
    mapping(address => uint256) public ethShares;
    uint256 public totalElizaLiquidity;
    mapping(address => uint256) public elizaShares;
    uint256 public ethFeesPerShare;
    uint256 public elizaFeesPerShare;
    mapping(address => uint256) public ethFeesPerSharePaid;
    mapping(address => uint256) public elizaFeesPerSharePaid;
    mapping(address => uint256) public pendingETHFees;
    mapping(address => uint256) public pendingElizaFees;
    address public paymaster;
    address public feeDistributor;
    uint256 public constant MAX_UTILIZATION = 80;
    uint256 public minETHLiquidity = 10 ether;
    uint256 private constant PRECISION = 1e18;

    event ETHAdded(address indexed provider, uint256 amount, uint256 shares);
    event ETHRemoved(address indexed provider, uint256 amount, uint256 shares);
    event ElizaAdded(address indexed provider, uint256 amount, uint256 shares);
    event ElizaRemoved(address indexed provider, uint256 amount, uint256 shares);
    event FeesDistributed(uint256 ethPoolFees, uint256 elizaPoolFees);
    event FeesClaimed(address indexed provider, uint256 amount);
    event PaymasterSet(address indexed paymaster);
    event FeeDistributorSet(address indexed feeDistributor);


    error InsufficientLiquidity();
    error BelowMinimumLiquidity();
    error InvalidAmount();
    error OnlyPaymaster();
    error TransferFailed();
    error InsufficientShares(uint256 actual, uint256 minimum);


    constructor(address _rewardToken, address initialOwner) Ownable(initialOwner) {
        require(_rewardToken != address(0), "Invalid reward token address");
        rewardToken = IERC20(_rewardToken);
    }


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

    function addETHLiquidity() external payable {
        this.addETHLiquidity{value: msg.value}(0);
    }

    function addETHLiquidity(uint256 minShares) public payable nonReentrant whenNotPaused updateFees(msg.sender) {
        if (msg.value == 0) revert InvalidAmount();

        uint256 shares;
        if (totalETHLiquidity == 0) {
            shares = msg.value;
        } else {
            uint256 balanceBeforeDeposit = address(this).balance - msg.value;
            shares = (msg.value * totalETHLiquidity) / balanceBeforeDeposit;
        }

        if (shares < minShares) revert InsufficientShares(shares, minShares);

        ethShares[msg.sender] += shares;
        totalETHLiquidity += shares;

        emit ETHAdded(msg.sender, msg.value, shares);
    }

    /**
     * @notice Withdraw ETH liquidity by burning shares
     * @param shares Number of shares to burn and redeem for ETH
     */
    function removeETHLiquidity(uint256 shares) external nonReentrant updateFees(msg.sender) {
        if (shares == 0) revert InvalidAmount();
        if (ethShares[msg.sender] < shares) revert InsufficientLiquidity();

        uint256 ethAmount = (shares * address(this).balance) / totalETHLiquidity;

        if (address(this).balance - ethAmount < minETHLiquidity) {
            revert BelowMinimumLiquidity();
        }

        ethShares[msg.sender] -= shares;
        totalETHLiquidity -= shares;

        (bool success,) = msg.sender.call{value: ethAmount}("");
        if (!success) revert TransferFailed();

        emit ETHRemoved(msg.sender, ethAmount, shares);
    }

    /**
     * @notice Deposit reward tokens to earn a portion of LP fees (backwards compatible)
     * @param amount Amount of reward tokens to deposit
     */
    function addElizaLiquidity(uint256 amount) external {
        this.addElizaLiquidity(amount, 0);
    }

    /**
     * @notice Deposit reward tokens to earn a portion of LP fees
     * @param amount Amount of reward tokens to deposit
     * @param minShares Minimum shares expected (slippage protection, use 0 to skip)
     */
    function addElizaLiquidity(uint256 amount, uint256 minShares)
        public
        nonReentrant
        whenNotPaused
        updateFees(msg.sender)
    {
        if (amount == 0) revert InvalidAmount();

        uint256 balanceBeforeDeposit = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 shares;
        if (totalElizaLiquidity == 0 || balanceBeforeDeposit == 0) {
            shares = amount;
        } else {
            shares = (amount * totalElizaLiquidity) / balanceBeforeDeposit;
        }

        if (shares < minShares) revert InsufficientShares(shares, minShares);

        elizaShares[msg.sender] += shares;
        totalElizaLiquidity += shares;

        emit ElizaAdded(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw reward token liquidity by burning shares
     * @param shares Number of token shares to burn
     */
    function removeElizaLiquidity(uint256 shares) external nonReentrant updateFees(msg.sender) {
        if (shares == 0) revert InvalidAmount();
        if (elizaShares[msg.sender] < shares) revert InsufficientLiquidity();

        uint256 currentBalance = rewardToken.balanceOf(address(this));
        uint256 elizaAmount = (shares * currentBalance) / totalElizaLiquidity;

        elizaShares[msg.sender] -= shares;
        totalElizaLiquidity -= shares;

        rewardToken.safeTransfer(msg.sender, elizaAmount);

        emit ElizaRemoved(msg.sender, elizaAmount, shares);
    }

    /**
     * @notice Claim all accumulated fees from both ETH and token pools
     */
    function claimFees() external nonReentrant updateFees(msg.sender) {
        uint256 totalFees = pendingETHFees[msg.sender] + pendingElizaFees[msg.sender];
        if (totalFees == 0) return;

        pendingETHFees[msg.sender] = 0;
        pendingElizaFees[msg.sender] = 0;

        rewardToken.safeTransfer(msg.sender, totalFees);

        emit FeesClaimed(msg.sender, totalFees);
    }

    // ============ Paymaster Functions ============

    /**
     * @notice Provide ETH to paymaster for gas sponsorship
     * @param amount Amount of ETH requested (in wei)
     * @return bool True if transfer succeeded
     */
    function provideETHForGas(uint256 amount) external onlyPaymaster returns (bool) {
        uint256 available = availableETH();
        if (amount > available) revert InsufficientLiquidity();

        (bool success,) = paymaster.call{value: amount}("");
        return success;
    }

    /**
     * @notice Distribute transaction fees to liquidity providers
     * @param ethPoolFees Amount of reward tokens for ETH pool LPs
     * @param tokenPoolFees Amount of reward tokens for token pool LPs
     */
    function distributeFees(uint256 ethPoolFees, uint256 tokenPoolFees) external nonReentrant onlyFeeDistributor {
        uint256 totalFees = ethPoolFees + tokenPoolFees;
        require(totalFees > 0, "No fees to distribute");

        rewardToken.safeTransferFrom(msg.sender, address(this), totalFees);

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
     */
    function pendingFees(address account) public view returns (uint256) {
        uint256 ethFees = _calculatePendingETHFees(account);
        uint256 elizaFees = _calculatePendingElizaFees(account);
        return ethFees + elizaFees;
    }

    /**
     * @notice Get detailed information about an LP's position
     * @param account Address of the liquidity provider
     */
    function getLPPosition(address account)
        external
        view
        returns (
            uint256 ethShareBalance,
            uint256 ethValue,
            uint256 elizaShareBalance,
            uint256 elizaValue,
            uint256 pendingFeeAmount
        )
    {
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
     */
    function getVaultHealth()
        external
        view
        returns (uint256 ethBalance, uint256 tokenBalance, uint256 ethUtilization, bool isHealthy)
    {
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

    function setPaymaster(address _paymaster) external onlyOwner {
        require(_paymaster != address(0), "Invalid paymaster");
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }

    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        require(_feeDistributor != address(0), "Invalid distributor");
        feeDistributor = _feeDistributor;
        emit FeeDistributorSet(_feeDistributor);
    }

    function setMinETHLiquidity(uint256 _minETH) external onlyOwner {
        minETHLiquidity = _minETH;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ETH ============

    receive() external payable {}

    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}
