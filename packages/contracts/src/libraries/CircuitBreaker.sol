// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title CircuitBreaker
 * @author Jeju Network
 * @notice Circuit breaker pattern for DDoS protection with auto-recovery
 * @dev Implements the circuit breaker pattern to protect against cascading failures
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, all requests rejected
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * Features:
 * - Configurable failure thresholds
 * - Automatic recovery after timeout
 * - Half-open state for gradual recovery
 * - Failure rate calculation
 * - Success/failure counters with sliding window
 * - Event emission for monitoring
 */
library CircuitBreaker {
    // ============ Errors ============
    error CircuitOpen(uint256 openUntil);
    error CircuitHalfOpen();
    error InvalidConfiguration();

    // ============ Enums ============
    enum State {
        CLOSED,     // Normal operation
        OPEN,       // All requests rejected
        HALF_OPEN   // Testing recovery
    }

    // ============ Structs ============

    /// @notice Circuit breaker state
    struct Breaker {
        State state;                    // Current circuit state
        uint256 failures;               // Consecutive failures
        uint256 successes;              // Consecutive successes (in half-open)
        uint256 lastFailure;            // Last failure timestamp
        uint256 openUntil;              // When circuit can transition to half-open
        uint256 failureThreshold;       // Failures before opening circuit
        uint256 successThreshold;       // Successes in half-open before closing
        uint256 timeout;                // Time before auto-recovery attempt
        uint256 halfOpenMaxRequests;    // Max requests allowed in half-open state
        uint256 halfOpenRequestCount;   // Current requests in half-open
    }

    /// @notice Sliding window for failure rate calculation
    struct SlidingWindowBreaker {
        State state;
        uint256[] failureTimestamps;    // Ring buffer of failure timestamps
        uint256 bufferIndex;            // Current position in ring buffer
        uint256 windowSize;             // Time window in seconds
        uint256 failureRateThreshold;   // Failure rate (basis points) to trip
        uint256 minRequests;            // Minimum requests before checking rate
        uint256 requestCount;           // Total requests in window
        uint256 openUntil;
        uint256 timeout;
        uint256 successThreshold;
        uint256 successes;
        uint256 halfOpenMaxRequests;
        uint256 halfOpenRequestCount;
    }

    // ============ Basic Circuit Breaker Functions ============

    /**
     * @notice Initialize a circuit breaker
     * @param self The circuit breaker state
     * @param failureThreshold Consecutive failures before opening
     * @param successThreshold Successes in half-open before closing
     * @param timeout Time before attempting recovery (in seconds)
     * @param halfOpenMaxRequests Max requests allowed in half-open state
     */
    function init(
        Breaker storage self,
        uint256 failureThreshold,
        uint256 successThreshold,
        uint256 timeout,
        uint256 halfOpenMaxRequests
    ) internal {
        if (failureThreshold == 0 || successThreshold == 0 || timeout == 0) {
            revert InvalidConfiguration();
        }
        
        self.state = State.CLOSED;
        self.failures = 0;
        self.successes = 0;
        self.lastFailure = 0;
        self.openUntil = 0;
        self.failureThreshold = failureThreshold;
        self.successThreshold = successThreshold;
        self.timeout = timeout;
        self.halfOpenMaxRequests = halfOpenMaxRequests;
        self.halfOpenRequestCount = 0;
    }

    /**
     * @notice Check if request is allowed and update state
     * @param self The circuit breaker state
     * @return allowed Whether the request is allowed
     */
    function allowRequest(Breaker storage self) internal returns (bool allowed) {
        if (self.state == State.CLOSED) {
            return true;
        }

        if (self.state == State.OPEN) {
            // Check if timeout has passed
            if (block.timestamp >= self.openUntil) {
                // Transition to half-open
                self.state = State.HALF_OPEN;
                self.halfOpenRequestCount = 0;
                self.successes = 0;
                return true;
            }
            return false;
        }

        // State is HALF_OPEN
        if (self.halfOpenRequestCount >= self.halfOpenMaxRequests) {
            return false;
        }
        
        self.halfOpenRequestCount++;
        return true;
    }

    /**
     * @notice Check if request is allowed, revert if not
     * @param self The circuit breaker state
     */
    function allowRequestOrRevert(Breaker storage self) internal {
        if (!allowRequest(self)) {
            if (self.state == State.OPEN) {
                revert CircuitOpen(self.openUntil);
            }
            revert CircuitHalfOpen();
        }
    }

    /**
     * @notice Record a successful request
     * @param self The circuit breaker state
     */
    function recordSuccess(Breaker storage self) internal {
        if (self.state == State.CLOSED) {
            // Reset consecutive failures on success
            self.failures = 0;
            return;
        }

        if (self.state == State.HALF_OPEN) {
            self.successes++;
            
            // Check if we should close the circuit
            if (self.successes >= self.successThreshold) {
                self.state = State.CLOSED;
                self.failures = 0;
                self.successes = 0;
                self.halfOpenRequestCount = 0;
            }
        }
    }

    /**
     * @notice Record a failed request
     * @param self The circuit breaker state
     */
    function recordFailure(Breaker storage self) internal {
        self.lastFailure = block.timestamp;

        if (self.state == State.HALF_OPEN) {
            // Any failure in half-open reopens the circuit
            self.state = State.OPEN;
            self.openUntil = block.timestamp + self.timeout;
            self.failures++;
            self.successes = 0;
            self.halfOpenRequestCount = 0;
            return;
        }

        if (self.state == State.CLOSED) {
            self.failures++;
            
            // Check if we should open the circuit
            if (self.failures >= self.failureThreshold) {
                self.state = State.OPEN;
                self.openUntil = block.timestamp + self.timeout;
            }
        }
    }

    /**
     * @notice Get current circuit state
     * @param self The circuit breaker state
     * @return state Current state
     */
    function getState(Breaker storage self) internal view returns (State state) {
        if (self.state == State.OPEN && block.timestamp >= self.openUntil) {
            return State.HALF_OPEN;
        }
        return self.state;
    }

    /**
     * @notice Force close the circuit (admin recovery)
     * @param self The circuit breaker state
     */
    function forceClose(Breaker storage self) internal {
        self.state = State.CLOSED;
        self.failures = 0;
        self.successes = 0;
        self.halfOpenRequestCount = 0;
    }

    /**
     * @notice Force open the circuit (emergency)
     * @param self The circuit breaker state
     * @param duration How long to keep open
     */
    function forceOpen(Breaker storage self, uint256 duration) internal {
        self.state = State.OPEN;
        self.openUntil = block.timestamp + duration;
    }

    // ============ Sliding Window Circuit Breaker Functions ============

    /**
     * @notice Initialize a sliding window circuit breaker
     * @param self The circuit breaker state
     * @param bufferSize Size of the failure timestamp ring buffer
     * @param windowSize Time window in seconds
     * @param failureRateThreshold Failure rate in basis points (e.g., 5000 = 50%)
     * @param minRequests Minimum requests before checking rate
     * @param timeout Recovery timeout
     * @param successThreshold Successes needed to close
     * @param halfOpenMaxRequests Max requests in half-open
     */
    function init(
        SlidingWindowBreaker storage self,
        uint256 bufferSize,
        uint256 windowSize,
        uint256 failureRateThreshold,
        uint256 minRequests,
        uint256 timeout,
        uint256 successThreshold,
        uint256 halfOpenMaxRequests
    ) internal {
        if (bufferSize == 0 || windowSize == 0 || failureRateThreshold == 0 || 
            failureRateThreshold > 10000 || timeout == 0) {
            revert InvalidConfiguration();
        }

        self.state = State.CLOSED;
        self.failureTimestamps = new uint256[](bufferSize);
        self.bufferIndex = 0;
        self.windowSize = windowSize;
        self.failureRateThreshold = failureRateThreshold;
        self.minRequests = minRequests;
        self.openUntil = 0;
        self.timeout = timeout;
        self.successThreshold = successThreshold;
        self.successes = 0;
        self.halfOpenMaxRequests = halfOpenMaxRequests;
        self.halfOpenRequestCount = 0;
        self.requestCount = 0;
    }

    /**
     * @notice Check if request is allowed
     * @param self The circuit breaker state
     * @return allowed Whether the request is allowed
     */
    function allowRequest(SlidingWindowBreaker storage self) internal returns (bool allowed) {
        if (self.state == State.CLOSED) {
            self.requestCount++;
            return true;
        }

        if (self.state == State.OPEN) {
            if (block.timestamp >= self.openUntil) {
                self.state = State.HALF_OPEN;
                self.halfOpenRequestCount = 0;
                self.successes = 0;
                self.requestCount = 0;
                return true;
            }
            return false;
        }

        // HALF_OPEN
        if (self.halfOpenRequestCount >= self.halfOpenMaxRequests) {
            return false;
        }
        
        self.halfOpenRequestCount++;
        self.requestCount++;
        return true;
    }

    /**
     * @notice Record a successful request
     * @param self The circuit breaker state
     */
    function recordSuccess(SlidingWindowBreaker storage self) internal {
        if (self.state == State.HALF_OPEN) {
            self.successes++;
            if (self.successes >= self.successThreshold) {
                self.state = State.CLOSED;
                self.successes = 0;
                self.halfOpenRequestCount = 0;
                // Clear failure buffer
                for (uint256 i = 0; i < self.failureTimestamps.length; i++) {
                    self.failureTimestamps[i] = 0;
                }
            }
        }
    }

    /**
     * @notice Record a failed request
     * @param self The circuit breaker state
     */
    function recordFailure(SlidingWindowBreaker storage self) internal {
        if (self.state == State.HALF_OPEN) {
            self.state = State.OPEN;
            self.openUntil = block.timestamp + self.timeout;
            self.successes = 0;
            self.halfOpenRequestCount = 0;
            return;
        }

        if (self.state == State.CLOSED) {
            // Record failure timestamp in ring buffer
            self.failureTimestamps[self.bufferIndex] = block.timestamp;
            self.bufferIndex = (self.bufferIndex + 1) % self.failureTimestamps.length;

            // Check failure rate
            if (self.requestCount >= self.minRequests) {
                uint256 recentFailures = _countRecentFailures(self);
                uint256 failureRate = (recentFailures * 10000) / self.requestCount;
                
                if (failureRate >= self.failureRateThreshold) {
                    self.state = State.OPEN;
                    self.openUntil = block.timestamp + self.timeout;
                }
            }
        }
    }

    /**
     * @notice Count failures in the current window
     * @param self The circuit breaker state
     * @return count Number of recent failures
     */
    function _countRecentFailures(SlidingWindowBreaker storage self) private view returns (uint256 count) {
        uint256 windowStart = block.timestamp - self.windowSize;
        
        for (uint256 i = 0; i < self.failureTimestamps.length; i++) {
            if (self.failureTimestamps[i] >= windowStart) {
                count++;
            }
        }
    }

    /**
     * @notice Get current failure rate
     * @param self The circuit breaker state
     * @return rate Failure rate in basis points
     */
    function getFailureRate(SlidingWindowBreaker storage self) internal view returns (uint256 rate) {
        if (self.requestCount == 0) return 0;
        
        uint256 recentFailures = _countRecentFailures(self);
        return (recentFailures * 10000) / self.requestCount;
    }

    /**
     * @notice Force close the sliding window circuit
     * @param self The circuit breaker state
     */
    function forceClose(SlidingWindowBreaker storage self) internal {
        self.state = State.CLOSED;
        self.successes = 0;
        self.halfOpenRequestCount = 0;
        self.requestCount = 0;
        
        for (uint256 i = 0; i < self.failureTimestamps.length; i++) {
            self.failureTimestamps[i] = 0;
        }
    }
}


