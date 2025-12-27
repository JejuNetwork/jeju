// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DelegatedNodeStaking
 * @notice Enables capital stakers to delegate stake to compute providers who run nodes
 * @dev Common profit-sharing model: capital provides stake, operator provides hardware
 *
 * Profit Split Model (industry standard):
 * - Compute Provider: 20-40% (hardware, electricity, maintenance)
 * - Capital Stakers: 60-80% (proportional to stake)
 * - Protocol Fee: 5-10% (to treasury)
 *
 * Flow:
 * 1. Operator registers node with hardware specs
 * 2. Operator sets commission rate (e.g., 30%)
 * 3. Capital stakers delegate to operators
 * 4. Node earns rewards from services (compute, storage, CDN, etc.)
 * 5. Rewards split: operator commission + staker share + protocol fee
 */
contract DelegatedNodeStaking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum ServiceType {
        Compute, // GPU rentals, inference
        Storage, // IPFS, data storage
        CDN, // Edge caching
        Oracle, // Price feeds
        Bridge, // Cross-chain relaying
        Sequencer, // L2 sequencing
        ExternalChain // Solana, Bitcoin, etc.

    }

    struct NodeOperator {
        address operator;
        bytes32 nodeId;
        string endpoint;
        uint256 selfStake; // Operator's own stake
        uint256 totalDelegated; // Total stake from delegators
        uint256 commissionBps; // Operator's commission (basis points)
        uint256 registeredAt;
        uint256 lastRewardTime;
        uint256 totalRewardsEarned;
        uint256 totalRewardsDistributed;
        bool active;
        bool slashed;
        ServiceType[] services; // Services this node provides
        HardwareSpec hardware;
    }

    struct HardwareSpec {
        uint256 cpuCores;
        uint256 memoryGb;
        uint256 storageGb;
        uint256 gpuCount;
        string gpuModel; // e.g., "NVIDIA_H100"
        bool teeCapable;
        string teeType; // e.g., "intel_tdx", "amd_sev"
        string region; // Geographic region
    }

    struct Delegation {
        address delegator;
        bytes32 nodeId;
        uint256 amount;
        uint256 delegatedAt;
        uint256 unstakedAt; // 0 if still staked
        uint256 pendingRewards;
        uint256 claimedRewards;
    }

    struct NodeRewards {
        uint256 totalEarned;
        uint256 operatorShare;
        uint256 delegatorPool;
        uint256 protocolFee;
        uint256 lastDistribution;
    }

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_OPERATOR_STAKE = 1_000 ether; // Minimum self-stake
    uint256 public constant MIN_DELEGATION = 100 ether; // Minimum delegation
    uint256 public constant MAX_COMMISSION_BPS = 5_000; // Max 50% commission
    uint256 public constant MIN_COMMISSION_BPS = 500; // Min 5% commission
    uint256 public constant UNBONDING_PERIOD = 14 days;
    uint256 public constant COMMISSION_CHANGE_DELAY = 7 days;

    // ============ State ============

    IERC20 public immutable stakingToken;
    address public treasury;
    uint256 public protocolFeeBps = 500; // 5% protocol fee

    mapping(bytes32 => NodeOperator) public nodes;
    mapping(address => bytes32) public operatorNode; // operator => nodeId
    mapping(address => mapping(bytes32 => Delegation)) public delegations;
    mapping(address => bytes32[]) public delegatorNodes; // delegator => nodeIds[]
    mapping(bytes32 => address[]) public nodeDelegators; // nodeId => delegators[]
    mapping(bytes32 => NodeRewards) public nodeRewards;
    mapping(bytes32 => uint256) public pendingCommissionChange; // nodeId => timestamp
    mapping(bytes32 => uint256) public newCommissionBps; // nodeId => new rate

    bytes32[] public allNodes;
    uint256 public totalStaked;
    uint256 public totalDelegated;

    // Service-specific reward multipliers
    mapping(ServiceType => uint256) public serviceMultiplier; // Base 10000

    // ============ Events ============

    event OperatorRegistered(
        bytes32 indexed nodeId, address indexed operator, uint256 selfStake, uint256 commissionBps
    );
    event OperatorUpdated(bytes32 indexed nodeId, string endpoint, ServiceType[] services);
    event OperatorDeactivated(bytes32 indexed nodeId, address indexed operator);
    event CommissionChangeInitiated(bytes32 indexed nodeId, uint256 oldBps, uint256 newBps, uint256 effectiveAt);
    event CommissionChangeExecuted(bytes32 indexed nodeId, uint256 newBps);

    event Delegated(address indexed delegator, bytes32 indexed nodeId, uint256 amount);
    event Undelegated(address indexed delegator, bytes32 indexed nodeId, uint256 amount);
    event DelegationWithdrawn(address indexed delegator, bytes32 indexed nodeId, uint256 amount);

    event RewardsDistributed(
        bytes32 indexed nodeId, uint256 total, uint256 operatorShare, uint256 delegatorPool, uint256 protocolFee
    );
    event RewardsClaimed(address indexed claimant, bytes32 indexed nodeId, uint256 amount);

    event OperatorSlashed(bytes32 indexed nodeId, uint256 amount, string reason);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error NodeNotActive();
    error InsufficientStake();
    error InvalidCommission();
    error CommissionChangePending();
    error CommissionChangeNotReady();
    error DelegationTooSmall();
    error NoDelegation();
    error UnbondingNotComplete();
    error AlreadyUnstaking();
    error NothingToClaim();

    // ============ Constructor ============

    constructor(address _stakingToken, address _treasury, address _owner) Ownable(_owner) {
        stakingToken = IERC20(_stakingToken);
        treasury = _treasury;

        // Default service multipliers (base 10000 = 1.0x)
        serviceMultiplier[ServiceType.Compute] = 15000; // 1.5x for GPU compute
        serviceMultiplier[ServiceType.Storage] = 10000; // 1.0x base
        serviceMultiplier[ServiceType.CDN] = 10000; // 1.0x base
        serviceMultiplier[ServiceType.Oracle] = 12000; // 1.2x for oracles
        serviceMultiplier[ServiceType.Bridge] = 15000; // 1.5x for bridges
        serviceMultiplier[ServiceType.Sequencer] = 20000; // 2.0x for sequencers
        serviceMultiplier[ServiceType.ExternalChain] = 18000; // 1.8x for external chains
    }

    // ============ Operator Functions ============

    /**
     * @notice Register as a node operator with initial self-stake
     * @param endpoint Node's HTTP endpoint
     * @param commissionBps Commission rate in basis points (500-5000)
     * @param services Services this node will provide
     * @param hardware Node's hardware specifications
     */
    function registerOperator(
        string calldata endpoint,
        uint256 commissionBps,
        ServiceType[] calldata services,
        HardwareSpec calldata hardware
    ) external payable nonReentrant whenNotPaused returns (bytes32 nodeId) {
        if (operatorNode[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        if (msg.value < MIN_OPERATOR_STAKE) revert InsufficientStake();
        if (commissionBps < MIN_COMMISSION_BPS || commissionBps > MAX_COMMISSION_BPS) revert InvalidCommission();

        nodeId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp));

        nodes[nodeId] = NodeOperator({
            operator: msg.sender,
            nodeId: nodeId,
            endpoint: endpoint,
            selfStake: msg.value,
            totalDelegated: 0,
            commissionBps: commissionBps,
            registeredAt: block.timestamp,
            lastRewardTime: block.timestamp,
            totalRewardsEarned: 0,
            totalRewardsDistributed: 0,
            active: true,
            slashed: false,
            services: services,
            hardware: hardware
        });

        operatorNode[msg.sender] = nodeId;
        allNodes.push(nodeId);
        totalStaked += msg.value;

        emit OperatorRegistered(nodeId, msg.sender, msg.value, commissionBps);
    }

    /**
     * @notice Update node configuration
     */
    function updateOperator(string calldata endpoint, ServiceType[] calldata services) external {
        bytes32 nodeId = operatorNode[msg.sender];
        if (nodeId == bytes32(0)) revert NotRegistered();

        NodeOperator storage node = nodes[nodeId];
        node.endpoint = endpoint;
        node.services = services;

        emit OperatorUpdated(nodeId, endpoint, services);
    }

    /**
     * @notice Add more self-stake
     */
    function addSelfStake() external payable {
        bytes32 nodeId = operatorNode[msg.sender];
        if (nodeId == bytes32(0)) revert NotRegistered();

        nodes[nodeId].selfStake += msg.value;
        totalStaked += msg.value;
    }

    /**
     * @notice Initiate commission change (takes effect after delay)
     * @dev Delay protects delegators from sudden commission increases
     */
    function initiateCommissionChange(uint256 newBps) external {
        bytes32 nodeId = operatorNode[msg.sender];
        if (nodeId == bytes32(0)) revert NotRegistered();
        if (newBps < MIN_COMMISSION_BPS || newBps > MAX_COMMISSION_BPS) revert InvalidCommission();
        if (pendingCommissionChange[nodeId] != 0) revert CommissionChangePending();

        pendingCommissionChange[nodeId] = block.timestamp + COMMISSION_CHANGE_DELAY;
        newCommissionBps[nodeId] = newBps;

        emit CommissionChangeInitiated(nodeId, nodes[nodeId].commissionBps, newBps, pendingCommissionChange[nodeId]);
    }

    /**
     * @notice Execute pending commission change
     */
    function executeCommissionChange() external {
        bytes32 nodeId = operatorNode[msg.sender];
        if (nodeId == bytes32(0)) revert NotRegistered();
        if (pendingCommissionChange[nodeId] == 0) revert CommissionChangePending();
        if (block.timestamp < pendingCommissionChange[nodeId]) revert CommissionChangeNotReady();

        nodes[nodeId].commissionBps = newCommissionBps[nodeId];
        delete pendingCommissionChange[nodeId];
        delete newCommissionBps[nodeId];

        emit CommissionChangeExecuted(nodeId, nodes[nodeId].commissionBps);
    }

    /**
     * @notice Deactivate node and begin unstaking
     */
    function deactivateOperator() external {
        bytes32 nodeId = operatorNode[msg.sender];
        if (nodeId == bytes32(0)) revert NotRegistered();

        nodes[nodeId].active = false;

        emit OperatorDeactivated(nodeId, msg.sender);
    }

    // ============ Delegator Functions ============

    /**
     * @notice Delegate stake to a node operator
     * @param nodeId Target node to delegate to
     */
    function delegate(bytes32 nodeId) external payable nonReentrant whenNotPaused {
        NodeOperator storage node = nodes[nodeId];
        if (!node.active) revert NodeNotActive();
        if (msg.value < MIN_DELEGATION) revert DelegationTooSmall();

        Delegation storage del = delegations[msg.sender][nodeId];

        if (del.amount == 0) {
            // New delegation
            del.delegator = msg.sender;
            del.nodeId = nodeId;
            del.amount = msg.value;
            del.delegatedAt = block.timestamp;
            del.unstakedAt = 0;
            del.pendingRewards = 0;
            del.claimedRewards = 0;

            delegatorNodes[msg.sender].push(nodeId);
            nodeDelegators[nodeId].push(msg.sender);
        } else {
            // Add to existing delegation
            if (del.unstakedAt != 0) revert AlreadyUnstaking();
            del.amount += msg.value;
        }

        node.totalDelegated += msg.value;
        totalDelegated += msg.value;

        emit Delegated(msg.sender, nodeId, msg.value);
    }

    /**
     * @notice Begin undelegation (starts unbonding period)
     */
    function undelegate(bytes32 nodeId) external {
        Delegation storage del = delegations[msg.sender][nodeId];
        if (del.amount == 0) revert NoDelegation();
        if (del.unstakedAt != 0) revert AlreadyUnstaking();

        del.unstakedAt = block.timestamp;
        nodes[nodeId].totalDelegated -= del.amount;
        totalDelegated -= del.amount;

        emit Undelegated(msg.sender, nodeId, del.amount);
    }

    /**
     * @notice Withdraw undelegated stake after unbonding period
     */
    function withdrawDelegation(bytes32 nodeId) external nonReentrant {
        Delegation storage del = delegations[msg.sender][nodeId];
        if (del.amount == 0) revert NoDelegation();
        if (del.unstakedAt == 0) revert NoDelegation();
        if (block.timestamp < del.unstakedAt + UNBONDING_PERIOD) revert UnbondingNotComplete();

        uint256 amount = del.amount;
        del.amount = 0;

        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit DelegationWithdrawn(msg.sender, nodeId, amount);
    }

    // ============ Reward Distribution ============

    /**
     * @notice Distribute rewards to a node (called by reward sources: DWS, compute, etc.)
     * @param nodeId Node receiving rewards
     */
    function distributeRewards(bytes32 nodeId) external payable nonReentrant {
        NodeOperator storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NotRegistered();

        uint256 amount = msg.value;
        if (amount == 0) return;

        // Calculate splits
        uint256 protocolShare = (amount * protocolFeeBps) / BPS;
        uint256 afterProtocol = amount - protocolShare;

        uint256 operatorShare = (afterProtocol * node.commissionBps) / BPS;
        uint256 delegatorPool = afterProtocol - operatorShare;

        // Update node rewards tracking
        NodeRewards storage rewards = nodeRewards[nodeId];
        rewards.totalEarned += amount;
        rewards.operatorShare += operatorShare;
        rewards.delegatorPool += delegatorPool;
        rewards.protocolFee += protocolShare;
        rewards.lastDistribution = block.timestamp;

        node.totalRewardsEarned += amount;
        node.lastRewardTime = block.timestamp;

        // Transfer protocol fee to treasury
        if (protocolShare > 0) {
            (bool success,) = payable(treasury).call{value: protocolShare}("");
            require(success, "Treasury transfer failed");
        }

        // Operator share goes to operator
        if (operatorShare > 0) {
            (bool success,) = payable(node.operator).call{value: operatorShare}("");
            require(success, "Operator transfer failed");
        }

        // Distribute to delegators proportionally
        if (delegatorPool > 0 && node.totalDelegated > 0) {
            address[] storage delegators = nodeDelegators[nodeId];
            for (uint256 i = 0; i < delegators.length; i++) {
                Delegation storage del = delegations[delegators[i]][nodeId];
                if (del.amount > 0 && del.unstakedAt == 0) {
                    uint256 share = (delegatorPool * del.amount) / node.totalDelegated;
                    del.pendingRewards += share;
                }
            }
        }

        emit RewardsDistributed(nodeId, amount, operatorShare, delegatorPool, protocolShare);
    }

    /**
     * @notice Claim pending rewards as a delegator
     */
    function claimRewards(bytes32 nodeId) external nonReentrant {
        Delegation storage del = delegations[msg.sender][nodeId];
        if (del.pendingRewards == 0) revert NothingToClaim();

        uint256 amount = del.pendingRewards;
        del.pendingRewards = 0;
        del.claimedRewards += amount;

        nodes[nodeId].totalRewardsDistributed += amount;

        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Claim transfer failed");

        emit RewardsClaimed(msg.sender, nodeId, amount);
    }

    // ============ Slashing ============

    /**
     * @notice Slash a misbehaving node (called by slasher contracts)
     * @param nodeId Node to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slash(bytes32 nodeId, uint256 amount, string calldata reason) external onlyOwner {
        NodeOperator storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NotRegistered();

        uint256 totalNodeStake = node.selfStake + node.totalDelegated;
        uint256 slashAmount = amount > totalNodeStake ? totalNodeStake : amount;

        // Slash proportionally from self-stake and delegated stake
        uint256 selfSlash = (slashAmount * node.selfStake) / totalNodeStake;
        uint256 delegatedSlash = slashAmount - selfSlash;

        node.selfStake -= selfSlash;
        node.totalDelegated -= delegatedSlash;
        node.slashed = true;

        totalStaked -= selfSlash;
        totalDelegated -= delegatedSlash;

        // Slash from delegators proportionally
        if (delegatedSlash > 0) {
            address[] storage delegators = nodeDelegators[nodeId];
            for (uint256 i = 0; i < delegators.length; i++) {
                Delegation storage del = delegations[delegators[i]][nodeId];
                if (del.amount > 0) {
                    uint256 share = (delegatedSlash * del.amount) / (node.totalDelegated + delegatedSlash);
                    del.amount -= share;
                }
            }
        }

        // Transfer slashed amount to treasury
        (bool success,) = payable(treasury).call{value: slashAmount}("");
        require(success, "Slash transfer failed");

        emit OperatorSlashed(nodeId, slashAmount, reason);
    }

    // ============ Views ============

    function getNode(bytes32 nodeId) external view returns (NodeOperator memory) {
        return nodes[nodeId];
    }

    function getDelegation(address delegator, bytes32 nodeId) external view returns (Delegation memory) {
        return delegations[delegator][nodeId];
    }

    function getNodeRewards(bytes32 nodeId) external view returns (NodeRewards memory) {
        return nodeRewards[nodeId];
    }

    function getOperatorAPY(bytes32 nodeId) external view returns (uint256) {
        NodeOperator storage node = nodes[nodeId];
        if (node.selfStake + node.totalDelegated == 0) return 0;

        uint256 timeSinceStart = block.timestamp - node.registeredAt;
        if (timeSinceStart == 0) return 0;

        uint256 annualizedRewards = (node.totalRewardsEarned * 365 days) / timeSinceStart;
        return (annualizedRewards * BPS) / (node.selfStake + node.totalDelegated);
    }

    function getDelegatorAPY(bytes32 nodeId) external view returns (uint256) {
        NodeRewards storage rewards = nodeRewards[nodeId];
        NodeOperator storage node = nodes[nodeId];
        if (node.totalDelegated == 0) return 0;

        uint256 timeSinceStart = block.timestamp - node.registeredAt;
        if (timeSinceStart == 0) return 0;

        uint256 annualizedDelegatorRewards = (rewards.delegatorPool * 365 days) / timeSinceStart;
        return (annualizedDelegatorRewards * BPS) / node.totalDelegated;
    }

    function getActiveNodes() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allNodes.length; i++) {
            if (nodes[allNodes[i]].active) count++;
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allNodes.length; i++) {
            if (nodes[allNodes[i]].active) {
                active[idx++] = allNodes[i];
            }
        }
        return active;
    }

    function getNodesByService(ServiceType service) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allNodes.length; i++) {
            NodeOperator storage node = nodes[allNodes[i]];
            if (node.active) {
                for (uint256 j = 0; j < node.services.length; j++) {
                    if (node.services[j] == service) {
                        count++;
                        break;
                    }
                }
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allNodes.length; i++) {
            NodeOperator storage node = nodes[allNodes[i]];
            if (node.active) {
                for (uint256 j = 0; j < node.services.length; j++) {
                    if (node.services[j] == service) {
                        result[idx++] = allNodes[i];
                        break;
                    }
                }
            }
        }
        return result;
    }

    // ============ Admin ============

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Fee too high"); // Max 10%
        protocolFeeBps = feeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setServiceMultiplier(ServiceType service, uint256 multiplier) external onlyOwner {
        serviceMultiplier[service] = multiplier;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
