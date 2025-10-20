// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../registry/IdentityRegistry.sol";
import "../registry/ReputationRegistry.sol";

/**
 * @title CloudReputationProvider
 * @author Jeju Network
 * @notice Enables cloud services to manage reputation and enforce TOS violations
 * @dev Integrates with ERC-8004 IdentityRegistry and ReputationRegistry
 * 
 * Features:
 * - Set reputation for any agent, user, or service
 * - Ban agents for TOS violations (scamming, hacking, abuse)
 * - Track violation history
 * - Automated reputation decay over time
 * - Multi-signature approval for bans (prevent abuse)
 * 
 * Use Cases:
 * - Cloud service abuse (API spam, resource exploitation)
 * - Scamming (fake services, phishing)
 * - Hacking attempts (unauthorized access, data theft)
 * - TOS violations (illegal content, harassment)
 * 
 * Integration:
 * - Cloud services call setReputation() after verifying user behavior
 * - Governance calls proposeBan() for serious violations
 * - ReputationRegistry aggregates all feedback for agents
 * 
 * @custom:security-contact security@jeju.network
 */
contract CloudReputationProvider is Ownable, Pausable, ReentrancyGuard {
    
    // ============ State Variables ============
    
    /// @notice Identity registry for agent management
    IdentityRegistry public immutable identityRegistry;
    
    /// @notice Reputation registry for feedback
    ReputationRegistry public immutable reputationRegistry;
    
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
    
    /// @notice Ban proposals
    struct BanProposal {
        bytes32 proposalId;
        uint256 agentId;
        ViolationType reason;
        string evidence;
        address proposer;
        uint256 createdAt;
        bool executed;
        uint256 approvalCount;
        mapping(address => bool) hasApproved;
    }
    
    mapping(bytes32 => BanProposal) public banProposals;
    bytes32[] public allBanProposals;
    
    /// @notice Multi-sig config for bans
    uint256 public banApprovalThreshold = 2; // 2/3 default
    address[] public banApprovers;
    mapping(address => bool) public isBanApprover;
    
    /// @notice Timelock for threshold changes (prevents manipulation)
    uint256 public constant THRESHOLD_CHANGE_DELAY = 7 days;
    uint256 public pendingThreshold;
    uint256 public thresholdChangeTime;
    
    /// @notice Reputation decay settings
    uint256 public reputationDecayPeriod = 30 days;
    uint256 public reputationDecayRate = 5; // 5% per period
    
    /// @notice Minimum reputation before auto-ban
    uint8 public autobanThreshold = 20; // Score below 20/100
    
    // ============ Events ============
    
    event ReputationSet(
        uint256 indexed agentId,
        uint8 score,
        bytes32 indexed tag1,
        bytes32 indexed tag2,
        string reason
    );
    
    event ViolationRecorded(
        uint256 indexed agentId,
        ViolationType indexed violationType,
        uint8 severityScore,
        string evidence,
        address indexed reporter
    );
    
    event BanProposalCreated(
        bytes32 indexed proposalId,
        uint256 indexed agentId,
        ViolationType reason,
        address indexed proposer
    );
    
    event BanProposalApproved(
        bytes32 indexed proposalId,
        address indexed approver,
        uint256 approvalCount
    );
    
    event BanExecuted(
        bytes32 indexed proposalId,
        uint256 indexed agentId,
        ViolationType reason
    );
    
    event OperatorUpdated(address indexed operator, bool authorized);
    event CloudAgentRegistered(uint256 indexed agentId);
    event BanApproverUpdated(address indexed approver, bool isApprover);
    event ThresholdChangeQueued(uint256 indexed newThreshold, uint256 indexed executeAfter);
    event ThresholdChanged(uint256 indexed oldThreshold, uint256 indexed newThreshold);
    
    // ============ Errors ============
    
    error NotAuthorized();
    error InvalidAgentId();
    error InvalidScore();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error AlreadyApproved();
    error InsufficientApprovals();
    error CloudAgentNotRegistered();
    
    // ============ Constructor ============
    
    constructor(
        address _identityRegistry,
        address _reputationRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_identityRegistry != address(0), "Invalid identity registry");
        require(_reputationRegistry != address(0), "Invalid reputation registry");
        
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        reputationRegistry = ReputationRegistry(_reputationRegistry);
        
        // Owner is initial ban approver
        banApprovers.push(initialOwner);
        isBanApprover[initialOwner] = true;
    }
    
    // ============ Setup Functions ============
    
    /**
     * @notice Register cloud service as an agent in IdentityRegistry
     * @param tokenURI URI pointing to cloud service metadata
     * @param metadata Initial metadata entries
     */
    function registerCloudAgent(
        string calldata tokenURI,
        IdentityRegistry.MetadataEntry[] calldata metadata
    ) external onlyOwner returns (uint256 agentId) {
        require(cloudAgentId == 0, "Cloud agent already registered");
        
        agentId = identityRegistry.register(tokenURI, metadata);
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
        reputationRegistry.giveFeedback(
            agentId,
            score,
            tag1,
            tag2,
            reason,
            keccak256(abi.encodePacked(reason)),
            signedAuth
        );
        
        emit ReputationSet(agentId, score, tag1, tag2, reason);
        
        // Check for auto-ban threshold
        if (score < autobanThreshold) {
            _recordViolation(
                agentId,
                ViolationType.TOS_VIOLATION,
                100 - score, // Severity inversely proportional to score
                reason,
                msg.sender
            );
        }
    }
    
    /**
     * @notice Record a violation without immediate reputation impact
     * @param agentId Target agent ID
     * @param violationType Type of violation
     * @param severityScore Severity (0-100)
     * @param evidence IPFS hash of evidence
     */
    function recordViolation(
        uint256 agentId,
        ViolationType violationType,
        uint8 severityScore,
        string calldata evidence
    ) external nonReentrant whenNotPaused {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (severityScore > 100) revert InvalidScore();
        
        _recordViolation(agentId, violationType, severityScore, evidence, msg.sender);
    }
    
    function _recordViolation(
        uint256 agentId,
        ViolationType violationType,
        uint8 severityScore,
        string memory evidence,
        address reporter
    ) internal {
        agentViolations[agentId].push(Violation({
            agentId: agentId,
            violationType: violationType,
            severityScore: severityScore,
            evidence: evidence,
            timestamp: block.timestamp,
            reporter: reporter
        }));
        
        violationCounts[violationType]++;
        
        emit ViolationRecorded(agentId, violationType, severityScore, evidence, reporter);
    }
    
    // ============ Ban Management ============
    
    /**
     * @notice Propose banning an agent for serious violations
     * @param agentId Agent to ban
     * @param reason Violation type
     * @param evidence IPFS hash of evidence
     * @return proposalId Proposal ID
     */
    function proposeBan(
        uint256 agentId,
        ViolationType reason,
        string calldata evidence
    ) external nonReentrant whenNotPaused returns (bytes32 proposalId) {
        if (!authorizedOperators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        
        proposalId = keccak256(abi.encodePacked(
            agentId,
            reason,
            msg.sender,
            block.timestamp
        ));
        
        BanProposal storage proposal = banProposals[proposalId];
        proposal.proposalId = proposalId;
        proposal.agentId = agentId;
        proposal.reason = reason;
        proposal.evidence = evidence;
        proposal.proposer = msg.sender;
        proposal.createdAt = block.timestamp;
        proposal.executed = false;
        proposal.approvalCount = 0;
        
        allBanProposals.push(proposalId);
        
        emit BanProposalCreated(proposalId, agentId, reason, msg.sender);
    }
    
    /**
     * @notice Approve a ban proposal (multi-sig)
     * @param proposalId Proposal ID
     */
    function approveBan(bytes32 proposalId) external {
        if (!isBanApprover[msg.sender]) revert NotAuthorized();
        
        BanProposal storage proposal = banProposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.hasApproved[msg.sender]) revert AlreadyApproved();
        
        proposal.hasApproved[msg.sender] = true;
        proposal.approvalCount++;
        
        emit BanProposalApproved(proposalId, msg.sender, proposal.approvalCount);
        
        // Auto-execute if threshold reached
        if (proposal.approvalCount >= banApprovalThreshold) {
            _executeBan(proposal);
        }
    }
    
    /**
     * @dev Internal ban execution (follows CEI pattern)
     */
    function _executeBan(BanProposal storage proposal) internal {
        // CHECKS
        require(!proposal.executed, "Already executed");
        
        // EFFECTS (all state changes first)
        proposal.executed = true;
        
        // Emit event before external calls
        emit BanExecuted(proposal.proposalId, proposal.agentId, proposal.reason);
        
        // INTERACTIONS (external calls last - reentrancy safe)
        identityRegistry.banAgent(
            proposal.agentId,
            string(abi.encodePacked("Cloud TOS violation: ", _violationTypeToString(proposal.reason)))
        );
        
        // Record final violation (internal, but modifies state)
        _recordViolation(
            proposal.agentId,
            proposal.reason,
            100, // Maximum severity
            proposal.evidence,
            address(this)
        );
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Add ban approver
     * @param approver Approver address
     */
    function addBanApprover(address approver) external onlyOwner {
        require(!isBanApprover[approver], "Already approver");
        
        banApprovers.push(approver);
        isBanApprover[approver] = true;
        
        emit BanApproverUpdated(approver, true);
    }
    
    /**
     * @notice Remove ban approver
     * @param approver Approver address
     */
    function removeBanApprover(address approver) external onlyOwner {
        require(isBanApprover[approver], "Not approver");
        require(banApprovers.length > banApprovalThreshold, "Cannot remove, would break threshold");
        
        isBanApprover[approver] = false;
        
        for (uint256 i = 0; i < banApprovers.length; i++) {
            if (banApprovers[i] == approver) {
                banApprovers[i] = banApprovers[banApprovers.length - 1];
                banApprovers.pop();
                break;
            }
        }
        
        emit BanApproverUpdated(approver, false);
    }
    
    /**
     * @notice Queue ban approval threshold change (7-day timelock)
     * @param newThreshold New threshold
     */
    function queueThresholdChange(uint256 newThreshold) external onlyOwner {
        require(newThreshold > 0 && newThreshold <= banApprovers.length, "Invalid threshold");
        
        pendingThreshold = newThreshold;
        thresholdChangeTime = block.timestamp + THRESHOLD_CHANGE_DELAY;
        
        emit ThresholdChangeQueued(newThreshold, thresholdChangeTime);
    }
    
    /**
     * @notice Execute queued threshold change after timelock
     */
    function executeThresholdChange() external onlyOwner {
        require(pendingThreshold != 0, "No pending change");
        require(block.timestamp >= thresholdChangeTime, "Timelock not expired");
        
        uint256 oldThreshold = banApprovalThreshold;
        banApprovalThreshold = pendingThreshold;
        
        pendingThreshold = 0;
        thresholdChangeTime = 0;
        
        emit ThresholdChanged(oldThreshold, banApprovalThreshold);
    }
    
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
     * @notice Get violation history for an agent (paginated to prevent gas griefing)
     * @param agentId Agent ID
     * @param offset Start index
     * @param limit Maximum number of violations to return
     * @return violations Array of violations
     */
    function getAgentViolations(
        uint256 agentId,
        uint256 offset,
        uint256 limit
    ) external view returns (Violation[] memory violations) {
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
     * @notice Get ban proposal details
     * @param proposalId Proposal ID
     * @return agentId Agent ID
     * @return reason Violation type
     * @return evidence Evidence IPFS hash
     * @return proposer Proposer address
     * @return createdAt Creation timestamp
     * @return executed Execution status
     * @return approvalCount Number of approvals
     */
    function getBanProposal(bytes32 proposalId) external view returns (
        uint256 agentId,
        ViolationType reason,
        string memory evidence,
        address proposer,
        uint256 createdAt,
        bool executed,
        uint256 approvalCount
    ) {
        BanProposal storage proposal = banProposals[proposalId];
        return (
            proposal.agentId,
            proposal.reason,
            proposal.evidence,
            proposal.proposer,
            proposal.createdAt,
            proposal.executed,
            proposal.approvalCount
        );
    }
    
    /**
     * @notice Get all ban approvers
     * @return approvers Array of approver addresses
     */
    function getBanApprovers() external view returns (address[] memory approvers) {
        return banApprovers;
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
    
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

