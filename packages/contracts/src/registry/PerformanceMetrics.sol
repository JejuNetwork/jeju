// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title PerformanceMetrics
 * @notice Library for provider performance tracking and scoring
 */
library PerformanceMetrics {
    uint256 constant BPS = 10000;

    struct Metrics {
        uint256 uptimeScore;
        uint256 successRate;
        uint256 avgLatencyMs;
        uint256 requestsServed;
        uint256 bytesServed;
        uint256 lastUpdated;
        uint256 totalUptime;
        uint256 downtimeEvents;
    }

    struct AggregatedScore {
        uint256 overall;
        uint256 reliability;
        uint256 performance;
        uint256 timestamp;
    }

    struct ScoreWeights {
        uint16 uptime;
        uint16 success;
        uint16 latency;
        uint16 throughput;
    }

    function defaultWeights() internal pure returns (ScoreWeights memory) {
        return ScoreWeights(3000, 3000, 2000, 2000);
    }

    function update(
        Metrics storage self,
        uint256 uptimeScore,
        uint256 successRate,
        uint256 avgLatencyMs,
        uint256 requestsDelta,
        uint256 bytesDelta
    ) internal {
        self.uptimeScore = uptimeScore;
        self.successRate = successRate;
        self.avgLatencyMs = avgLatencyMs;
        self.requestsServed += requestsDelta;
        self.bytesServed += bytesDelta;
        self.lastUpdated = block.timestamp;
    }

    function recordUptime(Metrics storage self, uint256 duration) internal {
        self.totalUptime += duration;
        self.lastUpdated = block.timestamp;
    }

    function recordDowntime(Metrics storage self) internal {
        self.downtimeEvents++;
        self.lastUpdated = block.timestamp;
    }

    function calculateScore(
        Metrics storage self,
        ScoreWeights memory w,
        uint256 targetLatencyMs,
        uint256 targetThroughput
    ) internal view returns (AggregatedScore memory) {
        uint256 latencyScore = targetLatencyMs == 0 || self.avgLatencyMs <= targetLatencyMs
            ? BPS
            : (targetLatencyMs * BPS) / self.avgLatencyMs;

        uint256 throughputScore = targetThroughput == 0 || self.requestsServed >= targetThroughput
            ? BPS
            : (self.requestsServed * BPS) / targetThroughput;

        return AggregatedScore({
            overall: (self.uptimeScore * w.uptime + self.successRate * w.success + 
                     latencyScore * w.latency + throughputScore * w.throughput) / BPS,
            reliability: (self.uptimeScore + self.successRate) / 2,
            performance: (latencyScore + throughputScore) / 2,
            timestamp: block.timestamp
        });
    }

    function isHealthy(Metrics storage self, uint256 minUptime, uint256 minSuccess) internal view returns (bool) {
        return self.uptimeScore >= minUptime && self.successRate >= minSuccess;
    }

    function isStale(Metrics storage self, uint256 maxAge) internal view returns (bool) {
        return block.timestamp > self.lastUpdated + maxAge;
    }

    function age(Metrics storage self) internal view returns (uint256) {
        return self.lastUpdated == 0 ? type(uint256).max : block.timestamp - self.lastUpdated;
    }
}
