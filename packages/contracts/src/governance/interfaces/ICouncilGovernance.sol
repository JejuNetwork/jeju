// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICouncilGovernance
 * @notice Interface for Jeju Autocrat Council governance
 * @dev Used by governed contracts to verify proposal approval
 */
interface ICouncilGovernance {
    enum ProposalStatus {
        SUBMITTED,
        AUTOCRAT_REVIEW,
        RESEARCH_PENDING,
        AUTOCRAT_FINAL,
        CEO_QUEUE,
        APPROVED,
        EXECUTING,
        COMPLETED,
        REJECTED,
        VETOED,
        DUPLICATE,
        SPAM
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
        bool ceoApproved;
        bytes32 ceoDecisionHash;
    }

    function isProposalApproved(bytes32 proposalId) external view returns (bool);
    function isGracePeriodComplete(bytes32 proposalId) external view returns (bool);
    function getProposal(bytes32 proposalId) external view returns (Proposal memory);
    function markExecuting(bytes32 proposalId) external;
    function markCompleted(bytes32 proposalId) external;
    function markFailed(bytes32 proposalId, string calldata reason) external;
}

