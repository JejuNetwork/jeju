// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";

/**
 * @title FeedRegistry
 * @author Jeju Network
 * @notice Manages oracle feed specifications for the Jeju Oracle Network
 * @dev Stores feed configurations including TWAP windows, liquidity requirements,
 *      deviation thresholds, and quorum parameters.
 *
 * Key Features:
 * - Create and manage feed specifications
 * - Support for multiple feed categories (spot, TWAP, FX, stablecoin peg, etc.)
 * - Configurable quorum and deviation parameters per feed
 * - Category-based feed discovery
 */
contract FeedRegistry is IFeedRegistry, Ownable, Pausable {
    // ============ Constants ============

    uint8 public constant DEFAULT_DECIMALS = 8;
    uint32 public constant DEFAULT_HEARTBEAT = 3600; // 1 hour
    uint32 public constant DEFAULT_TWAP_WINDOW = 1800; // 30 minutes
    uint256 public constant DEFAULT_MIN_LIQUIDITY = 100_000 ether; // $100k
    uint16 public constant DEFAULT_MAX_DEVIATION = 100; // 1%
    uint8 public constant DEFAULT_MIN_ORACLES = 3;
    uint8 public constant DEFAULT_QUORUM = 2;

    uint8 public constant MAX_ORACLES = 21;
    uint16 public constant MAX_DEVIATION_BPS = 10000;

    // ============ State Variables ============

    mapping(bytes32 => FeedSpec) private _feeds;
    mapping(string => bytes32) private _symbolToFeedId;
    mapping(FeedCategory => bytes32[]) private _feedsByCategory;

    bytes32[] private _allFeedIds;
    bytes32[] private _activeFeedIds;

    mapping(address => bool) public feedManagers;

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {
        feedManagers[initialOwner] = true;
    }

    // ============ Modifiers ============

    modifier onlyFeedManager() {
        if (!feedManagers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    modifier feedMustExist(bytes32 feedId) {
        if (!_feedExists(feedId)) {
            revert FeedNotFound(feedId);
        }
        _;
    }

    modifier feedMustBeActive(bytes32 feedId) {
        if (!_feeds[feedId].isActive) {
            revert FeedNotActive(feedId);
        }
        _;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new feed specification
     * @param params Feed creation parameters
     * @return feedId The unique identifier for the created feed
     */
    function createFeed(FeedCreateParams calldata params)
        external
        onlyFeedManager
        whenNotPaused
        returns (bytes32 feedId)
    {
        _validateFeedParams(params);

        feedId = computeFeedId(params.baseToken, params.quoteToken);

        if (_feedExists(feedId)) {
            revert FeedAlreadyExists(feedId);
        }

        FeedSpec storage spec = _feeds[feedId];
        spec.feedId = feedId;
        spec.symbol = params.symbol;
        spec.baseToken = params.baseToken;
        spec.quoteToken = params.quoteToken;
        spec.decimals = params.decimals > 0 ? params.decimals : DEFAULT_DECIMALS;
        spec.heartbeatSeconds = params.heartbeatSeconds > 0 ? params.heartbeatSeconds : DEFAULT_HEARTBEAT;
        spec.twapWindowSeconds = params.twapWindowSeconds > 0 ? params.twapWindowSeconds : DEFAULT_TWAP_WINDOW;
        spec.minLiquidityUSD = params.minLiquidityUSD > 0 ? params.minLiquidityUSD : DEFAULT_MIN_LIQUIDITY;
        spec.maxDeviationBps = params.maxDeviationBps > 0 ? params.maxDeviationBps : DEFAULT_MAX_DEVIATION;
        spec.minOracles = params.minOracles > 0 ? params.minOracles : DEFAULT_MIN_ORACLES;
        spec.quorumThreshold = params.quorumThreshold > 0 ? params.quorumThreshold : DEFAULT_QUORUM;
        spec.requiresConfidence = params.requiresConfidence;
        spec.category = params.category;
        spec.isActive = true;

        _symbolToFeedId[params.symbol] = feedId;
        _allFeedIds.push(feedId);
        _activeFeedIds.push(feedId);
        _feedsByCategory[params.category].push(feedId);

        emit FeedCreated(feedId, params.symbol, params.baseToken, params.quoteToken, msg.sender);
        emit FeedActivated(feedId);
    }

    /**
     * @notice Update feed parameters
     * @param feedId Feed identifier
     * @param heartbeatSeconds New heartbeat (0 to keep current)
     * @param twapWindowSeconds New TWAP window (0 to keep current)
     * @param minLiquidityUSD New min liquidity (0 to keep current)
     * @param maxDeviationBps New max deviation (0 to keep current)
     */
    function updateFeed(
        bytes32 feedId,
        uint32 heartbeatSeconds,
        uint32 twapWindowSeconds,
        uint256 minLiquidityUSD,
        uint16 maxDeviationBps
    ) external onlyFeedManager feedMustExist(feedId) {
        FeedSpec storage spec = _feeds[feedId];

        if (heartbeatSeconds > 0) {
            spec.heartbeatSeconds = heartbeatSeconds;
            emit FeedUpdated(feedId, "heartbeatSeconds");
        }

        if (twapWindowSeconds > 0) {
            spec.twapWindowSeconds = twapWindowSeconds;
            emit FeedUpdated(feedId, "twapWindowSeconds");
        }

        if (minLiquidityUSD > 0) {
            spec.minLiquidityUSD = minLiquidityUSD;
            emit FeedUpdated(feedId, "minLiquidityUSD");
        }

        if (maxDeviationBps > 0) {
            if (maxDeviationBps > MAX_DEVIATION_BPS) {
                revert InvalidFeedParams();
            }
            spec.maxDeviationBps = maxDeviationBps;
            emit FeedUpdated(feedId, "maxDeviationBps");
        }
    }

    /**
     * @notice Activate or deactivate a feed
     * @param feedId Feed identifier
     * @param active Whether the feed should be active
     */
    function setFeedActive(bytes32 feedId, bool active) external onlyFeedManager feedMustExist(feedId) {
        FeedSpec storage spec = _feeds[feedId];

        if (spec.isActive == active) return;

        spec.isActive = active;

        if (active) {
            _activeFeedIds.push(feedId);
            emit FeedActivated(feedId);
        } else {
            _removeFromActiveList(feedId);
            emit FeedDeactivated(feedId);
        }
    }

    /**
     * @notice Update quorum parameters for a feed
     * @param feedId Feed identifier
     * @param minOracles Minimum number of oracles required
     * @param quorumThreshold Signatures needed for consensus
     */
    function setQuorumParams(bytes32 feedId, uint8 minOracles, uint8 quorumThreshold)
        external
        onlyFeedManager
        feedMustExist(feedId)
    {
        if (minOracles == 0 || quorumThreshold == 0) {
            revert InvalidFeedParams();
        }
        if (quorumThreshold > minOracles) {
            revert InvalidFeedParams();
        }
        if (minOracles > MAX_ORACLES) {
            revert InvalidFeedParams();
        }

        FeedSpec storage spec = _feeds[feedId];
        spec.minOracles = minOracles;
        spec.quorumThreshold = quorumThreshold;

        emit FeedUpdated(feedId, "quorumParams");
    }

    // ============ View Functions ============

    /**
     * @notice Get feed specification by ID
     * @param feedId Feed identifier
     * @return Feed specification
     */
    function getFeed(bytes32 feedId) external view feedMustExist(feedId) returns (FeedSpec memory) {
        return _feeds[feedId];
    }

    /**
     * @notice Get feed specification by symbol
     * @param symbol Feed symbol (e.g., "ETH-USD")
     * @return Feed specification
     */
    function getFeedBySymbol(string calldata symbol) external view returns (FeedSpec memory) {
        bytes32 feedId = _symbolToFeedId[symbol];
        if (feedId == bytes32(0)) {
            revert FeedNotFound(feedId);
        }
        return _feeds[feedId];
    }

    /**
     * @notice Get all feed IDs
     * @return Array of all feed IDs
     */
    function getAllFeeds() external view returns (bytes32[] memory) {
        return _allFeedIds;
    }

    /**
     * @notice Get all active feed IDs
     * @return Array of active feed IDs
     */
    function getActiveFeeds() external view returns (bytes32[] memory) {
        return _activeFeedIds;
    }

    /**
     * @notice Get feeds by category
     * @param category Feed category to filter by
     * @return Array of feed IDs in the category
     */
    function getFeedsByCategory(FeedCategory category) external view returns (bytes32[] memory) {
        return _feedsByCategory[category];
    }

    /**
     * @notice Check if a feed exists
     * @param feedId Feed identifier
     * @return Whether the feed exists
     */
    function feedExists(bytes32 feedId) external view returns (bool) {
        return _feedExists(feedId);
    }

    /**
     * @notice Check if a feed is active
     * @param feedId Feed identifier
     * @return Whether the feed is active
     */
    function isFeedActive(bytes32 feedId) external view returns (bool) {
        return _feeds[feedId].isActive;
    }

    /**
     * @notice Compute feed ID from token addresses
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @return feedId The computed feed ID
     */
    function computeFeedId(address baseToken, address quoteToken) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseToken, quoteToken));
    }

    /**
     * @notice Get total number of feeds
     * @return Total feed count
     */
    function totalFeeds() external view returns (uint256) {
        return _allFeedIds.length;
    }

    // ============ Admin Functions ============

    /**
     * @notice Add or remove a feed manager
     * @param manager Address to update
     * @param allowed Whether the address can manage feeds
     */
    function setFeedManager(address manager, bool allowed) external onlyOwner {
        feedManagers[manager] = allowed;
    }

    /**
     * @notice Pause feed creation and updates
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause feed creation and updates
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Batch Operations ============

    /**
     * @notice Create multiple feeds in a single transaction
     * @param params Array of feed creation parameters
     * @return feedIds Array of created feed IDs
     */
    function createFeedsBatch(FeedCreateParams[] calldata params)
        external
        onlyFeedManager
        whenNotPaused
        returns (bytes32[] memory feedIds)
    {
        feedIds = new bytes32[](params.length);

        for (uint256 i = 0; i < params.length; i++) {
            _validateFeedParams(params[i]);

            bytes32 feedId = computeFeedId(params[i].baseToken, params[i].quoteToken);

            if (_feedExists(feedId)) {
                revert FeedAlreadyExists(feedId);
            }

            FeedSpec storage spec = _feeds[feedId];
            spec.feedId = feedId;
            spec.symbol = params[i].symbol;
            spec.baseToken = params[i].baseToken;
            spec.quoteToken = params[i].quoteToken;
            spec.decimals = params[i].decimals > 0 ? params[i].decimals : DEFAULT_DECIMALS;
            spec.heartbeatSeconds = params[i].heartbeatSeconds > 0 ? params[i].heartbeatSeconds : DEFAULT_HEARTBEAT;
            spec.twapWindowSeconds = params[i].twapWindowSeconds > 0 ? params[i].twapWindowSeconds : DEFAULT_TWAP_WINDOW;
            spec.minLiquidityUSD = params[i].minLiquidityUSD > 0 ? params[i].minLiquidityUSD : DEFAULT_MIN_LIQUIDITY;
            spec.maxDeviationBps = params[i].maxDeviationBps > 0 ? params[i].maxDeviationBps : DEFAULT_MAX_DEVIATION;
            spec.minOracles = params[i].minOracles > 0 ? params[i].minOracles : DEFAULT_MIN_ORACLES;
            spec.quorumThreshold = params[i].quorumThreshold > 0 ? params[i].quorumThreshold : DEFAULT_QUORUM;
            spec.requiresConfidence = params[i].requiresConfidence;
            spec.category = params[i].category;
            spec.isActive = true;

            _symbolToFeedId[params[i].symbol] = feedId;
            _allFeedIds.push(feedId);
            _activeFeedIds.push(feedId);
            _feedsByCategory[params[i].category].push(feedId);

            feedIds[i] = feedId;

            emit FeedCreated(feedId, params[i].symbol, params[i].baseToken, params[i].quoteToken, msg.sender);
            emit FeedActivated(feedId);
        }
    }

    // ============ Internal Functions ============

    function _feedExists(bytes32 feedId) internal view returns (bool) {
        return _feeds[feedId].feedId != bytes32(0);
    }

    function _validateFeedParams(FeedCreateParams calldata params) internal pure {
        if (bytes(params.symbol).length == 0) {
            revert InvalidFeedParams();
        }
        if (params.maxDeviationBps > MAX_DEVIATION_BPS) {
            revert InvalidFeedParams();
        }
        if (params.minOracles > MAX_ORACLES) {
            revert InvalidFeedParams();
        }
        if (params.quorumThreshold > params.minOracles && params.minOracles > 0) {
            revert InvalidFeedParams();
        }
    }

    function _removeFromActiveList(bytes32 feedId) internal {
        uint256 length = _activeFeedIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (_activeFeedIds[i] == feedId) {
                _activeFeedIds[i] = _activeFeedIds[length - 1];
                _activeFeedIds.pop();
                break;
            }
        }
    }

    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
