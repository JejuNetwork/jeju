// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

/**
 * @title IStorageTypes
 * @notice Shared types for Jeju Storage Marketplace contracts
 */
interface IStorageTypes {
    // ============ Enums ============

    enum ProviderType {
        IPFS_NODE, // Self-hosted IPFS node
        FILECOIN, // Filecoin storage deal
        ARWEAVE, // Permanent Arweave storage
        CLOUD_S3, // S3-compatible cloud storage
        CLOUD_VERCEL, // Vercel Blob storage
        CLOUD_R2, // Cloudflare R2
        HYBRID // Multi-backend provider

    }

    enum StorageTier {
        HOT, // Fast access, higher cost
        WARM, // Balanced access and cost
        COLD, // Slow access, archival pricing
        PERMANENT // Permanent storage (Arweave)

    }

    enum DealStatus {
        PENDING, // Deal created, awaiting confirmation
        ACTIVE, // Deal active, data stored
        EXPIRED, // Deal expired
        TERMINATED, // Early termination
        FAILED, // Storage failure
        DISPUTED // Under dispute

    }

    // ============ Structs ============

    struct Provider {
        address owner;
        string name;
        string endpoint;
        ProviderType providerType;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId;
        bool active;
        bool verified;
    }

    struct ProviderCapacity {
        uint256 totalCapacityGB;
        uint256 usedCapacityGB;
        uint256 availableCapacityGB;
        uint256 reservedCapacityGB;
    }

    struct ProviderPricing {
        uint256 pricePerGBMonth;
        uint256 minStoragePeriodDays;
        uint256 maxStoragePeriodDays;
        uint256 retrievalPricePerGB;
        uint256 uploadPricePerGB;
    }

    struct StorageProviderInfo {
        Provider provider;
        ProviderCapacity capacity;
        ProviderPricing pricing;
        StorageTier[] supportedTiers;
        uint256 replicationFactor;
        string ipfsGateway;
        uint256 healthScore;
        uint256 avgLatencyMs;
    }

    /// @notice Storage deal (struct optimized for gas efficiency)
    /// @dev Fields packed to minimize storage slots:
    ///      Slot 1: dealId (32)
    ///      Slot 2: user (20) + status (1) + tier (1) = 22 bytes
    ///      Slot 3: provider (20)
    struct StorageDeal {
        bytes32 dealId;
        address user;
        DealStatus status;    // Packed with user (saves 1 slot)
        StorageTier tier;     // Packed with user (saves 1 slot)
        address provider;
        string cid;
        uint256 sizeBytes;
        uint256 startTime;
        uint256 endTime;
        uint256 totalCost;
        uint256 paidAmount;
        uint256 refundedAmount;
        uint256 replicationFactor;
        uint256 retrievalCount;
    }

    /// @notice Storage quote (struct optimized for gas efficiency)
    /// @dev Slot 1: provider (20) + tier (1) = 21 bytes packed
    struct StorageQuote {
        address provider;
        StorageTier tier;     // Packed with provider
        uint256 sizeBytes;
        uint256 durationDays;
        uint256 cost;
        CostBreakdown costBreakdown;
        uint256 expiresAt;
    }

    struct CostBreakdown {
        uint256 storageCost;
        uint256 bandwidth;
        uint256 retrieval;
    }

    struct Ledger {
        uint256 totalBalance;
        uint256 availableBalance;
        uint256 lockedBalance;
        uint256 createdAt;
    }

    struct SubAccount {
        uint256 balance;
        uint256 pendingRefund;
        uint256 refundUnlockTime;
        bool acknowledged;
    }

    struct UserRecord {
        uint256 totalDeals;
        uint256 activeDeals;
        uint256 completedDeals;
        uint256 disputedDeals;
        uint256 totalStoredGB;
        uint256 totalSpent;
        bool banned;
    }

    struct ProviderRecord {
        uint256 totalDeals;
        uint256 activeDeals;
        uint256 completedDeals;
        uint256 failedDeals;
        uint256 totalStoredGB;
        uint256 totalEarnings;
        uint256 avgRating;
        uint256 ratingCount;
        uint256 uptimePercent;
        bool banned;
    }
}
