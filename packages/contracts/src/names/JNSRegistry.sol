// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import {IJNS} from "./IJNS.sol";

/**
 * @title JNSRegistry
 * @author Jeju Network
 * @notice Core registry for the Jeju Name Service
 * @dev Implements a hierarchical namespace with owner-controlled subdomains
 *
 * Architecture:
 * - Names are represented as bytes32 nodes (keccak256 hashes)
 * - The root node (0x0) is owned by the deployer
 * - Each node stores: owner, resolver, TTL
 * - Operators can manage all names for an owner
 *
 * Key Features:
 * - Hierarchical namespace (e.g., app.jeju, bazaar.app.jeju)
 * - Owner-controlled subdomains
 * - Configurable resolvers per node
 * - TTL for caching hints
 * - Operator approvals for delegation
 *
 * Name Resolution:
 * - Clients query resolver(node) to get resolver address
 * - Then query the resolver for specific records
 *
 * @custom:security-contact security@jeju.network
 */
contract JNSRegistry is IJNS {
    // ============ Structs ============

    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    // ============ State Variables ============

    /// @notice Mapping from node hash to record
    mapping(bytes32 => Record) private _records;

    /// @notice Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) private _operators;

    // ============ Modifiers ============

    modifier authorised(bytes32 node) {
        address nodeOwner = _records[node].owner;
        require(nodeOwner == msg.sender || _operators[nodeOwner][msg.sender], "Not authorized");
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the registry with root node owned by deployer
    constructor() {
        _records[bytes32(0)].owner = msg.sender;
    }

    // ============ Core Functions ============

    /**
     * @notice Set all record data for a node
     * @param node The node to update
     * @param nodeOwner The address of the new owner
     * @param nodeResolver The address of the resolver
     * @param nodeTtl The TTL in seconds
     */
    function setRecord(
        bytes32 node,
        address nodeOwner,
        address nodeResolver,
        uint64 nodeTtl
    ) external override authorised(node) {
        _setOwner(node, nodeOwner);
        _setResolverAndTTL(node, nodeResolver, nodeTtl);
    }

    /**
     * @notice Set all record data for a subnode
     * @param node The parent node
     * @param label The hash of the label specifying the subnode
     * @param nodeOwner The address of the new owner
     * @param nodeResolver The address of the resolver
     * @param nodeTtl The TTL in seconds
     */
    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address nodeOwner,
        address nodeResolver,
        uint64 nodeTtl
    ) external override authorised(node) {
        bytes32 subnode = _setSubnodeOwner(node, label, nodeOwner);
        _setResolverAndTTL(subnode, nodeResolver, nodeTtl);
    }

    /**
     * @notice Transfer ownership of a node
     * @param node The node to transfer ownership of
     * @param nodeOwner The address of the new owner
     */
    function setOwner(bytes32 node, address nodeOwner) public override authorised(node) {
        _setOwner(node, nodeOwner);
        emit Transfer(node, nodeOwner);
    }

    /**
     * @notice Create or transfer ownership of a subnode
     * @param node The parent node
     * @param label The hash of the label specifying the subnode
     * @param nodeOwner The address of the new owner
     * @return The namehash of the subnode
     */
    function setSubnodeOwner(
        bytes32 node,
        bytes32 label,
        address nodeOwner
    ) public override authorised(node) returns (bytes32) {
        return _setSubnodeOwner(node, label, nodeOwner);
    }

    /**
     * @notice Set the resolver for a node
     * @param node The node to update
     * @param nodeResolver The address of the resolver
     */
    function setResolver(bytes32 node, address nodeResolver) public override authorised(node) {
        emit NewResolver(node, nodeResolver);
        _records[node].resolver = nodeResolver;
    }

    /**
     * @notice Set the TTL for a node
     * @param node The node to update
     * @param nodeTtl The TTL in seconds
     */
    function setTTL(bytes32 node, uint64 nodeTtl) public override authorised(node) {
        emit NewTTL(node, nodeTtl);
        _records[node].ttl = nodeTtl;
    }

    /**
     * @notice Enable or disable operator approval
     * @param operator Address to add/remove as operator
     * @param approved True to approve, false to revoke
     */
    function setApprovalForAll(address operator, bool approved) external override {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    // ============ View Functions ============

    /**
     * @notice Get the owner of a node
     * @param node The node to query
     * @return The address of the owner
     */
    function owner(bytes32 node) public view override returns (address) {
        address addr = _records[node].owner;
        if (addr == address(this)) {
            return address(0);
        }
        return addr;
    }

    /**
     * @notice Get the resolver for a node
     * @param node The node to query
     * @return The address of the resolver
     */
    function resolver(bytes32 node) public view override returns (address) {
        return _records[node].resolver;
    }

    /**
     * @notice Get the TTL for a node
     * @param node The node to query
     * @return The TTL in seconds
     */
    function ttl(bytes32 node) public view override returns (uint64) {
        return _records[node].ttl;
    }

    /**
     * @notice Check if a record exists
     * @param node The node to query
     * @return True if the record exists
     */
    function recordExists(bytes32 node) public view override returns (bool) {
        return _records[node].owner != address(0);
    }

    /**
     * @notice Check if an operator is approved
     * @param nodeOwner The address that owns the names
     * @param operator The address that acts on behalf of the owner
     * @return True if approved
     */
    function isApprovedForAll(address nodeOwner, address operator) external view override returns (bool) {
        return _operators[nodeOwner][operator];
    }

    // ============ Internal Functions ============

    function _setOwner(bytes32 node, address nodeOwner) internal {
        _records[node].owner = nodeOwner;
    }

    function _setSubnodeOwner(bytes32 node, bytes32 label, address nodeOwner) internal returns (bytes32) {
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        _records[subnode].owner = nodeOwner;
        emit NewOwner(node, label, nodeOwner);
        return subnode;
    }

    function _setResolverAndTTL(bytes32 node, address nodeResolver, uint64 nodeTtl) internal {
        if (nodeResolver != _records[node].resolver) {
            _records[node].resolver = nodeResolver;
            emit NewResolver(node, nodeResolver);
        }
        if (nodeTtl != _records[node].ttl) {
            _records[node].ttl = nodeTtl;
            emit NewTTL(node, nodeTtl);
        }
    }

    // ============ Utility Functions ============

    /**
     * @notice Compute the namehash for a label under a parent node
     * @param node The parent node
     * @param label The label to hash
     * @return The namehash of the subnode
     */
    function namehash(bytes32 node, bytes32 label) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, label));
    }

    /**
     * @notice Compute the label hash from a string
     * @param label The label string
     * @return The keccak256 hash of the label
     */
    function labelhash(string calldata label) external pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}






