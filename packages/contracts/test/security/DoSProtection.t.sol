// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/libraries/RateLimiter.sol";
import "../../src/libraries/CircuitBreaker.sol";

/**
 * @title DoSProtectionTest
 * @notice Comprehensive tests for DDoS protection mechanisms
 */
contract RateLimiterTest is Test {
    using RateLimiter for RateLimiter.FixedWindow;
    using RateLimiter for RateLimiter.SlidingWindow;
    using RateLimiter for RateLimiter.TokenBucket;
    using RateLimiter for RateLimiter.AdaptiveCooldown;
    using RateLimiter for RateLimiter.GlobalLimit;

    RateLimiter.FixedWindow fixedWindow;
    RateLimiter.SlidingWindow slidingWindow;
    RateLimiter.TokenBucket tokenBucket;
    RateLimiter.AdaptiveCooldown cooldown;
    RateLimiter.GlobalLimit globalLimit;

    function setUp() public {
        // Initialize rate limiters
        fixedWindow.init(10, 60); // 10 actions per minute
        slidingWindow.init(10, 60);
        tokenBucket.init(10, 1); // 10 capacity, 1 per second refill
        cooldown.init(60, 3600, 3600); // 60s base, 1hr max, 1hr decay
        globalLimit.init(100, 60);
    }

    // ============ Fixed Window Tests ============

    function test_FixedWindow_AllowsWithinLimit() public {
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(fixedWindow.consume(), "Should allow within limit");
        }
        assertFalse(fixedWindow.consume(), "Should reject at limit");
    }

    function test_FixedWindow_ResetsAfterWindow() public {
        // Consume all
        for (uint256 i = 0; i < 10; i++) {
            fixedWindow.consume();
        }
        assertFalse(fixedWindow.consume(), "Should be at limit");

        // Advance time past window
        vm.warp(block.timestamp + 61);

        assertTrue(fixedWindow.consume(), "Should allow after window reset");
    }

    function test_FixedWindow_RemainingCapacity() public {
        assertEq(fixedWindow.remaining(), 10, "Should have full capacity");

        fixedWindow.consume();
        fixedWindow.consume();

        assertEq(fixedWindow.remaining(), 8, "Should have 8 remaining");
    }

    // ============ Sliding Window Tests ============

    function test_SlidingWindow_AllowsWithinLimit() public {
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(slidingWindow.consume(), "Should allow within limit");
        }
        assertFalse(slidingWindow.consume(), "Should reject at limit");
    }

    function test_SlidingWindow_PartialDecay() public {
        // Consume half the limit
        for (uint256 i = 0; i < 5; i++) {
            slidingWindow.consume();
        }

        // Advance half the window
        vm.warp(block.timestamp + 30);

        // Previous window contributes 50% (5 * 0.5 = 2.5 rounded)
        // So we should have ~7-8 remaining
        uint256 consumed = 0;
        while (slidingWindow.consume()) {
            consumed++;
            if (consumed > 20) break; // Safety
        }

        assertTrue(consumed >= 5 && consumed <= 8, "Sliding window should allow partial decay");
    }

    // ============ Token Bucket Tests ============

    function test_TokenBucket_AllowsBurst() public {
        // Should allow burst up to capacity
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(tokenBucket.consume(1), "Should allow burst");
        }
        assertFalse(tokenBucket.consume(1), "Should reject when empty");
    }

    function test_TokenBucket_Refills() public {
        // Drain bucket
        for (uint256 i = 0; i < 10; i++) {
            tokenBucket.consume(1);
        }

        // Wait for refill
        vm.warp(block.timestamp + 5);

        // Should have 5 tokens
        assertEq(tokenBucket.available(), 5, "Should have refilled 5 tokens");
    }

    function test_TokenBucket_CapsAtCapacity() public {
        // Wait a long time
        vm.warp(block.timestamp + 1000);

        // Should cap at capacity
        assertEq(tokenBucket.available(), 10, "Should cap at capacity");
    }

    // ============ Adaptive Cooldown Tests ============

    function test_AdaptiveCooldown_NotInCooldownInitially() public view {
        assertFalse(cooldown.isInCooldown(), "Should not be in cooldown initially");
    }

    function test_AdaptiveCooldown_RecordsViolation() public {
        uint256 duration = cooldown.recordViolation();
        assertEq(duration, 60, "First violation should have base cooldown");
        assertTrue(cooldown.isInCooldown(), "Should be in cooldown");
    }

    function test_AdaptiveCooldown_ExponentialBackoff() public {
        cooldown.recordViolation();
        vm.warp(block.timestamp + 61);

        uint256 duration2 = cooldown.recordViolation();
        assertEq(duration2, 120, "Second violation should double cooldown");

        vm.warp(block.timestamp + 121);

        uint256 duration3 = cooldown.recordViolation();
        assertEq(duration3, 240, "Third violation should quadruple cooldown");
    }

    function test_AdaptiveCooldown_CapsAtMax() public {
        // Record many violations
        for (uint256 i = 0; i < 10; i++) {
            cooldown.recordViolation();
            vm.warp(cooldown.cooldownUntil + 1);
        }

        uint256 duration = cooldown.recordViolation();
        assertEq(duration, 3600, "Should cap at max cooldown");
    }

    function test_AdaptiveCooldown_DecaysViolations() public {
        cooldown.recordViolation();
        vm.warp(block.timestamp + 61);
        cooldown.recordViolation();

        // Wait for decay period
        vm.warp(block.timestamp + 3601);

        // Violations should have decayed
        uint256 violations = cooldown.getViolations();
        assertEq(violations, 1, "Violations should decay");
    }

    function test_AdaptiveCooldown_Reset() public {
        cooldown.recordViolation();
        assertTrue(cooldown.isInCooldown(), "Should be in cooldown");

        cooldown.resetViolations();
        assertFalse(cooldown.isInCooldown(), "Should not be in cooldown after reset");
        assertEq(cooldown.violations, 0, "Violations should be zero");
    }

    // ============ Global Limit Tests ============

    function test_GlobalLimit_EnforcesLimit() public {
        for (uint256 i = 0; i < 100; i++) {
            assertTrue(globalLimit.consume(), "Should allow within limit");
        }
        assertFalse(globalLimit.consume(), "Should reject at limit");
    }

    function test_GlobalLimit_ResetsAfterWindow() public {
        // Consume all
        for (uint256 i = 0; i < 100; i++) {
            globalLimit.consume();
        }

        vm.warp(block.timestamp + 61);
        assertTrue(globalLimit.consume(), "Should allow after window reset");
    }
}

