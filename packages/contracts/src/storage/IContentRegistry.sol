// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

/**
 * @title IContentRegistry
 * @notice Interface for decentralized content registry with moderation and seeding rewards
 */
interface IContentRegistry {
    // ============ Enums ============

    enum ContentStatus {
        UNKNOWN, // Not registered
        APPROVED, // Safe content
        FLAGGED, // Under review
        BANNED // Permanently banned

    }

    enum ViolationType {
        NONE,
        CSAM,
        ILLEGAL_MATERIAL,
        COPYRIGHT,
        SPAM
    }

    enum ContentTier {
        NETWORK_FREE, // Protocol assets, free to serve
        COMMUNITY, // Subsidized community content
        STANDARD, // Normal paid storage
        PRIVATE_ENCRYPTED, // Encrypted data
        PREMIUM_HOT // High-demand content

    }

    // ============ Structs ============

    struct ContentRecord {
        bytes32 contentHash;
        ContentStatus status;
        ViolationType violationType;
        ContentTier tier;
        address uploader;
        uint64 uploadedAt;
        uint64 size;
        uint64 seedCount;
        uint128 rewardPool;
    }

    struct SeederStats {
        uint128 totalBytesServed;
        uint128 pendingRewards;
        uint64 activeTorrents;
        uint64 lastReportTime;
    }

    // ============ Events ============

    event ContentRegistered(
        bytes32 indexed contentHash, bytes32 indexed infohash, address indexed uploader, ContentTier tier, uint64 size
    );

    event ContentFlagged(bytes32 indexed contentHash, ViolationType violationType, address reporter);

    event ContentBanned(bytes32 indexed contentHash, ViolationType violationType);
    event ContentCleared(bytes32 indexed contentHash);

    event SeedingStarted(bytes32 indexed infohash, address indexed seeder);
    event SeedingStopped(bytes32 indexed infohash, address indexed seeder);
    event SeedingReported(bytes32 indexed infohash, address indexed seeder, uint128 bytesServed);
    event RewardsClaimed(address indexed seeder, uint128 amount);

    // ============ Content Functions ============

    function registerContent(bytes32 contentHash, bytes32 infohash, uint64 size, ContentTier tier)
        external
        payable
        returns (ContentStatus);

    function flagContent(bytes32 contentHash, ViolationType violationType, bytes32 evidenceHash)
        external
        returns (bytes32 caseId);

    function banContent(bytes32 contentHash) external;
    function clearContent(bytes32 contentHash) external;

    function canServe(bytes32 contentHash) external view returns (bool);
    function getContent(bytes32 contentHash) external view returns (ContentRecord memory);
    function isBlocked(bytes32 contentHash) external view returns (bool);

    // ============ Seeding Functions ============

    function startSeeding(bytes32 infohash) external;
    function stopSeeding(bytes32 infohash) external;
    function reportSeeding(bytes32 infohash, uint128 bytesServed, bytes calldata signature) external;
    function claimRewards() external;

    function getSeederStats(address seeder) external view returns (SeederStats memory);
    function getRewardRate(ContentTier tier) external view returns (uint128);

    // ============ Blocklist Functions ============

    function getBlocklistLength() external view returns (uint256);
    function getBlocklistBatch(uint256 offset, uint256 limit) external view returns (bytes32[] memory);
}
