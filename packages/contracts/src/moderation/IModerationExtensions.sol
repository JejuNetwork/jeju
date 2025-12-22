// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IModerationExtensions
 * @notice Interfaces for moderation extension contracts
 */

/**
 * @title ICommitRevealVoting
 * @notice Interface for commit-reveal voting extension
 */
interface ICommitRevealVoting {
    function initializeCase(
        bytes32 caseId,
        uint256 commitDuration,
        uint256 revealDuration
    ) external;
    
    function commitVote(
        bytes32 caseId,
        bytes32 commitHash,
        uint256 stakeAmount
    ) external payable;
    
    function revealVote(
        bytes32 caseId,
        uint8 position,
        bytes32 salt
    ) external;
    
    function resolveCase(bytes32 caseId) external returns (
        uint8 outcome,
        uint256 yesVotes,
        uint256 noVotes
    );
    
    function isCommitPhase(bytes32 caseId) external view returns (bool);
    function isRevealPhase(bytes32 caseId) external view returns (bool);
    function getCaseVotes(bytes32 caseId) external view returns (
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalCommitted,
        uint256 totalRevealed
    );
}

/**
 * @title IVoterSlashing
 * @notice Interface for voter slashing extension
 */
interface IVoterSlashing {
    function recordVoteOutcome(
        address voter,
        bytes32 caseId,
        bool won,
        uint256 stakeAmount
    ) external returns (uint256 slashAmount);
    
    function isVotingBanned(address voter) external view returns (bool);
    function getVoterRecord(address voter) external view returns (
        uint256 totalVotes,
        uint256 winningVotes,
        uint256 losingVotes,
        uint256 consecutiveLosses,
        uint256 penaltyTier,
        bool votingBanned
    );
    
    function getSlashAmount(
        address voter,
        uint256 stakeAmount
    ) external view returns (uint256);
}

/**
 * @title IMultiOracleReputation
 * @notice Interface for multi-oracle reputation aggregation
 */
interface IMultiOracleReputation {
    function getAggregatedReputation(address user) external view returns (
        uint256 aggregatedScore,
        uint256 lastUpdated,
        uint256 oracleCount,
        uint256 confidence,
        bool isValid
    );
    
    function updateReputation(address user) external returns (uint256 score);
    
    function getReputationTier(address user) external view returns (uint8);
    
    function isReputationValid(address user) external view returns (bool);
}

/**
 * @title ICrossChainArbitration  
 * @notice Interface for cross-chain arbitration
 */
interface ICrossChainArbitration {
    function escalateCase(
        bytes32 caseId,
        address target,
        address reporter,
        string calldata reason
    ) external payable returns (bytes32 crossChainCaseId);
    
    function submitCrossChainVote(
        bytes32 caseId,
        uint8 position,
        uint256 weight
    ) external;
    
    function isCaseEscalated(bytes32 caseId) external view returns (bool);
    
    function getCrossChainVotes(bytes32 caseId) external view returns (
        uint256 totalYes,
        uint256 totalNo,
        uint32[] memory participatingChains
    );
}

