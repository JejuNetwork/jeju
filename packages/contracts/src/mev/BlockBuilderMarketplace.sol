// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IIdentityRegistry
 * @notice Interface for ERC-8004 Identity Registry
 */
interface IIdentityRegistry {
    enum StakeTier {
        NONE,
        SMALL,
        MEDIUM,
        HIGH
    }

    struct AgentRegistration {
        uint256 agentId;
        address owner;
        StakeTier tier;
        address stakedToken;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isBanned;
        bool isSlashed;
    }

    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgent(uint256 agentId) external view returns (AgentRegistration memory);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function getApproved(uint256 agentId) external view returns (address);
}

/**
 * @title IReputationRegistry
 * @notice Interface for ERC-8004 Reputation Registry
 */
interface IReputationRegistry {
    function getSummary(uint256 agentId, address[] calldata clientAddresses, bytes32 tag1, bytes32 tag2)
        external
        view
        returns (uint64 count, uint8 averageScore);
}

/**
 * @title BlockBuilderMarketplace
 * @author Jeju Network
 * @notice Decentralized marketplace for atomic block building access with ERC-8004 integration
 * @dev Enables MEV searchers to bid for priority block inclusion with reputation-based access
 *
 * ## Design Philosophy
 * This contract creates a fair, permissionless marketplace for block space that:
 * - Uses ERC-8004 agent identity for Sybil resistance
 * - Leverages reputation for trust and priority
 * - Implements stake-based slashing for misbehavior
 * - Aligns incentives between builders, searchers, and users
 *
 * ## Access Tiers
 * Based on ERC-8004 stake tier and reputation:
 * - BRONZE: Basic access, standard priority
 * - SILVER: Enhanced priority, smaller bundles
 * - GOLD: Premium priority, larger bundles, private mempool access
 * - PLATINUM: Highest priority, atomic bundle guarantee, dedicated slots
 *
 * ## Bundle Submission
 * Searchers submit bundles with:
 * - Target block number
 * - Priority fee (bid)
 * - Transaction bundle (signed)
 * - Refund conditions
 *
 * ## Slashing Conditions
 * - Failed bundle that causes state inconsistency
 * - Malicious sandwich attacks on protected users
 * - Excessive reverts (>20% failure rate)
 * - Collusion detected via on-chain analysis
 *
 * @custom:security-contact security@jeju.network
 */
