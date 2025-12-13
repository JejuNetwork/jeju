// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IFeedRegistry
 * @author Jeju Network
 * @notice Interface for the Feed Registry - manages oracle feed specifications
 */
interface IFeedRegistry {
    // ============ Enums ============

    enum FeedCategory {
        SPOT_PRICE,
        TWAP,
        FX_RATE,
        STABLECOIN_PEG,
        LST_RATE,
        GAS_PRICE,
        SEQUENCER_STATUS,
        MARKET_STATUS
    }

    // ============ Structs ============

    struct FeedSpec {
        bytes32 feedId;
        string symbol;
        address baseToken;
        address quoteToken;
        uint8 decimals;
        uint32 heartbeatSeconds;
        uint32 twapWindowSeconds;
        uint256 minLiquidityUSD;
        uint16 maxDeviationBps;
        uint8 minOracles;
        uint8 quorumThreshold;
        bool isActive;
        bool requiresConfidence;
        FeedCategory category;
    }

    struct FeedCreateParams {
        string symbol;
        address baseToken;
        address quoteToken;
        uint8 decimals;
        uint32 heartbeatSeconds;
        uint32 twapWindowSeconds;
        uint256 minLiquidityUSD;
        uint16 maxDeviationBps;
        uint8 minOracles;
        uint8 quorumThreshold;
        bool requiresConfidence;
        FeedCategory category;
    }

    // ============ Events ============

    event FeedCreated(
        bytes32 indexed feedId,
        string symbol,
        address baseToken,
        address quoteToken,
        address indexed creator
    );

    event FeedUpdated(bytes32 indexed feedId, string parameter);
    event FeedActivated(bytes32 indexed feedId);
    event FeedDeactivated(bytes32 indexed feedId);

    // ============ Errors ============

    error FeedAlreadyExists(bytes32 feedId);
    error FeedNotFound(bytes32 feedId);
    error FeedNotActive(bytes32 feedId);
    error InvalidFeedParams();
    error Unauthorized();

    // ============ Core Functions ============

    function createFeed(FeedCreateParams calldata params) external returns (bytes32 feedId);

    function updateFeed(
        bytes32 feedId,
        uint32 heartbeatSeconds,
        uint32 twapWindowSeconds,
        uint256 minLiquidityUSD,
        uint16 maxDeviationBps
    ) external;

    function setFeedActive(bytes32 feedId, bool active) external;

    function setQuorumParams(bytes32 feedId, uint8 minOracles, uint8 quorumThreshold) external;

    // ============ View Functions ============

    function getFeed(bytes32 feedId) external view returns (FeedSpec memory);

    function getFeedBySymbol(string calldata symbol) external view returns (FeedSpec memory);

    function getAllFeeds() external view returns (bytes32[] memory);

    function getActiveFeeds() external view returns (bytes32[] memory);

    function getFeedsByCategory(FeedCategory category) external view returns (bytes32[] memory);

    function feedExists(bytes32 feedId) external view returns (bool);

    function isFeedActive(bytes32 feedId) external view returns (bool);

    function computeFeedId(address baseToken, address quoteToken) external pure returns (bytes32);

    function totalFeeds() external view returns (uint256);
}
