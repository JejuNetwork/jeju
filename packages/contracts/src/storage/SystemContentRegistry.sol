// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SystemContentRegistry
 * @author Jeju Network
 * @notice Registry for forever-free system content that all nodes must seed
 * @dev Manages core apps, ABIs, JNS records, and network configuration
 *
 * System content is:
 * - Free to retrieve (no bandwidth charges)
 * - Required for all storage nodes to seed
 * - Governed by network governance
 * - Tracked on-chain with cryptographic proofs
 *
 * Content categories:
 * - CORE_APP: Core network applications (wallet, gateway, etc.)
 * - ABI: Contract ABIs for frontend integration
 * - JNS_RECORD: JNS registry snapshots
 * - CONFIG: Network configuration files
 * - GENESIS: Genesis/bootstrap data
 */
contract SystemContentRegistry is ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ============ Enums ============

    enum ContentCategory {
        CORE_APP,
        ABI,
        JNS_RECORD,
        CONFIG,
        GENESIS
    }

    enum ProofStatus {
        NOT_REQUIRED,
        PENDING,
        VERIFIED,
        FAILED
    }

    // ============ Structs ============

    struct SystemContent {
        bytes32 contentId;
        string cid;
        string name;
        ContentCategory category;
        uint256 size;
        bytes32 contentHash;
        uint256 version;
        uint256 addedAt;
        uint256 updatedAt;
        bool required;
        bool deprecated;
        string magnetUri;
        bytes32 arweaveTxId;
    }

    struct ManifestEntry {
        bytes32 contentId;
        string cid;
        bytes32 contentHash;
        uint256 version;
    }

    struct NodeCommitment {
        address node;
        bytes32 manifestHash;
        uint256 committedAt;
        uint256 lastProofAt;
        ProofStatus proofStatus;
        uint256 proofCount;
        uint256 failedProofs;
    }

    struct StorageProof {
        bytes32 contentId;
        address node;
        bytes32 challengeHash;
        bytes32 responseHash;
        uint256 timestamp;
        bool valid;
    }

    // ============ Constants ============

    uint256 private constant PROOF_CHALLENGE_WINDOW = 24 hours;
    uint256 private constant MAX_FAILED_PROOFS = 3;

    // ============ State ============

    /// @notice All registered system content
    mapping(bytes32 => SystemContent) public content;

    /// @notice Content IDs by category
    mapping(ContentCategory => EnumerableSet.Bytes32Set) private _contentByCategory;

    /// @notice All content IDs
    EnumerableSet.Bytes32Set private _allContent;

    /// @notice Required content IDs
    EnumerableSet.Bytes32Set private _requiredContent;

    /// @notice Current manifest hash (Merkle root of all required content)
    bytes32 public currentManifestHash;

    /// @notice Manifest version (increments on any change)
    uint256 public manifestVersion;

    /// @notice Node commitments to manifest
    mapping(address => NodeCommitment) public nodeCommitments;

    /// @notice Active storage proofs
    mapping(bytes32 => StorageProof) public activeProofs;

    /// @notice Challenge oracle address
    address public challengeOracle;

    /// @notice Governance timelock address
    address public governance;

    /// @notice CID to content ID mapping
    mapping(string => bytes32) public cidToContentId;

    /// @notice Content name to content ID mapping
    mapping(string => bytes32) public nameToContentId;

    // ============ Events ============

    event ContentAdded(
        bytes32 indexed contentId,
        string cid,
        string name,
        ContentCategory category,
        uint256 version
    );

    event ContentUpdated(
        bytes32 indexed contentId,
        string oldCid,
        string newCid,
        uint256 newVersion
    );

    event ContentDeprecated(bytes32 indexed contentId);
    event ContentRemoved(bytes32 indexed contentId);

    event ManifestUpdated(
        bytes32 indexed manifestHash,
        uint256 version,
        uint256 contentCount
    );

    event NodeCommitted(
        address indexed node,
        bytes32 indexed manifestHash,
        uint256 version
    );

    event ChallengeIssued(
        bytes32 indexed proofId,
        bytes32 indexed contentId,
        address indexed node,
        bytes32 challengeHash
    );

    event ChallengeResponded(
        bytes32 indexed proofId,
        address indexed node,
        bool valid
    );

    event NodeSlashed(
        address indexed node,
        uint256 failedProofs
    );

    // ============ Errors ============

    error ContentAlreadyExists();
    error ContentNotFound();
    error InvalidCID();
    error InvalidName();
    error NotGovernance();
    error NotChallengeOracle();
    error ChallengeExpired();
    error ChallengeNotFound();
    error NodeNotCommitted();
    error ManifestMismatch();

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) {
            revert NotGovernance();
        }
        _;
    }

    modifier onlyChallengeOracle() {
        if (msg.sender != challengeOracle && msg.sender != owner()) {
            revert NotChallengeOracle();
        }
        _;
    }

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {
        governance = initialOwner;
        manifestVersion = 1;
    }

    // ============ Content Management ============

    /**
     * @notice Add new system content
     * @param cid IPFS CID of the content
     * @param name Human-readable name
     * @param category Content category
     * @param size Content size in bytes
     * @param contentHash SHA256 hash of content
     * @param required Whether nodes must seed this content
     * @param magnetUri Optional WebTorrent magnet URI
     * @param arweaveTxId Optional Arweave transaction ID
     */
    function addContent(
        string calldata cid,
        string calldata name,
        ContentCategory category,
        uint256 size,
        bytes32 contentHash,
        bool required,
        string calldata magnetUri,
        bytes32 arweaveTxId
    ) external onlyGovernance returns (bytes32 contentId) {
        if (bytes(cid).length == 0) revert InvalidCID();
        if (bytes(name).length == 0) revert InvalidName();
        if (cidToContentId[cid] != bytes32(0)) revert ContentAlreadyExists();
        if (nameToContentId[name] != bytes32(0)) revert ContentAlreadyExists();

        contentId = keccak256(abi.encodePacked(cid, name, category, block.timestamp));

        content[contentId] = SystemContent({
            contentId: contentId,
            cid: cid,
            name: name,
            category: category,
            size: size,
            contentHash: contentHash,
            version: 1,
            addedAt: block.timestamp,
            updatedAt: block.timestamp,
            required: required,
            deprecated: false,
            magnetUri: magnetUri,
            arweaveTxId: arweaveTxId
        });

        _allContent.add(contentId);
        _contentByCategory[category].add(contentId);
        cidToContentId[cid] = contentId;
        nameToContentId[name] = contentId;

        if (required) {
            _requiredContent.add(contentId);
        }

        _updateManifest();

        emit ContentAdded(contentId, cid, name, category, 1);
    }

    /**
     * @notice Update existing content with new CID (new version)
     * @param contentId Content to update
     * @param newCid New IPFS CID
     * @param newSize New content size
     * @param newContentHash New SHA256 hash
     * @param newMagnetUri New magnet URI
     * @param newArweaveTxId New Arweave transaction ID
     */
    function updateContent(
        bytes32 contentId,
        string calldata newCid,
        uint256 newSize,
        bytes32 newContentHash,
        string calldata newMagnetUri,
        bytes32 newArweaveTxId
    ) external onlyGovernance {
        SystemContent storage c = content[contentId];
        if (c.addedAt == 0) revert ContentNotFound();
        if (bytes(newCid).length == 0) revert InvalidCID();

        string memory oldCid = c.cid;

        // Clear old CID mapping
        delete cidToContentId[oldCid];

        // Update content
        c.cid = newCid;
        c.size = newSize;
        c.contentHash = newContentHash;
        c.magnetUri = newMagnetUri;
        c.arweaveTxId = newArweaveTxId;
        c.version++;
        c.updatedAt = block.timestamp;

        // Set new CID mapping
        cidToContentId[newCid] = contentId;

        _updateManifest();

        emit ContentUpdated(contentId, oldCid, newCid, c.version);
    }

    /**
     * @notice Mark content as deprecated (still seeded but not required for new nodes)
     */
    function deprecateContent(bytes32 contentId) external onlyGovernance {
        SystemContent storage c = content[contentId];
        if (c.addedAt == 0) revert ContentNotFound();

        c.deprecated = true;
        c.required = false;
        _requiredContent.remove(contentId);

        _updateManifest();

        emit ContentDeprecated(contentId);
    }

    /**
     * @notice Remove content completely (use with caution)
     */
    function removeContent(bytes32 contentId) external onlyGovernance {
        SystemContent storage c = content[contentId];
        if (c.addedAt == 0) revert ContentNotFound();

        // Clear mappings
        delete cidToContentId[c.cid];
        delete nameToContentId[c.name];

        // Remove from sets
        _allContent.remove(contentId);
        _contentByCategory[c.category].remove(contentId);
        _requiredContent.remove(contentId);

        // Clear storage
        delete content[contentId];

        _updateManifest();

        emit ContentRemoved(contentId);
    }

    /**
     * @notice Set content as required or not required
     */
    function setRequired(bytes32 contentId, bool required) external onlyGovernance {
        SystemContent storage c = content[contentId];
        if (c.addedAt == 0) revert ContentNotFound();

        c.required = required;

        if (required) {
            _requiredContent.add(contentId);
        } else {
            _requiredContent.remove(contentId);
        }

        _updateManifest();
    }

    // ============ Node Commitment ============

    /**
     * @notice Commit to seeding the current manifest
     */
    function commitToManifest() external {
        nodeCommitments[msg.sender] = NodeCommitment({
            node: msg.sender,
            manifestHash: currentManifestHash,
            committedAt: block.timestamp,
            lastProofAt: block.timestamp,
            proofStatus: ProofStatus.PENDING,
            proofCount: 0,
            failedProofs: 0
        });

        emit NodeCommitted(msg.sender, currentManifestHash, manifestVersion);
    }

    /**
     * @notice Update commitment to latest manifest
     */
    function updateCommitment() external {
        NodeCommitment storage commitment = nodeCommitments[msg.sender];
        if (commitment.committedAt == 0) revert NodeNotCommitted();

        commitment.manifestHash = currentManifestHash;
        commitment.lastProofAt = block.timestamp;

        emit NodeCommitted(msg.sender, currentManifestHash, manifestVersion);
    }

    // ============ Storage Proofs ============

    /**
     * @notice Issue a challenge to a node to prove storage
     * @param node Node to challenge
     * @param contentId Content to prove
     * @param challengeHash Random challenge data
     */
    function issueChallenge(
        address node,
        bytes32 contentId,
        bytes32 challengeHash
    ) external onlyChallengeOracle returns (bytes32 proofId) {
        NodeCommitment storage commitment = nodeCommitments[node];
        if (commitment.committedAt == 0) revert NodeNotCommitted();

        SystemContent storage c = content[contentId];
        if (c.addedAt == 0) revert ContentNotFound();

        proofId = keccak256(abi.encodePacked(
            node,
            contentId,
            challengeHash,
            block.timestamp
        ));

        activeProofs[proofId] = StorageProof({
            contentId: contentId,
            node: node,
            challengeHash: challengeHash,
            responseHash: bytes32(0),
            timestamp: block.timestamp,
            valid: false
        });

        emit ChallengeIssued(proofId, contentId, node, challengeHash);
    }

    /**
     * @notice Respond to a storage challenge
     * @param proofId Proof ID from challenge
     * @param responseHash Response to challenge
     * @param signature Oracle signature validating response
     */
    function respondToChallenge(
        bytes32 proofId,
        bytes32 responseHash,
        bytes calldata signature
    ) external nonReentrant {
        StorageProof storage proof = activeProofs[proofId];
        if (proof.timestamp == 0) revert ChallengeNotFound();
        if (block.timestamp > proof.timestamp + PROOF_CHALLENGE_WINDOW) {
            revert ChallengeExpired();
        }

        // Verify oracle signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            proofId,
            responseHash,
            proof.node
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        bool valid = signer == challengeOracle;

        proof.responseHash = responseHash;
        proof.valid = valid;

        NodeCommitment storage commitment = nodeCommitments[proof.node];
        commitment.lastProofAt = block.timestamp;

        if (valid) {
            commitment.proofStatus = ProofStatus.VERIFIED;
            commitment.proofCount++;
        } else {
            commitment.failedProofs++;
            if (commitment.failedProofs >= MAX_FAILED_PROOFS) {
                commitment.proofStatus = ProofStatus.FAILED;
                emit NodeSlashed(proof.node, commitment.failedProofs);
            }
        }

        emit ChallengeResponded(proofId, proof.node, valid);
    }

    // ============ View Functions ============

    /**
     * @notice Get content by ID
     */
    function getContent(bytes32 contentId) external view returns (SystemContent memory) {
        return content[contentId];
    }

    /**
     * @notice Get content by CID
     */
    function getContentByCID(string calldata cid) external view returns (SystemContent memory) {
        bytes32 contentId = cidToContentId[cid];
        return content[contentId];
    }

    /**
     * @notice Get content by name
     */
    function getContentByName(string calldata name) external view returns (SystemContent memory) {
        bytes32 contentId = nameToContentId[name];
        return content[contentId];
    }

    /**
     * @notice Get all content IDs
     */
    function getAllContentIds() external view returns (bytes32[] memory) {
        return _allContent.values();
    }

    /**
     * @notice Get required content IDs
     */
    function getRequiredContentIds() external view returns (bytes32[] memory) {
        return _requiredContent.values();
    }

    /**
     * @notice Get content IDs by category
     */
    function getContentByCategory(ContentCategory category) external view returns (bytes32[] memory) {
        return _contentByCategory[category].values();
    }

    /**
     * @notice Get total content count
     */
    function getTotalContentCount() external view returns (uint256) {
        return _allContent.length();
    }

    /**
     * @notice Get required content count
     */
    function getRequiredContentCount() external view returns (uint256) {
        return _requiredContent.length();
    }

    /**
     * @notice Get node commitment
     */
    function getNodeCommitment(address node) external view returns (NodeCommitment memory) {
        return nodeCommitments[node];
    }

    /**
     * @notice Check if node is committed to current manifest
     */
    function isNodeCommitted(address node) external view returns (bool) {
        NodeCommitment storage commitment = nodeCommitments[node];
        return commitment.committedAt > 0 && 
               commitment.manifestHash == currentManifestHash &&
               commitment.proofStatus != ProofStatus.FAILED;
    }

    /**
     * @notice Get manifest entries for building client-side manifest
     */
    function getManifestEntries() external view returns (ManifestEntry[] memory entries) {
        bytes32[] memory ids = _requiredContent.values();
        entries = new ManifestEntry[](ids.length);

        for (uint256 i = 0; i < ids.length; i++) {
            SystemContent storage c = content[ids[i]];
            entries[i] = ManifestEntry({
                contentId: ids[i],
                cid: c.cid,
                contentHash: c.contentHash,
                version: c.version
            });
        }
    }

    /**
     * @notice Verify a manifest hash matches current
     */
    function verifyManifest(bytes32 manifestHash) external view returns (bool) {
        return manifestHash == currentManifestHash;
    }

    // ============ Admin Functions ============

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
    }

    function setChallengeOracle(address _oracle) external onlyOwner {
        challengeOracle = _oracle;
    }

    // ============ Internal Functions ============

    /**
     * @notice Update the manifest hash after content changes
     */
    function _updateManifest() internal {
        bytes32[] memory ids = _requiredContent.values();

        // Sort IDs for deterministic hashing
        _sortBytes32Array(ids);

        // Build manifest hash from sorted content
        bytes memory manifestData;
        for (uint256 i = 0; i < ids.length; i++) {
            SystemContent storage c = content[ids[i]];
            manifestData = abi.encodePacked(
                manifestData,
                c.contentId,
                c.contentHash,
                c.version
            );
        }

        currentManifestHash = keccak256(manifestData);
        manifestVersion++;

        emit ManifestUpdated(currentManifestHash, manifestVersion, ids.length);
    }

    /**
     * @notice Sort bytes32 array in place (simple bubble sort for small arrays)
     */
    function _sortBytes32Array(bytes32[] memory arr) internal pure {
        uint256 n = arr.length;
        for (uint256 i = 0; i < n - 1; i++) {
            for (uint256 j = 0; j < n - i - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    bytes32 temp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = temp;
                }
            }
        }
    }
}
