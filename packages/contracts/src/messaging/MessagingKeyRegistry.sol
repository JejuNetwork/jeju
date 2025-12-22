// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {BlockingMixin} from "../moderation/BlockingMixin.sol";

/**
 * @title MessagingKeyRegistry
 * @notice On-chain registry for public encryption keys
 * @dev Users register their X25519 public keys for encrypted messaging
 *
 * Key Features:
 * - Permissionless key registration
 * - Key rotation support with history
 * - Pre-key bundles for offline messaging
 * - ERC-8004 integration for agent keys
 *
 * Encryption scheme:
 * - X25519 for key exchange (Curve25519)
 * - AES-256-GCM for message encryption
 * - ED25519 for signatures (same curve, different encoding)
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract MessagingKeyRegistry is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using BlockingMixin for BlockingMixin.Data;

    /// @notice Blocking system for user-to-user blocks
    BlockingMixin.Data public blocking;

    // ============ Structs ============

    struct PublicKeyBundle {
        bytes32 identityKey; // Long-term X25519 public key
        bytes32 signedPreKey; // Medium-term pre-key (rotated weekly)
        bytes32 preKeySignature; // Signature of signedPreKey
        uint256 preKeyTimestamp; // When signed pre-key was set
        uint256 registeredAt; // When identity key was registered
        uint256 lastUpdated; // Last update timestamp
        bool isActive; // Whether the key bundle is active
    }

    struct OneTimePreKey {
        bytes32 key;
        bool used;
    }

    // ============ State Variables ============

    // Address => key bundle
    mapping(address => PublicKeyBundle) public keyBundles;

    // Address => one-time pre-keys (for forward secrecy)
    mapping(address => OneTimePreKey[]) public oneTimePreKeys;
    mapping(address => uint256) public oneTimePreKeyIndex;

    // Historical keys (for decrypting old messages)
    // slither-disable-next-line uninitialized-state
    mapping(address => bytes32[]) public keyHistory;

    // ERC-8004 agent keys (agentId => owner => bundle)
    mapping(uint256 => address) public agentKeyOwner;
    mapping(uint256 => PublicKeyBundle) public agentKeyBundles;

    // Permanently revoked addresses
    mapping(address => bool) public isPermanentlyRevoked;

    // Rate limiting for pre-key consumption
    mapping(address => mapping(address => uint256)) public lastPreKeyConsumption;

    // Configuration
    uint256 public constant MAX_ONE_TIME_KEYS = 100;
    uint256 public constant MAX_KEY_HISTORY = 50;
    uint256 public constant PRE_KEY_ROTATION_PERIOD = 7 days;
    uint256 public constant PRE_KEY_CONSUMPTION_COOLDOWN = 1 hours;

    // ============ Events ============

    event KeyBundleRegistered(address indexed user, bytes32 identityKey, bytes32 signedPreKey, uint256 timestamp);
    event SignedPreKeyRotated(address indexed user, bytes32 oldKey, bytes32 newKey, uint256 timestamp);
    event OneTimePreKeysUploaded(address indexed user, uint256 count, uint256 timestamp);
    event OneTimePreKeyConsumed(address indexed user, uint256 keyIndex, address indexed consumer);
    event KeyBundleRevoked(address indexed user, uint256 timestamp);
    event AgentKeyRegistered(uint256 indexed agentId, address indexed owner, bytes32 identityKey, uint256 timestamp);
    event AgentKeyRevoked(uint256 indexed agentId, address indexed owner, uint256 timestamp);

    // ============ Errors ============

    error KeyAlreadyRegistered();
    error KeyNotRegistered();
    error InvalidKeyLength();
    error TooManyPreKeys();
    error NoPreKeysAvailable();
    error KeyBundleInactive();
    error PermanentlyRevoked();
    error PreKeyConsumptionRateLimited();
    error KeyHistoryFull();
    error Unauthorized();
    error UserBlocked();

    // ============ Key Registration ============

    /**
     * @notice Register a new key bundle
     * @param identityKey X25519 public identity key (32 bytes)
     * @param signedPreKey X25519 signed pre-key (32 bytes)
     * @param preKeySignature ECDSA signature of the pre-key
     */
    function registerKeyBundle(bytes32 identityKey, bytes32 signedPreKey, bytes calldata preKeySignature)
        external
        nonReentrant
    {
        if (isPermanentlyRevoked[msg.sender]) revert PermanentlyRevoked();
        if (keyBundles[msg.sender].isActive) revert KeyAlreadyRegistered();
        if (identityKey == bytes32(0)) revert InvalidKeyLength();
        if (signedPreKey == bytes32(0)) revert InvalidKeyLength();

        // Verify pre-key signature
        bytes32 message = keccak256(abi.encodePacked(signedPreKey, msg.sender, block.chainid));
        bytes32 ethSignedHash = message.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(preKeySignature);
        if (signer != msg.sender) revert Unauthorized();

        keyBundles[msg.sender] = PublicKeyBundle({
            identityKey: identityKey,
            signedPreKey: signedPreKey,
            preKeySignature: bytes32(keccak256(preKeySignature)), // Store hash
            preKeyTimestamp: block.timestamp,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });

        // Store in history (with limit)
        _addToKeyHistory(msg.sender, identityKey);

        emit KeyBundleRegistered(msg.sender, identityKey, signedPreKey, block.timestamp);
    }

    /**
     * @notice Rotate signed pre-key (recommended weekly)
     * @param newSignedPreKey New X25519 pre-key
     * @param newPreKeySignature Signature of new pre-key
     */
    function rotateSignedPreKey(bytes32 newSignedPreKey, bytes calldata newPreKeySignature) external nonReentrant {
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (!bundle.isActive) revert KeyNotRegistered();
        if (newSignedPreKey == bytes32(0)) revert InvalidKeyLength();

        // Verify signature
        bytes32 message = keccak256(abi.encodePacked(newSignedPreKey, msg.sender, block.chainid));
        bytes32 ethSignedHash = message.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(newPreKeySignature);
        if (signer != msg.sender) revert Unauthorized();

        bytes32 oldKey = bundle.signedPreKey;

        bundle.signedPreKey = newSignedPreKey;
        bundle.preKeySignature = bytes32(keccak256(newPreKeySignature));
        bundle.preKeyTimestamp = block.timestamp;
        bundle.lastUpdated = block.timestamp;

        emit SignedPreKeyRotated(msg.sender, oldKey, newSignedPreKey, block.timestamp);
    }

    /**
     * @notice Upload one-time pre-keys for forward secrecy
     * @param keys Array of X25519 one-time pre-keys
     */
    function uploadOneTimePreKeys(bytes32[] calldata keys) external {
        if (!keyBundles[msg.sender].isActive) revert KeyNotRegistered();
        if (oneTimePreKeys[msg.sender].length + keys.length > MAX_ONE_TIME_KEYS) {
            revert TooManyPreKeys();
        }

        for (uint256 i = 0; i < keys.length; i++) {
            oneTimePreKeys[msg.sender].push(OneTimePreKey({key: keys[i], used: false}));
        }

        keyBundles[msg.sender].lastUpdated = block.timestamp;

        emit OneTimePreKeysUploaded(msg.sender, keys.length, block.timestamp);
    }

    /**
     * @notice Consume a one-time pre-key (called when initiating conversation)
     * @dev Rate limited to prevent DoS attacks. Timestamp used intentionally for cooldown.
     * @param user Address whose pre-key to consume
     * @return preKey The one-time pre-key
     * @return keyIndex Index of the consumed key
     */
    // slither-disable-next-line timestamp
    function consumeOneTimePreKey(address user) external nonReentrant returns (bytes32 preKey, uint256 keyIndex) {
        if (!keyBundles[user].isActive) revert KeyBundleInactive();

        // Check if user has blocked the caller (prevents messaging initiation)
        if (blocking.isBlocked(msg.sender, user)) revert UserBlocked();

        // Rate limiting per consumer-user pair (timestamp intentional for cooldown)
        uint256 lastConsumed = lastPreKeyConsumption[user][msg.sender];
        if (block.timestamp - lastConsumed < PRE_KEY_CONSUMPTION_COOLDOWN) {
            revert PreKeyConsumptionRateLimited();
        }
        lastPreKeyConsumption[user][msg.sender] = block.timestamp;

        OneTimePreKey[] storage keys = oneTimePreKeys[user];
        uint256 startIndex = oneTimePreKeyIndex[user];

        // Find first unused key
        for (uint256 i = startIndex; i < keys.length; i++) {
            if (!keys[i].used) {
                keys[i].used = true;
                oneTimePreKeyIndex[user] = i + 1;

                emit OneTimePreKeyConsumed(user, i, msg.sender);

                return (keys[i].key, i);
            }
        }

        revert NoPreKeysAvailable();
    }

    /**
     * @notice Revoke key bundle (disables messaging permanently)
     */
    function revokeKeyBundle() external {
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (!bundle.isActive) revert KeyNotRegistered();

        bundle.isActive = false;
        bundle.lastUpdated = block.timestamp;
        isPermanentlyRevoked[msg.sender] = true;

        // Clear one-time keys
        delete oneTimePreKeys[msg.sender];
        oneTimePreKeyIndex[msg.sender] = 0;

        emit KeyBundleRevoked(msg.sender, block.timestamp);
    }

    /**
     * @notice Update identity key (requires re-establishing all conversations)
     * @dev Cannot be used after permanent revocation
     * @param newIdentityKey New X25519 identity key
     * @param signedPreKey New signed pre-key
     * @param preKeySignature Signature of pre-key
     */
    function updateIdentityKey(bytes32 newIdentityKey, bytes32 signedPreKey, bytes calldata preKeySignature)
        external
        nonReentrant
    {
        if (isPermanentlyRevoked[msg.sender]) revert PermanentlyRevoked();
        if (newIdentityKey == bytes32(0)) revert InvalidKeyLength();

        // Verify signature
        bytes32 message = keccak256(abi.encodePacked(signedPreKey, msg.sender, block.chainid));
        bytes32 ethSignedHash = message.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(preKeySignature);
        if (signer != msg.sender) revert Unauthorized();

        // Store old key in history if exists
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (bundle.isActive && bundle.identityKey != bytes32(0)) {
            _addToKeyHistory(msg.sender, bundle.identityKey);
        }

        // Update bundle
        bundle.identityKey = newIdentityKey;
        bundle.signedPreKey = signedPreKey;
        bundle.preKeySignature = bytes32(keccak256(preKeySignature));
        bundle.preKeyTimestamp = block.timestamp;
        bundle.registeredAt = bundle.isActive ? bundle.registeredAt : block.timestamp;
        bundle.lastUpdated = block.timestamp;
        bundle.isActive = true;

        // Clear one-time keys (need new ones for new identity)
        delete oneTimePreKeys[msg.sender];
        oneTimePreKeyIndex[msg.sender] = 0;

        emit KeyBundleRegistered(msg.sender, newIdentityKey, signedPreKey, block.timestamp);
    }

    // ============ ERC-8004 Agent Keys ============

    /**
     * @notice Register key bundle for an ERC-8004 agent
     * @dev Only the caller becomes the key owner - ownership verification should happen off-chain
     * @param agentId Agent token ID
     * @param identityKey X25519 public identity key
     * @param signedPreKey X25519 signed pre-key
     * @param preKeySignature Signature of pre-key
     */
    function registerAgentKey(
        uint256 agentId,
        bytes32 identityKey,
        bytes32 signedPreKey,
        bytes calldata preKeySignature
    ) external nonReentrant {
        if (agentKeyBundles[agentId].isActive) revert KeyAlreadyRegistered();
        if (identityKey == bytes32(0)) revert InvalidKeyLength();

        // Verify signature (caller proves control of signing key)
        bytes32 message = keccak256(abi.encodePacked(agentId, signedPreKey, msg.sender, block.chainid));
        bytes32 ethSignedHash = message.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(preKeySignature);
        if (signer != msg.sender) revert Unauthorized();

        agentKeyOwner[agentId] = msg.sender;
        agentKeyBundles[agentId] = PublicKeyBundle({
            identityKey: identityKey,
            signedPreKey: signedPreKey,
            preKeySignature: bytes32(keccak256(preKeySignature)),
            preKeyTimestamp: block.timestamp,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });

        emit AgentKeyRegistered(agentId, msg.sender, identityKey, block.timestamp);
    }

    /**
     * @notice Revoke agent key bundle
     * @param agentId Agent token ID
     */
    function revokeAgentKey(uint256 agentId) external {
        if (agentKeyOwner[agentId] != msg.sender) revert Unauthorized();

        agentKeyBundles[agentId].isActive = false;
        agentKeyBundles[agentId].lastUpdated = block.timestamp;

        emit AgentKeyRevoked(agentId, msg.sender, block.timestamp);
    }

    // ============ Internal Functions ============

    function _addToKeyHistory(address user, bytes32 key) internal {
        bytes32[] storage history = keyHistory[user];
        if (history.length >= MAX_KEY_HISTORY) {
            // Remove oldest entry (shift left)
            for (uint256 i = 0; i < history.length - 1; i++) {
                history[i] = history[i + 1];
            }
            history.pop();
        }
        history.push(key);
    }

    // ============ View Functions ============

    /**
     * @notice Get key bundle for an address
     * @param user Address to query
     * @return bundle The public key bundle
     */
    function getKeyBundle(address user) external view returns (PublicKeyBundle memory bundle) {
        return keyBundles[user];
    }

    /**
     * @notice Get key bundle for an agent
     * @param agentId Agent ID to query
     * @return bundle The public key bundle
     */
    function getAgentKeyBundle(uint256 agentId) external view returns (PublicKeyBundle memory bundle) {
        return agentKeyBundles[agentId];
    }

    /**
     * @notice Check if user has active key bundle
     * @param user Address to check
     * @return hasKey True if user has active key bundle
     */
    function hasActiveKeyBundle(address user) external view returns (bool hasKey) {
        return keyBundles[user].isActive;
    }

    /**
     * @notice Get available one-time pre-key count
     * @param user Address to check
     * @return count Number of unused one-time pre-keys
     */
    function getAvailablePreKeyCount(address user) external view returns (uint256 count) {
        OneTimePreKey[] storage keys = oneTimePreKeys[user];
        uint256 startIndex = oneTimePreKeyIndex[user];

        for (uint256 i = startIndex; i < keys.length; i++) {
            if (!keys[i].used) {
                count++;
            }
        }
    }

    /**
     * @notice Get key history for an address
     * @param user Address to query
     * @return keys Array of historical identity keys
     */
    function getKeyHistory(address user) external view returns (bytes32[] memory keys) {
        return keyHistory[user];
    }

    /**
     * @notice Check if pre-key rotation is needed
     * @dev Timestamp comparison is intentional for rotation period enforcement
     * @param user Address to check
     * @return needsRotation True if pre-key should be rotated
     */
    // slither-disable-next-line timestamp
    function needsPreKeyRotation(address user) external view returns (bool needsRotation) {
        PublicKeyBundle storage bundle = keyBundles[user];
        if (!bundle.isActive) return false;
        return block.timestamp - bundle.preKeyTimestamp > PRE_KEY_ROTATION_PERIOD;
    }

    /**
     * @notice Batch get key bundles
     * @param users Array of addresses
     * @return bundles Array of key bundles
     */
    function getKeyBundles(address[] calldata users) external view returns (PublicKeyBundle[] memory bundles) {
        bundles = new PublicKeyBundle[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            bundles[i] = keyBundles[users[i]];
        }
    }

    /**
     * @notice Set the block registry address
     * @param _blockRegistry Block registry address
     */
    function setBlockRegistry(address _blockRegistry) external {
        // Only allow first-time initialization (permissionless)
        require(blocking.blockRegistry == address(0), "Already set");
        blocking.setBlockRegistry(_blockRegistry);
    }

    /**
     * @notice Check if a user has blocked another
     * @param source Initiating user
     * @param target Receiving user
     * @return blocked True if interaction is blocked
     */
    function isUserBlocked(address source, address target) external view returns (bool) {
        return blocking.isBlocked(source, target);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.2.0";
    }
}
