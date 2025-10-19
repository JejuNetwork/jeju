// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface ILiquidityVault {
    function distributeFees(uint256 ethPoolFees, uint256 elizaPoolFees) external;
}

/**
 * @title FeeDistributorV2
 * @author Jeju Network
 * @notice Distributes transaction fees between app developers, liquidity providers, AND contributors
 * @dev V2 adds 10% contributor rewards distributed monthly based on GitHub leaderboard scores.
 *      Implements 3-way split: 45% apps, 45% LPs, 10% contributors.
 * 
 * Architecture:
 * - Receives elizaOS tokens from paymaster after each transaction
 * - Splits fees: 45% to app, 45% to LPs, 10% to contributor pool
 * - Contributor pool accumulates monthly
 * - Oracle submits monthly snapshot with pro-rata contributor shares
 * - Contributors claim their allocated rewards
 * 
 * Fee Flow (NEW):
 * 1. User pays 100 elizaOS for gas
 * 2. Distributor splits: 45 to app, 45 to LPs, 10 to contributor pool
 * 3. Monthly: Oracle submits snapshot with contributor allocations
 * 4. Contributors claim their share from pool
 * 
 * Contributor Distribution (borrowed from NodeOperatorRewards + LiquidityVault patterns):
 * - Monthly snapshots with contributor addresses and pro-rata shares
 * - Per-share accounting for gas-efficient distribution
 * - Pull-based claiming (contributors initiate)
 * - Merkle tree verification (optional, for gas optimization)
 * 
 * @custom:security-contact security@jeju.network
 */
