// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title ICDNTypes
 * @author Jeju Network
 * @notice Shared types for Jeju CDN (Content Delivery Network) contracts
 * @dev Supports decentralized edge nodes, cloud CDN providers, and hybrid configurations
 */
interface ICDNTypes {
    // ============ Enums ============

    /**
     * @notice Type of CDN provider
     */
    enum ProviderType {
        DECENTRALIZED,      // Permissionless node operators
        CLOUDFRONT,         // AWS CloudFront
        CLOUDFLARE,         // Cloudflare CDN
        FASTLY,             // Fastly CDN
        FLEEK,              // Fleek Network (decentralized)
        PIPE,               // Pipe Network (Solana-based)
        AIOZ,               // AIOZ W3IPFS
        IPFS_GATEWAY,       // Direct IPFS gateway
        RESIDENTIAL         // Residential proxy/edge nodes
    }

    /**
     * @notice Geographic region for edge nodes
     */
    enum Region {
        US_EAST_1,
        US_EAST_2,
        US_WEST_1,
        US_WEST_2,
        EU_WEST_1,
        EU_WEST_2,
        EU_CENTRAL_1,
        AP_NORTHEAST_1,
        AP_NORTHEAST_2,
        AP_SOUTHEAST_1,
        AP_SOUTHEAST_2,
        AP_SOUTH_1,
        SA_EAST_1,
        AF_SOUTH_1,
        ME_SOUTH_1,
        GLOBAL              // Anycast/global
    }

    /**
     * @notice Status of an edge node
     */
    enum NodeStatus {
        HEALTHY,
        DEGRADED,
        UNHEALTHY,
        MAINTENANCE,
        OFFLINE
    }

    /**
     * @notice Cache status for requests
     */
    enum CacheStatus {
        HIT,                // Served from edge cache
        MISS,               // Fetched from origin
        STALE,              // Served stale while revalidating
        BYPASS,             // Cache bypassed
        EXPIRED,            // Cache expired, refetched
        REVALIDATED,        // Conditional request, not modified
        DYNAMIC,            // Not cacheable
        ERROR               // Origin error
    }

    // ============ Structs ============

    /**
     * @notice CDN provider registration data
     */
    struct Provider {
        address owner;
        string name;
        string endpoint;
        ProviderType providerType;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId;          // ERC-8004 agent ID
        bool active;
        bool verified;
    }

    /**
     * @notice Provider capabilities
     */
    struct ProviderCapabilities {
        uint256 maxBandwidthMbps;
        uint256 maxStorageGB;
        bool supportsSSL;
        bool supportsHTTP2;
        bool supportsHTTP3;
        bool supportsBrotli;
        bool supportsGzip;
        bool apiCaching;
        bool edgeCompute;
        bool ddosProtection;
    }

    /**
     * @notice Provider pricing structure
     */
    struct ProviderPricing {
        uint256 pricePerGBEgress;         // wei per GB transferred
        uint256 pricePerMillionRequests;  // wei per 1M requests
        uint256 pricePerGBStorage;        // wei per GB cached
        uint256 minimumCommitmentWei;     // Minimum monthly commitment
        uint256 freeEgressGB;             // Free tier
        uint256 freeRequestsM;            // Free tier (millions)
    }

    /**
     * @notice Provider metrics for reputation
     */
    struct ProviderMetrics {
        uint256 totalBytesServed;
        uint256 totalRequests;
        uint256 cacheHitRate;             // 0-10000 (basis points)
        uint256 avgLatencyMs;
        uint256 p99LatencyMs;
        uint256 uptime;                   // 0-10000 (basis points)
        uint256 errorRate;                // 0-10000 (basis points)
        uint256 lastHealthCheck;
    }

    /**
     * @notice Complete provider info
     */
    struct ProviderInfo {
        Provider provider;
        ProviderCapabilities capabilities;
        ProviderPricing pricing;
        ProviderMetrics metrics;
        Region[] regions;
        uint256 healthScore;              // 0-100
        uint256 reputationScore;          // 0-100
    }

    /**
     * @notice Edge node registration
     */
    struct EdgeNode {
        bytes32 nodeId;
        address operator;
        string endpoint;
        Region region;
        ProviderType providerType;
        NodeStatus status;
        uint256 stake;
        uint256 registeredAt;
        uint256 lastSeen;
        uint256 agentId;
    }

    /**
     * @notice Edge node metrics
     */
    struct EdgeNodeMetrics {
        uint256 currentLoad;              // 0-10000 (basis points)
        uint256 bandwidthUsage;           // Mbps
        uint256 activeConnections;
        uint256 requestsPerSecond;
        uint256 bytesServedTotal;
        uint256 requestsTotal;
        uint256 cacheSize;                // bytes
        uint256 cacheEntries;
        uint256 cacheHitRate;             // 0-10000
        uint256 avgResponseTime;          // ms
        uint256 lastUpdated;
    }

    /**
     * @notice CDN site/app configuration
     */
    struct Site {
        bytes32 siteId;
        address owner;
        string domain;
        string origin;                    // Origin URL (IPFS, S3, etc.)
        bytes32 contentHash;              // Current content hash
        uint256 createdAt;
        uint256 updatedAt;
        bool active;
    }

    /**
     * @notice Usage record for billing
     */
    struct UsageRecord {
        bytes32 recordId;
        bytes32 nodeId;
        address provider;
        Region region;
        uint256 timestamp;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 bytesEgress;
        uint256 bytesIngress;
        uint256 requests;
        uint256 cacheHits;
        uint256 cacheMisses;
        bytes signature;                  // Provider signature
    }

    /**
     * @notice Billing record
     */
    struct BillingRecord {
        bytes32 billingId;
        address user;
        address provider;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 egressGB;
        uint256 requestsM;
        uint256 storageGB;
        uint256 egressCost;
        uint256 requestsCost;
        uint256 storageCost;
        uint256 totalCost;
        bool paid;
        uint256 paidAt;
    }

    /**
     * @notice Cache invalidation request
     */
    struct InvalidationRequest {
        bytes32 requestId;
        bytes32 siteId;
        address requestedBy;
        uint256 requestedAt;
        string[] paths;
        Region[] regions;
        bool completed;
        uint256 completedAt;
    }

    // ============ Events ============

    event ProviderRegistered(
        address indexed provider,
        string name,
        ProviderType providerType,
        uint256 stake,
        uint256 agentId
    );

    event ProviderUpdated(address indexed provider);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);

    event EdgeNodeRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        Region region,
        ProviderType providerType,
        uint256 stake
    );

    event EdgeNodeStatusUpdated(
        bytes32 indexed nodeId,
        NodeStatus status
    );

    event EdgeNodeDeactivated(
        bytes32 indexed nodeId,
        address indexed operator,
        string reason
    );

    event SiteCreated(
        bytes32 indexed siteId,
        address indexed owner,
        string domain
    );

    event SiteUpdated(
        bytes32 indexed siteId,
        bytes32 contentHash
    );

    event InvalidationRequested(
        bytes32 indexed requestId,
        bytes32 indexed siteId,
        address requestedBy,
        uint256 pathCount
    );

    event InvalidationCompleted(
        bytes32 indexed requestId,
        uint256 nodesProcessed
    );

    event UsageReported(
        bytes32 indexed nodeId,
        address indexed provider,
        uint256 bytesServed,
        uint256 requests,
        uint256 period
    );

    event BillingSettled(
        bytes32 indexed billingId,
        address indexed user,
        address indexed provider,
        uint256 amount
    );

    event StakeAdded(address indexed provider, uint256 amount);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event StakeSlashed(address indexed provider, uint256 amount, string reason);
}