contract CircuitBreakerTest is Test {
    using CircuitBreaker for CircuitBreaker.Breaker;
    using CircuitBreaker for CircuitBreaker.SlidingWindowBreaker;

    CircuitBreaker.Breaker breaker;

    function setUp() public {
        breaker.init(3, 2, 60, 3); // 3 failures, 2 successes, 60s timeout, 3 half-open requests
    }

    // ============ Basic Circuit Breaker Tests ============

    function test_CircuitBreaker_StartsClose() public view {
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.CLOSED));
    }

    function test_CircuitBreaker_AllowsRequestsWhenClosed() public {
        assertTrue(breaker.allowRequest(), "Should allow requests when closed");
    }

    function test_CircuitBreaker_OpensAfterFailures() public {
        breaker.recordFailure();
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.CLOSED));

        breaker.recordFailure();
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.CLOSED));

        breaker.recordFailure();
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.OPEN));
    }

    function test_CircuitBreaker_RejectsWhenOpen() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        assertFalse(breaker.allowRequest(), "Should reject when open");
    }

    function test_CircuitBreaker_TransitionsToHalfOpen() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        // Wait for timeout
        vm.warp(block.timestamp + 61);

        // Check state transitions to half-open
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.HALF_OPEN));
        assertTrue(breaker.allowRequest(), "Should allow request in half-open");
    }

    function test_CircuitBreaker_ClosesAfterSuccessesInHalfOpen() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        // Wait and transition to half-open
        vm.warp(block.timestamp + 61);
        breaker.allowRequest();

        // Record successes
        breaker.recordSuccess();
        breaker.recordSuccess();

        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.CLOSED));
    }

    function test_CircuitBreaker_ReopensOnFailureInHalfOpen() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        // Wait and transition to half-open
        vm.warp(block.timestamp + 61);
        breaker.allowRequest();

        // Fail in half-open
        breaker.recordFailure();

        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.OPEN));
    }

    function test_CircuitBreaker_LimitsHalfOpenRequests() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        // Wait and transition to half-open
        vm.warp(block.timestamp + 61);

        // First call transitions to half-open (free - doesn't count against limit)
        assertTrue(breaker.allowRequest(), "Transition request should be allowed");

        // Next 3 requests are allowed (halfOpenMaxRequests = 3)
        assertTrue(breaker.allowRequest(), "First half-open request should be allowed");
        assertTrue(breaker.allowRequest(), "Second half-open request should be allowed");
        assertTrue(breaker.allowRequest(), "Third half-open request should be allowed");

        // 5th total (4th counted) should be rejected
        assertFalse(breaker.allowRequest(), "Request after limit should be rejected");
    }

    function test_CircuitBreaker_SuccessResetsFailures() public {
        breaker.recordFailure();
        breaker.recordFailure();
        assertEq(breaker.failures, 2);

        breaker.recordSuccess();
        assertEq(breaker.failures, 0);
    }

    function test_CircuitBreaker_ForceClose() public {
        // Open the circuit
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();

        breaker.forceClose();
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.CLOSED));
    }

    function test_CircuitBreaker_ForceOpen() public {
        breaker.forceOpen(120);
        assertEq(uint256(breaker.getState()), uint256(CircuitBreaker.State.OPEN));
        assertEq(breaker.openUntil, block.timestamp + 120);
    }
}

