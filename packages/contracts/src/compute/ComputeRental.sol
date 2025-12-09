// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

interface ICreditManager {
    function deductCredit(address user, address token, uint256 amount) external;
    function hasSufficientCredit(address user, address token, uint256 amount) external view returns (bool, uint256);
}

/**
 * @title ComputeRental
 * @author Jeju Network
 * @notice Decentralized compute resource rentals with ERC-8004 reputation integration
 * @dev Handles session lifecycle, SSH key storage, payment settlement, and reputation
 *
 * Key Features:
 * - Create rentals with escrow-based payments
 * - SSH public key storage for secure access
 * - Docker container specification support
 * - Startup script execution
 * - Provider session management
 * - Automatic refunds for unused time
 * - REPUTATION INTEGRATION via ERC-8004
 * - DISPUTE RESOLUTION with slashing
 * - ABUSE REPORTING for malicious users
 *
 * Reputation Integration:
 * - Providers can be rated by users after rental completion
 * - Users can be reported for abuse (CSAM, hacking, etc.)
 * - Dispute resolution allows arbitration of conflicts
 * - Bad actors can be banned via governance
 *
 * @custom:security-contact security@jeju.network
 */
contract ComputeRental is Ownable, Pausable, ReentrancyGuard {
    // ============ Enums ============

    enum RentalStatus {
        PENDING, // Created but not started
        ACTIVE, // Running
        PAUSED, // Temporarily suspended
        COMPLETED, // Finished normally
        CANCELLED, // User cancelled
        EXPIRED, // Time ran out
        DISPUTED // Under dispute

    }

    enum GPUType {
        NONE,
        NVIDIA_RTX_4090,
        NVIDIA_A100_40GB,
        NVIDIA_A100_80GB,
        NVIDIA_H100,
        NVIDIA_H200,
        AMD_MI300X,
        APPLE_M1_MAX,
        APPLE_M2_ULTRA,
        APPLE_M3_MAX
    }

    enum DisputeReason {
        NONE,
        PROVIDER_OFFLINE, // Provider unavailable
        WRONG_HARDWARE, // Hardware doesn't match advertised
        POOR_PERFORMANCE, // Performance below promised
        SECURITY_ISSUE, // Security vulnerability
        USER_ABUSE, // User generated illegal/abusive content
        USER_HACK_ATTEMPT, // User attempted to hack/exploit
        USER_TERMS_VIOLATION, // User violated terms
        PAYMENT_DISPUTE // Payment/billing dispute

    }

    // ============ Structs ============

    struct ComputeResources {
        GPUType gpuType;
        uint8 gpuCount;
        uint16 gpuVram; // GB
        uint16 cpuCores;
        uint32 memoryGb; // GB
        uint32 storageGb; // GB
        uint32 bandwidthMbps; // Mbps
        bool teeCapable;
    }

    struct ResourcePricing {
        uint256 pricePerHour; // wei per hour
        uint256 pricePerGpuHour; // additional per GPU hour
        uint256 minimumRentalHours;
        uint256 maximumRentalHours;
    }

    struct Rental {
        bytes32 rentalId;
        address user;
        address provider;
        RentalStatus status;
        uint256 startTime;
        uint256 endTime;
        uint256 totalCost;
        uint256 paidAmount;
        uint256 refundedAmount;
        string sshPublicKey; // User's SSH public key
        string containerImage; // Docker image to run
        string startupScript; // Script to execute on start
        string sshHost; // Assigned SSH host
        uint16 sshPort; // Assigned SSH port
    }

    struct ProviderResources {
        ComputeResources resources;
        ResourcePricing pricing;
        uint256 maxConcurrentRentals;
        uint256 activeRentals;
        string[] supportedImages;
        bool sshEnabled;
        bool dockerEnabled;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
    }

    struct Dispute {
        bytes32 disputeId;
        bytes32 rentalId;
        address initiator; // Who filed the dispute
        address defendant; // Who is being accused
        DisputeReason reason;
        string evidenceUri; // IPFS URI to evidence
        uint256 createdAt;
        uint256 resolvedAt;
        bool resolved;
        bool inFavorOfInitiator; // Resolution outcome
        uint256 slashAmount; // Amount slashed from defendant
    }

    struct RentalRating {
        uint8 score; // 0-100
        string comment; // Optional comment
        uint256 ratedAt;
    }

    struct UserRecord {
        uint256 totalRentals;
        uint256 completedRentals;
        uint256 cancelledRentals;
        uint256 disputedRentals;
        uint256 abuseReports;
        bool banned;
        uint256 bannedAt;
        string banReason;
    }

    struct ProviderRecord {
        uint256 totalRentals;
        uint256 completedRentals;
        uint256 failedRentals;
        uint256 totalEarnings;
        uint256 avgRating; // scaled by 100 (5000 = 50.00)
        uint256 ratingCount;
        bool banned;
    }

    // ============ State Variables ============

    /// @notice All rentals by ID
    mapping(bytes32 => Rental) public rentals;

    /// @notice Provider resource configurations
    mapping(address => ProviderResources) public providerResources;

    /// @notice User's active rentals
    mapping(address => bytes32[]) public userRentals;

    /// @notice Provider's rentals
    mapping(address => bytes32[]) public providerRentals;

    /// @notice Disputes by ID
    mapping(bytes32 => Dispute) public disputes;

    /// @notice Rental disputes (rentalId => disputeId)
    mapping(bytes32 => bytes32) public rentalDisputes;

    /// @notice Rental ratings (rentalId => rating)
    mapping(bytes32 => RentalRating) public rentalRatings;

    /// @notice User records for reputation
    mapping(address => UserRecord) public userRecords;

    /// @notice Provider records for reputation
    mapping(address => ProviderRecord) public providerRecords;

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice ComputeRegistry for provider verification
    IComputeRegistry public computeRegistry;

    /// @notice Whether to require providers to be registered in ComputeRegistry
    bool public requireRegisteredProvider;

    /// @notice Agent ID => provider address mapping
    mapping(uint256 => address) public agentToProvider;

    /// @notice Minimum rental duration (1 hour)
    uint256 public constant MIN_RENTAL_HOURS = 1;

    /// @notice Maximum rental duration (30 days)
    uint256 public constant MAX_RENTAL_HOURS = 720;

    /// @notice Platform fee percentage (basis points, 100 = 1%)
    uint256 public platformFeeBps = 250; // 2.5%

    /// @notice Protocol treasury for fees
    address public treasury;

    /// @notice Rental counter for unique IDs
    uint256 private _rentalCounter;

    /// @notice Dispute counter
    uint256 private _disputeCounter;

    /// @notice Dispute bond (prevents spam)
    uint256 public disputeBond = 0.01 ether;

    /// @notice Abuse report threshold before auto-ban
    uint256 public abuseReportThreshold = 3;

    /// @notice Arbitrators who can resolve disputes
    mapping(address => bool) public arbitrators;

    /// @notice Trusted settlement contracts that can create rentals for users
    mapping(address => bool) public trustedSettlers;

    /// @notice Credit manager for multi-token payments
    ICreditManager public creditManager;

    /// @notice Supported payment tokens (token => accepted)
    mapping(address => bool) public acceptedTokens;

    // ============ Events ============

    event RentalCreated(
        bytes32 indexed rentalId,
        address indexed user,
        address indexed provider,
        uint256 durationHours,
        uint256 totalCost
    );

    event RentalStarted(bytes32 indexed rentalId, string sshHost, uint16 sshPort, string containerId);

    event RentalCompleted(bytes32 indexed rentalId, uint256 actualDuration, uint256 refundAmount);

    event RentalCancelled(bytes32 indexed rentalId, uint256 refundAmount);

    event RentalExtended(bytes32 indexed rentalId, uint256 additionalHours, uint256 additionalCost);

    event ProviderResourcesUpdated(address indexed provider, ComputeResources resources, ResourcePricing pricing);

    event SSHSessionStarted(bytes32 indexed rentalId, address indexed user, string clientIp);

    event DisputeCreated(
        bytes32 indexed disputeId, bytes32 indexed rentalId, address indexed initiator, DisputeReason reason
    );

    event DisputeResolved(bytes32 indexed disputeId, bool inFavorOfInitiator, uint256 slashAmount);

    event RentalRated(bytes32 indexed rentalId, address indexed user, address indexed provider, uint8 score);

    event UserBanned(address indexed user, string reason);

    event UserUnbanned(address indexed user);

    event ProviderBanned(address indexed provider, string reason);

    event AbuseReported(
        address indexed reporter,
        address indexed reported,
        bytes32 indexed rentalId,
        DisputeReason reason,
        string evidenceUri
    );

    event ProviderAgentLinked(address indexed provider, uint256 indexed agentId);

    /// @notice x402 payment requirement for rental quote
    event PaymentRequired(
        address indexed provider, uint256 durationHours, uint256 amountRequired, string asset, string network
    );

    /// @notice Rental created with credit (multi-token)
    event RentalCreatedWithCredit(
        bytes32 indexed rentalId, address indexed user, address indexed provider, address token, uint256 amount
    );

    event CreditManagerUpdated(address indexed oldManager, address indexed newManager);
    event TokenAccepted(address indexed token, bool accepted);

    // ============ Errors ============
    error InsufficientPayment(uint256 provided, uint256 required);
    error RentalNotFound();
    error RentalNotActive();
    error NotRentalOwner();
    error NotRentalProvider();
    error ProviderAtCapacity();
    error InvalidDuration();
    error InvalidSSHKey();
    error TransferFailed();
    error CannotCancelActiveRental();
    error RentalExpired();
    error ProviderNotRegistered();
    error AlreadyDisputed();
    error DisputeNotFound();
    error NotDisputeParty();
    error AlreadyResolved();
    error NotArbitrator();
    error AlreadyRated();
    error RentalNotCompleted();
    error UserBannedError();
    error ProviderBannedError();
    error InvalidAgentId();
    error AgentAlreadyLinked();
    error NotAgentOwner();
    error ProviderNotInRegistry();
    error NotTrustedSettler();
    error CreditManagerNotSet();
    error TokenNotAccepted();
    error InsufficientCredit();

    // ============ Modifiers ============

    modifier notBannedUser() {
        if (userRecords[msg.sender].banned) revert UserBannedError();
        _;
    }

    modifier notBannedProvider(address provider) {
        if (providerRecords[provider].banned) revert ProviderBannedError();
        _;
    }

    modifier onlyArbitrator() {
        if (!arbitrators[msg.sender] && msg.sender != owner()) revert NotArbitrator();
        _;
    }

    // ============ Constructor ============

    constructor(address initialOwner, address _treasury) Ownable(initialOwner) {
        treasury = _treasury;
        arbitrators[initialOwner] = true;
    }

    // ============ Provider Management ============

    /**
     * @notice Register or update provider compute resources
     */
    function setProviderResources(
        ComputeResources calldata resources,
        ResourcePricing calldata pricing,
        uint256 maxConcurrent,
        string[] calldata supportedImages,
        bool sshEnabled,
        bool dockerEnabled
    ) external notBannedProvider(msg.sender) {
        if (pricing.minimumRentalHours < MIN_RENTAL_HOURS) revert InvalidDuration();
        if (pricing.maximumRentalHours > MAX_RENTAL_HOURS) revert InvalidDuration();

        ProviderResources storage pr = providerResources[msg.sender];
        pr.resources = resources;
        pr.pricing = pricing;
        pr.maxConcurrentRentals = maxConcurrent;
        pr.sshEnabled = sshEnabled;
        pr.dockerEnabled = dockerEnabled;

        // Update supported images
        delete pr.supportedImages;
        for (uint256 i = 0; i < supportedImages.length; i++) {
            pr.supportedImages.push(supportedImages[i]);
        }

        emit ProviderResourcesUpdated(msg.sender, resources, pricing);
    }

    /**
     * @notice Link provider to ERC-8004 agent for reputation
     * @param agentId The ERC-8004 agent ID
     */
    function linkProviderAgent(uint256 agentId) external {
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();

        providerResources[msg.sender].agentId = agentId;
        agentToProvider[agentId] = msg.sender;

        emit ProviderAgentLinked(msg.sender, agentId);
    }

    // ============ Rental Creation ============

    /**
     * @notice Create a new compute rental
     */
    function createRental(
        address provider,
        uint256 durationHours,
        string calldata sshPublicKey,
        string calldata containerImage,
        string calldata startupScript
    )
        external
        payable
        nonReentrant
        whenNotPaused
        notBannedUser
        notBannedProvider(provider)
        returns (bytes32 rentalId)
    {
        // Check if provider is registered in ComputeRegistry (if required)
        if (requireRegisteredProvider && address(computeRegistry) != address(0)) {
            if (!computeRegistry.isActive(provider)) revert ProviderNotInRegistry();
        }

        ProviderResources storage pr = providerResources[provider];
        if (pr.pricing.pricePerHour == 0) revert ProviderNotRegistered();
        if (pr.activeRentals >= pr.maxConcurrentRentals) revert ProviderAtCapacity();
        if (durationHours < pr.pricing.minimumRentalHours) revert InvalidDuration();
        if (durationHours > pr.pricing.maximumRentalHours) revert InvalidDuration();
        if (bytes(sshPublicKey).length == 0 && pr.sshEnabled) revert InvalidSSHKey();

        // Calculate cost
        uint256 baseCost = durationHours * pr.pricing.pricePerHour;
        uint256 gpuCost = durationHours * pr.pricing.pricePerGpuHour * pr.resources.gpuCount;
        uint256 totalCost = baseCost + gpuCost;

        if (msg.value < totalCost) revert InsufficientPayment(msg.value, totalCost);

        // Generate rental ID
        rentalId = keccak256(abi.encodePacked(msg.sender, provider, block.timestamp, _rentalCounter++));

        // Create rental
        rentals[rentalId] = Rental({
            rentalId: rentalId,
            user: msg.sender,
            provider: provider,
            status: RentalStatus.PENDING,
            startTime: 0,
            endTime: 0,
            totalCost: totalCost,
            paidAmount: msg.value,
            refundedAmount: 0,
            sshPublicKey: sshPublicKey,
            containerImage: containerImage,
            startupScript: startupScript,
            sshHost: "",
            sshPort: 0
        });

        userRentals[msg.sender].push(rentalId);
        providerRentals[provider].push(rentalId);
        pr.activeRentals++;

        // Update user records
        userRecords[msg.sender].totalRentals++;

        emit RentalCreated(rentalId, msg.sender, provider, durationHours, totalCost);
    }

    /**
     * @notice Create a rental on behalf of another user (for cross-chain flows)
     * @dev Only callable by trusted settlement contracts (OIF OutputSettlers)
     */
    function createRentalFor(
        address user,
        address provider,
        uint256 durationHours,
        string calldata sshPublicKey,
        string calldata containerImage,
        string calldata startupScript
    ) external payable nonReentrant whenNotPaused notBannedProvider(provider) returns (bytes32 rentalId) {
        if (!trustedSettlers[msg.sender]) revert NotTrustedSettler();
        if (userRecords[user].banned) revert UserBannedError();

        if (requireRegisteredProvider && address(computeRegistry) != address(0)) {
            if (!computeRegistry.isActive(provider)) revert ProviderNotInRegistry();
        }

        ProviderResources storage pr = providerResources[provider];
        if (pr.pricing.pricePerHour == 0) revert ProviderNotRegistered();
        if (pr.activeRentals >= pr.maxConcurrentRentals) revert ProviderAtCapacity();
        if (durationHours < pr.pricing.minimumRentalHours) revert InvalidDuration();
        if (durationHours > pr.pricing.maximumRentalHours) revert InvalidDuration();
        if (bytes(sshPublicKey).length == 0 && pr.sshEnabled) revert InvalidSSHKey();

        uint256 baseCost = durationHours * pr.pricing.pricePerHour;
        uint256 gpuCost = durationHours * pr.pricing.pricePerGpuHour * pr.resources.gpuCount;
        uint256 totalCost = baseCost + gpuCost;

        if (msg.value < totalCost) revert InsufficientPayment(msg.value, totalCost);

        rentalId = keccak256(abi.encodePacked(user, provider, block.timestamp, _rentalCounter++));

        rentals[rentalId] = Rental({
            rentalId: rentalId,
            user: user,
            provider: provider,
            status: RentalStatus.PENDING,
            startTime: 0,
            endTime: 0,
            totalCost: totalCost,
            paidAmount: msg.value,
            refundedAmount: 0,
            sshPublicKey: sshPublicKey,
            containerImage: containerImage,
            startupScript: startupScript,
            sshHost: "",
            sshPort: 0
        });

        userRentals[user].push(rentalId);
        providerRentals[provider].push(rentalId);
        pr.activeRentals++;
        userRecords[user].totalRentals++;

        emit RentalCreated(rentalId, user, provider, durationHours, totalCost);
    }

    /**
     * @notice Create a rental using credit balance (multi-token support)
     * @param provider Provider address
     * @param durationHours Rental duration in hours
     * @param sshPublicKey User's SSH public key
     * @param containerImage Docker image to run
     * @param startupScript Startup script to execute
     * @param paymentToken Token address for payment (from CreditManager)
     */
    function createRentalWithCredit(
        address provider,
        uint256 durationHours,
        string calldata sshPublicKey,
        string calldata containerImage,
        string calldata startupScript,
        address paymentToken
    ) external nonReentrant whenNotPaused notBannedUser notBannedProvider(provider) returns (bytes32 rentalId) {
        if (address(creditManager) == address(0)) revert CreditManagerNotSet();
        if (!acceptedTokens[paymentToken]) revert TokenNotAccepted();

        if (requireRegisteredProvider && address(computeRegistry) != address(0)) {
            if (!computeRegistry.isActive(provider)) revert ProviderNotInRegistry();
        }

        ProviderResources storage pr = providerResources[provider];
        if (pr.pricing.pricePerHour == 0) revert ProviderNotRegistered();
        if (pr.activeRentals >= pr.maxConcurrentRentals) revert ProviderAtCapacity();
        if (durationHours < pr.pricing.minimumRentalHours) revert InvalidDuration();
        if (durationHours > pr.pricing.maximumRentalHours) revert InvalidDuration();
        if (bytes(sshPublicKey).length == 0 && pr.sshEnabled) revert InvalidSSHKey();

        uint256 totalCost = _calculateCost(provider, durationHours);

        // Check and deduct credit
        (bool hasCredit,) = creditManager.hasSufficientCredit(msg.sender, paymentToken, totalCost);
        if (!hasCredit) revert InsufficientCredit();

        creditManager.deductCredit(msg.sender, paymentToken, totalCost);

        rentalId = keccak256(abi.encodePacked(msg.sender, provider, block.timestamp, _rentalCounter++));

        rentals[rentalId] = Rental({
            rentalId: rentalId,
            user: msg.sender,
            provider: provider,
            status: RentalStatus.PENDING,
            startTime: 0,
            endTime: 0,
            totalCost: totalCost,
            paidAmount: totalCost, // Credit deducted = paid
            refundedAmount: 0,
            sshPublicKey: sshPublicKey,
            containerImage: containerImage,
            startupScript: startupScript,
            sshHost: "",
            sshPort: 0
        });

        userRentals[msg.sender].push(rentalId);
        providerRentals[provider].push(rentalId);
        pr.activeRentals++;
        userRecords[msg.sender].totalRentals++;

        emit RentalCreated(rentalId, msg.sender, provider, durationHours, totalCost);
        emit RentalCreatedWithCredit(rentalId, msg.sender, provider, paymentToken, totalCost);
    }

    // ============ Provider Actions ============

    /**
     * @notice Provider confirms rental start with connection details
     */
    function startRental(bytes32 rentalId, string calldata sshHost, uint16 sshPort, string calldata containerId)
        external
    {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.provider != msg.sender) revert NotRentalProvider();
        if (rental.status != RentalStatus.PENDING) revert RentalNotActive();

        rental.status = RentalStatus.ACTIVE;
        rental.startTime = block.timestamp;
        uint256 rentalHours = _calculateHoursFromPayment(rental);
        rental.endTime = block.timestamp + (rentalHours * 1 hours);
        rental.sshHost = sshHost;
        rental.sshPort = sshPort;

        emit RentalStarted(rentalId, sshHost, sshPort, containerId);
    }

    /**
     * @notice Provider completes the rental
     * @custom:security CEI pattern: Update all state before external calls
     */
    function completeRental(bytes32 rentalId) external nonReentrant {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.provider != msg.sender) revert NotRentalProvider();
        if (rental.status != RentalStatus.ACTIVE) revert RentalNotActive();

        // Cache values before state changes
        address user = rental.user;
        address provider = rental.provider;
        uint256 paidAmount = rental.paidAmount;

        // Calculate actual usage and refund
        uint256 actualDuration = block.timestamp - rental.startTime;
        uint256 usedCost = _calculateCost(provider, actualDuration / 1 hours);
        uint256 refundAmount = 0;

        if (paidAmount > usedCost) {
            refundAmount = paidAmount - usedCost;
        }

        // Calculate platform fee
        uint256 providerPayment = usedCost;
        uint256 platformFee = (usedCost * platformFeeBps) / 10000;
        providerPayment -= platformFee;

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        rental.status = RentalStatus.COMPLETED;
        rental.refundedAmount = refundAmount;

        providerResources[provider].activeRentals--;
        providerRecords[provider].completedRentals++;
        providerRecords[provider].totalRentals++;
        providerRecords[provider].totalEarnings += providerPayment;
        userRecords[user].completedRentals++;

        // Emit event before external calls
        emit RentalCompleted(rentalId, actualDuration, refundAmount);

        // INTERACTIONS: External calls last
        if (refundAmount > 0) {
            (bool success,) = user.call{value: refundAmount}("");
            if (!success) revert TransferFailed();
        }

        // Pay provider
        (bool providerSuccess,) = provider.call{value: providerPayment}("");
        if (!providerSuccess) revert TransferFailed();

        // Pay treasury
        if (platformFee > 0) {
            (bool treasurySuccess,) = treasury.call{value: platformFee}("");
            if (!treasurySuccess) revert TransferFailed();
        }
    }

    // ============ User Actions ============

    /**
     * @notice User cancels a pending rental
     * @custom:security CEI pattern: Update all state before external calls
     */
    function cancelRental(bytes32 rentalId) external nonReentrant {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.user != msg.sender) revert NotRentalOwner();
        if (rental.status == RentalStatus.ACTIVE) revert CannotCancelActiveRental();
        if (rental.status != RentalStatus.PENDING) revert RentalNotActive();

        // Cache values before state changes
        uint256 refundAmount = rental.paidAmount;
        address provider = rental.provider;

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        rental.status = RentalStatus.CANCELLED;
        rental.refundedAmount = refundAmount;
        providerResources[provider].activeRentals--;
        userRecords[msg.sender].cancelledRentals++;

        // Emit event before external calls
        emit RentalCancelled(rentalId, refundAmount);

        // INTERACTIONS: External calls last
        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice User extends an active rental
     */
    function extendRental(bytes32 rentalId, uint256 additionalHours) external payable nonReentrant {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.user != msg.sender) revert NotRentalOwner();
        if (rental.status != RentalStatus.ACTIVE) revert RentalNotActive();
        if (block.timestamp >= rental.endTime) revert RentalExpired();

        uint256 additionalCost = _calculateCost(rental.provider, additionalHours);
        if (msg.value < additionalCost) revert InsufficientPayment(msg.value, additionalCost);

        rental.endTime += additionalHours * 1 hours;
        rental.paidAmount += msg.value;
        rental.totalCost += additionalCost;

        emit RentalExtended(rentalId, additionalHours, additionalCost);
    }

    // ============ Rating System ============

    /**
     * @notice Rate a completed rental
     * @param rentalId The rental to rate
     * @param score Score from 0-100
     * @param comment Optional comment
     */
    function rateRental(bytes32 rentalId, uint8 score, string calldata comment) external {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.user != msg.sender) revert NotRentalOwner();
        if (rental.status != RentalStatus.COMPLETED) revert RentalNotCompleted();
        if (rentalRatings[rentalId].ratedAt != 0) revert AlreadyRated();
        require(score <= 100, "Score must be 0-100");

        rentalRatings[rentalId] = RentalRating({score: score, comment: comment, ratedAt: block.timestamp});

        // Update provider average rating
        ProviderRecord storage pr = providerRecords[rental.provider];
        uint256 totalScore = pr.avgRating * pr.ratingCount + (uint256(score) * 100);
        pr.ratingCount++;
        pr.avgRating = totalScore / pr.ratingCount;

        emit RentalRated(rentalId, msg.sender, rental.provider, score);
    }

    // ============ Dispute System ============

    /**
     * @notice File a dispute for a rental
     * @param rentalId The rental to dispute
     * @param reason The dispute reason
     * @param evidenceUri IPFS URI to evidence
     */
    function createDispute(bytes32 rentalId, DisputeReason reason, string calldata evidenceUri)
        external
        payable
        nonReentrant
        returns (bytes32 disputeId)
    {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.user != msg.sender && rental.provider != msg.sender) revert NotDisputeParty();
        if (rentalDisputes[rentalId] != bytes32(0)) revert AlreadyDisputed();
        if (msg.value < disputeBond) revert InsufficientPayment(msg.value, disputeBond);

        disputeId = keccak256(abi.encodePacked(rentalId, msg.sender, block.timestamp, _disputeCounter++));

        address defendant = msg.sender == rental.user ? rental.provider : rental.user;

        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            rentalId: rentalId,
            initiator: msg.sender,
            defendant: defendant,
            reason: reason,
            evidenceUri: evidenceUri,
            createdAt: block.timestamp,
            resolvedAt: 0,
            resolved: false,
            inFavorOfInitiator: false,
            slashAmount: 0
        });

        rentalDisputes[rentalId] = disputeId;
        rental.status = RentalStatus.DISPUTED;

        // Update records
        if (rental.user == msg.sender) {
            userRecords[rental.user].disputedRentals++;
        }

        emit DisputeCreated(disputeId, rentalId, msg.sender, reason);
    }

    /**
     * @notice Resolve a dispute (arbitrator only)
     * @param disputeId The dispute to resolve
     * @param inFavorOfInitiator Whether to rule in favor of initiator
     * @param slashAmount Amount to slash from defendant
     * @custom:security CEI pattern: Update all state before external calls
     */
    function resolveDispute(bytes32 disputeId, bool inFavorOfInitiator, uint256 slashAmount)
        external
        nonReentrant
        onlyArbitrator
    {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.disputeId == bytes32(0)) revert DisputeNotFound();
        if (dispute.resolved) revert AlreadyResolved();

        // Cache values before state changes
        address initiator = dispute.initiator;
        bytes32 rentalId = dispute.rentalId;
        Rental storage rental = rentals[rentalId];
        address user = rental.user;
        address provider = rental.provider;
        uint256 paidAmount = rental.paidAmount;
        uint256 refundedAmount = rental.refundedAmount;

        // Calculate refund if applicable
        uint256 refund = 0;
        if (inFavorOfInitiator && initiator == user && paidAmount > refundedAmount) {
            refund = paidAmount - refundedAmount;
        }

        // EFFECTS: Update ALL state BEFORE external calls (CEI pattern)
        dispute.resolved = true;
        dispute.resolvedAt = block.timestamp;
        dispute.inFavorOfInitiator = inFavorOfInitiator;
        dispute.slashAmount = slashAmount;

        if (inFavorOfInitiator) {
            if (refund > 0) {
                rental.refundedAmount = paidAmount;
            }
            if (initiator == user) {
                providerRecords[provider].failedRentals++;
            }
        }

        // Emit event before external calls
        emit DisputeResolved(disputeId, inFavorOfInitiator, slashAmount);

        // INTERACTIONS: External calls last
        if (inFavorOfInitiator) {
            // Return bond to initiator
            (bool bondSuccess,) = initiator.call{value: disputeBond}("");
            if (!bondSuccess) revert TransferFailed();

            // Refund remaining amount if user won
            if (refund > 0) {
                (bool refundSuccess,) = user.call{value: refund}("");
                if (!refundSuccess) revert TransferFailed();
            }
        } else {
            // Defendant wins - bond goes to treasury
            (bool treasurySuccess,) = treasury.call{value: disputeBond}("");
            if (!treasurySuccess) revert TransferFailed();
        }
    }

    // ============ Abuse Reporting ============

    /**
     * @notice Report user abuse (providers can report)
     * @param rentalId The rental where abuse occurred
     * @param reason The abuse reason
     * @param evidenceUri IPFS URI to evidence
     */
    function reportAbuse(bytes32 rentalId, DisputeReason reason, string calldata evidenceUri) external {
        Rental storage rental = rentals[rentalId];
        if (rental.rentalId == bytes32(0)) revert RentalNotFound();
        if (rental.provider != msg.sender) revert NotRentalProvider();

        // Only allow abuse-related reasons
        require(
            reason == DisputeReason.USER_ABUSE || reason == DisputeReason.USER_HACK_ATTEMPT
                || reason == DisputeReason.USER_TERMS_VIOLATION,
            "Invalid abuse reason"
        );

        userRecords[rental.user].abuseReports++;

        emit AbuseReported(msg.sender, rental.user, rentalId, reason, evidenceUri);

        // Auto-ban if threshold reached
        if (userRecords[rental.user].abuseReports >= abuseReportThreshold) {
            userRecords[rental.user].banned = true;
            userRecords[rental.user].bannedAt = block.timestamp;
            userRecords[rental.user].banReason = "Exceeded abuse report threshold";
            emit UserBanned(rental.user, "Exceeded abuse report threshold");
        }
    }

    // ============ View Functions ============

    function getRental(bytes32 rentalId) external view returns (Rental memory) {
        return rentals[rentalId];
    }

    function getProviderResources(address provider)
        external
        view
        returns (
            ComputeResources memory resources,
            ResourcePricing memory pricing,
            uint256 maxConcurrent,
            uint256 active,
            bool sshEnabled,
            bool dockerEnabled
        )
    {
        ProviderResources storage pr = providerResources[provider];
        return (pr.resources, pr.pricing, pr.maxConcurrentRentals, pr.activeRentals, pr.sshEnabled, pr.dockerEnabled);
    }

    function getUserRentals(address user) external view returns (bytes32[] memory) {
        return userRentals[user];
    }

    function getProviderRentals(address provider) external view returns (bytes32[] memory) {
        return providerRentals[provider];
    }

    function calculateRentalCost(address provider, uint256 durationHours) external view returns (uint256) {
        return _calculateCost(provider, durationHours);
    }

    /**
     * @notice Get x402-compatible payment requirement for a rental
     * @param provider Provider address
     * @param durationHours Rental duration in hours
     * @return cost Required payment in wei
     * @return asset Asset address (0x0 for ETH)
     * @return payTo Payment recipient (this contract)
     * @return network Network identifier
     * @return description Human-readable description
     */
    function getPaymentRequirement(address provider, uint256 durationHours)
        external
        view
        returns (uint256 cost, address asset, address payTo, string memory network, string memory description)
    {
        cost = _calculateCost(provider, durationHours);
        asset = address(0); // ETH
        payTo = address(this);
        network = "jeju";

        ProviderResources storage pr = providerResources[provider];
        description = string.concat(
            "Compute rental: ",
            pr.resources.gpuCount > 0 ? "GPU" : "CPU",
            " for ",
            _uintToString(durationHours),
            " hours"
        );
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    function isRentalActive(bytes32 rentalId) external view returns (bool) {
        Rental storage rental = rentals[rentalId];
        return rental.status == RentalStatus.ACTIVE && block.timestamp < rental.endTime;
    }

    function getRemainingTime(bytes32 rentalId) external view returns (uint256) {
        Rental storage rental = rentals[rentalId];
        if (rental.status != RentalStatus.ACTIVE) return 0;
        if (block.timestamp >= rental.endTime) return 0;
        return rental.endTime - block.timestamp;
    }

    function getUserRecord(address user) external view returns (UserRecord memory) {
        return userRecords[user];
    }

    function getProviderRecord(address provider) external view returns (ProviderRecord memory) {
        return providerRecords[provider];
    }

    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function getRentalRating(bytes32 rentalId) external view returns (RentalRating memory) {
        return rentalRatings[rentalId];
    }

    function getProviderByAgent(uint256 agentId) external view returns (address) {
        return agentToProvider[agentId];
    }

    function isUserBanned(address user) external view returns (bool) {
        return userRecords[user].banned;
    }

    function isProviderBanned(address provider) external view returns (bool) {
        return providerRecords[provider].banned;
    }

    // ============ Internal Functions ============

    function _calculateCost(address provider, uint256 durationHours) internal view returns (uint256) {
        ProviderResources storage pr = providerResources[provider];
        uint256 baseCost = durationHours * pr.pricing.pricePerHour;
        uint256 gpuCost = durationHours * pr.pricing.pricePerGpuHour * pr.resources.gpuCount;
        return baseCost + gpuCost;
    }

    function _calculateHoursFromPayment(Rental storage rental) internal view returns (uint256) {
        ProviderResources storage pr = providerResources[rental.provider];
        uint256 hourlyRate = pr.pricing.pricePerHour + (pr.pricing.pricePerGpuHour * pr.resources.gpuCount);
        if (hourlyRate == 0) return 0;
        return rental.paidAmount / hourlyRate;
    }

    // ============ Admin Functions ============

    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1000, "Fee too high"); // Max 10%
        platformFeeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    function setIdentityRegistry(address _registry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_registry);
    }

    function setComputeRegistry(address _registry) external onlyOwner {
        computeRegistry = IComputeRegistry(_registry);
    }

    function setRequireRegisteredProvider(bool required) external onlyOwner {
        requireRegisteredProvider = required;
    }

    function setDisputeBond(uint256 newBond) external onlyOwner {
        disputeBond = newBond;
    }

    function setAbuseThreshold(uint256 newThreshold) external onlyOwner {
        abuseReportThreshold = newThreshold;
    }

    function addArbitrator(address arbitrator) external onlyOwner {
        arbitrators[arbitrator] = true;
    }

    function removeArbitrator(address arbitrator) external onlyOwner {
        arbitrators[arbitrator] = false;
    }

    function addTrustedSettler(address settler) external onlyOwner {
        trustedSettlers[settler] = true;
    }

    function removeTrustedSettler(address settler) external onlyOwner {
        trustedSettlers[settler] = false;
    }

    function setCreditManager(address _creditManager) external onlyOwner {
        address oldManager = address(creditManager);
        creditManager = ICreditManager(_creditManager);
        emit CreditManagerUpdated(oldManager, _creditManager);
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    function banUser(address user, string calldata reason) external onlyOwner {
        userRecords[user].banned = true;
        userRecords[user].bannedAt = block.timestamp;
        userRecords[user].banReason = reason;
        emit UserBanned(user, reason);
    }

    function unbanUser(address user) external onlyOwner {
        userRecords[user].banned = false;
        emit UserUnbanned(user);
    }

    function banProvider(address provider, string calldata reason) external onlyOwner {
        providerRecords[provider].banned = true;
        emit ProviderBanned(provider, reason);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}
