// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiServiceStakeManager
 * @notice Stake once, earn across multiple services
 * @dev Users deposit into a single pool that backs all Jeju services:
 *      - Node operation (RPC, indexing, compute)
 *      - Cross-chain liquidity (XLP for EIL)
 *      - Paymaster gas sponsorship
 *      - Governance participation
 *
 * Benefits:
 *      - Single deposit backs multiple services
 *      - Slashing is isolated per service allocation
 *      - Rewards aggregate from all services
 *      - No need to move funds between protocols
 */
contract MultiServiceStakeManager is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum Service {
        NODE, // Node operation staking
        XLP, // Cross-chain liquidity provider
        PAYMASTER, // Gas sponsorship pool
        GOVERNANCE // Governance voting weight

    }

    struct StakePosition {
        uint256 totalStaked;
        uint256 stakedAt;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        bool isActive;
        bool isFrozen;
    }

    struct ServiceAllocation {
        uint256 amount; // Amount allocated to this service
        uint256 allocatedAt; // When allocation was made
        bool slashable; // Whether this allocation can be slashed
        uint256 slashedAmount; // Amount slashed from this allocation
    }

    struct ServiceConfig {
        address handler; // External service contract
        uint256 minAllocation; // Minimum stake per allocation
        uint256 rewardRateBps; // Reward rate in basis points (annual)
        uint256 slashCapBps; // Max slash percentage per incident
        bool enabled; // Service accepting allocations
    }

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant UNBONDING_PERIOD = 14 days;
    uint256 public constant MIN_STAKE = 0.1 ether;

    // ============ State ============

    IERC20 public immutable stakingToken;

    mapping(address => StakePosition) public positions;
    mapping(address => mapping(Service => ServiceAllocation)) public allocations;
    mapping(Service => ServiceConfig) public serviceConfigs;
    mapping(address => uint256) public pendingRewards;

    uint256 public totalStaked;
    uint256 public totalAllocated;
    uint256 public totalRewardsDistributed;

    address public treasury;
    address public rewardsSource;

    // ============ Events ============

    event Staked(address indexed user, uint256 amount);
    event Allocated(address indexed user, Service indexed service, uint256 amount);
    event Deallocated(address indexed user, Service indexed service, uint256 amount);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Slashed(address indexed user, Service indexed service, uint256 amount, string reason);
    event RewardsClaimed(address indexed user, uint256 amount);
    event ServiceConfigured(Service indexed service, address handler, uint256 minAlloc, uint256 rewardRate);

    // ============ Errors ============

    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientAllocation();
    error ServiceNotEnabled();
    error PositionFrozen();
    error UnbondingInProgress();
    error NotUnbonding();
    error UnbondingNotComplete();
    error BelowMinimum();
    error AllocationStillActive();
    error SlashCapExceeded();
    error TransferFailed();
    error OnlyHandler();

    // ============ Constructor ============

    constructor(address _stakingToken, address _treasury, address initialOwner) Ownable(initialOwner) {
        stakingToken = IERC20(_stakingToken);
        treasury = _treasury;
    }

    // ============ Staking ============

    /**
     * @notice Stake tokens into the multi-service pool
     * @param amount Amount to stake
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_STAKE) revert BelowMinimum();

        StakePosition storage pos = positions[msg.sender];

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        if (!pos.isActive) {
            pos.isActive = true;
            pos.stakedAt = block.timestamp;
        }

        pos.totalStaked += amount;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Allocate staked funds to a service
     * @param service Service to allocate to
     * @param amount Amount to allocate
     */
    function allocate(Service service, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        ServiceConfig storage config = serviceConfigs[service];
        if (!config.enabled) revert ServiceNotEnabled();
        if (amount < config.minAllocation) revert BelowMinimum();

        StakePosition storage pos = positions[msg.sender];
        if (pos.isFrozen) revert PositionFrozen();

        uint256 available = getAvailableToAllocate(msg.sender);
        if (amount > available) revert InsufficientBalance();

        ServiceAllocation storage alloc = allocations[msg.sender][service];
        alloc.amount += amount;
        alloc.allocatedAt = block.timestamp;
        alloc.slashable = true;

        totalAllocated += amount;

        emit Allocated(msg.sender, service, amount);

        // Notify external handler if configured
        if (config.handler != address(0)) {
            (bool success,) =
                config.handler.call(abi.encodeWithSignature("onAllocate(address,uint256)", msg.sender, amount));
            // Don't revert if handler call fails - just log
        }
    }

    /**
     * @notice Deallocate from a service
     * @param service Service to deallocate from
     * @param amount Amount to deallocate
     */
    function deallocate(Service service, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        ServiceAllocation storage alloc = allocations[msg.sender][service];
        if (amount > alloc.amount) revert InsufficientAllocation();

        StakePosition storage pos = positions[msg.sender];
        if (pos.isFrozen) revert PositionFrozen();

        alloc.amount -= amount;
        totalAllocated -= amount;

        emit Deallocated(msg.sender, service, amount);

        // Notify external handler
        ServiceConfig storage config = serviceConfigs[service];
        if (config.handler != address(0)) {
            (bool success,) =
                config.handler.call(abi.encodeWithSignature("onDeallocate(address,uint256)", msg.sender, amount));
        }
    }

    /**
     * @notice Start unbonding process
     * @param amount Amount to unbond
     */
    function startUnbonding(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        StakePosition storage pos = positions[msg.sender];
        if (pos.isFrozen) revert PositionFrozen();
        if (pos.unbondingStartTime > 0) revert UnbondingInProgress();

        uint256 available = getAvailableToAllocate(msg.sender);
        if (amount > available) revert InsufficientBalance();

        pos.unbondingAmount = amount;
        pos.unbondingStartTime = block.timestamp;
        pos.totalStaked -= amount;
        totalStaked -= amount;

        emit UnbondingStarted(msg.sender, amount);
    }

    /**
     * @notice Complete unstaking after unbonding period
     */
    function completeUnstaking() external nonReentrant {
        StakePosition storage pos = positions[msg.sender];

        if (pos.isFrozen) revert PositionFrozen();
        if (pos.unbondingStartTime == 0) revert NotUnbonding();
        if (block.timestamp < pos.unbondingStartTime + UNBONDING_PERIOD) revert UnbondingNotComplete();

        uint256 amount = pos.unbondingAmount;
        pos.unbondingAmount = 0;
        pos.unbondingStartTime = 0;

        if (pos.totalStaked == 0) {
            pos.isActive = false;
        }

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a user's allocation for a specific service
     * @dev Only callable by service handler
     * @param user User to slash
     * @param service Service where violation occurred
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slash(address user, Service service, uint256 amount, string calldata reason) external nonReentrant {
        ServiceConfig storage config = serviceConfigs[service];
        if (msg.sender != config.handler && msg.sender != owner()) revert OnlyHandler();

        ServiceAllocation storage alloc = allocations[user][service];
        uint256 maxSlash = (alloc.amount * config.slashCapBps) / BPS;
        if (amount > maxSlash) revert SlashCapExceeded();

        uint256 actualSlash = amount > alloc.amount ? alloc.amount : amount;

        alloc.amount -= actualSlash;
        alloc.slashedAmount += actualSlash;
        totalAllocated -= actualSlash;

        // Also reduce total staked
        StakePosition storage pos = positions[user];
        pos.totalStaked -= actualSlash;
        totalStaked -= actualSlash;

        // Send to treasury
        if (treasury != address(0)) {
            stakingToken.safeTransfer(treasury, actualSlash);
        }

        emit Slashed(user, service, actualSlash, reason);
    }

    // ============ Rewards ============

    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external nonReentrant {
        uint256 rewards = pendingRewards[msg.sender];
        if (rewards == 0) revert ZeroAmount();

        pendingRewards[msg.sender] = 0;
        totalRewardsDistributed += rewards;

        if (rewardsSource != address(0)) {
            stakingToken.safeTransferFrom(rewardsSource, msg.sender, rewards);
        } else {
            stakingToken.safeTransfer(msg.sender, rewards);
        }

        emit RewardsClaimed(msg.sender, rewards);
    }

    /**
     * @notice Distribute rewards to a user (called by reward distributor)
     * @param user User to reward
     * @param amount Reward amount
     */
    function distributeReward(address user, uint256 amount) external {
        ServiceConfig storage nodeConfig = serviceConfigs[Service.NODE];
        ServiceConfig storage xlpConfig = serviceConfigs[Service.XLP];
        ServiceConfig storage paymasterConfig = serviceConfigs[Service.PAYMASTER];

        require(
            msg.sender == nodeConfig.handler || msg.sender == xlpConfig.handler || msg.sender == paymasterConfig.handler
                || msg.sender == owner(),
            "Not authorized"
        );

        pendingRewards[user] += amount;
    }

    // ============ View Functions ============

    /**
     * @notice Get available stake not yet allocated
     * @param user User address
     * @return Available stake
     */
    function getAvailableToAllocate(address user) public view returns (uint256) {
        StakePosition storage pos = positions[user];

        uint256 allocated = allocations[user][Service.NODE].amount + allocations[user][Service.XLP].amount
            + allocations[user][Service.PAYMASTER].amount + allocations[user][Service.GOVERNANCE].amount;

        if (pos.totalStaked <= allocated) return 0;
        return pos.totalStaked - allocated;
    }

    /**
     * @notice Get user's total allocation across all services
     * @param user User address
     * @return Total allocated
     */
    function getTotalAllocated(address user) external view returns (uint256) {
        return allocations[user][Service.NODE].amount + allocations[user][Service.XLP].amount
            + allocations[user][Service.PAYMASTER].amount + allocations[user][Service.GOVERNANCE].amount;
    }

    /**
     * @notice Get user's full position info
     * @param user User address
     */
    function getPosition(address user)
        external
        view
        returns (
            uint256 totalStakedAmount,
            uint256 available,
            uint256 nodeAlloc,
            uint256 xlpAlloc,
            uint256 paymasterAlloc,
            uint256 governanceAlloc,
            uint256 pending,
            bool frozen
        )
    {
        StakePosition storage pos = positions[user];
        return (
            pos.totalStaked,
            getAvailableToAllocate(user),
            allocations[user][Service.NODE].amount,
            allocations[user][Service.XLP].amount,
            allocations[user][Service.PAYMASTER].amount,
            allocations[user][Service.GOVERNANCE].amount,
            pendingRewards[user],
            pos.isFrozen
        );
    }

    // ============ Admin ============

    /**
     * @notice Configure a service
     * @param service Service to configure
     * @param handler External handler contract
     * @param minAllocation Minimum allocation amount
     * @param rewardRateBps Annual reward rate in bps
     * @param slashCapBps Maximum slash per incident in bps
     * @param enabled Whether service is enabled
     */
    function configureService(
        Service service,
        address handler,
        uint256 minAllocation,
        uint256 rewardRateBps,
        uint256 slashCapBps,
        bool enabled
    ) external onlyOwner {
        serviceConfigs[service] = ServiceConfig({
            handler: handler,
            minAllocation: minAllocation,
            rewardRateBps: rewardRateBps,
            slashCapBps: slashCapBps,
            enabled: enabled
        });

        emit ServiceConfigured(service, handler, minAllocation, rewardRateBps);
    }

    /**
     * @notice Freeze a user's position
     * @param user User to freeze
     */
    function freezePosition(address user) external onlyOwner {
        positions[user].isFrozen = true;
    }

    /**
     * @notice Unfreeze a user's position
     * @param user User to unfreeze
     */
    function unfreezePosition(address user) external onlyOwner {
        positions[user].isFrozen = false;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setRewardsSource(address _source) external onlyOwner {
        rewardsSource = _source;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
