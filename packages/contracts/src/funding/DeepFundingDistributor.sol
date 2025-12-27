// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDAORegistry} from "../governance/interfaces/IDAORegistry.sol";

/**
 * @title DeepFundingDistributor
 * @author Jeju Network
 * @notice Distributes network fees to contributors, dependencies, and treasuries
 * @dev Implements deep funding with configurable distribution ratios
 *
 * Key Features:
 * - Multi-tier fee distribution (treasury, contributors, dependencies, Jeju)
 * - Epoch-based accumulation and distribution
 * - Dependency weight decay (transitive deps get less)
 * - Public deliberation influence on weights
 * - Reserve pool for unregistered dependencies
 *
 * Fee Flow:
 * 1. Protocol components deposit fees
 * 2. Fees accumulate in per-DAO pools
 * 3. At epoch end, distribute based on weights
 * 4. Contributors/dependencies claim their share
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract DeepFundingDistributor is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct FeeDistributionConfig {
        uint256 treasuryBps; // % to DAO treasury
        uint256 contributorPoolBps; // % to contributor pool
        uint256 dependencyPoolBps; // % to dependency pool
        uint256 jejuBps; // % to Jeju network treasury
        uint256 burnBps; // % to burn
        uint256 reserveBps; // % reserved for unregistered deps
    }

    struct DAOPool {
        bytes32 daoId;
        address token; // Pool token
        uint256 totalAccumulated; // Total fees collected
        uint256 contributorPool; // Available for contributors
        uint256 dependencyPool; // Available for dependencies
        uint256 reservePool; // Reserved for unregistered deps
        uint256 lastDistributedEpoch;
        uint256 epochStartTime;
    }

    struct ContributorShare {
        bytes32 contributorId;
        uint256 weight; // Contribution weight (basis points)
        uint256 pendingRewards;
        uint256 claimedRewards;
        uint256 lastClaimEpoch;
    }

    struct DependencyShare {
        bytes32 depHash; // keccak256(registryType:packageName)
        bytes32 contributorId; // Registered maintainer (if any)
        uint256 weight; // Dependency weight
        uint256 transitiveDepth; // Depth in dependency tree
        uint256 usageCount; // How many repos use this
        uint256 pendingRewards;
        uint256 claimedRewards;
        bool isRegistered;
    }

    struct Epoch {
        uint256 epochId;
        bytes32 daoId;
        uint256 startTime;
        uint256 endTime;
        uint256 totalContributorRewards;
        uint256 totalDependencyRewards;
        uint256 totalDistributed;
        bool finalized;
    }

    struct WeightVote {
        address voter;
        bytes32 targetId; // Contributor or dependency ID
        int256 weightAdjustment; // Positive or negative adjustment
        string reason;
        uint256 reputation; // Voter reputation weight
        uint256 votedAt;
    }

    // ============ Constants ============

    uint256 public constant MAX_BPS = 10000;
    uint256 public constant DEFAULT_EPOCH_DURATION = 30 days;
    uint256 public constant DEPTH_DECAY_BPS = 2000; // 20% decay per level
    uint256 public constant MAX_DELIBERATION_INFLUENCE_BPS = 1000; // 10% max influence
    uint256 public constant MIN_WEIGHT_FOR_DISTRIBUTION = 10; // Minimum weight to receive funds

    // ============ State ============

    IDAORegistry public daoRegistry;
    address public jejuTreasury;
    address public contributorRegistry;

    mapping(bytes32 => FeeDistributionConfig) private _daoConfigs;
    mapping(bytes32 => DAOPool) private _daoPools;
    mapping(bytes32 => Epoch[]) private _epochs;
    mapping(bytes32 => uint256) private _currentEpoch;

    // Per-DAO, per-epoch contributor shares
    mapping(bytes32 => mapping(uint256 => mapping(bytes32 => ContributorShare))) private _contributorShares;
    mapping(bytes32 => mapping(uint256 => bytes32[])) private _epochContributors;

    // Per-DAO dependency shares
    mapping(bytes32 => mapping(bytes32 => DependencyShare)) private _dependencyShares;
    mapping(bytes32 => bytes32[]) private _daoDependencies;

    // Deliberation votes
    mapping(bytes32 => mapping(uint256 => WeightVote[])) private _epochVotes;

    // Deliberation adjustments: daoId => epochId => targetId => adjustment
    mapping(bytes32 => mapping(uint256 => mapping(bytes32 => int256))) private _deliberationAdjustments;

    // Authorized fee depositors
    mapping(address => bool) public authorizedDepositors;

    FeeDistributionConfig public defaultConfig;

    // ============ Events ============

    event FeesDeposited(bytes32 indexed daoId, address indexed depositor, uint256 amount, string source);

    event EpochCreated(bytes32 indexed daoId, uint256 indexed epochId, uint256 startTime, uint256 endTime);

    event EpochFinalized(bytes32 indexed daoId, uint256 indexed epochId, uint256 totalDistributed);

    event ContributorWeightSet(bytes32 indexed daoId, bytes32 indexed contributorId, uint256 weight);

    event DependencyRegistered(bytes32 indexed daoId, bytes32 indexed depHash, string packageName, uint256 weight);

    event DependencyWeightUpdated(bytes32 indexed daoId, bytes32 indexed depHash, uint256 newWeight);

    event RewardsClaimed(bytes32 indexed contributorId, bytes32 indexed daoId, uint256 amount);

    event WeightVoteCast(
        bytes32 indexed daoId, uint256 indexed epochId, address indexed voter, bytes32 targetId, int256 adjustment
    );

    event ConfigUpdated(bytes32 indexed daoId);
    event DepositorAuthorized(address indexed depositor, bool authorized);

    // ============ Errors ============

    error NotAuthorizedDepositor();
    error InvalidConfig();
    error EpochNotActive();
    error EpochAlreadyFinalized();
    error NoPendingRewards();
    error TransferFailed();
    error DependencyNotRegistered();
    error ContributorNotFound();
    error InvalidWeight();
    error EpochNotFinalized();
    error NotDAOAdmin();

    // ============ Modifiers ============

    modifier onlyAuthorizedDepositor() {
        if (!authorizedDepositors[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedDepositor();
        }
        _;
    }

    modifier onlyDAOAdmin(bytes32 daoId) {
        if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotDAOAdmin();
        _;
    }

    // ============ Constructor ============

    constructor(address _daoRegistry, address _jejuTreasury, address _contributorRegistry, address _owner)
        Ownable(_owner)
    {
        daoRegistry = IDAORegistry(_daoRegistry);
        jejuTreasury = _jejuTreasury;
        contributorRegistry = _contributorRegistry;

        // Default config: 30% treasury, 40% contributors, 20% deps, 5% Jeju, 5% reserve
        defaultConfig = FeeDistributionConfig({
            treasuryBps: 3000,
            contributorPoolBps: 4000,
            dependencyPoolBps: 2000,
            jejuBps: 500,
            burnBps: 0,
            reserveBps: 500
        });
    }

    // ============ Fee Collection ============

    /**
     * @notice Deposit fees from protocol components
     * @param daoId DAO to credit fees to
     * @param source Description of fee source (e.g., "rpc-fees", "compute-fees")
     */
    function depositFees(bytes32 daoId, string calldata source)
        external
        payable
        onlyAuthorizedDepositor
        whenNotPaused
    {
        if (msg.value == 0) return;

        DAOPool storage pool = _daoPools[daoId];
        FeeDistributionConfig memory config = _getConfig(daoId);

        // Initialize pool if needed
        if (pool.daoId == bytes32(0)) {
            pool.daoId = daoId;
            pool.token = address(0); // Native token
            pool.epochStartTime = block.timestamp;
            _createEpoch(daoId);
        }

        pool.totalAccumulated += msg.value;

        // Distribute to sub-pools
        uint256 toTreasury = (msg.value * config.treasuryBps) / MAX_BPS;
        uint256 toContributors = (msg.value * config.contributorPoolBps) / MAX_BPS;
        uint256 toDeps = (msg.value * config.dependencyPoolBps) / MAX_BPS;
        uint256 toJeju = (msg.value * config.jejuBps) / MAX_BPS;
        uint256 toReserve = (msg.value * config.reserveBps) / MAX_BPS;

        pool.contributorPool += toContributors;
        pool.dependencyPool += toDeps;
        pool.reservePool += toReserve;

        // Transfer to treasuries immediately
        IDAORegistry.DAO memory dao = daoRegistry.getDAO(daoId);
        if (toTreasury > 0 && dao.treasury != address(0)) {
            (bool success,) = dao.treasury.call{value: toTreasury}("");
            if (!success) revert TransferFailed();
        }

        if (toJeju > 0 && jejuTreasury != address(0)) {
            (bool success,) = jejuTreasury.call{value: toJeju}("");
            if (!success) revert TransferFailed();
        }

        emit FeesDeposited(daoId, msg.sender, msg.value, source);
    }

    /**
     * @notice Deposit ERC20 fees
     */
    function depositTokenFees(bytes32 daoId, address token, uint256 amount, string calldata source)
        external
        onlyAuthorizedDepositor
        whenNotPaused
    {
        if (amount == 0) return;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        DAOPool storage pool = _daoPools[daoId];
        FeeDistributionConfig memory config = _getConfig(daoId);

        if (pool.daoId == bytes32(0)) {
            pool.daoId = daoId;
            pool.token = token;
            pool.epochStartTime = block.timestamp;
            _createEpoch(daoId);
        }

        pool.totalAccumulated += amount;

        uint256 toTreasury = (amount * config.treasuryBps) / MAX_BPS;
        uint256 toContributors = (amount * config.contributorPoolBps) / MAX_BPS;
        uint256 toDeps = (amount * config.dependencyPoolBps) / MAX_BPS;
        uint256 toJeju = (amount * config.jejuBps) / MAX_BPS;
        uint256 toReserve = (amount * config.reserveBps) / MAX_BPS;

        pool.contributorPool += toContributors;
        pool.dependencyPool += toDeps;
        pool.reservePool += toReserve;

        IDAORegistry.DAO memory dao = daoRegistry.getDAO(daoId);
        if (toTreasury > 0 && dao.treasury != address(0)) {
            IERC20(token).safeTransfer(dao.treasury, toTreasury);
        }

        if (toJeju > 0 && jejuTreasury != address(0)) {
            IERC20(token).safeTransfer(jejuTreasury, toJeju);
        }

        emit FeesDeposited(daoId, msg.sender, amount, source);
    }

    // ============ Weight Management ============

    /**
     * @notice Set contributor weight for current epoch
     */
    function setContributorWeight(bytes32 daoId, bytes32 contributorId, uint256 weight) external onlyDAOAdmin(daoId) {
        if (weight > MAX_BPS) revert InvalidWeight();

        uint256 epochId = _currentEpoch[daoId];
        ContributorShare storage share = _contributorShares[daoId][epochId][contributorId];

        if (share.contributorId == bytes32(0)) {
            share.contributorId = contributorId;
            _epochContributors[daoId][epochId].push(contributorId);
        }

        share.weight = weight;

        emit ContributorWeightSet(daoId, contributorId, weight);
    }

    /**
     * @notice Register a dependency with weight
     */
    function registerDependency(
        bytes32 daoId,
        string calldata packageName,
        string calldata registryType,
        bytes32 maintainerContributorId,
        uint256 weight,
        uint256 transitiveDepth,
        uint256 usageCount
    ) external onlyDAOAdmin(daoId) {
        bytes32 depHash = keccak256(abi.encodePacked(registryType, ":", packageName));

        // Apply depth decay
        uint256 adjustedWeight = _applyDepthDecay(weight, transitiveDepth);

        DependencyShare storage dep = _dependencyShares[daoId][depHash];

        if (dep.depHash == bytes32(0)) {
            _daoDependencies[daoId].push(depHash);
        }

        dep.depHash = depHash;
        dep.contributorId = maintainerContributorId;
        dep.weight = adjustedWeight;
        dep.transitiveDepth = transitiveDepth;
        dep.usageCount = usageCount;
        dep.isRegistered = maintainerContributorId != bytes32(0);

        emit DependencyRegistered(daoId, depHash, packageName, adjustedWeight);
    }

    /**
     * @notice Apply depth decay to dependency weight
     */
    function _applyDepthDecay(uint256 weight, uint256 depth) internal pure returns (uint256) {
        if (depth == 0) return weight;

        uint256 decayFactor = MAX_BPS;
        for (uint256 i = 0; i < depth; i++) {
            decayFactor = (decayFactor * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS;
        }

        return (weight * decayFactor) / MAX_BPS;
    }

    /**
     * @notice Cast a vote to adjust weights (public deliberation)
     */
    function voteOnWeight(
        bytes32 daoId,
        bytes32 targetId,
        int256 adjustment,
        string calldata reason,
        uint256 reputation
    ) external {
        uint256 epochId = _currentEpoch[daoId];

        _epochVotes[daoId][epochId].push(
            WeightVote({
                voter: msg.sender,
                targetId: targetId,
                weightAdjustment: adjustment,
                reason: reason,
                reputation: reputation,
                votedAt: block.timestamp
            })
        );

        emit WeightVoteCast(daoId, epochId, msg.sender, targetId, adjustment);
    }

    // ============ Epoch Management ============

    function _createEpoch(bytes32 daoId) internal {
        uint256 epochId = _currentEpoch[daoId] + 1;

        _epochs[daoId].push(
            Epoch({
                epochId: epochId,
                daoId: daoId,
                startTime: block.timestamp,
                endTime: block.timestamp + DEFAULT_EPOCH_DURATION,
                totalContributorRewards: 0,
                totalDependencyRewards: 0,
                totalDistributed: 0,
                finalized: false
            })
        );

        _currentEpoch[daoId] = epochId;
        _daoPools[daoId].lastDistributedEpoch = epochId;

        emit EpochCreated(daoId, epochId, block.timestamp, block.timestamp + DEFAULT_EPOCH_DURATION);
    }

    /**
     * @notice Finalize epoch and calculate distributions
     */
    function finalizeEpoch(bytes32 daoId) external nonReentrant onlyDAOAdmin(daoId) {
        uint256 epochId = _currentEpoch[daoId];
        Epoch storage epoch = _epochs[daoId][epochId - 1];

        if (epoch.finalized) revert EpochAlreadyFinalized();
        if (block.timestamp < epoch.endTime) revert EpochNotActive();

        DAOPool storage pool = _daoPools[daoId];

        // Apply deliberation adjustments
        _applyDeliberationAdjustments(daoId, epochId);

        // Calculate and assign contributor rewards
        uint256 contributorRewards = _distributeContributorRewards(daoId, epochId, pool.contributorPool);
        epoch.totalContributorRewards = contributorRewards;

        // Calculate and assign dependency rewards
        uint256 depRewards = _distributeDependencyRewards(daoId, pool.dependencyPool);
        epoch.totalDependencyRewards = depRewards;

        epoch.totalDistributed = contributorRewards + depRewards;
        epoch.finalized = true;

        // Reset pools
        pool.contributorPool = 0;
        pool.dependencyPool = 0;

        // Create next epoch
        _createEpoch(daoId);

        emit EpochFinalized(daoId, epochId, epoch.totalDistributed);
    }

    function _applyDeliberationAdjustments(bytes32 daoId, uint256 epochId) internal {
        WeightVote[] storage votes = _epochVotes[daoId][epochId];

        // Aggregate votes by target using state mapping
        mapping(bytes32 => int256) storage adjustments = _deliberationAdjustments[daoId][epochId];

        for (uint256 i = 0; i < votes.length; i++) {
            WeightVote memory vote = votes[i];
            // Weight by reputation
            int256 weightedAdjustment = (vote.weightAdjustment * int256(vote.reputation)) / 100;
            adjustments[vote.targetId] += weightedAdjustment;
        }

        // Apply adjustments (capped at MAX_DELIBERATION_INFLUENCE_BPS)
        bytes32[] memory contributors = _epochContributors[daoId][epochId];
        for (uint256 i = 0; i < contributors.length; i++) {
            bytes32 contributorId = contributors[i];
            int256 adj = adjustments[contributorId];
            if (adj != 0) {
                ContributorShare storage share = _contributorShares[daoId][epochId][contributorId];
                int256 maxAdj = int256((share.weight * MAX_DELIBERATION_INFLUENCE_BPS) / MAX_BPS);
                adj = adj > maxAdj ? maxAdj : (adj < -maxAdj ? -maxAdj : adj);
                share.weight = uint256(int256(share.weight) + adj);
            }
        }
    }

    function _distributeContributorRewards(bytes32 daoId, uint256 epochId, uint256 poolAmount)
        internal
        returns (uint256 distributed)
    {
        bytes32[] memory contributors = _epochContributors[daoId][epochId];
        if (contributors.length == 0) return 0;

        // Calculate total weight
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < contributors.length; i++) {
            uint256 w = _contributorShares[daoId][epochId][contributors[i]].weight;
            if (w >= MIN_WEIGHT_FOR_DISTRIBUTION) {
                totalWeight += w;
            }
        }

        if (totalWeight == 0) return 0;

        // Distribute proportionally
        for (uint256 i = 0; i < contributors.length; i++) {
            ContributorShare storage share = _contributorShares[daoId][epochId][contributors[i]];
            if (share.weight >= MIN_WEIGHT_FOR_DISTRIBUTION) {
                uint256 reward = (poolAmount * share.weight) / totalWeight;
                share.pendingRewards += reward;
                distributed += reward;
            }
        }

        return distributed;
    }

    function _distributeDependencyRewards(bytes32 daoId, uint256 poolAmount) internal returns (uint256 distributed) {
        bytes32[] memory deps = _daoDependencies[daoId];
        if (deps.length == 0) return 0;

        // Calculate total weight of registered deps
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < deps.length; i++) {
            DependencyShare storage dep = _dependencyShares[daoId][deps[i]];
            if (dep.isRegistered && dep.weight >= MIN_WEIGHT_FOR_DISTRIBUTION) {
                totalWeight += dep.weight;
            }
        }

        if (totalWeight == 0) return 0;

        // Distribute proportionally
        for (uint256 i = 0; i < deps.length; i++) {
            DependencyShare storage dep = _dependencyShares[daoId][deps[i]];
            if (dep.isRegistered && dep.weight >= MIN_WEIGHT_FOR_DISTRIBUTION) {
                uint256 reward = (poolAmount * dep.weight) / totalWeight;
                dep.pendingRewards += reward;
                distributed += reward;
            }
        }

        return distributed;
    }

    // ============ Claiming ============

    /**
     * @notice Claim contributor rewards
     */
    function claimContributorRewards(bytes32 daoId, bytes32 contributorId, uint256[] calldata epochs, address recipient)
        external
        nonReentrant
    {
        DAOPool memory pool = _daoPools[daoId];
        uint256 totalRewards = 0;

        for (uint256 i = 0; i < epochs.length; i++) {
            Epoch storage epoch = _epochs[daoId][epochs[i] - 1];
            if (!epoch.finalized) revert EpochNotFinalized();

            ContributorShare storage share = _contributorShares[daoId][epochs[i]][contributorId];
            if (share.pendingRewards > 0) {
                totalRewards += share.pendingRewards;
                share.claimedRewards += share.pendingRewards;
                share.pendingRewards = 0;
                share.lastClaimEpoch = epochs[i];
            }
        }

        if (totalRewards == 0) revert NoPendingRewards();

        if (pool.token == address(0)) {
            (bool success,) = recipient.call{value: totalRewards}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(pool.token).safeTransfer(recipient, totalRewards);
        }

        emit RewardsClaimed(contributorId, daoId, totalRewards);
    }

    /**
     * @notice Claim dependency rewards (by registered maintainer)
     */
    function claimDependencyRewards(bytes32 daoId, bytes32 depHash, address recipient) external nonReentrant {
        DependencyShare storage dep = _dependencyShares[daoId][depHash];
        if (!dep.isRegistered) revert DependencyNotRegistered();
        if (dep.pendingRewards == 0) revert NoPendingRewards();

        DAOPool memory pool = _daoPools[daoId];
        uint256 amount = dep.pendingRewards;
        dep.claimedRewards += amount;
        dep.pendingRewards = 0;

        if (pool.token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(pool.token).safeTransfer(recipient, amount);
        }

        emit RewardsClaimed(dep.contributorId, daoId, amount);
    }

    // ============ Configuration ============

    function setDAOConfig(bytes32 daoId, FeeDistributionConfig calldata config) external onlyDAOAdmin(daoId) {
        uint256 total = config.treasuryBps + config.contributorPoolBps + config.dependencyPoolBps + config.jejuBps
            + config.burnBps + config.reserveBps;
        if (total != MAX_BPS) revert InvalidConfig();

        _daoConfigs[daoId] = config;
        emit ConfigUpdated(daoId);
    }

    function _getConfig(bytes32 daoId) internal view returns (FeeDistributionConfig memory) {
        FeeDistributionConfig memory config = _daoConfigs[daoId];
        if (config.treasuryBps == 0 && config.contributorPoolBps == 0) {
            return defaultConfig;
        }
        return config;
    }

    function setDefaultConfig(FeeDistributionConfig calldata config) external onlyOwner {
        uint256 total = config.treasuryBps + config.contributorPoolBps + config.dependencyPoolBps + config.jejuBps
            + config.burnBps + config.reserveBps;
        if (total != MAX_BPS) revert InvalidConfig();

        defaultConfig = config;
    }

    // ============ View Functions ============

    function getDAOPool(bytes32 daoId) external view returns (DAOPool memory) {
        return _daoPools[daoId];
    }

    function getCurrentEpoch(bytes32 daoId) external view returns (Epoch memory) {
        uint256 epochId = _currentEpoch[daoId];
        if (epochId == 0) return Epoch(0, bytes32(0), 0, 0, 0, 0, 0, false);
        return _epochs[daoId][epochId - 1];
    }

    function getEpoch(bytes32 daoId, uint256 epochId) external view returns (Epoch memory) {
        return _epochs[daoId][epochId - 1];
    }

    function getContributorShare(bytes32 daoId, uint256 epochId, bytes32 contributorId)
        external
        view
        returns (ContributorShare memory)
    {
        return _contributorShares[daoId][epochId][contributorId];
    }

    function getDependencyShare(bytes32 daoId, bytes32 depHash) external view returns (DependencyShare memory) {
        return _dependencyShares[daoId][depHash];
    }

    function getDAOConfig(bytes32 daoId) external view returns (FeeDistributionConfig memory) {
        return _getConfig(daoId);
    }

    function getEpochVotes(bytes32 daoId, uint256 epochId) external view returns (WeightVote[] memory) {
        return _epochVotes[daoId][epochId];
    }

    function getPendingContributorRewards(bytes32 daoId, bytes32 contributorId) external view returns (uint256 total) {
        uint256 currentEpochId = _currentEpoch[daoId];
        for (uint256 i = 1; i <= currentEpochId; i++) {
            total += _contributorShares[daoId][i][contributorId].pendingRewards;
        }
    }

    // ============ Admin Functions ============

    function authorizeDepositor(address depositor, bool authorized) external onlyOwner {
        authorizedDepositors[depositor] = authorized;
        emit DepositorAuthorized(depositor, authorized);
    }

    function setJejuTreasury(address _jejuTreasury) external onlyOwner {
        jejuTreasury = _jejuTreasury;
    }

    function setDAORegistry(address _daoRegistry) external onlyOwner {
        daoRegistry = IDAORegistry(_daoRegistry);
    }

    function setContributorRegistry(address _contributorRegistry) external onlyOwner {
        contributorRegistry = _contributorRegistry;
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

    receive() external payable {}
}
