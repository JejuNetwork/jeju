// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ServiceStaking
 * @notice Per-service staking contract - stake JEJU tokens for specific services
 * @dev Each service (storage, compute, proxy, etc.) has independent stakes
 */
contract ServiceStaking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ServiceStake {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
    }

    struct ServiceConfig {
        uint256 minStake;
        bool enabled;
    }

    uint256 public constant UNBONDING_PERIOD = 7 days;

    IERC20 public immutable stakingToken;

    // serviceId => user => stake
    mapping(bytes32 => mapping(address => ServiceStake)) public stakes;

    // serviceId => config
    mapping(bytes32 => ServiceConfig) public serviceConfigs;

    // serviceId => total staked
    mapping(bytes32 => uint256) public totalStakedByService;

    // user => total staked across all services
    mapping(address => uint256) public totalStakedByUser;

    event Staked(address indexed user, bytes32 indexed serviceId, uint256 amount);
    event UnbondingStarted(address indexed user, bytes32 indexed serviceId, uint256 amount);
    event Unstaked(address indexed user, bytes32 indexed serviceId, uint256 amount);
    event ServiceConfigured(bytes32 indexed serviceId, uint256 minStake, bool enabled);

    error ZeroAmount();
    error ServiceNotEnabled();
    error BelowMinimum();
    error InsufficientStake();
    error NotUnbonding();
    error UnbondingNotComplete();
    error AlreadyUnbonding();

    constructor(address _stakingToken, address initialOwner) Ownable(initialOwner) {
        stakingToken = IERC20(_stakingToken);

        // Enable default services
        _configureService("storage", 0.1 ether, true);
        _configureService("compute", 0.1 ether, true);
        _configureService("proxy", 0.1 ether, true);
        _configureService("cron", 0, true); // Free tier
        _configureService("sequencer", 1 ether, true);
        _configureService("rpc", 0.1 ether, true);
        _configureService("xlp", 0.5 ether, true);
        _configureService("solver", 0.5 ether, true);
        _configureService("oracle", 0.1 ether, true);
    }

    function _configureService(string memory serviceIdStr, uint256 minStake, bool enabled) internal {
        bytes32 serviceId = keccak256(bytes(serviceIdStr));
        serviceConfigs[serviceId] = ServiceConfig(minStake, enabled);
        emit ServiceConfigured(serviceId, minStake, enabled);
    }

    function configureService(string calldata serviceIdStr, uint256 minStake, bool enabled) external onlyOwner {
        _configureService(serviceIdStr, minStake, enabled);
    }

    /**
     * @notice Stake tokens for a specific service
     * @param serviceIdStr Service ID (e.g., "storage", "compute")
     * @param amount Amount to stake
     */
    function stake(string calldata serviceIdStr, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        bytes32 serviceId = keccak256(bytes(serviceIdStr));
        ServiceConfig storage config = serviceConfigs[serviceId];
        if (!config.enabled) revert ServiceNotEnabled();

        ServiceStake storage userStake = stakes[serviceId][msg.sender];
        uint256 newTotal = userStake.stakedAmount + amount;
        if (newTotal < config.minStake) revert BelowMinimum();

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        userStake.stakedAmount = newTotal;
        if (userStake.stakedAt == 0) {
            userStake.stakedAt = block.timestamp;
        }

        totalStakedByService[serviceId] += amount;
        totalStakedByUser[msg.sender] += amount;

        emit Staked(msg.sender, serviceId, amount);
    }

    /**
     * @notice Start unbonding tokens from a service
     * @param serviceIdStr Service ID
     * @param amount Amount to unbond
     */
    function startUnbonding(string calldata serviceIdStr, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        bytes32 serviceId = keccak256(bytes(serviceIdStr));
        ServiceStake storage userStake = stakes[serviceId][msg.sender];

        if (amount > userStake.stakedAmount) revert InsufficientStake();
        if (userStake.unbondingAmount > 0) revert AlreadyUnbonding();

        userStake.stakedAmount -= amount;
        userStake.unbondingAmount = amount;
        userStake.unbondingStartTime = block.timestamp;

        totalStakedByService[serviceId] -= amount;
        totalStakedByUser[msg.sender] -= amount;

        emit UnbondingStarted(msg.sender, serviceId, amount);
    }

    /**
     * @notice Complete unbonding and withdraw tokens
     * @param serviceIdStr Service ID
     */
    function completeUnbonding(string calldata serviceIdStr) external nonReentrant {
        bytes32 serviceId = keccak256(bytes(serviceIdStr));
        ServiceStake storage userStake = stakes[serviceId][msg.sender];

        if (userStake.unbondingAmount == 0) revert NotUnbonding();
        if (block.timestamp < userStake.unbondingStartTime + UNBONDING_PERIOD) revert UnbondingNotComplete();

        uint256 amount = userStake.unbondingAmount;
        userStake.unbondingAmount = 0;
        userStake.unbondingStartTime = 0;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, serviceId, amount);
    }

    /**
     * @notice Get stake info for a user and service
     */
    function getStake(string calldata serviceIdStr, address user) external view returns (
        uint256 stakedAmount,
        uint256 stakedAt,
        uint256 unbondingAmount,
        uint256 unbondingStartTime
    ) {
        bytes32 serviceId = keccak256(bytes(serviceIdStr));
        ServiceStake storage userStake = stakes[serviceId][user];
        return (
            userStake.stakedAmount,
            userStake.stakedAt,
            userStake.unbondingAmount,
            userStake.unbondingStartTime
        );
    }

    /**
     * @notice Get stake by bytes32 service ID (for internal use)
     */
    function getStakeById(bytes32 serviceId, address user) external view returns (
        uint256 stakedAmount,
        uint256 stakedAt,
        uint256 unbondingAmount,
        uint256 unbondingStartTime
    ) {
        ServiceStake storage userStake = stakes[serviceId][user];
        return (
            userStake.stakedAmount,
            userStake.stakedAt,
            userStake.unbondingAmount,
            userStake.unbondingStartTime
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
