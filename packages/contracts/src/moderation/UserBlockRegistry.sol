// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title UserBlockRegistry
 * @author Jeju Network
 * @notice Allows users to block other users at the registry level
 * @dev This is distinct from governance/moderation bans - these are personal blocks
 *
 * When a user blocks another:
 * - The blocked user cannot send money to the blocker
 * - The blocked user cannot send messages to the blocker
 * - The blocked user cannot send invites to the blocker
 * - Applications should respect these blocks for any user-initiated interaction
 *
 * Blocks are directional: A blocking B doesn't mean B blocks A
 * Blocks can be applied by address or agentId (ERC-8004 identity)
 */
contract UserBlockRegistry is ReentrancyGuard {
    /// @notice Identity registry for agentId resolution
    IIdentityRegistry public identityRegistry;

    /// @notice Address-to-address blocks: blocker => blocked => isBlocked
    mapping(address => mapping(address => bool)) private _addressBlocks;

    /// @notice AgentId-to-agentId blocks: blockerAgentId => blockedAgentId => isBlocked
    mapping(uint256 => mapping(uint256 => bool)) private _agentBlocks;

    /// @notice Count of blocks per address (for enumeration)
    mapping(address => uint256) public blockCount;

    /// @notice Blocked addresses array for enumeration
    mapping(address => address[]) private _blockedAddresses;

    /// @notice Index in _blockedAddresses for O(1) removal
    mapping(address => mapping(address => uint256)) private _blockedAddressIndex;

    /// @notice Count of agent blocks per agentId
    mapping(uint256 => uint256) public agentBlockCount;

    /// @notice Blocked agentIds array for enumeration
    mapping(uint256 => uint256[]) private _blockedAgents;

    /// @notice Index in _blockedAgents for O(1) removal
    mapping(uint256 => mapping(uint256 => uint256)) private _blockedAgentIndex;

    /// @notice Maximum number of blocks per user
    uint256 public constant MAX_BLOCKS_PER_USER = 1000;

    // ============ Events ============

    event AddressBlocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AddressUnblocked(address indexed blocker, address indexed blocked, uint256 timestamp);
    event AgentBlocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);
    event AgentUnblocked(uint256 indexed blockerAgentId, uint256 indexed blockedAgentId, uint256 timestamp);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ============ Errors ============

    error AlreadyBlocked();
    error NotBlocked();
    error CannotBlockSelf();
    error InvalidAddress();
    error InvalidAgentId();
    error MaxBlocksReached();
    error NotAgentOwner();

    // ============ Constructor ============

    constructor(address _identityRegistry) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    // ============ Address Blocking Functions ============

    /**
     * @notice Block an address from interacting with you
     * @param toBlock Address to block
     */
    function blockAddress(address toBlock) external nonReentrant {
        if (toBlock == address(0)) revert InvalidAddress();
        if (toBlock == msg.sender) revert CannotBlockSelf();
        if (_addressBlocks[msg.sender][toBlock]) revert AlreadyBlocked();
        if (blockCount[msg.sender] >= MAX_BLOCKS_PER_USER) revert MaxBlocksReached();

        _addressBlocks[msg.sender][toBlock] = true;
        _blockedAddressIndex[msg.sender][toBlock] = _blockedAddresses[msg.sender].length;
        _blockedAddresses[msg.sender].push(toBlock);
        blockCount[msg.sender]++;

        emit AddressBlocked(msg.sender, toBlock, block.timestamp);
    }

    /**
     * @notice Unblock an address
     * @param toUnblock Address to unblock
     */
    function unblockAddress(address toUnblock) external nonReentrant {
        if (!_addressBlocks[msg.sender][toUnblock]) revert NotBlocked();

        _addressBlocks[msg.sender][toUnblock] = false;

        // Remove from array using swap-and-pop
        uint256 index = _blockedAddressIndex[msg.sender][toUnblock];
        uint256 lastIndex = _blockedAddresses[msg.sender].length - 1;

        if (index != lastIndex) {
            address lastBlocked = _blockedAddresses[msg.sender][lastIndex];
            _blockedAddresses[msg.sender][index] = lastBlocked;
            _blockedAddressIndex[msg.sender][lastBlocked] = index;
        }

        _blockedAddresses[msg.sender].pop();
        delete _blockedAddressIndex[msg.sender][toUnblock];
        blockCount[msg.sender]--;

        emit AddressUnblocked(msg.sender, toUnblock, block.timestamp);
    }

    /**
     * @notice Block multiple addresses at once
     * @param toBlock Array of addresses to block
     */
    function blockAddresses(address[] calldata toBlock) external nonReentrant {
        uint256 len = toBlock.length;
        if (blockCount[msg.sender] + len > MAX_BLOCKS_PER_USER) revert MaxBlocksReached();

        for (uint256 i = 0; i < len; i++) {
            address addr = toBlock[i];
            if (addr == address(0)) revert InvalidAddress();
            if (addr == msg.sender) revert CannotBlockSelf();
            if (_addressBlocks[msg.sender][addr]) continue; // Skip already blocked

            _addressBlocks[msg.sender][addr] = true;
            _blockedAddressIndex[msg.sender][addr] = _blockedAddresses[msg.sender].length;
            _blockedAddresses[msg.sender].push(addr);
            blockCount[msg.sender]++;

            emit AddressBlocked(msg.sender, addr, block.timestamp);
        }
    }

    // ============ Agent (ERC-8004) Blocking Functions ============

    /**
     * @notice Block an agent from interacting with your agent
     * @param myAgentId Your agent ID
     * @param toBlockAgentId Agent ID to block
     */
    function blockAgent(uint256 myAgentId, uint256 toBlockAgentId) external nonReentrant {
        if (myAgentId == 0 || toBlockAgentId == 0) revert InvalidAgentId();
        if (myAgentId == toBlockAgentId) revert CannotBlockSelf();

        // Verify caller owns the blocking agent
        if (address(identityRegistry) != address(0)) {
            address owner = identityRegistry.ownerOf(myAgentId);
            if (owner != msg.sender) revert NotAgentOwner();
        }

        if (_agentBlocks[myAgentId][toBlockAgentId]) revert AlreadyBlocked();
        if (agentBlockCount[myAgentId] >= MAX_BLOCKS_PER_USER) revert MaxBlocksReached();

        _agentBlocks[myAgentId][toBlockAgentId] = true;
        _blockedAgentIndex[myAgentId][toBlockAgentId] = _blockedAgents[myAgentId].length;
        _blockedAgents[myAgentId].push(toBlockAgentId);
        agentBlockCount[myAgentId]++;

        emit AgentBlocked(myAgentId, toBlockAgentId, block.timestamp);
    }

    /**
     * @notice Unblock an agent
     * @param myAgentId Your agent ID
     * @param toUnblockAgentId Agent ID to unblock
     */
    function unblockAgent(uint256 myAgentId, uint256 toUnblockAgentId) external nonReentrant {
        // Verify caller owns the agent
        if (address(identityRegistry) != address(0)) {
            address owner = identityRegistry.ownerOf(myAgentId);
            if (owner != msg.sender) revert NotAgentOwner();
        }

        if (!_agentBlocks[myAgentId][toUnblockAgentId]) revert NotBlocked();

        _agentBlocks[myAgentId][toUnblockAgentId] = false;

        // Remove from array using swap-and-pop
        uint256 index = _blockedAgentIndex[myAgentId][toUnblockAgentId];
        uint256 lastIndex = _blockedAgents[myAgentId].length - 1;

        if (index != lastIndex) {
            uint256 lastBlocked = _blockedAgents[myAgentId][lastIndex];
            _blockedAgents[myAgentId][index] = lastBlocked;
            _blockedAgentIndex[myAgentId][lastBlocked] = index;
        }

        _blockedAgents[myAgentId].pop();
        delete _blockedAgentIndex[myAgentId][toUnblockAgentId];
        agentBlockCount[myAgentId]--;

        emit AgentUnblocked(myAgentId, toUnblockAgentId, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @notice Check if blocker has blocked the target address
     * @param blocker The potential blocker
     * @param target The potentially blocked address
     * @return isBlocked True if target is blocked by blocker
     */
    function isAddressBlocked(address blocker, address target) external view returns (bool) {
        return _addressBlocks[blocker][target];
    }

    /**
     * @notice Check if blocker agent has blocked the target agent
     * @param blockerAgentId The potential blocker agent
     * @param targetAgentId The potentially blocked agent
     * @return isBlocked True if target is blocked by blocker
     */
    function isAgentBlocked(uint256 blockerAgentId, uint256 targetAgentId) external view returns (bool) {
        return _agentBlocks[blockerAgentId][targetAgentId];
    }

    /**
     * @notice Check if interaction from source to target is blocked (address-based)
     * @dev Returns true if target has blocked source (prevents source from interacting with target)
     * @param source The initiating address
     * @param target The receiving address
     * @return blocked True if the interaction should be blocked
     */
    function isInteractionBlocked(address source, address target) external view returns (bool) {
        return _addressBlocks[target][source];
    }

    /**
     * @notice Check if interaction from source to target is blocked (agent-based)
     * @dev Returns true if target agent has blocked source agent
     * @param sourceAgentId The initiating agent
     * @param targetAgentId The receiving agent
     * @return blocked True if the interaction should be blocked
     */
    function isAgentInteractionBlocked(uint256 sourceAgentId, uint256 targetAgentId) external view returns (bool) {
        return _agentBlocks[targetAgentId][sourceAgentId];
    }

    /**
     * @notice Check if interaction is blocked (either direction, either type)
     * @dev Comprehensive check for any type of block
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
    ) external view returns (bool) {
        // Check if target has blocked source (address-based)
        if (_addressBlocks[targetAddress][sourceAddress]) return true;

        // Check agent-based blocks if agentIds provided
        if (targetAgentId != 0 && sourceAgentId != 0) {
            if (_agentBlocks[targetAgentId][sourceAgentId]) return true;
        }

        // If we have identityRegistry, check cross-referenced blocks
        if (address(identityRegistry) != address(0)) {
            // If source has an agent, check if target blocked that agent
            if (sourceAgentId != 0 && targetAgentId != 0) {
                if (_agentBlocks[targetAgentId][sourceAgentId]) return true;
            }
        }

        return false;
    }

    /**
     * @notice Get all addresses blocked by a user
     * @param blocker The blocking address
     * @return blockedAddrs Array of blocked addresses
     */
    function getBlockedAddresses(address blocker) external view returns (address[] memory) {
        return _blockedAddresses[blocker];
    }

    /**
     * @notice Get all agents blocked by an agent
     * @param blockerAgentId The blocking agent ID
     * @return blockedAgentIds Array of blocked agent IDs
     */
    function getBlockedAgents(uint256 blockerAgentId) external view returns (uint256[] memory) {
        return _blockedAgents[blockerAgentId];
    }

    /**
     * @notice Get blocked addresses with pagination
     * @param blocker The blocking address
     * @param offset Start index
     * @param limit Maximum number to return
     * @return blockedAddrs Array of blocked addresses
     */
    function getBlockedAddressesPaginated(address blocker, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        uint256 total = _blockedAddresses[blocker].length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = _blockedAddresses[blocker][offset + i];
        }
        return result;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update identity registry address
     * @dev Only callable by governance (no owner for permissionless design)
     * @param _identityRegistry New registry address
     */
    function setIdentityRegistry(address _identityRegistry) external {
        // Only allow setting if currently zero (initialization)
        // or by governance mechanism (to be integrated later)
        require(
            address(identityRegistry) == address(0) || msg.sender == address(identityRegistry), "Only identity registry"
        );
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
