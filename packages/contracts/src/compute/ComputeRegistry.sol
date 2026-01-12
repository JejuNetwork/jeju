// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

/**
 * @title IUnifiedAttestationVerifier
 * @notice Interface for the UnifiedAttestationVerifier contract
 */
interface IUnifiedAttestationVerifier {
    function isNodeAttested(bytes32 nodeId) external view returns (bool valid, bytes32 attestationId);
    function isAttestationValid(bytes32 attestationId) external view returns (bool valid, uint256 expiresAt);
    function isTrustedMeasurement(bytes32 mrEnclave, bytes32 mrSigner, uint8 platform) external view returns (bool);
}

/**
 * @title ComputeRegistry
 * @notice Provider registry for all compute services (AI, database, training, etc.)
 *
 * Service Types:
 * - inference: AI model inference (LLM, vision, etc.)
 * - database: Decentralized SQL (SQLit/SQLit)
 * - training: Model training/fine-tuning
 * - storage: Compute-adjacent storage
 * - custom: User-defined compute services
 *
 * TEE Integration:
 * - Integrates with UnifiedAttestationVerifier for attestation validation
 * - Providers can register with TEE attestation for enhanced trust
 * - Non-TEE providers are still supported but marked accordingly
 */
contract ComputeRegistry is ProviderRegistryBase, IComputeRegistry {
    /// @notice Service type constants
    bytes32 public constant SERVICE_INFERENCE = keccak256("inference");
    bytes32 public constant SERVICE_DATABASE = keccak256("database");
    bytes32 public constant SERVICE_TRAINING = keccak256("training");
    bytes32 public constant SERVICE_STORAGE = keccak256("storage");

    /// @notice TEE platform constants (matching UnifiedAttestationVerifier)
    uint8 public constant TEE_NONE = 0;
    uint8 public constant TEE_INTEL_TDX = 1;
    uint8 public constant TEE_INTEL_SGX = 2;
    uint8 public constant TEE_AMD_SEV_SNP = 3;
    uint8 public constant TEE_PHALA = 4;
    uint8 public constant TEE_AWS_NITRO = 5;
    uint8 public constant TEE_GCP_CONFIDENTIAL = 6;

    struct Provider {
        address owner;
        string name;
        string endpoint;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        bytes32 serviceType; // Primary service type
        bool active;
        // TEE-specific fields
        bytes32 nodeId; // Unique node ID for attestation lookup
        uint8 teePlatform; // TEE platform type (0 = none)
        bytes32 mrEnclave; // Enclave measurement (if TEE)
        bytes32 mrSigner; // Signer measurement (if TEE)
        bool teeVerified; // Whether TEE attestation is verified
    }

    struct Capability {
        string model; // Model name or database type (e.g., "gpt-4", "sqlit")
        uint256 pricePerInputToken; // For inference: per token. For database: per query
        uint256 pricePerOutputToken; // For inference: per token. For database: per result row
        uint256 maxContextLength; // For inference: context. For database: max result size
        bool active;
    }

    /// @notice Attestation verifier contract
    IUnifiedAttestationVerifier public attestationVerifier;

    /// @notice Whether TEE attestation is required for registration
    bool public requireTeeAttestation;

    mapping(address => Provider) public providers;
    mapping(address => Capability[]) private _capabilities;
    mapping(bytes32 => address[]) private _providersByService; // service type => providers
    mapping(bytes32 => address) private _nodeIdToProvider; // nodeId => provider address

    event ProviderRegistered(
        address indexed provider,
        string name,
        string endpoint,
        bytes32 attestationHash,
        uint256 stake,
        uint256 agentId,
        bytes32 serviceType
    );
    event ProviderRegisteredWithTEE(
        address indexed provider,
        string name,
        bytes32 indexed nodeId,
        uint8 teePlatform,
        bytes32 mrEnclave,
        bytes32 serviceType
    );
    event ProviderUpdated(address indexed provider, string endpoint, bytes32 attestationHash);
    event CapabilityAdded(
        address indexed provider,
        string model,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken,
        uint256 maxContextLength
    );
    event CapabilityUpdated(address indexed provider, uint256 index, bool active);
    event ServiceTypeUpdated(address indexed provider, bytes32 oldType, bytes32 newType);
    event AttestationVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event ProviderTEEStatusUpdated(address indexed provider, bool teeVerified);
    event RequireTeeAttestationUpdated(bool oldValue, bool newValue);

    error InvalidEndpoint();
    error InvalidName();
    error InvalidCapabilityIndex();
    error InvalidServiceType();
    error InvalidNodeId();
    error NodeIdAlreadyRegistered();
    error TeeAttestationRequired();
    error TeeAttestationInvalid();
    error AttestationVerifierNotSet();
    error UntrustedMeasurement();

    constructor(address _owner, address _identityRegistry, address _banManager, uint256 _minProviderStake)
        ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minProviderStake)
    {
        requireTeeAttestation = false; // Default: don't require TEE
    }

    /// @notice Register as an inference provider (default service type)
    function register(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (requireTeeAttestation) revert TeeAttestationRequired();
        _registerWithService(name, endpoint, attestationHash, 0, SERVICE_INFERENCE);
    }

    /// @notice Register with specific service type (database, training, etc.)
    function registerWithService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        if (requireTeeAttestation) revert TeeAttestationRequired();
        _registerWithService(name, endpoint, attestationHash, 0, serviceType);
    }

    /// @notice Register as database provider (SQLit/SQLit)
    function registerDatabaseProvider(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (requireTeeAttestation) revert TeeAttestationRequired();
        _registerWithService(name, endpoint, attestationHash, 0, SERVICE_DATABASE);
    }

    function registerWithAgent(string calldata name, string calldata endpoint, bytes32 attestationHash, uint256 agentId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (requireTeeAttestation) revert TeeAttestationRequired();
        _registerWithAgentAndService(name, endpoint, attestationHash, agentId, SERVICE_INFERENCE);
    }

    /// @notice Register with agent and specific service type
    function registerWithAgentAndService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        if (requireTeeAttestation) revert TeeAttestationRequired();
        _registerWithAgentAndService(name, endpoint, attestationHash, agentId, serviceType);
    }

    /**
     * @notice Register with TEE attestation
     * @param name Provider name
     * @param endpoint Service endpoint URL
     * @param nodeId Unique node ID (from attestation)
     * @param teePlatform TEE platform type
     * @param mrEnclave Enclave measurement
     * @param mrSigner Signer measurement
     * @param serviceType Service type
     */
    function registerWithTEE(
        string calldata name,
        string calldata endpoint,
        bytes32 nodeId,
        uint8 teePlatform,
        bytes32 mrEnclave,
        bytes32 mrSigner,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (nodeId == bytes32(0)) revert InvalidNodeId();
        if (serviceType == bytes32(0)) revert InvalidServiceType();
        if (_nodeIdToProvider[nodeId] != address(0)) revert NodeIdAlreadyRegistered();

        // Verify attestation with UnifiedAttestationVerifier if set
        bool teeVerified = false;
        if (address(attestationVerifier) != address(0)) {
            // Check if measurement is trusted
            if (!attestationVerifier.isTrustedMeasurement(mrEnclave, mrSigner, teePlatform)) {
                revert UntrustedMeasurement();
            }

            // Check if node has valid attestation
            (bool valid,) = attestationVerifier.isNodeAttested(nodeId);
            teeVerified = valid;

            // If TEE attestation is required, reject if not verified
            if (requireTeeAttestation && !teeVerified) {
                revert TeeAttestationInvalid();
            }
        } else if (requireTeeAttestation) {
            revert AttestationVerifierNotSet();
        }

        _registerProviderWithoutAgent(msg.sender);

        // Store provider data with TEE info
        bytes32 attestationHash = keccak256(abi.encodePacked(nodeId, mrEnclave, mrSigner, teePlatform));
        
        providers[msg.sender] = Provider({
            owner: msg.sender,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: 0,
            serviceType: serviceType,
            active: true,
            nodeId: nodeId,
            teePlatform: teePlatform,
            mrEnclave: mrEnclave,
            mrSigner: mrSigner,
            teeVerified: teeVerified
        });

        _providersByService[serviceType].push(msg.sender);
        _nodeIdToProvider[nodeId] = msg.sender;

        emit ProviderRegisteredWithTEE(msg.sender, name, nodeId, teePlatform, mrEnclave, serviceType);
    }

    /**
     * @notice Register with TEE attestation and agent
     * @param name Provider name
     * @param endpoint Service endpoint URL
     * @param nodeId Unique node ID (from attestation)
     * @param teePlatform TEE platform type
     * @param mrEnclave Enclave measurement
     * @param mrSigner Signer measurement
     * @param agentId ERC-8004 agent ID
     * @param serviceType Service type
     */
    function registerWithTEEAndAgent(
        string calldata name,
        string calldata endpoint,
        bytes32 nodeId,
        uint8 teePlatform,
        bytes32 mrEnclave,
        bytes32 mrSigner,
        uint256 agentId,
        bytes32 serviceType
    ) external payable nonReentrant whenNotPaused {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (nodeId == bytes32(0)) revert InvalidNodeId();
        if (serviceType == bytes32(0)) revert InvalidServiceType();
        if (_nodeIdToProvider[nodeId] != address(0)) revert NodeIdAlreadyRegistered();

        // Verify attestation with UnifiedAttestationVerifier if set
        bool teeVerified = false;
        if (address(attestationVerifier) != address(0)) {
            if (!attestationVerifier.isTrustedMeasurement(mrEnclave, mrSigner, teePlatform)) {
                revert UntrustedMeasurement();
            }

            (bool valid,) = attestationVerifier.isNodeAttested(nodeId);
            teeVerified = valid;

            if (requireTeeAttestation && !teeVerified) {
                revert TeeAttestationInvalid();
            }
        } else if (requireTeeAttestation) {
            revert AttestationVerifierNotSet();
        }

        _registerProviderWithAgent(msg.sender, agentId);

        bytes32 attestationHash = keccak256(abi.encodePacked(nodeId, mrEnclave, mrSigner, teePlatform));
        
        providers[msg.sender] = Provider({
            owner: msg.sender,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            serviceType: serviceType,
            active: true,
            nodeId: nodeId,
            teePlatform: teePlatform,
            mrEnclave: mrEnclave,
            mrSigner: mrSigner,
            teeVerified: teeVerified
        });

        _providersByService[serviceType].push(msg.sender);
        _nodeIdToProvider[nodeId] = msg.sender;

        emit ProviderRegisteredWithTEE(msg.sender, name, nodeId, teePlatform, mrEnclave, serviceType);
    }

    /**
     * @notice Refresh TEE verification status for a provider
     * @param providerAddr Provider address to refresh
     */
    function refreshTEEStatus(address providerAddr) external {
        Provider storage provider = providers[providerAddr];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.nodeId == bytes32(0)) return; // Not a TEE provider

        if (address(attestationVerifier) == address(0)) {
            provider.teeVerified = false;
            emit ProviderTEEStatusUpdated(providerAddr, false);
            return;
        }

        (bool valid,) = attestationVerifier.isNodeAttested(provider.nodeId);
        provider.teeVerified = valid;
        emit ProviderTEEStatusUpdated(providerAddr, valid);
    }

    function _registerWithService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (serviceType == bytes32(0)) revert InvalidServiceType();

        _registerProviderWithoutAgent(msg.sender);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, agentId, serviceType);
    }

    function _registerWithAgentAndService(
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (serviceType == bytes32(0)) revert InvalidServiceType();

        _registerProviderWithAgent(msg.sender, agentId);
        _storeProviderData(msg.sender, name, endpoint, attestationHash, agentId, serviceType);
    }

    function _storeProviderData(
        address provider,
        string calldata name,
        string calldata endpoint,
        bytes32 attestationHash,
        uint256 agentId,
        bytes32 serviceType
    ) internal {
        providers[provider] = Provider({
            owner: provider,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            serviceType: serviceType,
            active: true,
            nodeId: bytes32(0),
            teePlatform: TEE_NONE,
            mrEnclave: bytes32(0),
            mrSigner: bytes32(0),
            teeVerified: false
        });

        _providersByService[serviceType].push(provider);
        emit ProviderRegistered(provider, name, endpoint, attestationHash, msg.value, agentId, serviceType);
    }

    function _onProviderRegistered(address provider, uint256, uint256) internal view override {
        if (providers[provider].registeredAt != 0) {
            revert ProviderAlreadyRegistered();
        }
    }

    function updateEndpoint(string calldata endpoint, bytes32 attestationHash) external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        provider.endpoint = endpoint;
        if (attestationHash != bytes32(0)) {
            provider.attestationHash = attestationHash;
        }

        emit ProviderUpdated(msg.sender, endpoint, attestationHash);
    }

    function deactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    function reactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }

    function addStake() external payable nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        if (provider.active && provider.stake - amount < minProviderStake) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    function addCapability(
        string calldata model,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken,
        uint256 maxContextLength
    ) external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        _capabilities[msg.sender].push(
            Capability({
                model: model,
                pricePerInputToken: pricePerInputToken,
                pricePerOutputToken: pricePerOutputToken,
                maxContextLength: maxContextLength,
                active: true
            })
        );

        emit CapabilityAdded(msg.sender, model, pricePerInputToken, pricePerOutputToken, maxContextLength);
    }

    function setCapabilityActive(uint256 index, bool active) external {
        if (index >= _capabilities[msg.sender].length) revert InvalidCapabilityIndex();
        _capabilities[msg.sender][index].active = active;
        emit CapabilityUpdated(msg.sender, index, active);
    }

    function getProvider(address addr) external view returns (Provider memory) {
        return providers[addr];
    }

    function getCapabilities(address addr) external view returns (Capability[] memory) {
        return _capabilities[addr];
    }

    function isActive(address addr) external view returns (bool) {
        Provider storage provider = providers[addr];
        return provider.registeredAt != 0 && provider.active;
    }

    function getActiveProviders() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].active) {
                activeProviders[idx++] = providerList[i];
            }
        }

        return activeProviders;
    }

    function getProviderStake(address addr) external view returns (uint256) {
        return providers[addr].stake;
    }

    function isVerifiedAgent(address addr) external view returns (bool) {
        uint256 agentId = providers[addr].agentId;
        if (agentId == 0) return false;
        return this.hasValidAgent(addr);
    }

    function getProviderAgentId(address provider) external view returns (uint256) {
        return providers[provider].agentId;
    }

    function getProviderServiceType(address provider) external view returns (bytes32) {
        return providers[provider].serviceType;
    }

    /// @notice Get all providers of a specific service type
    function getProvidersByService(bytes32 serviceType) external view returns (address[] memory) {
        return _providersByService[serviceType];
    }

    /// @notice Get active providers of a specific service type
    function getActiveProvidersByService(bytes32 serviceType) external view returns (address[] memory) {
        address[] storage allProviders = _providersByService[serviceType];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeProviders[idx++] = allProviders[i];
            }
        }
        return activeProviders;
    }

    /// @notice Get all database providers (SQLit operators)
    function getDatabaseProviders() external view returns (address[] memory) {
        return _providersByService[SERVICE_DATABASE];
    }

    /// @notice Get active database providers
    function getActiveDatabaseProviders() external view returns (address[] memory) {
        address[] storage allProviders = _providersByService[SERVICE_DATABASE];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeProviders = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].active) {
                activeProviders[idx++] = allProviders[i];
            }
        }
        return activeProviders;
    }

    /// @notice Check if provider offers a specific service
    function isServiceProvider(address provider, bytes32 serviceType) external view returns (bool) {
        return providers[provider].serviceType == serviceType && providers[provider].active;
    }

    /// @notice Check if provider is a database provider
    function isDatabaseProvider(address provider) external view returns (bool) {
        return providers[provider].serviceType == SERVICE_DATABASE && providers[provider].active;
    }

    // ============ TEE-Specific View Functions ============

    /**
     * @notice Check if provider has verified TEE attestation
     * @param provider Provider address
     * @return hasTEE Whether provider is registered with TEE
     * @return verified Whether TEE attestation is currently valid
     * @return platform TEE platform type
     */
    function getProviderTEEStatus(address provider) external view returns (bool hasTEE, bool verified, uint8 platform) {
        Provider storage p = providers[provider];
        hasTEE = p.teePlatform != TEE_NONE;
        verified = p.teeVerified;
        platform = p.teePlatform;
    }

    /**
     * @notice Get provider by node ID
     * @param nodeId Node ID to lookup
     * @return provider Provider address
     */
    function getProviderByNodeId(bytes32 nodeId) external view returns (address) {
        return _nodeIdToProvider[nodeId];
    }

    /**
     * @notice Get TEE-verified providers
     * @return verifiedProviders Array of verified provider addresses
     */
    function getTEEVerifiedProviders() external view returns (address[] memory) {
        uint256 verifiedCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].teeVerified && providers[providerList[i]].active) {
                verifiedCount++;
            }
        }

        address[] memory verifiedProviders = new address[](verifiedCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].teeVerified && providers[providerList[i]].active) {
                verifiedProviders[idx++] = providerList[i];
            }
        }
        return verifiedProviders;
    }

    /**
     * @notice Get TEE-verified providers by service type
     * @param serviceType Service type to filter
     * @return verifiedProviders Array of verified provider addresses
     */
    function getTEEVerifiedProvidersByService(bytes32 serviceType) external view returns (address[] memory) {
        address[] storage allProviders = _providersByService[serviceType];
        uint256 verifiedCount = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].teeVerified && providers[allProviders[i]].active) {
                verifiedCount++;
            }
        }

        address[] memory verifiedProviders = new address[](verifiedCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (providers[allProviders[i]].teeVerified && providers[allProviders[i]].active) {
                verifiedProviders[idx++] = allProviders[i];
            }
        }
        return verifiedProviders;
    }

    /**
     * @notice Get provider's TEE measurements
     * @param provider Provider address
     * @return nodeId Node ID
     * @return mrEnclave Enclave measurement
     * @return mrSigner Signer measurement
     */
    function getProviderMeasurements(address provider) external view returns (bytes32 nodeId, bytes32 mrEnclave, bytes32 mrSigner) {
        Provider storage p = providers[provider];
        return (p.nodeId, p.mrEnclave, p.mrSigner);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the attestation verifier contract
     * @param _attestationVerifier New verifier address
     */
    function setAttestationVerifier(address _attestationVerifier) external onlyOwner {
        address oldVerifier = address(attestationVerifier);
        attestationVerifier = IUnifiedAttestationVerifier(_attestationVerifier);
        emit AttestationVerifierUpdated(oldVerifier, _attestationVerifier);
    }

    /**
     * @notice Set whether TEE attestation is required
     * @param _requireTeeAttestation Whether to require TEE attestation
     */
    function setRequireTeeAttestation(bool _requireTeeAttestation) external onlyOwner {
        bool oldValue = requireTeeAttestation;
        requireTeeAttestation = _requireTeeAttestation;
        emit RequireTeeAttestationUpdated(oldValue, _requireTeeAttestation);
    }

    function version() external pure returns (string memory) {
        return "4.0.0-tee";
    }
}
