// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Router Registry
/// @author Jeju Network
/// @notice Registry for routers enabling external protocol discovery
/// @dev Enables aggregators like 1inch, Paraswap to discover and route through XLP
contract RouterRegistry is Ownable, ReentrancyGuard {

    // ============ Structs ============

    struct RouterInfo {
        address router;
        string name;
        string version;
        uint256[] supportedChainIds;
        address[] supportedTokens;
        bool isActive;
        uint256 registeredAt;
        uint256 totalVolume;
        uint256 totalTrades;
        uint256 feeShareBps;      // Fee share for referrers (basis points)
        address feeRecipient;
    }

    struct ChainRouter {
        address router;
        address aggregator;       // LiquidityAggregator on this chain
        address inputSettler;     // OIF InputSettler
        address outputSettler;    // OIF OutputSettler
        bool isActive;
    }

    // ============ State Variables ============

    /// @notice All registered routers
    address[] public routers;
    mapping(address => RouterInfo) public routerInfo;
    mapping(address => bool) public isRegisteredRouter;

    /// @notice Routers per chain
    mapping(uint256 => ChainRouter) public chainRouters;

    /// @notice Supported chains
    uint256[] public supportedChains;
    mapping(uint256 => bool) public isSupportedChain;

    /// @notice Approved aggregator contracts that can call routers
    mapping(address => bool) public approvedAggregators;

    /// @notice Router fee tiers (volume-based discounts)
    mapping(address => uint256) public routerTier;
    uint256[] public tierThresholds;      // Volume thresholds for each tier
    uint256[] public tierFeeDiscounts;    // Fee discount bps for each tier

    /// @notice Referral tracking
    mapping(address => address) public referrer;
    mapping(address => uint256) public referralEarnings;

    // ============ Events ============

    event RouterRegistered(
        address indexed router,
        string name,
        uint256[] chains
    );

    event RouterUpdated(
        address indexed router,
        bool isActive
    );

    event ChainRouterSet(
        uint256 indexed chainId,
        address router,
        address aggregator,
        address inputSettler,
        address outputSettler
    );

    event AggregatorApproved(address indexed aggregator, bool approved);

    event ReferralSet(address indexed user, address indexed referrer);

    event VolumeRecorded(address indexed router, uint256 volume);

    // ============ Errors ============

    error RouterAlreadyRegistered();
    error RouterNotRegistered();
    error ChainNotSupported();
    error InvalidRouter();
    error NotAuthorized();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        // Initialize default tier thresholds (in USD value scaled by 1e18)
        tierThresholds.push(0);                    // Tier 0: 0+
        tierThresholds.push(100_000 * 1e18);       // Tier 1: 100k+
        tierThresholds.push(1_000_000 * 1e18);     // Tier 2: 1M+
        tierThresholds.push(10_000_000 * 1e18);    // Tier 3: 10M+

        // Fee discounts in basis points
        tierFeeDiscounts.push(0);      // Tier 0: 0% discount
        tierFeeDiscounts.push(500);    // Tier 1: 5% discount
        tierFeeDiscounts.push(1000);   // Tier 2: 10% discount
        tierFeeDiscounts.push(2000);   // Tier 3: 20% discount
    }

    // ============ Router Registration ============

    /// @notice Register a new router
    /// @param router Router address
    /// @param name Human-readable name
    /// @param routerVersion Version string (e.g., "1.0.0")
    /// @param chainIds Supported chain IDs
    /// @param tokens Supported tokens
    /// @param feeRecipient Address to receive fees
    function registerRouter(
        address router,
        string calldata name,
        string calldata routerVersion,
        uint256[] calldata chainIds,
        address[] calldata tokens,
        address feeRecipient
    ) external onlyOwner {
        if (router == address(0)) revert InvalidRouter();
        if (isRegisteredRouter[router]) revert RouterAlreadyRegistered();

        routers.push(router);
        isRegisteredRouter[router] = true;

        routerInfo[router] = RouterInfo({
            router: router,
            name: name,
            version: routerVersion,
            supportedChainIds: chainIds,
            supportedTokens: tokens,
            isActive: true,
            registeredAt: block.timestamp,
            totalVolume: 0,
            totalTrades: 0,
            feeShareBps: 500, // Default 5% fee share
            feeRecipient: feeRecipient
        });

        // Add supported chains
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (!isSupportedChain[chainIds[i]]) {
                supportedChains.push(chainIds[i]);
                isSupportedChain[chainIds[i]] = true;
            }
        }

        emit RouterRegistered(router, name, chainIds);
    }

    /// @notice Update router status
    /// @param router Router address
    /// @param isActive Whether router is active
    function setRouterActive(address router, bool isActive) external onlyOwner {
        if (!isRegisteredRouter[router]) revert RouterNotRegistered();
        routerInfo[router].isActive = isActive;
        emit RouterUpdated(router, isActive);
    }

    /// @notice Set chain-specific router configuration
    /// @param chainId Chain ID
    /// @param router Main router address
    /// @param aggregator Liquidity aggregator address
    /// @param inputSettler OIF input settler address
    /// @param outputSettler OIF output settler address
    function setChainRouter(
        uint256 chainId,
        address router,
        address aggregator,
        address inputSettler,
        address outputSettler
    ) external onlyOwner {
        chainRouters[chainId] = ChainRouter({
            router: router,
            aggregator: aggregator,
            inputSettler: inputSettler,
            outputSettler: outputSettler,
            isActive: true
        });

        if (!isSupportedChain[chainId]) {
            supportedChains.push(chainId);
            isSupportedChain[chainId] = true;
        }

        emit ChainRouterSet(chainId, router, aggregator, inputSettler, outputSettler);
    }

    /// @notice Approve an aggregator to call routers
    /// @param aggregator Aggregator address
    /// @param approved Whether approved
    function setAggregatorApproval(address aggregator, bool approved) external onlyOwner {
        approvedAggregators[aggregator] = approved;
        emit AggregatorApproved(aggregator, approved);
    }

    // ============ Volume Tracking ============

    /// @notice Record trade volume for a router
    /// @param router Router that executed the trade
    /// @param volumeUsd Volume in USD (scaled by 1e18)
    function recordVolume(address router, uint256 volumeUsd) external {
        if (!approvedAggregators[msg.sender]) revert NotAuthorized();
        if (!isRegisteredRouter[router]) revert RouterNotRegistered();

        routerInfo[router].totalVolume += volumeUsd;
        routerInfo[router].totalTrades++;

        // Update tier if threshold crossed
        _updateRouterTier(router);

        emit VolumeRecorded(router, volumeUsd);
    }

    function _updateRouterTier(address router) internal {
        uint256 volume = routerInfo[router].totalVolume;
        uint256 newTier = 0;

        for (uint256 i = tierThresholds.length; i > 0; i--) {
            if (volume >= tierThresholds[i - 1]) {
                newTier = i - 1;
                break;
            }
        }

        routerTier[router] = newTier;
    }

    // ============ Referral System ============

    /// @notice Set referrer for a user
    /// @param user User address
    /// @param ref Referrer address
    function setReferrer(address user, address ref) external {
        if (referrer[user] != address(0)) return; // Already set
        if (ref == user) return; // Can't self-refer
        
        referrer[user] = ref;
        emit ReferralSet(user, ref);
    }

    /// @notice Record referral earnings
    /// @param ref Referrer address
    /// @param amount Earnings amount
    function recordReferralEarnings(address ref, uint256 amount) external {
        if (!approvedAggregators[msg.sender]) revert NotAuthorized();
        referralEarnings[ref] += amount;
    }

    // ============ View Functions ============

    /// @notice Get all routers
    function getAllRouters() external view returns (address[] memory) {
        return routers;
    }

    /// @notice Get active routers
    function getActiveRouters() external view returns (address[] memory activeRouters) {
        uint256 count = 0;
        for (uint256 i = 0; i < routers.length; i++) {
            if (routerInfo[routers[i]].isActive) count++;
        }

        activeRouters = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < routers.length; i++) {
            if (routerInfo[routers[i]].isActive) {
                activeRouters[idx++] = routers[i];
            }
        }
    }

    /// @notice Get routers for a specific chain
    /// @param chainId Chain ID
    function getRoutersForChain(uint256 chainId) external view returns (address[] memory chainRoutersList) {
        if (!isSupportedChain[chainId]) return new address[](0);

        uint256 count = 0;
        for (uint256 i = 0; i < routers.length; i++) {
            RouterInfo storage info = routerInfo[routers[i]];
            if (!info.isActive) continue;
            
            for (uint256 j = 0; j < info.supportedChainIds.length; j++) {
                if (info.supportedChainIds[j] == chainId) {
                    count++;
                    break;
                }
            }
        }

        chainRoutersList = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < routers.length; i++) {
            RouterInfo storage info = routerInfo[routers[i]];
            if (!info.isActive) continue;
            
            for (uint256 j = 0; j < info.supportedChainIds.length; j++) {
                if (info.supportedChainIds[j] == chainId) {
                    chainRoutersList[idx++] = routers[i];
                    break;
                }
            }
        }
    }

    /// @notice Get router info
    /// @param router Router address
    function getRouter(address router) external view returns (RouterInfo memory) {
        return routerInfo[router];
    }

    /// @notice Get chain router config
    /// @param chainId Chain ID
    function getChainRouter(uint256 chainId) external view returns (ChainRouter memory) {
        return chainRouters[chainId];
    }

    /// @notice Get supported chains
    function getSupportedChains() external view returns (uint256[] memory) {
        return supportedChains;
    }

    /// @notice Get fee discount for a router
    /// @param router Router address
    /// @return discountBps Discount in basis points
    function getRouterFeeDiscount(address router) external view returns (uint256 discountBps) {
        uint256 tier = routerTier[router];
        if (tier < tierFeeDiscounts.length) {
            return tierFeeDiscounts[tier];
        }
        return 0;
    }

    /// @notice Check if route is available
    /// @param sourceChain Source chain ID
    /// @param destChain Destination chain ID
    function isRouteAvailable(uint256 sourceChain, uint256 destChain) external view returns (bool) {
        return isSupportedChain[sourceChain] && 
               isSupportedChain[destChain] &&
               chainRouters[sourceChain].isActive &&
               chainRouters[destChain].isActive;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
