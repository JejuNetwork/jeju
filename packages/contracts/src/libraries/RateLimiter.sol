// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title RateLimiter
 * @author Jeju Network
 * @notice Comprehensive rate limiting library with adaptive cooldowns
 * @dev Provides multiple rate limiting strategies for DDoS protection
 *
 * Features:
 * - Fixed window rate limiting (simple, gas efficient)
 * - Sliding window rate limiting (more accurate, higher gas)
 * - Token bucket rate limiting (smooth, allows bursts)
 * - Adaptive cooldowns (increases on repeated violations)
 * - Per-user and global rate limits
 * - Cooldown decay over time
 */
library RateLimiter {
    // ============ Errors ============
    error RateLimitExceeded(uint256 current, uint256 limit, uint256 resetTime);
    error CooldownActive(uint256 remainingTime);
    error InvalidConfiguration();

    // ============ Structs ============

    /// @notice Fixed window rate limit state
    struct FixedWindow {
        uint256 count; // Current count in window
        uint256 windowStart; // Start of current window
        uint256 limit; // Max actions per window
        uint256 windowSize; // Window duration in seconds
    }

    /// @notice Sliding window rate limit state (uses two half-windows)
    struct SlidingWindow {
        uint256 previousCount; // Count from previous window
        uint256 currentCount; // Count in current window
        uint256 windowStart; // Start of current window
        uint256 limit; // Max actions per window
        uint256 windowSize; // Window duration in seconds
    }

    /// @notice Token bucket rate limit state
    struct TokenBucket {
        uint256 tokens; // Current tokens available
        uint256 lastRefill; // Last refill timestamp
        uint256 capacity; // Max tokens (burst capacity)
        uint256 refillRate; // Tokens per second
    }

    /// @notice Adaptive cooldown state
    struct AdaptiveCooldown {
        uint256 violations; // Consecutive violations
        uint256 lastViolation; // Last violation timestamp
        uint256 cooldownUntil; // Current cooldown end time
        uint256 baseCooldown; // Base cooldown duration
        uint256 maxCooldown; // Maximum cooldown duration
        uint256 decayPeriod; // Period after which violations decay
    }

    /// @notice Global rate limit state (shared across all users)
    struct GlobalLimit {
        uint256 count; // Current global count
        uint256 windowStart; // Window start
        uint256 limit; // Global limit per window
        uint256 windowSize; // Window size
    }

    // ============ Fixed Window Functions ============

    /**
     * @notice Initialize a fixed window rate limiter
     * @param self The rate limiter state
     * @param limit Maximum actions per window
     * @param windowSize Window duration in seconds
     */
    function init(FixedWindow storage self, uint256 limit, uint256 windowSize) internal {
        if (limit == 0 || windowSize == 0) revert InvalidConfiguration();
        self.limit = limit;
        self.windowSize = windowSize;
        self.windowStart = block.timestamp;
        self.count = 0;
    }

    /**
     * @notice Check and consume a rate limit slot
     * @param self The rate limiter state
     * @return allowed Whether the action is allowed
     */
    function consume(FixedWindow storage self) internal returns (bool allowed) {
        // Reset window if expired
        if (block.timestamp >= self.windowStart + self.windowSize) {
            self.windowStart = block.timestamp;
            self.count = 0;
        }

        if (self.count >= self.limit) {
            return false;
        }

        self.count++;
        return true;
    }

    /**
     * @notice Check and consume, reverting if rate limited
     * @param self The rate limiter state
     */
    function consumeOrRevert(FixedWindow storage self) internal {
        if (!consume(self)) {
            revert RateLimitExceeded(self.count, self.limit, self.windowStart + self.windowSize);
        }
    }

    /**
     * @notice Get remaining capacity in current window
     * @param self The rate limiter state
     * @return remaining Number of actions remaining
     */
    function remaining(FixedWindow storage self) internal view returns (uint256) {
        if (block.timestamp >= self.windowStart + self.windowSize) {
            return self.limit;
        }
        return self.count >= self.limit ? 0 : self.limit - self.count;
    }

    // ============ Sliding Window Functions ============

    /**
     * @notice Initialize a sliding window rate limiter
     * @param self The rate limiter state
     * @param limit Maximum actions per window
     * @param windowSize Window duration in seconds
     */
    function init(SlidingWindow storage self, uint256 limit, uint256 windowSize) internal {
        if (limit == 0 || windowSize == 0) revert InvalidConfiguration();
        self.limit = limit;
        self.windowSize = windowSize;
        self.windowStart = block.timestamp;
        self.currentCount = 0;
        self.previousCount = 0;
    }

    /**
     * @notice Check and consume a rate limit slot with sliding window
     * @dev More accurate than fixed window but uses more gas
     * @param self The rate limiter state
     * @return allowed Whether the action is allowed
     */
    function consume(SlidingWindow storage self) internal returns (bool allowed) {
        uint256 currentTime = block.timestamp;
        uint256 windowEnd = self.windowStart + self.windowSize;

        // Check if we need to advance windows
        if (currentTime >= windowEnd) {
            // How many windows have passed?
            uint256 windowsPassed = (currentTime - self.windowStart) / self.windowSize;

            if (windowsPassed == 1) {
                // Just moved to next window
                self.previousCount = self.currentCount;
                self.currentCount = 0;
            } else {
                // Multiple windows passed, reset everything
                self.previousCount = 0;
                self.currentCount = 0;
            }

            self.windowStart = self.windowStart + (windowsPassed * self.windowSize);
        }

        // Calculate weighted count using sliding window
        uint256 timeIntoWindow = currentTime - self.windowStart;
        uint256 previousWeight = self.windowSize - timeIntoWindow;

        // Weighted count = (previous * weight) + current
        uint256 weightedCount = ((self.previousCount * previousWeight) / self.windowSize) + self.currentCount;

        if (weightedCount >= self.limit) {
            return false;
        }

        self.currentCount++;
        return true;
    }

    /**
     * @notice Check and consume, reverting if rate limited
     * @param self The rate limiter state
     */
    function consumeOrRevert(SlidingWindow storage self) internal {
        if (!consume(self)) {
            uint256 timeIntoWindow = block.timestamp - self.windowStart;
            uint256 previousWeight = self.windowSize - timeIntoWindow;
            uint256 weightedCount = ((self.previousCount * previousWeight) / self.windowSize) + self.currentCount;

            revert RateLimitExceeded(weightedCount, self.limit, self.windowStart + self.windowSize);
        }
    }

    // ============ Token Bucket Functions ============

    /**
     * @notice Initialize a token bucket rate limiter
     * @param self The rate limiter state
     * @param capacity Maximum tokens (burst capacity)
     * @param refillRate Tokens added per second
     */
    function init(TokenBucket storage self, uint256 capacity, uint256 refillRate) internal {
        if (capacity == 0 || refillRate == 0) revert InvalidConfiguration();
        self.capacity = capacity;
        self.refillRate = refillRate;
        self.tokens = capacity; // Start full
        self.lastRefill = block.timestamp;
    }

    /**
     * @notice Refill tokens based on time elapsed
     * @param self The rate limiter state
     */
    function refill(TokenBucket storage self) internal {
        uint256 elapsed = block.timestamp - self.lastRefill;
        if (elapsed == 0) return;

        uint256 tokensToAdd = elapsed * self.refillRate;
        self.tokens = self.tokens + tokensToAdd;

        if (self.tokens > self.capacity) {
            self.tokens = self.capacity;
        }

        self.lastRefill = block.timestamp;
    }

    /**
     * @notice Check and consume tokens
     * @param self The rate limiter state
     * @param amount Number of tokens to consume
     * @return allowed Whether the action is allowed
     */
    function consume(TokenBucket storage self, uint256 amount) internal returns (bool allowed) {
        refill(self);

        if (self.tokens < amount) {
            return false;
        }

        self.tokens -= amount;
        return true;
    }

    /**
     * @notice Consume 1 token or revert
     * @param self The rate limiter state
     */
    function consumeOrRevert(TokenBucket storage self) internal {
        if (!consume(self, 1)) {
            // Calculate when tokens will be available
            uint256 tokensNeeded = 1 - self.tokens;
            uint256 waitTime = (tokensNeeded + self.refillRate - 1) / self.refillRate;

            revert RateLimitExceeded(self.tokens, 1, block.timestamp + waitTime);
        }
    }

    /**
     * @notice Get current available tokens
     * @param self The rate limiter state
     * @return available Number of tokens available
     */
    function available(TokenBucket storage self) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - self.lastRefill;
        uint256 tokensToAdd = elapsed * self.refillRate;
        uint256 total = self.tokens + tokensToAdd;
        return total > self.capacity ? self.capacity : total;
    }

    // ============ Adaptive Cooldown Functions ============

    /**
     * @notice Initialize adaptive cooldown
     * @param self The cooldown state
     * @param baseCooldown Base cooldown duration in seconds
     * @param maxCooldown Maximum cooldown duration in seconds
     * @param decayPeriod Time after which violations start decaying
     */
    function init(AdaptiveCooldown storage self, uint256 baseCooldown, uint256 maxCooldown, uint256 decayPeriod)
        internal
    {
        if (baseCooldown == 0 || maxCooldown < baseCooldown) revert InvalidConfiguration();
        self.baseCooldown = baseCooldown;
        self.maxCooldown = maxCooldown;
        self.decayPeriod = decayPeriod;
        self.violations = 0;
        self.lastViolation = 0;
        self.cooldownUntil = 0;
    }

    /**
     * @notice Check if currently in cooldown
     * @param self The cooldown state
     * @return inCooldown Whether cooldown is active
     */
    function isInCooldown(AdaptiveCooldown storage self) internal view returns (bool) {
        return block.timestamp < self.cooldownUntil;
    }

    /**
     * @notice Revert if in cooldown
     * @param self The cooldown state
     */
    function enforceNotInCooldown(AdaptiveCooldown storage self) internal view {
        if (isInCooldown(self)) {
            revert CooldownActive(self.cooldownUntil - block.timestamp);
        }
    }

    /**
     * @notice Record a violation and apply cooldown
     * @param self The cooldown state
     * @return cooldownDuration The cooldown duration applied
     */
    function recordViolation(AdaptiveCooldown storage self) internal returns (uint256 cooldownDuration) {
        // Decay violations if enough time has passed
        if (self.decayPeriod > 0 && self.lastViolation > 0) {
            uint256 timeSinceLastViolation = block.timestamp - self.lastViolation;
            uint256 decayCount = timeSinceLastViolation / self.decayPeriod;

            if (decayCount > 0 && self.violations > 0) {
                self.violations = decayCount >= self.violations ? 0 : self.violations - decayCount;
            }
        }

        // Increment violations
        self.violations++;
        self.lastViolation = block.timestamp;

        // Calculate exponential cooldown: base * 2^(violations-1), capped at max
        // violations=1: base, violations=2: 2*base, violations=3: 4*base, etc.
        uint256 multiplier = 1 << (self.violations - 1); // 2^(violations-1)
        cooldownDuration = self.baseCooldown * multiplier;

        if (cooldownDuration > self.maxCooldown) {
            cooldownDuration = self.maxCooldown;
        }

        self.cooldownUntil = block.timestamp + cooldownDuration;
        return cooldownDuration;
    }

    /**
     * @notice Reset violations (e.g., after successful actions)
     * @param self The cooldown state
     */
    function resetViolations(AdaptiveCooldown storage self) internal {
        self.violations = 0;
        self.cooldownUntil = 0;
    }

    /**
     * @notice Get current violation count after decay
     * @param self The cooldown state
     * @return count Current violation count
     */
    function getViolations(AdaptiveCooldown storage self) internal view returns (uint256 count) {
        if (self.decayPeriod == 0 || self.lastViolation == 0) {
            return self.violations;
        }

        uint256 timeSinceLastViolation = block.timestamp - self.lastViolation;
        uint256 decayCount = timeSinceLastViolation / self.decayPeriod;

        return decayCount >= self.violations ? 0 : self.violations - decayCount;
    }

    // ============ Global Limit Functions ============

    /**
     * @notice Initialize global rate limit
     * @param self The global limit state
     * @param limit Maximum actions per window across all users
     * @param windowSize Window duration in seconds
     */
    function init(GlobalLimit storage self, uint256 limit, uint256 windowSize) internal {
        if (limit == 0 || windowSize == 0) revert InvalidConfiguration();
        self.limit = limit;
        self.windowSize = windowSize;
        self.windowStart = block.timestamp;
        self.count = 0;
    }

    /**
     * @notice Check and consume a global rate limit slot
     * @param self The global limit state
     * @return allowed Whether the action is allowed
     */
    function consume(GlobalLimit storage self) internal returns (bool allowed) {
        // Reset window if expired
        if (block.timestamp >= self.windowStart + self.windowSize) {
            self.windowStart = block.timestamp;
            self.count = 0;
        }

        if (self.count >= self.limit) {
            return false;
        }

        self.count++;
        return true;
    }

    /**
     * @notice Check and consume, reverting if globally rate limited
     * @param self The global limit state
     */
    function consumeOrRevert(GlobalLimit storage self) internal {
        if (!consume(self)) {
            revert RateLimitExceeded(self.count, self.limit, self.windowStart + self.windowSize);
        }
    }
}


