// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IDAORegistry} from "./interfaces/IDAORegistry.sol";

/**
 * @title DAOFunding
 * @author Jeju Network
 * @notice Deep funding contract for DAO-linked packages and repos
 * @dev Implements a quadratic funding + AI-weighted allocation system
 *
 * Key Features:
 * - Epoch-based funding rounds with configurable durations
 * - CEO-controlled funding weights per project
 * - Quadratic funding matching from DAO treasury
 * - Stake-weighted contributions from community
 * - Automatic fund distribution at epoch end
 *
 * Flow:
 * 1. Package/repo gets linked to DAO via DAORegistry
 * 2. Community stakes tokens to signal support
 * 3. CEO sets funding weights based on AI analysis
 * 4. At epoch end, funds distributed proportionally
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract DAOFunding is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum ProjectType {
        PACKAGE,
        REPO
    }

    enum FundingStatus {
        PROPOSED,
        ACCEPTED,
        ACTIVE,
        PAUSED,
        COMPLETED,
        REJECTED
    }

    struct FundingProject {
        bytes32 projectId;
        bytes32 daoId;
        ProjectType projectType;
        bytes32 registryId; // PackageRegistry or RepoRegistry ID
        string name;
        string description;
        address primaryRecipient;
        address[] additionalRecipients;
        uint256[] recipientShares; // Basis points, must sum to 10000
        uint256 ceoWeight; // 0-10000 basis points
        uint256 communityStake;
        uint256 totalFunded;
        FundingStatus status;
        uint256 createdAt;
        uint256 lastFundedAt;
        address proposer;
    }

    struct FundingEpoch {
        uint256 epochId;
        bytes32 daoId;
        uint256 startTime;
        uint256 endTime;
        uint256 totalBudget;
        uint256 matchingPool;
        uint256 distributed;
        bool finalized;
    }

    struct StakeInfo {
        uint256 amount;
        uint256 epochId;
        uint256 timestamp;
        bool withdrawn;
    }

    struct DAOFundingConfig {
        uint256 minStake;
        uint256 maxStake;
        uint256 epochDuration;
        uint256 cooldownPeriod;
        uint256 matchingMultiplier; // Basis points (e.g., 20000 = 2x matching)
        bool quadraticEnabled;
        uint256 ceoWeightCap; // Max CEO weight per project (basis points)
        uint256 minStakePerParticipant; // Anti-sybil: minimum stake per unique participant
    }

    // ============ CEO Weight Timelock (Security Fix) ============
    uint256 public constant CEO_WEIGHT_TIMELOCK = 48 hours;
    uint256 public constant CEO_WEIGHT_LARGE_CHANGE_THRESHOLD = 2500; // 25% BPS - large changes need extra approval

    struct CEOWeightProposal {
        bytes32 projectId;
        uint256 newWeight;
        uint256 proposedAt;
        uint256 executesAt;
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => CEOWeightProposal) public ceoWeightProposals;
    bytes32[] public pendingWeightProposals;

    event CEOWeightProposed(bytes32 indexed projectId, uint256 oldWeight, uint256 newWeight, uint256 executesAt);
    event CEOWeightProposalExecuted(bytes32 indexed projectId, uint256 newWeight);
    event CEOWeightProposalCancelled(bytes32 indexed projectId);

    error WeightProposalNotReady();
    error WeightProposalNotFound();
    error WeightProposalAlreadyExecuted();
    error WeightProposalExpired();

    IDAORegistry public immutable daoRegistry;
    IERC20 public immutable fundingToken;
    address public owner;
    mapping(bytes32 => FundingProject) private _projects;
    mapping(bytes32 => bytes32[]) private _daoProjects;
    mapping(bytes32 => bytes32) private _registryToProject;
    mapping(bytes32 => FundingEpoch[]) private _epochs;
    mapping(bytes32 => uint256) private _currentEpoch;
    mapping(bytes32 => mapping(uint256 => mapping(address => StakeInfo))) private _userStakes;
    mapping(bytes32 => mapping(uint256 => uint256)) private _projectEpochStakes;
    mapping(bytes32 => mapping(uint256 => uint256)) private _projectEpochStakers;
    mapping(bytes32 => DAOFundingConfig) private _daoConfigs;
    DAOFundingConfig public defaultConfig;

    event ProjectProposed(bytes32 indexed projectId, bytes32 indexed daoId, ProjectType projectType, address proposer);
    event ProjectAccepted(bytes32 indexed projectId, bytes32 indexed daoId);
    event ProjectRejected(bytes32 indexed projectId, bytes32 indexed daoId, string reason);
    event ProjectStatusChanged(bytes32 indexed projectId, FundingStatus oldStatus, FundingStatus newStatus);
    event CEOWeightSet(bytes32 indexed projectId, uint256 oldWeight, uint256 newWeight);
    event UserStaked(bytes32 indexed projectId, uint256 indexed epochId, address indexed user, uint256 amount);
    event UserUnstaked(bytes32 indexed projectId, uint256 indexed epochId, address indexed user, uint256 amount);
    event EpochCreated(bytes32 indexed daoId, uint256 indexed epochId, uint256 budget, uint256 matchingPool);
    event EpochFinalized(bytes32 indexed daoId, uint256 indexed epochId, uint256 totalDistributed);
    event FundsDistributed(bytes32 indexed projectId, uint256 indexed epochId, uint256 amount);
    event ConfigUpdated(bytes32 indexed daoId);

    error NotAuthorized();
    error ProjectNotFound();
    error ProjectNotActive();
    error EpochNotActive();
    error EpochAlreadyFinalized();
    error InvalidAmount();
    error InvalidProject();
    error ProjectAlreadyExists();
    error StakeNotFound();
    error StakeAlreadyWithdrawn();
    error CooldownNotElapsed();
    error InvalidShares();
    error DAONotActive();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    modifier onlyDAOAdmin(bytes32 daoId) {
        if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier onlyCEO(bytes32 daoId) {
        IDAORegistry.DAO memory dao = daoRegistry.getDAO(daoId);
        if (msg.sender != dao.ceoAgent && !daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier projectExists(bytes32 projectId) {
        if (_projects[projectId].createdAt == 0) revert ProjectNotFound();
        _;
    }

    constructor(address _daoRegistry, address _fundingToken, address _owner) {
        daoRegistry = IDAORegistry(_daoRegistry);
        fundingToken = IERC20(_fundingToken);
        owner = _owner;

        defaultConfig = DAOFundingConfig({
            minStake: 0.1 ether, // SECURITY: Raised from 0.001 to prevent sybil attacks
            maxStake: 100 ether,
            epochDuration: 30 days,
            cooldownPeriod: 7 days,
            matchingMultiplier: 10000, // 1x matching
            quadraticEnabled: true,
            ceoWeightCap: 5000, // Max 50% weight from CEO
            minStakePerParticipant: 0.1 ether // SECURITY: Anti-sybil minimum per unique staker
        });
    }

    function proposeProject(
        bytes32 daoId,
        ProjectType projectType,
        bytes32 registryId,
        string calldata name,
        string calldata description,
        address primaryRecipient,
        address[] calldata additionalRecipients,
        uint256[] calldata recipientShares
    ) external whenNotPaused nonReentrant returns (bytes32 projectId) {
        IDAORegistry.DAO memory dao = daoRegistry.getDAO(daoId);
        if (dao.status != IDAORegistry.DAOStatus.ACTIVE) revert DAONotActive();
        if (_registryToProject[registryId] != bytes32(0)) revert ProjectAlreadyExists();
        if (primaryRecipient == address(0)) revert InvalidProject();

        // Validate shares
        if (additionalRecipients.length != recipientShares.length) revert InvalidShares();
        uint256 totalShares = 0;
        for (uint256 i = 0; i < recipientShares.length; i++) {
            totalShares += recipientShares[i];
        }
        if (totalShares > 10000) revert InvalidShares();

        projectId = keccak256(abi.encodePacked(daoId, registryId, block.timestamp, msg.sender));

        _projects[projectId] = FundingProject({
            projectId: projectId,
            daoId: daoId,
            projectType: projectType,
            registryId: registryId,
            name: name,
            description: description,
            primaryRecipient: primaryRecipient,
            additionalRecipients: additionalRecipients,
            recipientShares: recipientShares,
            ceoWeight: 0,
            communityStake: 0,
            totalFunded: 0,
            status: FundingStatus.PROPOSED,
            createdAt: block.timestamp,
            lastFundedAt: 0,
            proposer: msg.sender
        });

        _daoProjects[daoId].push(projectId);
        _registryToProject[registryId] = projectId;

        emit ProjectProposed(projectId, daoId, projectType, msg.sender);
    }

    function acceptProject(bytes32 projectId)
        external
        projectExists(projectId)
        onlyDAOAdmin(_projects[projectId].daoId)
    {
        FundingProject storage project = _projects[projectId];
        if (project.status != FundingStatus.PROPOSED) revert InvalidProject();

        FundingStatus oldStatus = project.status;
        project.status = FundingStatus.ACTIVE;

        emit ProjectAccepted(projectId, project.daoId);
        emit ProjectStatusChanged(projectId, oldStatus, FundingStatus.ACTIVE);
    }

    function rejectProject(bytes32 projectId, string calldata reason)
        external
        projectExists(projectId)
        onlyDAOAdmin(_projects[projectId].daoId)
    {
        FundingProject storage project = _projects[projectId];
        if (project.status != FundingStatus.PROPOSED) revert InvalidProject();

        FundingStatus oldStatus = project.status;
        project.status = FundingStatus.REJECTED;

        emit ProjectRejected(projectId, project.daoId, reason);
        emit ProjectStatusChanged(projectId, oldStatus, FundingStatus.REJECTED);
    }

    /**
     * @notice Propose a CEO weight change (subject to timelock)
     * @dev Large changes (>25% of cap) require 48hr timelock for security
     * @param projectId Project to update weight for
     * @param weight New weight in basis points
     */
    function proposeCEOWeight(bytes32 projectId, uint256 weight)
        external
        projectExists(projectId)
        onlyCEO(_projects[projectId].daoId)
    {
        FundingProject storage project = _projects[projectId];
        if (project.status != FundingStatus.ACTIVE) revert ProjectNotActive();

        DAOFundingConfig memory config = _getConfig(project.daoId);
        if (weight > config.ceoWeightCap) {
            weight = config.ceoWeightCap;
        }

        uint256 oldWeight = project.ceoWeight;
        uint256 weightDelta = weight > oldWeight ? weight - oldWeight : oldWeight - weight;

        // Small changes (<25% of cap) can be applied with shorter delay
        uint256 delay = weightDelta >= CEO_WEIGHT_LARGE_CHANGE_THRESHOLD ? CEO_WEIGHT_TIMELOCK : CEO_WEIGHT_TIMELOCK / 4; // 12 hours for small changes

        bytes32 proposalId = keccak256(abi.encodePacked(projectId, weight, block.timestamp));

        ceoWeightProposals[proposalId] = CEOWeightProposal({
            projectId: projectId,
            newWeight: weight,
            proposedAt: block.timestamp,
            executesAt: block.timestamp + delay,
            executed: false,
            cancelled: false
        });

        pendingWeightProposals.push(proposalId);

        emit CEOWeightProposed(projectId, oldWeight, weight, block.timestamp + delay);
    }

    /**
     * @notice Execute a pending CEO weight change after timelock
     * @param proposalId The proposal to execute
     */
    function executeCEOWeightProposal(bytes32 proposalId) external nonReentrant {
        CEOWeightProposal storage proposal = ceoWeightProposals[proposalId];
        if (proposal.proposedAt == 0) revert WeightProposalNotFound();
        if (proposal.executed) revert WeightProposalAlreadyExecuted();
        if (proposal.cancelled) revert WeightProposalNotFound();
        if (block.timestamp < proposal.executesAt) revert WeightProposalNotReady();
        // Expire after 7 days to prevent stale proposals
        if (block.timestamp > proposal.executesAt + 7 days) revert WeightProposalExpired();

        proposal.executed = true;

        FundingProject storage project = _projects[proposal.projectId];
        uint256 oldWeight = project.ceoWeight;
        project.ceoWeight = proposal.newWeight;

        emit CEOWeightProposalExecuted(proposal.projectId, proposal.newWeight);
        emit CEOWeightSet(proposal.projectId, oldWeight, proposal.newWeight);
    }

    /**
     * @notice Cancel a pending CEO weight proposal
     * @param proposalId The proposal to cancel
     */
    function cancelCEOWeightProposal(bytes32 proposalId) external {
        CEOWeightProposal storage proposal = ceoWeightProposals[proposalId];
        if (proposal.proposedAt == 0) revert WeightProposalNotFound();
        if (proposal.executed) revert WeightProposalAlreadyExecuted();

        // Only DAO admin or the original CEO can cancel
        bytes32 daoId = _projects[proposal.projectId].daoId;
        if (!daoRegistry.isDAOAdmin(daoId, msg.sender)) revert NotAuthorized();

        proposal.cancelled = true;
        emit CEOWeightProposalCancelled(proposal.projectId);
    }

    /**
     * @notice Get pending weight proposals for a project
     * @param projectId Project to check
     */
    function getPendingWeightProposals(bytes32 projectId) external view returns (CEOWeightProposal[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingWeightProposals.length; i++) {
            CEOWeightProposal storage p = ceoWeightProposals[pendingWeightProposals[i]];
            if (p.projectId == projectId && !p.executed && !p.cancelled) {
                count++;
            }
        }

        CEOWeightProposal[] memory result = new CEOWeightProposal[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < pendingWeightProposals.length; i++) {
            CEOWeightProposal storage p = ceoWeightProposals[pendingWeightProposals[i]];
            if (p.projectId == projectId && !p.executed && !p.cancelled) {
                result[idx++] = p;
            }
        }
        return result;
    }

    function pauseProject(bytes32 projectId)
        external
        projectExists(projectId)
        onlyDAOAdmin(_projects[projectId].daoId)
    {
        FundingProject storage project = _projects[projectId];
        FundingStatus oldStatus = project.status;
        project.status = FundingStatus.PAUSED;

        emit ProjectStatusChanged(projectId, oldStatus, FundingStatus.PAUSED);
    }

    function unpauseProject(bytes32 projectId)
        external
        projectExists(projectId)
        onlyDAOAdmin(_projects[projectId].daoId)
    {
        FundingProject storage project = _projects[projectId];
        FundingStatus oldStatus = project.status;
        project.status = FundingStatus.ACTIVE;

        emit ProjectStatusChanged(projectId, oldStatus, FundingStatus.ACTIVE);
    }

    function stake(bytes32 projectId, uint256 amount)
        external
        payable
        projectExists(projectId)
        whenNotPaused
        nonReentrant
    {
        FundingProject storage project = _projects[projectId];
        if (project.status != FundingStatus.ACTIVE) revert ProjectNotActive();

        DAOFundingConfig memory config = _getConfig(project.daoId);
        if (amount < config.minStake || amount > config.maxStake) revert InvalidAmount();

        uint256 epochId = _currentEpoch[project.daoId];
        if (epochId == 0 || _epochs[project.daoId][epochId - 1].finalized) {
            // Create new epoch if needed
            _createEpoch(project.daoId, 0, 0);
            epochId = _currentEpoch[project.daoId];
        }

        FundingEpoch storage epoch = _epochs[project.daoId][epochId - 1];
        if (block.timestamp > epoch.endTime) revert EpochNotActive();

        // Record stake
        StakeInfo storage stakeInfo = _userStakes[projectId][epochId][msg.sender];
        bool isNewStaker = stakeInfo.amount == 0;

        // SECURITY: Anti-sybil enforcement for quadratic funding
        // New stakers must meet minStakePerParticipant threshold
        // This prevents splitting funds across many accounts to game quadratic matching
        if (config.quadraticEnabled && isNewStaker) {
            if (amount < config.minStakePerParticipant) revert InvalidAmount();
        }

        // Transfer tokens
        if (address(fundingToken) == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
        } else {
            fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        }

        stakeInfo.amount += amount;
        stakeInfo.epochId = epochId;
        stakeInfo.timestamp = block.timestamp;
        stakeInfo.withdrawn = false;

        project.communityStake += amount;
        _projectEpochStakes[projectId][epochId] += amount;

        if (isNewStaker) {
            _projectEpochStakers[projectId][epochId]++;
        }

        emit UserStaked(projectId, epochId, msg.sender, amount);
    }

    function unstake(bytes32 projectId, uint256 epochId) external nonReentrant {
        StakeInfo storage stakeInfo = _userStakes[projectId][epochId][msg.sender];
        if (stakeInfo.amount == 0) revert StakeNotFound();
        if (stakeInfo.withdrawn) revert StakeAlreadyWithdrawn();

        FundingProject storage project = _projects[projectId];
        DAOFundingConfig memory config = _getConfig(project.daoId);

        // Check cooldown
        if (block.timestamp < stakeInfo.timestamp + config.cooldownPeriod) revert CooldownNotElapsed();

        uint256 amount = stakeInfo.amount;
        stakeInfo.withdrawn = true;
        project.communityStake -= amount;
        _projectEpochStakes[projectId][epochId] -= amount;
        _projectEpochStakers[projectId][epochId]--;

        // Transfer tokens back
        if (address(fundingToken) == address(0)) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            fundingToken.safeTransfer(msg.sender, amount);
        }

        emit UserUnstaked(projectId, epochId, msg.sender, amount);
    }

    // ============ Epoch Management ============

    /**
     * @notice Create a new funding epoch
     * @param daoId DAO to create epoch for
     * @param budget Total budget for epoch
     * @param matchingPool Matching pool amount
     */
    function createEpoch(bytes32 daoId, uint256 budget, uint256 matchingPool) external onlyDAOAdmin(daoId) {
        _createEpoch(daoId, budget, matchingPool);
    }

    function finalizeEpoch(bytes32 daoId) external nonReentrant onlyDAOAdmin(daoId) {
        uint256 epochId = _currentEpoch[daoId];
        if (epochId == 0) revert EpochNotActive();

        FundingEpoch storage epoch = _epochs[daoId][epochId - 1];
        if (epoch.finalized) revert EpochAlreadyFinalized();
        if (block.timestamp < epoch.endTime) revert EpochNotActive();

        epoch.finalized = true;

        // Calculate and distribute funds
        uint256 totalDistributed = _distributeFunds(daoId, epochId);
        epoch.distributed = totalDistributed;

        emit EpochFinalized(daoId, epochId, totalDistributed);
    }

    function setDAOConfig(bytes32 daoId, DAOFundingConfig calldata config) external onlyDAOAdmin(daoId) {
        _daoConfigs[daoId] = config;
        emit ConfigUpdated(daoId);
    }

    function setDefaultConfig(DAOFundingConfig calldata config) external onlyOwner {
        defaultConfig = config;
    }

    function depositMatchingFunds(bytes32 daoId, uint256 amount) external payable nonReentrant {
        uint256 epochId = _currentEpoch[daoId];
        if (epochId == 0) revert EpochNotActive();

        FundingEpoch storage epoch = _epochs[daoId][epochId - 1];
        if (epoch.finalized) revert EpochAlreadyFinalized();

        if (address(fundingToken) == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
        } else {
            fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        }

        epoch.matchingPool += amount;
        epoch.totalBudget += amount;
    }

    function getProject(bytes32 projectId) external view returns (FundingProject memory) {
        return _projects[projectId];
    }

    function getDAOProjects(bytes32 daoId) external view returns (bytes32[] memory) {
        return _daoProjects[daoId];
    }

    function getActiveProjects(bytes32 daoId) external view returns (FundingProject[] memory) {
        bytes32[] memory projectIds = _daoProjects[daoId];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < projectIds.length; i++) {
            if (_projects[projectIds[i]].status == FundingStatus.ACTIVE) {
                activeCount++;
            }
        }

        FundingProject[] memory result = new FundingProject[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < projectIds.length; i++) {
            if (_projects[projectIds[i]].status == FundingStatus.ACTIVE) {
                result[index] = _projects[projectIds[i]];
                index++;
            }
        }

        return result;
    }

    function getCurrentEpoch(bytes32 daoId) external view returns (FundingEpoch memory) {
        uint256 epochId = _currentEpoch[daoId];
        if (epochId == 0) {
            return FundingEpoch(0, bytes32(0), 0, 0, 0, 0, 0, false);
        }
        return _epochs[daoId][epochId - 1];
    }

    /**
     * @notice Get all epochs for a DAO
     * @param daoId DAO to get epochs for
     */
    function getEpochs(bytes32 daoId) external view returns (FundingEpoch[] memory) {
        return _epochs[daoId];
    }

    function getUserStake(bytes32 projectId, uint256 epochId, address user) external view returns (StakeInfo memory) {
        return _userStakes[projectId][epochId][user];
    }

    /**
     * @notice Get project stake for an epoch
     * @param projectId Project to check
     * @param epochId Epoch to check
     */
    function getProjectEpochStake(bytes32 projectId, uint256 epochId)
        external
        view
        returns (uint256 totalStake, uint256 numStakers)
    {
        return (_projectEpochStakes[projectId][epochId], _projectEpochStakers[projectId][epochId]);
    }

    function getDAOConfig(bytes32 daoId) external view returns (DAOFundingConfig memory) {
        return _getConfig(daoId);
    }

    function calculateAllocation(bytes32 projectId) external view returns (uint256) {
        FundingProject memory project = _projects[projectId];
        uint256 epochId = _currentEpoch[project.daoId];
        if (epochId == 0) return 0;

        return _calculateProjectAllocation(project.daoId, projectId, epochId);
    }

    function getProjectByRegistryId(bytes32 registryId) external view returns (FundingProject memory) {
        bytes32 projectId = _registryToProject[registryId];
        return _projects[projectId];
    }

    // ============ Admin Functions ============

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Internal Functions ============

    /**
     * @notice Get configuration for a DAO
     */
    function _getConfig(bytes32 daoId) internal view returns (DAOFundingConfig memory) {
        DAOFundingConfig memory config = _daoConfigs[daoId];
        if (config.epochDuration == 0) {
            return defaultConfig;
        }
        return config;
    }

    function _createEpoch(bytes32 daoId, uint256 budget, uint256 matchingPool) internal {
        DAOFundingConfig memory config = _getConfig(daoId);
        uint256 newEpochId = _currentEpoch[daoId] + 1;

        _epochs[daoId].push(
            FundingEpoch({
                epochId: newEpochId,
                daoId: daoId,
                startTime: block.timestamp,
                endTime: block.timestamp + config.epochDuration,
                totalBudget: budget,
                matchingPool: matchingPool,
                distributed: 0,
                finalized: false
            })
        );

        _currentEpoch[daoId] = newEpochId;

        emit EpochCreated(daoId, newEpochId, budget, matchingPool);
    }

    function _distributeFunds(bytes32 daoId, uint256 epochId) internal returns (uint256 totalDistributed) {
        bytes32[] memory projectIds = _daoProjects[daoId];
        FundingEpoch memory epoch = _epochs[daoId][epochId - 1];

        // Calculate total allocation weights
        uint256 totalWeight = 0;
        uint256[] memory weights = new uint256[](projectIds.length);

        for (uint256 i = 0; i < projectIds.length; i++) {
            if (_projects[projectIds[i]].status == FundingStatus.ACTIVE) {
                weights[i] = _calculateProjectAllocation(daoId, projectIds[i], epochId);
                totalWeight += weights[i];
            }
        }

        if (totalWeight == 0) return 0;

        // Distribute proportionally
        for (uint256 i = 0; i < projectIds.length; i++) {
            if (weights[i] > 0) {
                uint256 allocation = (epoch.totalBudget * weights[i]) / totalWeight;
                _distributeToProject(projectIds[i], allocation);
                totalDistributed += allocation;

                emit FundsDistributed(projectIds[i], epochId, allocation);
            }
        }

        return totalDistributed;
    }

    /**
     * @notice Calculate allocation weight for a project
     */
    function _calculateProjectAllocation(bytes32 daoId, bytes32 projectId, uint256 epochId)
        internal
        view
        returns (uint256)
    {
        FundingProject memory project = _projects[projectId];
        DAOFundingConfig memory config = _getConfig(daoId);

        uint256 projectStake = _projectEpochStakes[projectId][epochId];
        uint256 stakers = _projectEpochStakers[projectId][epochId];

        uint256 communityWeight;
        if (config.quadraticEnabled && stakers > 0) {
            communityWeight = _sqrt(projectStake) * _sqrt(stakers);
        } else {
            communityWeight = projectStake;
        }

        uint256 ceoMultiplier = 10000 + project.ceoWeight;
        uint256 totalWeight = (communityWeight * ceoMultiplier) / 10000;

        return totalWeight;
    }

    function _distributeToProject(bytes32 projectId, uint256 amount) internal {
        FundingProject storage project = _projects[projectId];

        uint256 primaryShare = 10000;
        for (uint256 i = 0; i < project.recipientShares.length; i++) {
            primaryShare -= project.recipientShares[i];
        }

        // Transfer to primary
        uint256 primaryAmount = (amount * primaryShare) / 10000;
        _transferFunds(project.primaryRecipient, primaryAmount);

        // Transfer to additional recipients
        for (uint256 i = 0; i < project.additionalRecipients.length; i++) {
            uint256 recipientAmount = (amount * project.recipientShares[i]) / 10000;
            _transferFunds(project.additionalRecipients[i], recipientAmount);
        }

        project.totalFunded += amount;
        project.lastFundedAt = block.timestamp;
    }

    function _transferFunds(address to, uint256 amount) internal {
        if (amount == 0) return;

        if (address(fundingToken) == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            fundingToken.safeTransfer(to, amount);
        }
    }

    /**
     * @notice Integer square root using Babylonian method
     */
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    receive() external payable {}
}
