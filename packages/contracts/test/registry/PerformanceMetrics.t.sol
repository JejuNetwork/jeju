// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {PerformanceMetrics} from "../../src/registry/PerformanceMetrics.sol";

contract PerformanceMetricsHarness {
    using PerformanceMetrics for PerformanceMetrics.Metrics;

    PerformanceMetrics.Metrics public metrics;

    function update(uint256 uptime, uint256 success, uint256 latency, uint256 requests, uint256 bytes_) external {
        metrics.update(uptime, success, latency, requests, bytes_);
    }

    function recordUptime(uint256 duration) external {
        metrics.recordUptime(duration);
    }

    function recordDowntime() external {
        metrics.recordDowntime();
    }

    function calculateScore(
        PerformanceMetrics.ScoreWeights memory weights,
        uint256 targetLatency,
        uint256 targetThroughput
    ) external view returns (PerformanceMetrics.AggregatedScore memory) {
        return metrics.calculateScore(weights, targetLatency, targetThroughput);
    }

    function isHealthy(uint256 minUptime, uint256 minSuccess) external view returns (bool) {
        return metrics.isHealthy(minUptime, minSuccess);
    }

    function isStale(uint256 maxAge) external view returns (bool) {
        return metrics.isStale(maxAge);
    }

    function age() external view returns (uint256) {
        return metrics.age();
    }

    function getMetrics() external view returns (PerformanceMetrics.Metrics memory) {
        return metrics;
    }
}

