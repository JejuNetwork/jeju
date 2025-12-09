// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

interface ILedgerManager {
    function settle(address user, address provider, uint256 amount, bytes32 requestHash) external;
    function isAcknowledged(address user, address provider) external view returns (bool);
    function getProviderBalance(address user, address provider) external view returns (uint256);
}

interface IIdentityRegistryMinimal {
    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
}

/**
 * @title InferenceServing
 * @author Jeju Network
 * @notice Settlement contract for AI inference requests
 * @dev Handles service registration, fee calculation, and cryptographic settlements
 *
 * Key Features:
 * - Provider service registration (model, endpoint, pricing)
 * - Fee calculation based on token counts
 * - Cryptographic settlement with provider signatures
 * - Nonce tracking for replay protection
 * - ERC-8004 integration via ComputeRegistry
 *
 * Settlement Flow:
 * 1. Provider registers service with pricing
 * 2. User requests inference from provider off-chain
 * 3. Provider returns response with signed settlement data
 * 4. User (or anyone) calls settle() with signature
 * 5. LedgerManager transfers funds
 *
 * @custom:security-contact security@jeju.network
 */
contract InferenceServing is Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Structs ============

    struct Service {
        address provider;
        string model;
        string endpoint;
        uint256 pricePerInputToken;
        uint256 pricePerOutputToken;
        bool active;
    }

    struct Settlement {
        address user;
        address provider;
        bytes32 requestHash;
        uint256 inputTokens;
        uint256 outputTokens;
        uint256 fee;
        uint256 timestamp;
    }

    // ============ State Variables ============

    /// @notice Compute Registry for provider validation
    IComputeRegistry public registry;

    /// @notice Ledger Manager for payments
    ILedgerManager public ledger;

    /// @notice Provider services (provider => services[])
    mapping(address => Service[]) private _services;

    /// @notice Provider signer addresses (for settlement signatures)
    mapping(address => address) public providerSigners;

    /// @notice User => Provider => Nonce (for replay protection)
    mapping(address => mapping(address => uint256)) public nonces;

    /// @notice Settlement records by hash
    mapping(bytes32 => Settlement) public settlements;

    /// @notice Total settlements count
    uint256 public totalSettlements;

    /// @notice Total fees collected
    uint256 public totalFeesCollected;

    /// @notice ERC-8004 Identity Registry (optional)
    IIdentityRegistryMinimal public identityRegistry;

    /// @notice Agent ID => Total tokens processed
    mapping(uint256 => uint256) public agentTotalTokens;

    /// @notice Agent ID => Total revenue generated
    mapping(uint256 => uint256) public agentTotalRevenue;

    /// @notice Agent ID => Settlement count
    mapping(uint256 => uint256) public agentSettlementCount;

    // ============ Events ============

    event ServiceRegistered(
        address indexed provider,
        uint256 serviceIndex,
        string model,
        string endpoint,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken
    );
    event ServiceDeactivated(address indexed provider, uint256 serviceIndex);
    event ServiceReactivated(address indexed provider, uint256 serviceIndex);
    event SignerSet(address indexed provider, address indexed signer);
    event Settled(
        address indexed user,
        address indexed provider,
        bytes32 requestHash,
        uint256 inputTokens,
        uint256 outputTokens,
        uint256 fee,
        uint256 nonce
    );
    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event LedgerUpdated(address indexed oldLedger, address indexed newLedger);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentSettled(
        uint256 indexed agentId, address indexed user, uint256 inputTokens, uint256 outputTokens, uint256 fee
    );

    // ============ Errors ============

    error ProviderNotActive();
    error ServiceNotFound();
    error ServiceNotActive();
    error InvalidSignature();
    error InvalidNonce(uint256 expected, uint256 provided);
    error UserNotAcknowledged();
    error InsufficientBalance(uint256 available, uint256 required);
    error ZeroAddress();

    // ============ Constructor ============

    constructor(address _registry, address _ledger, address initialOwner) Ownable(initialOwner) {
        registry = IComputeRegistry(_registry);
        ledger = ILedgerManager(_ledger);
    }

    // ============ Service Management ============

    /**
     * @notice Register a new inference service
     * @param model Model identifier (e.g., "llama-3.1-8b")
     * @param endpoint Service endpoint URL
     * @param pricePerInputToken Price per input token in wei
     * @param pricePerOutputToken Price per output token in wei
     */
    function registerService(
        string calldata model,
        string calldata endpoint,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken
    ) external whenNotPaused {
        if (!registry.isActive(msg.sender)) revert ProviderNotActive();

        _services[msg.sender].push(
            Service({
                provider: msg.sender,
                model: model,
                endpoint: endpoint,
                pricePerInputToken: pricePerInputToken,
                pricePerOutputToken: pricePerOutputToken,
                active: true
            })
        );

        uint256 serviceIndex = _services[msg.sender].length - 1;

        emit ServiceRegistered(msg.sender, serviceIndex, model, endpoint, pricePerInputToken, pricePerOutputToken);
    }

    /**
     * @notice Deactivate a service
     * @param serviceIndex Index of the service
     */
    function deactivateService(uint256 serviceIndex) external {
        if (serviceIndex >= _services[msg.sender].length) revert ServiceNotFound();
        _services[msg.sender][serviceIndex].active = false;
        emit ServiceDeactivated(msg.sender, serviceIndex);
    }

    /**
     * @notice Reactivate a service
     * @param serviceIndex Index of the service
     */
    function reactivateService(uint256 serviceIndex) external {
        if (serviceIndex >= _services[msg.sender].length) revert ServiceNotFound();
        if (!registry.isActive(msg.sender)) revert ProviderNotActive();
        _services[msg.sender][serviceIndex].active = true;
        emit ServiceReactivated(msg.sender, serviceIndex);
    }

    /**
     * @notice Set the signer address for settlements
     * @dev Signer can be different from provider (e.g., TEE-derived key)
     * @param signer Signer address
     */
    function setSigner(address signer) external {
        if (signer == address(0)) revert ZeroAddress();
        providerSigners[msg.sender] = signer;
        emit SignerSet(msg.sender, signer);
    }

    // ============ Settlement ============

    /**
     * @notice Settle an inference request
     * @param provider Provider address
     * @param requestHash Hash of the request (for uniqueness)
     * @param inputTokens Number of input tokens
     * @param outputTokens Number of output tokens
     * @param nonce Settlement nonce (must match current)
     * @param signature Provider signature over settlement data
     */
    function settle(
        address provider,
        bytes32 requestHash,
        uint256 inputTokens,
        uint256 outputTokens,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // Validate provider
        if (!registry.isActive(provider)) revert ProviderNotActive();

        // Validate nonce
        uint256 expectedNonce = nonces[msg.sender][provider];
        if (nonce != expectedNonce) revert InvalidNonce(expectedNonce, nonce);

        // Validate acknowledgment
        if (!ledger.isAcknowledged(msg.sender, provider)) revert UserNotAcknowledged();

        // Calculate fee
        Service memory service = _getActiveService(provider);
        uint256 fee = calculateFee(service, inputTokens, outputTokens);

        // Validate balance
        uint256 balance = ledger.getProviderBalance(msg.sender, provider);
        if (balance < fee) revert InsufficientBalance(balance, fee);

        // Verify signature
        address signer = providerSigners[provider];
        if (signer == address(0)) signer = provider;

        bytes32 messageHash =
            keccak256(abi.encodePacked(msg.sender, provider, requestHash, inputTokens, outputTokens, nonce));

        address recovered = messageHash.toEthSignedMessageHash().recover(signature);
        if (recovered != signer) revert InvalidSignature();

        // Increment nonce
        nonces[msg.sender][provider] = nonce + 1;

        // Record settlement
        bytes32 settlementId = keccak256(abi.encodePacked(msg.sender, provider, requestHash, block.timestamp));

        settlements[settlementId] = Settlement({
            user: msg.sender,
            provider: provider,
            requestHash: requestHash,
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            fee: fee,
            timestamp: block.timestamp
        });

        totalSettlements++;
        totalFeesCollected += fee;

        // Track by ERC-8004 agent if registry is set
        uint256 agentId = 0;
        if (address(identityRegistry) != address(0)) {
            agentId = registry.getProviderAgentId(provider);
            if (agentId != 0) {
                agentTotalTokens[agentId] += inputTokens + outputTokens;
                agentTotalRevenue[agentId] += fee;
                agentSettlementCount[agentId]++;
                emit AgentSettled(agentId, msg.sender, inputTokens, outputTokens, fee);
            }
        }

        // Execute settlement via ledger
        ledger.settle(msg.sender, provider, fee, requestHash);

        emit Settled(msg.sender, provider, requestHash, inputTokens, outputTokens, fee, nonce);
    }

    // ============ View Functions ============

    /**
     * @notice Get services for a provider
     */
    function getServices(address provider) external view returns (Service[] memory) {
        return _services[provider];
    }

    /**
     * @notice Get active services for a provider
     */
    function getActiveServices(address provider) external view returns (Service[] memory) {
        Service[] memory all = _services[provider];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) activeCount++;
        }

        Service[] memory active = new Service[](activeCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) {
                active[idx++] = all[i];
            }
        }

        return active;
    }

    /**
     * @notice Get current nonce for user-provider pair
     */
    function getNonce(address user, address provider) external view returns (uint256) {
        return nonces[user][provider];
    }

    /**
     * @notice Get signer for a provider
     */
    function getSigner(address provider) external view returns (address) {
        address signer = providerSigners[provider];
        return signer == address(0) ? provider : signer;
    }

    /**
     * @notice Calculate fee for token counts
     */
    function calculateFee(address provider, uint256 inputTokens, uint256 outputTokens)
        external
        view
        returns (uint256)
    {
        Service memory service = _getActiveService(provider);
        return calculateFee(service, inputTokens, outputTokens);
    }

    /**
     * @dev Internal fee calculation
     */
    function calculateFee(Service memory service, uint256 inputTokens, uint256 outputTokens)
        internal
        pure
        returns (uint256)
    {
        return (inputTokens * service.pricePerInputToken) + (outputTokens * service.pricePerOutputToken);
    }

    /**
     * @dev Get first active service for provider
     */
    function _getActiveService(address provider) internal view returns (Service memory) {
        Service[] memory services = _services[provider];
        for (uint256 i = 0; i < services.length; i++) {
            if (services[i].active) {
                return services[i];
            }
        }
        revert ServiceNotActive();
    }

    // ============ Admin Functions ============

    /**
     * @notice Update registry address
     */
    function setRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        address oldRegistry = address(registry);
        registry = IComputeRegistry(_registry);
        emit RegistryUpdated(oldRegistry, _registry);
    }

    /**
     * @notice Update ledger address
     */
    function setLedger(address _ledger) external onlyOwner {
        if (_ledger == address(0)) revert ZeroAddress();
        address oldLedger = address(ledger);
        ledger = ILedgerManager(_ledger);
        emit LedgerUpdated(oldLedger, _ledger);
    }

    /**
     * @notice Set identity registry for ERC-8004 agent tracking
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistryMinimal(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Get agent statistics
     */
    function getAgentStats(uint256 agentId)
        external
        view
        returns (uint256 totalTokens, uint256 totalRevenue, uint256 settlementCount)
    {
        return (agentTotalTokens[agentId], agentTotalRevenue[agentId], agentSettlementCount[agentId]);
    }

    /**
     * @notice Pause/unpause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