/**
 * @title Mock contract using DoSProtection
 */
contract MockDoSProtectedContract {
    using RateLimiter for RateLimiter.TokenBucket;
    using RateLimiter for RateLimiter.AdaptiveCooldown;
    using CircuitBreaker for CircuitBreaker.Breaker;

    mapping(address => RateLimiter.TokenBucket) public userLimits;
    mapping(address => RateLimiter.AdaptiveCooldown) public userCooldowns;
    CircuitBreaker.Breaker public serviceBreaker;

    uint256 public actionCount;

    error RateLimited();
    error InCooldown(uint256 remaining);
    error ServiceUnavailable();

    constructor() {
        serviceBreaker.init(5, 3, 300, 5);
    }

    /**
     * @notice Try to perform action - returns false if rate limited (applies cooldown)
     * @dev This allows cooldown to be recorded without reverting
     */
    function tryProtectedAction() external returns (bool success) {
        // Check circuit breaker
        if (!serviceBreaker.allowRequest()) {
            return false;
        }

        // Initialize user limiter if needed
        RateLimiter.TokenBucket storage limit = userLimits[msg.sender];
        if (limit.capacity == 0) {
            limit.init(10, 1);
        }

        RateLimiter.AdaptiveCooldown storage cool = userCooldowns[msg.sender];
        if (cool.baseCooldown == 0) {
            cool.init(30, 300, 600);
        }

        // Check cooldown
        if (cool.isInCooldown()) {
            return false;
        }

        // Check rate limit
        if (!limit.consume(1)) {
            cool.recordViolation();
            return false;
        }

        actionCount++;
        serviceBreaker.recordSuccess();
        return true;
    }

    function protectedAction() external {
        // Check circuit breaker
        if (!serviceBreaker.allowRequest()) {
            revert ServiceUnavailable();
        }

        // Initialize user limiter if needed
        RateLimiter.TokenBucket storage limit = userLimits[msg.sender];
        if (limit.capacity == 0) {
            limit.init(10, 1);
        }

        RateLimiter.AdaptiveCooldown storage cool = userCooldowns[msg.sender];
        if (cool.baseCooldown == 0) {
            cool.init(30, 300, 600);
        }

        // Check cooldown
        if (cool.isInCooldown()) {
            revert InCooldown(cool.cooldownUntil - block.timestamp);
        }

        // Check rate limit - note: if this reverts, cooldown won't be recorded
        // In production, you might want to use tryProtectedAction pattern
        if (!limit.consume(1)) {
            cool.recordViolation();
            revert RateLimited();
        }

        actionCount++;
        serviceBreaker.recordSuccess();
    }

    function triggerServiceFailure() external {
        serviceBreaker.recordFailure();
    }

    function isInCooldown(address user) external view returns (bool, uint256) {
        RateLimiter.AdaptiveCooldown storage cool = userCooldowns[user];
        if (cool.baseCooldown == 0) return (false, 0);
        bool inCooldown = cool.isInCooldown();
        uint256 remaining = inCooldown ? cool.cooldownUntil - block.timestamp : 0;
        return (inCooldown, remaining);
    }
}

