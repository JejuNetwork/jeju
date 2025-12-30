// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IDWSTypes
 * @notice Unified types for all Decentralized Web Services
 * @dev Shared across Compute, Storage, CDN, Database, and future services
 */
interface IDWSTypes {
    // ============================================================================
    // Service Types
    // ============================================================================

    enum ServiceType {
        Compute, // Serverless workers (workerd)
        Storage, // IPFS/Arweave storage
        CDN, // Content delivery
        Database, // SQLit databases
        Inference, // AI inference
        Custom // Future services

    }

    enum PaymentStatus {
        Current,
        Overdue,
        Cancelled
    }

    // ============================================================================
    // Provider/Operator (unified across all services)
    // ============================================================================

    struct ProviderInfo {
        address provider;
        ServiceType[] services; // Which services this provider offers
        string endpoint;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        bool active;
        uint256 slashedAmount;
        uint256 rewardsClaimed;
        uint256 agentId; // ERC-8004 agent ID
        bytes32 attestationHash; // TEE attestation
    }

    // ============================================================================
    // Unified Subscription (replaces SQLit RentalInfo, Compute subscriptions, etc.)
    // ============================================================================

    struct Subscription {
        bytes32 id;
        ServiceType serviceType;
        bytes32 resourceId; // Database ID, Worker ID, Storage bucket, etc.
        address subscriber;
        bytes32 planId;
        uint256 startedAt;
        uint256 expiresAt;
        bool autoRenew;
        PaymentStatus paymentStatus;
        uint256 totalPaid;
        address paymentToken;
    }

    // ============================================================================
    // Unified Service Plan (replaces SQLit RentalPlan, Compute tiers, etc.)
    // ============================================================================

    struct ServicePlan {
        bytes32 id;
        string name;
        ServiceType serviceType;
        uint256 pricePerMonth;
        bool active;
        bytes limits; // ABI-encoded service-specific limits
    }

    // ============================================================================
    // Service-Specific Limits (decoded from ServicePlan.limits)
    // ============================================================================

    struct ComputeLimits {
        uint256 memoryMb;
        uint256 cpuMs; // CPU milliseconds per request
        uint256 requestsPerMonth;
        uint256 bandwidthBytes;
    }

    struct StorageLimits {
        uint256 sizeBytes;
        uint256 bandwidthBytes;
        uint8 replicationFactor;
    }

    struct CDNLimits {
        uint256 bandwidthBytes;
        uint256 requestsPerMonth;
        uint8 regions;
    }

    struct DatabaseLimits {
        uint8 nodeCount;
        uint256 storageBytes;
        uint256 queriesPerMonth;
        uint8 consistencyMode; // 0 = Strong, 1 = Eventual
        uint8 encryptionMode; // 0 = None, 1 = AtRest, 2 = InTransit, 3 = Full
    }

    // ============================================================================
    // Resource Assignment (which providers handle which resources)
    // ============================================================================

    struct ResourceAssignment {
        bytes32 resourceId;
        ServiceType serviceType;
        address[] providers;
        address primary; // Primary provider (block producer for DB, primary worker, etc.)
        uint256 assignedAt;
        uint256 lastRotation;
    }

    // ============================================================================
    // Events
    // ============================================================================

    event ProviderRegistered(
        address indexed provider, ServiceType[] services, string endpoint, uint256 stakedAmount, uint256 agentId
    );

    event ProviderSlashed(address indexed provider, uint256 amount, bytes32 reason);

    event SubscriptionCreated(
        bytes32 indexed subscriptionId,
        ServiceType indexed serviceType,
        bytes32 indexed resourceId,
        address subscriber,
        bytes32 planId,
        address paymentToken
    );

    event SubscriptionExtended(bytes32 indexed subscriptionId, uint256 newExpiresAt, uint256 paymentAmount);

    event ResourceCreated(bytes32 indexed resourceId, ServiceType indexed serviceType, address indexed owner);

    event ResourceAssigned(bytes32 indexed resourceId, address[] providers, address primary);

    // ============================================================================
    // Errors
    // ============================================================================

    error NotResourceOwner();
    error ResourceNotFound();
    error InvalidPlan();
    error PlanNotActive();
    error InvalidDuration();
    error InsufficientPayment();
    error SubscriptionNotActive();
    error NotSubscriptionOwner();
    error InsufficientStake();
    error ProviderNotActive();
    error AlreadyRegistered();
    error NotAssigned();
    error ServiceNotSupported();
}
