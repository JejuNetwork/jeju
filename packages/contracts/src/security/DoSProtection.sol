// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RateLimiter} from "../libraries/RateLimiter.sol";
import {CircuitBreaker} from "../libraries/CircuitBreaker.sol";

/**
 * @title DoSProtection
 * @author Jeju Network
 * @notice Abstract contract providing comprehensive DDoS protection patterns
 * @dev Inherit this contract and use the provided modifiers for protection
 *
 * Features:
 * - Per-user rate limiting
 * - Global rate limiting
 * - Adaptive cooldowns for repeat offenders
 * - Circuit breakers for cascading failure protection
 * - Batch size limits
 * - Request throttling during high load
 *
 * Usage:
 * 1. Inherit DoSProtection
 * 2. Call _initDoSProtection() in constructor
 * 3. Apply modifiers to protected functions
 */
abstract contract DoSProtection is Ownable {
    using RateLimiter for RateLimiter.FixedWindow;
    using RateLimiter for RateLimiter.TokenBucket;
    using RateLimiter for RateLimiter.AdaptiveCooldown;
    using RateLimiter for RateLimiter.GlobalLimit;
    using CircuitBreaker for CircuitBreaker.Breaker;

    // ============ Errors ============
    error BatchSizeExceeded(uint256 provided, uint256 maximum);
    error GlobalRateLimitExceeded();
    error UserRateLimitExceeded();
    error UserInCooldown(uint256 remainingTime);
    error ServiceUnavailable();
    error ThrottledDuringHighLoad();

    // ============ Events ============
    event RateLimitViolation(address indexed user, uint256 violations);
    event CircuitBreakerTripped(string reason);
    event CircuitBreakerRecovered();
    event UserCooldownApplied(address indexed user, uint256 duration);
    event EmergencyThrottleEnabled(uint256 until);
    event EmergencyThrottleDisabled();

    // ============ Structs ============

    struct DoSConfig {
        uint256 userRateLimitPerMinute; // Max actions per user per minute
        uint256 globalRateLimitPerMinute; // Max total actions per minute
        uint256 baseCooldownSeconds; // Base cooldown for violations
        uint256 maxCooldownSeconds; // Max cooldown after repeated violations
        uint256 cooldownDecayPeriod; // Time for violation count to decay
        uint256 maxBatchSize; // Maximum items in batch operations
        uint256 circuitBreakerFailureThreshold; // Failures before circuit opens
        uint256 circuitBreakerTimeout; // Circuit breaker recovery timeout
    }

    // ============ State ============

    /// @notice Default configuration
    DoSConfig public dosConfig;

    /// @notice Per-user rate limiters
    mapping(address => RateLimiter.TokenBucket) private _userRateLimits;

    /// @notice Per-user adaptive cooldowns
    mapping(address => RateLimiter.AdaptiveCooldown) private _userCooldowns;

    /// @notice Global rate limiter
    RateLimiter.GlobalLimit private _globalRateLimit;

    /// @notice Service circuit breaker
    CircuitBreaker.Breaker private _circuitBreaker;

    /// @notice Emergency throttle until timestamp
    uint256 public emergencyThrottleUntil;

    /// @notice Addresses exempt from rate limiting
    mapping(address => bool) public rateLimitExempt;

    // ============ Modifiers ============

    /**
     * @notice Ensure batch size is within limits
     * @param size The batch size to check
     */
    modifier withinBatchLimit(uint256 size) {
        if (size > dosConfig.maxBatchSize) {
            revert BatchSizeExceeded(size, dosConfig.maxBatchSize);
        }
        _;
    }

    /**
     * @notice Apply rate limiting to sender
     */
    modifier rateLimited() {
        if (!rateLimitExempt[msg.sender]) {
            _enforceRateLimits(msg.sender);
        }
        _;
    }

    /**
     * @notice Check circuit breaker before proceeding
     */
    modifier circuitBreakerProtected() {
        if (!_circuitBreaker.allowRequest()) {
            revert ServiceUnavailable();
        }
        _;
    }

    /**
     * @notice Check emergency throttle
     */
    modifier notThrottled() {
        if (block.timestamp < emergencyThrottleUntil && !rateLimitExempt[msg.sender]) {
            revert ThrottledDuringHighLoad();
        }
        _;
    }

    /**
     * @notice Combined protection: rate limit + circuit breaker + throttle
     */
    modifier protected() {
        // Check emergency throttle first
        if (block.timestamp < emergencyThrottleUntil && !rateLimitExempt[msg.sender]) {
            revert ThrottledDuringHighLoad();
        }

        // Check circuit breaker
        if (!_circuitBreaker.allowRequest()) {
            revert ServiceUnavailable();
        }

        // Check rate limits
        if (!rateLimitExempt[msg.sender]) {
            _enforceRateLimits(msg.sender);
        }

        _;

        // Record success for circuit breaker
        _circuitBreaker.recordSuccess();
    }

    // ============ Initialization ============

    /**
     * @notice Initialize DoS protection with default config
     */
    function _initDoSProtection() internal {
        _initDoSProtection(
            DoSConfig({
                userRateLimitPerMinute: 60, // 1 per second average, allows bursts
                globalRateLimitPerMinute: 1000, // 1000 total actions per minute
                baseCooldownSeconds: 60, // 1 minute base cooldown
                maxCooldownSeconds: 3600, // 1 hour max cooldown
                cooldownDecayPeriod: 3600, // 1 hour decay
                maxBatchSize: 100, // Max 100 items per batch
                circuitBreakerFailureThreshold: 10, // 10 failures to trip
                circuitBreakerTimeout: 300 // 5 minute recovery
            })
        );
    }

    /**
     * @notice Initialize DoS protection with custom config
     * @param config The configuration to use
     */
    function _initDoSProtection(DoSConfig memory config) internal {
        dosConfig = config;

        // Initialize global rate limit
        _globalRateLimit.init(config.globalRateLimitPerMinute, 60);

        // Initialize circuit breaker
        _circuitBreaker.init(
            config.circuitBreakerFailureThreshold,
            3, // 3 successes in half-open to close
            config.circuitBreakerTimeout,
            5 // 5 requests in half-open
        );
    }

    // ============ Internal Functions ============

    /**
     * @notice Initialize rate limiter for a user if needed
     * @param user The user address
     */
    function _initUserRateLimiter(address user) internal {
        RateLimiter.TokenBucket storage bucket = _userRateLimits[user];
        if (bucket.capacity == 0) {
            bucket.init(
                dosConfig.userRateLimitPerMinute, // capacity
                dosConfig.userRateLimitPerMinute / 60 // refill rate per second
            );
        }
    }

    /**
     * @notice Initialize cooldown for a user if needed
     * @param user The user address
     */
    function _initUserCooldown(address user) internal {
        RateLimiter.AdaptiveCooldown storage cooldown = _userCooldowns[user];
        if (cooldown.baseCooldown == 0) {
            cooldown.init(dosConfig.baseCooldownSeconds, dosConfig.maxCooldownSeconds, dosConfig.cooldownDecayPeriod);
        }
    }

    /**
     * @notice Enforce rate limits on a user
     * @param user The user to check
     */
    function _enforceRateLimits(address user) internal {
        // Initialize if needed
        _initUserRateLimiter(user);
        _initUserCooldown(user);

        // Check cooldown first
        RateLimiter.AdaptiveCooldown storage cooldown = _userCooldowns[user];
        if (cooldown.isInCooldown()) {
            revert UserInCooldown(cooldown.cooldownUntil - block.timestamp);
        }

        // Check global rate limit
        if (!_globalRateLimit.consume()) {
            revert GlobalRateLimitExceeded();
        }

        // Check user rate limit
        RateLimiter.TokenBucket storage bucket = _userRateLimits[user];
        if (!bucket.consume(1)) {
            // Rate limit exceeded - apply cooldown
            uint256 cooldownDuration = cooldown.recordViolation();
            emit RateLimitViolation(user, cooldown.violations);
            emit UserCooldownApplied(user, cooldownDuration);
            revert UserRateLimitExceeded();
        }
    }

    /**
     * @notice Record a failure for circuit breaker
     */
    function _recordFailure() internal {
        CircuitBreaker.State previousState = _circuitBreaker.getState();
        _circuitBreaker.recordFailure();

        if (previousState != CircuitBreaker.State.OPEN && _circuitBreaker.getState() == CircuitBreaker.State.OPEN) {
            emit CircuitBreakerTripped("Failure threshold exceeded");
        }
    }

    /**
     * @notice Record a success for circuit breaker
     */
    function _recordSuccess() internal {
        CircuitBreaker.State previousState = _circuitBreaker.getState();
        _circuitBreaker.recordSuccess();

        if (
            previousState == CircuitBreaker.State.HALF_OPEN && _circuitBreaker.getState() == CircuitBreaker.State.CLOSED
        ) {
            emit CircuitBreakerRecovered();
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get remaining rate limit for a user
     * @param user The user address
     * @return remaining Number of actions remaining
     */
    function getRemainingRateLimit(address user) external view returns (uint256 remaining) {
        RateLimiter.TokenBucket storage bucket = _userRateLimits[user];
        if (bucket.capacity == 0) {
            return dosConfig.userRateLimitPerMinute;
        }
        return bucket.available();
    }

    /**
     * @notice Check if user is in cooldown
     * @param user The user address
     * @return inCooldown Whether user is in cooldown
     * @return remainingTime Remaining cooldown time in seconds
     */
    function getUserCooldownStatus(address user) external view returns (bool inCooldown, uint256 remainingTime) {
        RateLimiter.AdaptiveCooldown storage cooldown = _userCooldowns[user];
        if (cooldown.baseCooldown == 0) {
            return (false, 0);
        }

        inCooldown = cooldown.isInCooldown();
        if (inCooldown) {
            remainingTime = cooldown.cooldownUntil - block.timestamp;
        }
    }

    /**
     * @notice Get circuit breaker status
     * @return state Current circuit state
     * @return openUntil Timestamp when circuit can recover (if open)
     */
    function getCircuitBreakerStatus() external view returns (CircuitBreaker.State state, uint256 openUntil) {
        state = _circuitBreaker.getState();
        openUntil = _circuitBreaker.openUntil;
    }

    /**
     * @notice Get user violation count
     * @param user The user address
     * @return violations Number of rate limit violations (after decay)
     */
    function getUserViolations(address user) external view returns (uint256 violations) {
        RateLimiter.AdaptiveCooldown storage cooldown = _userCooldowns[user];
        if (cooldown.baseCooldown == 0) {
            return 0;
        }
        return cooldown.getViolations();
    }

    // ============ Admin Functions ============

    /**
     * @notice Update DoS protection configuration
     * @param config New configuration
     */
    function setDoSConfig(DoSConfig calldata config) external onlyOwner {
        dosConfig = config;
        _globalRateLimit.init(config.globalRateLimitPerMinute, 60);
    }

    /**
     * @notice Set rate limit exemption for an address
     * @param account The account to exempt
     * @param exempt Whether to exempt
     */
    function setRateLimitExempt(address account, bool exempt) external onlyOwner {
        rateLimitExempt[account] = exempt;
    }

    /**
     * @notice Enable emergency throttle
     * @param duration Duration in seconds
     */
    function enableEmergencyThrottle(uint256 duration) external onlyOwner {
        emergencyThrottleUntil = block.timestamp + duration;
        emit EmergencyThrottleEnabled(emergencyThrottleUntil);
    }

    /**
     * @notice Disable emergency throttle
     */
    function disableEmergencyThrottle() external onlyOwner {
        emergencyThrottleUntil = 0;
        emit EmergencyThrottleDisabled();
    }

    /**
     * @notice Force close circuit breaker
     */
    function forceCloseCircuitBreaker() external onlyOwner {
        _circuitBreaker.forceClose();
        emit CircuitBreakerRecovered();
    }

    /**
     * @notice Force open circuit breaker
     * @param duration Duration to keep open
     */
    function forceOpenCircuitBreaker(uint256 duration) external onlyOwner {
        _circuitBreaker.forceOpen(duration);
        emit CircuitBreakerTripped("Forced by admin");
    }

    /**
     * @notice Reset user cooldown (admin recovery)
     * @param user The user to reset
     */
    function resetUserCooldown(address user) external onlyOwner {
        RateLimiter.AdaptiveCooldown storage cooldown = _userCooldowns[user];
        if (cooldown.baseCooldown > 0) {
            cooldown.resetViolations();
        }
    }
}




