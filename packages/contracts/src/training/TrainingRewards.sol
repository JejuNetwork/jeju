// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITrainingCoordinator} from "./interfaces/ITrainingCoordinator.sol";

/**
 * @title TrainingRewards
 * @author Jeju Network
 * @notice Epoch-based reward distribution for training participants
 * @dev Replaces Psyche's Solana Treasurer with EVM-native rewards
 *
 * Architecture:
 * - Reward pools are created per training run
 * - Points are earned based on epoch completion
 * - Any ERC-20 token can be used for rewards (JEJU, USDC, etc.)
 * - Integrates with ERC-4337 paymaster for gasless claims
 *
 * Reward Calculation:
 * - Each epoch has a fixed point allocation
 * - Points are distributed equally among completing clients
 * - Rewards = (earnedPoints / totalDistributedPoints) * rewardPool
 */
contract TrainingRewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct RewardPool {
        bytes32 runId;
        address rewardToken;
        uint256 totalDeposited;
        uint256 totalClaimed;
        uint256 pointsPerEpoch;
        uint256 totalPointsDistributed;
        address depositor;
        bool active;
    }

    struct ParticipantRewards {
        uint256 earnedPoints;
        uint256 claimedPoints;
        uint16 lastCompletedEpoch;
        uint64 lastClaimTime;
    }

    struct EpochReward {
        uint256 pointsDistributed;
        uint16 participantCount;
        bool finalized;
    }

    /// @notice Training coordinator contract
    ITrainingCoordinator public coordinator;

    /// @notice Reward pools by run ID
    mapping(bytes32 => RewardPool) public rewardPools;

    /// @notice Participant rewards per run (runId => participant => rewards)
    mapping(bytes32 => mapping(address => ParticipantRewards)) public participantRewards;

    /// @notice Epoch rewards per run (runId => epoch => epochReward)
    mapping(bytes32 => mapping(uint16 => EpochReward)) public epochRewards;

    /// @notice Authorized reward distributors (can call recordEpochRewards)
    mapping(address => bool) public authorizedDistributors;

    /// @notice Default points per epoch if not specified
    uint256 public defaultPointsPerEpoch = 1000;

    /// @notice Minimum claim amount (prevents dust claims)
    uint256 public minClaimAmount = 0;

    event RewardPoolCreated(
        bytes32 indexed runId,
        address indexed depositor,
        address rewardToken,
        uint256 amount,
        uint256 pointsPerEpoch
    );

    event RewardsDeposited(bytes32 indexed runId, address indexed depositor, uint256 amount);

    event EpochRewardsRecorded(
        bytes32 indexed runId,
        uint16 indexed epoch,
        uint256 pointsDistributed,
        uint16 participantCount
    );

    event PointsEarned(
        bytes32 indexed runId,
        address indexed participant,
        uint16 indexed epoch,
        uint256 points
    );

    event RewardsClaimed(
        bytes32 indexed runId,
        address indexed participant,
        uint256 amount,
        uint256 pointsClaimed
    );

    event DistributorUpdated(address indexed distributor, bool authorized);

    error PoolAlreadyExists();
    error PoolNotFound();
    error PoolNotActive();
    error InsufficientDeposit();
    error NotDepositor();
    error NotAuthorizedDistributor();
    error EpochAlreadyFinalized();
    error NoRewardsToClaim();
    error ClaimBelowMinimum();
    error InvalidParticipants();
    error ZeroAddress();
    error TransferFailed();

    modifier poolExists(bytes32 runId) {
        if (rewardPools[runId].depositor == address(0)) revert PoolNotFound();
        _;
    }

    modifier poolActive(bytes32 runId) {
        if (!rewardPools[runId].active) revert PoolNotActive();
        _;
    }

    modifier onlyDistributor() {
        if (!authorizedDistributors[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedDistributor();
        }
        _;
    }

    constructor(address _coordinator, address initialOwner) Ownable(initialOwner) {
        coordinator = ITrainingCoordinator(_coordinator);
        authorizedDistributors[initialOwner] = true;
    }

    /**
     * @notice Create a reward pool for a training run
     * @param runId Training run ID
     * @param rewardToken ERC-20 token for rewards
     * @param amount Initial deposit amount
     * @param pointsPerEpoch Points to distribute per epoch (0 = use default)
     */
    function createRewardPool(
        bytes32 runId,
        address rewardToken,
        uint256 amount,
        uint256 pointsPerEpoch
    ) external nonReentrant {
        if (rewardPools[runId].depositor != address(0)) revert PoolAlreadyExists();
        if (rewardToken == address(0)) revert ZeroAddress();
        if (amount == 0) revert InsufficientDeposit();

        // Transfer tokens
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), amount);

        rewardPools[runId] = RewardPool({
            runId: runId,
            rewardToken: rewardToken,
            totalDeposited: amount,
            totalClaimed: 0,
            pointsPerEpoch: pointsPerEpoch == 0 ? defaultPointsPerEpoch : pointsPerEpoch,
            totalPointsDistributed: 0,
            depositor: msg.sender,
            active: true
        });

        emit RewardPoolCreated(runId, msg.sender, rewardToken, amount, pointsPerEpoch);
    }

    /**
     * @notice Add more rewards to an existing pool
     * @param runId Training run ID
     * @param amount Amount to add
     */
    function depositRewards(bytes32 runId, uint256 amount) external nonReentrant poolExists(runId) poolActive(runId) {
        if (amount == 0) revert InsufficientDeposit();

        RewardPool storage pool = rewardPools[runId];
        IERC20(pool.rewardToken).safeTransferFrom(msg.sender, address(this), amount);

        pool.totalDeposited += amount;

        emit RewardsDeposited(runId, msg.sender, amount);
    }

    /**
     * @notice Record rewards for a completed epoch
     * @dev Called by coordinator or authorized distributor after epoch completes
     * @param runId Training run ID
     * @param epoch Epoch number
     * @param participants Addresses of participants who completed the epoch
     */
    function recordEpochRewards(
        bytes32 runId,
        uint16 epoch,
        address[] calldata participants
    ) external nonReentrant onlyDistributor poolExists(runId) poolActive(runId) {
        if (participants.length == 0) revert InvalidParticipants();

        EpochReward storage epochReward = epochRewards[runId][epoch];
        if (epochReward.finalized) revert EpochAlreadyFinalized();

        RewardPool storage pool = rewardPools[runId];
        uint256 pointsPerParticipant = pool.pointsPerEpoch / participants.length;

        // Distribute points to each participant
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            ParticipantRewards storage rewards = participantRewards[runId][participant];

            rewards.earnedPoints += pointsPerParticipant;
            rewards.lastCompletedEpoch = epoch;

            emit PointsEarned(runId, participant, epoch, pointsPerParticipant);
        }

        // Update epoch record
        uint256 totalDistributed = pointsPerParticipant * participants.length;
        epochReward.pointsDistributed = totalDistributed;
        epochReward.participantCount = uint16(participants.length);
        epochReward.finalized = true;

        pool.totalPointsDistributed += totalDistributed;

        emit EpochRewardsRecorded(runId, epoch, totalDistributed, uint16(participants.length));
    }

    /**
     * @notice Record rewards for multiple epochs at once
     * @param runId Training run ID
     * @param epochs Array of epoch numbers
     * @param participantsPerEpoch Array of participant arrays for each epoch
     */
    function recordMultipleEpochRewards(
        bytes32 runId,
        uint16[] calldata epochs,
        address[][] calldata participantsPerEpoch
    ) external nonReentrant onlyDistributor poolExists(runId) poolActive(runId) {
        if (epochs.length != participantsPerEpoch.length) revert InvalidParticipants();

        RewardPool storage pool = rewardPools[runId];

        for (uint256 e = 0; e < epochs.length; e++) {
            uint16 epoch = epochs[e];
            address[] calldata participants = participantsPerEpoch[e];

            if (participants.length == 0) continue;

            EpochReward storage epochReward = epochRewards[runId][epoch];
            if (epochReward.finalized) continue;

            uint256 pointsPerParticipant = pool.pointsPerEpoch / participants.length;

            for (uint256 i = 0; i < participants.length; i++) {
                address participant = participants[i];
                ParticipantRewards storage rewards = participantRewards[runId][participant];

                rewards.earnedPoints += pointsPerParticipant;
                if (epoch > rewards.lastCompletedEpoch) {
                    rewards.lastCompletedEpoch = epoch;
                }

                emit PointsEarned(runId, participant, epoch, pointsPerParticipant);
            }

            uint256 totalDistributed = pointsPerParticipant * participants.length;
            epochReward.pointsDistributed = totalDistributed;
            epochReward.participantCount = uint16(participants.length);
            epochReward.finalized = true;

            pool.totalPointsDistributed += totalDistributed;

            emit EpochRewardsRecorded(runId, epoch, totalDistributed, uint16(participants.length));
        }
    }

    /**
     * @notice Claim earned rewards from a training run
     * @param runId Training run ID
     */
    function claim(bytes32 runId) external nonReentrant poolExists(runId) {
        _claim(runId, msg.sender);
    }

    /**
     * @notice Claim rewards on behalf of another address (for paymaster integration)
     * @param runId Training run ID
     * @param participant Address to claim for
     */
    function claimFor(bytes32 runId, address participant) external nonReentrant poolExists(runId) {
        _claim(runId, participant);
    }

    function _claim(bytes32 runId, address participant) internal {
        RewardPool storage pool = rewardPools[runId];
        ParticipantRewards storage rewards = participantRewards[runId][participant];

        uint256 claimablePoints = rewards.earnedPoints - rewards.claimedPoints;
        if (claimablePoints == 0) revert NoRewardsToClaim();

        // Calculate reward amount
        uint256 availableRewards = pool.totalDeposited - pool.totalClaimed;
        uint256 rewardAmount = (claimablePoints * availableRewards) / 
            (pool.totalPointsDistributed - _getTotalClaimedPoints(runId) + claimablePoints);

        if (rewardAmount < minClaimAmount) revert ClaimBelowMinimum();

        // Update state
        rewards.claimedPoints = rewards.earnedPoints;
        rewards.lastClaimTime = uint64(block.timestamp);
        pool.totalClaimed += rewardAmount;

        // Transfer rewards
        IERC20(pool.rewardToken).safeTransfer(participant, rewardAmount);

        emit RewardsClaimed(runId, participant, rewardAmount, claimablePoints);
    }

    /**
     * @notice Claim rewards from multiple runs at once
     * @param runIds Array of run IDs
     */
    function claimMultiple(bytes32[] calldata runIds) external nonReentrant {
        for (uint256 i = 0; i < runIds.length; i++) {
            if (rewardPools[runIds[i]].depositor == address(0)) continue;
            
            ParticipantRewards storage rewards = participantRewards[runIds[i]][msg.sender];
            if (rewards.earnedPoints > rewards.claimedPoints) {
                _claim(runIds[i], msg.sender);
            }
        }
    }

    /**
     * @notice Get claimable reward amount for a participant
     * @param runId Training run ID
     * @param participant Participant address
     * @return claimableAmount Claimable token amount
     * @return claimablePoints Claimable points
     */
    function claimable(bytes32 runId, address participant) external view returns (
        uint256 claimableAmount,
        uint256 claimablePoints
    ) {
        RewardPool storage pool = rewardPools[runId];
        if (pool.depositor == address(0)) return (0, 0);

        ParticipantRewards storage rewards = participantRewards[runId][participant];
        claimablePoints = rewards.earnedPoints - rewards.claimedPoints;

        if (claimablePoints == 0 || pool.totalPointsDistributed == 0) {
            return (0, 0);
        }

        uint256 availableRewards = pool.totalDeposited - pool.totalClaimed;
        uint256 totalClaimedPoints = _getTotalClaimedPoints(runId);
        
        claimableAmount = (claimablePoints * availableRewards) / 
            (pool.totalPointsDistributed - totalClaimedPoints + claimablePoints);
    }

    /**
     * @notice Get participant rewards info
     * @param runId Training run ID
     * @param participant Participant address
     */
    function getParticipantRewards(bytes32 runId, address participant) external view returns (
        uint256 earnedPoints,
        uint256 claimedPoints,
        uint16 lastCompletedEpoch,
        uint64 lastClaimTime
    ) {
        ParticipantRewards storage rewards = participantRewards[runId][participant];
        return (
            rewards.earnedPoints,
            rewards.claimedPoints,
            rewards.lastCompletedEpoch,
            rewards.lastClaimTime
        );
    }

    /**
     * @notice Get reward pool info
     * @param runId Training run ID
     */
    function getRewardPool(bytes32 runId) external view returns (
        address rewardToken,
        uint256 totalDeposited,
        uint256 totalClaimed,
        uint256 pointsPerEpoch,
        uint256 totalPointsDistributed,
        address depositor,
        bool active
    ) {
        RewardPool storage pool = rewardPools[runId];
        return (
            pool.rewardToken,
            pool.totalDeposited,
            pool.totalClaimed,
            pool.pointsPerEpoch,
            pool.totalPointsDistributed,
            pool.depositor,
            pool.active
        );
    }

    /**
     * @notice Get epoch reward info
     * @param runId Training run ID
     * @param epoch Epoch number
     */
    function getEpochReward(bytes32 runId, uint16 epoch) external view returns (
        uint256 pointsDistributed,
        uint16 participantCount,
        bool finalized
    ) {
        EpochReward storage reward = epochRewards[runId][epoch];
        return (reward.pointsDistributed, reward.participantCount, reward.finalized);
    }

    function _getTotalClaimedPoints(bytes32 runId) internal view returns (uint256 total) {
        // This is an approximation - in production you might want to track this directly
        RewardPool storage pool = rewardPools[runId];
        if (pool.totalDeposited == 0) return 0;
        
        // Calculate based on claimed amount ratio
        return (pool.totalClaimed * pool.totalPointsDistributed) / pool.totalDeposited;
    }

    /**
     * @notice Set authorized distributor status
     * @param distributor Address to authorize/deauthorize
     * @param authorized Whether to authorize
     */
    function setDistributor(address distributor, bool authorized) external onlyOwner {
        if (distributor == address(0)) revert ZeroAddress();
        authorizedDistributors[distributor] = authorized;
        emit DistributorUpdated(distributor, authorized);
    }

    /**
     * @notice Set the coordinator contract
     * @param _coordinator New coordinator address
     */
    function setCoordinator(address _coordinator) external onlyOwner {
        if (_coordinator == address(0)) revert ZeroAddress();
        coordinator = ITrainingCoordinator(_coordinator);
    }

    /**
     * @notice Set default points per epoch
     * @param _points New default points per epoch
     */
    function setDefaultPointsPerEpoch(uint256 _points) external onlyOwner {
        defaultPointsPerEpoch = _points;
    }

    /**
     * @notice Set minimum claim amount
     * @param _minClaim New minimum claim amount
     */
    function setMinClaimAmount(uint256 _minClaim) external onlyOwner {
        minClaimAmount = _minClaim;
    }

    /**
     * @notice Deactivate a reward pool (depositor or owner only)
     * @param runId Run ID to deactivate
     */
    function deactivatePool(bytes32 runId) external poolExists(runId) {
        RewardPool storage pool = rewardPools[runId];
        if (msg.sender != pool.depositor && msg.sender != owner()) revert NotDepositor();
        pool.active = false;
    }

    /**
     * @notice Withdraw remaining rewards from deactivated pool (depositor only)
     * @param runId Run ID
     */
    function withdrawRemaining(bytes32 runId) external nonReentrant poolExists(runId) {
        RewardPool storage pool = rewardPools[runId];
        if (msg.sender != pool.depositor) revert NotDepositor();
        if (pool.active) revert PoolNotActive();

        uint256 remaining = pool.totalDeposited - pool.totalClaimed;
        if (remaining == 0) revert NoRewardsToClaim();

        pool.totalClaimed = pool.totalDeposited;
        IERC20(pool.rewardToken).safeTransfer(msg.sender, remaining);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

