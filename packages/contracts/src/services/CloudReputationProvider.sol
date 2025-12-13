// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @dev DEPRECATION NOTICE: This contract is vendor-specific and maintained in vendor/cloud/contracts/.
 *      This copy remains for backwards compatibility with existing deployments.
 *      For new deployments, use the contract from vendor/cloud/contracts/CloudReputationProvider.sol
 */
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../registry/IdentityRegistry.sol";
import "../registry/ReputationRegistry.sol";
import "../registry/RegistryGovernance.sol";
import "../interfaces/IReputationProvider.sol";

/**
 * @title CloudReputationProvider
 * @author Jeju Network
 * @notice Enables cloud services to manage reputation and report TOS violations
 * @dev Implements IReputationProvider interface for vendor-agnostic integration.
 *      Integrates with ERC-8004 registries and delegates banning to RegistryGovernance.
 *
 * NOTE: This contract is vendor-specific and should be deployed from vendor/cloud.
 *       The core Jeju system uses IReputationProvider interface for abstraction.
 *
 * @custom:deprecated Use vendor/cloud/contracts/CloudReputationProvider.sol for new deployments
 *
 * Features:
 * - Set reputation for any agent via ReputationRegistry
 * - Track violation history for evidence gathering
 * - Trigger ban proposals via RegistryGovernance (futarchy)
 * - Automated reputation decay over time
 *
 * Use Cases:
 * - Cloud service abuse (API spam, resource exploitation)
 * - Scamming (fake services, phishing)
 * - Hacking attempts (unauthorized access, data theft)
 * - TOS violations (illegal content, harassment)
 *
 * Integration:
 * - Cloud services call setReputation() after verifying user behavior
 * - For serious violations, calls requestBanViaGovernance()
 * - Delegates all ban decisions to RegistryGovernance futarchy
 *
 * @custom:security-contact security@jeju.network
 */
