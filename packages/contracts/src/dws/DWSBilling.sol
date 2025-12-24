// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDWSTypes} from "./IDWSTypes.sol";

interface ICreditManager {
    function deductCredit(address user, address token, uint256 amount) external;
    function tryDeductCredit(address user, address token, uint256 amount) external returns (bool success, uint256 remaining);
    function hasSufficientCredit(address user, address token, uint256 amount) external view returns (bool sufficient, uint256 available);
}

interface IServiceRegistry {
    function recordUsage(address user, string calldata serviceName, uint256 cost) external;
}

interface IDWSProviderRegistry {
    function getAssignment(bytes32 resourceId) external view returns (IDWSTypes.ResourceAssignment memory);
}

/**
 * @title DWSBilling
 * @notice Unified billing for ALL DWS services (Compute, Storage, CDN, Database)
 * @dev Single billing contract handles subscriptions across all service types
 */
contract DWSBilling is IDWSTypes, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // State
    // ============================================================================

    ICreditManager public creditManager;
    IServiceRegistry public serviceRegistry;
    IDWSProviderRegistry public providerRegistry;

    // Supported payment tokens
    mapping(address => bool) public acceptedTokens;
    address[] public tokenList;
    address public defaultToken;

    // Plans (shared across all service types)
    mapping(bytes32 => ServicePlan) public plans;
    bytes32[] public planIds;

    // Subscriptions (unified for all services)
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(bytes32 => bytes32) public resourceToSubscription;  // resourceId -> subscriptionId
    mapping(address => bytes32[]) public userSubscriptions;

    // Revenue tracking
    mapping(address => mapping(address => uint256)) public providerRevenue;  // provider -> token -> amount
    mapping(address => uint256) public protocolRevenue;                       // token -> amount

    // Configuration
    uint256 public protocolFeeBps = 500;  // 5%
    address public treasury;

    // Service name prefixes for ServiceRegistry
    mapping(ServiceType => string) public serviceNames;

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _creditManager,
        address _serviceRegistry,
        address _providerRegistry,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_creditManager != address(0)) {
            creditManager = ICreditManager(_creditManager);
        }
        if (_serviceRegistry != address(0)) {
            serviceRegistry = IServiceRegistry(_serviceRegistry);
        }
        if (_providerRegistry != address(0)) {
            providerRegistry = IDWSProviderRegistry(_providerRegistry);
        }
        treasury = _treasury;

        // Initialize service names
        serviceNames[ServiceType.Compute] = "dws-compute";
        serviceNames[ServiceType.Storage] = "dws-storage";
        serviceNames[ServiceType.CDN] = "dws-cdn";
        serviceNames[ServiceType.Database] = "dws-database";
        serviceNames[ServiceType.Inference] = "dws-inference";
    }

    // ============================================================================
    // Plan Management
    // ============================================================================

    /**
     * @notice Create a new service plan (works for ANY service type)
     */
    function createPlan(
        string calldata name,
        ServiceType serviceType,
        uint256 pricePerMonth,
        bytes calldata limits
    ) external onlyOwner returns (bytes32 planId) {
        planId = keccak256(abi.encodePacked(name, serviceType, block.timestamp));

        plans[planId] = ServicePlan({
            id: planId,
            name: name,
            serviceType: serviceType,
            pricePerMonth: pricePerMonth,
            active: true,
            limits: limits
        });

        planIds.push(planId);
    }

    /**
     * @notice Create compute plan with typed limits
     */
    function createComputePlan(
        string calldata name,
        uint256 pricePerMonth,
        ComputeLimits calldata limits
    ) external onlyOwner returns (bytes32 planId) {
        bytes memory encodedLimits = abi.encode(limits);
        planId = keccak256(abi.encodePacked(name, ServiceType.Compute, block.timestamp));

        plans[planId] = ServicePlan({
            id: planId,
            name: name,
            serviceType: ServiceType.Compute,
            pricePerMonth: pricePerMonth,
            active: true,
            limits: encodedLimits
        });

        planIds.push(planId);
    }

    /**
     * @notice Create database plan with typed limits
     */
    function createDatabasePlan(
        string calldata name,
        uint256 pricePerMonth,
        DatabaseLimits calldata limits
    ) external onlyOwner returns (bytes32 planId) {
        bytes memory encodedLimits = abi.encode(limits);
        planId = keccak256(abi.encodePacked(name, ServiceType.Database, block.timestamp));

        plans[planId] = ServicePlan({
            id: planId,
            name: name,
            serviceType: ServiceType.Database,
            pricePerMonth: pricePerMonth,
            active: true,
            limits: encodedLimits
        });

        planIds.push(planId);
    }

    function updatePlanPrice(bytes32 planId, uint256 newPrice) external onlyOwner {
        if (plans[planId].id == bytes32(0)) revert InvalidPlan();
        plans[planId].pricePerMonth = newPrice;
    }

    function deactivatePlan(bytes32 planId) external onlyOwner {
        plans[planId].active = false;
    }

    // ============================================================================
    // Subscription Management (unified for ALL services)
    // ============================================================================

    /**
     * @notice Create a subscription for ANY DWS service
     * @param planId The plan to subscribe to
     * @param resourceId The resource ID (worker ID, database ID, storage bucket, etc.)
     * @param months Number of months
     * @param autoRenew Enable auto-renewal
     * @param paymentToken Token to pay with
     */
    function createSubscription(
        bytes32 planId,
        bytes32 resourceId,
        uint256 months,
        bool autoRenew,
        address paymentToken
    ) external nonReentrant whenNotPaused returns (bytes32 subscriptionId) {
        ServicePlan storage plan = plans[planId];
        if (!plan.active) revert PlanNotActive();
        if (months < 1 || months > 12) revert InvalidDuration();
        if (!acceptedTokens[paymentToken]) revert InsufficientPayment();

        uint256 totalPayment = plan.pricePerMonth * months;

        // Deduct from CreditManager
        if (address(creditManager) == address(0)) revert InsufficientPayment();
        (bool sufficient,) = creditManager.hasSufficientCredit(msg.sender, paymentToken, totalPayment);
        if (!sufficient) revert InsufficientPayment();

        creditManager.deductCredit(msg.sender, paymentToken, totalPayment);

        // Create subscription
        subscriptionId = keccak256(abi.encodePacked(msg.sender, resourceId, block.timestamp));

        subscriptions[subscriptionId] = Subscription({
            id: subscriptionId,
            serviceType: plan.serviceType,
            resourceId: resourceId,
            subscriber: msg.sender,
            planId: planId,
            startedAt: block.timestamp,
            expiresAt: block.timestamp + (months * 30 days),
            autoRenew: autoRenew,
            paymentStatus: PaymentStatus.Current,
            totalPaid: totalPayment,
            paymentToken: paymentToken
        });

        resourceToSubscription[resourceId] = subscriptionId;
        userSubscriptions[msg.sender].push(subscriptionId);

        // Distribute payment
        _distributePayment(resourceId, totalPayment, paymentToken);

        // Record in ServiceRegistry
        if (address(serviceRegistry) != address(0)) {
            serviceRegistry.recordUsage(msg.sender, serviceNames[plan.serviceType], totalPayment);
        }

        emit SubscriptionCreated(subscriptionId, plan.serviceType, resourceId, msg.sender, planId, paymentToken);
    }

    /**
     * @notice Extend any subscription
     */
    function extendSubscription(bytes32 subscriptionId, uint256 months) external nonReentrant whenNotPaused {
        if (months < 1 || months > 12) revert InvalidDuration();

        Subscription storage sub = subscriptions[subscriptionId];
        if (sub.subscriber != msg.sender) revert NotSubscriptionOwner();

        ServicePlan storage plan = plans[sub.planId];
        uint256 payment = plan.pricePerMonth * months;

        // Deduct from CreditManager
        if (address(creditManager) == address(0)) revert InsufficientPayment();
        creditManager.deductCredit(msg.sender, sub.paymentToken, payment);

        // Extend expiry
        if (sub.expiresAt < block.timestamp) {
            sub.expiresAt = block.timestamp + (months * 30 days);
        } else {
            sub.expiresAt += months * 30 days;
        }

        sub.paymentStatus = PaymentStatus.Current;
        sub.totalPaid += payment;

        // Distribute payment
        _distributePayment(sub.resourceId, payment, sub.paymentToken);

        // Record in ServiceRegistry
        if (address(serviceRegistry) != address(0)) {
            serviceRegistry.recordUsage(msg.sender, serviceNames[plan.serviceType], payment);
        }

        emit SubscriptionExtended(subscriptionId, sub.expiresAt, payment);
    }

    /**
     * @notice Cancel a subscription
     */
    function cancelSubscription(bytes32 subscriptionId) external {
        Subscription storage sub = subscriptions[subscriptionId];
        if (sub.subscriber != msg.sender) revert NotSubscriptionOwner();

        sub.paymentStatus = PaymentStatus.Cancelled;
        sub.autoRenew = false;
    }

    /**
     * @notice Process auto-renewal
     */
    function processAutoRenewal(bytes32 subscriptionId) external nonReentrant whenNotPaused {
        Subscription storage sub = subscriptions[subscriptionId];
        if (!sub.autoRenew) revert SubscriptionNotActive();
        if (sub.paymentStatus == PaymentStatus.Cancelled) revert SubscriptionNotActive();
        require(sub.expiresAt <= block.timestamp + 7 days, "Too early");

        ServicePlan storage plan = plans[sub.planId];

        bool success = false;
        if (address(creditManager) != address(0)) {
            (success,) = creditManager.tryDeductCredit(sub.subscriber, sub.paymentToken, plan.pricePerMonth);
        }

        if (success) {
            sub.expiresAt += 30 days;
            sub.paymentStatus = PaymentStatus.Current;
            sub.totalPaid += plan.pricePerMonth;
            _distributePayment(sub.resourceId, plan.pricePerMonth, sub.paymentToken);

            if (address(serviceRegistry) != address(0)) {
                serviceRegistry.recordUsage(sub.subscriber, serviceNames[plan.serviceType], plan.pricePerMonth);
            }

            emit SubscriptionExtended(subscriptionId, sub.expiresAt, plan.pricePerMonth);
        } else {
            sub.paymentStatus = PaymentStatus.Overdue;
        }
    }

    // ============================================================================
    // Views
    // ============================================================================

    function getSubscription(bytes32 subscriptionId) external view returns (Subscription memory) {
        return subscriptions[subscriptionId];
    }

    function getPlan(bytes32 planId) external view returns (ServicePlan memory) {
        return plans[planId];
    }

    function getSubscriptionByResource(bytes32 resourceId) external view returns (Subscription memory) {
        return subscriptions[resourceToSubscription[resourceId]];
    }

    function getUserSubscriptions(address user) external view returns (bytes32[] memory) {
        return userSubscriptions[user];
    }

    function isSubscriptionActive(bytes32 subscriptionId) external view returns (bool) {
        Subscription storage sub = subscriptions[subscriptionId];
        return sub.paymentStatus == PaymentStatus.Current && sub.expiresAt > block.timestamp;
    }

    function getPlansByServiceType(ServiceType serviceType) external view returns (ServicePlan[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < planIds.length; i++) {
            if (plans[planIds[i]].serviceType == serviceType && plans[planIds[i]].active) {
                count++;
            }
        }

        ServicePlan[] memory result = new ServicePlan[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < planIds.length; i++) {
            if (plans[planIds[i]].serviceType == serviceType && plans[planIds[i]].active) {
                result[j++] = plans[planIds[i]];
            }
        }
        return result;
    }

    /**
     * @notice Decode compute limits from a plan
     */
    function getComputeLimits(bytes32 planId) external view returns (ComputeLimits memory) {
        ServicePlan storage plan = plans[planId];
        require(plan.serviceType == ServiceType.Compute, "Not a compute plan");
        return abi.decode(plan.limits, (ComputeLimits));
    }

    /**
     * @notice Decode database limits from a plan
     */
    function getDatabaseLimits(bytes32 planId) external view returns (DatabaseLimits memory) {
        ServicePlan storage plan = plans[planId];
        require(plan.serviceType == ServiceType.Database, "Not a database plan");
        return abi.decode(plan.limits, (DatabaseLimits));
    }

    // ============================================================================
    // Revenue Management
    // ============================================================================

    function claimProviderRevenue(address token) external nonReentrant {
        uint256 amount = providerRevenue[msg.sender][token];
        require(amount > 0, "No revenue");

        providerRevenue[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function withdrawProtocolRevenue(address token) external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue[token];
        require(amount > 0, "No revenue");

        protocolRevenue[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);
    }

    // ============================================================================
    // Internal
    // ============================================================================

    function _distributePayment(bytes32 resourceId, uint256 amount, address token) internal {
        uint256 protocolFee = (amount * protocolFeeBps) / 10_000;
        uint256 providerShare = amount - protocolFee;

        protocolRevenue[token] += protocolFee;

        // Get assignment from provider registry
        if (address(providerRegistry) != address(0)) {
            ResourceAssignment memory assignment = providerRegistry.getAssignment(resourceId);

            uint256 primaryShare = providerShare / 3;
            uint256 otherShare = (providerShare - primaryShare) / assignment.providers.length;

            providerRevenue[assignment.primary][token] += primaryShare;
            for (uint256 i = 0; i < assignment.providers.length; i++) {
                if (assignment.providers[i] != assignment.primary) {
                    providerRevenue[assignment.providers[i]][token] += otherShare;
                }
            }
        } else {
            // No provider registry - all goes to protocol
            protocolRevenue[token] += providerShare;
        }
    }

    // ============================================================================
    // Admin
    // ============================================================================

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 2000, "Fee too high");
        protocolFeeBps = feeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        if (accepted && !acceptedTokens[token]) {
            tokenList.push(token);
        }
        acceptedTokens[token] = accepted;
    }

    function setCreditManager(address _creditManager) external onlyOwner {
        creditManager = ICreditManager(_creditManager);
    }

    function setProviderRegistry(address _providerRegistry) external onlyOwner {
        providerRegistry = IDWSProviderRegistry(_providerRegistry);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
