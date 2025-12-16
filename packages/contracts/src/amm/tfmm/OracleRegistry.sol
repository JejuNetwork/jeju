// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracleRegistry} from "./IOracleRegistry.sol";

// ============ External Interfaces ============

// Pyth oracle interface
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory);
}

// Chainlink AggregatorV3 interface
interface IChainlinkFeed {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

// TWAP Oracle interface
interface ITWAPOracle {
    function getPrice(address baseToken) external view returns (uint256);
    function isValidTWAP(address baseToken) external view returns (bool);
    function getPriceDeviation(address baseToken) external view returns (uint256);
}

/**
 * @title OracleRegistry
 * @author Jeju Network
 * @notice Registry for permissionless price oracles
 * @dev Supports Pyth, Chainlink, and custom oracle feeds
 *
 * Priority: Pyth (permissionless) > Chainlink > TWAP
 */
contract OracleRegistry is IOracleRegistry, Ownable {

    // ============ Enums ============

    enum OracleType {
        CHAINLINK,
        PYTH,
        CUSTOM
    }

    // ============ Structs ============

    struct OracleInfo {
        address feed;           // Feed address (Chainlink aggregator, custom feed)
        bytes32 pythId;         // Pyth price ID (if Pyth)
        uint256 heartbeat;      // Max staleness in seconds
        uint8 decimals;         // Source decimals
        OracleType oracleType;
        bool active;
    }

    // ============ State Variables ============

    /// @notice Pyth oracle contract
    IPyth public pyth;

    /// @notice Oracle configs by token
    mapping(address => OracleInfo) public oracles;

    /// @notice Price cache (for gas optimization)
    mapping(address => uint256) private _cachedPrices;
    mapping(address => uint256) private _cacheTimestamps;

    /// @notice Cache duration in seconds
    uint256 public cacheDuration = 10;

    /// @notice Target decimals for output
    uint8 public constant OUTPUT_DECIMALS = 8;

    /// @notice Governance address
    address public governance;

    // ============ Events ============

    event OracleRegistered(
        address indexed token,
        address feed,
        bytes32 pythId,
        OracleType oracleType
    );
    event OracleDeactivated(address indexed token);
    event PythUpdated(address indexed pyth);

    // ============ Errors ============

    error OracleNotFound(address token);
    error PriceStale(address token, uint256 staleness);
    error InvalidPrice(address token);
    error OracleInactive(address token);

    // ============ Constructor ============

    constructor(
        address pyth_,
        address governance_
    ) Ownable(msg.sender) {
        pyth = IPyth(pyth_);
        governance = governance_;
    }

    // ============ Modifiers ============

    modifier onlyGovernance() {
        require(msg.sender == governance || msg.sender == owner(), "Not governance");
        _;
    }

    // ============ Oracle Registration ============

    /**
     * @notice Register a Chainlink oracle
     */
    function registerChainlinkOracle(
        address token,
        address feed,
        uint256 heartbeat
    ) external onlyOwner {
        uint8 feedDecimals = IChainlinkFeed(feed).decimals();

        oracles[token] = OracleInfo({
            feed: feed,
            pythId: bytes32(0),
            heartbeat: heartbeat,
            decimals: feedDecimals,
            oracleType: OracleType.CHAINLINK,
            active: true
        });

        emit OracleRegistered(token, feed, bytes32(0), OracleType.CHAINLINK);
    }

    /**
     * @notice Register a Pyth oracle
     */
    function registerPythOracle(
        address token,
        bytes32 pythId,
        uint256 heartbeat
    ) external onlyOwner {
        oracles[token] = OracleInfo({
            feed: address(pyth),
            pythId: pythId,
            heartbeat: heartbeat,
            decimals: 8, // Pyth uses 8 decimals with exponent
            oracleType: OracleType.PYTH,
            active: true
        });

        emit OracleRegistered(token, address(pyth), pythId, OracleType.PYTH);
    }

    /**
     * @notice Register a custom oracle
     */
    function registerOracle(
        address token,
        address feed,
        uint256 heartbeat,
        uint8 decimals
    ) external override onlyOwner {
        oracles[token] = OracleInfo({
            feed: feed,
            pythId: bytes32(0),
            heartbeat: heartbeat,
            decimals: decimals,
            oracleType: OracleType.CUSTOM,
            active: true
        });

        emit OracleRegistered(token, feed, bytes32(0), OracleType.CUSTOM);
    }

    /**
     * @notice Deactivate an oracle
     */
    function deactivateOracle(address token) external onlyOwner {
        oracles[token].active = false;
        emit OracleDeactivated(token);
    }

    // ============ Price Fetching ============

    /**
     * @inheritdoc IOracleRegistry
     */
    function getPrice(address token) external view override returns (uint256 price) {
        OracleInfo storage info = oracles[token];

        if (info.feed == address(0) && info.pythId == bytes32(0)) {
            revert OracleNotFound(token);
        }
        if (!info.active) {
            revert OracleInactive(token);
        }

        if (info.oracleType == OracleType.PYTH) {
            price = _getPythPrice(info);
        } else if (info.oracleType == OracleType.CHAINLINK) {
            price = _getChainlinkPrice(info, token);
        } else {
            price = _getCustomPrice(info, token);
        }

        if (price == 0) {
            revert InvalidPrice(token);
        }
    }

    /**
     * @inheritdoc IOracleRegistry
     */
    function getPrices(address[] calldata tokens) external view override returns (uint256[] memory prices) {
        prices = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            prices[i] = this.getPrice(tokens[i]);
        }
    }

