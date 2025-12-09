// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ComputeRegistry
 * @author Jeju Network
 * @notice Provider registry for decentralized AI compute marketplace
 * @dev Integrates with ERC-8004 IdentityRegistry for agent verification
 *
 * Key Features:
 * - Provider registration with staking
 * - Hardware attestation support (TEE, GPU)
 * - Capability declaration (models, pricing)
 * - ERC-8004 agent integration for identity verification
 * - Endpoint management and discovery
 *
 * Providers can register with:
 * - ETH stake (minimum required for security)
 * - Hardware attestation hash (TEE/GPU verification)
 * - Service endpoint URL
 * - Model capabilities with pricing
 *
 * @custom:security-contact security@jeju.network
 */
contract ComputeRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    struct Provider {
        address owner;
        string name;
        string endpoint;
        bytes32 attestationHash;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId; // ERC-8004 agent ID (0 if not linked)
        bool active;
    }

    struct Capability {
        string model;
        uint256 pricePerInputToken;
        uint256 pricePerOutputToken;
        uint256 maxContextLength;
        bool active;
    }

    // ============ State Variables ============

    /// @notice Minimum stake required to register as provider
    uint256 public minProviderStake = 0.01 ether;

    /// @notice Provider data by address
    mapping(address => Provider) public providers;

    /// @notice Provider capabilities (provider => capability[])
    mapping(address => Capability[]) private _capabilities;

    /// @notice All registered provider addresses
    address[] public providerList;

    /// @notice ERC-8004 Identity Registry (optional integration)
    IIdentityRegistry public identityRegistry;

    /// @notice Whether to require ERC-8004 agent registration
    bool public requireAgentRegistration;

    /// @notice Mapping of agent ID => provider address
    mapping(uint256 => address) public agentToProvider;

    // ============ Events ============

    event ProviderRegistered(
        address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId
    );
    event ProviderUpdated(address indexed provider, string endpoint, bytes32 attestationHash);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);
    event StakeAdded(address indexed provider, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event CapabilityAdded(
        address indexed provider,
        string model,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken,
        uint256 maxContextLength
    );
    event CapabilityUpdated(address indexed provider, uint256 index, bool active);
    event MinStakeUpdated(uint256 oldStake, uint256 newStake);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentRegistrationRequirementUpdated(bool required);

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error ProviderAlreadyRegistered();
    error ProviderNotRegistered();
    error ProviderNotActive();
    error ProviderStillActive();
    error InvalidEndpoint();
    error InvalidName();
    error InvalidCapabilityIndex();
    error WithdrawalWouldBreachMinimum();
    error TransferFailed();
    error AgentRequired();
    error InvalidAgentId();
    error NotAgentOwner();
    error AgentAlreadyLinked();

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ============ Registration ============

    /**
     * @notice Register as a compute provider
     * @param name Provider display name
     * @param endpoint API endpoint URL (e.g., https://provider.example.com)
     * @param attestationHash Hash of hardware attestation (TEE/GPU proof)
     */
    function register(string calldata name, string calldata endpoint, bytes32 attestationHash)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (requireAgentRegistration) revert AgentRequired();
        _registerInternal(name, endpoint, attestationHash, 0);
    }

    /**
     * @notice Register as a compute provider with ERC-8004 agent verification
     * @param name Provider display name
     * @param endpoint API endpoint URL
     * @param attestationHash Hash of hardware attestation
     * @param agentId ERC-8004 agent ID for identity verification
     */
    function registerWithAgent(string calldata name, string calldata endpoint, bytes32 attestationHash, uint256 agentId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (agentToProvider[agentId] != address(0)) revert AgentAlreadyLinked();

        _registerInternal(name, endpoint, attestationHash, agentId);
        agentToProvider[agentId] = msg.sender;
    }

    /**
     * @dev Internal registration logic
     */
    function _registerInternal(string calldata name, string calldata endpoint, bytes32 attestationHash, uint256 agentId)
        internal
    {
        if (providers[msg.sender].registeredAt != 0) revert ProviderAlreadyRegistered();
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (msg.value < minProviderStake) revert InsufficientStake(msg.value, minProviderStake);

        providers[msg.sender] = Provider({
            owner: msg.sender,
            name: name,
            endpoint: endpoint,
            attestationHash: attestationHash,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            active: true
        });

        providerList.push(msg.sender);

        emit ProviderRegistered(msg.sender, name, endpoint, attestationHash, msg.value, agentId);
    }

    // ============ Provider Management ============

    /**
     * @notice Update provider endpoint and attestation
     * @param endpoint New API endpoint URL
     * @param attestationHash New attestation hash (or 0x0 to keep current)
     */
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

    /**
     * @notice Deactivate provider (can reactivate later)
     */
    function deactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();

        provider.active = false;
        emit ProviderDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate a deactivated provider
     */
    function reactivate() external {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();
        if (provider.active) revert ProviderStillActive();
        if (provider.stake < minProviderStake) revert InsufficientStake(provider.stake, minProviderStake);

        provider.active = true;
        emit ProviderReactivated(msg.sender);
    }

    // ============ Staking ============

    /**
     * @notice Add more stake to provider
     */
    function addStake() external payable nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        provider.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, provider.stake);
    }

    /**
     * @notice Withdraw stake (provider must be deactivated and stake above minimum)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        Provider storage provider = providers[msg.sender];
        if (provider.registeredAt == 0) revert ProviderNotRegistered();

        // If active, must maintain minimum stake
        if (provider.active && provider.stake - amount < minProviderStake) {
            revert WithdrawalWouldBreachMinimum();
        }

        provider.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Capabilities ============

    /**
     * @notice Add a model capability
     * @param model Model identifier (e.g., "llama-3.1-8b")
     * @param pricePerInputToken Price per input token in wei
     * @param pricePerOutputToken Price per output token in wei
     * @param maxContextLength Maximum context length supported
     */
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

    /**
     * @notice Update capability active status
     * @param index Capability index
     * @param active New active status
     */
    function setCapabilityActive(uint256 index, bool active) external {
        if (index >= _capabilities[msg.sender].length) revert InvalidCapabilityIndex();
        _capabilities[msg.sender][index].active = active;
        emit CapabilityUpdated(msg.sender, index, active);
    }

    // ============ View Functions ============

    /**
     * @notice Get provider info
     */
    function getProvider(address addr) external view returns (Provider memory) {
        return providers[addr];
    }

    /**
     * @notice Get provider capabilities
     */
    function getCapabilities(address addr) external view returns (Capability[] memory) {
        return _capabilities[addr];
    }

    /**
     * @notice Check if provider is active
     */
    function isActive(address addr) external view returns (bool) {
        Provider storage provider = providers[addr];
        return provider.registeredAt != 0 && provider.active;
    }

    /**
     * @notice Get all active providers
     */
    function getActiveProviders() external view returns (address[] memory) {
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

    /**
     * @notice Get provider stake
     */
    function getProviderStake(address addr) external view returns (uint256) {
        return providers[addr].stake;
    }

    /**
     * @notice Get total provider count
     */
    function getProviderCount() external view returns (uint256) {
        return providerList.length;
    }

    /**
     * @notice Check if provider is a verified ERC-8004 agent
     */
    function isVerifiedAgent(address addr) external view returns (bool) {
        uint256 agentId = providers[addr].agentId;
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    /**
     * @notice Get provider by agent ID
     */
    function getProviderByAgent(uint256 agentId) external view returns (address) {
        return agentToProvider[agentId];
    }

    /**
     * @notice Get agent ID for a provider
     */
    function getProviderAgentId(address provider) external view returns (uint256) {
        return providers[provider].agentId;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update minimum provider stake
     */
    function setMinProviderStake(uint256 newMinStake) external onlyOwner {
        uint256 oldStake = minProviderStake;
        minProviderStake = newMinStake;
        emit MinStakeUpdated(oldStake, newMinStake);
    }

    /**
     * @notice Set the ERC-8004 Identity Registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Set whether agent registration is required
     */
    function setRequireAgentRegistration(bool required) external onlyOwner {
        requireAgentRegistration = required;
        emit AgentRegistrationRequirementUpdated(required);
    }

    /**
     * @notice Pause/unpause the registry
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
