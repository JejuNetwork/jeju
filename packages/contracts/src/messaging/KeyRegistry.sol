// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KeyRegistry
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
 * @custom:security-contact security@jeju.network
 */
contract KeyRegistry is ReentrancyGuard {
    // ============ Structs ============

    struct PublicKeyBundle {
        bytes32 identityKey; // Long-term X25519 public key
        bytes32 signedPreKey; // Medium-term pre-key (rotated weekly)
        bytes32 preKeySignature; // ED25519 signature of signedPreKey
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
    mapping(address => bytes32[]) public keyHistory;

    // ERC-8004 agent keys
    mapping(uint256 => PublicKeyBundle) public agentKeyBundles;

    // Configuration
    uint256 public constant MAX_ONE_TIME_KEYS = 100;
    uint256 public constant PRE_KEY_ROTATION_PERIOD = 7 days;

    // ============ Events ============

    event KeyBundleRegistered(address indexed user, bytes32 identityKey, bytes32 signedPreKey, uint256 timestamp);
    event SignedPreKeyRotated(address indexed user, bytes32 oldKey, bytes32 newKey, uint256 timestamp);
    event OneTimePreKeysUploaded(address indexed user, uint256 count, uint256 timestamp);
    event OneTimePreKeyConsumed(address indexed user, uint256 keyIndex, address indexed consumer);
    event KeyBundleRevoked(address indexed user, uint256 timestamp);
    event AgentKeyRegistered(uint256 indexed agentId, bytes32 identityKey, uint256 timestamp);

    // ============ Errors ============

    error KeyAlreadyRegistered();
    error KeyNotRegistered();
    error InvalidKeyLength();
    error TooManyPreKeys();
    error NoPreKeysAvailable();
    error KeyBundleInactive();

    // ============ Key Registration ============

    /**
     * @notice Register a new key bundle
     * @param identityKey X25519 public identity key (32 bytes)
     * @param signedPreKey X25519 signed pre-key (32 bytes)
     * @param preKeySignature ED25519 signature of signedPreKey
     */
    function registerKeyBundle(bytes32 identityKey, bytes32 signedPreKey, bytes32 preKeySignature)
        external
        nonReentrant
    {
        if (keyBundles[msg.sender].isActive) revert KeyAlreadyRegistered();
        if (identityKey == bytes32(0)) revert InvalidKeyLength();
        if (signedPreKey == bytes32(0)) revert InvalidKeyLength();

        keyBundles[msg.sender] = PublicKeyBundle({
            identityKey: identityKey,
            signedPreKey: signedPreKey,
            preKeySignature: preKeySignature,
            preKeyTimestamp: block.timestamp,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });

        // Store in history
        keyHistory[msg.sender].push(identityKey);

        emit KeyBundleRegistered(msg.sender, identityKey, signedPreKey, block.timestamp);
    }

    /**
     * @notice Rotate signed pre-key (recommended weekly)
     * @param newSignedPreKey New X25519 pre-key
     * @param newPreKeySignature Signature of new pre-key
     */
    function rotateSignedPreKey(bytes32 newSignedPreKey, bytes32 newPreKeySignature) external {
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (!bundle.isActive) revert KeyNotRegistered();
        if (newSignedPreKey == bytes32(0)) revert InvalidKeyLength();

        bytes32 oldKey = bundle.signedPreKey;

        bundle.signedPreKey = newSignedPreKey;
        bundle.preKeySignature = newPreKeySignature;
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
     * @param user Address whose pre-key to consume
     * @return preKey The one-time pre-key
     * @return keyIndex Index of the consumed key
     */
    function consumeOneTimePreKey(address user) external returns (bytes32 preKey, uint256 keyIndex) {
        if (!keyBundles[user].isActive) revert KeyBundleInactive();

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
     * @notice Revoke key bundle (disables messaging)
     */
    function revokeKeyBundle() external {
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (!bundle.isActive) revert KeyNotRegistered();

        bundle.isActive = false;
        bundle.lastUpdated = block.timestamp;

        // Clear one-time keys
        delete oneTimePreKeys[msg.sender];
        oneTimePreKeyIndex[msg.sender] = 0;

        emit KeyBundleRevoked(msg.sender, block.timestamp);
    }

    /**
     * @notice Update identity key (requires re-establishing all conversations)
     * @param newIdentityKey New X25519 identity key
     * @param signedPreKey New signed pre-key
     * @param preKeySignature Signature of pre-key
     */
    function updateIdentityKey(bytes32 newIdentityKey, bytes32 signedPreKey, bytes32 preKeySignature)
        external
        nonReentrant
    {
        if (newIdentityKey == bytes32(0)) revert InvalidKeyLength();

        // Store old key in history if exists
        PublicKeyBundle storage bundle = keyBundles[msg.sender];
        if (bundle.isActive && bundle.identityKey != bytes32(0)) {
            keyHistory[msg.sender].push(bundle.identityKey);
        }

        // Update bundle
        bundle.identityKey = newIdentityKey;
        bundle.signedPreKey = signedPreKey;
        bundle.preKeySignature = preKeySignature;
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
     * @param agentId Agent token ID
     * @param identityKey X25519 public identity key
     * @param signedPreKey X25519 signed pre-key
     * @param preKeySignature Signature of pre-key
     */
    function registerAgentKey(uint256 agentId, bytes32 identityKey, bytes32 signedPreKey, bytes32 preKeySignature)
        external
    {
        if (agentKeyBundles[agentId].isActive) revert KeyAlreadyRegistered();
        if (identityKey == bytes32(0)) revert InvalidKeyLength();

        agentKeyBundles[agentId] = PublicKeyBundle({
            identityKey: identityKey,
            signedPreKey: signedPreKey,
            preKeySignature: preKeySignature,
            preKeyTimestamp: block.timestamp,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });

        emit AgentKeyRegistered(agentId, identityKey, block.timestamp);
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
     * @param user Address to check
     * @return needsRotation True if pre-key should be rotated
     */
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
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
