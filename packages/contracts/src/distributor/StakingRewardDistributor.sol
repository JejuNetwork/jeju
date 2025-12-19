// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingRewardDistributor
 * @notice Distributes collected fees to token stakers proportionally
 * @dev Stakers deposit tokens, accumulate rewards from fees, and can claim anytime
 *
 * Mechanism:
 * 1. Token contract sends transfer fees here
 * 2. Stakers deposit tokens to participate in fee sharing
 * 3. Fees are distributed proportionally to stake weight
 * 4. Users can claim accumulated rewards anytime
 *
 * Uses reward-per-token accumulator pattern for gas efficiency
 */
contract StakingRewardDistributor is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ERRORS
    // =============================================================================

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error LockPeriodNotEnded();

    // =============================================================================
    // EVENTS
    // =============================================================================

    event Staked(address indexed user, uint256 amount, uint256 lockUntil);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount);
    event MinimumStakePeriodUpdated(uint256 oldPeriod, uint256 newPeriod);

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Token being staked and distributed as rewards
    IERC20 public immutable stakingToken;

    /// @notice Total staked amount
    uint256 public totalStaked;

    /// @notice Accumulated reward per token (scaled by 1e18)
    uint256 public rewardPerTokenStored;

    /// @notice Total rewards distributed
    uint256 public totalRewardsDistributed;

    /// @notice Minimum staking period in seconds
    uint256 public minimumStakePeriod;

    struct StakerInfo {
        /// @notice Amount staked
        uint256 balance;
        /// @notice Reward per token at last action
        uint256 rewardPerTokenPaid;
        /// @notice Accumulated rewards not yet claimed
        uint256 rewards;
        /// @notice Unlock timestamp
        uint256 lockUntil;
    }

    /// @notice Staker information
    mapping(address => StakerInfo) public stakers;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _stakingToken Token used for staking and rewards
     * @param _owner Contract owner
     * @param _minimumStakePeriod Minimum lock period for stakes
     */
    constructor(IERC20 _stakingToken, address _owner, uint256 _minimumStakePeriod) Ownable(_owner) {
        if (address(_stakingToken) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        stakingToken = _stakingToken;
        minimumStakePeriod = _minimumStakePeriod;
    }

    // =============================================================================
    // MODIFIERS
    // =============================================================================

    /**
     * @dev Update reward accumulator for a user
     */
    modifier updateReward(address account) {
        _updateReward(account);
        _;
    }

    // =============================================================================
    // STAKING
    // =============================================================================

    /**
     * @notice Stake tokens to earn fee rewards
     * @param amount Amount to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        StakerInfo storage staker = stakers[msg.sender];

        // Update lock period
        uint256 newLockUntil = block.timestamp + minimumStakePeriod;
        if (newLockUntil > staker.lockUntil) {
            staker.lockUntil = newLockUntil;
        }

        staker.balance += amount;
        totalStaked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount, staker.lockUntil);
    }

    /**
     * @notice Unstake tokens
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        StakerInfo storage staker = stakers[msg.sender];

        if (block.timestamp < staker.lockUntil) revert LockPeriodNotEnded();
        if (amount > staker.balance) revert InsufficientBalance();

        staker.balance -= amount;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        StakerInfo storage staker = stakers[msg.sender];
        uint256 reward = staker.rewards;

        if (reward == 0) revert ZeroAmount();

        staker.rewards = 0;
        stakingToken.safeTransfer(msg.sender, reward);

        emit RewardClaimed(msg.sender, reward);
    }

    /**
     * @notice Unstake all and claim rewards
     */
    function exit() external nonReentrant updateReward(msg.sender) {
        StakerInfo storage staker = stakers[msg.sender];

        if (block.timestamp < staker.lockUntil) revert LockPeriodNotEnded();

        uint256 stakedAmount = staker.balance;
        uint256 reward = staker.rewards;

        if (stakedAmount == 0 && reward == 0) revert ZeroAmount();

        staker.balance = 0;
        staker.rewards = 0;
        totalStaked -= stakedAmount;

        uint256 totalAmount = stakedAmount + reward;
        stakingToken.safeTransfer(msg.sender, totalAmount);

        emit Unstaked(msg.sender, stakedAmount);
        if (reward > 0) {
            emit RewardClaimed(msg.sender, reward);
        }
    }

    // =============================================================================
    // REWARD DISTRIBUTION
    // =============================================================================

    /**
     * @notice Notify contract that rewards have been sent (called by token contract)
     * @dev This is called automatically when fees are sent to this contract
     */
    function notifyRewardAmount(uint256 amount) external {
        // Anyone can call this to update the reward accumulator
        // The actual tokens must already be in the contract
        if (totalStaked > 0) {
            rewardPerTokenStored += (amount * 1e18) / totalStaked;
        }
        totalRewardsDistributed += amount;
        emit RewardAdded(amount);
    }

    /**
     * @dev Update reward for an account
     */
    function _updateReward(address account) internal {
        // Check if new rewards arrived
        uint256 contractBalance = stakingToken.balanceOf(address(this));

        if (totalStaked > 0 && contractBalance > totalStaked) {
            uint256 newRewards = contractBalance - totalStaked;
            rewardPerTokenStored += (newRewards * 1e18) / totalStaked;
            totalRewardsDistributed += newRewards;
            emit RewardAdded(newRewards);
        }

        if (account != address(0)) {
            StakerInfo storage staker = stakers[account];
            // Calculate rewards using updated rewardPerTokenStored
            staker.rewards =
                staker.rewards + (staker.balance * (rewardPerTokenStored - staker.rewardPerTokenPaid)) / 1e18;
            staker.rewardPerTokenPaid = rewardPerTokenStored;
        }
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get earned rewards for an account
     * @dev Calculates pending rewards including any unregistered balance increases
     */
    function earned(address account) public view returns (uint256) {
        StakerInfo storage staker = stakers[account];
        uint256 currentRewardPerToken = rewardPerTokenStored;

        // Check for unregistered rewards (new tokens that arrived but weren't notified)
        if (totalStaked > 0) {
            uint256 contractBalance = stakingToken.balanceOf(address(this));
            if (contractBalance > totalStaked) {
                uint256 unregistered = contractBalance - totalStaked;
                currentRewardPerToken += (unregistered * 1e18) / totalStaked;
            }
        }

        return staker.rewards + (staker.balance * (currentRewardPerToken - staker.rewardPerTokenPaid)) / 1e18;
    }

    /**
     * @notice Get staker info
     */
    function getStakerInfo(address account)
        external
        view
        returns (uint256 balance, uint256 rewards, uint256 lockUntil, bool canUnstake)
    {
        StakerInfo storage staker = stakers[account];
        balance = staker.balance;
        rewards = earned(account);
        lockUntil = staker.lockUntil;
        canUnstake = block.timestamp >= staker.lockUntil;
    }

    /**
     * @notice Get total pending rewards (in contract but not yet distributed)
     */
    function getPendingRewards() external view returns (uint256) {
        uint256 contractBalance = stakingToken.balanceOf(address(this));
        if (contractBalance > totalStaked) {
            return contractBalance - totalStaked;
        }
        return 0;
    }

    // =============================================================================
    // ADMIN
    // =============================================================================

    /**
     * @notice Update minimum stake period
     */
    function setMinimumStakePeriod(uint256 _period) external onlyOwner {
        uint256 old = minimumStakePeriod;
        minimumStakePeriod = _period;
        emit MinimumStakePeriodUpdated(old, _period);
    }

    /**
     * @notice Recover accidentally sent tokens (not staking token)
     */
    function recoverToken(IERC20 tokenToRecover, uint256 amount) external onlyOwner {
        if (tokenToRecover == stakingToken) {
            uint256 excess = tokenToRecover.balanceOf(address(this)) - totalStaked;
            if (amount > excess) revert InsufficientBalance();
        }
        tokenToRecover.safeTransfer(owner(), amount);
    }
}






