// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import {IJNS} from "./IJNS.sol";

/**
 * @title JNSRegistry
 * @notice Core registry for the Jeju Name Service
 */
contract JNSRegistry is IJNS {
    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    mapping(bytes32 => Record) private _records;
    mapping(address => mapping(address => bool)) private _operators;

    modifier authorised(bytes32 node) {
        address nodeOwner = _records[node].owner;
        require(nodeOwner == msg.sender || _operators[nodeOwner][msg.sender], "Not authorized");
        _;
    }

    constructor() {
        _records[bytes32(0)].owner = msg.sender;
    }

    function setRecord(bytes32 node, address nodeOwner, address nodeResolver, uint64 nodeTtl)
        external
        override
        authorised(node)
    {
        _setOwner(node, nodeOwner);
        _setResolverAndTTL(node, nodeResolver, nodeTtl);
    }

    function setSubnodeRecord(bytes32 node, bytes32 label, address nodeOwner, address nodeResolver, uint64 nodeTtl)
        external
        override
        authorised(node)
    {
        bytes32 subnode = _setSubnodeOwner(node, label, nodeOwner);
        _setResolverAndTTL(subnode, nodeResolver, nodeTtl);
    }

    function setOwner(bytes32 node, address nodeOwner) public override authorised(node) {
        _setOwner(node, nodeOwner);
        emit Transfer(node, nodeOwner);
    }

    function setSubnodeOwner(bytes32 node, bytes32 label, address nodeOwner)
        public
        override
        authorised(node)
        returns (bytes32)
    {
        return _setSubnodeOwner(node, label, nodeOwner);
    }

    function setResolver(bytes32 node, address nodeResolver) public override authorised(node) {
        emit NewResolver(node, nodeResolver);
        _records[node].resolver = nodeResolver;
    }

    function setTTL(bytes32 node, uint64 nodeTtl) public override authorised(node) {
        emit NewTTL(node, nodeTtl);
        _records[node].ttl = nodeTtl;
    }

    function setApprovalForAll(address operator, bool approved) external override {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    // ============ View Functions ============

    function owner(bytes32 node) public view override returns (address) {
        address addr = _records[node].owner;
        if (addr == address(this)) {
            return address(0);
        }
        return addr;
    }

    function resolver(bytes32 node) public view override returns (address) {
        return _records[node].resolver;
    }

    function ttl(bytes32 node) public view override returns (uint64) {
        return _records[node].ttl;
    }

    function recordExists(bytes32 node) public view override returns (bool) {
        return _records[node].owner != address(0);
    }

    function isApprovedForAll(address nodeOwner, address operator) external view override returns (bool) {
        return _operators[nodeOwner][operator];
    }

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

    function namehash(bytes32 node, bytes32 label) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, label));
    }

    function labelhash(string calldata label) external pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
