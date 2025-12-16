// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Staking
 * @notice Staking pool for paymaster gas subsidization and EIL cross-chain liquidity
 */
contract Staking is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    uint256 public totalETHStaked;
    uint256 public totalTokensStaked;
    mapping(address => StakerPosition) public positions;
    uint256 public ethFeesPerShare;
    uint256 public tokenFeesPerShare;
    mapping(address => uint256) public ethFeesPerSharePaid;
    mapping(address => uint256) public tokenFeesPerSharePaid;
    mapping(address => uint256) public pendingETHFees;
    mapping(address => uint256) public pendingTokenFees;
    address public paymaster;
    address public eilPaymaster;
    address public feeDistributor;
    uint256 public minETHStake = 0.1 ether;
    uint256 public minTokenStake = 100e18;
    uint256 public constant MAX_ETH_UTILIZATION = 80;
    uint256 public constant MAX_TOKEN_UTILIZATION = 70;
    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 private constant PRECISION = 1e18;

    struct StakerPosition {
        uint256 ethStaked;
        uint256 tokensStaked;
        uint256 stakedAt;
        uint256 ethUnbondingAmount;
        uint256 tokenUnbondingAmount;
        uint256 unbondingStartTime;
        bool isActive;
    }

    // ============ Events ============

    event Staked(address indexed staker, uint256 ethAmount, uint256 tokenAmount);
    event UnbondingStarted(address indexed staker, uint256 ethAmount, uint256 tokenAmount);
    event Unstaked(address indexed staker, uint256 ethAmount, uint256 tokenAmount);
    event FeesDistributed(uint256 ethFees, uint256 tokenFees, address indexed source);
    event FeesClaimed(address indexed staker, uint256 amount);
    event ETHProvided(address indexed to, uint256 amount, string purpose);
    event TokensProvided(address indexed to, address token, uint256 amount, string purpose);
    event PaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);
    event EILPaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);


    error InsufficientStake();
    error InsufficientBalance();
    error StillUnbonding();
    error NotUnbonding();
    error OnlyAuthorized();
    error TransferFailed();
    error MaxUtilization();


    constructor(address _stakingToken, address initialOwner) Ownable(initialOwner) {
        require(_stakingToken != address(0), "Invalid token");
        stakingToken = IERC20(_stakingToken);
    }


    modifier updateFees(address account) {
        _updatePendingFees(account);
        _;
    }

    modifier onlyPaymaster() {
        if (msg.sender != paymaster) revert OnlyAuthorized();
        _;
    }

    modifier onlyEIL() {
        if (msg.sender != eilPaymaster) revert OnlyAuthorized();
        _;
    }

    modifier onlyFeeDistributor() {
        if (msg.sender != feeDistributor) revert OnlyAuthorized();
        _;
    }

    // ============ Staking Functions ============

    /**
     * @notice Stake ETH and/or tokens into the pool
     * @param tokenAmount Amount of tokens to stake
     * @dev Staked assets are used for BOTH paymaster and EIL liquidity
     */
    function stake(uint256 tokenAmount) external payable nonReentrant whenNotPaused updateFees(msg.sender) {
        if (msg.value < minETHStake && tokenAmount < minTokenStake) revert InsufficientStake();

        StakerPosition storage pos = positions[msg.sender];

        if (msg.value > 0) {
            pos.ethStaked += msg.value;
            totalETHStaked += msg.value;
        }

        if (tokenAmount > 0) {
            stakingToken.safeTransferFrom(msg.sender, address(this), tokenAmount);
            pos.tokensStaked += tokenAmount;
            totalTokensStaked += tokenAmount;
        }

        if (!pos.isActive) {
            pos.isActive = true;
            pos.stakedAt = block.timestamp;
        }

        emit Staked(msg.sender, msg.value, tokenAmount);
    }

    /**
     * @notice Start unbonding stake
     * @param ethAmount ETH amount to unbond
     * @param tokenAmount Token amount to unbond
     */
    function startUnbonding(uint256 ethAmount, uint256 tokenAmount) external nonReentrant updateFees(msg.sender) {
        StakerPosition storage pos = positions[msg.sender];

        if (ethAmount > pos.ethStaked) revert InsufficientBalance();
        if (tokenAmount > pos.tokensStaked) revert InsufficientBalance();
        if (pos.unbondingStartTime > 0) revert StillUnbonding();

        pos.ethUnbondingAmount = ethAmount;
        pos.tokenUnbondingAmount = tokenAmount;
        pos.unbondingStartTime = block.timestamp;

        // Reduce staked amounts
        pos.ethStaked -= ethAmount;
        pos.tokensStaked -= tokenAmount;
        totalETHStaked -= ethAmount;
        totalTokensStaked -= tokenAmount;

        emit UnbondingStarted(msg.sender, ethAmount, tokenAmount);
    }

    /**
     * @notice Complete unstaking after unbonding period
     */
    function completeUnstaking() external nonReentrant updateFees(msg.sender) {
        StakerPosition storage pos = positions[msg.sender];

        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) revert StillUnbonding();

        uint256 ethAmount = pos.ethUnbondingAmount;
        uint256 tokenAmount = pos.tokenUnbondingAmount;

        pos.ethUnbondingAmount = 0;
        pos.tokenUnbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.ethStaked == 0 && pos.tokensStaked == 0) {
            pos.isActive = false;
        }

        if (ethAmount > 0) {
            (bool success,) = msg.sender.call{value: ethAmount}("");
            if (!success) revert TransferFailed();
        }

        if (tokenAmount > 0) {
            stakingToken.safeTransfer(msg.sender, tokenAmount);
        }

        emit Unstaked(msg.sender, ethAmount, tokenAmount);
    }

    /**
     * @notice Claim accumulated fees
     */
    function claimFees() external nonReentrant updateFees(msg.sender) {
        uint256 ethFees = pendingETHFees[msg.sender];
        uint256 tokenFees = pendingTokenFees[msg.sender];

        if (ethFees == 0 && tokenFees == 0) return;

        pendingETHFees[msg.sender] = 0;
        pendingTokenFees[msg.sender] = 0;

        // Fees are paid in staking token
        uint256 totalFees = ethFees + tokenFees;
        stakingToken.safeTransfer(msg.sender, totalFees);

        emit FeesClaimed(msg.sender, totalFees);
    }

    // ============ Liquidity Provision Functions ============

    /**
     * @notice Provide ETH for paymaster gas sponsorship
     * @param amount Amount of ETH needed
     * @dev Only callable by authorized paymaster
     */
    function provideETHForGas(uint256 amount) external onlyPaymaster returns (bool) {
        uint256 available = availableETH();
        if (amount > available) revert MaxUtilization();

        (bool success,) = paymaster.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ETHProvided(paymaster, amount, "gas-sponsorship");
        return true;
    }

    /**
     * @notice Provide tokens for EIL cross-chain transfer
     * @param amount Amount of tokens needed
     * @dev Only callable by authorized EIL paymaster
     */
    function provideTokensForEIL(uint256 amount) external onlyEIL returns (bool) {
        uint256 available = availableTokens();
        if (amount > available) revert MaxUtilization();

        stakingToken.safeTransfer(eilPaymaster, amount);

        emit TokensProvided(eilPaymaster, address(stakingToken), amount, "eil-transfer");
        return true;
    }

    /**
     * @notice Provide ETH for EIL gas on destination chain
     * @param amount Amount of ETH needed
     * @dev Only callable by authorized EIL paymaster
     */
    function provideETHForEIL(uint256 amount) external onlyEIL returns (bool) {
        uint256 available = availableETH();
        if (amount > available) revert MaxUtilization();

        (bool success,) = eilPaymaster.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ETHProvided(eilPaymaster, amount, "eil-gas");
        return true;
    }

    // ============ Fee Distribution Functions ============

    /**
     * @notice Distribute fees from paymaster or EIL
     * @param ethPoolFees Fees to distribute to ETH stakers
     * @param tokenPoolFees Fees to distribute to token stakers
     */
    function distributeFees(uint256 ethPoolFees, uint256 tokenPoolFees) external nonReentrant onlyFeeDistributor {
        uint256 totalFees = ethPoolFees + tokenPoolFees;
        require(totalFees > 0, "No fees");

        stakingToken.safeTransferFrom(msg.sender, address(this), totalFees);

        if (totalETHStaked > 0 && ethPoolFees > 0) {
            ethFeesPerShare += (ethPoolFees * PRECISION) / totalETHStaked;
        }

        if (totalTokensStaked > 0 && tokenPoolFees > 0) {
            tokenFeesPerShare += (tokenPoolFees * PRECISION) / totalTokensStaked;
        }

        emit FeesDistributed(ethPoolFees, tokenPoolFees, msg.sender);
    }

    /**
     * @notice Receive EIL fees directly (from XLP voucher fulfillment)
     * @dev EIL can send fees directly in ETH or tokens
     */
    function receiveEILFees() external payable onlyEIL {
        // Convert ETH fees to per-share accumulator
        if (msg.value > 0 && totalETHStaked > 0) {
            // ETH fees go to ETH stakers proportionally
            ethFeesPerShare += (msg.value * PRECISION) / totalETHStaked;
            emit FeesDistributed(msg.value, 0, msg.sender);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get available ETH for gas sponsorship
     */
    function availableETH() public view returns (uint256) {
        if (totalETHStaked == 0) return 0;
        uint256 currentBalance = address(this).balance;
        return (currentBalance * MAX_ETH_UTILIZATION) / 100;
    }

    /**
     * @notice Get available tokens for EIL
     */
    function availableTokens() public view returns (uint256) {
        if (totalTokensStaked == 0) return 0;
        uint256 currentBalance = stakingToken.balanceOf(address(this));
        return (currentBalance * MAX_TOKEN_UTILIZATION) / 100;
    }

    /**
     * @notice Get staker position details
     */
    function getPosition(address staker)
        external
        view
        returns (
            uint256 ethStaked,
            uint256 tokensStaked,
            uint256 pendingFees,
            uint256 unbondingETH,
            uint256 unbondingTokens,
            uint256 unbondingCompleteTime,
            bool isActive
        )
    {
        StakerPosition storage pos = positions[staker];

        ethStaked = pos.ethStaked;
        tokensStaked = pos.tokensStaked;
        pendingFees = _calculatePendingFees(staker);
        unbondingETH = pos.ethUnbondingAmount;
        unbondingTokens = pos.tokenUnbondingAmount;
        unbondingCompleteTime = pos.unbondingStartTime > 0 ? pos.unbondingStartTime + UNBONDING_PERIOD : 0;
        isActive = pos.isActive;
    }

    /**
     * @notice Get pool statistics
     */
    function getPoolStats()
        external
        view
        returns (
            uint256 totalETH,
            uint256 totalTokens,
            uint256 availableETHAmount,
            uint256 availableTokenAmount,
            uint256 ethUtilization,
            uint256 tokenUtilization
        )
    {
        totalETH = totalETHStaked;
        totalTokens = totalTokensStaked;
        availableETHAmount = availableETH();
        availableTokenAmount = availableTokens();

        uint256 currentETH = address(this).balance;
        uint256 currentTokens = stakingToken.balanceOf(address(this));

        ethUtilization = currentETH > 0 ? ((currentETH - availableETHAmount) * 100) / currentETH : 0;
        tokenUtilization = currentTokens > 0 ? ((currentTokens - availableTokenAmount) * 100) / currentTokens : 0;
    }

    // ============ Internal Functions ============

    function _updatePendingFees(address account) internal {
        if (account == address(0)) return;

        pendingETHFees[account] += _calculatePendingETHFees(account);
        pendingTokenFees[account] += _calculatePendingTokenFees(account);

        ethFeesPerSharePaid[account] = ethFeesPerShare;
        tokenFeesPerSharePaid[account] = tokenFeesPerShare;
    }

    function _calculatePendingETHFees(address account) internal view returns (uint256) {
        StakerPosition storage pos = positions[account];
        if (pos.ethStaked == 0) return 0;

        uint256 delta = ethFeesPerShare - ethFeesPerSharePaid[account];
        return (pos.ethStaked * delta) / PRECISION;
    }

    function _calculatePendingTokenFees(address account) internal view returns (uint256) {
        StakerPosition storage pos = positions[account];
        if (pos.tokensStaked == 0) return 0;

        uint256 delta = tokenFeesPerShare - tokenFeesPerSharePaid[account];
        return (pos.tokensStaked * delta) / PRECISION;
    }

    function _calculatePendingFees(address account) internal view returns (uint256) {
        return _calculatePendingETHFees(account) + _calculatePendingTokenFees(account) + pendingETHFees[account]
            + pendingTokenFees[account];
    }

    // ============ Admin Functions ============

    function setPaymaster(address _paymaster) external onlyOwner {
        address old = paymaster;
        paymaster = _paymaster;
        emit PaymasterUpdated(old, _paymaster);
    }

    function setEILPaymaster(address _eilPaymaster) external onlyOwner {
        address old = eilPaymaster;
        eilPaymaster = _eilPaymaster;
        emit EILPaymasterUpdated(old, _eilPaymaster);
    }

    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        feeDistributor = _feeDistributor;
    }

    function setMinStakes(uint256 _minETH, uint256 _minToken) external onlyOwner {
        minETHStake = _minETH;
        minTokenStake = _minToken;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Accept ETH from paymasters returning unused gas
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
