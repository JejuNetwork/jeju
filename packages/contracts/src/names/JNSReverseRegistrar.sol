// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import {IJNS, IJNSResolver} from "./IJNS.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title JNSReverseRegistrar
 * @author Jeju Network
 * @notice Manages reverse resolution (address → name) for JNS
 * @dev Allows addresses to claim their reverse record under addr.reverse
 *
 * Architecture:
 * - Reverse records are stored under the .addr.reverse namespace
 * - Each address can claim their reverse node
 * - The resolver stores the canonical name for the address
 *
 * Use Cases:
 * - Display names instead of addresses in UIs
 * - Identity verification (prove you own a name)
 * - Primary name selection (when owning multiple names)
 *
 * @custom:security-contact security@jeju.network
 */
contract JNSReverseRegistrar is Ownable {
    // ============ Constants ============

    /// @notice Reverse node root (namehash("addr.reverse"))
    bytes32 public constant ADDR_REVERSE_NODE =
        keccak256(abi.encodePacked(keccak256(abi.encodePacked(bytes32(0), keccak256("reverse"))), keccak256("addr")));

    // ============ State Variables ============

    /// @notice The JNS registry
    IJNS public immutable jns;

    /// @notice Default resolver for reverse records
    address public defaultResolver;

    /// @notice Mapping from address to their claimed reverse node
    mapping(address => bytes32) private _reverseNodes;

    // ============ Events ============

    event ReverseClaimed(address indexed addr, bytes32 indexed node);
    event DefaultResolverChanged(address indexed resolver);
    event NameSet(address indexed addr, string name);

    // ============ Errors ============

    error InvalidResolver();

    // ============ Constructor ============

    /**
     * @notice Initialize the reverse registrar
     * @param _jns Address of the JNS registry
     * @param _defaultResolver Address of the default resolver
     */
    constructor(address _jns, address _defaultResolver) Ownable(msg.sender) {
        jns = IJNS(_jns);
        defaultResolver = _defaultResolver;
    }

    // ============ Claim Functions ============

    /**
     * @notice Claim the reverse record for the caller
     * @param resolver The resolver to use (or address(0) for default)
     * @return nodeHash The claimed reverse node
     */
    function claim(address resolver) external returns (bytes32 nodeHash) {
        return _claimForAddr(msg.sender, msg.sender, resolver);
    }

    /**
     * @notice Claim the reverse record and set name in one transaction
     * @param name The name to set as the reverse record
     * @return nodeHash The claimed reverse node
     */
    function claimWithName(string calldata name) external returns (bytes32 nodeHash) {
        nodeHash = _claimForAddr(msg.sender, msg.sender, defaultResolver);

        // Set the name in the resolver
        IJNSResolver(defaultResolver).setName(nodeHash, name);

        emit NameSet(msg.sender, name);
    }

    /**
     * @notice Claim the reverse record for another address (authorized callers only)
     * @param addr The address to claim for
     * @param owner_ The owner of the reverse node
     * @param resolver The resolver to use
     * @return nodeHash The claimed reverse node
     */
    function claimForAddr(address addr, address owner_, address resolver) external returns (bytes32 nodeHash) {
        // Only the address itself or an authorized controller can claim
        require(addr == msg.sender || isAuthorised(msg.sender), "Not authorized");
        return _claimForAddr(addr, owner_, resolver);
    }

    /**
     * @notice Set the name for the caller's reverse record
     * @param name The name to set
     * @return nodeHash The reverse node
     */
    function setName(string calldata name) external returns (bytes32 nodeHash) {
        nodeHash = _reverseNodes[msg.sender];

        // Claim if not already claimed
        if (nodeHash == bytes32(0)) {
            nodeHash = _claimForAddr(msg.sender, msg.sender, defaultResolver);
        }

        // Set the name
        address resolver = jns.resolver(nodeHash);
        if (resolver == address(0)) {
            resolver = defaultResolver;
        }

        IJNSResolver(resolver).setName(nodeHash, name);

        emit NameSet(msg.sender, name);
    }

    /**
     * @notice Set the name for another address
     * @param addr The address to set the name for
     * @param owner_ The owner of the reverse node
     * @param resolver The resolver to use
     * @param name The name to set
     * @return nodeHash The reverse node
     */
    function setNameForAddr(address addr, address owner_, address resolver, string calldata name)
        external
        returns (bytes32 nodeHash)
    {
        require(addr == msg.sender || isAuthorised(msg.sender), "Not authorized");

        nodeHash = _claimForAddr(addr, owner_, resolver);
        IJNSResolver(resolver == address(0) ? defaultResolver : resolver).setName(nodeHash, name);

        emit NameSet(addr, name);
    }

    // ============ View Functions ============

    /**
     * @notice Get the reverse node for an address
     * @param addr The address to query
     * @return The reverse node hash
     */
    function node(address addr) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(ADDR_REVERSE_NODE, _sha3HexAddress(addr)));
    }

    /**
     * @notice Get the name for an address (reverse resolution)
     * @param addr The address to query
     * @return The name, or empty string if not set
     */
    function nameOf(address addr) external view returns (string memory) {
        bytes32 reverseNode = node(addr);
        address resolver = jns.resolver(reverseNode);

        if (resolver == address(0)) {
            return "";
        }

        return IJNSResolver(resolver).name(reverseNode);
    }

    /**
     * @notice Check if an address has claimed their reverse record
     * @param addr The address to check
     * @return True if claimed
     */
    function hasClaimed(address addr) external view returns (bool) {
        return _reverseNodes[addr] != bytes32(0);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the default resolver
     * @param resolver The new default resolver
     */
    function setDefaultResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert InvalidResolver();
        defaultResolver = resolver;
        emit DefaultResolverChanged(resolver);
    }

    /**
     * @notice Check if an address is authorized to claim for others
     * @param addr The address to check
     * @return True if authorized
     */
    function isAuthorised(address addr) public view returns (bool) {
        return addr == owner();
    }

    // ============ Internal Functions ============

    function _claimForAddr(address addr, address owner_, address resolver) internal returns (bytes32 reverseNode) {
        // Calculate the reverse node
        reverseNode = node(addr);

        // Store the claim
        _reverseNodes[addr] = reverseNode;

        // Set up in JNS registry
        bytes32 labelHash = _sha3HexAddress(addr);
        address resolverAddr = resolver == address(0) ? defaultResolver : resolver;

        jns.setSubnodeRecord(ADDR_REVERSE_NODE, labelHash, owner_, resolverAddr, 0);

        emit ReverseClaimed(addr, reverseNode);
    }

    /**
     * @dev Calculate the hash of the hex representation of an address
     * @param addr The address to hash
     * @return The keccak256 hash
     */
    function _sha3HexAddress(address addr) internal pure returns (bytes32) {
        bytes memory hexAddress = new bytes(40);
        bytes memory alphabet = "0123456789abcdef";

        for (uint256 i = 0; i < 20; i++) {
            hexAddress[i * 2] = alphabet[uint8(uint160(addr) >> (8 * (19 - i)) >> 4)];
            hexAddress[i * 2 + 1] = alphabet[uint8(uint160(addr) >> (8 * (19 - i))) & 0x0f];
        }

        return keccak256(hexAddress);
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
