// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBanManager {
    function isNetworkBanned(uint256 agentId) external view returns (bool);
}

/**
 * @title ComputeStaking
 * @author Jeju Network
 * @notice Staking contract for compute marketplace participants
 * @dev Manages user, provider, and guardian stakes with different minimums
 *
 * Key Features:
 * - Three stake types: User, Provider, Guardian
 * - Lock period for unstaking
 * - Guardian-based moderation system
 * - Integration with BanManager for slashing
 *
 * Stake Tiers:
 * - User: 0.01 ETH minimum (for spam prevention)
 * - Provider: 0.1 ETH minimum (for service accountability)
 * - Guardian: 1 ETH minimum (for moderation privileges)
 *
 * @custom:security-contact security@jeju.network
 */
contract ComputeStaking is Ownable, Pausable, ReentrancyGuard {
    // ============ Enums ============

    enum StakeType {
        NONE,
        USER,
        PROVIDER,
        GUARDIAN
    }

    // ============ Structs ============

    struct Stake {
        uint256 amount;
        StakeType stakeType;
        uint256 stakedAt;
        uint256 lockedUntil;
        bool slashed;
    }

    // ============ State Variables ============

    /// @notice Minimum stakes for each type
    uint256 public constant MIN_USER_STAKE = 0.01 ether;
    uint256 public constant MIN_PROVIDER_STAKE = 0.1 ether;
    uint256 public constant MIN_GUARDIAN_STAKE = 1 ether;

    /// @notice Lock period before unstaking
    uint256 public lockPeriod = 7 days;

    /// @notice User stakes
    mapping(address => Stake) public stakes;

    /// @notice Guardian list
    address[] public guardians;
    mapping(address => bool) public isGuardianActive;

    /// @notice Ban manager for slashing
    IBanManager public banManager;

    /// @notice Total staked amounts by type
    uint256 public totalUserStaked;
    uint256 public totalProviderStaked;
    uint256 public totalGuardianStaked;

    // ============ Events ============

    event StakedAsUser(address indexed account, uint256 amount);
    event StakedAsProvider(address indexed account, uint256 amount);
    event StakedAsGuardian(address indexed account, uint256 amount);
    event StakeAdded(address indexed account, uint256 amount, uint256 newTotal);
    event Unstaked(address indexed account, uint256 amount);
    event Slashed(address indexed account, uint256 amount, string reason);
    event LockPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event BanManagerUpdated(address indexed oldManager, address indexed newManager);

    // ============ Errors ============

    error AlreadyStaked();
    error NotStaked();
    error InsufficientStake(uint256 provided, uint256 required);
    error StakeLocked(uint256 unlockTime);
    error AlreadySlashed();
    error TransferFailed();
    error NotGuardian();
    error InvalidAmount();

    // ============ Constructor ============

    constructor(address _banManager, address initialOwner) Ownable(initialOwner) {
        banManager = IBanManager(_banManager);
    }

    // ============ Staking Functions ============

    /**
     * @notice Stake as a user (minimum 0.01 ETH)
     */
    function stakeAsUser() external payable nonReentrant whenNotPaused {
        if (stakes[msg.sender].amount > 0) revert AlreadyStaked();
        if (msg.value < MIN_USER_STAKE) revert InsufficientStake(msg.value, MIN_USER_STAKE);

        stakes[msg.sender] = Stake({
            amount: msg.value,
            stakeType: StakeType.USER,
            stakedAt: block.timestamp,
            lockedUntil: block.timestamp + lockPeriod,
            slashed: false
        });

        totalUserStaked += msg.value;
        emit StakedAsUser(msg.sender, msg.value);
    }

    /**
     * @notice Stake as a provider (minimum 0.1 ETH)
     */
    function stakeAsProvider() external payable nonReentrant whenNotPaused {
        if (stakes[msg.sender].amount > 0) revert AlreadyStaked();
        if (msg.value < MIN_PROVIDER_STAKE) revert InsufficientStake(msg.value, MIN_PROVIDER_STAKE);

        stakes[msg.sender] = Stake({
            amount: msg.value,
            stakeType: StakeType.PROVIDER,
            stakedAt: block.timestamp,
            lockedUntil: block.timestamp + lockPeriod,
            slashed: false
        });

        totalProviderStaked += msg.value;
        emit StakedAsProvider(msg.sender, msg.value);
    }

    /**
     * @notice Stake as a guardian (minimum 1 ETH)
     */
    function stakeAsGuardian() external payable nonReentrant whenNotPaused {
        if (stakes[msg.sender].amount > 0) revert AlreadyStaked();
        if (msg.value < MIN_GUARDIAN_STAKE) revert InsufficientStake(msg.value, MIN_GUARDIAN_STAKE);

        stakes[msg.sender] = Stake({
            amount: msg.value,
            stakeType: StakeType.GUARDIAN,
            stakedAt: block.timestamp,
            lockedUntil: block.timestamp + lockPeriod,
            slashed: false
        });

        guardians.push(msg.sender);
        isGuardianActive[msg.sender] = true;

        totalGuardianStaked += msg.value;
        emit StakedAsGuardian(msg.sender, msg.value);
    }

    /**
     * @notice Add more stake to existing position
     */
    function addStake() external payable nonReentrant {
        Stake storage stake = stakes[msg.sender];
        if (stake.amount == 0) revert NotStaked();
        if (stake.slashed) revert AlreadySlashed();

        stake.amount += msg.value;
        stake.lockedUntil = block.timestamp + lockPeriod;

        if (stake.stakeType == StakeType.USER) {
            totalUserStaked += msg.value;
        } else if (stake.stakeType == StakeType.PROVIDER) {
            totalProviderStaked += msg.value;
        } else if (stake.stakeType == StakeType.GUARDIAN) {
            totalGuardianStaked += msg.value;
        }

        emit StakeAdded(msg.sender, msg.value, stake.amount);
    }

    /**
     * @notice Unstake (partial or full) after lock period
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        Stake storage stake = stakes[msg.sender];
        if (stake.amount == 0) revert NotStaked();
        if (stake.slashed) revert AlreadySlashed();
        if (block.timestamp < stake.lockedUntil) revert StakeLocked(stake.lockedUntil);
        if (amount > stake.amount) revert InsufficientStake(stake.amount, amount);

        // Check minimum for partial unstake
        uint256 remaining = stake.amount - amount;
        uint256 minRequired = _getMinStake(stake.stakeType);
        if (remaining > 0 && remaining < minRequired) {
            revert InsufficientStake(remaining, minRequired);
        }

        // Update totals
        if (stake.stakeType == StakeType.USER) {
            totalUserStaked -= amount;
        } else if (stake.stakeType == StakeType.PROVIDER) {
            totalProviderStaked -= amount;
        } else if (stake.stakeType == StakeType.GUARDIAN) {
            totalGuardianStaked -= amount;
            if (remaining == 0) {
                isGuardianActive[msg.sender] = false;
            }
        }

        stake.amount = remaining;
        if (remaining == 0) {
            stake.stakeType = StakeType.NONE;
        }

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Unstaked(msg.sender, amount);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a staker (guardian or owner only)
     * @param account Account to slash
     * @param percentage Slash percentage (0-100)
     * @param reason Reason for slash
     */
    function slash(address account, uint256 percentage, string calldata reason) external nonReentrant {
        if (!isGuardianActive[msg.sender] && msg.sender != owner()) revert NotGuardian();
        if (percentage > 100) percentage = 100;

        Stake storage stake = stakes[account];
        if (stake.amount == 0) revert NotStaked();
        if (stake.slashed) revert AlreadySlashed();

        uint256 slashAmount = (stake.amount * percentage) / 100;
        stake.amount -= slashAmount;
        stake.slashed = true;

        if (stake.stakeType == StakeType.USER) {
            totalUserStaked -= slashAmount;
        } else if (stake.stakeType == StakeType.PROVIDER) {
            totalProviderStaked -= slashAmount;
        } else if (stake.stakeType == StakeType.GUARDIAN) {
            totalGuardianStaked -= slashAmount;
            isGuardianActive[account] = false;
        }

        // Slashed funds go to owner (treasury)
        (bool success,) = owner().call{value: slashAmount}("");
        if (!success) revert TransferFailed();

        emit Slashed(account, slashAmount, reason);
    }

    // ============ View Functions ============

    /**
     * @notice Get stake info for an account
     */
    function getStake(address account) external view returns (Stake memory) {
        return stakes[account];
    }

    /**
     * @notice Get stake amount for an account
     */
    function getStakeAmount(address account) external view returns (uint256) {
        return stakes[account].amount;
    }

    /**
     * @notice Check if account is staked
     */
    function isStaked(address account) external view returns (bool) {
        return stakes[account].amount > 0 && !stakes[account].slashed;
    }

    /**
     * @notice Check if account is a provider
     */
    function isProvider(address account) external view returns (bool) {
        Stake storage stake = stakes[account];
        return stake.stakeType == StakeType.PROVIDER && !stake.slashed;
    }

    /**
     * @notice Check if account is a guardian
     */
    function isGuardian(address account) external view returns (bool) {
        return isGuardianActive[account] && !stakes[account].slashed;
    }

    /**
     * @notice Get all guardians
     */
    function getGuardians() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (isGuardianActive[guardians[i]]) activeCount++;
        }

        address[] memory active = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (isGuardianActive[guardians[i]]) {
                active[idx++] = guardians[i];
            }
        }

        return active;
    }

    /**
     * @notice Get guardian count
     */
    function getGuardianCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (isGuardianActive[guardians[i]]) count++;
        }
        return count;
    }

    /**
     * @notice Get total staked amounts
     */
    function getTotalStaked() external view returns (uint256 user, uint256 provider, uint256 guardian, uint256 total) {
        return (
            totalUserStaked,
            totalProviderStaked,
            totalGuardianStaked,
            totalUserStaked + totalProviderStaked + totalGuardianStaked
        );
    }

    // ============ Internal Functions ============

    function _getMinStake(StakeType stakeType) internal pure returns (uint256) {
        if (stakeType == StakeType.USER) return MIN_USER_STAKE;
        if (stakeType == StakeType.PROVIDER) return MIN_PROVIDER_STAKE;
        if (stakeType == StakeType.GUARDIAN) return MIN_GUARDIAN_STAKE;
        return 0;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update lock period
     */
    function setLockPeriod(uint256 period) external onlyOwner {
        uint256 oldPeriod = lockPeriod;
        lockPeriod = period;
        emit LockPeriodUpdated(oldPeriod, period);
    }

    /**
     * @notice Update ban manager
     */
    function setBanManager(address _banManager) external onlyOwner {
        address oldManager = address(banManager);
        banManager = IBanManager(_banManager);
        emit BanManagerUpdated(oldManager, _banManager);
    }

    /**
     * @notice Pause/unpause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
