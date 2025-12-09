// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

/**
 * @title IJNS
 * @notice Interface for the Jeju Name Service Registry
 * @dev Core registry interface for JNS name resolution
 */
interface IJNS {
    // ============ Events ============
    
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);
    event Transfer(bytes32 indexed node, address owner);
    event NewResolver(bytes32 indexed node, address resolver);
    event NewTTL(bytes32 indexed node, uint64 ttl);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // ============ Core Functions ============

    function setRecord(bytes32 node, address owner, address resolver, uint64 ttl) external;
    function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external;
    function setSubnodeOwner(bytes32 node, bytes32 label, address newOwner) external returns (bytes32);
    function setResolver(bytes32 node, address resolver) external;
    function setOwner(bytes32 node, address owner) external;
    function setTTL(bytes32 node, uint64 ttl) external;
    function setApprovalForAll(address operator, bool approved) external;

    // ============ View Functions ============

    function owner(bytes32 node) external view returns (address);
    function resolver(bytes32 node) external view returns (address);
    function ttl(bytes32 node) external view returns (uint64);
    function recordExists(bytes32 node) external view returns (bool);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/**
 * @title IJNSResolver
 * @notice Interface for JNS resolvers with app-specific profiles
 */
interface IJNSResolver {
    // ============ Events ============
    
    event AddrChanged(bytes32 indexed node, address addr);
    event ContenthashChanged(bytes32 indexed node, bytes hash);
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);
    event AppRecordChanged(bytes32 indexed node, address indexed appContract, bytes32 appId);
    event AgentLinked(bytes32 indexed node, uint256 indexed agentId);
    event NameChanged(bytes32 indexed node, string name);

    // ============ Address Resolution ============
    
    function addr(bytes32 node) external view returns (address);
    function setAddr(bytes32 node, address addr_) external;

    // ============ Content Hash (IPFS/Swarm) ============
    
    function contenthash(bytes32 node) external view returns (bytes memory);
    function setContenthash(bytes32 node, bytes calldata hash) external;

    // ============ Text Records ============
    
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function setText(bytes32 node, string calldata key, string calldata value) external;

    // ============ App Records (ERC-8004 Integration) ============
    
    function appRecord(bytes32 node) external view returns (address appContract, bytes32 appId, uint256 agentId);
    function setAppRecord(bytes32 node, address appContract, bytes32 appId) external;
    function linkAgent(bytes32 node, uint256 agentId) external;

    // ============ Reverse Resolution ============
    
    function name(bytes32 node) external view returns (string memory);
    function setName(bytes32 node, string calldata name_) external;
}

/**
 * @title IJNSRegistrar
 * @notice Interface for JNS name registration
 */
interface IJNSRegistrar {
    // ============ Events ============
    
    event NameRegistered(bytes32 indexed node, string name, address indexed owner, uint256 expires, uint256 cost);
    event NameRenewed(bytes32 indexed node, string name, uint256 expires, uint256 cost);
    event NameTransferred(bytes32 indexed node, address indexed from, address indexed to);

    // ============ Registration ============
    
    function available(string calldata name) external view returns (bool);
    function rentPrice(string calldata name, uint256 duration) external view returns (uint256);
    function register(string calldata name, address owner, uint256 duration) external payable returns (bytes32 node);
    function registerWithConfig(
        string calldata name,
        address owner,
        uint256 duration,
        address resolver,
        bytes[] calldata data
    ) external payable returns (bytes32 node);
    function renew(string calldata name, uint256 duration) external payable;

    // ============ View Functions ============
    
    function nameExpires(string calldata name) external view returns (uint256);
    function ownerOf(string calldata name) external view returns (address);
}


