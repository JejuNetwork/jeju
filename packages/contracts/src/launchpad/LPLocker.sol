// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LPLocker
/// @notice Lock LP tokens for a specified duration
/// @dev Supports 1 week to 6 months lock duration. Permanent locks supported.
contract LPLocker is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Lock {
        uint256 id;
        IERC20 lpToken;
        uint256 amount;
        address beneficiary;
        uint256 unlockTime;
        bool withdrawn;
    }

    uint256 public constant MIN_LOCK_DURATION = 1 weeks;
    uint256 public constant MAX_LOCK_DURATION = 180 days;
    uint256 public constant PERMANENT_LOCK = type(uint256).max;

    mapping(uint256 => Lock) public locks;
    uint256 public nextLockId = 1;
    mapping(address => uint256[]) public beneficiaryLocks;
    mapping(address => uint256[]) public tokenLocks;
    mapping(address => bool) public authorizedLockers;
    mapping(address => uint256) public totalLocked;

    event Locked(
        uint256 indexed lockId, address indexed lpToken, address indexed beneficiary, uint256 amount, uint256 unlockTime
    );
    event Withdrawn(uint256 indexed lockId, address indexed lpToken, address indexed beneficiary, uint256 amount);
    event LockExtended(uint256 indexed lockId, uint256 oldUnlockTime, uint256 newUnlockTime);
    event AuthorizedLockerUpdated(address indexed locker, bool authorized);

    error Unauthorized();
    error InvalidDuration();
    error InvalidAmount();
    error LockNotFound();
    error LockNotExpired();
    error AlreadyWithdrawn();
    error CannotShortenLock();

    constructor(address _owner) Ownable(_owner) {
        authorizedLockers[_owner] = true;
    }

    function lock(IERC20 lpToken, uint256 amount, address beneficiary, uint256 duration)
        external
        nonReentrant
        returns (uint256 lockId)
    {
        if (!authorizedLockers[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();
        if (duration != PERMANENT_LOCK && (duration < MIN_LOCK_DURATION || duration > MAX_LOCK_DURATION)) {
            revert InvalidDuration();
        }

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

    function getLock(uint256 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }

    function getBeneficiaryLocks(address beneficiary) external view returns (uint256[] memory) {
        return beneficiaryLocks[beneficiary];
    }

    function getTokenLocks(address lpToken) external view returns (uint256[] memory) {
        return tokenLocks[lpToken];
    }

    function isWithdrawable(uint256 lockId) external view returns (bool) {
        Lock storage lockData = locks[lockId];
        if (lockData.amount == 0 || lockData.withdrawn || lockData.unlockTime == PERMANENT_LOCK) return false;
        return block.timestamp >= lockData.unlockTime;
    }

    function timeUntilUnlock(uint256 lockId) external view returns (uint256) {
        Lock storage lockData = locks[lockId];
        if (lockData.unlockTime == PERMANENT_LOCK) return type(uint256).max;
        if (block.timestamp >= lockData.unlockTime) return 0;
        return lockData.unlockTime - block.timestamp;
    }

    function setAuthorizedLocker(address locker, bool authorized) external onlyOwner {
        authorizedLockers[locker] = authorized;
        emit AuthorizedLockerUpdated(locker, authorized);
    }
}
