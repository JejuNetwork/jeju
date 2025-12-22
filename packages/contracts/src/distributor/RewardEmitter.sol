// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RewardEmitter
 * @notice Manages token emission schedule for protocol incentives
 * @dev Implements a declining emission curve:
 *      - Year 1: 40% of allocation
 *      - Year 2: 25% of allocation
 *      - Year 3: 15% of allocation
 *      - Year 4: 10% of allocation
 *      - Year 5+: 10% split across remaining years
 *
 * Distribution targets:
 *      - Node operators: 40%
 *      - XLP providers: 25%
 *      - Staking rewards: 20%
 *      - Ecosystem grants: 15%
 */
contract RewardEmitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;

    // Emission schedule
    uint256 public immutable startTime;
    uint256 public immutable totalAllocation;

    // Distribution percentages (bps)
    uint256 public constant NODE_OPERATOR_BPS = 4000;  // 40%
    uint256 public constant XLP_PROVIDER_BPS = 2500;   // 25%
    uint256 public constant STAKING_BPS = 2000;        // 20%
    uint256 public constant ECOSYSTEM_BPS = 1500;      // 15%
    uint256 public constant BPS = 10000;

    // Yearly emission rates (percentage of total allocation)
    uint256[5] public yearlyEmissionRates = [4000, 2500, 1500, 1000, 1000]; // Year 1-5

    // Recipients
    address public nodeOperatorRewards;
    address public xlpProviderRewards;
    address public stakingRewards;
    address public ecosystemGrants;

    // Tracking
    uint256 public totalEmitted;
    uint256 public lastEmissionTime;
    mapping(address => uint256) public recipientEmissions;

    // Epoch tracking (for efficient emissions)
    uint256 public constant EPOCH_DURATION = 1 weeks;
    uint256 public currentEpoch;
    mapping(uint256 => uint256) public epochEmissions;
    mapping(uint256 => bool) public epochDistributed;

    event EmissionDistributed(
        uint256 indexed epoch,
        uint256 nodeOperatorAmount,
        uint256 xlpAmount,
        uint256 stakingAmount,
        uint256 ecosystemAmount
    );
    event RecipientUpdated(string recipientType, address newAddress);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    error InvalidRecipient();
    error EpochNotReady();
    error EpochAlreadyDistributed();
    error InsufficientBalance();
    error AllocationExhausted();

    constructor(
        address _rewardToken,
        uint256 _totalAllocation,
        address _nodeOperatorRewards,
        address _xlpProviderRewards,
        address _stakingRewards,
        address _ecosystemGrants,
        address initialOwner
    ) Ownable(initialOwner) {
        rewardToken = IERC20(_rewardToken);
        totalAllocation = _totalAllocation;
        startTime = block.timestamp;
        lastEmissionTime = block.timestamp;

        nodeOperatorRewards = _nodeOperatorRewards;
        xlpProviderRewards = _xlpProviderRewards;
        stakingRewards = _stakingRewards;
        ecosystemGrants = _ecosystemGrants;
    }

    /**
     * @notice Get current year in emission schedule (0-indexed)
     */
    function getCurrentYear() public view returns (uint256) {
        return (block.timestamp - startTime) / 365 days;
    }

    /**
     * @notice Get current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp - startTime) / EPOCH_DURATION;
    }

    /**
     * @notice Calculate emission for a given epoch
     * @param epoch Epoch number
     * @return Emission amount for that epoch
     */
    function getEpochEmission(uint256 epoch) public view returns (uint256) {
        uint256 epochStart = startTime + (epoch * EPOCH_DURATION);
        uint256 year = (epochStart - startTime) / 365 days;

        if (year >= 5) {
            // After year 5, linear decay
            return totalAllocation / 520; // ~10% over 52 weeks
        }

        uint256 yearlyRate = yearlyEmissionRates[year];
        uint256 yearlyEmission = (totalAllocation * yearlyRate) / BPS;
        uint256 weeklyEmission = yearlyEmission / 52;

        return weeklyEmission;
    }

    /**
     * @notice Distribute rewards for the current epoch
     */
    function distribute() external nonReentrant {
        uint256 epoch = getCurrentEpoch();
        if (epoch == 0 && block.timestamp < startTime + EPOCH_DURATION) revert EpochNotReady();
        if (epochDistributed[epoch - 1]) revert EpochAlreadyDistributed();

        uint256 epochToDistribute = epoch - 1;
        uint256 emission = getEpochEmission(epochToDistribute);

        if (totalEmitted + emission > totalAllocation) {
            emission = totalAllocation - totalEmitted;
            if (emission == 0) revert AllocationExhausted();
        }

        uint256 balance = rewardToken.balanceOf(address(this));
        if (balance < emission) revert InsufficientBalance();

        // Calculate distributions
        uint256 nodeAmount = (emission * NODE_OPERATOR_BPS) / BPS;
        uint256 xlpAmount = (emission * XLP_PROVIDER_BPS) / BPS;
        uint256 stakingAmount = (emission * STAKING_BPS) / BPS;
        uint256 ecosystemAmount = emission - nodeAmount - xlpAmount - stakingAmount;

        // Update state
        epochDistributed[epochToDistribute] = true;
        epochEmissions[epochToDistribute] = emission;
        totalEmitted += emission;
        currentEpoch = epoch;

        // Transfer to recipients
        if (nodeAmount > 0 && nodeOperatorRewards != address(0)) {
            rewardToken.safeTransfer(nodeOperatorRewards, nodeAmount);
            recipientEmissions[nodeOperatorRewards] += nodeAmount;
        }

        if (xlpAmount > 0 && xlpProviderRewards != address(0)) {
            rewardToken.safeTransfer(xlpProviderRewards, xlpAmount);
            recipientEmissions[xlpProviderRewards] += xlpAmount;
        }

        if (stakingAmount > 0 && stakingRewards != address(0)) {
            rewardToken.safeTransfer(stakingRewards, stakingAmount);
            recipientEmissions[stakingRewards] += stakingAmount;
        }

        if (ecosystemAmount > 0 && ecosystemGrants != address(0)) {
            rewardToken.safeTransfer(ecosystemGrants, ecosystemAmount);
            recipientEmissions[ecosystemGrants] += ecosystemAmount;
        }

        emit EmissionDistributed(epochToDistribute, nodeAmount, xlpAmount, stakingAmount, ecosystemAmount);
    }

    /**
     * @notice Distribute multiple epochs at once (catch up)
     * @param epochs Number of epochs to distribute
     */
    function distributeMultiple(uint256 epochs) external nonReentrant {
        uint256 epoch = getCurrentEpoch();

        for (uint256 i = 0; i < epochs; i++) {
            uint256 epochToDistribute = epoch - 1 - i;
            if (epochDistributed[epochToDistribute]) continue;

            uint256 emission = getEpochEmission(epochToDistribute);
            if (totalEmitted + emission > totalAllocation) break;

            uint256 balance = rewardToken.balanceOf(address(this));
            if (balance < emission) break;

            uint256 nodeAmount = (emission * NODE_OPERATOR_BPS) / BPS;
            uint256 xlpAmount = (emission * XLP_PROVIDER_BPS) / BPS;
            uint256 stakingAmount = (emission * STAKING_BPS) / BPS;
            uint256 ecosystemAmount = emission - nodeAmount - xlpAmount - stakingAmount;

            epochDistributed[epochToDistribute] = true;
            epochEmissions[epochToDistribute] = emission;
            totalEmitted += emission;

            if (nodeAmount > 0 && nodeOperatorRewards != address(0)) {
                rewardToken.safeTransfer(nodeOperatorRewards, nodeAmount);
                recipientEmissions[nodeOperatorRewards] += nodeAmount;
            }

            if (xlpAmount > 0 && xlpProviderRewards != address(0)) {
                rewardToken.safeTransfer(xlpProviderRewards, xlpAmount);
                recipientEmissions[xlpProviderRewards] += xlpAmount;
            }

            if (stakingAmount > 0 && stakingRewards != address(0)) {
                rewardToken.safeTransfer(stakingRewards, stakingAmount);
                recipientEmissions[stakingRewards] += stakingAmount;
            }

            if (ecosystemAmount > 0 && ecosystemGrants != address(0)) {
                rewardToken.safeTransfer(ecosystemGrants, ecosystemAmount);
                recipientEmissions[ecosystemGrants] += ecosystemAmount;
            }

            emit EmissionDistributed(epochToDistribute, nodeAmount, xlpAmount, stakingAmount, ecosystemAmount);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get remaining allocation
     */
    function remainingAllocation() external view returns (uint256) {
        return totalAllocation > totalEmitted ? totalAllocation - totalEmitted : 0;
    }

    /**
     * @notice Get number of undistributed epochs
     */
    function pendingEpochs() external view returns (uint256) {
        uint256 epoch = getCurrentEpoch();
        uint256 pending = 0;
        for (uint256 i = 0; i < epoch; i++) {
            if (!epochDistributed[i]) pending++;
        }
        return pending;
    }

    /**
     * @notice Get projected emission for next 12 months
     */
    function projectedYearlyEmission() external view returns (uint256) {
        uint256 year = getCurrentYear();
        if (year >= 5) return totalAllocation / 10;
        return (totalAllocation * yearlyEmissionRates[year]) / BPS;
    }

    // ============ Admin ============

    function setNodeOperatorRewards(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert InvalidRecipient();
        nodeOperatorRewards = _recipient;
        emit RecipientUpdated("nodeOperator", _recipient);
    }

    function setXlpProviderRewards(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert InvalidRecipient();
        xlpProviderRewards = _recipient;
        emit RecipientUpdated("xlpProvider", _recipient);
    }

    function setStakingRewards(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert InvalidRecipient();
        stakingRewards = _recipient;
        emit RecipientUpdated("staking", _recipient);
    }

    function setEcosystemGrants(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert InvalidRecipient();
        ecosystemGrants = _recipient;
        emit RecipientUpdated("ecosystem", _recipient);
    }

    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        rewardToken.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }
}

