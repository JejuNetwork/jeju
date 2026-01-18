// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {IDWSTypes} from "./IDWSTypes.sol";

/**
 * @title DWSMarketplace
 * @notice Unified marketplace for DWS service offerings
 * @dev Enables providers to list services for consumption with pricing, SLAs, and discovery
 *
 * Supports marketplace categories:
 * - Oracle: Price feeds, VRF, Keepers, cross-chain data
 * - Indexer: Subgraph hosting, real-time indexing
 * - Compute: Serverless functions, containers
 * - Storage: IPFS pinning, backup, CDN
 * - Database: SQLit, Postgres-as-a-service
 * - DA: Data availability services
 */
contract DWSMarketplace is IDWSTypes, Ownable, Pausable, ReentrancyGuard {
    using ERC8004ProviderMixin for ERC8004ProviderMixin.Data;
    using ModerationMixin for ModerationMixin.Data;

    // ============================================================================
    // Types
    // ============================================================================

    enum ListingCategory {
        Oracle,
        Indexer,
        Compute,
        Storage,
        Database,
        DataAvailability,
        Auth,
        Messaging
    }

    enum PricingModel {
        PayPerRequest,      // Per API call
        PayPerSecond,       // Compute time
        PayPerByte,         // Storage/transfer
        Subscription,       // Monthly flat rate
        Stake               // Stake-weighted access
    }

    struct ServiceListing {
        uint256 listingId;
        address provider;
        uint256 agentId;            // ERC-8004 agent (optional)
        ListingCategory category;
        string name;
        string description;
        string endpoint;
        string specCid;             // IPFS CID for full spec/docs
        PricingModel pricingModel;
        uint256 priceWei;           // Price per unit
        uint256 minStakeToUse;      // Minimum stake for access (for stake-gated)
        uint256 slaUptimePercent;   // SLA uptime commitment (9900 = 99%)
        uint256 slaResponseMs;      // Max response time commitment
        bool active;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 totalRevenue;
        uint256 totalRequests;
        uint256 avgRating;          // 0-500 (50.0 = 5 stars)
        uint256 ratingCount;
    }

    struct OracleSpec {
        string[] supportedNetworks;     // ["ethereum", "jeju", "base"]
        string[] dataFeeds;             // ["ETH/USD", "BTC/USD"]
        bool supportsVRF;
        bool supportsKeeper;
        uint256 updateFrequencyMs;
        uint256 deviationThreshold;     // Basis points
    }

    struct IndexerSpec {
        string[] supportedNetworks;
        bool supportsSubgraph;
        bool supportsRealtimeSync;
        uint256 maxBlockLag;
        uint256 storageCapacityGb;
    }

    struct MarketplaceSubscription {
        uint256 subscriptionId;
        address subscriber;
        uint256 listingId;
        uint256 startTime;
        uint256 endTime;
        uint256 paidAmount;
        bool active;
    }

    struct Review {
        address reviewer;
        uint256 listingId;
        uint256 rating;     // 0-50 (5.0 = max)
        string comment;
        uint256 timestamp;
    }

    // ============================================================================
    // State
    // ============================================================================

    ERC8004ProviderMixin.Data public erc8004;
    ModerationMixin.Data public moderation;

    // Listings
    mapping(uint256 => ServiceListing) public listings;
    uint256 public nextListingId = 1;

    // Category indexes
    mapping(ListingCategory => uint256[]) public listingsByCategory;
    mapping(address => uint256[]) public listingsByProvider;

    // Oracle specs (for Oracle category)
    mapping(uint256 => OracleSpec) public oracleSpecs;

    // Indexer specs (for Indexer category)
    mapping(uint256 => IndexerSpec) public indexerSpecs;

    // Subscriptions
    mapping(uint256 => MarketplaceSubscription) public subscriptions;
    uint256 public nextSubscriptionId = 1;
    mapping(address => uint256[]) public subscriberSubscriptions;
    mapping(uint256 => uint256[]) public listingSubscriptions;

    // Reviews
    mapping(uint256 => Review[]) public listingReviews;
    mapping(address => mapping(uint256 => bool)) public hasReviewed;

    // Usage tracking
    mapping(address => mapping(uint256 => uint256)) public userRequests; // user -> listing -> count
    mapping(address => mapping(uint256 => uint256)) public userSpending; // user -> listing -> wei

    // Platform fee (basis points, 250 = 2.5%)
    uint256 public platformFeeBps = 250;
    address public treasury;

    // Minimum stake to list
    uint256 public minProviderStake = 1000 ether;

    // ============================================================================
    // Events
    // ============================================================================

    event ListingCreated(
        uint256 indexed listingId,
        address indexed provider,
        ListingCategory category,
        string name,
        uint256 priceWei
    );

    event ListingUpdated(uint256 indexed listingId, string endpoint, uint256 priceWei);
    event ListingDeactivated(uint256 indexed listingId);

    event SubscriptionCreated(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        uint256 indexed listingId,
        uint256 endTime,
        uint256 paidAmount
    );

    event ServiceUsed(
        address indexed user,
        uint256 indexed listingId,
        uint256 amount,
        uint256 requestCount
    );

    event ReviewSubmitted(
        uint256 indexed listingId,
        address indexed reviewer,
        uint256 rating
    );

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        address _treasury
    ) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            erc8004.setIdentityRegistry(_identityRegistry);
            moderation.setIdentityRegistry(_identityRegistry);
        }
        if (_banManager != address(0)) {
            moderation.setBanManager(_banManager);
        }
        treasury = _treasury;
    }

    // ============================================================================
    // Listing Management
    // ============================================================================

    /**
     * @notice Create a new service listing
     */
    function createListing(
        ListingCategory category,
        string calldata name,
        string calldata description,
        string calldata endpoint,
        string calldata specCid,
        PricingModel pricingModel,
        uint256 priceWei,
        uint256 minStakeToUse,
        uint256 slaUptimePercent,
        uint256 slaResponseMs
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value >= minProviderStake, "Insufficient stake");
        moderation.requireNotBanned(msg.sender);

        uint256 listingId = nextListingId++;

        listings[listingId] = ServiceListing({
            listingId: listingId,
            provider: msg.sender,
            agentId: 0,
            category: category,
            name: name,
            description: description,
            endpoint: endpoint,
            specCid: specCid,
            pricingModel: pricingModel,
            priceWei: priceWei,
            minStakeToUse: minStakeToUse,
            slaUptimePercent: slaUptimePercent,
            slaResponseMs: slaResponseMs,
            active: true,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            totalRevenue: 0,
            totalRequests: 0,
            avgRating: 0,
            ratingCount: 0
        });

        listingsByCategory[category].push(listingId);
        listingsByProvider[msg.sender].push(listingId);

        emit ListingCreated(listingId, msg.sender, category, name, priceWei);

        return listingId;
    }

    /**
     * @notice Create listing with ERC-8004 agent
     */
    function createListingWithAgent(
        uint256 agentId,
        ListingCategory category,
        string calldata name,
        string calldata description,
        string calldata endpoint,
        string calldata specCid,
        PricingModel pricingModel,
        uint256 priceWei,
        uint256 minStakeToUse,
        uint256 slaUptimePercent,
        uint256 slaResponseMs
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value >= minProviderStake, "Insufficient stake");
        erc8004.verifyAndLinkAgent(msg.sender, agentId);
        moderation.requireProviderNotBanned(msg.sender, agentId);

        uint256 listingId = nextListingId++;

        listings[listingId] = ServiceListing({
            listingId: listingId,
            provider: msg.sender,
            agentId: agentId,
            category: category,
            name: name,
            description: description,
            endpoint: endpoint,
            specCid: specCid,
            pricingModel: pricingModel,
            priceWei: priceWei,
            minStakeToUse: minStakeToUse,
            slaUptimePercent: slaUptimePercent,
            slaResponseMs: slaResponseMs,
            active: true,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            totalRevenue: 0,
            totalRequests: 0,
            avgRating: 0,
            ratingCount: 0
        });

        listingsByCategory[category].push(listingId);
        listingsByProvider[msg.sender].push(listingId);

        emit ListingCreated(listingId, msg.sender, category, name, priceWei);

        return listingId;
    }

    /**
     * @notice Set Oracle-specific specifications
     */
    function setOracleSpec(
        uint256 listingId,
        string[] calldata supportedNetworks,
        string[] calldata dataFeeds,
        bool supportsVRF,
        bool supportsKeeper,
        uint256 updateFrequencyMs,
        uint256 deviationThreshold
    ) external {
        require(listings[listingId].provider == msg.sender, "Not owner");
        require(listings[listingId].category == ListingCategory.Oracle, "Not oracle");

        oracleSpecs[listingId] = OracleSpec({
            supportedNetworks: supportedNetworks,
            dataFeeds: dataFeeds,
            supportsVRF: supportsVRF,
            supportsKeeper: supportsKeeper,
            updateFrequencyMs: updateFrequencyMs,
            deviationThreshold: deviationThreshold
        });
    }

    /**
     * @notice Set Indexer-specific specifications
     */
    function setIndexerSpec(
        uint256 listingId,
        string[] calldata supportedNetworks,
        bool supportsSubgraph,
        bool supportsRealtimeSync,
        uint256 maxBlockLag,
        uint256 storageCapacityGb
    ) external {
        require(listings[listingId].provider == msg.sender, "Not owner");
        require(listings[listingId].category == ListingCategory.Indexer, "Not indexer");

        indexerSpecs[listingId] = IndexerSpec({
            supportedNetworks: supportedNetworks,
            supportsSubgraph: supportsSubgraph,
            supportsRealtimeSync: supportsRealtimeSync,
            maxBlockLag: maxBlockLag,
            storageCapacityGb: storageCapacityGb
        });
    }

    /**
     * @notice Update listing details
     */
    function updateListing(
        uint256 listingId,
        string calldata endpoint,
        uint256 priceWei,
        uint256 slaUptimePercent,
        uint256 slaResponseMs
    ) external {
        require(listings[listingId].provider == msg.sender, "Not owner");

        listings[listingId].endpoint = endpoint;
        listings[listingId].priceWei = priceWei;
        listings[listingId].slaUptimePercent = slaUptimePercent;
        listings[listingId].slaResponseMs = slaResponseMs;
        listings[listingId].updatedAt = block.timestamp;

        emit ListingUpdated(listingId, endpoint, priceWei);
    }

    /**
     * @notice Deactivate listing
     */
    function deactivateListing(uint256 listingId) external {
        require(listings[listingId].provider == msg.sender, "Not owner");
        listings[listingId].active = false;
        emit ListingDeactivated(listingId);
    }

    // ============================================================================
    // Subscription & Payment
    // ============================================================================

    /**
     * @notice Subscribe to a service
     */
    function subscribe(uint256 listingId, uint256 durationDays)
        external
        payable
        nonReentrant
        returns (uint256)
    {
        ServiceListing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.pricingModel == PricingModel.Subscription, "Not subscription");

        uint256 cost = listing.priceWei * durationDays;
        require(msg.value >= cost, "Insufficient payment");

        uint256 subscriptionId = nextSubscriptionId++;
        uint256 endTime = block.timestamp + (durationDays * 1 days);

        subscriptions[subscriptionId] = MarketplaceSubscription({
            subscriptionId: subscriptionId,
            subscriber: msg.sender,
            listingId: listingId,
            startTime: block.timestamp,
            endTime: endTime,
            paidAmount: msg.value,
            active: true
        });

        subscriberSubscriptions[msg.sender].push(subscriptionId);
        listingSubscriptions[listingId].push(subscriptionId);

        // Distribute payment
        _distributePayment(listing.provider, msg.value);
        listing.totalRevenue += msg.value;

        emit SubscriptionCreated(subscriptionId, msg.sender, listingId, endTime, msg.value);

        return subscriptionId;
    }

    /**
     * @notice Pay for service usage (pay-per-request, pay-per-byte, etc.)
     */
    function payForUsage(uint256 listingId, uint256 units)
        external
        payable
        nonReentrant
    {
        ServiceListing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(
            listing.pricingModel != PricingModel.Subscription,
            "Use subscribe"
        );

        uint256 cost = listing.priceWei * units;
        require(msg.value >= cost, "Insufficient payment");

        // Track usage
        userRequests[msg.sender][listingId] += units;
        userSpending[msg.sender][listingId] += msg.value;
        listing.totalRequests += units;
        listing.totalRevenue += msg.value;

        // Distribute payment
        _distributePayment(listing.provider, msg.value);

        emit ServiceUsed(msg.sender, listingId, msg.value, units);
    }

    function _distributePayment(address provider, uint256 amount) internal {
        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 providerAmount = amount - fee;

        if (fee > 0) {
            (bool feeSuccess,) = payable(treasury).call{value: fee}("");
            require(feeSuccess, "Fee transfer failed");
        }

        (bool success,) = payable(provider).call{value: providerAmount}("");
        require(success, "Provider transfer failed");
    }

    // ============================================================================
    // Reviews
    // ============================================================================

    /**
     * @notice Submit a review for a listing
     */
    function submitReview(
        uint256 listingId,
        uint256 rating,
        string calldata comment
    ) external {
        require(listings[listingId].active, "Listing not active");
        require(rating <= 50, "Rating too high"); // 0-50 = 0.0-5.0 stars
        require(!hasReviewed[msg.sender][listingId], "Already reviewed");
        require(
            userSpending[msg.sender][listingId] > 0 ||
            _hasActiveSubscription(msg.sender, listingId),
            "Must be a user"
        );

        listingReviews[listingId].push(Review({
            reviewer: msg.sender,
            listingId: listingId,
            rating: rating,
            comment: comment,
            timestamp: block.timestamp
        }));

        hasReviewed[msg.sender][listingId] = true;

        // Update average rating
        ServiceListing storage listing = listings[listingId];
        listing.avgRating = (
            (listing.avgRating * listing.ratingCount) + rating
        ) / (listing.ratingCount + 1);
        listing.ratingCount++;

        emit ReviewSubmitted(listingId, msg.sender, rating);
    }

    function _hasActiveSubscription(address user, uint256 listingId)
        internal
        view
        returns (bool)
    {
        uint256[] storage subs = subscriberSubscriptions[user];
        for (uint256 i = 0; i < subs.length; i++) {
            MarketplaceSubscription storage sub = subscriptions[subs[i]];
            if (
                sub.listingId == listingId &&
                sub.active &&
                sub.endTime > block.timestamp
            ) {
                return true;
            }
        }
        return false;
    }

    // ============================================================================
    // Views
    // ============================================================================

    function getListing(uint256 listingId)
        external
        view
        returns (ServiceListing memory)
    {
        return listings[listingId];
    }

    function getListingsByCategory(ListingCategory category)
        external
        view
        returns (uint256[] memory)
    {
        return listingsByCategory[category];
    }

    function getActiveListingsByCategory(ListingCategory category)
        external
        view
        returns (ServiceListing[] memory)
    {
        uint256[] storage ids = listingsByCategory[category];
        uint256 count = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) count++;
        }

        ServiceListing[] memory active = new ServiceListing[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) {
                active[j++] = listings[ids[i]];
            }
        }

        return active;
    }

    function getOracleSpec(uint256 listingId)
        external
        view
        returns (OracleSpec memory)
    {
        return oracleSpecs[listingId];
    }

    function getIndexerSpec(uint256 listingId)
        external
        view
        returns (IndexerSpec memory)
    {
        return indexerSpecs[listingId];
    }

    function getListingReviews(uint256 listingId)
        external
        view
        returns (Review[] memory)
    {
        return listingReviews[listingId];
    }

    function getSubscription(uint256 subscriptionId)
        external
        view
        returns (MarketplaceSubscription memory)
    {
        return subscriptions[subscriptionId];
    }

    function getUserSubscriptions(address user)
        external
        view
        returns (MarketplaceSubscription[] memory)
    {
        uint256[] storage ids = subscriberSubscriptions[user];
        MarketplaceSubscription[] memory subs = new MarketplaceSubscription[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            subs[i] = subscriptions[ids[i]];
        }
        return subs;
    }

    function isSubscriptionActive(uint256 subscriptionId)
        external
        view
        returns (bool)
    {
        MarketplaceSubscription storage sub = subscriptions[subscriptionId];
        return sub.active && sub.endTime > block.timestamp;
    }

    // ============================================================================
    // Admin
    // ============================================================================

    function setPlatformFee(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Fee too high"); // Max 10%
        platformFeeBps = bps;
    }

    function setMinProviderStake(uint256 stake) external onlyOwner {
        minProviderStake = stake;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
