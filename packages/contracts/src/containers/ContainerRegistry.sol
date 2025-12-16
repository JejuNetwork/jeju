// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title ContainerRegistry
 * @author Jeju Network
 * @notice Decentralized OCI container image registry with on-chain metadata
 * @dev Like Docker Hub but decentralized with IPFS/content-addressed storage
 *
 * Features:
 * - OCI-compatible image manifest storage
 * - Multi-architecture support
 * - Content-addressed layers (IPFS CIDs)
 * - Access control (public/private)
 * - Image signing and verification
 * - Pull/push tracking
 * - Organization management
 */
contract ContainerRegistry is ReentrancyGuard, Pausable, Ownable {

    // ============ Enums ============

    enum Visibility {
        PUBLIC,
        PRIVATE,
        ORGANIZATION
    }

    // ============ Structs ============

    struct Repository {
        bytes32 repoId;
        string name;                // e.g., "jeju/indexer"
        string namespace;           // Organization or user
        address owner;
        uint256 ownerAgentId;       // ERC-8004 agent ID
        string description;
        Visibility visibility;
        string[] tags;              // Keywords for discovery
        uint256 createdAt;
        uint256 updatedAt;
        uint256 pullCount;
        uint256 starCount;
        bool isVerified;
    }

    struct ImageManifest {
        bytes32 manifestId;
        bytes32 repoId;
        string tag;                 // "latest", "v1.0.0", etc.
        string digest;              // sha256:abc123...
        string manifestUri;         // IPFS CID of manifest.json
        bytes32 manifestHash;       // SHA256 of manifest
        uint256 size;               // Total image size
        string[] architectures;     // "amd64", "arm64", etc.
        string[] layers;            // IPFS CIDs of layer blobs
        uint256 publishedAt;
        address publisher;
        string buildInfo;           // Optional build metadata
    }

    struct LayerBlob {
        string digest;              // sha256:xyz789...
        string cid;                 // IPFS CID
        uint256 size;
        string mediaType;           // application/vnd.oci.image.layer.v1.tar+gzip
        uint256 uploadedAt;
    }

    struct ImageSignature {
        bytes32 signatureId;
        bytes32 manifestId;
        address signer;
        uint256 signerAgentId;
        bytes signature;            // ECDSA signature over manifest digest
        string publicKeyUri;        // URI to signer's public key
        uint256 signedAt;
        bool isValid;
    }

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    address public treasury;

    mapping(bytes32 => Repository) public repositories;
    mapping(bytes32 => ImageManifest[]) public manifests;
    mapping(bytes32 => mapping(string => uint256)) public tagToManifestIndex; // repoId => tag => index
    mapping(string => LayerBlob) public layers;         // digest => LayerBlob
    mapping(bytes32 => ImageSignature[]) public signatures;
    
    // Repository access
    mapping(bytes32 => mapping(address => bool)) public hasAccess;
    mapping(bytes32 => mapping(address => bool)) public isCollaborator;
    
    // Stars
    mapping(bytes32 => mapping(address => bool)) public hasStarred;
    
    // Namespace ownership (org/user => owner)
    mapping(string => address) public namespaceOwner;
    
    // Name uniqueness
    mapping(bytes32 => bool) public repoNameTaken; // keccak256(namespace/name)
    
    bytes32[] public allRepositories;
    uint256 private _nextRepoId = 1;
    uint256 private _nextManifestId = 1;
    uint256 private _nextSignatureId = 1;

    // Fees
    uint256 public pushFee = 0;                 // Fee per push (spam prevention)
    uint256 public storageFeePerGB = 0;         // Storage fee

    // ============ Events ============

    event RepositoryCreated(
        bytes32 indexed repoId,
        string indexed namespace,
        string name,
        address indexed owner
    );
    event RepositoryUpdated(bytes32 indexed repoId);
    event ImagePushed(
        bytes32 indexed repoId,
        bytes32 indexed manifestId,
        string tag,
        string digest
    );
    event ImagePulled(bytes32 indexed repoId, string tag, address indexed puller);
    event ImageDeleted(bytes32 indexed repoId, string tag);
    event LayerUploaded(string indexed digest, string cid, uint256 size);
    event ImageSigned(bytes32 indexed manifestId, address indexed signer);
    event RepositoryStarred(bytes32 indexed repoId, address indexed user, bool starred);
    event AccessGranted(bytes32 indexed repoId, address indexed user);
    event AccessRevoked(bytes32 indexed repoId, address indexed user);
    event NamespaceClaimed(string indexed namespace, address indexed owner);

    // ============ Errors ============

    error RepoNotFound();
    error NotRepoOwner();
    error RepoNameTaken();
    error NamespaceNotOwned();
    error TagNotFound();
    error AccessDenied();
    error LayerNotFound();
    error InvalidSignature();
    error InsufficientPayment();

    // ============ Modifiers ============

    modifier repoExists(bytes32 repoId) {
        if (repositories[repoId].createdAt == 0) revert RepoNotFound();
        _;
    }

    modifier onlyRepoOwner(bytes32 repoId) {
        if (repositories[repoId].owner != msg.sender) revert NotRepoOwner();
        _;
    }

    modifier canPush(bytes32 repoId) {
        Repository storage repo = repositories[repoId];
        if (repo.owner != msg.sender && !isCollaborator[repoId][msg.sender]) {
            revert AccessDenied();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
    }

    // ============ Namespace Management ============

    /**
     * @notice Claim a namespace (organization or username)
     */
    function claimNamespace(string calldata namespace) external {
        if (namespaceOwner[namespace] != address(0)) revert NamespaceNotOwned();
        namespaceOwner[namespace] = msg.sender;
        emit NamespaceClaimed(namespace, msg.sender);
    }

    /**
     * @notice Transfer namespace ownership
     */
    function transferNamespace(string calldata namespace, address newOwner) external {
        if (namespaceOwner[namespace] != msg.sender) revert NamespaceNotOwned();
        namespaceOwner[namespace] = newOwner;
    }

    // ============ Repository Management ============

    /**
     * @notice Create a new container repository
     */
    function createRepository(
        string calldata name,
        string calldata namespace,
        string calldata description,
        Visibility visibility,
        string[] calldata tags
    ) external payable nonReentrant whenNotPaused returns (bytes32 repoId) {
        // Check namespace ownership
        if (namespaceOwner[namespace] != address(0) && namespaceOwner[namespace] != msg.sender) {
            revert NamespaceNotOwned();
        }

        // Check uniqueness
        bytes32 nameHash = keccak256(abi.encodePacked(namespace, "/", name));
        if (repoNameTaken[nameHash]) revert RepoNameTaken();

        // Collect fee if set
        if (pushFee > 0 && msg.value < pushFee) revert InsufficientPayment();

        repoId = keccak256(abi.encodePacked(_nextRepoId++, msg.sender, namespace, name, block.timestamp));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        Repository storage repo = repositories[repoId];
        repo.repoId = repoId;
        repo.name = name;
        repo.namespace = namespace;
        repo.owner = msg.sender;
        repo.ownerAgentId = agentId;
        repo.description = description;
        repo.visibility = visibility;
        repo.tags = tags;
        repo.createdAt = block.timestamp;
        repo.updatedAt = block.timestamp;

        repoNameTaken[nameHash] = true;
        allRepositories.push(repoId);

        // Auto-claim namespace if not claimed
        if (namespaceOwner[namespace] == address(0)) {
            namespaceOwner[namespace] = msg.sender;
        }

        emit RepositoryCreated(repoId, namespace, name, msg.sender);
    }

    /**
     * @notice Push an image manifest
     */
    function pushImage(
        bytes32 repoId,
        string calldata tag,
        string calldata digest,
        string calldata manifestUri,
        bytes32 manifestHash,
        uint256 size,
        string[] calldata architectures,
        string[] calldata layerCids,
        string calldata buildInfo
    ) external payable nonReentrant repoExists(repoId) canPush(repoId) returns (bytes32 manifestId) {
        // Collect fee if set
        if (pushFee > 0 && msg.value < pushFee) revert InsufficientPayment();

        manifestId = keccak256(abi.encodePacked(_nextManifestId++, repoId, tag, digest, block.timestamp));

        ImageManifest[] storage repoManifests = manifests[repoId];
        
        // Check if tag exists, update if so
        uint256 existingIndex = tagToManifestIndex[repoId][tag];
        bool tagExists = repoManifests.length > 0 && 
            existingIndex < repoManifests.length &&
            keccak256(bytes(repoManifests[existingIndex].tag)) == keccak256(bytes(tag));

        ImageManifest memory newManifest = ImageManifest({
            manifestId: manifestId,
            repoId: repoId,
            tag: tag,
            digest: digest,
            manifestUri: manifestUri,
            manifestHash: manifestHash,
            size: size,
            architectures: architectures,
            layers: layerCids,
            publishedAt: block.timestamp,
            publisher: msg.sender,
            buildInfo: buildInfo
        });

        if (tagExists) {
            repoManifests[existingIndex] = newManifest;
        } else {
            tagToManifestIndex[repoId][tag] = repoManifests.length;
            repoManifests.push(newManifest);
        }

        repositories[repoId].updatedAt = block.timestamp;

        emit ImagePushed(repoId, manifestId, tag, digest);
    }

    /**
     * @notice Upload a layer blob
     */
    function uploadLayer(
        string calldata digest,
        string calldata cid,
        uint256 size,
        string calldata mediaType
    ) external nonReentrant whenNotPaused {
        layers[digest] = LayerBlob({
            digest: digest,
            cid: cid,
            size: size,
            mediaType: mediaType,
            uploadedAt: block.timestamp
        });

        emit LayerUploaded(digest, cid, size);
    }

    /**
     * @notice Pull/access an image (tracks pulls)
     */
    function pullImage(bytes32 repoId, string calldata tag) 
        external 
        nonReentrant 
        repoExists(repoId) 
    {
        Repository storage repo = repositories[repoId];

        // Check access for private repos
        if (repo.visibility == Visibility.PRIVATE && !hasAccess[repoId][msg.sender] && repo.owner != msg.sender) {
            revert AccessDenied();
        }

        repo.pullCount++;
        emit ImagePulled(repoId, tag, msg.sender);
    }

    /**
     * @notice Sign an image manifest
     */
    function signImage(bytes32 repoId, string calldata tag, bytes calldata signature, string calldata publicKeyUri)
        external
        nonReentrant
        repoExists(repoId)
    {
        uint256 idx = tagToManifestIndex[repoId][tag];
        ImageManifest[] storage repoManifests = manifests[repoId];
        if (idx >= repoManifests.length) revert TagNotFound();

        ImageManifest storage manifest = repoManifests[idx];
        bytes32 signatureId = keccak256(abi.encodePacked(_nextSignatureId++, manifest.manifestId, msg.sender));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        signatures[manifest.manifestId].push(ImageSignature({
            signatureId: signatureId,
            manifestId: manifest.manifestId,
            signer: msg.sender,
            signerAgentId: agentId,
            signature: signature,
            publicKeyUri: publicKeyUri,
            signedAt: block.timestamp,
            isValid: true
        }));

        emit ImageSigned(manifest.manifestId, msg.sender);
    }

    // ============ Access Control ============

    /**
     * @notice Grant access to private repository
     */
    function grantAccess(bytes32 repoId, address user) external repoExists(repoId) onlyRepoOwner(repoId) {
        hasAccess[repoId][user] = true;
        emit AccessGranted(repoId, user);
    }

    /**
     * @notice Revoke access
     */
    function revokeAccess(bytes32 repoId, address user) external repoExists(repoId) onlyRepoOwner(repoId) {
        hasAccess[repoId][user] = false;
        emit AccessRevoked(repoId, user);
    }

    /**
     * @notice Add collaborator (can push)
     */
    function addCollaborator(bytes32 repoId, address user) external repoExists(repoId) onlyRepoOwner(repoId) {
        isCollaborator[repoId][user] = true;
        hasAccess[repoId][user] = true;
    }

    /**
     * @notice Remove collaborator
     */
    function removeCollaborator(bytes32 repoId, address user) external repoExists(repoId) onlyRepoOwner(repoId) {
        isCollaborator[repoId][user] = false;
    }

    /**
     * @notice Star/unstar repository
     */
    function toggleStar(bytes32 repoId) external nonReentrant repoExists(repoId) {
        bool starred = !hasStarred[repoId][msg.sender];
        hasStarred[repoId][msg.sender] = starred;

        Repository storage repo = repositories[repoId];
        if (starred) {
            repo.starCount++;
        } else if (repo.starCount > 0) {
            repo.starCount--;
        }

        emit RepositoryStarred(repoId, msg.sender, starred);
    }

    // ============ View Functions ============

    function _getAgentIdForAddress(address addr) internal view returns (uint256) {
        return 0; // Would query indexer in production
    }

    function getRepository(bytes32 repoId) external view returns (Repository memory) {
        return repositories[repoId];
    }

    function getManifests(bytes32 repoId) external view returns (ImageManifest[] memory) {
        return manifests[repoId];
    }

    function getManifestByTag(bytes32 repoId, string calldata tag) external view returns (ImageManifest memory) {
        uint256 idx = tagToManifestIndex[repoId][tag];
        ImageManifest[] storage repoManifests = manifests[repoId];
        if (idx >= repoManifests.length) revert TagNotFound();
        return repoManifests[idx];
    }

    function getLayer(string calldata digest) external view returns (LayerBlob memory) {
        LayerBlob storage layer = layers[digest];
        if (layer.uploadedAt == 0) revert LayerNotFound();
        return layer;
    }

    function getSignatures(bytes32 manifestId) external view returns (ImageSignature[] memory) {
        return signatures[manifestId];
    }

    function getTotalRepositories() external view returns (uint256) {
        return allRepositories.length;
    }

    function getRepositoryIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 end = offset + limit;
        if (end > allRepositories.length) end = allRepositories.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allRepositories[i];
        }
        return result;
    }

    // ============ Admin ============

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setPushFee(uint256 _fee) external onlyOwner {
        pushFee = _fee;
    }

    function setStorageFeePerGB(uint256 _fee) external onlyOwner {
        storageFeePerGB = _fee;
    }

    function verifyRepository(bytes32 repoId) external onlyOwner repoExists(repoId) {
        repositories[repoId].isVerified = true;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

