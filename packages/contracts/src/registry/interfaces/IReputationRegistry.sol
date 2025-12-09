// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

/**
 * @title IReputationRegistry
 * @dev Interface for ERC-8004 v1.0 Reputation Registry
 * @notice On-chain feedback system with cryptographic authorization
 *
 * This interface provides a standard for posting and fetching feedback signals
 * with on-chain storage and aggregation capabilities. It uses cryptographic
 * signatures (EIP-191/ERC-1271) to authorize feedback submissions.
 *
 * @author ChaosChain Labs
 */
interface IReputationRegistry {
    // ============ Events ============

    /**
     * @dev Emitted when new feedback is given
     */
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint8 score,
        bytes32 indexed tag1,
        bytes32 tag2,
        string fileuri,
        bytes32 filehash
    );

    /**
     * @dev Emitted when feedback is revoked
     */
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    /**
     * @dev Emitted when a response is appended to feedback
     */
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseUri,
        bytes32 responseHash
    );

    // ============ Core Functions ============

    /**
     * @notice Give feedback for an agent
     * @param agentId The agent receiving feedback
     * @param score The feedback score (0-100)
     * @param tag1 First tag for categorization (optional)
     * @param tag2 Second tag for categorization (optional)
     * @param fileuri URI pointing to off-chain feedback data (optional)
     * @param filehash KECCAK-256 hash of the file content (optional for IPFS)
     * @param feedbackAuth Signed authorization from the agent
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash,
        bytes memory feedbackAuth
    ) external;

    /**
     * @notice Revoke previously given feedback
     * @param agentId The agent ID
     * @param feedbackIndex The feedback index to revoke
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    /**
     * @notice Append a response to feedback
     * @param agentId The agent ID
     * @param clientAddress The client who gave the feedback
     * @param feedbackIndex The feedback index
     * @param responseUri URI pointing to the response data
     * @param responseHash KECCAK-256 hash of response content (optional for IPFS)
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseUri,
        bytes32 responseHash
    ) external;

    // ============ Read Functions ============

    /**
     * @notice Get aggregated summary for an agent
     * @param agentId The agent ID (mandatory)
     * @param clientAddresses Filter by specific clients (optional)
     * @param tag1 Filter by tag1 (optional, use bytes32(0) to skip)
     * @param tag2 Filter by tag2 (optional, use bytes32(0) to skip)
     * @return count Number of feedback entries
     * @return averageScore Average score (0-100)
     */
    function getSummary(uint256 agentId, address[] calldata clientAddresses, bytes32 tag1, bytes32 tag2)
        external
        view
        returns (uint64 count, uint8 averageScore);

    /**
     * @notice Read a specific feedback entry
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param index The feedback index
     * @return score The feedback score
     * @return tag1 First tag
     * @return tag2 Second tag
     * @return isRevoked Whether the feedback is revoked
     */
    function readFeedback(uint256 agentId, address clientAddress, uint64 index)
        external
        view
        returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked);

    /**
     * @notice Read all feedback for an agent
     * @param agentId The agent ID (mandatory)
     * @param clientAddresses Filter by clients (optional)
     * @param tag1 Filter by tag1 (optional)
     * @param tag2 Filter by tag2 (optional)
     * @param includeRevoked Whether to include revoked feedback
     * @return clients Array of client addresses
     * @return scores Array of scores
     * @return tag1s Array of tag1 values
     * @return tag2s Array of tag2 values
     * @return revokedStatuses Array of revoked statuses
     */
    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        bytes32 tag1,
        bytes32 tag2,
        bool includeRevoked
    )
        external
        view
        returns (
            address[] memory clients,
            uint8[] memory scores,
            bytes32[] memory tag1s,
            bytes32[] memory tag2s,
            bool[] memory revokedStatuses
        );

    /**
     * @notice Get response count for a feedback entry
     * @param agentId The agent ID (mandatory)
     * @param clientAddress The client address (optional)
     * @param feedbackIndex The feedback index (optional)
     * @param responders Filter by responders (optional)
     * @return count Total response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count);

    /**
     * @notice Get all clients who gave feedback to an agent
     * @param agentId The agent ID
     * @return clientList Array of client addresses
     */
    function getClients(uint256 agentId) external view returns (address[] memory clientList);

    /**
     * @notice Get the last feedback index for a client-agent pair
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return lastIndex The last feedback index
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64 lastIndex);

    /**
     * @notice Get the identity registry address
     * @return registry The identity registry address
     */
    function getIdentityRegistry() external view returns (address registry);
}