contract IntegrationDoSTest is Test {
    MockDoSProtectedContract protected;
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    function setUp() public {
        protected = new MockDoSProtectedContract();
    }

    function test_Integration_AllowsNormalUsage() public {
        vm.startPrank(user1);

        for (uint256 i = 0; i < 10; i++) {
            protected.protectedAction();
        }

        assertEq(protected.actionCount(), 10);
        vm.stopPrank();
    }

    function test_Integration_BlocksExcessiveUsage() public {
        vm.startPrank(user1);

        // Exhaust rate limit
        for (uint256 i = 0; i < 10; i++) {
            protected.protectedAction();
        }

        // 11th should fail
        vm.expectRevert(MockDoSProtectedContract.RateLimited.selector);
        protected.protectedAction();
        vm.stopPrank();
    }

    function test_Integration_AppliesCooldownOnViolation() public {
        vm.startPrank(user1);

        // Exhaust rate limit using try pattern (so cooldown state persists)
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(protected.tryProtectedAction(), "Should succeed within limit");
        }

        // Trigger rate limit violation - this applies cooldown and returns false
        assertFalse(protected.tryProtectedAction(), "Should fail at limit");

        // Now in cooldown (30 seconds base), should fail even after some refill
        // Wait only 5 seconds - still in 30 second cooldown
        vm.warp(block.timestamp + 5);

        // Check cooldown state
        (bool inCooldown, uint256 remaining) = protected.isInCooldown(user1);
        assertTrue(inCooldown, "Should be in cooldown");
        assertEq(remaining, 25, "Should have 25 seconds remaining");

        // Should fail due to cooldown
        assertFalse(protected.tryProtectedAction(), "Should fail due to cooldown");

        vm.stopPrank();
    }

    function test_Integration_IndependentUserLimits() public {
        // User1 exhausts limit
        vm.startPrank(user1);
        for (uint256 i = 0; i < 10; i++) {
            protected.protectedAction();
        }
        vm.expectRevert(MockDoSProtectedContract.RateLimited.selector);
        protected.protectedAction();
        vm.stopPrank();

        // User2 should still work
        vm.startPrank(user2);
        protected.protectedAction();
        assertEq(protected.actionCount(), 11);
        vm.stopPrank();
    }

    function test_Integration_CircuitBreakerTrips() public {
        // Trigger failures
        for (uint256 i = 0; i < 5; i++) {
            protected.triggerServiceFailure();
        }

        // Service should be unavailable
        vm.prank(user1);
        vm.expectRevert(MockDoSProtectedContract.ServiceUnavailable.selector);
        protected.protectedAction();
    }

    function test_Integration_CircuitBreakerRecovers() public {
        // Trip circuit
        for (uint256 i = 0; i < 5; i++) {
            protected.triggerServiceFailure();
        }

        // Wait for timeout
        vm.warp(block.timestamp + 301);

        // Should work again (half-open)
        vm.prank(user1);
        protected.protectedAction();
    }
}
