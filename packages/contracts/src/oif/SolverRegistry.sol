// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ISolverRegistry} from "./IOIF.sol";

/**
 * @title SolverRegistry
 * @author Jeju Network
 * @notice Registry for OIF solvers with staking and slashing
 * @dev Provides economic security for cross-chain intent fulfillment
 *
 * ## How it works:
 * 1. Solvers register with minimum stake
 * 2. Stake is locked during active operations
 * 3. Failed fills result in slashing
 * 4. 8-day unbonding period for withdrawals
 */
contract SolverRegistry is ISolverRegistry, Ownable, ReentrancyGuard, Pausable {
    // ============ Constants ============

    /// @notice Minimum stake to register as solver
    uint256 public constant MIN_STAKE = 0.5 ether;

    /// @notice Unbonding period (8 days)
    uint256 public constant UNBONDING_PERIOD = 8 days;

    /// @notice Slashing percentage (50%)
    uint256 public constant SLASH_PERCENT = 50;

    /// @notice Maximum chains a solver can support
    uint256 public constant MAX_CHAINS = 50;

    // ============ State Variables ============

    /// @notice Solver stakes
    mapping(address => SolverStake) public stakes;

    /// @notice Solver supported chains
    mapping(address => uint256[]) public solverChains;

    /// @notice Total staked
    uint256 public totalStaked;

    /// @notice Total slashed
    uint256 public totalSlashed;

    /// @notice Active solver count
    uint256 public activeSolverCount;

    /// @notice Authorized slashers
    mapping(address => bool) public authorizedSlashers;

    /// @notice Fill counters
    mapping(address => uint256) public solverFillCount;
    mapping(address => uint256) public solverSuccessCount;

    // ============ Structs ============

    struct SolverStake {
        uint256 stakedAmount;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        uint256 slashedAmount;
        bool isActive;
        uint256 registeredAt;
    }

    // ============ Events ============

    event ChainAdded(address indexed solver, uint256 chainId);
    event ChainRemoved(address indexed solver, uint256 chainId);
    event SlasherUpdated(address indexed slasher, bool authorized);
    event FillRecorded(address indexed solver, bytes32 indexed orderId, bool success);

    // ============ Errors ============

    error InsufficientStake();
    error AlreadyRegistered();
    error NotRegistered();
    error UnbondingInProgress();
    error UnbondingNotComplete();
    error NoUnbondingStake();
    error TooManyChains();
    error ChainAlreadyAdded();
    error ChainNotFound();
    error UnauthorizedSlasher();
    error InvalidAmount();
    error WithdrawalFailed();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Registration ============

    /// @inheritdoc ISolverRegistry
    function register(uint256[] calldata chains) external payable override nonReentrant whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (stakes[msg.sender].isActive) revert AlreadyRegistered();
        if (chains.length > MAX_CHAINS) revert TooManyChains();

        stakes[msg.sender] = SolverStake({
            stakedAmount: msg.value,
            unbondingAmount: 0,
            unbondingStartTime: 0,
            slashedAmount: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        solverChains[msg.sender] = chains;
        totalStaked += msg.value;
        activeSolverCount++;

        emit SolverRegistered(msg.sender, msg.value, chains);
    }

    /// @inheritdoc ISolverRegistry
    function addStake() external payable override nonReentrant whenNotPaused {
        if (!stakes[msg.sender].isActive) revert NotRegistered();
        if (msg.value == 0) revert InvalidAmount();

        stakes[msg.sender].stakedAmount += msg.value;
        totalStaked += msg.value;

        emit SolverStakeDeposited(msg.sender, msg.value, stakes[msg.sender].stakedAmount);
    }

    /// @inheritdoc ISolverRegistry
    function startUnbonding(uint256 amount) external override nonReentrant whenNotPaused {
        SolverStake storage stake = stakes[msg.sender];

        if (!stake.isActive) revert NotRegistered();
        if (stake.unbondingAmount > 0) revert UnbondingInProgress();
        if (amount > stake.stakedAmount) revert InsufficientStake();

        // Must keep minimum if staying active
        uint256 remaining = stake.stakedAmount - amount;
        if (remaining > 0 && remaining < MIN_STAKE) {
            revert InsufficientStake();
        }

        stake.stakedAmount -= amount;
        stake.unbondingAmount = amount;
        stake.unbondingStartTime = block.timestamp;

        // Deactivate if fully unbonding
        if (stake.stakedAmount == 0) {
            stake.isActive = false;
            activeSolverCount--;
        }
    }

    /// @inheritdoc ISolverRegistry
    function completeUnbonding() external override nonReentrant {
        SolverStake storage stake = stakes[msg.sender];

        if (stake.unbondingAmount == 0) revert NoUnbondingStake();
        if (block.timestamp < stake.unbondingStartTime + UNBONDING_PERIOD) {
            revert UnbondingNotComplete();
        }

        uint256 amount = stake.unbondingAmount;
        stake.unbondingAmount = 0;
        stake.unbondingStartTime = 0;
        totalStaked -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit SolverWithdrawn(msg.sender, amount);
    }

    /// @notice Cancel unbonding and restake
    function cancelUnbonding() external nonReentrant whenNotPaused {
        SolverStake storage stake = stakes[msg.sender];

        if (stake.unbondingAmount == 0) revert NoUnbondingStake();

        bool wasInactive = !stake.isActive;

        stake.stakedAmount += stake.unbondingAmount;
        stake.unbondingAmount = 0;
        stake.unbondingStartTime = 0;
        stake.isActive = true;

        if (wasInactive) {
            activeSolverCount++;
        }

        emit SolverStakeDeposited(msg.sender, 0, stake.stakedAmount);
    }

    // ============ Chain Management ============

    function addChain(uint256 chainId) external nonReentrant whenNotPaused {
        if (!stakes[msg.sender].isActive) revert NotRegistered();

        uint256[] storage chains = solverChains[msg.sender];
        if (chains.length >= MAX_CHAINS) revert TooManyChains();

        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) revert ChainAlreadyAdded();
        }

        chains.push(chainId);
        emit ChainAdded(msg.sender, chainId);
    }

    function removeChain(uint256 chainId) external nonReentrant {
        uint256[] storage chains = solverChains[msg.sender];

        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) {
                chains[i] = chains[chains.length - 1];
                chains.pop();
                emit ChainRemoved(msg.sender, chainId);
                return;
            }
        }

        revert ChainNotFound();
    }

    // ============ Slashing ============

    /// @inheritdoc ISolverRegistry
    /// @custom:security CEI pattern: Update all state before external calls
    function slash(address solver, bytes32 orderId, uint256 amount, address victim) external override nonReentrant {
        if (!authorizedSlashers[msg.sender]) revert UnauthorizedSlasher();

        SolverStake storage stake = stakes[solver];
        if (!stake.isActive && stake.unbondingAmount == 0) revert NotRegistered();

        // Calculate slash amount
        uint256 totalAvailable = stake.stakedAmount + stake.unbondingAmount;
        uint256 slashAmount = (totalAvailable * SLASH_PERCENT) / 100;
        if (slashAmount > amount) slashAmount = amount;

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        // Deduct from stake
        if (stake.stakedAmount >= slashAmount) {
            stake.stakedAmount -= slashAmount;
        } else {
            uint256 fromUnbonding = slashAmount - stake.stakedAmount;
            stake.stakedAmount = 0;
            stake.unbondingAmount -= fromUnbonding;
        }

        stake.slashedAmount += slashAmount;
        totalSlashed += slashAmount;
        totalStaked -= slashAmount;

        // Deactivate if below minimum
        if (stake.stakedAmount < MIN_STAKE && stake.isActive) {
            stake.isActive = false;
            activeSolverCount--;
        }

        // Emit event before external calls
        emit SolverSlashed(solver, orderId, slashAmount);

        // INTERACTIONS: External calls last
        (bool success,) = victim.call{value: slashAmount}("");
        if (!success) revert WithdrawalFailed();
    }

    // ============ Fill Recording ============

    function recordFill(address solver, bytes32 orderId, bool success) external {
        if (!authorizedSlashers[msg.sender] && msg.sender != owner()) revert UnauthorizedSlasher();

        solverFillCount[solver]++;
        if (success) {
            solverSuccessCount[solver]++;
        }

        emit FillRecorded(solver, orderId, success);
    }

    // ============ Admin ============

    function setSlasher(address slasher, bool authorized) external onlyOwner {
        authorizedSlashers[slasher] = authorized;
        emit SlasherUpdated(slasher, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /// @inheritdoc ISolverRegistry
    function getSolver(address solver) external view override returns (SolverInfo memory) {
        SolverStake storage stake = stakes[solver];
        return SolverInfo({
            solver: solver,
            stakedAmount: stake.stakedAmount,
            slashedAmount: stake.slashedAmount,
            totalFills: solverFillCount[solver],
            successfulFills: solverSuccessCount[solver],
            supportedChains: solverChains[solver],
            isActive: stake.isActive,
            registeredAt: stake.registeredAt
        });
    }

    /// @inheritdoc ISolverRegistry
    function isSolverActive(address solver) external view override returns (bool) {
        return stakes[solver].isActive;
    }

    /// @inheritdoc ISolverRegistry
    function getSolverStake(address solver) external view override returns (uint256) {
        return stakes[solver].stakedAmount + stakes[solver].unbondingAmount;
    }

    function getSolverChains(address solver) external view returns (uint256[] memory) {
        return solverChains[solver];
    }

    function supportsChain(address solver, uint256 chainId) external view returns (bool) {
        uint256[] storage chains = solverChains[solver];
        for (uint256 i = 0; i < chains.length; i++) {
            if (chains[i] == chainId) return true;
        }
        return false;
    }

    function getStats() external view returns (uint256 _totalStaked, uint256 _totalSlashed, uint256 _activeSolvers) {
        return (totalStaked, totalSlashed, activeSolverCount);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
