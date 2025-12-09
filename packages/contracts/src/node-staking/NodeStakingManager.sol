// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INodeStakingManager} from "./INodeStakingManager.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title NodeStakingManager
 * @notice Multi-token staking system for Jeju node operators
 * @dev V2-ready: Extensible for futarchy governance and token diversity bonuses
 *
 * Key Features:
 * - Stake ANY TokenRegistry token (elizaOS, CLANKER, VIRTUAL, etc.)
 * - Earn rewards in ANY token (operator's choice)
 * - Paymasters earn ETH fees (sustainable revenue)
 * - USD-denominated minimums (fair across all tokens)
 * - Anti-Sybil: ownership caps + performance requirements
 * - V2-ready: Hooks for governance and diversity bonuses
 *
 * Economics:
 * - Base: $100 USD/month per node
 * - Uptime bonus: 0.5x - 2x (based on 99%+)
 * - Geographic bonus: +50% (underserved regions)
 * - Paymaster fees: 5% to reward paymaster, 2% to staking paymaster (in ETH)
 *
 * V2 Features (hooks provided):
 * - Token diversity bonus: +25-50% for minority tokens
 * - Futarchy governance: Prediction market-based parameter updates
 * - Multi-oracle consensus: 3+ confirmations required
 */
contract NodeStakingManager is INodeStakingManager, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Immutable Dependencies ============

    ITokenRegistry public immutable tokenRegistry;
    IPaymasterFactory public immutable paymasterFactory;
    IPriceOracle public immutable priceOracle;

    // ============ State Variables ============

    // Node registry
    mapping(bytes32 => NodeStake) public nodes;
    mapping(address => bytes32[]) public operatorNodes;
    bytes32[] public allNodeIds;

    // Performance tracking
    mapping(bytes32 => PerformanceMetrics) public performance;

    // Operator tracking
    mapping(address => OperatorStats) public operatorStats;

    // Token distribution
    mapping(address => TokenDistribution) public tokenDistribution;
    uint256 public totalStakedUSD;
    uint256 public totalRewardsClaimedUSD; // Track globally to avoid DoS

    // Geographic tracking
    mapping(Region => uint256) public nodesByRegion;

    // Performance oracles
    mapping(address => bool) public isPerformanceOracle;
    address[] public performanceOracles;

    // ERC-8004 Integration
    IIdentityRegistry public identityRegistry;
    bool public requireAgentRegistration;
    mapping(uint256 => bytes32[]) public agentNodes; // agent ID => node IDs

    // ============ Parameters (Governable) ============

    uint256 public minStakeUSD = 1000 ether;
    uint256 public baseRewardPerMonthUSD = 100 ether;
    uint256 public paymasterRewardCutBPS = 500;
    uint256 public paymasterStakeCutBPS = 200;
    uint256 public maxNodesPerOperator = 5;
    uint256 public maxNetworkOwnershipBPS = 10000; // 100% for testing, reduce in production
    uint256 public uptimeMultiplierMin = 5000;
    uint256 public uptimeMultiplierMax = 20000;
    uint256 public geographicBonusBPS = 5000;
    uint256 public volumeBonusPerThousandRequests = 0.01 ether;
    uint256 public tokenDiversityBonusBPS = 2500;

    bool public tokenDiversityBonusEnabled = false;

    // ============ Constants ============

    uint256 public constant MIN_STAKING_PERIOD = 7 days;
    uint256 public constant UPTIME_THRESHOLD = 9900;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MONTH_DURATION = 30 days;
    uint256 public constant DAY_DURATION = 1 days;

    // ============ Errors ============

    error TokenNotRegistered(address token);
    error NoPaymasterForToken(address token);
    error InsufficientStakeValue(uint256 provided, uint256 required);
    error TooManyNodes(uint256 current, uint256 max);
    error NetworkOwnershipExceeded(uint256 wouldBe, uint256 max);
    error NodeNotFound(bytes32 nodeId);
    error Unauthorized();
    error NodeNotActive();
    error NodeAlreadySlashed();
    error MinimumPeriodNotMet(uint256 elapsed, uint256 required);
    error NothingToClaim();
    error TransferFailed();
    error UnauthorizedOracle();
    error InsufficientETHForFees();
    error AgentRequired();
    error InvalidAgentId();
    error NotAgentOwner();

    // ============ Constructor ============

    error InvalidAddress();
    error ZeroStake();

    constructor(
        address _tokenRegistry,
        address _paymasterFactory,
        address _priceOracle,
        address _performanceOracle,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_tokenRegistry == address(0)) revert InvalidAddress();
        if (_paymasterFactory == address(0)) revert InvalidAddress();
        if (_priceOracle == address(0)) revert InvalidAddress();
        if (_performanceOracle == address(0)) revert InvalidAddress();

        tokenRegistry = ITokenRegistry(_tokenRegistry);
        paymasterFactory = IPaymasterFactory(_paymasterFactory);
        priceOracle = IPriceOracle(_priceOracle);

        // Initialize performance oracle
        performanceOracles.push(_performanceOracle);
        isPerformanceOracle[_performanceOracle] = true;
    }

    // ============ Node Registration ============

    function registerNode(
        address stakingToken,
        uint256 stakeAmount,
        address rewardToken,
        string calldata rpcUrl,
        Region region
    ) external whenNotPaused returns (bytes32 nodeId) {
        // Check if agent registration is required
        if (requireAgentRegistration) revert AgentRequired();
        return _registerNodeInternal(stakingToken, stakeAmount, rewardToken, rpcUrl, region, 0);
    }

    /**
     * @notice Register a new node with ERC-8004 agent verification
     * @param stakingToken Token to stake (must be in TokenRegistry with paymaster)
     * @param stakeAmount Amount to stake
     * @param rewardToken Token operator wants rewards in
     * @param rpcUrl Node's RPC endpoint
     * @param region Geographic region
     * @param operatorAgentId ERC-8004 agent ID of the operator
     * @return nodeId Unique identifier for the node
     */
    function registerNodeWithAgent(
        address stakingToken,
        uint256 stakeAmount,
        address rewardToken,
        string calldata rpcUrl,
        Region region,
        uint256 operatorAgentId
    ) external whenNotPaused returns (bytes32 nodeId) {
        if (address(identityRegistry) == address(0)) revert InvalidAddress();
        if (!identityRegistry.agentExists(operatorAgentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(operatorAgentId) != msg.sender) revert NotAgentOwner();

        nodeId = _registerNodeInternal(stakingToken, stakeAmount, rewardToken, rpcUrl, region, operatorAgentId);

        // Track nodes by agent
        agentNodes[operatorAgentId].push(nodeId);

        return nodeId;
    }

    function _registerNodeInternal(
        address stakingToken,
        uint256 stakeAmount,
        address rewardToken,
        string calldata rpcUrl,
        Region region,
        uint256 operatorAgentId
    ) internal returns (bytes32 nodeId) {
        // 0. Basic validations
        if (stakeAmount == 0) revert ZeroStake();
        if (stakingToken == address(0) || rewardToken == address(0)) revert InvalidAddress();

        // 1. Validate tokens
        if (!tokenRegistry.isRegistered(stakingToken)) {
            revert TokenNotRegistered(stakingToken);
        }
        if (!tokenRegistry.isRegistered(rewardToken)) {
            revert TokenNotRegistered(rewardToken);
        }
        if (!paymasterFactory.hasPaymaster(stakingToken)) {
            revert NoPaymasterForToken(stakingToken);
        }
        if (!paymasterFactory.hasPaymaster(rewardToken)) {
            revert NoPaymasterForToken(rewardToken);
        }

        // 2. Calculate USD value
        uint256 tokenPrice = priceOracle.getPrice(stakingToken);
        if (tokenPrice == 0) revert("Invalid token price");
        uint256 stakeValueUSD = (stakeAmount * tokenPrice) / 1e18;

        if (stakeValueUSD < minStakeUSD) {
            revert InsufficientStakeValue(stakeValueUSD, minStakeUSD);
        }

        // 3. Check operator limits
        if (operatorStats[msg.sender].totalNodesActive >= maxNodesPerOperator) {
            revert TooManyNodes(operatorStats[msg.sender].totalNodesActive, maxNodesPerOperator);
        }

        // 4. Check network ownership limit (skip if first registration)
        uint256 newOperatorStakeUSD = operatorStats[msg.sender].totalStakedUSD + stakeValueUSD;
        uint256 newTotalStakedUSD = totalStakedUSD + stakeValueUSD;

        if (totalStakedUSD > 0) {
            uint256 ownershipBPS = (newOperatorStakeUSD * 10000) / newTotalStakedUSD;

            if (ownershipBPS > maxNetworkOwnershipBPS) {
                revert NetworkOwnershipExceeded(ownershipBPS, maxNetworkOwnershipBPS);
            }
        }

        // 5. Transfer staking token (using SafeERC20)
        IERC20(stakingToken).safeTransferFrom(msg.sender, address(this), stakeAmount);

        // 6. Generate node ID (with collision check)
        nodeId = keccak256(abi.encodePacked(msg.sender, rpcUrl, block.timestamp));
        if (nodes[nodeId].operator != address(0)) {
            // Collision (extremely unlikely) - add nonce
            nodeId = keccak256(abi.encodePacked(msg.sender, rpcUrl, block.timestamp, gasleft()));
        }

        // 7. Create node record
        nodes[nodeId] = NodeStake({
            nodeId: nodeId,
            operator: msg.sender,
            stakedToken: stakingToken,
            stakedAmount: stakeAmount,
            stakedValueUSD: stakeValueUSD,
            rewardToken: rewardToken,
            rpcUrl: rpcUrl,
            geographicRegion: region,
            registrationTime: block.timestamp,
            lastClaimTime: block.timestamp,
            totalRewardsClaimed: 0,
            operatorAgentId: operatorAgentId,
            isActive: true,
            isSlashed: false
        });

        // 8. Initialize performance (start at 100% uptime)
        performance[nodeId] = PerformanceMetrics({
            uptimeScore: 10000,
            requestsServed: 0,
            avgResponseTime: 0,
            lastUpdateTime: block.timestamp
        });

        // 9. Update tracking
        operatorNodes[msg.sender].push(nodeId);
        allNodeIds.push(nodeId);

        operatorStats[msg.sender].totalNodesActive++;
        operatorStats[msg.sender].totalStakedUSD += stakeValueUSD;

        tokenDistribution[stakingToken].totalStaked += stakeAmount;
        tokenDistribution[stakingToken].totalStakedUSD += stakeValueUSD;
        tokenDistribution[stakingToken].nodeCount++;

        nodesByRegion[region]++;
        totalStakedUSD += stakeValueUSD;

        emit NodeRegistered(nodeId, msg.sender, stakingToken, rewardToken, stakeAmount, stakeValueUSD);
    }

    // ============ Reward Claiming ============

    /// @custom:security CEI pattern: Update all state before external calls
    function claimRewards(bytes32 nodeId) external nonReentrant {
        NodeStake storage node = nodes[nodeId];

        // Validate
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (!node.isActive) revert NodeNotActive();
        if (node.isSlashed) revert NodeAlreadySlashed();

        uint256 elapsed = block.timestamp - node.registrationTime;
        if (elapsed < MIN_STAKING_PERIOD) {
            revert MinimumPeriodNotMet(elapsed, MIN_STAKING_PERIOD);
        }

        // Calculate rewards
        uint256 rewardsUSD = _calculateRewardsUSD(nodeId);
        if (rewardsUSD == 0) revert NothingToClaim();

        // Cache values before state changes
        address rewardToken = node.rewardToken;
        address stakedToken = node.stakedToken;

        // Convert to reward token
        uint256 rewardTokenPrice = priceOracle.getPrice(rewardToken);
        uint256 rewardAmount = (rewardsUSD * 1e18) / rewardTokenPrice;

        // Calculate paymaster fees (in ETH)
        uint256 rewardPaymasterFee = (rewardsUSD * paymasterRewardCutBPS) / 10000;
        uint256 stakingPaymasterFee = 0;

        // Only pay staking paymaster if different token
        if (stakedToken != rewardToken) {
            stakingPaymasterFee = (rewardsUSD * paymasterStakeCutBPS) / 10000;
        }

        uint256 totalFeesETH = _convertUSDToETH(rewardPaymasterFee + stakingPaymasterFee);

        // Check ETH balance
        if (address(this).balance < totalFeesETH) {
            revert InsufficientETHForFees();
        }

        // Get paymaster addresses before state updates
        address rewardPaymaster = paymasterFactory.getPaymaster(rewardToken);
        address stakingPaymaster = stakingPaymasterFee > 0 ? paymasterFactory.getPaymaster(stakedToken) : address(0);

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        node.lastClaimTime = block.timestamp;
        node.totalRewardsClaimed += rewardsUSD;
        operatorStats[msg.sender].lifetimeRewardsUSD += rewardsUSD;
        totalRewardsClaimedUSD += rewardsUSD;

        // Emit events before external calls
        emit RewardsClaimed(nodeId, msg.sender, rewardToken, rewardAmount, totalFeesETH);
        emit PaymasterFeeDistributed(rewardPaymaster, rewardPaymasterFee, "reward");
        if (stakingPaymasterFee > 0) {
            emit PaymasterFeeDistributed(stakingPaymaster, stakingPaymasterFee, "staking");
        }

        // INTERACTIONS: External calls last
        (bool success1,) = payable(rewardPaymaster).call{value: _convertUSDToETH(rewardPaymasterFee)}("");
        if (!success1) revert TransferFailed();

        if (stakingPaymasterFee > 0) {
            (bool success2,) = payable(stakingPaymaster).call{value: _convertUSDToETH(stakingPaymasterFee)}("");
            if (!success2) revert TransferFailed();
        }

        // Transfer rewards to operator
        IERC20(rewardToken).safeTransfer(msg.sender, rewardAmount);
    }

    // ============ Node Deregistration ============

    /// @custom:security CEI pattern: All state updates before external calls
    function deregisterNode(bytes32 nodeId) external nonReentrant {
        NodeStake storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (node.isSlashed) revert NodeAlreadySlashed();

        uint256 elapsed = block.timestamp - node.registrationTime;
        if (elapsed < MIN_STAKING_PERIOD) {
            revert MinimumPeriodNotMet(elapsed, MIN_STAKING_PERIOD);
        }

        // Cache ALL values before state changes
        address stakedToken = node.stakedToken;
        address rewardToken = node.rewardToken;
        uint256 stakedValueUSD = node.stakedValueUSD;
        Region geographicRegion = node.geographicRegion;
        bool wasActive = node.isActive;
        uint256 stakeToReturn = node.stakedAmount;

        // Calculate rewards WHILE node is still active (before state changes)
        uint256 rewardsUSD = _calculateRewardsUSD(nodeId);
        uint256 rewardAmount = 0;
        uint256 rewardFee = 0;
        uint256 stakeFee = 0;
        address rewardPaymasterAddr = address(0);
        address stakingPaymasterAddr = address(0);

        if (rewardsUSD > 0) {
            uint256 rewardTokenPrice = priceOracle.getPrice(rewardToken);
            if (rewardTokenPrice > 0) {
                rewardAmount = (rewardsUSD * 1e18) / rewardTokenPrice;
                rewardFee = (rewardsUSD * paymasterRewardCutBPS) / 10000;
                stakeFee = (stakedToken != rewardToken) ? (rewardsUSD * paymasterStakeCutBPS) / 10000 : 0;
                uint256 totalFees = _convertUSDToETH(rewardFee + stakeFee);

                if (address(this).balance >= totalFees) {
                    rewardPaymasterAddr = paymasterFactory.getPaymaster(rewardToken);
                    if (stakeFee > 0) {
                        stakingPaymasterAddr = paymasterFactory.getPaymaster(stakedToken);
                    }
                }
            }
        }

        // EFFECTS: Update ALL state BEFORE any external calls
        if (wasActive) {
            node.isActive = false;
            operatorStats[msg.sender].totalNodesActive--;
            operatorStats[msg.sender].totalStakedUSD -= stakedValueUSD;
            totalStakedUSD -= stakedValueUSD;
            tokenDistribution[stakedToken].totalStakedUSD -= stakedValueUSD;
            tokenDistribution[stakedToken].nodeCount--;
            nodesByRegion[geographicRegion]--;
        }
        node.stakedAmount = 0;

        // Update reward tracking
        if (rewardsUSD > 0) {
            node.lastClaimTime = block.timestamp;
            node.totalRewardsClaimed += rewardsUSD;
            operatorStats[msg.sender].lifetimeRewardsUSD += rewardsUSD;
            totalRewardsClaimedUSD += rewardsUSD;
        }

        // Emit events before external calls
        emit NodeDeregistered(nodeId, msg.sender);
        if (rewardsUSD > 0) {
            emit RewardsClaimed(nodeId, msg.sender, rewardToken, rewardAmount, _convertUSDToETH(rewardFee + stakeFee));
        }

        // INTERACTIONS: All external calls LAST
        // 1. Pay paymaster fees (best-effort, ignore failures)
        if (rewardPaymasterAddr != address(0)) {
            (bool success1,) = payable(rewardPaymasterAddr).call{value: _convertUSDToETH(rewardFee)}("");
            if (stakeFee > 0 && success1 && stakingPaymasterAddr != address(0)) {
                (bool success2,) = payable(stakingPaymasterAddr).call{value: _convertUSDToETH(stakeFee)}("");
                if (!success2) {} // Intentionally ignore - paymaster payment is best-effort
            }
        }

        // 2. Transfer rewards
        if (rewardAmount > 0) {
            IERC20(rewardToken).safeTransfer(msg.sender, rewardAmount);
        }

        // 3. Return stake
        IERC20(stakedToken).safeTransfer(msg.sender, stakeToReturn);
    }

    // ============ Performance Updates ============

    function updatePerformance(bytes32 nodeId, uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime)
        external
    {
        if (!isPerformanceOracle[msg.sender]) revert UnauthorizedOracle();

        NodeStake storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (!node.isActive) revert NodeNotActive();

        PerformanceMetrics storage perf = performance[nodeId];

        // Update metrics (EWMA: 80% old, 20% new)
        perf.uptimeScore = (perf.uptimeScore * 8 + uptimeScore * 2) / 10;
        perf.requestsServed = requestsServed;
        perf.avgResponseTime = avgResponseTime;
        perf.lastUpdateTime = block.timestamp;

        emit PerformanceUpdated(nodeId, perf.uptimeScore, perf.requestsServed, avgResponseTime);
    }

    // ============ Reward Calculation ============

    function calculatePendingRewards(bytes32 nodeId) external view returns (uint256) {
        return _calculateRewardsUSD(nodeId);
    }

    function _calculateRewardsUSD(bytes32 nodeId) internal view returns (uint256) {
        NodeStake storage node = nodes[nodeId];
        PerformanceMetrics storage perf = performance[nodeId];

        if (!node.isActive || node.isSlashed) return 0;

        // Time elapsed since last claim
        uint256 timeElapsed = block.timestamp - node.lastClaimTime;
        if (timeElapsed < 1 days) return 0; // Minimum 1 day between claims

        // Base reward (pro-rated for time)
        uint256 baseRewardUSD = (baseRewardPerMonthUSD * timeElapsed) / 30 days;

        // Uptime multiplier (0.5x - 2x)
        uint256 uptimeMultiplier = _calculateUptimeMultiplier(perf.uptimeScore);
        uint256 rewardWithUptime = (baseRewardUSD * uptimeMultiplier) / 10000;

        // Volume bonus ($0.01 per 1,000 requests)
        uint256 volumeBonusUSD = (perf.requestsServed / 1000) * volumeBonusPerThousandRequests;

        // Geographic bonus (+50% if underserved)
        uint256 geoBonusUSD = 0;
        if (_isUnderservedRegion(node.geographicRegion)) {
            geoBonusUSD = (rewardWithUptime * geographicBonusBPS) / 10000;
        }

        // V2: Token diversity bonus (hook for v2 feature)
        uint256 diversityBonusUSD = 0;
        if (tokenDiversityBonusEnabled) {
            diversityBonusUSD = _calculateTokenDiversityBonus(node.stakedToken, rewardWithUptime);
        }

        return rewardWithUptime + volumeBonusUSD + geoBonusUSD + diversityBonusUSD;
    }

    function _calculateUptimeMultiplier(uint256 uptimeScore) internal view returns (uint256) {
        if (uptimeScore < UPTIME_THRESHOLD) {
            // Below 99%: Linear from 0.5x to 1x
            return uptimeMultiplierMin + ((10000 - uptimeMultiplierMin) * uptimeScore) / UPTIME_THRESHOLD;
        } else {
            // Above 99%: Linear from 1x to 2x
            uint256 excessUptime = uptimeScore - UPTIME_THRESHOLD;
            uint256 maxExcess = 10000 - UPTIME_THRESHOLD;
            return 10000 + ((uptimeMultiplierMax - 10000) * excessUptime) / maxExcess;
        }
    }

    function _isUnderservedRegion(Region region) internal view returns (bool) {
        uint256 totalNodes = allNodeIds.length;
        if (totalNodes == 0) return false;

        uint256 regionNodes = nodesByRegion[region];

        // Underserved if <15% of total nodes
        return (regionNodes * 100 / totalNodes) < 15;
    }

    // V2: Token diversity bonus (implementation for future use)
    function _calculateTokenDiversityBonus(address token, uint256 baseReward) internal view returns (uint256) {
        if (!tokenDiversityBonusEnabled || totalStakedUSD == 0) return 0;

        uint256 tokenPercentage = (tokenDistribution[token].totalStakedUSD * 100) / totalStakedUSD;

        if (tokenPercentage < 5) {
            return (baseReward * 5000) / 10000; // +50% (very rare)
        } else if (tokenPercentage < 10) {
            return (baseReward * tokenDiversityBonusBPS) / 10000; // +25% (minority)
        } else if (tokenPercentage < 20) {
            return (baseReward * 1000) / 10000; // +10% (uncommon)
        }
        return 0;
    }

    // ============ Internal Helpers ============

    // ETH price constant (address(0) in oracle represents ETH)
    // Note: On OP-Stack chains like Jeju, WETH is 0x4200000000000000000000000000000000000006
    address public constant ETH_ADDRESS = address(0);

    function _convertUSDToETH(uint256 amountUSD) internal view returns (uint256) {
        uint256 ethPrice = priceOracle.getPrice(ETH_ADDRESS);
        if (ethPrice == 0) ethPrice = 3000e18; // Fallback to $3000 if oracle fails
        return (amountUSD * 1e18) / ethPrice;
    }

    // ============ View Functions ============

    function getNodeInfo(bytes32 nodeId)
        external
        view
        returns (NodeStake memory node, PerformanceMetrics memory perf, uint256 pendingRewardsUSD)
    {
        return (nodes[nodeId], performance[nodeId], _calculateRewardsUSD(nodeId));
    }

    function getOperatorNodes(address operator) external view returns (bytes32[] memory) {
        return operatorNodes[operator];
    }

    function getNetworkStats()
        external
        view
        returns (uint256 totalNodesActive, uint256 _totalStakedUSD, uint256 _totalRewardsClaimedUSD)
    {
        totalNodesActive = allNodeIds.length;
        _totalStakedUSD = totalStakedUSD;
        _totalRewardsClaimedUSD = totalRewardsClaimedUSD; // Use cached value, no loop
    }

    function getTokenDistribution(address token) external view returns (TokenDistribution memory) {
        return tokenDistribution[token];
    }

    function getOperatorStats(address operator) external view returns (OperatorStats memory) {
        return operatorStats[operator];
    }

    function getAllNodes() external view returns (bytes32[] memory) {
        return allNodeIds;
    }

    // ============ Admin Functions ============

    event ParameterUpdated(string parameter, uint256 oldValue, uint256 newValue);

    function setMinStakeUSD(uint256 newMinimum) external onlyOwner {
        uint256 oldValue = minStakeUSD;
        minStakeUSD = newMinimum;
        emit ParameterUpdated("minStakeUSD", oldValue, newMinimum);
    }

    error FeesTooHigh();

    function setPaymasterFees(uint256 rewardCutBPS, uint256 stakeCutBPS) external onlyOwner {
        if (rewardCutBPS + stakeCutBPS > 1000) revert FeesTooHigh();
        uint256 oldReward = paymasterRewardCutBPS;
        uint256 oldStake = paymasterStakeCutBPS;
        paymasterRewardCutBPS = rewardCutBPS;
        paymasterStakeCutBPS = stakeCutBPS;
        emit ParameterUpdated("paymasterRewardCutBPS", oldReward, rewardCutBPS);
        emit ParameterUpdated("paymasterStakeCutBPS", oldStake, stakeCutBPS);
    }

    function setGeographicBonus(uint256 newBonus) external onlyOwner {
        uint256 oldValue = geographicBonusBPS;
        geographicBonusBPS = newBonus;
        emit ParameterUpdated("geographicBonusBPS", oldValue, newBonus);
    }

    function setTokenDiversityBonus(uint256 newBonus) external onlyOwner {
        uint256 oldValue = tokenDiversityBonusBPS;
        tokenDiversityBonusBPS = newBonus;
        emit ParameterUpdated("tokenDiversityBonusBPS", oldValue, newBonus);
    }

    function setVolumeBonus(uint256 newBonus) external onlyOwner {
        uint256 oldValue = volumeBonusPerThousandRequests;
        volumeBonusPerThousandRequests = newBonus;
        emit ParameterUpdated("volumeBonusPerThousandRequests", oldValue, newBonus);
    }

    function addPerformanceOracle(address oracle) external onlyOwner {
        if (!isPerformanceOracle[oracle]) {
            performanceOracles.push(oracle);
            isPerformanceOracle[oracle] = true;
        }
    }

    function removePerformanceOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        isPerformanceOracle[oracle] = false;

        // Gas optimized: cache array length
        uint256 length = performanceOracles.length;
        for (uint256 i = 0; i < length; i++) {
            if (performanceOracles[i] == oracle) {
                performanceOracles[i] = performanceOracles[length - 1];
                performanceOracles.pop();
                break;
            }
        }
    }

    // V2: Enable token diversity bonus via governance
    function enableTokenDiversityBonus(bool enabled) external onlyOwner {
        tokenDiversityBonusEnabled = enabled;
    }

    // ============ ERC-8004 Integration ============

    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentRegistrationRequirementUpdated(bool required);

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Set whether agent registration is required for node operators
     * @param required True to require agent registration
     */
    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    /**
     * @notice Get all nodes operated by an ERC-8004 agent
     * @param agentId The agent ID to query
     * @return Array of node IDs
     */
    function getNodesByAgent(uint256 agentId) external view returns (bytes32[] memory) {
        return agentNodes[agentId];
    }

    /**
     * @notice Check if a node operator is a verified ERC-8004 agent
     * @param nodeId Node to check
     * @return True if operator is registered as an agent
     */
    function isVerifiedAgent(bytes32 nodeId) external view returns (bool) {
        uint256 agentId = nodes[nodeId].operatorAgentId;
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    function slashNode(bytes32 nodeId, uint256 slashPercentageBPS, string calldata reason) external onlyOwner {
        NodeStake storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);

        uint256 slashAmount = (node.stakedAmount * slashPercentageBPS) / 10000;
        node.stakedAmount -= slashAmount;
        node.isSlashed = true;
        node.isActive = false;

        // Slash amount goes to treasury
        IERC20(node.stakedToken).safeTransfer(owner(), slashAmount);

        emit NodeSlashed(nodeId, node.operator, slashAmount, reason);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawEmergency(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    // Allow contract to receive ETH for paymaster fees
    receive() external payable {}
}

// ============ External Interfaces (Minimal) ============

interface ITokenRegistry {
    function isRegistered(address token) external view returns (bool);
}

interface IPaymasterFactory {
    function hasPaymaster(address token) external view returns (bool);
    function getPaymaster(address token) external view returns (address);
}

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256);
}
