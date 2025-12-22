// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenVesting
 * @notice Manages token vesting schedules for team, advisors, presale, and ecosystem allocations
 * @dev Supports cliff periods, linear/discrete vesting, and TGE unlocks
 *
 * Vesting Schedule:
 * |-- TGE Unlock --|-- Cliff Period (no release) --|-- Vesting Period (linear or discrete) --|
 *
 * Example for Team (4 year vest, 1 year cliff, 10% TGE):
 * - At TGE: 10% immediately available
 * - Month 1-12: Nothing (cliff)
 * - Month 13-48: ~2.5% per month (linear)
 */
contract TokenVesting is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ERRORS
    // =============================================================================

    error ZeroAddress();
    error ZeroAmount();
    error ScheduleNotFound();
    error NothingToRelease();
    error InvalidSchedule();
    error AlreadyRevoked();
    error NotRevocable();
    error TGENotStarted();
    error ScheduleExists();

    // =============================================================================
    // EVENTS
    // =============================================================================

    event VestingScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 tgeUnlockPercent,
        bool revocable
    );

    event TokensReleased(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);

    event VestingRevoked(bytes32 indexed scheduleId, address indexed beneficiary, uint256 refundAmount);

    event TGEStarted(uint256 timestamp);

    // =============================================================================
    // TYPES
    // =============================================================================

    struct VestingSchedule {
        /// @notice Beneficiary address
        address beneficiary;
        /// @notice Total amount to vest
        uint256 totalAmount;
        /// @notice Amount released so far
        uint256 releasedAmount;
        /// @notice Vesting start time (TGE)
        uint256 startTime;
        /// @notice Cliff duration in seconds
        uint256 cliffDuration;
        /// @notice Vesting duration after cliff
        uint256 vestingDuration;
        /// @notice Percentage unlocked at TGE (0-100)
        uint8 tgeUnlockPercent;
        /// @notice Whether this schedule can be revoked
        bool revocable;
        /// @notice Whether this schedule has been revoked
        bool revoked;
        /// @notice Category (for tracking)
        VestingCategory category;
    }

    enum VestingCategory {
        Team,
        Advisors,
        Presale,
        Ecosystem,
        PublicSale
    }

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Token being vested
    IERC20 public immutable token;

    /// @notice TGE (Token Generation Event) start time
    uint256 public tgeStartTime;

    /// @notice All vesting schedule IDs
    bytes32[] public scheduleIds;

    /// @notice Vesting schedules by ID
    mapping(bytes32 => VestingSchedule) public schedules;

    /// @notice Schedule IDs per beneficiary
    mapping(address => bytes32[]) public beneficiarySchedules;

    /// @notice Total amount currently vesting
    uint256 public totalVesting;

    /// @notice Total amount released
    uint256 public totalReleased;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @param _token Token to vest
     * @param _owner Contract owner
     */
    constructor(IERC20 _token, address _owner) Ownable(_owner) {
        if (address(_token) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        token = _token;
    }

    // =============================================================================
    // SCHEDULE MANAGEMENT
    // =============================================================================

    /**
     * @notice Start the TGE (enables vesting to begin)
     * @param _startTime TGE timestamp (can be in future)
     */
    function startTGE(uint256 _startTime) external onlyOwner {
        if (_startTime == 0) _startTime = block.timestamp;
        tgeStartTime = _startTime;
        emit TGEStarted(_startTime);
    }

    /**
     * @notice Create a vesting schedule
     * @param beneficiary Address to receive vested tokens
     * @param totalAmount Total tokens to vest
     * @param cliffDuration Cliff period in seconds
     * @param vestingDuration Vesting period after cliff
     * @param tgeUnlockPercent Percentage to unlock at TGE (0-100)
     * @param revocable Whether owner can revoke this schedule
     * @param category Vesting category for tracking
     * @return scheduleId Unique identifier for this schedule
     */
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint8 tgeUnlockPercent,
        bool revocable,
        VestingCategory category
    ) external onlyOwner returns (bytes32 scheduleId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        if (tgeUnlockPercent > 100) revert InvalidSchedule();
        if (vestingDuration == 0 && tgeUnlockPercent < 100) revert InvalidSchedule();

        scheduleId = keccak256(abi.encodePacked(beneficiary, totalAmount, block.timestamp, scheduleIds.length));

        if (schedules[scheduleId].beneficiary != address(0)) revert ScheduleExists();

        schedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            releasedAmount: 0,
            startTime: tgeStartTime, // Will use TGE time when it starts
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            tgeUnlockPercent: tgeUnlockPercent,
            revocable: revocable,
            revoked: false,
            category: category
        });

        scheduleIds.push(scheduleId);
        beneficiarySchedules[beneficiary].push(scheduleId);
        totalVesting += totalAmount;

        emit VestingScheduleCreated(
            scheduleId, beneficiary, totalAmount, tgeStartTime, cliffDuration, vestingDuration, tgeUnlockPercent, revocable
        );
    }

    /**
     * @notice Batch create schedules
     */
    function createSchedulesBatch(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint8 tgeUnlockPercent,
        bool revocable,
        VestingCategory category
    ) external onlyOwner {
        uint256 len = beneficiaries.length;
        for (uint256 i = 0; i < len;) {
            bytes32 scheduleId =
                keccak256(abi.encodePacked(beneficiaries[i], amounts[i], block.timestamp, scheduleIds.length));

            if (beneficiaries[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();

            schedules[scheduleId] = VestingSchedule({
                beneficiary: beneficiaries[i],
                totalAmount: amounts[i],
                releasedAmount: 0,
                startTime: tgeStartTime,
                cliffDuration: cliffDuration,
                vestingDuration: vestingDuration,
                tgeUnlockPercent: tgeUnlockPercent,
                revocable: revocable,
                revoked: false,
                category: category
            });

            scheduleIds.push(scheduleId);
            beneficiarySchedules[beneficiaries[i]].push(scheduleId);
            totalVesting += amounts[i];

            emit VestingScheduleCreated(
                scheduleId,
                beneficiaries[i],
                amounts[i],
                tgeStartTime,
                cliffDuration,
                vestingDuration,
                tgeUnlockPercent,
                revocable
            );

            unchecked {
                ++i;
            }
        }
    }

    // =============================================================================
    // RELEASE LOGIC
    // =============================================================================

    /**
     * @notice Release vested tokens for a schedule
     * @param scheduleId Schedule to release from
     */
    function release(bytes32 scheduleId) external nonReentrant {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (schedule.revoked) revert AlreadyRevoked();
        if (tgeStartTime == 0) revert TGENotStarted();

        uint256 releasable = _computeReleasable(schedule);
        if (releasable == 0) revert NothingToRelease();

        schedule.releasedAmount += releasable;
        totalReleased += releasable;

        token.safeTransfer(schedule.beneficiary, releasable);

        emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
    }

    /**
     * @notice Release all vested tokens for a beneficiary across all schedules
     */
    function releaseAll(address beneficiary) external nonReentrant {
        bytes32[] storage scheduleList = beneficiarySchedules[beneficiary];
        uint256 len = scheduleList.length;
        uint256 totalReleasable = 0;

        for (uint256 i = 0; i < len;) {
            VestingSchedule storage schedule = schedules[scheduleList[i]];
            if (!schedule.revoked && tgeStartTime > 0) {
                uint256 releasable = _computeReleasable(schedule);
                if (releasable > 0) {
                    schedule.releasedAmount += releasable;
                    totalReleasable += releasable;
                    emit TokensReleased(scheduleList[i], beneficiary, releasable);
                }
            }
            unchecked {
                ++i;
            }
        }

        if (totalReleasable == 0) revert NothingToRelease();

        totalReleased += totalReleasable;
        token.safeTransfer(beneficiary, totalReleasable);
    }

    /**
     * @notice Revoke a vesting schedule (only for revocable schedules)
     * @param scheduleId Schedule to revoke
     */
    function revoke(bytes32 scheduleId) external onlyOwner {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        // Release any vested tokens first
        uint256 releasable = _computeReleasable(schedule);
        if (releasable > 0) {
            schedule.releasedAmount += releasable;
            totalReleased += releasable;
            token.safeTransfer(schedule.beneficiary, releasable);
            emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
        }

        // Calculate unvested amount to refund
        uint256 unvested = schedule.totalAmount - schedule.releasedAmount;
        schedule.revoked = true;
        totalVesting -= unvested;

        // Refund unvested to owner
        if (unvested > 0) {
            token.safeTransfer(owner(), unvested);
        }

        emit VestingRevoked(scheduleId, schedule.beneficiary, unvested);
    }

    // =============================================================================
    // INTERNAL
    // =============================================================================

    /**
     * @dev Compute releasable amount for a schedule
     */
    function _computeReleasable(VestingSchedule storage schedule) internal view returns (uint256) {
        uint256 vested = _computeVested(schedule);
        return vested - schedule.releasedAmount;
    }

    /**
     * @dev Compute total vested amount for a schedule
     */
    function _computeVested(VestingSchedule storage schedule) internal view returns (uint256) {
        if (tgeStartTime == 0 || block.timestamp < tgeStartTime) {
            return 0;
        }

        uint256 startTime = schedule.startTime > 0 ? schedule.startTime : tgeStartTime;

        // TGE unlock
        uint256 tgeAmount = (schedule.totalAmount * schedule.tgeUnlockPercent) / 100;
        uint256 vestingAmount = schedule.totalAmount - tgeAmount;

        // Before cliff, only TGE amount is vested
        if (block.timestamp < startTime + schedule.cliffDuration) {
            return tgeAmount;
        }

        // After vesting complete
        if (block.timestamp >= startTime + schedule.cliffDuration + schedule.vestingDuration) {
            return schedule.totalAmount;
        }

        // During vesting period (linear)
        uint256 timeInVesting = block.timestamp - startTime - schedule.cliffDuration;
        uint256 vestedDuringVesting = (vestingAmount * timeInVesting) / schedule.vestingDuration;

        return tgeAmount + vestedDuringVesting;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get releasable amount for a schedule
     */
    function getReleasable(bytes32 scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.beneficiary == address(0) || schedule.revoked) return 0;
        return _computeReleasable(schedule);
    }

    /**
     * @notice Get total releasable for a beneficiary
     */
    function getTotalReleasable(address beneficiary) external view returns (uint256 total) {
        bytes32[] storage scheduleList = beneficiarySchedules[beneficiary];
        for (uint256 i = 0; i < scheduleList.length;) {
            VestingSchedule storage schedule = schedules[scheduleList[i]];
            if (!schedule.revoked) {
                total += _computeReleasable(schedule);
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Get vested amount for a schedule
     */
    function getVested(bytes32 scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[scheduleId];
        if (schedule.beneficiary == address(0)) return 0;
        return _computeVested(schedule);
    }

    /**
     * @notice Get schedule count
     */
    function getScheduleCount() external view returns (uint256) {
        return scheduleIds.length;
    }

    /**
     * @notice Get all schedules for a beneficiary
     */
    function getBeneficiarySchedules(address beneficiary) external view returns (bytes32[] memory) {
        return beneficiarySchedules[beneficiary];
    }

    /**
     * @notice Get schedule details
     */
    function getSchedule(bytes32 scheduleId) external view returns (VestingSchedule memory) {
        return schedules[scheduleId];
    }

    /**
     * @notice Withdraw excess tokens (beyond what's needed for vesting)
     */
    function withdrawExcess() external onlyOwner {
        uint256 balance = token.balanceOf(address(this));
        uint256 required = totalVesting - totalReleased;
        if (balance > required) {
            token.safeTransfer(owner(), balance - required);
        }
    }
}







