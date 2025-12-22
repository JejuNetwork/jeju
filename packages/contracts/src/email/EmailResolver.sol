// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {IJNS} from "../names/IJNS.sol";
import {IEmailRegistry} from "./IEmailRegistry.sol";

/**
 * @title EmailResolver
 * @notice Extended resolver for email-specific JNS records
 * @dev Provides:
 * - Email public key records (for E2E encryption)
 * - Email relay preferences
 * - Email forwarding addresses
 * - Mail server records (MX-like)
 *
 * Standard Text Keys (in addition to JNSResolver):
 * - email.publicKey: MPC group public key for encryption
 * - email.relays: Comma-separated preferred relay endpoints
 * - email.forward: Auto-forward address
 * - email.signature: Email signature
 * - email.autoReply: Auto-reply message
 * - email.status: Account status (active/away/busy)
 */
contract EmailResolver {
    // ============ Structs ============

    struct EmailRecord {
        bytes32 publicKeyHash;        // Hash of encryption public key
        address[] preferredRelays;    // Preferred relay node addresses
        string forwardAddress;        // Forward all mail to this address
        bool encryptionRequired;      // Require E2E encryption
        bool externalEnabled;         // Allow external email
    }

    // ============ State ============

    /// @notice JNS registry
    IJNS public immutable jns;

    /// @notice Email registry for account lookup
    IEmailRegistry public emailRegistry;

    /// @notice Email records by JNS node
    mapping(bytes32 => EmailRecord) private _emailRecords;

    /// @notice Email text records (for signatures, auto-replies, etc.)
    mapping(bytes32 => mapping(string => string)) private _emailTexts;

    /// @notice Authorized operators
    mapping(address => mapping(address => bool)) private _operators;

    // ============ Events ============

    event EmailPublicKeyChanged(bytes32 indexed node, bytes32 publicKeyHash);
    event EmailRelaysChanged(bytes32 indexed node, address[] relays);
    event EmailForwardChanged(bytes32 indexed node, string forwardAddress);
    event EmailConfigChanged(bytes32 indexed node, bool encryptionRequired, bool externalEnabled);
    event EmailTextChanged(bytes32 indexed node, string indexed key, string value);

    // ============ Modifiers ============

    modifier authorised(bytes32 node) {
        require(_isAuthorised(node), "Not authorized");
        _;
    }

    // ============ Constructor ============

    constructor(address _jns, address _emailRegistry) {
        jns = IJNS(_jns);
        emailRegistry = IEmailRegistry(_emailRegistry);
    }

    // ============ Email Records ============

    /**
     * @notice Get the email public key hash for a node
     * @param node JNS node
     * @return Public key hash
     */
    function emailPublicKey(bytes32 node) external view returns (bytes32) {
        return _emailRecords[node].publicKeyHash;
    }

    /**
     * @notice Set the email public key hash
     * @param node JNS node
     * @param publicKeyHash Hash of the public key
     */
    function setEmailPublicKey(bytes32 node, bytes32 publicKeyHash) external authorised(node) {
        _emailRecords[node].publicKeyHash = publicKeyHash;
        emit EmailPublicKeyChanged(node, publicKeyHash);
    }

    /**
     * @notice Get preferred relay addresses
     * @param node JNS node
     * @return Array of relay addresses
     */
    function emailRelays(bytes32 node) external view returns (address[] memory) {
        return _emailRecords[node].preferredRelays;
    }

    /**
     * @notice Set preferred relay addresses
     * @param node JNS node
     * @param relays Array of relay addresses
     */
    function setEmailRelays(bytes32 node, address[] calldata relays) external authorised(node) {
        _emailRecords[node].preferredRelays = relays;
        emit EmailRelaysChanged(node, relays);
    }

    /**
     * @notice Get email forwarding address
     * @param node JNS node
     * @return Forward address
     */
    function emailForward(bytes32 node) external view returns (string memory) {
        return _emailRecords[node].forwardAddress;
    }

    /**
     * @notice Set email forwarding address
     * @param node JNS node
     * @param forwardAddress Address to forward to
     */
    function setEmailForward(bytes32 node, string calldata forwardAddress) external authorised(node) {
        _emailRecords[node].forwardAddress = forwardAddress;
        emit EmailForwardChanged(node, forwardAddress);
    }

    /**
     * @notice Get email configuration
     * @param node JNS node
     * @return encryptionRequired Whether encryption is required
     * @return externalEnabled Whether external email is enabled
     */
    function emailConfig(bytes32 node) external view returns (bool encryptionRequired, bool externalEnabled) {
        EmailRecord storage record = _emailRecords[node];
        return (record.encryptionRequired, record.externalEnabled);
    }

    /**
     * @notice Set email configuration
     * @param node JNS node
     * @param encryptionRequired Require E2E encryption
     * @param externalEnabled Allow external email
     */
    function setEmailConfig(
        bytes32 node,
        bool encryptionRequired,
        bool externalEnabled
    ) external authorised(node) {
        _emailRecords[node].encryptionRequired = encryptionRequired;
        _emailRecords[node].externalEnabled = externalEnabled;
        emit EmailConfigChanged(node, encryptionRequired, externalEnabled);
    }

    /**
     * @notice Get full email record
     * @param node JNS node
     * @return record Email record struct
     */
    function getEmailRecord(bytes32 node) external view returns (EmailRecord memory record) {
        return _emailRecords[node];
    }

    /**
     * @notice Set full email configuration at once
     * @param node JNS node
     * @param publicKeyHash Public key hash
     * @param relays Preferred relays
     * @param forwardAddress Forward address
     * @param encryptionRequired Require encryption
     * @param externalEnabled Allow external
     */
    function setFullEmailRecord(
        bytes32 node,
        bytes32 publicKeyHash,
        address[] calldata relays,
        string calldata forwardAddress,
        bool encryptionRequired,
        bool externalEnabled
    ) external authorised(node) {
        _emailRecords[node] = EmailRecord({
            publicKeyHash: publicKeyHash,
            preferredRelays: relays,
            forwardAddress: forwardAddress,
            encryptionRequired: encryptionRequired,
            externalEnabled: externalEnabled
        });

        emit EmailPublicKeyChanged(node, publicKeyHash);
        emit EmailRelaysChanged(node, relays);
        emit EmailForwardChanged(node, forwardAddress);
        emit EmailConfigChanged(node, encryptionRequired, externalEnabled);
    }

    // ============ Email Text Records ============

    /**
     * @notice Get email text record
     * @param node JNS node
     * @param key Text key (e.g., "email.signature")
     * @return Text value
     */
    function emailText(bytes32 node, string calldata key) external view returns (string memory) {
        return _emailTexts[node][key];
    }

    /**
     * @notice Set email text record
     * @param node JNS node
     * @param key Text key
     * @param value Text value
     */
    function setEmailText(bytes32 node, string calldata key, string calldata value) external authorised(node) {
        _emailTexts[node][key] = value;
        emit EmailTextChanged(node, key, value);
    }

    /**
     * @notice Set multiple email text records
     * @param node JNS node
     * @param keys Text keys
     * @param values Text values
     */
    function setEmailTexts(
        bytes32 node,
        string[] calldata keys,
        string[] calldata values
    ) external authorised(node) {
        require(keys.length == values.length, "Length mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            _emailTexts[node][keys[i]] = values[i];
            emit EmailTextChanged(node, keys[i], values[i]);
        }
    }

    // ============ Resolution ============

    /**
     * @notice Resolve email address to encryption info
     * @param node JNS node for email (e.g., keccak256("alice.jeju"))
     * @return publicKeyHash Encryption public key hash
     * @return relays Preferred relay addresses
     * @return encryptionRequired Whether encryption is required
     */
    function resolveEmailEncryption(bytes32 node) external view returns (
        bytes32 publicKeyHash,
        address[] memory relays,
        bool encryptionRequired
    ) {
        EmailRecord storage record = _emailRecords[node];
        return (record.publicKeyHash, record.preferredRelays, record.encryptionRequired);
    }

    /**
     * @notice Check if email address can receive external mail
     * @param node JNS node
     * @return True if can receive external mail
     */
    function canReceiveExternal(bytes32 node) external view returns (bool) {
        return _emailRecords[node].externalEnabled;
    }

    // ============ Operator Approvals ============

    /**
     * @notice Set operator approval
     * @param operator Operator address
     * @param approved Approval status
     */
    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
    }

    /**
     * @notice Check if operator is approved
     * @param owner Owner address
     * @param operator Operator address
     * @return Approval status
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    // ============ Internal ============

    function _isAuthorised(bytes32 node) internal view returns (bool) {
        address nodeOwner = jns.owner(node);
        return nodeOwner == msg.sender || _operators[nodeOwner][msg.sender];
    }

    // ============ Admin ============

    /**
     * @notice Update email registry reference
     * @param _emailRegistry New email registry address
     */
    function setEmailRegistry(address _emailRegistry) external {
        require(jns.owner(bytes32(0)) == msg.sender, "Not root owner");
        emailRegistry = IEmailRegistry(_emailRegistry);
    }

    /**
     * @notice EIP-165 interface detection
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7; // EIP-165
    }
}
