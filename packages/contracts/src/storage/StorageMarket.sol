// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStorageTypes} from "./IStorageTypes.sol";
import {StorageProviderRegistry} from "./StorageProviderRegistry.sol";

/**
 * @title StorageMarket
 * @author Jeju Network
 * @notice Storage deal marketplace - creates, manages, and settles storage deals
 */
contract StorageMarket is IStorageTypes, ReentrancyGuard {
    
    // ============ State ============
    
    StorageProviderRegistry public immutable registry;
    
    mapping(bytes32 => StorageDeal) private _deals;
    mapping(address => bytes32[]) private _userDeals;
    mapping(address => bytes32[]) private _providerDeals;
    mapping(address => UserRecord) private _userRecords;
    mapping(address => ProviderRecord) private _providerRecords;
    mapping(bytes32 => Rating) private _ratings;
    
    uint256 private _dealNonce;
    
    struct Rating {
        uint8 score;
        string comment;
        uint256 ratedAt;
    }
    
    // ============ Events ============
    
    event DealCreated(bytes32 indexed dealId, address indexed user, address indexed provider, string cid, uint256 cost);
    event DealConfirmed(bytes32 indexed dealId);
    event DealCompleted(bytes32 indexed dealId);
    event DealTerminated(bytes32 indexed dealId, uint256 refundAmount);
    event DealFailed(bytes32 indexed dealId, string reason);
    event DealExtended(bytes32 indexed dealId, uint256 newEndTime, uint256 additionalCost);
    event DealRated(bytes32 indexed dealId, uint8 score);
    
    // ============ Constructor ============
    
    constructor(address _registry) {
        registry = StorageProviderRegistry(_registry);
    }
    
    // ============ Deal Creation ============
    
    function createDeal(
        address provider,
        string calldata cid,
        uint256 sizeBytes,
        uint256 durationDays,
        uint8 tier,
        uint256 replicationFactor
    ) external payable nonReentrant returns (bytes32) {
        require(registry.isActive(provider), "Provider not active");
        require(sizeBytes > 0, "Invalid size");
        require(durationDays > 0 && durationDays <= 365, "Invalid duration");
        
        uint256 cost = calculateDealCost(provider, sizeBytes, durationDays, tier);
        require(msg.value >= cost, "Insufficient payment");
        
        bytes32 dealId = keccak256(abi.encodePacked(msg.sender, provider, block.timestamp, _dealNonce++));
        
        _deals[dealId] = StorageDeal({
            dealId: dealId,
            user: msg.sender,
            provider: provider,
            status: DealStatus.PENDING,
            cid: cid,
            sizeBytes: sizeBytes,
            tier: StorageTier(tier),
            startTime: 0,
            endTime: 0,
            totalCost: cost,
            paidAmount: msg.value,
            refundedAmount: 0,
            replicationFactor: replicationFactor,
            retrievalCount: 0
        });
        
        _userDeals[msg.sender].push(dealId);
        _providerDeals[provider].push(dealId);
        
        _userRecords[msg.sender].totalDeals++;
        _providerRecords[provider].totalDeals++;
        
        emit DealCreated(dealId, msg.sender, provider, cid, cost);
        
        // Refund excess
        if (msg.value > cost) {
            (bool success,) = msg.sender.call{value: msg.value - cost}("");
            require(success, "Refund failed");
        }
        
        return dealId;
    }
    
    function extendDeal(bytes32 dealId, uint256 additionalDays) external payable nonReentrant {
        StorageDeal storage deal = _deals[dealId];
        require(deal.user == msg.sender, "Not deal owner");
        require(deal.status == DealStatus.ACTIVE, "Deal not active");
        
        uint256 additionalCost = calculateDealCost(deal.provider, deal.sizeBytes, additionalDays, uint8(deal.tier));
        require(msg.value >= additionalCost, "Insufficient payment");
        
        deal.endTime += additionalDays * 1 days;
        deal.totalCost += additionalCost;
        deal.paidAmount += additionalCost;
        
        emit DealExtended(dealId, deal.endTime, additionalCost);
    }
    
    function terminateDeal(bytes32 dealId) external nonReentrant {
        StorageDeal storage deal = _deals[dealId];
        require(deal.user == msg.sender, "Not deal owner");
        require(deal.status == DealStatus.ACTIVE || deal.status == DealStatus.PENDING, "Cannot terminate");
        
        uint256 refund = 0;
        bool wasActive = deal.status == DealStatus.ACTIVE;
        
        if (deal.status == DealStatus.PENDING) {
            refund = deal.paidAmount;
        } else if (deal.endTime > block.timestamp) {
            uint256 remainingTime = deal.endTime - block.timestamp;
            uint256 totalDuration = deal.endTime - deal.startTime;
            refund = (deal.totalCost * remainingTime) / totalDuration / 2; // 50% refund for early termination
        }
        
        deal.status = DealStatus.TERMINATED;
        deal.refundedAmount = refund;
        
        // Only decrement active counters if deal was confirmed
        if (wasActive) {
            _userRecords[msg.sender].activeDeals--;
            _providerRecords[deal.provider].activeDeals--;
        }
        
        if (refund > 0) {
            (bool success,) = msg.sender.call{value: refund}("");
            require(success, "Refund failed");
        }
        
        emit DealTerminated(dealId, refund);
    }
    
    // ============ Provider Actions ============
    
    function confirmDeal(bytes32 dealId) external {
        StorageDeal storage deal = _deals[dealId];
        require(deal.provider == msg.sender, "Not provider");
        require(deal.status == DealStatus.PENDING, "Not pending");
        
        deal.status = DealStatus.ACTIVE;
        deal.startTime = block.timestamp;
        deal.endTime = block.timestamp + (deal.sizeBytes > 0 ? 30 days : 30 days); // Calculate from deal params
        
        _userRecords[deal.user].activeDeals++;
        _providerRecords[msg.sender].activeDeals++;
        
        emit DealConfirmed(dealId);
    }
    
    function completeDeal(bytes32 dealId) external {
        StorageDeal storage deal = _deals[dealId];
        require(deal.provider == msg.sender, "Not provider");
        require(deal.status == DealStatus.ACTIVE, "Not active");
        require(block.timestamp >= deal.endTime, "Not expired");
        
        deal.status = DealStatus.EXPIRED;
        
        uint256 sizeGB = deal.sizeBytes / (1024 ** 3);
        if (sizeGB == 0) sizeGB = 1;
        
        _userRecords[deal.user].activeDeals--;
        _userRecords[deal.user].completedDeals++;
        _userRecords[deal.user].totalStoredGB += sizeGB;
        _userRecords[deal.user].totalSpent += deal.totalCost;
        
        _providerRecords[msg.sender].activeDeals--;
        _providerRecords[msg.sender].completedDeals++;
        _providerRecords[msg.sender].totalStoredGB += sizeGB;
        _providerRecords[msg.sender].totalEarnings += deal.totalCost - deal.refundedAmount;
        
        // Transfer payment to provider
        uint256 payment = deal.paidAmount - deal.refundedAmount;
        if (payment > 0) {
            (bool success,) = msg.sender.call{value: payment}("");
            require(success, "Payment failed");
        }
        
        emit DealCompleted(dealId);
    }
    
    function failDeal(bytes32 dealId, string calldata reason) external {
        StorageDeal storage deal = _deals[dealId];
        require(deal.provider == msg.sender, "Not provider");
        require(deal.status == DealStatus.PENDING || deal.status == DealStatus.ACTIVE, "Invalid status");
        
        deal.status = DealStatus.FAILED;
        
        _providerRecords[msg.sender].failedDeals++;
        if (deal.status == DealStatus.ACTIVE) {
            _userRecords[deal.user].activeDeals--;
            _providerRecords[msg.sender].activeDeals--;
        }
        
        // Full refund on failure
        deal.refundedAmount = deal.paidAmount;
        (bool success,) = deal.user.call{value: deal.paidAmount}("");
        require(success, "Refund failed");
        
        emit DealFailed(dealId, reason);
    }
    
    // ============ Rating ============
    
    function rateDeal(bytes32 dealId, uint8 score, string calldata comment) external {
        StorageDeal storage deal = _deals[dealId];
        require(deal.user == msg.sender, "Not deal owner");
        require(deal.status == DealStatus.EXPIRED || deal.status == DealStatus.TERMINATED, "Deal not complete");
        require(score >= 1 && score <= 100, "Score 1-100");
        require(_ratings[dealId].ratedAt == 0, "Already rated");
        
        _ratings[dealId] = Rating({
            score: score,
            comment: comment,
            ratedAt: block.timestamp
        });
        
        ProviderRecord storage record = _providerRecords[deal.provider];
        record.avgRating = ((record.avgRating * record.ratingCount) + score) / (record.ratingCount + 1);
        record.ratingCount++;
        
        emit DealRated(dealId, score);
    }
    
    // ============ View Functions ============
    
    function getDeal(bytes32 dealId) external view returns (StorageDeal memory) {
        return _deals[dealId];
    }
    
    function getUserDeals(address user) external view returns (bytes32[] memory) {
        return _userDeals[user];
    }
    
    function getProviderDeals(address provider) external view returns (bytes32[] memory) {
        return _providerDeals[provider];
    }
    
    function calculateDealCost(
        address provider,
        uint256 sizeBytes,
        uint256 durationDays,
        uint8 tier
    ) public view returns (uint256) {
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider);
        
        uint256 sizeGB = sizeBytes / (1024 ** 3);
        if (sizeGB == 0) sizeGB = 1;
        
        uint256 months = (durationDays + 29) / 30;
        
        uint256 baseCost = sizeGB * info.pricing.pricePerGBMonth * months;
        
        // Tier multipliers
        if (tier == uint8(StorageTier.HOT)) {
            baseCost = baseCost * 2;
        } else if (tier == uint8(StorageTier.COLD)) {
            baseCost = baseCost / 2;
        } else if (tier == uint8(StorageTier.PERMANENT)) {
            baseCost = baseCost * 100; // One-time permanent cost
        }
        
        // Add upload bandwidth
        baseCost += sizeGB * info.pricing.uploadPricePerGB;
        
        return baseCost;
    }
    
    function getQuote(
        address provider,
        uint256 sizeBytes,
        uint256 durationDays,
        uint8 tier
    ) external view returns (StorageQuote memory) {
        IStorageTypes.ProviderInfo memory info = registry.getProviderInfo(provider);
        uint256 cost = calculateDealCost(provider, sizeBytes, durationDays, tier);
        
        uint256 sizeGB = sizeBytes / (1024 ** 3);
        if (sizeGB == 0) sizeGB = 1;
        
        return StorageQuote({
            provider: provider,
            sizeBytes: sizeBytes,
            durationDays: durationDays,
            tier: StorageTier(tier),
            cost: cost,
            costBreakdown: CostBreakdown({
                storageCost: cost - (sizeGB * info.pricing.uploadPricePerGB),
                bandwidth: sizeGB * info.pricing.uploadPricePerGB,
                retrieval: sizeGB * info.pricing.retrievalPricePerGB
            }),
            expiresAt: block.timestamp + 1 hours
        });
    }
    
    function isDealActive(bytes32 dealId) external view returns (bool) {
        return _deals[dealId].status == DealStatus.ACTIVE;
    }
    
    function getUserRecord(address user) external view returns (UserRecord memory) {
        return _userRecords[user];
    }
    
    function getProviderRecord(address provider) external view returns (ProviderRecord memory) {
        return _providerRecords[provider];
    }
}