    /**
     * @inheritdoc IOracleRegistry
     */
    function isPriceStale(address token) external view override returns (bool) {
        OracleInfo storage info = oracles[token];

        if (info.oracleType == OracleType.CHAINLINK) {
            (, , , uint256 updatedAt, ) = IChainlinkFeed(info.feed).latestRoundData();
            return block.timestamp - updatedAt > info.heartbeat;
        }

        // For Pyth, staleness is checked during fetch
        return false;
    }

    /**
     * @inheritdoc IOracleRegistry
     */
    function getOracleConfig(address token) external view override returns (OracleConfig memory config) {
        OracleInfo storage info = oracles[token];
        config = OracleConfig({
            feed: info.feed,
            heartbeat: info.heartbeat,
            decimals: info.decimals,
            active: info.active
        });
    }

    // ============ View Functions ============

    /**
     * @notice Get oracle type for a token
     */
    function getOracleType(address token) external view returns (OracleType) {
        return oracles[token].oracleType;
    }

    /**
     * @notice Get Pyth price ID for a token
     */
    function getPythId(address token) external view returns (bytes32) {
        return oracles[token].pythId;
    }

    // ============ Admin Functions ============

    function setPyth(address pyth_) external onlyGovernance {
        pyth = IPyth(pyth_);
        emit PythUpdated(pyth_);
    }

    function setCacheDuration(uint256 duration) external onlyGovernance {
        cacheDuration = duration;
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        governance = newGovernance;
    }

    // ============ Internal Functions ============

    function _getPythPrice(OracleInfo storage info) internal view returns (uint256) {
        IPyth.Price memory price = pyth.getPriceNoOlderThan(info.pythId, info.heartbeat);

        // Convert Pyth price to OUTPUT_DECIMALS
        int256 priceInt = int256(price.price);
        int32 expo = price.expo;

        // Pyth prices can have negative exponents (e.g., -8 means divide by 10^8)
        if (expo >= 0) {
            return uint256(priceInt) * (10 ** uint256(int256(expo))) * (10 ** OUTPUT_DECIMALS);
        } else {
            int256 absExpo = -expo;
            uint256 scaleFactor = 10 ** OUTPUT_DECIMALS;
            uint256 divisor = 10 ** uint256(absExpo);

            // Scale up first, then divide
            return (uint256(priceInt) * scaleFactor) / divisor;
        }
    }

    function _getChainlinkPrice(OracleInfo storage info, address token) internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = IChainlinkFeed(info.feed).latestRoundData();

        // Check staleness
        uint256 staleness = block.timestamp - updatedAt;
        if (staleness > info.heartbeat) {
            revert PriceStale(token, staleness);
        }

        if (answer <= 0) {
            revert InvalidPrice(token);
        }

        // Normalize to OUTPUT_DECIMALS
        if (info.decimals > OUTPUT_DECIMALS) {
            return uint256(answer) / (10 ** (info.decimals - OUTPUT_DECIMALS));
        } else {
            return uint256(answer) * (10 ** (OUTPUT_DECIMALS - info.decimals));
        }
    }

    function _getCustomPrice(OracleInfo storage info, address token) internal view returns (uint256) {
        // Custom feeds expected to have latestAnswer() function
        (bool success, bytes memory data) = info.feed.staticcall(
            abi.encodeWithSignature("latestAnswer()")
        );

        if (!success || data.length == 0) {
            revert InvalidPrice(token);
        }

        int256 answer = abi.decode(data, (int256));

        if (answer <= 0) {
            revert InvalidPrice(token);
        }

        // Normalize to OUTPUT_DECIMALS
        if (info.decimals > OUTPUT_DECIMALS) {
            return uint256(answer) / (10 ** (info.decimals - OUTPUT_DECIMALS));
        } else {
            return uint256(answer) * (10 ** (OUTPUT_DECIMALS - info.decimals));
        }
    }
}

