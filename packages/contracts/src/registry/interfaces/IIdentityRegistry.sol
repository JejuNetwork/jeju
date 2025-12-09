// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

/**
 * @title IIdentityRegistry
 * @dev Interface for ERC-8004 v1.0 Identity Registry
 * @notice ERC-721 based agent registry with metadata storage
 *
 * This interface extends ERC-721 to provide agent registration functionality
 * with on-chain metadata storage. Each agent is represented as an NFT, making
 * agents immediately browsable and transferable with NFT-compliant applications.
 *
 * @author ChaosChain Labs
 */
interface IIdentityRegistry is IERC721, IERC721Metadata {
    // ============ Structs ============

    /**
     * @dev Metadata entry structure for batch metadata setting
     * @param key The metadata key
     * @param value The metadata value as bytes
     */
    struct MetadataEntry {
        string key;
        bytes value;
    }

    // ============ Events ============

    /**
     * @dev Emitted when a new agent is registered
     * @param agentId The newly assigned agent ID (tokenId)
     * @param tokenURI The URI pointing to the agent's registration file
     * @param owner The address that owns the agent NFT
     */
    event Registered(uint256 indexed agentId, string tokenURI, address indexed owner);

    /**
     * @dev Emitted when metadata is set for an agent
     * @param agentId The agent ID
     * @param indexedKey Indexed version of the key for filtering
     * @param key The metadata key
     * @param value The metadata value
     */
    event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value);

    // ============ Registration Functions ============

    /**
     * @notice Register a new agent with tokenURI and metadata
     * @param tokenURI_ The URI pointing to the agent's registration JSON file
     * @param metadata Array of metadata entries to set for the agent
     * @return agentId The newly assigned agent ID
     */
    function register(string calldata tokenURI_, MetadataEntry[] calldata metadata)
        external
        returns (uint256 agentId);

    /**
     * @notice Register a new agent with tokenURI only
     * @param tokenURI_ The URI pointing to the agent's registration JSON file
     * @return agentId The newly assigned agent ID
     */
    function register(string calldata tokenURI_) external returns (uint256 agentId);

    /**
     * @notice Register a new agent without tokenURI (can be set later)
     * @dev The tokenURI can be set later using _setTokenURI() by the owner
     * @return agentId The newly assigned agent ID
     */
    function register() external returns (uint256 agentId);

    // ============ Metadata Functions ============

    /**
     * @notice Set metadata for an agent
     * @dev Only the owner or approved operator can set metadata
     * @param agentId The agent ID
     * @param key The metadata key
     * @param value The metadata value as bytes
     */
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;

    /**
     * @notice Get metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @return value The metadata value as bytes
     */
    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory value);

    /**
     * @notice Set the token URI for an agent (ERC-8004 required function)
     * @dev Only the owner or approved operator can set the URI
     * @param agentId The agent ID
     * @param newTokenURI The new token URI pointing to registration file
     */
    function setAgentUri(uint256 agentId, string calldata newTokenURI) external;

    // ============ View Functions ============

    /**
     * @notice Get the total number of registered agents
     * @return count The total number of agents
     */
    function totalAgents() external view returns (uint256 count);

    /**
     * @notice Check if an agent exists
     * @param agentId The agent ID to check
     * @return exists True if the agent exists
     */
    function agentExists(uint256 agentId) external view returns (bool exists);

    // ============ Tag Functions ============

    /**
     * @notice Update tags for an agent (for discovery)
     * @dev Only the owner or approved operator can update tags
     * @param agentId The agent ID
     * @param tags_ Array of tag strings to set
     */
    function updateTags(uint256 agentId, string[] calldata tags_) external;

    /**
     * @notice Get all agents with a specific tag
     * @param tag The tag to search for
     * @return agentIds Array of agent IDs with this tag
     */
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory agentIds);

    /**
     * @notice Get all tags for an agent
     * @param agentId The agent ID
     * @return tags Array of tag strings
     */
    function getAgentTags(uint256 agentId) external view returns (string[] memory tags);

    // ============ Marketplace Discovery Functions ============

    /**
     * @notice Set the A2A endpoint for an agent
     * @param agentId The agent ID
     * @param endpoint The A2A endpoint URL
     */
    function setA2AEndpoint(uint256 agentId, string calldata endpoint) external;

    /**
     * @notice Get the A2A endpoint for an agent
     * @param agentId The agent ID
     * @return endpoint The A2A endpoint URL
     */
    function getA2AEndpoint(uint256 agentId) external view returns (string memory endpoint);

    /**
     * @notice Set the MCP endpoint for an agent
     * @param agentId The agent ID
     * @param endpoint The MCP endpoint URL
     */
    function setMCPEndpoint(uint256 agentId, string calldata endpoint) external;

    /**
     * @notice Get the MCP endpoint for an agent
     * @param agentId The agent ID
     * @return endpoint The MCP endpoint URL
     */
    function getMCPEndpoint(uint256 agentId) external view returns (string memory endpoint);

    /**
     * @notice Set both endpoints at once
     * @param agentId The agent ID
     * @param a2aEndpoint The A2A endpoint URL
     * @param mcpEndpoint The MCP endpoint URL
     */
    function setEndpoints(uint256 agentId, string calldata a2aEndpoint, string calldata mcpEndpoint) external;

    /**
     * @notice Set the service type (agent, mcp, app)
     * @param agentId The agent ID
     * @param serviceType The service type string
     */
    function setServiceType(uint256 agentId, string calldata serviceType) external;

    /**
     * @notice Get the service type for an agent
     * @param agentId The agent ID
     * @return serviceType The service type (agent, mcp, app)
     */
    function getServiceType(uint256 agentId) external view returns (string memory serviceType);

    /**
     * @notice Set the category for an agent
     * @param agentId The agent ID
     * @param category The category string
     */
    function setCategory(uint256 agentId, string calldata category) external;

    /**
     * @notice Get the category for an agent
     * @param agentId The agent ID
     * @return category The category string
     */
    function getCategory(uint256 agentId) external view returns (string memory category);

    /**
     * @notice Set x402 support status
     * @param agentId The agent ID
     * @param supported Whether x402 is supported
     */
    function setX402Support(uint256 agentId, bool supported) external;

    /**
     * @notice Get x402 support status
     * @param agentId The agent ID
     * @return supported Whether x402 is supported
     */
    function getX402Support(uint256 agentId) external view returns (bool supported);

}
