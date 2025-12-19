// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PerformanceMetrics
 * @notice Library for standardized provider performance tracking
 */
library PerformanceMetrics {
    uint256 constant BPS = 10000;

    struct Metrics {
        uint256 uptimeScore;      // 0-10000 (100.00%)
        uint256 successRate;      // 0-10000 (100.00%)
        uint256 avgLatencyMs;     // Average response time in ms
        uint256 requestsServed;   // Total requests handled
        uint256 bytesServed;      // Total bytes served
        uint256 lastUpdated;      // Timestamp of last update
        uint256 totalUptime;      // Cumulative uptime in seconds
        uint256 downtimeEvents;   // Number of downtime incidents
    }

    struct AggregatedScore {
        uint256 overallScore;     // Weighted combination 0-10000
        uint256 reliabilityScore; // Based on uptime + success rate
        uint256 performanceScore; // Based on latency + throughput
        uint256 timestamp;
    }

    struct ScoreWeights {
        uint16 uptimeWeight;      // Weight for uptime (default 3000 = 30%)
        uint16 successWeight;     // Weight for success rate (default 3000 = 30%)
        uint16 latencyWeight;     // Weight for latency (default 2000 = 20%)
        uint16 throughputWeight;  // Weight for throughput (default 2000 = 20%)
    }

    function defaultWeights() internal pure returns (ScoreWeights memory) {
        return ScoreWeights({
            uptimeWeight: 3000,
            successWeight: 3000,
            latencyWeight: 2000,
            throughputWeight: 2000
        });
    }

    function updateMetrics(
        Metrics storage self,
        uint256 newUptimeScore,
        uint256 newSuccessRate,
        uint256 newAvgLatencyMs,
        uint256 requestsDelta,
        uint256 bytesDelta
    ) internal {
        self.uptimeScore = newUptimeScore;
        self.successRate = newSuccessRate;
        self.avgLatencyMs = newAvgLatencyMs;
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
        ScoreWeights memory weights,
        uint256 targetLatencyMs,
        uint256 targetThroughput
    ) internal view returns (AggregatedScore memory) {
        uint256 uptimeComponent = (self.uptimeScore * weights.uptimeWeight) / BPS;
        uint256 successComponent = (self.successRate * weights.successWeight) / BPS;
        
        uint256 latencyScore = self.avgLatencyMs <= targetLatencyMs 
            ? BPS 
            : (targetLatencyMs * BPS) / self.avgLatencyMs;
        uint256 latencyComponent = (latencyScore * weights.latencyWeight) / BPS;
        
        uint256 throughputScore = self.requestsServed >= targetThroughput 
            ? BPS 
            : (self.requestsServed * BPS) / targetThroughput;
        uint256 throughputComponent = (throughputScore * weights.throughputWeight) / BPS;
        
        uint256 reliabilityScore = (self.uptimeScore + self.successRate) / 2;
        uint256 performanceScore = (latencyScore + throughputScore) / 2;
        
        return AggregatedScore({
            overallScore: uptimeComponent + successComponent + latencyComponent + throughputComponent,
            reliabilityScore: reliabilityScore,
            performanceScore: performanceScore,
            timestamp: block.timestamp
        });
    }

    function isHealthy(Metrics storage self, uint256 minUptimeScore, uint256 minSuccessRate) internal view returns (bool) {
        return self.uptimeScore >= minUptimeScore && self.successRate >= minSuccessRate;
    }

    function isStale(Metrics storage self, uint256 maxAge) internal view returns (bool) {
        return block.timestamp > self.lastUpdated + maxAge;
    }

    function getAge(Metrics storage self) internal view returns (uint256) {
        if (self.lastUpdated == 0) return type(uint256).max;
        return block.timestamp - self.lastUpdated;
    }
}
