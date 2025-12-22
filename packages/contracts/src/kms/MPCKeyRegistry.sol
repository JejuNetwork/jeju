// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MPCKeyRegistry
 * @notice On-chain registry for MPC/KMS key management with access control
 * @dev Stores key metadata and access policies. Actual keys are managed off-chain by MPC parties.
 *
 * Key features:
 * - Register keys with metadata and access policies
 * - Role-based access control for decryption
 * - Stake-gated access for permissionless usage
 * - Key rotation tracking for historical decryption
 * - Time-locked access conditions
 */
contract MPCKeyRegistry is Ownable, AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    enum AccessType {
        OPEN, // Anyone can access
        OWNER_ONLY, // Only key owner
        ALLOWLIST, // Specific addresses
        STAKE_GATED, // Minimum stake required
        ROLE_BASED, // Role-based access
        TIME_LOCKED // Time-based access

    }

    enum KeyStatus {
        ACTIVE,
        ROTATED,
        REVOKED,
        EXPIRED
    }

    struct AccessPolicy {
        AccessType accessType;
        uint256 minStake; // For STAKE_GATED
        bytes32 requiredRole; // For ROLE_BASED
        uint256 unlockTime; // For TIME_LOCKED
        address[] allowlist; // For ALLOWLIST
    }

    struct KeyMetadata {
        bytes32 keyId;
        address owner;
        bytes32 publicKeyHash;
        uint8 keyType; // 0: encryption, 1: signing, 2: session
        uint8 curve; // 0: secp256k1, 1: ed25519
        uint32 threshold;
        uint32 totalParties;
        uint32 version;
        uint64 createdAt;
        uint64 rotatedAt;
        KeyStatus status;
        AccessPolicy policy;
    }

    struct KeyVersion {
        uint32 version;
        bytes32 publicKeyHash;
        bytes32 commitmentHash;
        uint64 createdAt;
        uint64 rotatedAt;
        KeyStatus status;
    }

    struct MPCParty {
        address partyAddress;
        bytes32 enclaveId;
        uint256 stake;
        uint64 registeredAt;
        uint64 lastSeen;
        bool active;
    }

    // Key storage
    mapping(bytes32 => KeyMetadata) public keys;
    mapping(bytes32 => KeyVersion[]) public keyVersions;
    mapping(bytes32 => mapping(address => bool)) public keyAllowlist;

    // MPC party storage
    mapping(address => MPCParty) public parties;
    address[] public partyList;
    uint256 public minPartyStake;

    // Access tracking
    mapping(bytes32 => mapping(address => uint64)) public lastAccess;
    mapping(bytes32 => uint256) public accessCount;

    // Events
    event KeyRegistered(bytes32 indexed keyId, address indexed owner, uint32 threshold, uint32 totalParties);
    event KeyRotated(bytes32 indexed keyId, uint32 oldVersion, uint32 newVersion);
    event KeyRevoked(bytes32 indexed keyId, address indexed revoker);
    event AccessGranted(bytes32 indexed keyId, address indexed accessor);
    event AccessDenied(bytes32 indexed keyId, address indexed accessor, string reason);
    event PartyRegistered(address indexed party, bytes32 enclaveId, uint256 stake);
    event PartyDeactivated(address indexed party);
    event PolicyUpdated(bytes32 indexed keyId, AccessType newAccessType);

    constructor(uint256 _minPartyStake) Ownable(msg.sender) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
        minPartyStake = _minPartyStake;
    }

    /**
     * @notice Register a new key
     * @param keyId Unique key identifier
     * @param publicKeyHash Hash of the public key
     * @param keyType Type of key (encryption, signing, session)
     * @param curve Curve used (secp256k1, ed25519)
     * @param threshold Number of parties required
     * @param totalParties Total number of parties
     * @param policy Access control policy
     */
    function registerKey(
        bytes32 keyId,
        bytes32 publicKeyHash,
        uint8 keyType,
        uint8 curve,
        uint32 threshold,
        uint32 totalParties,
        AccessPolicy calldata policy
    ) external nonReentrant {
        require(keys[keyId].createdAt == 0, "Key already exists");
        require(threshold >= 2, "Threshold must be >= 2");
        require(threshold <= totalParties, "Threshold > total parties");
        require(_verifyActiveParties(totalParties), "Insufficient active parties");

        keys[keyId] = KeyMetadata({
            keyId: keyId,
            owner: msg.sender,
            publicKeyHash: publicKeyHash,
            keyType: keyType,
            curve: curve,
            threshold: threshold,
            totalParties: totalParties,
            version: 1,
            createdAt: uint64(block.timestamp),
            rotatedAt: 0,
            status: KeyStatus.ACTIVE,
            policy: policy
        });

        keyVersions[keyId].push(
            KeyVersion({
                version: 1,
                publicKeyHash: publicKeyHash,
                commitmentHash: keccak256(abi.encodePacked(keyId, publicKeyHash, block.timestamp)),
                createdAt: uint64(block.timestamp),
                rotatedAt: 0,
                status: KeyStatus.ACTIVE
            })
        );

        // Set up allowlist if applicable
        if (policy.accessType == AccessType.ALLOWLIST) {
            for (uint256 i = 0; i < policy.allowlist.length; i++) {
                keyAllowlist[keyId][policy.allowlist[i]] = true;
            }
        }

        emit KeyRegistered(keyId, msg.sender, threshold, totalParties);
    }

    /**
     * @notice Rotate a key (generate new shares, same address)
     * @param keyId Key to rotate
     * @param newPublicKeyHash Hash of the new public key
     */
    function rotateKey(bytes32 keyId, bytes32 newPublicKeyHash) external nonReentrant {
        KeyMetadata storage key = keys[keyId];
        require(key.createdAt != 0, "Key not found");
        require(key.owner == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "Not authorized");
        require(key.status == KeyStatus.ACTIVE, "Key not active");

        // Mark current version as rotated
        KeyVersion[] storage versions = keyVersions[keyId];
        for (uint256 i = 0; i < versions.length; i++) {
            if (versions[i].status == KeyStatus.ACTIVE) {
                versions[i].status = KeyStatus.ROTATED;
                versions[i].rotatedAt = uint64(block.timestamp);
            }
        }

        uint32 newVersion = key.version + 1;

        // Add new version
        versions.push(
            KeyVersion({
                version: newVersion,
                publicKeyHash: newPublicKeyHash,
                commitmentHash: keccak256(abi.encodePacked(keyId, newPublicKeyHash, block.timestamp)),
                createdAt: uint64(block.timestamp),
                rotatedAt: 0,
                status: KeyStatus.ACTIVE
            })
        );

        emit KeyRotated(keyId, key.version, newVersion);

        key.version = newVersion;
        key.publicKeyHash = newPublicKeyHash;
        key.rotatedAt = uint64(block.timestamp);
    }

    /**
     * @notice Revoke a key (marks all versions as revoked)
     * @param keyId Key to revoke
     */
    function revokeKey(bytes32 keyId) external {
        KeyMetadata storage key = keys[keyId];
        require(key.createdAt != 0, "Key not found");
        require(
            key.owner == msg.sender || hasRole(GUARDIAN_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        key.status = KeyStatus.REVOKED;

        KeyVersion[] storage versions = keyVersions[keyId];
        for (uint256 i = 0; i < versions.length; i++) {
            versions[i].status = KeyStatus.REVOKED;
        }

        emit KeyRevoked(keyId, msg.sender);
    }

    /**
     * @notice Check if an address can access a key
     * @param keyId Key to check
     * @param accessor Address requesting access
     * @return allowed Whether access is allowed
     * @return version Key version to use (for historical decryption)
     */
    function checkAccess(bytes32 keyId, address accessor) external view returns (bool allowed, uint32 version) {
        KeyMetadata storage key = keys[keyId];
        if (key.createdAt == 0) return (false, 0);
        if (key.status != KeyStatus.ACTIVE) return (false, 0);

        version = key.version;

        AccessPolicy storage policy = key.policy;

        if (policy.accessType == AccessType.OPEN) {
            return (true, version);
        }

        if (policy.accessType == AccessType.OWNER_ONLY) {
            return (accessor == key.owner, version);
        }

        if (policy.accessType == AccessType.ALLOWLIST) {
            return (keyAllowlist[keyId][accessor], version);
        }

        if (policy.accessType == AccessType.STAKE_GATED) {
            // Check accessor's stake in the system
            MPCParty storage party = parties[accessor];
            return (party.stake >= policy.minStake, version);
        }

        if (policy.accessType == AccessType.ROLE_BASED) {
            return (hasRole(policy.requiredRole, accessor), version);
        }

        if (policy.accessType == AccessType.TIME_LOCKED) {
            return (block.timestamp >= policy.unlockTime, version);
        }

        return (false, 0);
    }

    /**
     * @notice Record access to a key (called by MPC parties after decryption)
     * @param keyId Key that was accessed
     * @param accessor Address that accessed the key
     */
    function recordAccess(bytes32 keyId, address accessor) external onlyRole(OPERATOR_ROLE) {
        require(keys[keyId].createdAt != 0, "Key not found");

        lastAccess[keyId][accessor] = uint64(block.timestamp);
        accessCount[keyId]++;

        emit AccessGranted(keyId, accessor);
    }

    /**
     * @notice Register as an MPC party
     * @param enclaveId TEE enclave identifier (for attestation)
     */
    function registerParty(bytes32 enclaveId) external payable nonReentrant {
        require(msg.value >= minPartyStake, "Insufficient stake");
        require(!parties[msg.sender].active, "Already registered");

        parties[msg.sender] = MPCParty({
            partyAddress: msg.sender,
            enclaveId: enclaveId,
            stake: msg.value,
            registeredAt: uint64(block.timestamp),
            lastSeen: uint64(block.timestamp),
            active: true
        });

        partyList.push(msg.sender);

        emit PartyRegistered(msg.sender, enclaveId, msg.value);
    }

    /**
     * @notice Party heartbeat - proves party is online
     */
    function partyHeartbeat() external {
        require(parties[msg.sender].active, "Not a registered party");
        parties[msg.sender].lastSeen = uint64(block.timestamp);
    }

    /**
     * @notice Deactivate a party (guardian can slash stake)
     * @param party Party to deactivate
     */
    function deactivateParty(address party) external onlyRole(GUARDIAN_ROLE) {
        require(parties[party].active, "Party not active");
        parties[party].active = false;
        emit PartyDeactivated(party);
    }

    /**
     * @notice Update key access policy
     * @param keyId Key to update
     * @param newPolicy New access policy
     */
    function updatePolicy(bytes32 keyId, AccessPolicy calldata newPolicy) external {
        KeyMetadata storage key = keys[keyId];
        require(key.createdAt != 0, "Key not found");
        require(key.owner == msg.sender, "Not key owner");
        require(key.status == KeyStatus.ACTIVE, "Key not active");

        // Clear old allowlist if changing from ALLOWLIST
        if (key.policy.accessType == AccessType.ALLOWLIST) {
            for (uint256 i = 0; i < key.policy.allowlist.length; i++) {
                keyAllowlist[keyId][key.policy.allowlist[i]] = false;
            }
        }

        // Set up new allowlist if applicable
        if (newPolicy.accessType == AccessType.ALLOWLIST) {
            for (uint256 i = 0; i < newPolicy.allowlist.length; i++) {
                keyAllowlist[keyId][newPolicy.allowlist[i]] = true;
            }
        }

        key.policy = newPolicy;
        emit PolicyUpdated(keyId, newPolicy.accessType);
    }

    /**
     * @notice Add address to key allowlist
     */
    function addToAllowlist(bytes32 keyId, address addr) external {
        KeyMetadata storage key = keys[keyId];
        require(key.owner == msg.sender, "Not key owner");
        require(key.policy.accessType == AccessType.ALLOWLIST, "Not allowlist policy");
        keyAllowlist[keyId][addr] = true;
    }

    /**
     * @notice Remove address from key allowlist
     */
    function removeFromAllowlist(bytes32 keyId, address addr) external {
        KeyMetadata storage key = keys[keyId];
        require(key.owner == msg.sender, "Not key owner");
        keyAllowlist[keyId][addr] = false;
    }

    // View functions

    function getKey(bytes32 keyId) external view returns (KeyMetadata memory) {
        return keys[keyId];
    }

    function getKeyVersions(bytes32 keyId) external view returns (KeyVersion[] memory) {
        return keyVersions[keyId];
    }

    function getActiveParties() external view returns (address[] memory) {
        uint256 count = 0;
        uint64 staleThreshold = uint64(block.timestamp) - 5 minutes;

        for (uint256 i = 0; i < partyList.length; i++) {
            if (parties[partyList[i]].active && parties[partyList[i]].lastSeen >= staleThreshold) {
                count++;
            }
        }

        address[] memory active = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < partyList.length; i++) {
            if (parties[partyList[i]].active && parties[partyList[i]].lastSeen >= staleThreshold) {
                active[j++] = partyList[i];
            }
        }

        return active;
    }

    function getPartyCount() external view returns (uint256) {
        return partyList.length;
    }

    function _verifyActiveParties(uint32 required) internal view returns (bool) {
        uint256 count = 0;
        uint64 staleThreshold = uint64(block.timestamp) - 5 minutes;

        for (uint256 i = 0; i < partyList.length && count < required; i++) {
            if (parties[partyList[i]].active && parties[partyList[i]].lastSeen >= staleThreshold) {
                count++;
            }
        }

        return count >= required;
    }

    // Admin functions

    function setMinPartyStake(uint256 _minStake) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minPartyStake = _minStake;
    }

    function withdrawSlashedStake(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(to).transfer(amount);
    }
}
