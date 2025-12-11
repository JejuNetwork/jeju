// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LPLocker
 * @author Jeju Network
 * @notice Lock LP tokens for a specified duration
 * @dev Supports multiple locks per beneficiary and multiple tokens
 *
 * Features:
 * - Lock LP tokens for 1 week to 6 months
 * - Beneficiary can withdraw after lock expires
 * - Supports permanent locks (set duration to max uint256)
 * - Supports extending lock duration
 * - Multiple locks per address
 *
 * Security:
 * - Only launchpad/authorized contracts can create locks
 * - Beneficiary cannot withdraw until lock expires
 * - No early withdrawal mechanism
 */
contract LPLocker is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Lock {
        uint256 id;
        IERC20 lpToken;
        uint256 amount;
        address beneficiary;
        uint256 unlockTime;
        bool withdrawn;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice All locks by ID
    mapping(uint256 => Lock) public locks;

    /// @notice Next lock ID
    uint256 public nextLockId = 1;

    /// @notice Locks by beneficiary
    mapping(address => uint256[]) public beneficiaryLocks;

    /// @notice Locks by LP token
    mapping(address => uint256[]) public tokenLocks;

    /// @notice Authorized lockers (launchpad, presale contracts)
    mapping(address => bool) public authorizedLockers;

    /// @notice Total locked by token
    mapping(address => uint256) public totalLocked;

    // Constraints
    uint256 public constant MIN_LOCK_DURATION = 1 weeks;
    uint256 public constant MAX_LOCK_DURATION = 180 days; // 6 months
    uint256 public constant PERMANENT_LOCK = type(uint256).max;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Locked(
        uint256 indexed lockId,
        address indexed lpToken,
        address indexed beneficiary,
        uint256 amount,
        uint256 unlockTime
    );

    event Withdrawn(
        uint256 indexed lockId,
        address indexed lpToken,
        address indexed beneficiary,
        uint256 amount
    );

    event LockExtended(
        uint256 indexed lockId,
        uint256 oldUnlockTime,
        uint256 newUnlockTime
    );

    event AuthorizedLockerUpdated(address indexed locker, bool authorized);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error Unauthorized();
    error InvalidDuration();
    error InvalidAmount();
    error LockNotFound();
    error LockNotExpired();
    error AlreadyWithdrawn();
    error CannotShortenLock();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _owner) Ownable(_owner) {
        // Owner is automatically authorized
        authorizedLockers[_owner] = true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              LOCK
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Lock LP tokens for a duration
     * @param lpToken The LP token to lock
     * @param amount Amount to lock
     * @param beneficiary Address that can withdraw after lock expires
     * @param duration Lock duration in seconds
     * @return lockId The ID of the created lock
     */
    function lock(
        IERC20 lpToken,
        uint256 amount,
        address beneficiary,
        uint256 duration
    ) external nonReentrant returns (uint256 lockId) {
        if (!authorizedLockers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        if (amount == 0) revert InvalidAmount();
        if (duration != PERMANENT_LOCK) {
            if (duration < MIN_LOCK_DURATION || duration > MAX_LOCK_DURATION) {
                revert InvalidDuration();
            }
        }

        // Transfer tokens to this contract
        lpToken.safeTransferFrom(msg.sender, address(this), amount);

        lockId = nextLockId++;
        uint256 unlockTime = duration == PERMANENT_LOCK ? PERMANENT_LOCK : block.timestamp + duration;

        locks[lockId] = Lock({
            id: lockId,
            lpToken: lpToken,
            amount: amount,
            beneficiary: beneficiary,
            unlockTime: unlockTime,
            withdrawn: false
        });

        beneficiaryLocks[beneficiary].push(lockId);
        tokenLocks[address(lpToken)].push(lockId);
        totalLocked[address(lpToken)] += amount;

        emit Locked(lockId, address(lpToken), beneficiary, amount, unlockTime);
    }

    /**
     * @notice Withdraw locked tokens after lock expires
     * @param lockId The lock ID to withdraw from
     */
    function withdraw(uint256 lockId) external nonReentrant {
        Lock storage lockData = locks[lockId];
        
        if (lockData.amount == 0) revert LockNotFound();
        if (lockData.withdrawn) revert AlreadyWithdrawn();
        if (lockData.beneficiary != msg.sender) revert Unauthorized();
        if (block.timestamp < lockData.unlockTime) revert LockNotExpired();
        if (lockData.unlockTime == PERMANENT_LOCK) revert LockNotExpired();

        lockData.withdrawn = true;
        totalLocked[address(lockData.lpToken)] -= lockData.amount;

        lockData.lpToken.safeTransfer(msg.sender, lockData.amount);

        emit Withdrawn(lockId, address(lockData.lpToken), msg.sender, lockData.amount);
    }

    /**
     * @notice Extend lock duration
     * @param lockId The lock ID to extend
     * @param newDuration New total duration from now
     */
    function extendLock(uint256 lockId, uint256 newDuration) external {
        Lock storage lockData = locks[lockId];

        if (lockData.amount == 0) revert LockNotFound();
        if (lockData.withdrawn) revert AlreadyWithdrawn();
        if (lockData.beneficiary != msg.sender) revert Unauthorized();

        uint256 newUnlockTime = block.timestamp + newDuration;
        if (newUnlockTime <= lockData.unlockTime) revert CannotShortenLock();

        uint256 oldUnlockTime = lockData.unlockTime;
        lockData.unlockTime = newUnlockTime;

        emit LockExtended(lockId, oldUnlockTime, newUnlockTime);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get lock details
     */
    function getLock(uint256 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }

    /**
     * @notice Get all locks for a beneficiary
     */
    function getBeneficiaryLocks(address beneficiary) external view returns (uint256[] memory) {
        return beneficiaryLocks[beneficiary];
    }

    /**
     * @notice Get all locks for a token
     */
    function getTokenLocks(address lpToken) external view returns (uint256[] memory) {
        return tokenLocks[lpToken];
    }

    /**
     * @notice Check if a lock is withdrawable
     */
    function isWithdrawable(uint256 lockId) external view returns (bool) {
        Lock storage lockData = locks[lockId];
        if (lockData.amount == 0 || lockData.withdrawn) return false;
        if (lockData.unlockTime == PERMANENT_LOCK) return false;
        return block.timestamp >= lockData.unlockTime;
    }

    /**
     * @notice Get time until unlock
     */
    function timeUntilUnlock(uint256 lockId) external view returns (uint256) {
        Lock storage lockData = locks[lockId];
        if (lockData.unlockTime == PERMANENT_LOCK) return type(uint256).max;
        if (block.timestamp >= lockData.unlockTime) return 0;
        return lockData.unlockTime - block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Set authorized locker status
     * @param locker Address to authorize/deauthorize
     * @param authorized Whether to authorize
     */
    function setAuthorizedLocker(address locker, bool authorized) external onlyOwner {
        authorizedLockers[locker] = authorized;
        emit AuthorizedLockerUpdated(locker, authorized);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
