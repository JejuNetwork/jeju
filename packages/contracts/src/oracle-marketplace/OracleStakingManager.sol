// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOracleStakingManager} from "./interfaces/IOracleStakingManager.sol";
import {ITokenRegistry} from "../interfaces/IPaymaster.sol";
import {ISimplePriceOracle} from "../interfaces/IPriceOracle.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "../registry/interfaces/IReputationRegistry.sol";

/**
 * @title OracleStakingManager
 * @notice Decentralized oracle network with staking and reputation-weighted consensus
 */
contract OracleStakingManager is IOracleStakingManager, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_ORACLES_FOR_CONSENSUS = 3;
    uint256 public constant UNBONDING_PERIOD = 7 days;
    uint256 public constant SUBMISSION_WINDOW = 1 hours;
    uint256 public constant SLASH_DEVIATION_BPS = 100; // 1% deviation = slash
    uint256 public constant MAX_SLASH_BPS = 5000; // Max 50% slash
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant ACCURACY_BOOST_MAX = 15000; // 1.5x for perfect accuracy

    ITokenRegistry public immutable tokenRegistry;
    ISimplePriceOracle public immutable priceOracle;

    IIdentityRegistry public identityRegistry;
    IReputationRegistry public reputationRegistry;

    // Oracle storage
    mapping(bytes32 => OracleNode) public oracles;
    mapping(address => bytes32[]) public operatorOracles;
    bytes32[] public allOracleIds;
    bytes32[] public activeOracleIds;

    // Market storage
    mapping(bytes32 => MarketConfig) public markets;
    bytes32[] public allMarketIds;

    // Price submissions: marketId => oracleId => submission
    mapping(bytes32 => mapping(bytes32 => PriceSubmission)) public submissions;

    // Consensus prices: marketId => consensus
    mapping(bytes32 => ConsensusPrice) public consensusPrices;

    // Round tracking: marketId => current round
    mapping(bytes32 => uint256) public currentRound;

    // Submissions per round: marketId => round => oracleIds
    mapping(bytes32 => mapping(uint256 => bytes32[])) public roundSubmissions;

    // Network stats
    uint256 public totalStakedUSD;
    uint256 public totalSlashedUSD;

    // Parameters
    uint256 public minStakeUSD = 1000 ether; // $1,000 minimum

    error InvalidAddress();
    error TokenNotRegistered();
    error InsufficientStake(uint256 provided, uint256 required);
    error OracleNotFound();
    error NotOracleOperator();
    error OracleNotActive();
    error OracleAlreadyActive();
    error UnbondingNotStarted();
    error UnbondingNotComplete();
    error UnbondingInProgress();
    error MarketNotFound();
    error MarketNotActive();
    error MarketAlreadyExists();
    error InvalidPrice();
    error SubmissionTooFrequent();
    error ArrayLengthMismatch();
    error InsufficientOracles();
    error NotAgentOwner();
    error ZeroAmount();

    constructor(address _tokenRegistry, address _priceOracle, address initialOwner) Ownable(initialOwner) {
        if (_tokenRegistry == address(0)) revert InvalidAddress();
        if (_priceOracle == address(0)) revert InvalidAddress();

        tokenRegistry = ITokenRegistry(_tokenRegistry);
        priceOracle = ISimplePriceOracle(_priceOracle);
    }

    function registerOracle(address stakingToken, uint256 stakeAmount, uint256 reputationAgentId)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 oracleId)
    {
        if (stakeAmount == 0) revert ZeroAmount();
        if (!tokenRegistry.isRegistered(stakingToken)) revert TokenNotRegistered();

        // Calculate USD value
        uint256 tokenPrice = priceOracle.getPrice(stakingToken);
        uint256 stakeValueUSD = (stakeAmount * tokenPrice) / 1e18;

        if (stakeValueUSD < minStakeUSD) {
            revert InsufficientStake(stakeValueUSD, minStakeUSD);
        }

        // Validate reputation agent if provided
        uint256 reputationScore = 50; // Default middle score
        if (reputationAgentId > 0 && address(identityRegistry) != address(0)) {
            if (!identityRegistry.agentExists(reputationAgentId)) {
                revert InvalidAddress();
            }
            if (identityRegistry.ownerOf(reputationAgentId) != msg.sender) {
                revert NotAgentOwner();
            }
            // Get reputation score from registry
            reputationScore = _getReputationScore(reputationAgentId);
        }

        // Generate oracle ID
        oracleId = keccak256(abi.encodePacked(msg.sender, stakingToken, block.timestamp));

        // Transfer stake
        IERC20(stakingToken).safeTransferFrom(msg.sender, address(this), stakeAmount);

        // Create oracle record
        oracles[oracleId] = OracleNode({
            oracleId: oracleId,
            operator: msg.sender,
            stakedToken: stakingToken,
            stakedAmount: stakeAmount,
            stakedValueUSD: stakeValueUSD,
            reputationAgentId: reputationAgentId,
            reputationScore: reputationScore,
            accuracyScore: 10000, // Start at 100% accuracy
            totalSubmissions: 0,
            validSubmissions: 0,
            registrationTime: block.timestamp,
            lastSubmissionTime: 0,
            unbondingStartTime: 0,
            status: OracleStatus.Active
        });

        // Track
        operatorOracles[msg.sender].push(oracleId);
        allOracleIds.push(oracleId);
        activeOracleIds.push(oracleId);
        totalStakedUSD += stakeValueUSD;

        emit OracleRegistered(oracleId, msg.sender, stakingToken, stakeAmount, stakeValueUSD);
    }

    function startUnbonding(bytes32 oracleId) external nonReentrant {
        OracleNode storage oracle = oracles[oracleId];

        if (oracle.operator == address(0)) revert OracleNotFound();
        if (oracle.operator != msg.sender) revert NotOracleOperator();
        if (oracle.status != OracleStatus.Active) revert OracleNotActive();

        oracle.status = OracleStatus.Unbonding;
        oracle.unbondingStartTime = block.timestamp;

        // Remove from active list
        _removeFromActiveList(oracleId);

        emit UnbondingStarted(oracleId, msg.sender, oracle.stakedAmount, block.timestamp + UNBONDING_PERIOD);
    }

    function completeUnbonding(bytes32 oracleId) external nonReentrant {
        OracleNode storage oracle = oracles[oracleId];

        if (oracle.operator == address(0)) revert OracleNotFound();
        if (oracle.operator != msg.sender) revert NotOracleOperator();
        if (oracle.status != OracleStatus.Unbonding) revert UnbondingNotStarted();
        if (block.timestamp < oracle.unbondingStartTime + UNBONDING_PERIOD) {
            revert UnbondingNotComplete();
        }

        uint256 stakeToReturn = oracle.stakedAmount;
        address stakingToken = oracle.stakedToken;

        // Update state
        oracle.status = OracleStatus.Inactive;
        totalStakedUSD -= oracle.stakedValueUSD;
        oracle.stakedAmount = 0;
        oracle.stakedValueUSD = 0;

        // Transfer stake back
        IERC20(stakingToken).safeTransfer(msg.sender, stakeToReturn);

        emit StakeWithdrawn(oracleId, msg.sender, stakeToReturn);
        emit OracleDeregistered(oracleId, msg.sender);
    }

    function addStake(bytes32 oracleId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        OracleNode storage oracle = oracles[oracleId];

        if (oracle.operator == address(0)) revert OracleNotFound();
        if (oracle.operator != msg.sender) revert NotOracleOperator();
        if (oracle.status == OracleStatus.Slashed) revert OracleNotActive();

        // Transfer additional stake
        IERC20(oracle.stakedToken).safeTransferFrom(msg.sender, address(this), amount);

        // Update stake values
        uint256 tokenPrice = priceOracle.getPrice(oracle.stakedToken);
        uint256 additionalValueUSD = (amount * tokenPrice) / 1e18;

        oracle.stakedAmount += amount;
        oracle.stakedValueUSD += additionalValueUSD;
        totalStakedUSD += additionalValueUSD;

        // If unbonding, can cancel by adding stake
        if (oracle.status == OracleStatus.Unbonding) {
            oracle.status = OracleStatus.Active;
            oracle.unbondingStartTime = 0;
            activeOracleIds.push(oracleId);
        }
    }

    function submitPrice(bytes32 oracleId, bytes32 marketId, uint256 price) external nonReentrant whenNotPaused {
        _submitPrice(oracleId, marketId, price);
    }

    function submitPricesBatch(bytes32 oracleId, bytes32[] calldata marketIds, uint256[] calldata prices)
        external
        nonReentrant
        whenNotPaused
    {
        if (marketIds.length != prices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < marketIds.length; i++) {
            _submitPrice(oracleId, marketIds[i], prices[i]);
        }
    }

    function _submitPrice(bytes32 oracleId, bytes32 marketId, uint256 price) internal {
        OracleNode storage oracle = oracles[oracleId];
        MarketConfig storage market = markets[marketId];

        if (oracle.operator == address(0)) revert OracleNotFound();
        if (oracle.operator != msg.sender) revert NotOracleOperator();
        if (oracle.status != OracleStatus.Active) revert OracleNotActive();
        if (!market.isActive) revert MarketNotActive();
        if (price == 0) revert InvalidPrice();

        // Check submission frequency (min 10 seconds between submissions per market)
        PriceSubmission storage lastSub = submissions[marketId][oracleId];
        if (lastSub.timestamp > 0 && block.timestamp < lastSub.timestamp + 10) {
            revert SubmissionTooFrequent();
        }

        // Store submission
        submissions[marketId][oracleId] = PriceSubmission({
            price: price,
            timestamp: block.timestamp,
            blockNumber: block.number,
            oracle: oracle.operator,
            included: false
        });

        // Track in current round
        uint256 round = currentRound[marketId];
        roundSubmissions[marketId][round].push(oracleId);

        oracle.totalSubmissions++;
        oracle.lastSubmissionTime = block.timestamp;

        emit PriceSubmitted(marketId, oracleId, price, block.timestamp);

        // Try to reach consensus
        _tryReachConsensus(marketId);
    }

    function _tryReachConsensus(bytes32 marketId) internal {
        MarketConfig storage market = markets[marketId];
        uint256 round = currentRound[marketId];
        bytes32[] storage roundOracles = roundSubmissions[marketId][round];

        // Need minimum oracles
        if (roundOracles.length < market.minOracles) return;

        // Collect valid submissions within window
        uint256 validCount = 0;
        uint256[] memory prices = new uint256[](roundOracles.length);
        uint256[] memory weights = new uint256[](roundOracles.length);
        bytes32[] memory validOracleIds = new bytes32[](roundOracles.length);

        uint256 cutoffTime = block.timestamp > SUBMISSION_WINDOW ? block.timestamp - SUBMISSION_WINDOW : 0;

        for (uint256 i = 0; i < roundOracles.length; i++) {
            bytes32 oid = roundOracles[i];
            PriceSubmission storage sub = submissions[marketId][oid];

            if (sub.timestamp >= cutoffTime && !sub.included) {
                prices[validCount] = sub.price;
                weights[validCount] = _calculateOracleWeight(oid);
                validOracleIds[validCount] = oid;
                validCount++;
            }
        }

        if (validCount < market.minOracles) return;

        // Calculate weighted median
        uint256 consensusPrice = _calculateWeightedMedian(prices, weights, validCount);

        // Calculate confidence based on agreement
        uint256 confidence = _calculateConfidence(prices, consensusPrice, validCount);

        // Update consensus
        consensusPrices[marketId] = ConsensusPrice({
            price: consensusPrice,
            timestamp: block.timestamp,
            oracleCount: validCount,
            confidence: confidence
        });

        // Mark submissions as included and update accuracy
        for (uint256 i = 0; i < validCount; i++) {
            bytes32 oid = validOracleIds[i];
            submissions[marketId][oid].included = true;

            // Check deviation and update accuracy/slash
            uint256 deviation = _calculateDeviation(prices[i], consensusPrice);
            _updateOracleAccuracy(oid, deviation);

            if (deviation > SLASH_DEVIATION_BPS) {
                _slashForDeviation(oid, deviation);
            } else {
                // Valid submission
                oracles[oid].validSubmissions++;
            }
        }

        // Start new round
        currentRound[marketId]++;

        emit ConsensusReached(marketId, consensusPrice, validCount, confidence);
    }

    function _calculateOracleWeight(bytes32 oracleId) internal view returns (uint256) {
        OracleNode storage oracle = oracles[oracleId];

        // Weight = sqrt(stakeUSD) * (50 + reputation/2) * accuracyMultiplier
        // This gives roughly equal weight to stake and reputation

        // sqrt approximation for stake (stake in USD, 18 decimals)
        // Divide first to avoid overflow, then take sqrt
        uint256 stakeUSD = oracle.stakedValueUSD / 1e18; // Convert to whole dollars
        uint256 sqrtStake = _sqrt(stakeUSD);
        if (sqrtStake == 0) sqrtStake = 1; // Minimum 1

        // Reputation factor: 50-100 based on 0-100 score
        uint256 reputationFactor = 50 + (oracle.reputationScore / 2);

        // Accuracy factor: 5000-15000 (0.5x - 1.5x scaled by 10000)
        uint256 accuracyFactor = (oracle.accuracyScore * ACCURACY_BOOST_MAX) / BPS_DENOMINATOR;
        if (accuracyFactor < 5000) accuracyFactor = 5000; // Minimum 0.5x

        // Combine factors: sqrtStake * repFactor * accFactor / 10000
        // Scale to reasonable numbers to avoid overflow
        return (sqrtStake * reputationFactor * accuracyFactor) / BPS_DENOMINATOR;
    }

    function _calculateWeightedMedian(uint256[] memory prices, uint256[] memory weights, uint256 count)
        internal
        pure
        returns (uint256)
    {
        // Sort prices with weights (bubble sort - fine for small N)
        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    // Swap prices
                    (prices[j], prices[j + 1]) = (prices[j + 1], prices[j]);
                    // Swap weights
                    (weights[j], weights[j + 1]) = (weights[j + 1], weights[j]);
                }
            }
        }

        // Calculate total weight
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < count; i++) {
            totalWeight += weights[i];
        }

        // Find weighted median
        uint256 halfWeight = totalWeight / 2;
        uint256 cumulativeWeight = 0;

        for (uint256 i = 0; i < count; i++) {
            cumulativeWeight += weights[i];
            if (cumulativeWeight >= halfWeight) {
                return prices[i];
            }
        }

        // Fallback to last price (shouldn't happen)
        return prices[count - 1];
    }

    function _calculateConfidence(uint256[] memory prices, uint256 median, uint256 count)
        internal
        pure
        returns (uint256)
    {
        // Confidence = how many oracles are within 0.5% of median
        uint256 agreementCount = 0;
        uint256 threshold = median / 200; // 0.5%

        for (uint256 i = 0; i < count; i++) {
            uint256 diff = prices[i] > median ? prices[i] - median : median - prices[i];
            if (diff <= threshold) {
                agreementCount++;
            }
        }

        return (agreementCount * BPS_DENOMINATOR) / count;
    }

    function _calculateDeviation(uint256 price, uint256 median) internal pure returns (uint256) {
        uint256 diff = price > median ? price - median : median - price;
        return (diff * BPS_DENOMINATOR) / median;
    }

    function _updateOracleAccuracy(bytes32 oracleId, uint256 deviationBps) internal {
        OracleNode storage oracle = oracles[oracleId];

        // EWMA accuracy update: 90% old, 10% new
        // If deviation < 0.5%, full accuracy. Otherwise reduce proportionally.
        uint256 newAccuracy;
        if (deviationBps < 50) {
            newAccuracy = 10000; // Perfect
        } else if (deviationBps < 100) {
            newAccuracy = 9500; // Good
        } else if (deviationBps < 200) {
            newAccuracy = 9000; // Acceptable
        } else if (deviationBps < 800) {
            // Safe subtraction: deviationBps is 200-799, so deviationBps*10 is 2000-7990
            uint256 penalty = deviationBps * 10;
            newAccuracy = penalty < 8000 ? 8000 - penalty : 0;
        } else {
            newAccuracy = 0; // Severe deviation
        }

        oracle.accuracyScore = (oracle.accuracyScore * 9 + newAccuracy) / 10;
    }

    function _slashForDeviation(bytes32 oracleId, uint256 deviationBps) internal {
        OracleNode storage oracle = oracles[oracleId];

        // Slash proportional to deviation: 1% deviation = 10% slash, capped at 50%
        uint256 slashBps = deviationBps * 10;
        if (slashBps > MAX_SLASH_BPS) slashBps = MAX_SLASH_BPS;

        uint256 slashAmount = (oracle.stakedAmount * slashBps) / BPS_DENOMINATOR;
        uint256 slashValueUSD = (oracle.stakedValueUSD * slashBps) / BPS_DENOMINATOR;

        oracle.stakedAmount -= slashAmount;
        oracle.stakedValueUSD -= slashValueUSD;
        totalStakedUSD -= slashValueUSD;
        totalSlashedUSD += slashValueUSD;

        // If stake falls below minimum, deactivate
        if (oracle.stakedValueUSD < minStakeUSD) {
            oracle.status = OracleStatus.Slashed;
            _removeFromActiveList(oracleId);
        }

        // Transfer slashed tokens to owner (treasury)
        IERC20(oracle.stakedToken).safeTransfer(owner(), slashAmount);

        emit OracleSlashed(oracleId, oracle.operator, slashAmount, "Price deviation exceeded threshold");
    }

    function getConsensusPrice(bytes32 marketId) external view returns (ConsensusPrice memory) {
        return consensusPrices[marketId];
    }

    function getLatestPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp, bool isValid) {
        ConsensusPrice storage cp = consensusPrices[marketId];
        MarketConfig storage market = markets[marketId];

        price = cp.price;
        timestamp = cp.timestamp;

        // Valid if within heartbeat and has minimum confidence
        isValid = market.isActive && cp.timestamp > 0 && block.timestamp - cp.timestamp <= market.heartbeatSeconds
            && cp.confidence >= 5000; // At least 50% confidence
    }

    function getOracleInfo(bytes32 oracleId) external view returns (OracleNode memory) {
        return oracles[oracleId];
    }

    function getOperatorOracles(address operator) external view returns (bytes32[] memory) {
        return operatorOracles[operator];
    }

    function getMarketConfig(bytes32 marketId) external view returns (MarketConfig memory) {
        return markets[marketId];
    }

    function getActiveOracles() external view returns (bytes32[] memory) {
        return activeOracleIds;
    }

    function getOracleWeight(bytes32 oracleId) external view returns (uint256) {
        return _calculateOracleWeight(oracleId);
    }

    function getNetworkStats()
        external
        view
        returns (uint256 totalOracles, uint256 _totalStakedUSD, uint256 totalMarkets, uint256 avgAccuracy)
    {
        totalOracles = activeOracleIds.length;
        _totalStakedUSD = totalStakedUSD;
        totalMarkets = allMarketIds.length;

        // Calculate average accuracy
        if (totalOracles > 0) {
            uint256 sumAccuracy = 0;
            for (uint256 i = 0; i < activeOracleIds.length; i++) {
                sumAccuracy += oracles[activeOracleIds[i]].accuracyScore;
            }
            avgAccuracy = sumAccuracy / totalOracles;
        }
    }

    function addMarket(
        bytes32 marketId,
        string calldata symbol,
        address baseToken,
        uint256 heartbeatSeconds,
        uint256 deviationThresholdBps,
        uint256 minOracles
    ) external onlyOwner {
        if (markets[marketId].isActive) revert MarketAlreadyExists();
        if (minOracles < MIN_ORACLES_FOR_CONSENSUS) {
            minOracles = MIN_ORACLES_FOR_CONSENSUS;
        }

        markets[marketId] = MarketConfig({
            marketId: marketId,
            symbol: symbol,
            baseToken: baseToken,
            heartbeatSeconds: heartbeatSeconds,
            deviationThresholdBps: deviationThresholdBps,
            minOracles: minOracles,
            isActive: true
        });

        allMarketIds.push(marketId);

        emit MarketAdded(marketId, symbol, heartbeatSeconds);
    }

    function updateMarket(bytes32 marketId, bool isActive) external onlyOwner {
        if (markets[marketId].heartbeatSeconds == 0) revert MarketNotFound();
        markets[marketId].isActive = isActive;
        emit MarketUpdated(marketId, isActive);
    }

    function setMinStakeUSD(uint256 newMinimum) external onlyOwner {
        minStakeUSD = newMinimum;
    }

    function slashOracle(bytes32 oracleId, uint256 slashBps, string calldata reason) external onlyOwner {
        OracleNode storage oracle = oracles[oracleId];
        if (oracle.operator == address(0)) revert OracleNotFound();
        if (slashBps > MAX_SLASH_BPS) slashBps = MAX_SLASH_BPS;

        uint256 slashAmount = (oracle.stakedAmount * slashBps) / BPS_DENOMINATOR;
        uint256 slashValueUSD = (oracle.stakedValueUSD * slashBps) / BPS_DENOMINATOR;

        oracle.stakedAmount -= slashAmount;
        oracle.stakedValueUSD -= slashValueUSD;
        totalStakedUSD -= slashValueUSD;
        totalSlashedUSD += slashValueUSD;

        if (oracle.stakedValueUSD < minStakeUSD) {
            oracle.status = OracleStatus.Slashed;
            _removeFromActiveList(oracleId);
        }

        IERC20(oracle.stakedToken).safeTransfer(owner(), slashAmount);

        emit OracleSlashed(oracleId, oracle.operator, slashAmount, reason);
    }

    function setIdentityRegistry(address _registry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_registry);
    }

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = IReputationRegistry(_registry);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _getReputationScore(uint256 agentId) internal view returns (uint256) {
        if (address(reputationRegistry) == address(0)) return 50;

        // Get summary from reputation registry
        address[] memory empty = new address[](0);
        (uint64 count, uint8 avgScore) = reputationRegistry.getSummary(agentId, empty, bytes32(0), bytes32(0));

        // If no feedback, return default
        if (count == 0) return 50;

        return uint256(avgScore);
    }

    function _removeFromActiveList(bytes32 oracleId) internal {
        uint256 length = activeOracleIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (activeOracleIds[i] == oracleId) {
                activeOracleIds[i] = activeOracleIds[length - 1];
                activeOracleIds.pop();
                break;
            }
        }
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    receive() external payable {}
}