contract CloudReputationProvider is IReputationProvider, Ownable, Pausable, ReentrancyGuard {
    // ============ State Variables ============

    /// @notice Identity registry for agent management
    IdentityRegistry public immutable identityRegistry;

    /// @notice Reputation registry for feedback
    ReputationRegistry public immutable reputationRegistry;

    /// @notice Governance contract for ban proposals
    RegistryGovernance public immutable registryGovernance;

    /// @notice Cloud service agent ID (registered in IdentityRegistry)
    uint256 public cloudAgentId;

    /// @notice Authorized cloud service operators
    mapping(address => bool) public authorizedOperators;

    /// @notice Violation tracking
    struct Violation {
        uint256 agentId;
        ViolationType violationType;
        uint8 severityScore; // 0-100, higher = more severe
        string evidence; // IPFS hash
        uint256 timestamp;
        address reporter;
    }

    /// @notice Violation types
    enum ViolationType {
        API_ABUSE,
        RESOURCE_EXPLOITATION,
        SCAMMING,
        PHISHING,
        HACKING,
        UNAUTHORIZED_ACCESS,
        DATA_THEFT,
        ILLEGAL_CONTENT,
        HARASSMENT,
        SPAM,
        TOS_VIOLATION
    }

    /// @notice Violation history per agent
    mapping(uint256 => Violation[]) public agentViolations;

    /// @notice Total violations by type
    mapping(ViolationType => uint256) public violationCounts;

    /// @notice Ban requests via governance (tracks which agents we've requested bans for)
    mapping(uint256 => bytes32) public agentBanProposals;

    /// @notice Reputation decay settings
    uint256 public reputationDecayPeriod = 30 days;
    uint256 public reputationDecayRate = 5; // 5% per period

    /// @notice Minimum reputation before requesting ban
    uint8 public autobanThreshold = 20; // Score below 20/100

    // ============ Events ============
    // Note: ReputationSet, ViolationRecorded (with uint8), and BanProposalRequested (with uint8)
    // are inherited from IReputationProvider

    event ViolationRecorded(
        uint256 indexed agentId,
        ViolationType indexed violationType,
        uint8 severityScore,
        string evidence,
        address indexed reporter
    );

    event BanProposalRequested(uint256 indexed agentId, bytes32 indexed proposalId, ViolationType reason);

    event OperatorUpdated(address indexed operator, bool authorized);
    event CloudAgentRegistered(uint256 indexed agentId);

    // ============ Errors ============

    error NotAuthorized();
    error InvalidAgentId();
    error InvalidScore();
    error CloudAgentNotRegistered();
    error BanAlreadyProposed();
    error InsufficientBalance();
    error TransferFailed();

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _reputationRegistry,
        address payable _registryGovernance,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_identityRegistry != address(0), "Invalid identity registry");
        require(_reputationRegistry != address(0), "Invalid reputation registry");
        require(_registryGovernance != address(0), "Invalid governance");

        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        reputationRegistry = ReputationRegistry(_reputationRegistry);
        registryGovernance = RegistryGovernance(_registryGovernance);
    }

    // ============ Setup Functions ============

    /**
     * @notice Register cloud service as an agent in IdentityRegistry
     * @param tokenURI URI pointing to cloud service metadata
     * @param metadata Initial metadata entries
     * @custom:security Note: External call returns agentId which must be stored
     */
    function registerCloudAgent(string calldata tokenURI, IdentityRegistry.MetadataEntry[] calldata metadata)
        external
        onlyOwner
        returns (uint256 agentId)
    {
        require(cloudAgentId == 0, "Cloud agent already registered");

        // External call - agentId returned must be stored
        agentId = identityRegistry.register(tokenURI, metadata);

        // EFFECTS: Store agentId immediately after receiving it
        cloudAgentId = agentId;

        emit CloudAgentRegistered(agentId);
    }

    /**
     * @notice Set cloud agent ID (use if agent was registered externally)
     * @param agentId Agent ID of cloud service
     */
    function setCloudAgentId(uint256 agentId) external onlyOwner {
        require(cloudAgentId == 0, "Cloud agent already set");
        require(identityRegistry.agentExists(agentId), "Agent does not exist");

        cloudAgentId = agentId;
        emit CloudAgentRegistered(agentId);
    }

    /**
     * @notice Set authorized operator (cloud service backend)
     * @param operator Operator address
     * @param authorized Authorization status
     */
    function setAuthorizedOperator(address operator, bool authorized) external onlyOwner {
        authorizedOperators[operator] = authorized;
        emit OperatorUpdated(operator, authorized);
    }

    // ============ Reputation Management ============

    /**
     * @notice Set reputation for an agent based on cloud service interaction
     * @param agentId Target agent ID
     * @param score Reputation score (0-100)
     * @param tag1 Primary category (e.g., "quality", "reliability")
     * @param tag2 Secondary category (e.g., "api-usage", "payment")
     * @param reason IPFS hash of detailed reasoning
     * @param signedAuth Pre-signed feedback authorization from cloud agent's private key
     */
    function setReputation(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata reason,
        bytes calldata signedAuth
    ) external nonReentrant whenNotPaused {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (score > 100) revert InvalidScore();
        if (cloudAgentId == 0) revert CloudAgentNotRegistered();

        // SECURITY: Prevent cloud from setting its own reputation
        require(agentId != cloudAgentId, "Cannot set own reputation");

        // Submit reputation via ReputationRegistry with provided signature
        // slither-disable-next-line encode-packed-collision
        // @audit-ok Single dynamic type hashed - no collision risk
        reputationRegistry.giveFeedback(
            agentId, score, tag1, tag2, reason, keccak256(abi.encodePacked(reason)), signedAuth
        );

        emit ReputationSet(agentId, score, tag1, tag2, reason);

        // Check for auto-ban threshold and record violation (auth already checked)
        if (score < autobanThreshold) {
            _storeViolation(agentId, ViolationType.TOS_VIOLATION, 100 - score, reason);
        }
    }

    /**
     * @notice Record a violation with enum type (vendor-specific)
     */
    function recordViolationWithType(
        uint256 agentId,
        ViolationType violationType,
        uint8 severityScore,
        string calldata evidence
    ) external nonReentrant whenNotPaused {
        _validateAndRecordViolation(agentId, violationType, severityScore, evidence);
    }

    /**
     * @notice Record a violation (IReputationProvider interface)
     */
    function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string calldata evidence)
        external
        override
        nonReentrant
        whenNotPaused
    {
        _validateAndRecordViolation(agentId, ViolationType(violationType), severityScore, evidence);
    }

    function _validateAndRecordViolation(
        uint256 agentId,
        ViolationType violationType,
        uint8 severityScore,
        string calldata evidence
    ) internal {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (severityScore > 100) revert InvalidScore();
        _storeViolation(agentId, violationType, severityScore, evidence);
    }

    function _storeViolation(uint256 agentId, ViolationType violationType, uint8 severityScore, string memory evidence)
        internal
    {
        agentViolations[agentId].push(
            Violation({
                agentId: agentId,
                violationType: violationType,
                severityScore: severityScore,
                evidence: evidence,
                timestamp: block.timestamp,
                reporter: msg.sender
            })
        );
        violationCounts[violationType]++;
        emit ViolationRecorded(agentId, violationType, severityScore, evidence, msg.sender);
    }

    // ============ Ban Management (via RegistryGovernance) ============

    /**
     * @notice Request a ban proposal through RegistryGovernance futarchy system
     * @param agentId Agent to ban
     * @param reason Violation type that triggered the request
     * @return proposalId The governance proposal ID
     * @dev This initiates a futarchy vote, does NOT immediately ban
     */
    function _requestBanViaGovernance(uint256 agentId, ViolationType reason) internal returns (bytes32 proposalId) {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (agentBanProposals[agentId] != bytes32(0)) revert BanAlreadyProposed();

        // Create ban reason string
        // slither-disable-next-line encode-packed-collision
        // @audit-ok String concatenation for reason, not hashed
        string memory reasonString = string(abi.encodePacked("Cloud TOS violation: ", _violationTypeToString(reason)));

        // Create proposal via governance (forwards value as proposal bond)
        proposalId = registryGovernance.proposeBan{value: msg.value}(agentId, reasonString);

        // Track the proposal
        agentBanProposals[agentId] = proposalId;

        emit BanProposalRequested(agentId, proposalId, reason);
    }

    /**
     * @notice Request ban via governance with enum type (vendor-specific)
     * @param agentId Agent to ban
     * @param reason ViolationType enum
     * @return proposalId The governance proposal ID
     */
    function requestBanViaGovernanceWithType(uint256 agentId, ViolationType reason)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 proposalId)
    {
        return _requestBanViaGovernance(agentId, reason);
    }

    /**
     * @notice Request ban via governance (IReputationProvider interface)
     * @param agentId Agent to ban
     * @param reason Violation type as uint8
     * @return proposalId The governance proposal ID
     */
    function requestBanViaGovernance(uint256 agentId, uint8 reason)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (bytes32 proposalId)
    {
        return _requestBanViaGovernance(agentId, ViolationType(reason));
    }

    /**
     * @notice Request a slash proposal through RegistryGovernance
     * @param agentId Agent to slash
     * @param slashPercentageBPS Percentage to slash (10000 = 100%)
     * @param reason Violation type
     * @return proposalId The governance proposal ID
     */
    function requestSlashViaGovernance(uint256 agentId, uint256 slashPercentageBPS, ViolationType reason)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 proposalId)
    {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();

        // slither-disable-next-line encode-packed-collision
        // @audit-ok String concatenation for reason, not hashed
        string memory reasonString =
            string(abi.encodePacked("Cloud TOS violation (slash): ", _violationTypeToString(reason)));

        proposalId = registryGovernance.proposeSlash{value: msg.value}(agentId, slashPercentageBPS, reasonString);

        emit BanProposalRequested(agentId, proposalId, reason);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update auto-ban threshold
     * @param newThreshold New threshold (0-100)
     */
    function setAutobanThreshold(uint8 newThreshold) external onlyOwner {
        require(newThreshold <= 100, "Invalid threshold");
        autobanThreshold = newThreshold;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get violation history for an agent (paginated)
     * @param agentId Agent ID
     * @param offset Start index
     * @param limit Maximum violations to return
     * @return violations Array of violations
     */
    function getAgentViolations(uint256 agentId, uint256 offset, uint256 limit)
        external
        view
        returns (Violation[] memory violations)
    {
        uint256 total = agentViolations[agentId].length;

        if (offset >= total) {
            return new Violation[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 count = end - offset;
        violations = new Violation[](count);

        for (uint256 i = 0; i < count; i++) {
            violations[i] = agentViolations[agentId][offset + i];
        }
    }

    /**
     * @notice Get violation count for an agent
     * @param agentId Agent ID
     * @return count Number of violations
     */
    function getAgentViolationCount(uint256 agentId) external view returns (uint256 count) {
        return agentViolations[agentId].length;
    }

    /**
     * @notice Get the governance proposal ID for an agent ban request
     * @param agentId Agent ID
     * @return proposalId The proposal ID (bytes32(0) if none)
     */
    function getBanProposalId(uint256 agentId) external view returns (bytes32) {
        return agentBanProposals[agentId];
    }

    /**
     * @notice Emergency withdraw any ETH accidentally sent to this contract
     * @param amount Amount to withdraw
     */
    function withdrawETH(uint256 amount) external nonReentrant onlyOwner {
        if (amount > address(this).balance) revert InsufficientBalance();
        (bool success,) = payable(owner()).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============ Internal Helpers ============

    /**
     * @dev Convert violation type to string
     */
    function _violationTypeToString(ViolationType vType) internal pure returns (string memory) {
        if (vType == ViolationType.API_ABUSE) return "API_ABUSE";
        if (vType == ViolationType.RESOURCE_EXPLOITATION) return "RESOURCE_EXPLOITATION";
        if (vType == ViolationType.SCAMMING) return "SCAMMING";
        if (vType == ViolationType.PHISHING) return "PHISHING";
        if (vType == ViolationType.HACKING) return "HACKING";
        if (vType == ViolationType.UNAUTHORIZED_ACCESS) return "UNAUTHORIZED_ACCESS";
        if (vType == ViolationType.DATA_THEFT) return "DATA_THEFT";
        if (vType == ViolationType.ILLEGAL_CONTENT) return "ILLEGAL_CONTENT";
        if (vType == ViolationType.HARASSMENT) return "HARASSMENT";
        if (vType == ViolationType.SPAM) return "SPAM";
        return "TOS_VIOLATION";
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }

    // ============ IReputationProvider Interface Implementation ============

    /**
     * @notice Get the provider's registered agent ID (IReputationProvider)
     * @return agentId Agent ID in IdentityRegistry
     */
    function getProviderAgentId() external view override returns (uint256) {
        return cloudAgentId;
    }

    /**
     * @notice Check if an operator is authorized (IReputationProvider)
     * @param operator Address to check
     * @return authorized True if operator is authorized
     */
    function isAuthorizedOperator(address operator) external view override returns (bool) {
        return authorizedOperators[operator];
    }
}