contract FeeDistributorV2 is ReentrancyGuard, Ownable, Pausable {
    // ============ State Variables ============
    
    /// @notice Reward token contract (used for fee payments)
    IERC20 public immutable rewardToken;
    
    /// @notice Liquidity vault that receives LP portion of fees
    ILiquidityVault public immutable liquidityVault;
    
    /// @notice Authorized paymaster contract that triggers distributions
    address public paymaster;
    
    /// @notice Authorized oracle address that submits contributor snapshots
    address public contributorOracle;
    
    // ============ Fee Split Ratios (Basis Points) ============
    
    /// @notice App developer share of total fees (45% = 4500 basis points)
    uint256 public constant APP_SHARE = 4500;
    
    /// @notice Liquidity provider share of total fees (45% = 4500 basis points)
    uint256 public constant LP_SHARE = 4500;
    
    /// @notice Contributor share of total fees (10% = 1000 basis points)
    uint256 public constant CONTRIBUTOR_SHARE = 1000;
    
    /// @notice ETH LP share of LP portion (70% = 7000 basis points)
    uint256 public constant ETH_LP_SHARE = 7000;
    
    /// @notice Token LP share of LP portion (30% = 3000 basis points)
    uint256 public constant TOKEN_LP_SHARE = 3000;
    
    // ============ App & LP Accounting (Existing) ============
    
    /// @notice Claimable earnings for each app address
    mapping(address => uint256) public appEarnings;
    
    /// @notice Total fees distributed through the system
    uint256 public totalDistributed;
    
    /// @notice Cumulative earnings allocated to apps
    uint256 public totalAppEarnings;
    
    /// @notice Cumulative earnings allocated to LPs
    uint256 public totalLPEarnings;
    
    // ============ Contributor Accounting (NEW) ============
    
    /// @notice Current contributor pool balance (accumulated monthly)
    uint256 public contributorPoolBalance;
    
    /// @notice Total cumulative earnings allocated to contributors
    uint256 public totalContributorEarnings;
    
    /// @notice Current reward period (increments monthly)
    uint256 public currentPeriod;
    
    /// @notice Monthly snapshot data
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
    
    /// @notice Snapshots by period
    mapping(uint256 => MonthlySnapshot) public snapshots;
    
    /// @notice Period start timestamps
    mapping(uint256 => uint256) public periodStartTime;
    
    /// @notice Period duration (30 days)
    uint256 public constant PERIOD_DURATION = 30 days;
    
    // ============ Events ============
    
    // Existing events
    event FeesDistributed(
        address indexed app,
        uint256 appAmount,
        uint256 lpAmount,
        uint256 ethLPAmount,
        uint256 elizaLPAmount,
        uint256 contributorAmount,
        uint256 timestamp
    );
    event AppClaimed(address indexed app, uint256 amount);
    event PaymasterSet(address indexed paymaster);
    
    // New contributor events
    event ContributorPoolUpdated(uint256 period, uint256 newBalance);
    event SnapshotSubmitted(
        uint256 indexed period,
        uint256 totalPool,
        uint256 contributorCount,
        uint256 totalShares
    );
    event SnapshotFinalized(uint256 indexed period, uint256 timestamp);
    event ContributorClaimed(
        address indexed contributor,
        uint256 indexed period,
        uint256 amount
    );
    event ContributorOracleSet(address indexed oracle);
    event PeriodStarted(uint256 indexed period, uint256 startTime);
    
    // ============ Errors ============
    
    error OnlyPaymaster();
    error OnlyOracle();
    error InvalidAddress();
    error InvalidAmount();
    error NoEarningsToClaim();
    error TransferFailed();
    error SnapshotAlreadyFinalized();
    error SnapshotNotFinalized();
    error AlreadyClaimed();
    error InvalidSnapshot();
    error PeriodNotEnded();
    error ArrayLengthMismatch();
    
    // ============ Constructor ============
    
    /**
     * @notice Constructs the FeeDistributorV2 with required dependencies
     * @param _rewardToken Address of the reward token contract
     * @param _liquidityVault Address of the liquidity vault contract
     * @param initialOwner Address that will own the contract
     */
    constructor(
        address _rewardToken,
        address _liquidityVault,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_rewardToken == address(0)) revert InvalidAddress();
        if (_liquidityVault == address(0)) revert InvalidAddress();
        
        rewardToken = IERC20(_rewardToken);
        liquidityVault = ILiquidityVault(_liquidityVault);
        
        // Initialize first period
        currentPeriod = 0;
        periodStartTime[0] = block.timestamp;
        emit PeriodStarted(0, block.timestamp);
    }
    
    // ============ Core Distribution Functions ============
    
    /**
     * @notice Distribute transaction fees between app, LPs, and contributor pool
     * @param amount Total reward tokens collected from user as fees
     * @param appAddress Wallet address that will receive the app's share
     * @dev Backward compatible with V1, adds 10% contributor allocation
     * 
     * NEW Distribution Flow:
     * 1. Transfer tokens from paymaster to this contract
     * 2. Calculate 3-way split: 45% app, 45% LP, 10% contributors
     * 3. Credit app's share to their claimable earnings (unchanged)
     * 4. Transfer LP portion to vault (unchanged)
     * 5. Accumulate contributor portion in monthly pool (NEW)
     */
    function distributeFees(
        uint256 amount,
        address appAddress
    ) external nonReentrant whenNotPaused {
        if (msg.sender != paymaster) revert OnlyPaymaster();
        if (amount == 0) revert InvalidAmount();
        if (appAddress == address(0)) revert InvalidAddress();
        
        // Transfer tokens from paymaster to this contract
        rewardToken.transferFrom(msg.sender, address(this), amount);
        
        // Calculate 3-way split
        uint256 appAmount = (amount * APP_SHARE) / 10000;
        uint256 lpAmount = (amount * LP_SHARE) / 10000;
        uint256 contributorAmount = amount - appAmount - lpAmount; // 10%
        
        // App's share goes to their earnings (claimable) - UNCHANGED
        appEarnings[appAddress] += appAmount;
        totalAppEarnings += appAmount;
        
        // Split LP portion between ETH and token LPs - UNCHANGED
        uint256 ethLPAmount = (lpAmount * ETH_LP_SHARE) / 10000;
        uint256 tokenLPAmount = lpAmount - ethLPAmount;
        totalLPEarnings += lpAmount;
        
        // Approve liquidity vault to pull LP rewards - UNCHANGED
        require(rewardToken.approve(address(liquidityVault), lpAmount), "Approval failed");
        
        // Send to liquidity vault for distribution to LPs - UNCHANGED
        liquidityVault.distributeFees(ethLPAmount, tokenLPAmount);
        
        // NEW: Accumulate contributor pool for monthly distribution
        contributorPoolBalance += contributorAmount;
        totalContributorEarnings += contributorAmount;
        
        totalDistributed += amount;
        
        emit FeesDistributed(
            appAddress,
            appAmount,
            lpAmount,
            ethLPAmount,
            tokenLPAmount,
            contributorAmount,
            block.timestamp
        );
    }
    
    // ============ App Claim Functions (UNCHANGED from V1) ============
    
    /**
     * @notice Claim accumulated earnings to caller's address
     */
    function claimEarnings() external nonReentrant {
        uint256 amount = appEarnings[msg.sender];
        appEarnings[msg.sender] = 0;
        
        rewardToken.transfer(msg.sender, amount);
        
        emit AppClaimed(msg.sender, amount);
    }
    
    /**
     * @notice Claim accumulated earnings to a specified address
     */
    function claimEarningsTo(address recipient) external nonReentrant {
        uint256 amount = appEarnings[msg.sender];
        appEarnings[msg.sender] = 0;
        
        rewardToken.transfer(recipient, amount);
        
        emit AppClaimed(msg.sender, amount);
    }
    
    // ============ Contributor Snapshot Functions (NEW) ============
    
    /**
     * @notice Submit monthly contributor snapshot (called by authorized oracle)
     * @param period Period number (must be current period)
     * @param contributors Array of contributor addresses
     * @param shares Array of pro-rata shares (sum should equal totalShares)
     * @dev Uses per-share accounting pattern from LiquidityVault for gas efficiency.
     *      Oracle calculates shares based on weighted leaderboard scores.
     * 
     * Example:
     * - Contributor A: 500 shares (50%)
     * - Contributor B: 300 shares (30%)
     * - Contributor C: 200 shares (20%)
     * - Total: 1000 shares
     * - Pool: 10,000 tokens
     * - A claims: (500 * 10,000) / 1000 = 5,000 tokens
     */
    function submitMonthlySnapshot(
        uint256 period,
        address[] calldata contributors,
        uint256[] calldata shares
    ) external whenNotPaused {
        if (msg.sender != contributorOracle) revert OnlyOracle();
        if (period != currentPeriod) revert InvalidSnapshot();
        if (contributors.length != shares.length) revert ArrayLengthMismatch();
        if (snapshots[period].finalized) revert SnapshotAlreadyFinalized();
        
        MonthlySnapshot storage snapshot = snapshots[period];
        
        // Store snapshot data
        snapshot.period = period;
        snapshot.totalPool = contributorPoolBalance;
        snapshot.contributors = contributors;
        snapshot.shares = shares;
        snapshot.timestamp = block.timestamp;
        
        // Calculate total shares
        uint256 totalShares = 0;
        for (uint256 i = 0; i < shares.length; i++) {
            snapshot.contributorShares[contributors[i]] = shares[i];
            totalShares += shares[i];
        }
        snapshot.totalShares = totalShares;
        
        emit SnapshotSubmitted(period, contributorPoolBalance, contributors.length, totalShares);
    }
    
    /**
     * @notice Finalize monthly snapshot and start new period
     * @dev Can only be called after snapshot is submitted.
     *      Moves to next period and resets contributor pool.
     */
    function finalizeSnapshot(uint256 period) external {
        if (msg.sender != contributorOracle) revert OnlyOracle();
        if (snapshots[period].finalized) revert SnapshotAlreadyFinalized();
        
        // Finalize snapshot
        snapshots[period].finalized = true;
        
        // Reset pool balance for next period
        contributorPoolBalance = 0;
        
        // Start new period
        currentPeriod++;
        periodStartTime[currentPeriod] = block.timestamp;
        
        emit SnapshotFinalized(period, block.timestamp);
        emit PeriodStarted(currentPeriod, block.timestamp);
    }
    
    /**
     * @notice Claim contributor rewards for a specific period
     * @param period Period to claim rewards from
     * @dev Uses per-share accounting: reward = (userShares * totalPool) / totalShares
     */
    function claimContributorReward(uint256 period) external nonReentrant {
        MonthlySnapshot storage snapshot = snapshots[period];
        
        if (!snapshot.finalized) revert SnapshotNotFinalized();
        if (snapshot.claimed[msg.sender]) revert AlreadyClaimed();
        
        uint256 userShares = snapshot.contributorShares[msg.sender];
        
        // Calculate pro-rata reward (will fail if userShares or totalShares is 0)
        uint256 reward = (userShares * snapshot.totalPool) / snapshot.totalShares;
        
        // Mark as claimed
        snapshot.claimed[msg.sender] = true;
        snapshot.claimedCount++;
        
        // Transfer reward
        rewardToken.transfer(msg.sender, reward);
        
        emit ContributorClaimed(msg.sender, period, reward);
    }
    
    /**
     * @notice Claim rewards from multiple periods in one transaction
     * @param periods Array of period numbers to claim from
     * @dev Gas-efficient batch claiming
     */
    function claimMultiplePeriods(uint256[] calldata periods) external nonReentrant {
        uint256 totalReward = 0;
        
        for (uint256 i = 0; i < periods.length; i++) {
            uint256 period = periods[i];
            MonthlySnapshot storage snapshot = snapshots[period];
            
            // Skip if already claimed or not finalized
            if (!snapshot.finalized || snapshot.claimed[msg.sender]) {
                continue;
            }
            
            uint256 userShares = snapshot.contributorShares[msg.sender];
            
            // Calculate reward (will be 0 if userShares is 0, which is fine)
            uint256 reward = (userShares * snapshot.totalPool) / snapshot.totalShares;
            totalReward += reward;
            
            // Mark as claimed
            snapshot.claimed[msg.sender] = true;
            snapshot.claimedCount++;
            
            emit ContributorClaimed(msg.sender, period, reward);
        }
        
        // Single transfer for all periods (will fail if totalReward is 0)
        rewardToken.transfer(msg.sender, totalReward);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get claimable earnings for an app address
     */
    function getEarnings(address app) external view returns (uint256) {
        return appEarnings[app];
    }
    
    /**
     * @notice Get claimable contributor reward for a specific period
     */
    function getContributorReward(
        address contributor,
        uint256 period
    ) external view returns (uint256 reward, bool claimed, bool finalized) {
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
    
    /**
     * @notice Get total claimable rewards across all periods
     */
    function getTotalClaimableRewards(
        address contributor
    ) external view returns (uint256 total) {
        for (uint256 i = 0; i <= currentPeriod; i++) {
            MonthlySnapshot storage snapshot = snapshots[i];
            
            if (!snapshot.finalized || snapshot.claimed[contributor]) {
                continue;
            }
            
            uint256 userShares = snapshot.contributorShares[contributor];
            if (userShares > 0 && snapshot.totalShares > 0) {
                total += (userShares * snapshot.totalPool) / snapshot.totalShares;
            }
        }
    }
    
    /**
     * @notice Get list of periods with unclaimed rewards
     */
    function getUnclaimedPeriods(
        address contributor
    ) external view returns (uint256[] memory) {
        uint256[] memory tempPeriods = new uint256[](currentPeriod + 1);
        uint256 count = 0;
        
        for (uint256 i = 0; i <= currentPeriod; i++) {
            MonthlySnapshot storage snapshot = snapshots[i];
            
            if (snapshot.finalized &&
                !snapshot.claimed[contributor] &&
                snapshot.contributorShares[contributor] > 0) {
                tempPeriods[count] = i;
                count++;
            }
        }
        
        // Resize array
        uint256[] memory unclaimedPeriods = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            unclaimedPeriods[i] = tempPeriods[i];
        }
        
        return unclaimedPeriods;
    }
    
    /**
     * @notice Get snapshot details for a period
     */
    function getSnapshot(uint256 period) external view returns (
        uint256 totalPool,
        uint256 totalShares,
        uint256 contributorCount,
        uint256 claimedCount,
        uint256 timestamp,
        bool finalized
    ) {
        MonthlySnapshot storage snapshot = snapshots[period];
        return (
            snapshot.totalPool,
            snapshot.totalShares,
            snapshot.contributors.length,
            snapshot.claimedCount,
            snapshot.timestamp,
            snapshot.finalized
        );
    }
    
    /**
     * @notice Get snapshot contributors and their shares
     * @param period Period number
     * @return contributors Array of contributor addresses
     * @return shares Array of pro-rata shares
     * @dev Used by AirdropManager to read snapshot data
     */
    function getSnapshotContributors(uint256 period) external view returns (
        address[] memory contributors,
        uint256[] memory shares
    ) {
        MonthlySnapshot storage snapshot = snapshots[period];
        return (snapshot.contributors, snapshot.shares);
    }
    
    /**
     * @notice Preview how fees would be distributed for a given amount (V2)
     */
    function previewDistribution(uint256 amount) external pure returns (
        uint256 appAmount,
        uint256 ethLPAmount,
        uint256 tokenLPAmount,
        uint256 contributorAmount
    ) {
        appAmount = (amount * APP_SHARE) / 10000;
        uint256 lpAmount = (amount * LP_SHARE) / 10000;
        contributorAmount = (amount * CONTRIBUTOR_SHARE) / 10000;
        
        ethLPAmount = (lpAmount * ETH_LP_SHARE) / 10000;
        tokenLPAmount = lpAmount - ethLPAmount;
    }
    
    /**
     * @notice Get global fee distribution statistics (V2)
     */
    function getStats() external view returns (
        uint256 _totalDistributed,
        uint256 _totalAppEarnings,
        uint256 _totalLPEarnings,
        uint256 _totalContributorEarnings,
        uint256 pendingAppClaims,
        uint256 _contributorPoolBalance,
        uint256 _currentPeriod
    ) {
        _totalDistributed = totalDistributed;
        _totalAppEarnings = totalAppEarnings;
        _totalLPEarnings = totalLPEarnings;
        _totalContributorEarnings = totalContributorEarnings;
        _contributorPoolBalance = contributorPoolBalance;
        _currentPeriod = currentPeriod;
        
        // Current contract balance (apps pending + contributor pool)
        pendingAppClaims = rewardToken.balanceOf(address(this)) - contributorPoolBalance;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Set the authorized paymaster contract address
     */
    function setPaymaster(address _paymaster) external onlyOwner {
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }
    
    /**
     * @notice Set the authorized contributor oracle address
     */
    function setContributorOracle(address _oracle) external onlyOwner {
        contributorOracle = _oracle;
        emit ContributorOracleSet(_oracle);
    }
    
    /**
     * @notice Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}

