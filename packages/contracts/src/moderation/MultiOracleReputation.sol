// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiOracleReputation
 * @author Jeju Network
 * @notice Aggregates reputation from multiple oracle sources for moderation
 * @dev Prevents single point of failure in reputation system
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              MULTI-ORACLE DESIGN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Supported Oracle Sources:
 * 1. GitHub - Developer reputation based on commits, repos, followers
 * 2. Farcaster - Social reputation from casts and follows
 * 3. ENS - On-chain identity verification
 * 4. On-chain Activity - Transaction history and interactions
 * 5. Gitcoin Passport - Sybil resistance score
 * 6. Custom Oracles - Extensible for future integrations
 *
 * Aggregation Methods:
 * - Weighted Average: Different weights per oracle source
 * - Minimum Threshold: Require N/M oracles to agree
 * - Median: Use median of all oracle scores
 *
 */
contract MultiOracleReputation is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct OracleConfig {
        string name; // Oracle identifier
        address oracleAddress; // Oracle contract or signer
        uint256 weight; // Weight in aggregation (basis points)
        bool isActive; // Whether this oracle is active
        uint256 minScore; // Minimum score to be considered valid
        uint256 maxScore; // Maximum score for normalization
        uint256 stalePeriod; // Time after which score is stale
    }

    struct ReputationScore {
        uint256 rawScore; // Raw score from oracle
        uint256 normalizedScore; // Normalized to 0-10000 scale
        uint256 timestamp; // When score was fetched
        bool isValid; // Whether score is valid
    }

    struct AggregatedReputation {
        uint256 aggregatedScore; // Final aggregated score (0-10000)
        uint256 lastUpdated; // Last aggregation timestamp
        uint256 oracleCount; // Number of oracles contributing
        uint256 confidence; // Confidence score based on oracle agreement
        bool isValid; // Whether aggregation is valid
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MAX_SCORE = 10000; // 100% in basis points
    uint256 public constant MIN_ORACLES_FOR_VALID = 2; // Minimum oracles needed
    uint256 public constant DEFAULT_STALE_PERIOD = 7 days;
    uint256 public constant MAX_ORACLES = 10;

    // Oracle types
    uint8 public constant ORACLE_GITHUB = 1;
    uint8 public constant ORACLE_FARCASTER = 2;
    uint8 public constant ORACLE_ENS = 3;
    uint8 public constant ORACLE_ONCHAIN = 4;
    uint8 public constant ORACLE_GITCOIN = 5;
    uint8 public constant ORACLE_CUSTOM = 99;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    // oracleId => config
    mapping(uint8 => OracleConfig) public oracles;

    // user => oracleId => score
    mapping(address => mapping(uint8 => ReputationScore)) public userScores;

    // user => aggregated reputation
    mapping(address => AggregatedReputation) public aggregatedReputations;

    // List of active oracle IDs
    uint8[] public activeOracleIds;

    // Total weight of all active oracles
    uint256 public totalWeight;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event OracleRegistered(uint8 indexed oracleId, string name, address oracleAddress, uint256 weight);

    event OracleUpdated(uint8 indexed oracleId, uint256 newWeight, bool isActive);

    event ScoreUpdated(address indexed user, uint8 indexed oracleId, uint256 rawScore, uint256 normalizedScore);

    event ReputationAggregated(address indexed user, uint256 aggregatedScore, uint256 oracleCount, uint256 confidence);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error OracleNotFound();
    error OracleNotActive();
    error InvalidScore();
    error TooManyOracles();
    error InsufficientOracles();
    error StaleScore();
    error Unauthorized();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _owner) Ownable(_owner) {}

    // ═══════════════════════════════════════════════════════════════════════
    //                              ORACLE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a new reputation oracle
     */
    function registerOracle(
        uint8 oracleId,
        string calldata name,
        address oracleAddress,
        uint256 weight,
        uint256 minScore,
        uint256 maxScore
    ) external onlyOwner {
        if (activeOracleIds.length >= MAX_ORACLES) revert TooManyOracles();

        oracles[oracleId] = OracleConfig({
            name: name,
            oracleAddress: oracleAddress,
            weight: weight,
            isActive: true,
            minScore: minScore,
            maxScore: maxScore,
            stalePeriod: DEFAULT_STALE_PERIOD
        });

        activeOracleIds.push(oracleId);
        totalWeight += weight;

        emit OracleRegistered(oracleId, name, oracleAddress, weight);
    }

    /**
     * @notice Update oracle configuration
     */
    function updateOracle(uint8 oracleId, uint256 newWeight, bool isActive) external onlyOwner {
        OracleConfig storage oracle = oracles[oracleId];
        if (oracle.oracleAddress == address(0)) revert OracleNotFound();

        // Adjust total weight
        totalWeight = totalWeight - oracle.weight + newWeight;

        oracle.weight = newWeight;
        oracle.isActive = isActive;

        // Update active list if needed
        if (!isActive) {
            _removeFromActiveList(oracleId);
        }

        emit OracleUpdated(oracleId, newWeight, isActive);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              SCORE SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit a reputation score for a user from an oracle
     * @param user The user address
     * @param oracleId The oracle providing the score
     * @param rawScore The raw score from the oracle
     * @param signature Optional signature from oracle (for off-chain oracles)
     */
    function submitScore(address user, uint8 oracleId, uint256 rawScore, bytes calldata signature)
        external
        nonReentrant
    {
        OracleConfig storage oracle = oracles[oracleId];

        if (oracle.oracleAddress == address(0)) revert OracleNotFound();
        if (!oracle.isActive) revert OracleNotActive();

        // Verify caller is authorized (either oracle contract or signed message)
        if (msg.sender != oracle.oracleAddress) {
            if (!_verifySignature(user, oracleId, rawScore, signature, oracle.oracleAddress)) {
                revert Unauthorized();
            }
        }

        // Normalize score
        uint256 normalizedScore = _normalizeScore(rawScore, oracle.minScore, oracle.maxScore);

        userScores[user][oracleId] = ReputationScore({
            rawScore: rawScore,
            normalizedScore: normalizedScore,
            timestamp: block.timestamp,
            isValid: true
        });

        emit ScoreUpdated(user, oracleId, rawScore, normalizedScore);

        // Auto-aggregate if enough oracles have scores
        _tryAutoAggregate(user);
    }

    /**
     * @notice Batch submit scores (for oracle operators)
     */
    function batchSubmitScores(address[] calldata users, uint8 oracleId, uint256[] calldata rawScores)
        external
        nonReentrant
    {
        OracleConfig storage oracle = oracles[oracleId];

        if (msg.sender != oracle.oracleAddress) revert Unauthorized();
        if (!oracle.isActive) revert OracleNotActive();
        if (users.length != rawScores.length) revert InvalidScore();

        for (uint256 i = 0; i < users.length; i++) {
            uint256 normalizedScore = _normalizeScore(rawScores[i], oracle.minScore, oracle.maxScore);

            userScores[users[i]][oracleId] = ReputationScore({
                rawScore: rawScores[i],
                normalizedScore: normalizedScore,
                timestamp: block.timestamp,
                isValid: true
            });

            emit ScoreUpdated(users[i], oracleId, rawScores[i], normalizedScore);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              AGGREGATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Aggregate reputation from all oracles for a user
     */
    function aggregateReputation(address user) external returns (uint256) {
        return _aggregate(user);
    }

    function _tryAutoAggregate(address user) internal {
        // Count valid, non-stale scores
        uint256 validCount = 0;
        for (uint256 i = 0; i < activeOracleIds.length; i++) {
            ReputationScore storage score = userScores[user][activeOracleIds[i]];
            if (score.isValid && block.timestamp - score.timestamp <= oracles[activeOracleIds[i]].stalePeriod) {
                validCount++;
            }
        }

        if (validCount >= MIN_ORACLES_FOR_VALID) {
            _aggregate(user);
        }
    }

    function _aggregate(address user) internal returns (uint256) {
        uint256 weightedSum = 0;
        uint256 usedWeight = 0;
        uint256 validCount = 0;
        uint256 scoreSum = 0;

        // Collect scores from all active oracles
        uint256[] memory scores = new uint256[](activeOracleIds.length);
        uint256 scoreIndex = 0;

        for (uint256 i = 0; i < activeOracleIds.length; i++) {
            uint8 oracleId = activeOracleIds[i];
            OracleConfig storage oracle = oracles[oracleId];
            ReputationScore storage score = userScores[user][oracleId];

            // Skip invalid or stale scores
            if (!score.isValid || block.timestamp - score.timestamp > oracle.stalePeriod) {
                continue;
            }

            weightedSum += score.normalizedScore * oracle.weight;
            usedWeight += oracle.weight;
            scoreSum += score.normalizedScore;
            scores[scoreIndex] = score.normalizedScore;
            scoreIndex++;
            validCount++;
        }

        if (validCount < MIN_ORACLES_FOR_VALID) revert InsufficientOracles();

        // Calculate weighted average
        uint256 aggregatedScore = weightedSum / usedWeight;

        // Calculate confidence based on agreement between oracles
        uint256 variance = _calculateVariance(scores, scoreIndex, scoreSum / validCount);
        uint256 confidence = MAX_SCORE - (variance * MAX_SCORE / (MAX_SCORE * MAX_SCORE / 4));

        aggregatedReputations[user] = AggregatedReputation({
            aggregatedScore: aggregatedScore,
            lastUpdated: block.timestamp,
            oracleCount: validCount,
            confidence: confidence,
            isValid: true
        });

        emit ReputationAggregated(user, aggregatedScore, validCount, confidence);

        return aggregatedScore;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get aggregated reputation for a user
     */
    function getReputation(address user)
        external
        view
        returns (uint256 score, uint256 confidence, uint256 oracleCount, bool isValid)
    {
        AggregatedReputation storage rep = aggregatedReputations[user];

        // Check if stale (any score older than 30 days makes it stale)
        bool stale = block.timestamp - rep.lastUpdated > 30 days;

        return (rep.aggregatedScore, rep.confidence, rep.oracleCount, rep.isValid && !stale);
    }

    /**
     * @notice Get individual oracle score for a user
     */
    function getOracleScore(address user, uint8 oracleId)
        external
        view
        returns (uint256 rawScore, uint256 normalizedScore, uint256 timestamp, bool isValid, bool isStale)
    {
        ReputationScore storage score = userScores[user][oracleId];
        OracleConfig storage oracle = oracles[oracleId];

        bool stale = block.timestamp - score.timestamp > oracle.stalePeriod;

        return (score.rawScore, score.normalizedScore, score.timestamp, score.isValid, stale);
    }

    /**
     * @notice Get all oracle scores for a user
     */
    function getAllScores(address user)
        external
        view
        returns (uint8[] memory oracleIds, uint256[] memory normalizedScores, bool[] memory isValid)
    {
        uint256 len = activeOracleIds.length;
        oracleIds = new uint8[](len);
        normalizedScores = new uint256[](len);
        isValid = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            uint8 oracleId = activeOracleIds[i];
            ReputationScore storage score = userScores[user][oracleId];
            OracleConfig storage oracle = oracles[oracleId];

            oracleIds[i] = oracleId;
            normalizedScores[i] = score.normalizedScore;
            isValid[i] = score.isValid && (block.timestamp - score.timestamp <= oracle.stalePeriod);
        }

        return (oracleIds, normalizedScores, isValid);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              INTERNAL
    // ═══════════════════════════════════════════════════════════════════════

    function _normalizeScore(uint256 rawScore, uint256 minScore, uint256 maxScore) internal pure returns (uint256) {
        if (rawScore <= minScore) return 0;
        if (rawScore >= maxScore) return MAX_SCORE;

        return ((rawScore - minScore) * MAX_SCORE) / (maxScore - minScore);
    }

    function _calculateVariance(uint256[] memory scores, uint256 count, uint256 mean) internal pure returns (uint256) {
        if (count <= 1) return 0;

        uint256 sumSquaredDiff = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 diff = scores[i] > mean ? scores[i] - mean : mean - scores[i];
            sumSquaredDiff += diff * diff;
        }

        return sumSquaredDiff / count;
    }

    function _verifySignature(address user, uint8 oracleId, uint256 rawScore, bytes calldata signature, address signer)
        internal
        pure
        returns (bool)
    {
        bytes32 messageHash = keccak256(abi.encodePacked(user, oracleId, rawScore));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recovered = ecrecover(ethSignedHash, v, r, s);

        return recovered == signer;
    }

    function _splitSignature(bytes calldata sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "Invalid signature length");

        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
    }

    function _removeFromActiveList(uint8 oracleId) internal {
        for (uint256 i = 0; i < activeOracleIds.length; i++) {
            if (activeOracleIds[i] == oracleId) {
                activeOracleIds[i] = activeOracleIds[activeOracleIds.length - 1];
                activeOracleIds.pop();
                break;
            }
        }
    }
}
