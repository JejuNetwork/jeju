// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {ILiquidityVault} from "../interfaces/IPaymaster.sol";
import {FeeConfig} from "./FeeConfig.sol";

/**
 * @title FeeDistributor
 * @notice Distributes transaction fees with configurable splits via FeeConfig
 */
contract FeeDistributor is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant PERIOD_DURATION = 30 days;

    IERC20 public immutable rewardToken;
    ILiquidityVault public immutable liquidityVault;
    FeeConfig public feeConfig;
    address public paymaster;
    address public contributorOracle;
    mapping(address => uint256) public appEarnings;
    uint256 public totalDistributed;
    uint256 public totalAppEarnings;
    uint256 public totalLPEarnings;
    uint256 public contributorPoolBalance;
    uint256 public totalContributorEarnings;
    uint256 public currentPeriod;

    struct MonthlySnapshot {
        uint256 period;
        uint256 totalPool;
        uint256 totalShares;
        address[] contributors;
        uint256[] shares;
        mapping(address => uint256) contributorShares;
        mapping(address => bool) claimed;
        uint256 claimedCount;
        uint256 timestamp;
        bool finalized;
    }

    mapping(uint256 => MonthlySnapshot) public snapshots;
    mapping(uint256 => uint256) public periodStartTime;
    uint256 public computeFeesCollected;
    uint256 public storageFeesCollected;
    uint256 public otherFeesCollected;
    IIdentityRegistry public identityRegistry;
    mapping(address => uint256) public appAgentId;
    mapping(uint256 => uint256) public agentTotalEarnings;

    event FeesDistributed(
        address indexed app,
        uint256 appAmount,
        uint256 lpAmount,
        uint256 ethLPAmount,
        uint256 tokenLPAmount,
        uint256 contributorAmount,
        uint256 timestamp
    );
    event PlatformFeeCollected(string indexed source, uint256 amount, uint256 timestamp);
    event AppClaimed(address indexed app, uint256 amount);
    event PaymasterSet(address indexed paymaster);
    event SnapshotSubmitted(uint256 indexed period, uint256 totalPool, uint256 contributorCount, uint256 totalShares);
    event SnapshotFinalized(uint256 indexed period, uint256 timestamp);
    event ContributorClaimed(address indexed contributor, uint256 indexed period, uint256 amount);
    event ContributorOracleSet(address indexed oracle);
    event PeriodStarted(uint256 indexed period, uint256 startTime);
    event FeeConfigUpdated(address indexed oldConfig, address indexed newConfig);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AppAgentLinked(address indexed app, uint256 indexed agentId);


    error OnlyPaymaster();
    error OnlyOracle();
    error InvalidAddress();
    error InvalidAmount();
    error NoEarningsToClaim();
    error SnapshotAlreadyFinalized();
    error SnapshotNotFinalized();
    error AlreadyClaimed();
    error InvalidSnapshot();
    error ArrayLengthMismatch();
    error InvalidAgentId();
    error NotAgentOwner();

    constructor(address _rewardToken, address _liquidityVault, address _feeConfig, address initialOwner)
        Ownable(initialOwner)
    {
        if (_rewardToken == address(0)) revert InvalidAddress();
        if (_liquidityVault == address(0)) revert InvalidAddress();
        if (_feeConfig == address(0)) revert InvalidAddress();

        rewardToken = IERC20(_rewardToken);
        liquidityVault = ILiquidityVault(_liquidityVault);
        feeConfig = FeeConfig(_feeConfig);

        // Initialize first period
        currentPeriod = 0;
        periodStartTime[0] = block.timestamp;
        emit PeriodStarted(0, block.timestamp);
    }

    function distributeFees(uint256 amount, address appAddress) external nonReentrant whenNotPaused {
        if (msg.sender != paymaster) revert OnlyPaymaster();
        if (amount == 0) revert InvalidAmount();
        if (appAddress == address(0)) revert InvalidAddress();

        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();
        uint256 appAmount = (amount * fees.appShareBps) / BPS_DENOMINATOR;
        uint256 lpAmount = (amount * fees.lpShareBps) / BPS_DENOMINATOR;
        uint256 contributorAmount = amount - appAmount - lpAmount;

        uint256 ethLPAmount = (lpAmount * fees.ethLpShareBps) / BPS_DENOMINATOR;
        uint256 tokenLPAmount = lpAmount - ethLPAmount;

        appEarnings[appAddress] += appAmount;
        totalAppEarnings += appAmount;

        uint256 agentId = appAgentId[appAddress];
        if (agentId > 0) {
            agentTotalEarnings[agentId] += appAmount;
        }

        totalLPEarnings += lpAmount;
        contributorPoolBalance += contributorAmount;
        totalContributorEarnings += contributorAmount;
        totalDistributed += amount;

        emit FeesDistributed(
            appAddress, appAmount, lpAmount, ethLPAmount, tokenLPAmount, contributorAmount, block.timestamp
        );

        rewardToken.forceApprove(address(liquidityVault), lpAmount);
        liquidityVault.distributeFees(ethLPAmount, tokenLPAmount);
    }

    function collectPlatformFee(uint256 amount, string calldata source, address appAddress)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert InvalidAmount();

        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        bytes32 sourceHash = keccak256(bytes(source));
        if (sourceHash == keccak256("compute")) {
            computeFeesCollected += amount;
        } else if (sourceHash == keccak256("storage")) {
            storageFeesCollected += amount;
        } else {
            otherFeesCollected += amount;
        }

        emit PlatformFeeCollected(source, amount, block.timestamp);
        _distributeInternal(amount, appAddress);
    }

    function _distributeInternal(uint256 amount, address appAddress) internal {
        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();

        uint256 appAmount = (amount * fees.appShareBps) / BPS_DENOMINATOR;
        uint256 lpAmount = (amount * fees.lpShareBps) / BPS_DENOMINATOR;
        uint256 contributorAmount = amount - appAmount - lpAmount;

        uint256 ethLPAmount = (lpAmount * fees.ethLpShareBps) / BPS_DENOMINATOR;
        uint256 tokenLPAmount = lpAmount - ethLPAmount;

        if (appAddress != address(0)) {
            appEarnings[appAddress] += appAmount;
            totalAppEarnings += appAmount;

            uint256 agentId = appAgentId[appAddress];
            if (agentId > 0) {
                agentTotalEarnings[agentId] += appAmount;
            }
        } else {
            contributorAmount += appAmount;
        }

        totalLPEarnings += lpAmount;
        contributorPoolBalance += contributorAmount;
        totalContributorEarnings += contributorAmount;
        totalDistributed += amount;

        rewardToken.forceApprove(address(liquidityVault), lpAmount);
        liquidityVault.distributeFees(ethLPAmount, tokenLPAmount);
    }

    function claimEarnings() external nonReentrant {
        uint256 amount = appEarnings[msg.sender];
        if (amount == 0) revert NoEarningsToClaim();

        appEarnings[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, amount);

        emit AppClaimed(msg.sender, amount);
    }

    function claimEarningsTo(address recipient) external nonReentrant {
        uint256 amount = appEarnings[msg.sender];
        if (amount == 0) revert NoEarningsToClaim();

        appEarnings[msg.sender] = 0;
        rewardToken.safeTransfer(recipient, amount);

        emit AppClaimed(msg.sender, amount);
    }

    function submitMonthlySnapshot(uint256 period, address[] calldata contributors, uint256[] calldata shares)
        external
        whenNotPaused
    {
        if (msg.sender != contributorOracle) revert OnlyOracle();
        if (period != currentPeriod) revert InvalidSnapshot();
        if (contributors.length != shares.length) revert ArrayLengthMismatch();
        if (snapshots[period].finalized) revert SnapshotAlreadyFinalized();

        MonthlySnapshot storage snapshot = snapshots[period];
        snapshot.period = period;
        snapshot.totalPool = contributorPoolBalance;
        snapshot.contributors = contributors;
        snapshot.shares = shares;
        snapshot.timestamp = block.timestamp;

        uint256 totalShares = 0;
        for (uint256 i = 0; i < shares.length; i++) {
            snapshot.contributorShares[contributors[i]] = shares[i];
            totalShares += shares[i];
        }
        snapshot.totalShares = totalShares;

        emit SnapshotSubmitted(period, contributorPoolBalance, contributors.length, totalShares);
    }

    function finalizeSnapshot(uint256 period) external {
        if (msg.sender != contributorOracle) revert OnlyOracle();
        if (snapshots[period].finalized) revert SnapshotAlreadyFinalized();

        snapshots[period].finalized = true;
        contributorPoolBalance = 0;

        currentPeriod++;
        periodStartTime[currentPeriod] = block.timestamp;

        emit SnapshotFinalized(period, block.timestamp);
        emit PeriodStarted(currentPeriod, block.timestamp);
    }

    function claimContributorReward(uint256 period) external nonReentrant {
        MonthlySnapshot storage snapshot = snapshots[period];

        if (!snapshot.finalized) revert SnapshotNotFinalized();
        if (snapshot.claimed[msg.sender]) revert AlreadyClaimed();

        uint256 userShares = snapshot.contributorShares[msg.sender];
        if (userShares == 0) revert NoEarningsToClaim();
        if (snapshot.totalShares == 0) revert InvalidSnapshot();

        uint256 reward = (userShares * snapshot.totalPool) / snapshot.totalShares;
        if (reward == 0) revert NoEarningsToClaim();

        snapshot.claimed[msg.sender] = true;
        snapshot.claimedCount++;

        rewardToken.safeTransfer(msg.sender, reward);

        emit ContributorClaimed(msg.sender, period, reward);
    }

    function claimMultiplePeriods(uint256[] calldata periods) external nonReentrant {
        uint256 totalReward = 0;

        for (uint256 i = 0; i < periods.length; i++) {
            uint256 period = periods[i];
            MonthlySnapshot storage snapshot = snapshots[period];

            if (!snapshot.finalized || snapshot.claimed[msg.sender]) {
                continue;
            }

            uint256 userShares = snapshot.contributorShares[msg.sender];
            if (userShares == 0 || snapshot.totalShares == 0) {
                continue;
            }

            uint256 reward = (userShares * snapshot.totalPool) / snapshot.totalShares;
            if (reward == 0) continue;

            totalReward += reward;
            snapshot.claimed[msg.sender] = true;
            snapshot.claimedCount++;

            emit ContributorClaimed(msg.sender, period, reward);
        }

        if (totalReward == 0) revert NoEarningsToClaim();
        rewardToken.safeTransfer(msg.sender, totalReward);
    }

    function getCurrentFeeSplits()
        external
        view
        returns (
            uint16 appShareBps,
            uint16 lpShareBps,
            uint16 contributorShareBps,
            uint16 ethLpShareBps,
            uint16 tokenLpShareBps
        )
    {
        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();
        return (fees.appShareBps, fees.lpShareBps, fees.contributorShareBps, fees.ethLpShareBps, fees.tokenLpShareBps);
    }

    function getEarnings(address app) external view returns (uint256) {
        return appEarnings[app];
    }

    function getContributorReward(address contributor, uint256 period)
        external
        view
        returns (uint256 reward, bool claimed, bool finalized)
    {
        MonthlySnapshot storage snapshot = snapshots[period];
        finalized = snapshot.finalized;
        claimed = snapshot.claimed[contributor];

        if (!finalized || claimed) {
            reward = 0;
        } else {
            uint256 userShares = snapshot.contributorShares[contributor];
            if (userShares > 0 && snapshot.totalShares > 0) {
                reward = (userShares * snapshot.totalPool) / snapshot.totalShares;
            }
        }
    }

    function getStats()
        external
        view
        returns (
            uint256 _totalDistributed,
            uint256 _totalAppEarnings,
            uint256 _totalLPEarnings,
            uint256 _totalContributorEarnings,
            uint256 _computeFeesCollected,
            uint256 _storageFeesCollected,
            uint256 _contributorPoolBalance,
            uint256 _currentPeriod
        )
    {
        return (
            totalDistributed,
            totalAppEarnings,
            totalLPEarnings,
            totalContributorEarnings,
            computeFeesCollected,
            storageFeesCollected,
            contributorPoolBalance,
            currentPeriod
        );
    }

    function previewDistribution(uint256 amount)
        external
        view
        returns (uint256 appAmount, uint256 ethLPAmount, uint256 tokenLPAmount, uint256 contributorAmount)
    {
        FeeConfig.DistributionFees memory fees = feeConfig.getDistributionFees();

        appAmount = (amount * fees.appShareBps) / BPS_DENOMINATOR;
        uint256 lpAmount = (amount * fees.lpShareBps) / BPS_DENOMINATOR;
        contributorAmount = amount - appAmount - lpAmount;

        ethLPAmount = (lpAmount * fees.ethLpShareBps) / BPS_DENOMINATOR;
        tokenLPAmount = lpAmount - ethLPAmount;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function linkAppToAgent(address app, uint256 agentId) external {
        if (address(identityRegistry) == address(0)) revert InvalidAddress();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        appAgentId[app] = agentId;
        emit AppAgentLinked(app, agentId);
    }

    function isVerifiedApp(address app) external view returns (bool) {
        uint256 agentId = appAgentId[app];
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    function getAppAgentId(address app) external view returns (uint256) {
        return appAgentId[app];
    }

    function getAgentEarnings(uint256 agentId) external view returns (uint256) {
        return agentTotalEarnings[agentId];
    }

    function setPaymaster(address _paymaster) external onlyOwner {
        if (_paymaster == address(0)) revert InvalidAddress();
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }

    function setContributorOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert InvalidAddress();
        contributorOracle = _oracle;
        emit ContributorOracleSet(_oracle);
    }

    function setFeeConfig(address _feeConfig) external onlyOwner {
        if (_feeConfig == address(0)) revert InvalidAddress();
        address oldConfig = address(feeConfig);
        feeConfig = FeeConfig(_feeConfig);
        emit FeeConfigUpdated(oldConfig, _feeConfig);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}

/**
 * @title FeeDistributorV2
 * @notice Simplified fee distributor for paymaster integration
 * @dev Designed for PaymasterFactory deployment - receives fees and manages distribution
 */
contract FeeDistributorV2 is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable vault;
    address public paymaster;
    
    uint256 public totalCollected;
    uint256 public totalDistributed;

    error InvalidAddress();
    error OnlyPaymaster();

    event FeesCollected(uint256 amount, uint256 timestamp);
    event FeesDistributed(address indexed recipient, uint256 amount);
    event PaymasterSet(address indexed paymaster);

    constructor(address _token, address _vault, address _owner) Ownable(_owner) {
        if (_token == address(0)) revert InvalidAddress();
        if (_vault == address(0)) revert InvalidAddress();
        token = IERC20(_token);
        vault = _vault;
    }

    function setPaymaster(address _paymaster) external onlyOwner {
        if (_paymaster == address(0)) revert InvalidAddress();
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }

    function collectFees(uint256 amount) external {
        if (msg.sender != paymaster) revert OnlyPaymaster();
        
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalCollected += amount;
        
        emit FeesCollected(amount, block.timestamp);
    }

    function distributeFees() external nonReentrant {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        
        token.safeTransfer(vault, balance);
        totalDistributed += balance;
        
        emit FeesDistributed(vault, balance);
    }

    function recoverTokens(address _token, address to) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(to, balance);
    }
}
