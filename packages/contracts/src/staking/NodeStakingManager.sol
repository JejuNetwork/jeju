// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INodeStakingManager} from "./INodeStakingManager.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {ITokenRegistry, IPaymasterFactory} from "../interfaces/IPaymaster.sol";
import {ISimplePriceOracle} from "../interfaces/IPriceOracle.sol";

/**
 * @title NodeStakingManager
 * @notice Multi-token staking system for Jeju node operators
 */
contract NodeStakingManager is INodeStakingManager, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ITokenRegistry public immutable tokenRegistry;
    IPaymasterFactory public immutable paymasterFactory;
    ISimplePriceOracle public immutable priceOracle;
    mapping(bytes32 => NodeStake) public nodes;
    mapping(address => bytes32[]) public operatorNodes;
    bytes32[] public allNodeIds;
    mapping(bytes32 => PerformanceMetrics) public performance;
    mapping(address => OperatorStats) public operatorStats;
    mapping(address => TokenDistribution) public tokenDistribution;
    uint256 public totalStakedUSD;
    uint256 public totalRewardsClaimedUSD;
    mapping(Region => uint256) public nodesByRegion;
    mapping(address => bool) public isPerformanceOracle;
    address[] public performanceOracles;
    IIdentityRegistry public identityRegistry;
    bool public requireAgentRegistration;
    mapping(uint256 => bytes32[]) public agentNodes;

    uint256 public minStakeUSD = 1000 ether;
    uint256 public baseRewardPerMonthUSD = 100 ether;
    uint256 public paymasterRewardCutBPS = 500;
    uint256 public paymasterStakeCutBPS = 200;
    uint256 public maxNodesPerOperator = 5;
    uint256 public maxNetworkOwnershipBPS = 2000; // SECURITY: 20% max per operator for decentralization
    uint256 public uptimeMultiplierMin = 5000;
    uint256 public uptimeMultiplierMax = 20000;
    uint256 public geographicBonusBPS = 5000;
    uint256 public volumeBonusPerThousandRequests = 0.01 ether;
    uint256 public tokenDiversityBonusBPS = 2500;

    bool public tokenDiversityBonusEnabled = false;

    uint256 public constant MIN_STAKING_PERIOD = 7 days;
    uint256 public constant UPTIME_THRESHOLD = 9900;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MONTH_DURATION = 30 days;
    uint256 public constant DAY_DURATION = 1 days;
    
    // SECURITY: Timelocks and limits
    uint256 public constant EMERGENCY_WITHDRAWAL_DELAY = 7 days;
    uint256 public constant SLASH_DISPUTE_PERIOD = 3 days;
    uint256 public constant MAX_NETWORK_OWNERSHIP_BPS = 2000; // 20% max per operator


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

    error InvalidAddress();
    error ZeroStake();
    error EmergencyWithdrawalPending();
    error EmergencyWithdrawalNotReady();
    error NoEmergencyWithdrawalPending();
    error SlashDisputePending();
    error SlashNotFound();
    error SlashAlreadyDisputed();
    error NotSlashDefendant();
    
    // SECURITY: Emergency withdrawal timelock
    struct EmergencyWithdrawal {
        address token;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
    }
    EmergencyWithdrawal public pendingEmergencyWithdrawal;
    
    // SECURITY: Slash dispute mechanism
    struct PendingSlash {
        bytes32 nodeId;
        uint256 slashPercentageBPS;
        string reason;
        uint256 proposedAt;
        uint256 executeAfter;
        bool executed;
        bool disputed;
    }
    mapping(bytes32 => PendingSlash) public pendingSlashes;
    uint256 private _slashCounter;
    
    event EmergencyWithdrawalProposed(address indexed token, uint256 amount, uint256 executeAfter);
    event EmergencyWithdrawalExecuted(address indexed token, uint256 amount);
    event EmergencyWithdrawalCancelled();
    event SlashProposed(bytes32 indexed slashId, bytes32 indexed nodeId, uint256 slashPercentageBPS, string reason);
    event SlashDisputed(bytes32 indexed slashId, bytes32 indexed nodeId);
    event SlashExecuted(bytes32 indexed slashId, bytes32 indexed nodeId, uint256 slashAmount);

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
        priceOracle = ISimplePriceOracle(_priceOracle);
        performanceOracles.push(_performanceOracle);
        isPerformanceOracle[_performanceOracle] = true;
    }

    function registerNode(
        address stakingToken,
        uint256 stakeAmount,
        address rewardToken,
        string calldata rpcUrl,
        Region region
    ) external whenNotPaused returns (bytes32 nodeId) {
        if (requireAgentRegistration) revert AgentRequired();
        return _registerNodeInternal(stakingToken, stakeAmount, rewardToken, rpcUrl, region, 0);
    }

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
        if (stakeAmount == 0) revert ZeroStake();
        if (stakingToken == address(0) || rewardToken == address(0)) revert InvalidAddress();

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

        uint256 tokenPrice = priceOracle.getPrice(stakingToken);
        if (tokenPrice == 0) revert("Invalid token price");
        uint256 stakeValueUSD = (stakeAmount * tokenPrice) / 1e18;

        if (stakeValueUSD < minStakeUSD) {
            revert InsufficientStakeValue(stakeValueUSD, minStakeUSD);
        }

        if (operatorStats[msg.sender].totalNodesActive >= maxNodesPerOperator) {
            revert TooManyNodes(operatorStats[msg.sender].totalNodesActive, maxNodesPerOperator);
        }

        uint256 newOperatorStakeUSD = operatorStats[msg.sender].totalStakedUSD + stakeValueUSD;
        uint256 newTotalStakedUSD = totalStakedUSD + stakeValueUSD;

        if (totalStakedUSD > 0) {
            uint256 ownershipBPS = (newOperatorStakeUSD * 10000) / newTotalStakedUSD;

            if (ownershipBPS > maxNetworkOwnershipBPS) {
                revert NetworkOwnershipExceeded(ownershipBPS, maxNetworkOwnershipBPS);
            }
        }

        IERC20(stakingToken).safeTransferFrom(msg.sender, address(this), stakeAmount);

        nodeId = keccak256(abi.encodePacked(msg.sender, rpcUrl, block.timestamp));
        if (nodes[nodeId].operator != address(0)) {
            nodeId = keccak256(abi.encodePacked(msg.sender, rpcUrl, block.timestamp, gasleft()));
        }

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

        performance[nodeId] = PerformanceMetrics({
            uptimeScore: 10000,
            requestsServed: 0,
            avgResponseTime: 0,
            lastUpdateTime: block.timestamp
        });

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

    function claimRewards(bytes32 nodeId) external nonReentrant {
        NodeStake storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (!node.isActive) revert NodeNotActive();
        if (node.isSlashed) revert NodeAlreadySlashed();

        uint256 elapsed = block.timestamp - node.registrationTime;
        if (elapsed < MIN_STAKING_PERIOD) {
            revert MinimumPeriodNotMet(elapsed, MIN_STAKING_PERIOD);
        }

        uint256 rewardsUSD = _calculateRewardsUSD(nodeId);
        if (rewardsUSD == 0) revert NothingToClaim();

        address rewardToken = node.rewardToken;
        address stakedToken = node.stakedToken;
        uint256 rewardTokenPrice = priceOracle.getPrice(rewardToken);
        uint256 rewardAmount = (rewardsUSD * 1e18) / rewardTokenPrice;

        uint256 rewardPaymasterFee = (rewardsUSD * paymasterRewardCutBPS) / 10000;
        uint256 stakingPaymasterFee = 0;

        if (stakedToken != rewardToken) {
            stakingPaymasterFee = (rewardsUSD * paymasterStakeCutBPS) / 10000;
        }

        uint256 totalFeesETH = _convertUSDToETH(rewardPaymasterFee + stakingPaymasterFee);

        if (address(this).balance < totalFeesETH) {
            revert InsufficientETHForFees();
        }

        address rewardPaymaster = paymasterFactory.getPaymaster(rewardToken);
        address stakingPaymaster = stakingPaymasterFee > 0 ? paymasterFactory.getPaymaster(stakedToken) : address(0);

        node.lastClaimTime = block.timestamp;
        node.totalRewardsClaimed += rewardsUSD;
        operatorStats[msg.sender].lifetimeRewardsUSD += rewardsUSD;
        totalRewardsClaimedUSD += rewardsUSD;

        emit RewardsClaimed(nodeId, msg.sender, rewardToken, rewardAmount, totalFeesETH);
        emit PaymasterFeeDistributed(rewardPaymaster, rewardPaymasterFee, "reward");
        if (stakingPaymasterFee > 0) {
            emit PaymasterFeeDistributed(stakingPaymaster, stakingPaymasterFee, "staking");
        }

        // Validate paymaster addresses before transfer
        if (rewardPaymaster == address(0)) revert InvalidAddress();
        
        uint256 rewardFeeETH = _convertUSDToETH(rewardPaymasterFee);
        (bool success1,) = payable(rewardPaymaster).call{value: rewardFeeETH}("");
        if (!success1) revert TransferFailed();

        if (stakingPaymasterFee > 0) {
            if (stakingPaymaster == address(0)) revert InvalidAddress();
            uint256 stakeFeeETH = _convertUSDToETH(stakingPaymasterFee);
            (bool success2,) = payable(stakingPaymaster).call{value: stakeFeeETH}("");
            if (!success2) revert TransferFailed();
        }

        IERC20(rewardToken).safeTransfer(msg.sender, rewardAmount);
    }

    function deregisterNode(bytes32 nodeId) external nonReentrant {
        NodeStake storage node = nodes[nodeId];

        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (node.operator != msg.sender) revert Unauthorized();
        if (node.isSlashed) revert NodeAlreadySlashed();

        uint256 elapsed = block.timestamp - node.registrationTime;
        if (elapsed < MIN_STAKING_PERIOD) {
            revert MinimumPeriodNotMet(elapsed, MIN_STAKING_PERIOD);
        }

        address stakedToken = node.stakedToken;
        address rewardToken = node.rewardToken;
        uint256 stakedValueUSD = node.stakedValueUSD;
        Region geographicRegion = node.geographicRegion;
        bool wasActive = node.isActive;
        uint256 stakeToReturn = node.stakedAmount;

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

        if (rewardsUSD > 0) {
            node.lastClaimTime = block.timestamp;
            node.totalRewardsClaimed += rewardsUSD;
            operatorStats[msg.sender].lifetimeRewardsUSD += rewardsUSD;
            totalRewardsClaimedUSD += rewardsUSD;
        }

        emit NodeDeregistered(nodeId, msg.sender);
        if (rewardsUSD > 0) {
            emit RewardsClaimed(nodeId, msg.sender, rewardToken, rewardAmount, _convertUSDToETH(rewardFee + stakeFee));
        }

        // Transfer paymaster fees - these are optional and best-effort
        // We don't revert on failure to ensure node deregistration completes
        if (rewardPaymasterAddr != address(0) && rewardFee > 0) {
            uint256 rewardFeeETH = _convertUSDToETH(rewardFee);
            if (address(this).balance >= rewardFeeETH) {
                (bool success1,) = payable(rewardPaymasterAddr).call{value: rewardFeeETH}("");
                // Continue even if this fails - deregistration should not be blocked
                if (success1 && stakeFee > 0 && stakingPaymasterAddr != address(0)) {
                    uint256 stakeFeeETH = _convertUSDToETH(stakeFee);
                    if (address(this).balance >= stakeFeeETH) {
                        // Best-effort transfer to staking paymaster - ignore return value intentionally
                        (bool success2,) = payable(stakingPaymasterAddr).call{value: stakeFeeETH}("");
                        success2; // Silence unused variable warning - intentionally ignoring result
                    }
                }
            }
        }

        if (rewardAmount > 0) {
            IERC20(rewardToken).safeTransfer(msg.sender, rewardAmount);
        }

        IERC20(stakedToken).safeTransfer(msg.sender, stakeToReturn);
    }

    function updatePerformance(bytes32 nodeId, uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime)
        external
    {
        if (!isPerformanceOracle[msg.sender]) revert UnauthorizedOracle();

        NodeStake storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        if (!node.isActive) revert NodeNotActive();

        PerformanceMetrics storage perf = performance[nodeId];
        perf.uptimeScore = (perf.uptimeScore * 8 + uptimeScore * 2) / 10;
        perf.requestsServed = requestsServed;
        perf.avgResponseTime = avgResponseTime;
        perf.lastUpdateTime = block.timestamp;

        emit PerformanceUpdated(nodeId, perf.uptimeScore, perf.requestsServed, avgResponseTime);
    }

    function calculatePendingRewards(bytes32 nodeId) external view returns (uint256) {
        return _calculateRewardsUSD(nodeId);
    }

    function _calculateRewardsUSD(bytes32 nodeId) internal view returns (uint256) {
        NodeStake storage node = nodes[nodeId];
        PerformanceMetrics storage perf = performance[nodeId];

        if (!node.isActive || node.isSlashed) return 0;

        uint256 timeElapsed = block.timestamp - node.lastClaimTime;
        if (timeElapsed < 1 days) return 0;

        uint256 baseRewardUSD = (baseRewardPerMonthUSD * timeElapsed) / 30 days;
        uint256 uptimeMultiplier = _calculateUptimeMultiplier(perf.uptimeScore);
        uint256 rewardWithUptime = (baseRewardUSD * uptimeMultiplier) / 10000;
        uint256 volumeBonusUSD = (perf.requestsServed / 1000) * volumeBonusPerThousandRequests;

        uint256 geoBonusUSD = 0;
        if (_isUnderservedRegion(node.geographicRegion)) {
            geoBonusUSD = (rewardWithUptime * geographicBonusBPS) / 10000;
        }

        uint256 diversityBonusUSD = 0;
        if (tokenDiversityBonusEnabled) {
            diversityBonusUSD = _calculateTokenDiversityBonus(node.stakedToken, rewardWithUptime);
        }

        return rewardWithUptime + volumeBonusUSD + geoBonusUSD + diversityBonusUSD;
    }

    function _calculateUptimeMultiplier(uint256 uptimeScore) internal view returns (uint256) {
        if (uptimeScore < UPTIME_THRESHOLD) {
            return uptimeMultiplierMin + ((10000 - uptimeMultiplierMin) * uptimeScore) / UPTIME_THRESHOLD;
        } else {
            uint256 excessUptime = uptimeScore - UPTIME_THRESHOLD;
            uint256 maxExcess = 10000 - UPTIME_THRESHOLD;
            return 10000 + ((uptimeMultiplierMax - 10000) * excessUptime) / maxExcess;
        }
    }

    function _isUnderservedRegion(Region region) internal view returns (bool) {
        uint256 totalNodes = allNodeIds.length;
        if (totalNodes == 0) return false;

        uint256 regionNodes = nodesByRegion[region];
        return (regionNodes * 100 / totalNodes) < 15;
    }

    function _calculateTokenDiversityBonus(address token, uint256 baseReward) internal view returns (uint256) {
        if (!tokenDiversityBonusEnabled || totalStakedUSD == 0) return 0;

        uint256 tokenPercentage = (tokenDistribution[token].totalStakedUSD * 100) / totalStakedUSD;

        if (tokenPercentage < 5) {
            return (baseReward * 5000) / 10000;
        } else if (tokenPercentage < 10) {
            return (baseReward * tokenDiversityBonusBPS) / 10000;
        } else if (tokenPercentage < 20) {
            return (baseReward * 1000) / 10000;
        }
        return 0;
    }

    address public constant ETH_ADDRESS = address(0);

    function _convertUSDToETH(uint256 amountUSD) internal view returns (uint256) {
        uint256 ethPrice = priceOracle.getPrice(ETH_ADDRESS);
        if (ethPrice == 0) ethPrice = 3000e18;
        return (amountUSD * 1e18) / ethPrice;
    }

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

        uint256 length = performanceOracles.length;
        for (uint256 i = 0; i < length; i++) {
            if (performanceOracles[i] == oracle) {
                performanceOracles[i] = performanceOracles[length - 1];
                performanceOracles.pop();
                break;
            }
        }
    }

    function enableTokenDiversityBonus(bool enabled) external onlyOwner {
        tokenDiversityBonusEnabled = enabled;
    }

    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentRegistrationRequirementUpdated(bool required);

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    function getNodesByAgent(uint256 agentId) external view returns (bytes32[] memory) {
        return agentNodes[agentId];
    }

    function isVerifiedAgent(bytes32 nodeId) external view returns (bool) {
        uint256 agentId = nodes[nodeId].operatorAgentId;
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    /// @notice Propose a slash - requires SLASH_DISPUTE_PERIOD before execution
    /// @dev SECURITY: Operators can dispute slashes during the dispute period
    function proposeSlash(bytes32 nodeId, uint256 slashPercentageBPS, string calldata reason) public onlyOwner returns (bytes32 slashId) {
        NodeStake storage node = nodes[nodeId];
        if (node.operator == address(0)) revert NodeNotFound(nodeId);
        
        slashId = keccak256(abi.encodePacked(nodeId, _slashCounter++, block.timestamp));
        
        pendingSlashes[slashId] = PendingSlash({
            nodeId: nodeId,
            slashPercentageBPS: slashPercentageBPS,
            reason: reason,
            proposedAt: block.timestamp,
            executeAfter: block.timestamp + SLASH_DISPUTE_PERIOD,
            executed: false,
            disputed: false
        });
        
        emit SlashProposed(slashId, nodeId, slashPercentageBPS, reason);
    }
    
    /// @notice Dispute a pending slash - only the node operator can dispute
    function disputeSlash(bytes32 slashId) external {
        PendingSlash storage slash = pendingSlashes[slashId];
        if (slash.proposedAt == 0) revert SlashNotFound();
        if (slash.executed) revert SlashNotFound();
        if (slash.disputed) revert SlashAlreadyDisputed();
        
        NodeStake storage node = nodes[slash.nodeId];
        if (node.operator != msg.sender) revert NotSlashDefendant();
        
        slash.disputed = true;
        emit SlashDisputed(slashId, slash.nodeId);
    }
    
    /// @notice Execute a slash after dispute period - cannot execute if disputed
    function executeSlash(bytes32 slashId) external onlyOwner {
        PendingSlash storage slash = pendingSlashes[slashId];
        if (slash.proposedAt == 0) revert SlashNotFound();
        if (slash.executed) revert SlashNotFound();
        if (slash.disputed) revert SlashDisputePending();
        if (block.timestamp < slash.executeAfter) revert SlashDisputePending();
        
        NodeStake storage node = nodes[slash.nodeId];
        if (node.operator == address(0)) revert NodeNotFound(slash.nodeId);

        uint256 slashAmount = (node.stakedAmount * slash.slashPercentageBPS) / 10000;
        node.stakedAmount -= slashAmount;
        node.isSlashed = true;
        node.isActive = false;
        slash.executed = true;

        IERC20(node.stakedToken).safeTransfer(owner(), slashAmount);

        emit SlashExecuted(slashId, slash.nodeId, slashAmount);
        emit NodeSlashed(slash.nodeId, node.operator, slashAmount, slash.reason);
    }
    
    /// @notice Legacy slashNode kept for backwards compatibility - now requires dispute period
    function slashNode(bytes32 nodeId, uint256 slashPercentageBPS, string calldata reason) external onlyOwner {
        proposeSlash(nodeId, slashPercentageBPS, reason);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Propose an emergency withdrawal - requires 7-day timelock
    /// @dev SECURITY: Prevents instant rugpull of staked funds
    function proposeEmergencyWithdrawal(address token, uint256 amount) public onlyOwner {
        if (pendingEmergencyWithdrawal.executeAfter > 0 && !pendingEmergencyWithdrawal.executed) {
            revert EmergencyWithdrawalPending();
        }
        
        pendingEmergencyWithdrawal = EmergencyWithdrawal({
            token: token,
            amount: amount,
            executeAfter: block.timestamp + EMERGENCY_WITHDRAWAL_DELAY,
            executed: false
        });
        
        emit EmergencyWithdrawalProposed(token, amount, pendingEmergencyWithdrawal.executeAfter);
    }
    
    /// @notice Execute emergency withdrawal after timelock expires
    function executeEmergencyWithdrawal() external onlyOwner {
        if (pendingEmergencyWithdrawal.executeAfter == 0) revert NoEmergencyWithdrawalPending();
        if (pendingEmergencyWithdrawal.executed) revert NoEmergencyWithdrawalPending();
        if (block.timestamp < pendingEmergencyWithdrawal.executeAfter) revert EmergencyWithdrawalNotReady();
        
        pendingEmergencyWithdrawal.executed = true;
        
        IERC20(pendingEmergencyWithdrawal.token).safeTransfer(owner(), pendingEmergencyWithdrawal.amount);
        
        emit EmergencyWithdrawalExecuted(pendingEmergencyWithdrawal.token, pendingEmergencyWithdrawal.amount);
    }
    
    /// @notice Cancel a pending emergency withdrawal
    function cancelEmergencyWithdrawal() external onlyOwner {
        if (pendingEmergencyWithdrawal.executeAfter == 0) revert NoEmergencyWithdrawalPending();
        if (pendingEmergencyWithdrawal.executed) revert NoEmergencyWithdrawalPending();
        
        delete pendingEmergencyWithdrawal;
        emit EmergencyWithdrawalCancelled();
    }
    
    /// @notice Legacy withdrawEmergency - now requires timelock
    function withdrawEmergency(address token, uint256 amount) external onlyOwner {
        proposeEmergencyWithdrawal(token, amount);
    }

    receive() external payable {}
}
