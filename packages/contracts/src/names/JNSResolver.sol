// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import {IJNS, IJNSResolver} from "./IJNS.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title JNSResolver
 * @author Jeju Network
 * @notice Public resolver for the Jeju Name Service with ERC-8004 integration
 * @dev Implements all standard resolver profiles plus app-specific extensions
 *
 * Resolver Profiles:
 * - Address Resolution: Map names to Ethereum addresses
 * - Content Hash: Point to IPFS/Swarm hosted content
 * - Text Records: Arbitrary key-value string storage
 * - App Records: Link names to Jeju apps and ERC-8004 agents
 * - Reverse Resolution: Map addresses back to names
 *
 * ERC-8004 Integration:
 * - Names can be linked to registered agents
 * - Agent metadata can reference JNS names
 * - Bidirectional resolution between names and agents
 *
 * Standard Text Keys:
 * - url: Website URL
 * - description: Human-readable description
 * - avatar: Avatar image URL
 * - com.github: GitHub username
 * - com.twitter: Twitter username
 * - app.endpoint: App API endpoint
 * - app.a2a: A2A endpoint for agent communication
 * - app.mcp: MCP endpoint
 *
 * @custom:security-contact security@jeju.network
 */
contract JNSResolver is IJNSResolver {
    // ============ Structs ============

    struct AppRecord {
        address appContract;
        bytes32 appId;
        uint256 agentId;
    }

    // ============ State Variables ============

    /// @notice The JNS registry
    IJNS public immutable jns;

    /// @notice Optional ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice Address records
    mapping(bytes32 => address) private _addresses;

    /// @notice Content hash records (IPFS CID, Swarm hash, etc.)
    mapping(bytes32 => bytes) private _contenthashes;

    /// @notice Text records
    mapping(bytes32 => mapping(string => string)) private _texts;

    /// @notice App records linking names to Jeju apps
    mapping(bytes32 => AppRecord) private _appRecords;

    /// @notice Reverse name records
    mapping(bytes32 => string) private _names;

    /// @notice Operator approvals for node-specific delegation
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _tokenApprovals;

    /// @notice Global operator approvals
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // ============ Events ============

    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Approved(address indexed owner, bytes32 indexed node, address indexed delegate, bool approved);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ============ Modifiers ============

    modifier authorised(bytes32 node) {
        require(_isAuthorised(node), "Not authorized");
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize the resolver with the JNS registry
     * @param _jns Address of the JNS registry
     */
    constructor(address _jns) {
        jns = IJNS(_jns);
    }

    // ============ Address Resolution ============

    /**
     * @notice Get the address for a node
     * @param node The node to query
     * @return The address
     */
    function addr(bytes32 node) external view override returns (address) {
        return _addresses[node];
    }

    /**
     * @notice Set the address for a node
     * @param node The node to update
     * @param addr_ The new address
     */
    function setAddr(bytes32 node, address addr_) external override authorised(node) {
        _addresses[node] = addr_;
        emit AddrChanged(node, addr_);
    }

    // ============ Content Hash ============

    /**
     * @notice Get the content hash for a node
     * @param node The node to query
     * @return The content hash bytes
     */
    function contenthash(bytes32 node) external view override returns (bytes memory) {
        return _contenthashes[node];
    }

    /**
     * @notice Set the content hash for a node
     * @param node The node to update
     * @param hash The new content hash
     */
    function setContenthash(bytes32 node, bytes calldata hash) external override authorised(node) {
        _contenthashes[node] = hash;
        emit ContenthashChanged(node, hash);
    }

    // ============ Text Records ============

    /**
     * @notice Get a text record for a node
     * @param node The node to query
     * @param key The text key
     * @return The text value
     */
    function text(bytes32 node, string calldata key) external view override returns (string memory) {
        return _texts[node][key];
    }

    /**
     * @notice Set a text record for a node
     * @param node The node to update
     * @param key The text key
     * @param value The text value
     */
    function setText(bytes32 node, string calldata key, string calldata value) external override authorised(node) {
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    /**
     * @notice Set multiple text records at once
     * @param node The node to update
     * @param keys Array of text keys
     * @param values Array of text values
     */
    function setTexts(bytes32 node, string[] calldata keys, string[] calldata values) external authorised(node) {
        require(keys.length == values.length, "Length mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            _texts[node][keys[i]] = values[i];
            emit TextChanged(node, keys[i], keys[i], values[i]);
        }
    }

    // ============ App Records (Jeju Integration) ============

    /**
     * @notice Get the app record for a node
     * @param node The node to query
     * @return appContract The app's contract address
     * @return appId The app's identifier
     * @return agentId The linked ERC-8004 agent ID
     */
    function appRecord(bytes32 node)
        external
        view
        override
        returns (address appContract, bytes32 appId, uint256 agentId)
    {
        AppRecord memory record = _appRecords[node];
        return (record.appContract, record.appId, record.agentId);
    }

    /**
     * @notice Set the app record for a node
     * @param node The node to update
     * @param appContract The app's contract address
     * @param appId The app's identifier
     */
    function setAppRecord(bytes32 node, address appContract, bytes32 appId) external override authorised(node) {
        _appRecords[node].appContract = appContract;
        _appRecords[node].appId = appId;
        emit AppRecordChanged(node, appContract, appId);
    }

    /**
     * @notice Link an ERC-8004 agent to a name
     * @param node The node to update
     * @param agentId The agent ID from IdentityRegistry
     */
    function linkAgent(bytes32 node, uint256 agentId) external override authorised(node) {
        // Verify agent exists if registry is set
        if (address(identityRegistry) != address(0)) {
            require(identityRegistry.agentExists(agentId), "Agent does not exist");
            // Verify caller owns the agent
            require(identityRegistry.ownerOf(agentId) == msg.sender, "Not agent owner");
        }

        _appRecords[node].agentId = agentId;
        emit AgentLinked(node, agentId);
    }

    /**
     * @notice Set full app configuration at once
     * @param node The node to update
     * @param appContract The app's contract address
     * @param appId The app's identifier
     * @param agentId The linked ERC-8004 agent ID
     * @param endpoint The app's API endpoint
     * @param a2aEndpoint The A2A endpoint
     */
    function setAppConfig(
        bytes32 node,
        address appContract,
        bytes32 appId,
        uint256 agentId,
        string calldata endpoint,
        string calldata a2aEndpoint
    ) external authorised(node) {
        // Set app record
        _appRecords[node].appContract = appContract;
        _appRecords[node].appId = appId;
        emit AppRecordChanged(node, appContract, appId);

        // Link agent if provided
        if (agentId > 0) {
            if (address(identityRegistry) != address(0)) {
                require(identityRegistry.agentExists(agentId), "Agent does not exist");
            }
            _appRecords[node].agentId = agentId;
            emit AgentLinked(node, agentId);
        }

        // Set text records
        if (bytes(endpoint).length > 0) {
            _texts[node]["app.endpoint"] = endpoint;
            emit TextChanged(node, "app.endpoint", "app.endpoint", endpoint);
        }
        if (bytes(a2aEndpoint).length > 0) {
            _texts[node]["app.a2a"] = a2aEndpoint;
            emit TextChanged(node, "app.a2a", "app.a2a", a2aEndpoint);
        }
    }

    // ============ Reverse Resolution ============

    /**
     * @notice Get the name for a node (reverse resolution)
     * @param node The node to query
     * @return The name
     */
    function name(bytes32 node) external view override returns (string memory) {
        return _names[node];
    }

    /**
     * @notice Set the name for a node (reverse resolution)
     * @param node The node to update
     * @param name_ The name
     */
    function setName(bytes32 node, string calldata name_) external override authorised(node) {
        _names[node] = name_;
        emit NameChanged(node, name_);
    }

    // ============ Operator Approvals ============

    /**
     * @notice Approve or revoke an operator for all names
     * @param operator The operator address
     * @param approved True to approve, false to revoke
     */
    function setApprovalForAll(address operator, bool approved) external {
        require(msg.sender != operator, "Cannot approve self");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /**
     * @notice Check if an operator is approved for all names
     * @param account The owner address
     * @param operator The operator address
     * @return True if approved
     */
    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /**
     * @notice Approve or revoke a delegate for a specific node
     * @param node The node
     * @param delegate The delegate address
     * @param approved True to approve, false to revoke
     */
    function approve(bytes32 node, address delegate, bool approved) external {
        require(msg.sender != delegate, "Cannot approve self");
        _tokenApprovals[msg.sender][node][delegate] = approved;
        emit Approved(msg.sender, node, delegate, approved);
    }

    /**
     * @notice Check if a delegate is approved for a node
     * @param nodeOwner The owner address
     * @param node The node
     * @param delegate The delegate address
     * @return True if approved
     */
    function isApprovedFor(address nodeOwner, bytes32 node, address delegate) public view returns (bool) {
        return _tokenApprovals[nodeOwner][node][delegate];
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    function setIdentityRegistry(address _identityRegistry) external {
        // Only root owner can set
        require(jns.owner(bytes32(0)) == msg.sender, "Not root owner");
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    // ============ Internal Functions ============

    function _isAuthorised(bytes32 node) internal view returns (bool) {
        address nodeOwner = jns.owner(node);
        return nodeOwner == msg.sender || isApprovedForAll(nodeOwner, msg.sender)
            || isApprovedFor(nodeOwner, node, msg.sender) || jns.isApprovedForAll(nodeOwner, msg.sender);
    }

    // ============ View Functions ============

    /**
     * @notice Get the full app info for a name
     * @param node The node to query
     * @return appContract The app's contract address
     * @return appId The app's identifier
     * @return agentId The linked ERC-8004 agent ID
     * @return endpoint The app's API endpoint
     * @return a2aEndpoint The A2A endpoint
     * @return contenthash_ The content hash
     */
    function getAppInfo(bytes32 node)
        external
        view
        returns (
            address appContract,
            bytes32 appId,
            uint256 agentId,
            string memory endpoint,
            string memory a2aEndpoint,
            bytes memory contenthash_
        )
    {
        AppRecord memory record = _appRecords[node];
        return (
            record.appContract,
            record.appId,
            record.agentId,
            _texts[node]["app.endpoint"],
            _texts[node]["app.a2a"],
            _contenthashes[node]
        );
    }

    /**
     * @notice Check if a name is linked to an active ERC-8004 agent
     * @param node The node to check
     * @return True if linked to an active agent
     */
    function hasActiveAgent(bytes32 node) external view returns (bool) {
        uint256 agentId = _appRecords[node].agentId;
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice EIP-165 interface detection
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IJNSResolver).interfaceId || interfaceId == 0x01ffc9a7; // EIP-165
    }
}
