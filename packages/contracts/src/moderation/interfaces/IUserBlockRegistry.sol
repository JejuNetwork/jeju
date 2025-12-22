// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IUserBlockRegistry
 * @notice Interface for the UserBlockRegistry contract
 * @dev Used by contracts to check if user-to-user blocks are in effect
 */
interface IUserBlockRegistry {
    // ============ Events ============

    event AddressBlocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AddressUnblocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AgentBlocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);
    event AgentUnblocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);

    // ============ Errors ============

    error AlreadyBlocked();
    error NotBlocked();
    error CannotBlockSelf();
    error InvalidAddress();
    error InvalidAgentId();
    error MaxBlocksReached();
    error NotAgentOwner();

    // ============ Block Management ============

    /**
     * @notice Block an address from interacting with you
     * @param toBlock Address to block
     */
    function blockAddress(address toBlock) external;

    /**
     * @notice Unblock an address
     * @param toUnblock Address to unblock
     */
    function unblockAddress(address toUnblock) external;

    /**
     * @notice Block multiple addresses at once
     * @param toBlock Array of addresses to block
     */
    function blockAddresses(address[] calldata toBlock) external;

    /**
     * @notice Block an agent from interacting with your agent
     * @param myAgentId Your agent ID
     * @param toBlockAgentId Agent ID to block
     */
    function blockAgent(uint256 myAgentId, uint256 toBlockAgentId) external;

    /**
     * @notice Unblock an agent
     * @param myAgentId Your agent ID
     * @param toUnblockAgentId Agent ID to unblock
     */
    function unblockAgent(uint256 myAgentId, uint256 toUnblockAgentId) external;

    // ============ View Functions ============

    /**
     * @notice Check if blocker has blocked the target address
     * @param blocker The potential blocker
     * @param target The potentially blocked address
     * @return isBlocked True if target is blocked by blocker
     */
    function isAddressBlocked(address blocker, address target) external view returns (bool);

    /**
     * @notice Check if blocker agent has blocked the target agent
     * @param blockerAgentId The potential blocker agent
     * @param targetAgentId The potentially blocked agent
     * @return isBlocked True if target is blocked by blocker
     */
    function isAgentBlocked(uint256 blockerAgentId, uint256 targetAgentId) external view returns (bool);

    /**
     * @notice Check if interaction from source to target is blocked (address-based)
     * @dev Returns true if target has blocked source
     * @param source The initiating address
     * @param target The receiving address
     * @return blocked True if the interaction should be blocked
     */
    function isInteractionBlocked(address source, address target) external view returns (bool);

    /**
     * @notice Check if interaction from source to target is blocked (agent-based)
     * @param sourceAgentId The initiating agent
     * @param targetAgentId The receiving agent
     * @return blocked True if the interaction should be blocked
     */
    function isAgentInteractionBlocked(uint256 sourceAgentId, uint256 targetAgentId) external view returns (bool);

    /**
     * @notice Check if any type of block is active
     * @param sourceAddress The initiating address
     * @param targetAddress The receiving address
     * @param sourceAgentId The initiating agent (0 if none)
     * @param targetAgentId The receiving agent (0 if none)
     * @return blocked True if any blocking relationship exists
     */
    function isAnyBlockActive(
        address sourceAddress,
        address targetAddress,
        uint256 sourceAgentId,
        uint256 targetAgentId
    ) external view returns (bool);

    /**
     * @notice Get all addresses blocked by a user
     * @param blocker The blocking address
     * @return blockedAddrs Array of blocked addresses
     */
    function getBlockedAddresses(address blocker) external view returns (address[] memory);

    /**
     * @notice Get all agents blocked by an agent
     * @param blockerAgentId The blocking agent ID
     * @return blockedAgentIds Array of blocked agent IDs
     */
    function getBlockedAgents(uint256 blockerAgentId) external view returns (uint256[] memory);

    /**
     * @notice Get number of blocks for an address
     * @param blocker Address to check
     * @return count Number of blocks
     */
    function blockCount(address blocker) external view returns (uint256);

    /**
     * @notice Get number of agent blocks
     * @param blockerAgentId Agent ID to check
     * @return count Number of blocks
     */
    function agentBlockCount(uint256 blockerAgentId) external view returns (uint256);
}

