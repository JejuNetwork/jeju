// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOracleStakingManager
 * @notice Interface for the Oracle Staking Marketplace
 * @dev Enables anyone to become a price oracle by staking tokens
 *      Integrates with ERC-8004 reputation for weighted consensus
 */
interface IOracleStakingManager {
    // ============ Enums ============

    enum OracleStatus {
        Inactive,
        Active,
        Slashed,
        Unbonding
    }

    // ============ Structs ============

    struct OracleNode {
        bytes32 oracleId;
        address operator;
        address stakedToken;
        uint256 stakedAmount;
        uint256 stakedValueUSD;
        uint256 reputationAgentId;    // ERC-8004 agent ID (0 if not linked)
        uint256 reputationScore;       // Cached score (0-100)
        uint256 accuracyScore;         // Historical accuracy (0-10000 = 0-100%)
        uint256 totalSubmissions;
        uint256 validSubmissions;
        uint256 registrationTime;
        uint256 lastSubmissionTime;
        uint256 unbondingStartTime;
        OracleStatus status;
    }

    struct PriceSubmission {
        uint256 price;
        uint256 timestamp;
        uint256 blockNumber;
        address oracle;
        bool included;  // Whether included in consensus
    }

    struct MarketConfig {
        bytes32 marketId;
        string symbol;              // e.g., "BTC-USD", "ETH-USD"
        address baseToken;          // Underlying asset (address(0) for external assets)
        uint256 heartbeatSeconds;   // Max time between updates
        uint256 deviationThresholdBps; // Max deviation before forced update (basis points)
        uint256 minOracles;         // Minimum oracles for valid price
        bool isActive;
    }

    struct ConsensusPrice {
        uint256 price;
        uint256 timestamp;
        uint256 oracleCount;
        uint256 confidence;         // 0-10000 (higher = more agreement)
    }

    // ============ Events ============

    event OracleRegistered(
        bytes32 indexed oracleId,
        address indexed operator,
        address stakedToken,
        uint256 stakedAmount,
        uint256 stakedValueUSD
    );

    event OracleDeregistered(bytes32 indexed oracleId, address indexed operator);

    event OracleSlashed(
        bytes32 indexed oracleId,
        address indexed operator,
        uint256 slashAmount,
        string reason
    );

    event UnbondingStarted(
        bytes32 indexed oracleId,
        address indexed operator,
        uint256 amount,
        uint256 completionTime
    );

    event StakeWithdrawn(bytes32 indexed oracleId, address indexed operator, uint256 amount);

    event PriceSubmitted(
        bytes32 indexed marketId,
        bytes32 indexed oracleId,
        uint256 price,
        uint256 timestamp
    );

    event ConsensusReached(
        bytes32 indexed marketId,
        uint256 price,
        uint256 oracleCount,
        uint256 confidence
    );

    event MarketAdded(bytes32 indexed marketId, string symbol, uint256 heartbeat);

    event MarketUpdated(bytes32 indexed marketId, bool isActive);

    event ReputationUpdated(bytes32 indexed oracleId, uint256 oldScore, uint256 newScore);

    // ============ Oracle Registration ============

    /**
     * @notice Register as a price oracle
     * @param stakingToken Token to stake
     * @param stakeAmount Amount to stake
     * @param reputationAgentId Optional ERC-8004 agent ID for reputation boost
     * @return oracleId Unique oracle identifier
     */
    function registerOracle(
        address stakingToken,
        uint256 stakeAmount,
        uint256 reputationAgentId
    ) external returns (bytes32 oracleId);

    /**
     * @notice Start unbonding process to withdraw stake
     * @param oracleId Oracle identifier
     */
    function startUnbonding(bytes32 oracleId) external;

    /**
     * @notice Complete unbonding and withdraw stake
     * @param oracleId Oracle identifier
     */
    function completeUnbonding(bytes32 oracleId) external;

    /**
     * @notice Add more stake to an existing oracle
     * @param oracleId Oracle identifier
     * @param amount Additional stake amount
     */
    function addStake(bytes32 oracleId, uint256 amount) external;

    // ============ Price Submission ============

    /**
     * @notice Submit a price for a market
     * @param oracleId Oracle identifier
     * @param marketId Market identifier
     * @param price Price with 8 decimals
     */
    function submitPrice(bytes32 oracleId, bytes32 marketId, uint256 price) external;

    /**
     * @notice Submit prices for multiple markets in one tx
     * @param oracleId Oracle identifier
     * @param marketIds Array of market identifiers
     * @param prices Array of prices
     */
    function submitPricesBatch(
        bytes32 oracleId,
        bytes32[] calldata marketIds,
        uint256[] calldata prices
    ) external;

    // ============ Consensus ============

    /**
     * @notice Get the current consensus price for a market
     * @param marketId Market identifier
     * @return consensus Current consensus price data
     */
    function getConsensusPrice(bytes32 marketId) external view returns (ConsensusPrice memory consensus);

    /**
     * @notice Get the latest price (may not have full consensus)
     * @param marketId Market identifier
     * @return price Latest price
     * @return timestamp Price timestamp
     * @return isValid Whether price meets validity requirements
     */
    function getLatestPrice(bytes32 marketId) external view returns (
        uint256 price,
        uint256 timestamp,
        bool isValid
    );

    // ============ View Functions ============

    function getOracleInfo(bytes32 oracleId) external view returns (OracleNode memory);

    function getOperatorOracles(address operator) external view returns (bytes32[] memory);

    function getMarketConfig(bytes32 marketId) external view returns (MarketConfig memory);

    function getActiveOracles() external view returns (bytes32[] memory);

    function getOracleWeight(bytes32 oracleId) external view returns (uint256 weight);

    function getNetworkStats() external view returns (
        uint256 totalOracles,
        uint256 totalStakedUSD,
        uint256 totalMarkets,
        uint256 avgAccuracy
    );

    // ============ Admin Functions ============

    function addMarket(
        bytes32 marketId,
        string calldata symbol,
        address baseToken,
        uint256 heartbeatSeconds,
        uint256 deviationThresholdBps,
        uint256 minOracles
    ) external;

    function updateMarket(bytes32 marketId, bool isActive) external;

    function setMinStakeUSD(uint256 newMinimum) external;

    function slashOracle(bytes32 oracleId, uint256 slashBps, string calldata reason) external;

    function pause() external;

    function unpause() external;
}