contract BlockBuilderMarketplace is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    /// @notice Access tier levels based on reputation and stake
    enum AccessTier {
        NONE, // Not registered
        BRONZE, // Basic access
        SILVER, // Enhanced priority
        GOLD, // Premium access
        PLATINUM // Highest tier

    }

    /// @notice Bundle status
    enum BundleStatus {
        PENDING, // Awaiting inclusion
        INCLUDED, // Successfully included in block
        FAILED, // Failed to execute
        EXPIRED, // Target block passed
        REFUNDED // Bid refunded

    }

    // ============ Structs ============

    /// @notice Builder registration
    struct BuilderRegistration {
        uint256 agentId; // ERC-8004 agent ID
        address owner; // Builder wallet
        AccessTier tier; // Current access tier
        uint256 stakeAmount; // Additional marketplace stake
        uint256 totalBundlesSubmitted;
        uint256 totalBundlesIncluded;
        uint256 totalBundlesFailed;
        uint256 totalFeePaid;
        uint256 totalSlashed;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isActive;
        bool isSlashed;
    }

    /// @notice Bundle submission
    struct Bundle {
        bytes32 bundleId;
        uint256 builderId; // Builder's agentId
        uint256 targetBlock; // Target block for inclusion
        uint256 bidAmount; // Priority fee bid
        bytes32 bundleHash; // Hash of transaction bundle
        uint256 maxGasPrice; // Max gas price willing to pay
        uint256 submittedAt;
        BundleStatus status;
        bytes32 inclusionTxHash; // TX hash if included
    }

    /// @notice Tier requirements
    struct TierRequirements {
        uint256 minStake; // Minimum stake required
        uint256 minReputation; // Minimum reputation score (0-100)
        uint256 minBundlesIncluded; // Minimum successful bundles
        uint256 maxFailureRate; // Max failure rate in basis points
        uint256 maxBundleSize; // Max transactions in bundle
        bool privateMempoolAccess; // Can see private mempool
        bool atomicGuarantee; // Guaranteed atomic execution
    }

    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SLASHING_PENALTY_BPS = 1000; // 10% slash
    uint256 public constant MIN_BUNDLE_BID = 0.001 ether;
    uint256 public constant BUNDLE_EXPIRY_BLOCKS = 5;
    bytes32 public constant BUILDER_TAG = keccak256("block-builder");

    // ============ State Variables ============

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice ERC-8004 Reputation Registry
    IReputationRegistry public reputationRegistry;

    /// @notice Treasury for collected fees
    address public treasury;

    /// @notice Builder registrations by agentId
    mapping(uint256 => BuilderRegistration) public builders;

    /// @notice Bundle storage by bundleId
    mapping(bytes32 => Bundle) public bundles;

    /// @notice Bundles by target block
    mapping(uint256 => bytes32[]) public bundlesByBlock;

    /// @notice Tier requirements
    mapping(AccessTier => TierRequirements) public tierRequirements;

    /// @notice Sequencer/block producer address (can include bundles)
    address public sequencer;

    /// @notice Total bundles submitted
    uint256 public totalBundlesSubmitted;

    /// @notice Total fees collected
    uint256 public totalFeesCollected;

    // ============ Events ============

    event BuilderRegistered(uint256 indexed agentId, address indexed owner, AccessTier tier);
    event BuilderTierUpdated(uint256 indexed agentId, AccessTier oldTier, AccessTier newTier);
    event BuilderSlashed(uint256 indexed agentId, uint256 amount, string reason);
    event BuilderDeactivated(uint256 indexed agentId);

    event BundleSubmitted(bytes32 indexed bundleId, uint256 indexed agentId, uint256 targetBlock, uint256 bidAmount);
    event BundleIncluded(bytes32 indexed bundleId, uint256 indexed blockNumber, bytes32 txHash);
    event BundleFailed(bytes32 indexed bundleId, string reason);
    event BundleExpired(bytes32 indexed bundleId);
    event BundleRefunded(bytes32 indexed bundleId, uint256 amount);

    event TierRequirementsUpdated(AccessTier tier);
    event SequencerUpdated(address oldSequencer, address newSequencer);

    // ============ Errors ============

    error AgentNotFound();
    error AgentBanned();
    error NotAgentOwner();
    error InsufficientStake();
    error InsufficientReputation();
    error BuilderNotRegistered();
    error BuilderAlreadyRegistered();
    error BuilderSlashedErr();
    error InvalidBid();
    error InvalidTargetBlock();
    error BundleNotFound();
    error BundleAlreadyProcessed();
    error OnlySequencer();
    error TierTooLow();

    // ============ Modifiers ============

    modifier onlySequencer() {
        if (msg.sender != sequencer && msg.sender != owner()) revert OnlySequencer();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _;
    }

    modifier builderActive(uint256 agentId) {
        BuilderRegistration storage builder = builders[agentId];
        if (!builder.isActive) revert BuilderNotRegistered();
        if (builder.isSlashed) revert BuilderSlashedErr();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _reputationRegistry,
        address _treasury,
        address _sequencer,
        address initialOwner
    ) Ownable(initialOwner) {
        identityRegistry = IIdentityRegistry(_identityRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        treasury = _treasury;
        sequencer = _sequencer;

        // Initialize tier requirements
        _initializeTierRequirements();
    }

    // ============ Builder Registration ============

    /**
     * @notice Register as a block builder
     * @param agentId ERC-8004 agent ID
     */
    function registerBuilder(uint256 agentId) external payable nonReentrant whenNotPaused onlyAgentOwner(agentId) {
        if (!identityRegistry.agentExists(agentId)) revert AgentNotFound();

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        if (agent.isBanned) revert AgentBanned();
        if (builders[agentId].isActive) revert BuilderAlreadyRegistered();

        // Calculate initial tier based on agent stake and reputation
        AccessTier tier = _calculateTier(agentId, msg.value);

        builders[agentId] = BuilderRegistration({
            agentId: agentId,
            owner: msg.sender,
            tier: tier,
            stakeAmount: msg.value,
            totalBundlesSubmitted: 0,
            totalBundlesIncluded: 0,
            totalBundlesFailed: 0,
            totalFeePaid: 0,
            totalSlashed: 0,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            isActive: true,
            isSlashed: false
        });

        emit BuilderRegistered(agentId, msg.sender, tier);
    }

    /**
     * @notice Increase stake to upgrade tier
     * @param agentId Builder's agent ID
     */
    function increaseStake(uint256 agentId)
        external
        payable
        nonReentrant
        builderActive(agentId)
        onlyAgentOwner(agentId)
    {
        BuilderRegistration storage builder = builders[agentId];
        builder.stakeAmount += msg.value;

        AccessTier oldTier = builder.tier;
        AccessTier newTier = _calculateTier(agentId, builder.stakeAmount);

        if (newTier > oldTier) {
            builder.tier = newTier;
            emit BuilderTierUpdated(agentId, oldTier, newTier);
        }
    }

    /**
     * @notice Withdraw stake (may downgrade tier)
     * @param agentId Builder's agent ID
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 agentId, uint256 amount)
        external
        nonReentrant
        builderActive(agentId)
        onlyAgentOwner(agentId)
    {
        BuilderRegistration storage builder = builders[agentId];
        require(builder.stakeAmount >= amount, "Insufficient stake");

        builder.stakeAmount -= amount;

        AccessTier oldTier = builder.tier;
        AccessTier newTier = _calculateTier(agentId, builder.stakeAmount);

        if (newTier < oldTier) {
            builder.tier = newTier;
            emit BuilderTierUpdated(agentId, oldTier, newTier);
        }

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice Deactivate builder registration
     * @param agentId Builder's agent ID
     */
    function deactivateBuilder(uint256 agentId) external nonReentrant onlyAgentOwner(agentId) {
        BuilderRegistration storage builder = builders[agentId];
        require(builder.isActive, "Already inactive");

        builder.isActive = false;

        // Refund remaining stake
        if (builder.stakeAmount > 0) {
            uint256 refund = builder.stakeAmount;
            builder.stakeAmount = 0;
            (bool success,) = msg.sender.call{value: refund}("");
            require(success, "ETH transfer failed");
        }

        emit BuilderDeactivated(agentId);
    }

    // ============ Bundle Submission ============

    /**
     * @notice Submit a bundle for inclusion
     * @param agentId Builder's agent ID
     * @param targetBlock Target block for inclusion
     * @param bundleHash Hash of the transaction bundle
     * @param maxGasPrice Maximum gas price willing to pay
     * @return bundleId Unique bundle identifier
     */
    function submitBundle(uint256 agentId, uint256 targetBlock, bytes32 bundleHash, uint256 maxGasPrice)
        external
        payable
        nonReentrant
        whenNotPaused
        builderActive(agentId)
        onlyAgentOwner(agentId)
        returns (bytes32 bundleId)
    {
        if (msg.value < MIN_BUNDLE_BID) revert InvalidBid();
        if (targetBlock <= block.number || targetBlock > block.number + BUNDLE_EXPIRY_BLOCKS) {
            revert InvalidTargetBlock();
        }

        BuilderRegistration storage builder = builders[agentId];

        // Generate unique bundle ID
        bundleId = keccak256(abi.encodePacked(agentId, targetBlock, bundleHash, block.timestamp, totalBundlesSubmitted));

        bundles[bundleId] = Bundle({
            bundleId: bundleId,
            builderId: agentId,
            targetBlock: targetBlock,
            bidAmount: msg.value,
            bundleHash: bundleHash,
            maxGasPrice: maxGasPrice,
            submittedAt: block.timestamp,
            status: BundleStatus.PENDING,
            inclusionTxHash: bytes32(0)
        });

        bundlesByBlock[targetBlock].push(bundleId);
        builder.totalBundlesSubmitted++;
        builder.lastActivityAt = block.timestamp;
        totalBundlesSubmitted++;

        emit BundleSubmitted(bundleId, agentId, targetBlock, msg.value);
    }

    /**
     * @notice Mark bundle as included (sequencer only)
     * @param bundleId Bundle to mark
     * @param inclusionTxHash Transaction hash of inclusion
     */
    function markBundleIncluded(bytes32 bundleId, bytes32 inclusionTxHash) external onlySequencer {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.bundleId == bytes32(0)) revert BundleNotFound();
        if (bundle.status != BundleStatus.PENDING) revert BundleAlreadyProcessed();

        bundle.status = BundleStatus.INCLUDED;
        bundle.inclusionTxHash = inclusionTxHash;

        BuilderRegistration storage builder = builders[bundle.builderId];
        builder.totalBundlesIncluded++;
        builder.totalFeePaid += bundle.bidAmount;

        // Transfer fee to treasury
        totalFeesCollected += bundle.bidAmount;
        (bool success,) = treasury.call{value: bundle.bidAmount}("");
        require(success, "Fee transfer failed");

        emit BundleIncluded(bundleId, bundle.targetBlock, inclusionTxHash);
    }

    /**
     * @notice Mark bundle as failed (sequencer only)
     * @param bundleId Bundle that failed
     * @param reason Failure reason
     * @param shouldSlash Whether to slash the builder
     */
    function markBundleFailed(bytes32 bundleId, string calldata reason, bool shouldSlash) external onlySequencer {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.bundleId == bytes32(0)) revert BundleNotFound();
        if (bundle.status != BundleStatus.PENDING) revert BundleAlreadyProcessed();

        bundle.status = BundleStatus.FAILED;

        BuilderRegistration storage builder = builders[bundle.builderId];
        builder.totalBundlesFailed++;

        if (shouldSlash) {
            _slashBuilder(bundle.builderId, reason);
        }

        // Partial refund (minus gas costs)
        uint256 refund = bundle.bidAmount / 2; // 50% refund on failure
        if (refund > 0) {
            address builderOwner = builder.owner;
            (bool success,) = builderOwner.call{value: refund}("");
            require(success, "Refund failed");
        }

        emit BundleFailed(bundleId, reason);
    }

    /**
     * @notice Expire and refund old bundles
     * @param bundleId Bundle to expire
     */
    function expireBundle(bytes32 bundleId) external nonReentrant {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.bundleId == bytes32(0)) revert BundleNotFound();
        if (bundle.status != BundleStatus.PENDING) revert BundleAlreadyProcessed();
        if (block.number <= bundle.targetBlock) revert InvalidTargetBlock();

        bundle.status = BundleStatus.EXPIRED;

        // Full refund for expired bundles
        BuilderRegistration storage builder = builders[bundle.builderId];
        address builderOwner = builder.owner;

        (bool success,) = builderOwner.call{value: bundle.bidAmount}("");
        require(success, "Refund failed");

        emit BundleExpired(bundleId);
        emit BundleRefunded(bundleId, bundle.bidAmount);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a builder for misbehavior
     * @param agentId Builder to slash
     * @param reason Slashing reason
     */
    function slashBuilder(uint256 agentId, string calldata reason) external onlyOwner {
        _slashBuilder(agentId, reason);
    }

    function _slashBuilder(uint256 agentId, string memory reason) internal {
        BuilderRegistration storage builder = builders[agentId];

        uint256 slashAmount = (builder.stakeAmount * SLASHING_PENALTY_BPS) / BPS_DENOMINATOR;
        builder.stakeAmount -= slashAmount;
        builder.totalSlashed += slashAmount;
        builder.isSlashed = true;

        // Send slashed amount to treasury
        if (slashAmount > 0) {
            (bool success,) = treasury.call{value: slashAmount}("");
            require(success, "Slash transfer failed");
        }

        emit BuilderSlashed(agentId, slashAmount, reason);
    }

    // ============ View Functions ============

    /**
     * @notice Get builder's current access tier
     * @param agentId Builder's agent ID
     * @return tier Current access tier
     */
    function getBuilderTier(uint256 agentId) external view returns (AccessTier) {
        return builders[agentId].tier;
    }

    /**
     * @notice Get bundles for a target block
     * @param targetBlock Block number
     * @return bundleIds Array of bundle IDs
     */
    function getBundlesForBlock(uint256 targetBlock) external view returns (bytes32[] memory) {
        return bundlesByBlock[targetBlock];
    }

    /**
     * @notice Check if builder has access to feature
     * @param agentId Builder's agent ID
     * @param requiredTier Minimum tier required
     * @return hasAccess Whether builder has access
     */
    function hasAccess(uint256 agentId, AccessTier requiredTier) external view returns (bool) {
        BuilderRegistration storage builder = builders[agentId];
        return builder.isActive && !builder.isSlashed && builder.tier >= requiredTier;
    }

    /**
     * @notice Get tier requirements
     * @param tier Access tier
     * @return requirements Tier requirements struct
     */
    function getTierRequirements(AccessTier tier) external view returns (TierRequirements memory) {
        return tierRequirements[tier];
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Admin Functions ============

    /**
     * @notice Update tier requirements
     * @param tier Tier to update
     * @param requirements New requirements
     */
    function setTierRequirements(AccessTier tier, TierRequirements calldata requirements) external onlyOwner {
        tierRequirements[tier] = requirements;
        emit TierRequirementsUpdated(tier);
    }

    /**
     * @notice Update sequencer address
     * @param newSequencer New sequencer address
     */
    function setSequencer(address newSequencer) external onlyOwner {
        address oldSequencer = sequencer;
        sequencer = newSequencer;
        emit SequencerUpdated(oldSequencer, newSequencer);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    function _initializeTierRequirements() internal {
        // BRONZE: Entry level
        tierRequirements[AccessTier.BRONZE] = TierRequirements({
            minStake: 0.01 ether,
            minReputation: 0,
            minBundlesIncluded: 0,
            maxFailureRate: 5000, // 50% max failure
            maxBundleSize: 5,
            privateMempoolAccess: false,
            atomicGuarantee: false
        });

        // SILVER: Intermediate
        tierRequirements[AccessTier.SILVER] = TierRequirements({
            minStake: 0.1 ether,
            minReputation: 30,
            minBundlesIncluded: 10,
            maxFailureRate: 3000, // 30% max failure
            maxBundleSize: 10,
            privateMempoolAccess: false,
            atomicGuarantee: false
        });

        // GOLD: Advanced
        tierRequirements[AccessTier.GOLD] = TierRequirements({
            minStake: 1 ether,
            minReputation: 60,
            minBundlesIncluded: 100,
            maxFailureRate: 2000, // 20% max failure
            maxBundleSize: 20,
            privateMempoolAccess: true,
            atomicGuarantee: false
        });

        // PLATINUM: Premium
        tierRequirements[AccessTier.PLATINUM] = TierRequirements({
            minStake: 10 ether,
            minReputation: 80,
            minBundlesIncluded: 1000,
            maxFailureRate: 1000, // 10% max failure
            maxBundleSize: 50,
            privateMempoolAccess: true,
            atomicGuarantee: true
        });
    }

    function _calculateTier(uint256 agentId, uint256 stake) internal view returns (AccessTier) {
        // Get reputation from ERC-8004
        (, uint8 avgScore) = reputationRegistry.getSummary(agentId, new address[](0), bytes32(0), bytes32(0));

        BuilderRegistration storage builder = builders[agentId];
        uint256 successfulBundles = builder.totalBundlesIncluded;
        uint256 totalBundles = builder.totalBundlesSubmitted;

        uint256 failureRate =
            totalBundles > 0 ? ((totalBundles - successfulBundles) * BPS_DENOMINATOR) / totalBundles : 0;

        // Check from highest to lowest tier
        if (_meetsTierRequirements(AccessTier.PLATINUM, stake, avgScore, successfulBundles, failureRate)) {
            return AccessTier.PLATINUM;
        }
        if (_meetsTierRequirements(AccessTier.GOLD, stake, avgScore, successfulBundles, failureRate)) {
            return AccessTier.GOLD;
        }
        if (_meetsTierRequirements(AccessTier.SILVER, stake, avgScore, successfulBundles, failureRate)) {
            return AccessTier.SILVER;
        }
        if (_meetsTierRequirements(AccessTier.BRONZE, stake, avgScore, successfulBundles, failureRate)) {
            return AccessTier.BRONZE;
        }

        return AccessTier.NONE;
    }

    function _meetsTierRequirements(
        AccessTier tier,
        uint256 stake,
        uint8 reputation,
        uint256 bundlesIncluded,
        uint256 failureRate
    ) internal view returns (bool) {
        TierRequirements storage req = tierRequirements[tier];

        return stake >= req.minStake && reputation >= req.minReputation && bundlesIncluded >= req.minBundlesIncluded
            && failureRate <= req.maxFailureRate;
    }

    receive() external payable {}
}
