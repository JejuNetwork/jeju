// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IReputationProvider
 * @author Jeju Network
 * @notice Interface for third-party reputation providers
 * @dev Vendor-specific reputation providers (e.g., cloud services, games) implement this interface.
 *      This allows the core Jeju system to interact with any reputation provider generically.
 *
 * Implementations:
 * - CloudReputationProvider (vendor/cloud) - Cloud service reputation management
 * - GameReputationProvider - Game-specific reputation tracking
 *
 * Integration:
 * - ReputationRegistry accepts feedback from any IReputationProvider
 * - RegistryGovernance handles ban proposals from any provider
 */
interface IReputationProvider {
    // ============ Events ============

    event ReputationSet(
        uint256 indexed agentId, uint8 score, bytes32 indexed tag1, bytes32 indexed tag2, string reason
    );

    event ViolationRecorded(
        uint256 indexed agentId, uint8 violationType, uint8 severityScore, string evidence, address indexed reporter
    );

    event BanProposalRequested(uint256 indexed agentId, bytes32 indexed proposalId, uint8 reason);

    // ============ Core Functions ============

    /**
     * @notice Set reputation for an agent
     * @param agentId Target agent ID in IdentityRegistry
     * @param score Reputation score (0-100)
     * @param tag1 Primary category tag (e.g., "quality", "reliability")
     * @param tag2 Secondary category tag
     * @param reason IPFS hash or description of reasoning
     * @param signedAuth Pre-signed authorization from the provider's agent
     */
    function setReputation(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata reason,
        bytes calldata signedAuth
    ) external;

    /**
     * @notice Record a violation without immediate reputation impact
     * @param agentId Target agent ID
     * @param violationType Type of violation (provider-specific enum)
     * @param severityScore Severity (0-100)
     * @param evidence IPFS hash of evidence
     */
    function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string calldata evidence)
        external;

    /**
     * @notice Request a ban proposal through governance
     * @param agentId Agent to ban
     * @param reason Violation type that triggered the request
     * @return proposalId The governance proposal ID
     */
    function requestBanViaGovernance(uint256 agentId, uint8 reason) external payable returns (bytes32 proposalId);

    // ============ View Functions ============

    /**
     * @notice Get the provider's registered agent ID
     * @return agentId Agent ID in IdentityRegistry
     */
    function getProviderAgentId() external view returns (uint256 agentId);

    /**
     * @notice Get violation count for an agent
     * @param agentId Agent ID
     * @return count Number of violations
     */
    function getAgentViolationCount(uint256 agentId) external view returns (uint256 count);

    /**
     * @notice Check if an operator is authorized
     * @param operator Address to check
     * @return authorized True if operator is authorized
     */
    function isAuthorizedOperator(address operator) external view returns (bool authorized);

    /**
     * @notice Get provider version
     * @return version string
     */
    function version() external pure returns (string memory);
}

/**
 * @title IReputationProviderRegistry
 * @notice Registry for tracking authorized reputation providers
 * @dev Core Jeju contracts use this to validate reputation provider calls
 */
interface IReputationProviderRegistry {
    /**
     * @notice Register a new reputation provider
     * @param provider Provider contract address
     * @param name Human-readable name
     */
    function registerProvider(address provider, string calldata name) external;

    /**
     * @notice Check if a provider is registered
     * @param provider Provider address
     * @return registered True if provider is registered and active
     */
    function isRegisteredProvider(address provider) external view returns (bool registered);

    /**
     * @notice Get all registered providers
     * @return providers Array of provider addresses
     */
    function getProviders() external view returns (address[] memory providers);
}
