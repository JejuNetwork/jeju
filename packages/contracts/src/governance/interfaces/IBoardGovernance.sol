// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IBoardGovernance
 * @notice Interface for Jeju Autocrat Board governance
 * @dev Used by governed contracts to verify proposal approval
 */
interface IBoardGovernance {
    enum ProposalStatus {
        SUBMITTED,
        AUTOCRAT_REVIEW,
        RESEARCH_PENDING,
        AUTOCRAT_FINAL,
        DIRECTOR_QUEUE,
        APPROVED,
        EXECUTING,
        COMPLETED,
        REJECTED,
        VETOED,
        DUPLICATE,
        SPAM
    }

    enum VoteChoice {
        APPROVE,
        REJECT,
        ABSTAIN
    }

    struct Vote {
        uint256 agentId;
        VoteChoice vote;
        bytes32 reasoningHash; // IPFS hash of full reasoning
        uint256 votedAt;
    }

    struct Proposal {
        bytes32 proposalId;
        address proposer;
        uint256 proposerAgentId;
        uint8 proposalType;
        ProposalStatus status;
        uint8 qualityScore;
        uint256 createdAt;
        uint256 autocratVoteEnd;
        uint256 gracePeriodEnd;
        bytes32 contentHash;
        address targetContract;
        bytes callData;
        uint256 value;
        uint256 totalStaked;
        uint256 totalReputation;
        uint256 backerCount;
        bool hasResearch;
        bytes32 researchHash;
        bool directorApproved;
        bytes32 directorDecisionHash;
        bool directorDecided; // Immutable once set
    }

    // Write functions
    function submitProposal(
        bytes32 daoId,
        uint8 proposalType,
        bytes32 contentHash,
        address targetContract,
        bytes calldata callData,
        uint256 value
    ) external returns (bytes32 proposalId);

    function updateProposalStatus(bytes32 proposalId, ProposalStatus status) external;
    function setDirectorApproval(bytes32 proposalId, bool approved, bytes32 decisionHash) external;

    // Board voting functions
    function castVote(bytes32 proposalId, uint256 agentId, VoteChoice vote, bytes32 reasoningHash) external;
    function getVotes(bytes32 proposalId) external view returns (Vote[] memory);
    function getVote(bytes32 proposalId, uint256 agentId) external view returns (Vote memory);
    function hasVoted(bytes32 proposalId, uint256 agentId) external view returns (bool);
    function getVoteCounts(bytes32 proposalId) external view returns (uint256 approvals, uint256 rejections, uint256 abstentions);

    // Read functions
    function isProposalApproved(bytes32 proposalId) external view returns (bool);
    function isGracePeriodComplete(bytes32 proposalId) external view returns (bool);
    function isDirectorDecided(bytes32 proposalId) external view returns (bool);
    function getProposal(bytes32 proposalId) external view returns (Proposal memory);
    function getProposalsByDAO(bytes32 daoId) external view returns (bytes32[] memory);

    // Lifecycle functions
    function markExecuting(bytes32 proposalId) external;
    function markCompleted(bytes32 proposalId) external;
    function markFailed(bytes32 proposalId, string calldata reason) external;

    // Events
    event ProposalSubmitted(
        bytes32 indexed daoId,
        bytes32 indexed proposalId,
        address indexed proposer,
        uint8 proposalType,
        bytes32 contentHash
    );
    event ProposalStatusChanged(bytes32 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event DirectorDecision(bytes32 indexed proposalId, bool approved, bytes32 decisionHash, uint256 decidedAt);
    event VoteCast(bytes32 indexed proposalId, uint256 indexed agentId, VoteChoice vote, bytes32 reasoningHash);
}
