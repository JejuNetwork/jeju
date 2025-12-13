// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IReputationProvider
 * @notice Interface for reputation providers. Implemented by CloudReputationProvider.
 */
interface IReputationProvider {
    event ReputationSet(uint256 indexed agentId, uint8 score, bytes32 indexed tag1, bytes32 indexed tag2, string reason);
    event ViolationRecorded(uint256 indexed agentId, uint8 violationType, uint8 severityScore, string evidence, address indexed reporter);
    event BanProposalRequested(uint256 indexed agentId, bytes32 indexed proposalId, uint8 reason);

    function setReputation(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata reason, bytes calldata signedAuth) external;
    function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string calldata evidence) external;
    function requestBanViaGovernance(uint256 agentId, uint8 reason) external payable returns (bytes32 proposalId);
    function getProviderAgentId() external view returns (uint256 agentId);
    function getAgentViolationCount(uint256 agentId) external view returns (uint256 count);
    function isAuthorizedOperator(address operator) external view returns (bool authorized);
    function version() external pure returns (string memory);
}