contract PerformanceMetricsTest is Test {
    PerformanceMetricsHarness harness;

    function setUp() public {
        harness = new PerformanceMetricsHarness();
    }

    function test_Update_SetsAllFields() public {
        harness.update(9500, 9800, 50, 1000, 1_000_000);

        PerformanceMetrics.Metrics memory m = harness.getMetrics();
        assertEq(m.uptimeScore, 9500);
        assertEq(m.successRate, 9800);
        assertEq(m.avgLatencyMs, 50);
        assertEq(m.requestsServed, 1000);
        assertEq(m.bytesServed, 1_000_000);
        assertEq(m.lastUpdated, block.timestamp);
    }

    function test_Update_AccumulatesRequestsAndBytes() public {
        harness.update(9000, 9000, 100, 500, 500_000);
        harness.update(9500, 9500, 80, 300, 300_000);

        PerformanceMetrics.Metrics memory m = harness.getMetrics();
        assertEq(m.requestsServed, 800);
        assertEq(m.bytesServed, 800_000);
        assertEq(m.uptimeScore, 9500); // Latest value
        assertEq(m.avgLatencyMs, 80); // Latest value
    }

    function test_RecordUptime_AccumulatesDuration() public {
        harness.recordUptime(3600);
        harness.recordUptime(7200);

        PerformanceMetrics.Metrics memory m = harness.getMetrics();
        assertEq(m.totalUptime, 10800);
    }

    function test_RecordDowntime_IncrementsCounter() public {
        harness.recordDowntime();
        harness.recordDowntime();
        harness.recordDowntime();

        PerformanceMetrics.Metrics memory m = harness.getMetrics();
        assertEq(m.downtimeEvents, 3);
    }

    function test_CalculateScore_PerfectScores() public {
        harness.update(10000, 10000, 50, 10000, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 100, 5000);

        assertEq(score.overall, 10000); // Perfect score
        assertEq(score.reliability, 10000);
        assertEq(score.performance, 10000);
    }

    function test_CalculateScore_ZeroLatencyTarget() public {
        harness.update(8000, 8000, 100, 5000, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 0, 5000);

        // Zero target = perfect latency score
        assertGt(score.overall, 0);
    }

    function test_CalculateScore_ZeroThroughputTarget() public {
        harness.update(8000, 8000, 100, 0, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 100, 0);

        // Zero target = perfect throughput score
        assertGt(score.overall, 0);
    }

    function test_CalculateScore_HighLatency_LowScore() public {
        harness.update(10000, 10000, 1000, 10000, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 100, 5000);

        // High latency (1000ms vs 100ms target) should reduce score
        assertLt(score.overall, 10000);
        assertLt(score.performance, 10000);
    }

    function test_CalculateScore_LowThroughput_LowScore() public {
        harness.update(10000, 10000, 50, 100, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 100, 10000);

        // Low throughput (100 vs 10000 target) should reduce score
        assertLt(score.overall, 10000);
    }

    function test_CalculateScore_CustomWeights() public {
        harness.update(10000, 0, 50, 10000, 0); // Perfect uptime, zero success

        // Weight heavily towards uptime
        PerformanceMetrics.ScoreWeights memory weights =
            PerformanceMetrics.ScoreWeights({uptime: 8000, success: 0, latency: 1000, throughput: 1000});

        PerformanceMetrics.AggregatedScore memory score = harness.calculateScore(weights, 100, 5000);
        assertGt(score.overall, 8000); // Uptime dominates
    }

    function test_IsHealthy_AboveThresholds() public {
        harness.update(9000, 9500, 100, 0, 0);
        assertTrue(harness.isHealthy(8000, 9000));
    }

    function test_IsHealthy_BelowUptimeThreshold() public {
        harness.update(7000, 9500, 100, 0, 0);
        assertFalse(harness.isHealthy(8000, 9000));
    }

    function test_IsHealthy_BelowSuccessThreshold() public {
        harness.update(9000, 8000, 100, 0, 0);
        assertFalse(harness.isHealthy(8000, 9000));
    }

    function test_IsHealthy_ExactlyAtThresholds() public {
        harness.update(8000, 9000, 100, 0, 0);
        assertTrue(harness.isHealthy(8000, 9000));
    }

    function test_IsStale_WithinMaxAge() public {
        harness.update(9000, 9000, 100, 0, 0);
        assertFalse(harness.isStale(3600));
    }

    function test_IsStale_BeyondMaxAge() public {
        harness.update(9000, 9000, 100, 0, 0);
        vm.warp(block.timestamp + 7200);
        assertTrue(harness.isStale(3600));
    }

    function test_IsStale_ExactlyAtMaxAge() public {
        harness.update(9000, 9000, 100, 0, 0);
        vm.warp(block.timestamp + 3600);
        assertFalse(harness.isStale(3600)); // Not stale at exactly max age
    }

    function test_Age_NeverUpdated() public view {
        assertEq(harness.age(), type(uint256).max);
    }

    function test_Age_JustUpdated() public {
        harness.update(9000, 9000, 100, 0, 0);
        assertEq(harness.age(), 0);
    }

    function test_Age_AfterTime() public {
        harness.update(9000, 9000, 100, 0, 0);
        vm.warp(block.timestamp + 1000);
        assertEq(harness.age(), 1000);
    }

    function test_DefaultWeights_SumTo10000() public pure {
        PerformanceMetrics.ScoreWeights memory w = PerformanceMetrics.defaultWeights();
        assertEq(uint256(w.uptime) + w.success + w.latency + w.throughput, 10000);
    }

    function testFuzz_Update_NeverOverflows(
        uint256 uptime,
        uint256 success,
        uint256 latency,
        uint256 requests,
        uint256 bytes_
    ) public {
        // Bound to reasonable values
        uptime = bound(uptime, 0, 10000);
        success = bound(success, 0, 10000);
        latency = bound(latency, 0, type(uint128).max);
        requests = bound(requests, 0, type(uint128).max);
        bytes_ = bound(bytes_, 0, type(uint128).max);

        harness.update(uptime, success, latency, requests, bytes_);
        PerformanceMetrics.Metrics memory m = harness.getMetrics();
        assertEq(m.uptimeScore, uptime);
    }

    function testFuzz_CalculateScore_NeverReverts(
        uint256 uptime,
        uint256 success,
        uint256 latency,
        uint256 requests,
        uint256 targetLatency,
        uint256 targetThroughput
    ) public {
        uptime = bound(uptime, 0, 10000);
        success = bound(success, 0, 10000);
        latency = bound(latency, 1, type(uint128).max); // At least 1 to avoid edge cases
        requests = bound(requests, 0, type(uint128).max);

        harness.update(uptime, success, latency, requests, 0);

        PerformanceMetrics.ScoreWeights memory weights = PerformanceMetrics.defaultWeights();
        PerformanceMetrics.AggregatedScore memory score =
            harness.calculateScore(weights, targetLatency, targetThroughput);

        assertLe(score.overall, 10000);
        assertLe(score.reliability, 10000);
        assertLe(score.performance, 10000);
    }
}
