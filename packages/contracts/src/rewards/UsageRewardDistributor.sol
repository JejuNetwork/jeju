// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title UsageRewardDistributor
 * @author Jeju Network
 * @notice Distributes rewards to service providers based on reported usage
 * @dev Permissionless distribution based on reputation-weighted usage
 *
 * Supports multiple service types:
 * - RPC providers (compute units served)
 * - Bandwidth providers (bytes shared)
 * - CDN providers (requests served)
 * - Compute providers (GPU/CPU hours)
 *
 * Distribution model:
 * - Rewards pool is filled periodically (daily/weekly)
 * - Usage is reported by authorized oracles
 * - Rewards are distributed proportionally to usage * reputation
 * - Providers claim their accumulated rewards
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract UsageRewardDistributor is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum ServiceType {
        RPC,
        Bandwidth,
        CDN,
        Compute
    }

    // ============ Structs ============

    struct UsageRecord {
        uint256 amount;          // Usage amount (compute units, bytes, requests, etc.)
        uint256 timestamp;       // When usage was recorded
        uint256 reputationScore; // Reputation at time of recording (0-10000)
    }

    struct ProviderRewards {
        uint256 totalClaimed;
        uint256 pendingRewards;
        uint256 lastClaimTime;
        uint256 lastUsageRecorded;
    }

    struct EpochConfig {
        uint256 startTime;
        uint256 duration;        // Epoch duration in seconds
        uint256 rewardPool;      // Total rewards for this epoch
        uint256 totalWeightedUsage;  // Sum of (usage * reputation) for epoch
        bool finalized;
    }

    struct ServiceConfig {
        address registry;        // Registry contract for this service
        uint256 rewardWeight;    // Relative weight for reward allocation (basis points)
        bool enabled;
    }

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant MAX_EPOCH_DURATION = 30 days;
    uint256 public constant MIN_EPOCH_DURATION = 1 hours;

    // ============ State ============

    IERC20 public immutable rewardToken;

    // Service configurations
    mapping(ServiceType => ServiceConfig) public serviceConfigs;

    // Provider rewards by service
    mapping(ServiceType => mapping(address => ProviderRewards)) public providerRewards;

    // Usage records by service, epoch, provider
    mapping(ServiceType => mapping(uint256 => mapping(address => UsageRecord))) public usageRecords;

    // Epoch tracking
    mapping(ServiceType => uint256) public currentEpoch;
    mapping(ServiceType => mapping(uint256 => EpochConfig)) public epochs;

    // Authorized usage reporters (oracles)
    mapping(address => bool) public authorizedReporters;

    // Treasury for fees
    address public treasury;
    uint256 public protocolFeeBps = 500;  // 5% protocol fee

    // Rewards source
    address public rewardsPool;

    // ============ Events ============

    event UsageRecorded(
        ServiceType indexed serviceType,
        address indexed provider,
        uint256 epoch,
        uint256 amount,
        uint256 reputation
    );
    event RewardsClaimed(
        ServiceType indexed serviceType,
        address indexed provider,
        uint256 amount
    );
    event EpochStarted(
        ServiceType indexed serviceType,
        uint256 indexed epoch,
        uint256 rewardPool
    );
    event EpochFinalized(
        ServiceType indexed serviceType,
        uint256 indexed epoch,
        uint256 totalWeightedUsage
    );
    event ServiceConfigured(
        ServiceType indexed serviceType,
        address registry,
        uint256 rewardWeight
    );
    event ReporterAuthorized(address indexed reporter, bool authorized);

    // ============ Errors ============

    error NotAuthorizedReporter();
    error ServiceNotEnabled();
    error EpochNotFinalized();
    error EpochAlreadyFinalized();
    error NothingToClaim();
    error InvalidDuration();
    error InvalidWeight();
    error ZeroAmount();

    // ============ Modifiers ============

    modifier onlyReporter() {
        if (!authorizedReporters[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedReporter();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _rewardToken,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        rewardToken = IERC20(_rewardToken);
        treasury = _treasury;
        authorizedReporters[initialOwner] = true;
    }

    // ============ Usage Reporting ============

    /**
     * @notice Record usage for a provider
     * @param serviceType Type of service
     * @param provider Provider address
     * @param amount Usage amount
     * @param reputationScore Provider's reputation (0-10000)
     */
    function recordUsage(
        ServiceType serviceType,
        address provider,
        uint256 amount,
        uint256 reputationScore
    ) external onlyReporter {
        if (amount == 0) revert ZeroAmount();
        if (!serviceConfigs[serviceType].enabled) revert ServiceNotEnabled();

        uint256 epoch = currentEpoch[serviceType];
        EpochConfig storage epochConfig = epochs[serviceType][epoch];

        // Ensure epoch is active
        if (epochConfig.finalized) {
            // Start new epoch
            _startNewEpoch(serviceType);
            epoch = currentEpoch[serviceType];
            epochConfig = epochs[serviceType][epoch];
        }

        // Record usage
        UsageRecord storage record = usageRecords[serviceType][epoch][provider];
        record.amount += amount;
        record.timestamp = block.timestamp;
        record.reputationScore = reputationScore;

        // Update epoch weighted usage
        uint256 weightedUsage = (amount * reputationScore) / BPS;
        epochConfig.totalWeightedUsage += weightedUsage;

        // Update provider tracking
        providerRewards[serviceType][provider].lastUsageRecorded = block.timestamp;

        emit UsageRecorded(serviceType, provider, epoch, amount, reputationScore);
    }

    /**
     * @notice Batch record usage for multiple providers
     */
    function batchRecordUsage(
        ServiceType serviceType,
        address[] calldata providers,
        uint256[] calldata amounts,
        uint256[] calldata reputationScores
    ) external onlyReporter {
        require(
            providers.length == amounts.length &&
            amounts.length == reputationScores.length,
            "Length mismatch"
        );

        for (uint256 i = 0; i < providers.length; i++) {
            if (amounts[i] == 0) continue;

            uint256 epoch = currentEpoch[serviceType];
            EpochConfig storage epochConfig = epochs[serviceType][epoch];

            if (epochConfig.finalized) {
                _startNewEpoch(serviceType);
                epoch = currentEpoch[serviceType];
                epochConfig = epochs[serviceType][epoch];
            }

            UsageRecord storage record = usageRecords[serviceType][epoch][providers[i]];
            record.amount += amounts[i];
            record.timestamp = block.timestamp;
            record.reputationScore = reputationScores[i];

            uint256 weightedUsage = (amounts[i] * reputationScores[i]) / BPS;
            epochConfig.totalWeightedUsage += weightedUsage;

            providerRewards[serviceType][providers[i]].lastUsageRecorded = block.timestamp;

            emit UsageRecorded(serviceType, providers[i], epoch, amounts[i], reputationScores[i]);
        }
    }

    // ============ Epoch Management ============

    /**
     * @notice Start a new epoch for a service
     * @param serviceType Service type
     * @param rewardPool Rewards available for this epoch
     * @param duration Epoch duration
     */
    function startEpoch(
        ServiceType serviceType,
        uint256 rewardPool,
        uint256 duration
    ) external onlyOwner {
        if (duration < MIN_EPOCH_DURATION || duration > MAX_EPOCH_DURATION) {
            revert InvalidDuration();
        }

        // Finalize current epoch if not already
        uint256 current = currentEpoch[serviceType];
        if (epochs[serviceType][current].startTime > 0 && !epochs[serviceType][current].finalized) {
            _finalizeEpoch(serviceType, current);
        }

        // Start new epoch
        uint256 newEpoch = current + 1;
        currentEpoch[serviceType] = newEpoch;

        epochs[serviceType][newEpoch] = EpochConfig({
            startTime: block.timestamp,
            duration: duration,
            rewardPool: rewardPool,
            totalWeightedUsage: 0,
            finalized: false
        });

        emit EpochStarted(serviceType, newEpoch, rewardPool);
    }

    /**
     * @notice Finalize an epoch and calculate rewards
     */
    function finalizeEpoch(ServiceType serviceType, uint256 epoch) external onlyReporter {
        _finalizeEpoch(serviceType, epoch);
    }

    function _finalizeEpoch(ServiceType serviceType, uint256 epoch) internal {
        EpochConfig storage epochConfig = epochs[serviceType][epoch];
        if (epochConfig.finalized) revert EpochAlreadyFinalized();

        epochConfig.finalized = true;

        emit EpochFinalized(serviceType, epoch, epochConfig.totalWeightedUsage);
    }

    function _startNewEpoch(ServiceType serviceType) internal {
        uint256 current = currentEpoch[serviceType];
        EpochConfig storage currentConfig = epochs[serviceType][current];

        // Finalize current
        if (!currentConfig.finalized) {
            currentConfig.finalized = true;
            emit EpochFinalized(serviceType, current, currentConfig.totalWeightedUsage);
        }

        // Start new with same duration and pool
        uint256 newEpoch = current + 1;
        currentEpoch[serviceType] = newEpoch;

        epochs[serviceType][newEpoch] = EpochConfig({
            startTime: block.timestamp,
            duration: currentConfig.duration,
            rewardPool: currentConfig.rewardPool,
            totalWeightedUsage: 0,
            finalized: false
        });

        emit EpochStarted(serviceType, newEpoch, currentConfig.rewardPool);
    }

    // ============ Rewards ============

    /**
     * @notice Claim rewards for all finalized epochs
     * @param serviceType Service type to claim for
     */
    function claimRewards(ServiceType serviceType) external nonReentrant {
        uint256 totalReward = _calculatePendingRewards(serviceType, msg.sender);
        if (totalReward == 0) revert NothingToClaim();

        ProviderRewards storage rewards = providerRewards[serviceType][msg.sender];
        rewards.pendingRewards = 0;
        rewards.totalClaimed += totalReward;
        rewards.lastClaimTime = block.timestamp;

        // Deduct protocol fee
        uint256 fee = (totalReward * protocolFeeBps) / BPS;
        uint256 netReward = totalReward - fee;

        // Transfer rewards
        if (rewardsPool != address(0)) {
            rewardToken.safeTransferFrom(rewardsPool, msg.sender, netReward);
            if (fee > 0 && treasury != address(0)) {
                rewardToken.safeTransferFrom(rewardsPool, treasury, fee);
            }
        } else {
            rewardToken.safeTransfer(msg.sender, netReward);
            if (fee > 0 && treasury != address(0)) {
                rewardToken.safeTransfer(treasury, fee);
            }
        }

        emit RewardsClaimed(serviceType, msg.sender, netReward);
    }

    /**
     * @notice Get pending rewards for a provider
     */
    function getPendingRewards(ServiceType serviceType, address provider) external view returns (uint256) {
        return _calculatePendingRewards(serviceType, provider);
    }

    function _calculatePendingRewards(ServiceType serviceType, address provider) internal view returns (uint256) {
        uint256 total = providerRewards[serviceType][provider].pendingRewards;
        uint256 current = currentEpoch[serviceType];

        // Calculate rewards for all finalized epochs since last claim
        for (uint256 epoch = 1; epoch <= current; epoch++) {
            EpochConfig storage epochConfig = epochs[serviceType][epoch];
            if (!epochConfig.finalized) continue;
            if (epochConfig.totalWeightedUsage == 0) continue;

            UsageRecord storage record = usageRecords[serviceType][epoch][provider];
            if (record.amount == 0) continue;

            // Calculate provider's share
            uint256 weightedUsage = (record.amount * record.reputationScore) / BPS;
            uint256 share = (epochConfig.rewardPool * weightedUsage) / epochConfig.totalWeightedUsage;
            total += share;
        }

        return total;
    }

    // ============ Queries ============

    /**
     * @notice Get provider stats
     */
    function getProviderStats(ServiceType serviceType, address provider)
        external
        view
        returns (
            uint256 totalClaimed,
            uint256 pendingRewards,
            uint256 lastClaimTime,
            uint256 lastUsageRecorded
        )
    {
        ProviderRewards storage rewards = providerRewards[serviceType][provider];
        return (
            rewards.totalClaimed,
            _calculatePendingRewards(serviceType, provider),
            rewards.lastClaimTime,
            rewards.lastUsageRecorded
        );
    }

    /**
     * @notice Get epoch info
     */
    function getEpochInfo(ServiceType serviceType, uint256 epoch)
        external
        view
        returns (EpochConfig memory)
    {
        return epochs[serviceType][epoch];
    }

    // ============ Admin ============

    /**
     * @notice Configure a service
     */
    function configureService(
        ServiceType serviceType,
        address registry,
        uint256 rewardWeight,
        bool enabled
    ) external onlyOwner {
        if (rewardWeight > BPS) revert InvalidWeight();

        serviceConfigs[serviceType] = ServiceConfig({
            registry: registry,
            rewardWeight: rewardWeight,
            enabled: enabled
        });

        emit ServiceConfigured(serviceType, registry, rewardWeight);
    }

    /**
     * @notice Authorize a reporter
     */
    function setReporter(address reporter, bool authorized) external onlyOwner {
        authorizedReporters[reporter] = authorized;
        emit ReporterAuthorized(reporter, authorized);
    }

    /**
     * @notice Set protocol fee
     */
    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 2000, "Fee too high");  // Max 20%
        protocolFeeBps = feeBps;
    }

    /**
     * @notice Set rewards pool address
     */
    function setRewardsPool(address pool) external onlyOwner {
        rewardsPool = pool;
    }

    /**
     * @notice Set treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
