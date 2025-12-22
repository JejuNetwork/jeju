// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracleRegistry} from "./IOracleRegistry.sol";

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

    enum OracleType {
        CHAINLINK,
        PYTH,
        TWAP,
        CUSTOM
    }

    struct OracleInfo {
        address feed;           // Feed address (Chainlink aggregator, custom feed)
        bytes32 pythId;         // Pyth price ID (if Pyth)
        uint256 heartbeat;      // Max staleness in seconds
        uint8 decimals;         // Source decimals
        OracleType oracleType;
        bool active;
    }

    /// @notice Pyth oracle contract
    IPyth public pyth;

    /// @notice TWAP oracle contract
    ITWAPOracle public twapOracle;

    /// @notice Oracle configs by token
    mapping(address => OracleInfo) public oracles;

    /// @notice Fallback oracle configs by token (used when primary fails)
    mapping(address => OracleInfo) public fallbackOracles;

    /// @notice Price cache (for gas optimization)
    mapping(address => uint256) private _cachedPrices;
    mapping(address => uint256) private _cacheTimestamps;

    /// @notice Cache duration in seconds
    uint256 public cacheDuration = 10;

    /// @notice Target decimals for output
    uint8 public constant OUTPUT_DECIMALS = 8;

    /// @notice Governance address
    address public governance;

    /// @notice Enable fallback oracle usage
    bool public useFallback = true;

    /// @notice Max deviation between primary and fallback (basis points)
    uint256 public maxPriceDeviation = 500; // 5%

    event OracleRegistered(
        address indexed token,
        address feed,
        bytes32 pythId,
        OracleType oracleType
    );
    event FallbackOracleRegistered(
        address indexed token,
        address feed,
        OracleType oracleType
    );
    event OracleDeactivated(address indexed token);
    event PythUpdated(address indexed pyth);
    event TWAPOracleUpdated(address indexed twapOracle);
    event FallbackUsed(address indexed token, OracleType fallbackType);

    error OracleNotFound(address token);
    error PriceStale(address token, uint256 staleness);
    error InvalidPrice(address token);
    error OracleInactive(address token);
    error PriceDeviationTooHigh(address token, uint256 deviation);

    constructor(
        address pyth_,
        address twapOracle_,
        address governance_
    ) Ownable(msg.sender) {
        pyth = IPyth(pyth_);
        twapOracle = ITWAPOracle(twapOracle_);
        governance = governance_;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance || msg.sender == owner(), "Not governance");
        _;
    }

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

    function registerTWAPOracle(
        address token,
        uint256 heartbeat
    ) external onlyOwner {
        oracles[token] = OracleInfo({
            feed: address(twapOracle),
            pythId: bytes32(0),
            heartbeat: heartbeat,
            decimals: OUTPUT_DECIMALS,
            oracleType: OracleType.TWAP,
            active: true
        });

        emit OracleRegistered(token, address(twapOracle), bytes32(0), OracleType.TWAP);
    }

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

    function registerFallbackOracle(
        address token,
        OracleType oracleType,
        address feed,
        bytes32 pythId,
        uint256 heartbeat,
        uint8 decimals
    ) external onlyOwner {
        fallbackOracles[token] = OracleInfo({
            feed: feed,
            pythId: pythId,
            heartbeat: heartbeat,
            decimals: decimals,
            oracleType: oracleType,
            active: true
        });

        emit FallbackOracleRegistered(token, feed, oracleType);
    }

    function deactivateOracle(address token) external onlyOwner {
        oracles[token].active = false;
        emit OracleDeactivated(token);
    }

    function deactivateFallbackOracle(address token) external onlyOwner {
        fallbackOracles[token].active = false;
    }

    function getPrice(address token) external view override returns (uint256 price) {
        OracleInfo storage info = oracles[token];

        if (info.feed == address(0) && info.pythId == bytes32(0)) {
            revert OracleNotFound(token);
        }
        if (!info.active) {
            revert OracleInactive(token);
        }

        // Try primary oracle
        bool primarySuccess;
        (primarySuccess, price) = _tryGetPrice(info, token);

        // If primary fails and fallback is enabled, try fallback
        if (!primarySuccess && useFallback) {
            OracleInfo storage fallbackInfo = fallbackOracles[token];
            if (fallbackInfo.active && (fallbackInfo.feed != address(0) || fallbackInfo.pythId != bytes32(0))) {
                (bool fallbackSuccess, uint256 fallbackPrice) = _tryGetPrice(fallbackInfo, token);
                if (fallbackSuccess) {
                    price = fallbackPrice;
                }
            }
        }

        if (price == 0) {
            revert InvalidPrice(token);
        }
    }

    function getPriceWithValidation(address token) external view returns (
        uint256 primaryPrice,
        uint256 fallbackPrice,
        uint256 deviation,
        bool isValid
    ) {
        OracleInfo storage info = oracles[token];
        OracleInfo storage fallbackInfo = fallbackOracles[token];

        (bool primarySuccess, uint256 pPrice) = _tryGetPrice(info, token);
        (bool fallbackSuccess, uint256 fPrice) = _tryGetPrice(fallbackInfo, token);

        primaryPrice = pPrice;
        fallbackPrice = fPrice;

        if (primarySuccess && fallbackSuccess && pPrice > 0 && fPrice > 0) {
            uint256 diff = pPrice > fPrice ? pPrice - fPrice : fPrice - pPrice;
            uint256 avg = (pPrice + fPrice) / 2;
            deviation = (diff * 10000) / avg;
            isValid = deviation <= maxPriceDeviation;
        } else {
            deviation = 0;
            isValid = primarySuccess || fallbackSuccess;
        }
    }

    function _tryGetPrice(OracleInfo storage info, address token) internal view returns (bool success, uint256 price) {
        if (info.feed == address(0) && info.pythId == bytes32(0)) {
            return (false, 0);
        }

        if (info.oracleType == OracleType.PYTH) {
            return _tryGetPythPrice(info);
        } else if (info.oracleType == OracleType.CHAINLINK) {
            return _tryGetChainlinkPrice(info, token);
        } else if (info.oracleType == OracleType.TWAP) {
            return _tryGetTWAPPrice(token);
        } else {
            return _tryGetCustomPrice(info, token);
        }
    }

    function getPrices(address[] calldata tokens) external view override returns (uint256[] memory prices) {
        prices = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            prices[i] = this.getPrice(tokens[i]);
        }
    }

    function isPriceStale(address token) external view override returns (bool) {
        OracleInfo storage info = oracles[token];

        if (info.oracleType == OracleType.CHAINLINK) {
            (, , , uint256 updatedAt, ) = IChainlinkFeed(info.feed).latestRoundData();
            return block.timestamp - updatedAt > info.heartbeat;
        }

        // For Pyth, staleness is checked during fetch
        return false;
    }

    function getOracleConfig(address token) external view override returns (OracleConfig memory config) {
        OracleInfo storage info = oracles[token];
        config = OracleConfig({
            feed: info.feed,
            heartbeat: info.heartbeat,
            decimals: info.decimals,
            active: info.active
        });
    }

    function getOracleType(address token) external view returns (OracleType) {
        return oracles[token].oracleType;
    }

    function getPythId(address token) external view returns (bytes32) {
        return oracles[token].pythId;
    }

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

    function _tryGetPythPrice(OracleInfo storage info) internal view returns (bool success, uint256 price) {
        try pyth.getPriceNoOlderThan(info.pythId, info.heartbeat) returns (IPyth.Price memory pythPrice) {
            // Validate price is positive
            if (pythPrice.price <= 0) {
                return (false, 0);
            }

            // Check confidence is not too wide (conf should be < 1% of price)
            // This protects against using unreliable prices during high volatility
            uint64 maxConfidence = uint64(pythPrice.price) / 100; // 1% threshold
            if (pythPrice.conf > maxConfidence) {
                return (false, 0);
            }

            int256 priceInt = int256(pythPrice.price);
            int32 expo = pythPrice.expo;

            if (expo >= 0) {
                price = uint256(priceInt) * (10 ** uint256(int256(expo))) * (10 ** OUTPUT_DECIMALS);
            } else {
                int256 absExpo = -expo;
                uint256 scaleFactor = 10 ** OUTPUT_DECIMALS;
                uint256 divisor = 10 ** uint256(absExpo);
                price = (uint256(priceInt) * scaleFactor) / divisor;
            }
            success = price > 0;
        } catch {
            success = false;
            price = 0;
        }
    }

    function _tryGetChainlinkPrice(OracleInfo storage info, address) internal view returns (bool success, uint256 price) {
        try IChainlinkFeed(info.feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            uint256 staleness = block.timestamp - updatedAt;
            if (staleness > info.heartbeat || answer <= 0) {
                return (false, 0);
            }

            if (info.decimals > OUTPUT_DECIMALS) {
                price = uint256(answer) / (10 ** (info.decimals - OUTPUT_DECIMALS));
            } else {
                price = uint256(answer) * (10 ** (OUTPUT_DECIMALS - info.decimals));
            }
            success = true;
        } catch {
            success = false;
            price = 0;
        }
    }

    function _tryGetTWAPPrice(address token) internal view returns (bool success, uint256 price) {
        if (address(twapOracle) == address(0)) {
            return (false, 0);
        }

        try twapOracle.isValidTWAP(token) returns (bool isValid) {
            if (!isValid) {
                return (false, 0);
            }
        } catch {
            return (false, 0);
        }

        try twapOracle.getPrice(token) returns (uint256 twapPrice) {
            success = twapPrice > 0;
            price = twapPrice;
        } catch {
            success = false;
            price = 0;
        }
    }

    function _tryGetCustomPrice(OracleInfo storage info, address) internal view returns (bool success, uint256 price) {
        (bool callSuccess, bytes memory data) = info.feed.staticcall(
            abi.encodeWithSignature("latestAnswer()")
        );

        if (!callSuccess || data.length == 0) {
            return (false, 0);
        }

        int256 answer = abi.decode(data, (int256));
        if (answer <= 0) {
            return (false, 0);
        }

        if (info.decimals > OUTPUT_DECIMALS) {
            price = uint256(answer) / (10 ** (info.decimals - OUTPUT_DECIMALS));
        } else {
            price = uint256(answer) * (10 ** (OUTPUT_DECIMALS - info.decimals));
        }
        success = true;
    }

    function setTWAPOracle(address twapOracle_) external onlyGovernance {
        twapOracle = ITWAPOracle(twapOracle_);
        emit TWAPOracleUpdated(twapOracle_);
    }

    function setUseFallback(bool enabled) external onlyGovernance {
        useFallback = enabled;
    }

    function setMaxPriceDeviation(uint256 deviationBps) external onlyGovernance {
        maxPriceDeviation = deviationBps;
    }
}

