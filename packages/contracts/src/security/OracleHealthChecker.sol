// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CircuitBreaker} from "../libraries/CircuitBreaker.sol";

/**
 * @title OracleHealthChecker
 * @author Jeju Network
 * @notice Oracle health monitoring with staleness detection and circuit breakers
 * @dev Protects against oracle manipulation and downtime
 *
 * Features:
 * - Staleness detection with configurable thresholds
 * - Price deviation detection (sudden large moves)
 * - Multi-oracle consensus validation
 * - Automatic circuit breaker on anomalies
 * - Historical price tracking for TWAP
 * - Heartbeat monitoring
 */
abstract contract OracleHealthChecker is Ownable {
    using CircuitBreaker for CircuitBreaker.Breaker;

    // ============ Errors ============
    error OracleStale(uint256 lastUpdate, uint256 threshold);
    error PriceDeviationTooHigh(uint256 currentPrice, uint256 previousPrice, uint256 deviationBps);
    error OracleCircuitOpen();
    error InsufficientOracles(uint256 available, uint256 required);
    error PriceZero();
    error InvalidOracleAddress();
    error OracleNotRegistered();
    error OracleAlreadyRegistered();
    error ConsensusFailed(uint256 validPrices, uint256 required);

    // ============ Events ============
    event OracleRegistered(address indexed oracle, string name);
    event OracleRemoved(address indexed oracle);
    event OracleStaleDetected(address indexed oracle, uint256 lastUpdate);
    event PriceDeviationDetected(address indexed oracle, uint256 deviation);
    event OracleCircuitBreakerTripped(address indexed oracle);
    event OracleCircuitBreakerRecovered(address indexed oracle);
    event ConsensusPriceUpdated(uint256 price, uint256 timestamp, uint256 oracleCount);
    event HeartbeatReceived(address indexed oracle, uint256 timestamp);

    // ============ Structs ============

    struct OracleConfig {
        uint256 stalenessThreshold;         // Max age of price data (seconds)
        uint256 deviationThresholdBps;      // Max price deviation (basis points)
        uint256 minOracles;                 // Minimum oracles for consensus
        uint256 heartbeatInterval;          // Expected heartbeat interval
        uint256 circuitBreakerTimeout;      // Circuit breaker recovery time
        bool requireConsensus;              // Require multi-oracle consensus
    }

    struct OracleInfo {
        address oracleAddress;
        string name;
        bool isActive;
        uint256 lastUpdate;
        uint256 lastPrice;
        uint256 lastHeartbeat;
        uint256 failureCount;
        CircuitBreaker.Breaker circuitBreaker;
    }

    struct PriceObservation {
        uint256 price;
        uint256 timestamp;
        uint256 oracleCount;     // How many oracles contributed
        bool isValid;
    }

    // ============ State ============

    /// @notice Oracle configuration
    OracleConfig public oracleConfig;

    /// @notice Registered oracles
    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;

    /// @notice Price history for TWAP calculation
    PriceObservation[] public priceHistory;
    uint256 public maxPriceHistoryLength;

    /// @notice Last consensus price
    uint256 public lastConsensusPrice;
    uint256 public lastConsensusPriceTimestamp;

    /// @notice Global oracle circuit breaker (trips if too many oracles fail)
    CircuitBreaker.Breaker private _globalOracleCircuitBreaker;

    // ============ Constructor ============

    /**
     * @notice Initialize oracle health checker with default config
     */
    function _initOracleHealthChecker() internal {
        _initOracleHealthChecker(OracleConfig({
            stalenessThreshold: 300,         // 5 minutes
            deviationThresholdBps: 1000,     // 10% max deviation
            minOracles: 1,                   // Minimum 1 oracle
            heartbeatInterval: 60,           // 1 minute heartbeat
            circuitBreakerTimeout: 300,      // 5 minute recovery
            requireConsensus: false          // Single oracle mode
        }));
    }

    /**
     * @notice Initialize with custom config
     * @param config Oracle configuration
     */
    function _initOracleHealthChecker(OracleConfig memory config) internal {
        oracleConfig = config;
        maxPriceHistoryLength = 100; // Keep last 100 observations

        _globalOracleCircuitBreaker.init(
            3,      // 3 failures to trip
            2,      // 2 successes to recover
            config.circuitBreakerTimeout,
            3       // 3 requests in half-open
        );
    }

    // ============ Oracle Registration ============

    /**
     * @notice Register a new oracle
     * @param oracle Oracle address
     * @param name Human-readable name
     */
    function registerOracle(address oracle, string calldata name) external onlyOwner {
        if (oracle == address(0)) revert InvalidOracleAddress();
        if (oracles[oracle].oracleAddress != address(0)) revert OracleAlreadyRegistered();

        oracles[oracle] = OracleInfo({
            oracleAddress: oracle,
            name: name,
            isActive: true,
            lastUpdate: 0,
            lastPrice: 0,
            lastHeartbeat: block.timestamp,
            failureCount: 0,
            circuitBreaker: CircuitBreaker.Breaker({
                state: CircuitBreaker.State.CLOSED,
                failures: 0,
                successes: 0,
                lastFailure: 0,
                openUntil: 0,
                failureThreshold: 5,
                successThreshold: 3,
                timeout: oracleConfig.circuitBreakerTimeout,
                halfOpenMaxRequests: 3,
                halfOpenRequestCount: 0
            })
        });

        oracleList.push(oracle);
        emit OracleRegistered(oracle, name);
    }

    /**
     * @notice Remove an oracle
     * @param oracle Oracle address to remove
     */
    function removeOracle(address oracle) external onlyOwner {
        if (oracles[oracle].oracleAddress == address(0)) revert OracleNotRegistered();

        delete oracles[oracle];

        // Remove from list
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracleList[i] == oracle) {
                oracleList[i] = oracleList[oracleList.length - 1];
                oracleList.pop();
                break;
            }
        }

        emit OracleRemoved(oracle);
    }

    // ============ Health Checks ============

    /**
     * @notice Check if an oracle's data is fresh
     * @param oracle Oracle address
     * @return isFresh Whether the oracle data is fresh
     */
    function isOracleFresh(address oracle) public view returns (bool isFresh) {
        OracleInfo storage info = oracles[oracle];
        if (info.oracleAddress == address(0)) return false;
        if (!info.isActive) return false;
        
        return block.timestamp - info.lastUpdate <= oracleConfig.stalenessThreshold;
    }

    /**
     * @notice Check if price deviation is within acceptable range
     * @param newPrice New price to check
     * @param previousPrice Previous price
     * @return isValid Whether deviation is acceptable
     * @return deviationBps Actual deviation in basis points
     */
    function checkPriceDeviation(
        uint256 newPrice,
        uint256 previousPrice
    ) public view returns (bool isValid, uint256 deviationBps) {
        if (previousPrice == 0) {
            return (newPrice > 0, 0);
        }

        uint256 diff = newPrice > previousPrice 
            ? newPrice - previousPrice 
            : previousPrice - newPrice;
        
        deviationBps = (diff * 10000) / previousPrice;
        isValid = deviationBps <= oracleConfig.deviationThresholdBps;
    }

    /**
     * @notice Get number of active, healthy oracles
     * @return count Number of healthy oracles
     */
    function getHealthyOracleCount() public view returns (uint256 count) {
        for (uint256 i = 0; i < oracleList.length; i++) {
            OracleInfo storage info = oracles[oracleList[i]];
            if (info.isActive && isOracleFresh(oracleList[i])) {
                CircuitBreaker.State state = info.circuitBreaker.getState();
                if (state != CircuitBreaker.State.OPEN) {
                    count++;
                }
            }
        }
    }

    // ============ Price Updates ============

    /**
     * @notice Submit a price update from an oracle
     * @param price The new price
     */
    function submitPrice(uint256 price) external {
        OracleInfo storage info = oracles[msg.sender];
        if (info.oracleAddress == address(0)) revert OracleNotRegistered();
        if (price == 0) revert PriceZero();

        // Check circuit breaker
        if (!info.circuitBreaker.allowRequest()) {
            revert OracleCircuitOpen();
        }

        // Check deviation
        if (info.lastPrice > 0) {
            (bool isValid, uint256 deviationBps) = checkPriceDeviation(price, info.lastPrice);
            if (!isValid) {
                info.circuitBreaker.recordFailure();
                info.failureCount++;
                emit PriceDeviationDetected(msg.sender, deviationBps);
                
                if (info.circuitBreaker.getState() == CircuitBreaker.State.OPEN) {
                    emit OracleCircuitBreakerTripped(msg.sender);
                }
                
                revert PriceDeviationTooHigh(price, info.lastPrice, deviationBps);
            }
        }

        // Update oracle info
        info.lastPrice = price;
        info.lastUpdate = block.timestamp;
        info.circuitBreaker.recordSuccess();

        // Try to update consensus price
        _updateConsensusPrice();
    }

    /**
     * @notice Submit heartbeat to prove oracle liveness
     */
    function submitHeartbeat() external {
        OracleInfo storage info = oracles[msg.sender];
        if (info.oracleAddress == address(0)) revert OracleNotRegistered();

        info.lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    /**
     * @notice Update consensus price from all healthy oracles
     */
    function _updateConsensusPrice() internal {
        uint256 healthyCount = 0;
        uint256 priceSum = 0;
        uint256[] memory prices = new uint256[](oracleList.length);

        // Collect prices from healthy oracles
        for (uint256 i = 0; i < oracleList.length; i++) {
            OracleInfo storage info = oracles[oracleList[i]];
            
            if (info.isActive && 
                isOracleFresh(oracleList[i]) && 
                info.circuitBreaker.getState() != CircuitBreaker.State.OPEN) {
                
                prices[healthyCount] = info.lastPrice;
                priceSum += info.lastPrice;
                healthyCount++;
            }
        }

        // Check minimum oracle requirement
        if (healthyCount < oracleConfig.minOracles) {
            _globalOracleCircuitBreaker.recordFailure();
            return;
        }

        // Calculate median price (more manipulation resistant than mean)
        uint256 consensusPrice;
        if (healthyCount == 1) {
            consensusPrice = prices[0];
        } else {
            // Simple median for small sets
            _sortPrices(prices, healthyCount);
            if (healthyCount % 2 == 0) {
                consensusPrice = (prices[healthyCount/2 - 1] + prices[healthyCount/2]) / 2;
            } else {
                consensusPrice = prices[healthyCount/2];
            }
        }

        // Check consensus deviation from last price
        if (lastConsensusPrice > 0) {
            (bool isValid,) = checkPriceDeviation(consensusPrice, lastConsensusPrice);
            if (!isValid) {
                _globalOracleCircuitBreaker.recordFailure();
                return;
            }
        }

        // Update consensus price
        lastConsensusPrice = consensusPrice;
        lastConsensusPriceTimestamp = block.timestamp;
        _globalOracleCircuitBreaker.recordSuccess();

        // Add to history
        _addPriceObservation(consensusPrice, healthyCount);

        emit ConsensusPriceUpdated(consensusPrice, block.timestamp, healthyCount);
    }

    /**
     * @notice Add price observation to history
     * @param price The price
     * @param oracleCount Number of oracles
     */
    function _addPriceObservation(uint256 price, uint256 oracleCount) internal {
        priceHistory.push(PriceObservation({
            price: price,
            timestamp: block.timestamp,
            oracleCount: oracleCount,
            isValid: true
        }));

        // Trim history if too long
        if (priceHistory.length > maxPriceHistoryLength) {
            // Shift array (expensive but simple)
            for (uint256 i = 0; i < priceHistory.length - 1; i++) {
                priceHistory[i] = priceHistory[i + 1];
            }
            priceHistory.pop();
        }
    }

    /**
     * @notice Sort prices array (insertion sort, fine for small arrays)
     * @param arr The array to sort
     * @param length The number of elements
     */
    function _sortPrices(uint256[] memory arr, uint256 length) internal pure {
        for (uint256 i = 1; i < length; i++) {
            uint256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }

    // ============ TWAP Calculation ============

    /**
     * @notice Calculate TWAP over a time period
     * @param period Time period in seconds
     * @return twap Time-weighted average price
     * @return observationCount Number of observations used
     */
    function getTWAP(uint256 period) external view returns (uint256 twap, uint256 observationCount) {
        if (priceHistory.length == 0) {
            return (0, 0);
        }

        uint256 cutoff = block.timestamp - period;
        uint256 weightedSum = 0;
        uint256 totalWeight = 0;

        for (uint256 i = priceHistory.length; i > 0; i--) {
            PriceObservation storage obs = priceHistory[i - 1];
            
            if (obs.timestamp < cutoff) {
                break;
            }

            if (!obs.isValid) continue;

            // Weight by time spent at this price
            uint256 nextTimestamp = i < priceHistory.length 
                ? priceHistory[i].timestamp 
                : block.timestamp;
            
            uint256 weight = nextTimestamp - obs.timestamp;
            weightedSum += obs.price * weight;
            totalWeight += weight;
            observationCount++;
        }

        if (totalWeight == 0) {
            return (lastConsensusPrice, 0);
        }

        twap = weightedSum / totalWeight;
    }

    // ============ Protected Price Getter ============

    /**
     * @notice Get current price with all health checks
     * @return price The current consensus price
     */
    function getHealthyPrice() external view returns (uint256 price) {
        // Check global circuit breaker
        if (_globalOracleCircuitBreaker.getState() == CircuitBreaker.State.OPEN) {
            revert OracleCircuitOpen();
        }

        // Check staleness
        if (block.timestamp - lastConsensusPriceTimestamp > oracleConfig.stalenessThreshold) {
            revert OracleStale(lastConsensusPriceTimestamp, oracleConfig.stalenessThreshold);
        }

        // Check minimum oracles
        uint256 healthyCount = getHealthyOracleCount();
        if (healthyCount < oracleConfig.minOracles) {
            revert InsufficientOracles(healthyCount, oracleConfig.minOracles);
        }

        return lastConsensusPrice;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update oracle configuration
     * @param config New configuration
     */
    function setOracleConfig(OracleConfig calldata config) external onlyOwner {
        oracleConfig = config;
    }

    /**
     * @notice Set oracle active status
     * @param oracle Oracle address
     * @param active Whether oracle is active
     */
    function setOracleActive(address oracle, bool active) external onlyOwner {
        if (oracles[oracle].oracleAddress == address(0)) revert OracleNotRegistered();
        oracles[oracle].isActive = active;
    }

    /**
     * @notice Reset oracle circuit breaker
     * @param oracle Oracle address
     */
    function resetOracleCircuitBreaker(address oracle) external onlyOwner {
        if (oracles[oracle].oracleAddress == address(0)) revert OracleNotRegistered();
        oracles[oracle].circuitBreaker.forceClose();
        oracles[oracle].failureCount = 0;
        emit OracleCircuitBreakerRecovered(oracle);
    }

    /**
     * @notice Reset global circuit breaker
     */
    function resetGlobalCircuitBreaker() external onlyOwner {
        _globalOracleCircuitBreaker.forceClose();
    }

    /**
     * @notice Get oracle list
     * @return List of oracle addresses
     */
    function getOracleList() external view returns (address[] memory) {
        return oracleList;
    }

    /**
     * @notice Get price history length
     * @return Length of price history
     */
    function getPriceHistoryLength() external view returns (uint256) {
        return priceHistory.length;
    }
}


