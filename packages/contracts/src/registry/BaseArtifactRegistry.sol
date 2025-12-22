// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/**
 * @title BaseArtifactRegistry
 * @notice Base contract for artifact registries (Containers, Models, etc.)
 * @dev Handles common logic for:
 *      - Repository/Artifact creation and management
 *      - Access control (Public, Private, Gated)
 *      - Versioning
 *      - Star counting
 *      - Namespace management
 *      - Fees
 */
abstract contract BaseArtifactRegistry is Ownable, Pausable, ReentrancyGuard {
    enum Visibility {
        PUBLIC,
        PRIVATE,
        ORGANIZATION,
        GATED
    }

    struct Artifact {
        bytes32 id;
        string name;
        string namespace;
        address owner;
        uint256 ownerAgentId;
        Visibility visibility;
        string description;
        string[] tags;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 downloadCount; // or pullCount
        uint256 starCount;
        bool isVerified;
        bool isActive;
    }

    struct ArtifactVersion {
        bytes32 versionId;
        bytes32 artifactId;
        string version; // tag or version string
        string contentUri; // Main IPFS CID (manifest or weights)
        bytes32 contentHash; // SHA256 of content
        uint256 size;
        uint256 publishedAt;
        address publisher;
        bool isLatest;
        // Additional metadata can be added in derived contracts or separate mappings
    }

    IdentityRegistry public immutable identityRegistry;
    address public treasury;

    mapping(bytes32 => Artifact) public artifacts;
    mapping(bytes32 => ArtifactVersion[]) public versions;
    mapping(bytes32 => mapping(string => uint256)) public versionIndex; // artifactId => versionTag => index
    
    // Access control
    mapping(bytes32 => mapping(address => bool)) public hasAccess;
    mapping(bytes32 => mapping(address => bool)) public isCollaborator;
    
    // Stars
    mapping(bytes32 => mapping(address => bool)) public hasStarred;
    
    // Namespace ownership (org/user => owner)
    mapping(string => address) public namespaceOwner;
    
    // Name uniqueness: keccak256(namespace/name)
    mapping(bytes32 => bool) public nameTaken;
    
    bytes32[] public allArtifacts;
    
    // Fees
    uint256 public publishFee;
    uint256 public storageFeePerGB;

    // Events
    event ArtifactCreated(bytes32 indexed id, string indexed namespace, string name, address indexed owner);
    event ArtifactUpdated(bytes32 indexed id);
    event VersionPublished(bytes32 indexed artifactId, bytes32 indexed versionId, string version, address indexed publisher);
    event AccessGranted(bytes32 indexed artifactId, address indexed user);
    event AccessRevoked(bytes32 indexed artifactId, address indexed user);
    event ArtifactStarred(bytes32 indexed artifactId, address indexed user, bool starred);
    event NamespaceClaimed(string indexed namespace, address indexed owner);

    // Errors
    error NotFound();
    error NotOwner();
    error AlreadyExists();
    error NamespaceNotOwned();
    error AccessDenied();
    error InsufficientPayment();
    error InvalidVersion();

    modifier exists(bytes32 id) {
        if (artifacts[id].createdAt == 0) revert NotFound();
        _;
    }

    modifier onlyArtifactOwner(bytes32 id) {
        if (artifacts[id].owner != msg.sender) revert NotOwner();
        _;
    }

    modifier canPublish(bytes32 id) {
        if (artifacts[id].owner != msg.sender && !isCollaborator[id][msg.sender]) {
            revert AccessDenied();
        }
        _;
    }

    constructor(address _identityRegistry, address _treasury, address _initialOwner) Ownable(_initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
    }

    function _createArtifact(
        bytes32 id,
        string memory name,
        string memory namespace,
        Visibility visibility,
        string memory description,
        string[] memory tags,
        uint256 agentId
    ) internal {
        // Check namespace ownership
        if (namespaceOwner[namespace] != address(0) && namespaceOwner[namespace] != msg.sender) {
            revert NamespaceNotOwned();
        }

        // Check uniqueness
        bytes32 nameHash = keccak256(abi.encodePacked(namespace, "/", name));
        if (nameTaken[nameHash]) revert AlreadyExists();

        Artifact storage artifact = artifacts[id];
        artifact.id = id;
        artifact.name = name;
        artifact.namespace = namespace;
        artifact.owner = msg.sender;
        artifact.ownerAgentId = agentId;
        artifact.visibility = visibility;
        artifact.description = description;
        artifact.tags = tags;
        artifact.createdAt = block.timestamp;
        artifact.updatedAt = block.timestamp;
        artifact.isActive = true;

        nameTaken[nameHash] = true;
        allArtifacts.push(id);

        // Auto-claim namespace if not claimed
        if (namespaceOwner[namespace] == address(0)) {
            namespaceOwner[namespace] = msg.sender;
        }

        emit ArtifactCreated(id, namespace, name, msg.sender);
    }

    function _publishVersion(
        bytes32 artifactId,
        bytes32 versionId,
        string memory version,
        string memory contentUri,
        bytes32 contentHash,
        uint256 size
    ) internal returns (uint256 index) {
        ArtifactVersion[] storage artifactVersions = versions[artifactId];
        
        // Mark previous versions as not latest
        for (uint256 i = 0; i < artifactVersions.length; i++) {
            artifactVersions[i].isLatest = false;
        }

        uint256 existingIndex = versionIndex[artifactId][version];
        bool versionExists = artifactVersions.length > 0 && 
            existingIndex < artifactVersions.length &&
            keccak256(bytes(artifactVersions[existingIndex].version)) == keccak256(bytes(version));

        ArtifactVersion memory newVersion = ArtifactVersion({
            versionId: versionId,
            artifactId: artifactId,
            version: version,
            contentUri: contentUri,
            contentHash: contentHash,
            size: size,
            publishedAt: block.timestamp,
            publisher: msg.sender,
            isLatest: true
        });

        if (versionExists) {
            artifactVersions[existingIndex] = newVersion;
            index = existingIndex;
        } else {
            index = artifactVersions.length;
            versionIndex[artifactId][version] = index;
            artifactVersions.push(newVersion);
        }

        artifacts[artifactId].updatedAt = block.timestamp;
        emit VersionPublished(artifactId, versionId, version, msg.sender);
    }

    // Common public methods

    function claimNamespace(string calldata namespace) external {
        if (namespaceOwner[namespace] != address(0)) revert NamespaceNotOwned();
        namespaceOwner[namespace] = msg.sender;
        emit NamespaceClaimed(namespace, msg.sender);
    }

    function transferNamespace(string calldata namespace, address newOwner) external {
        if (namespaceOwner[namespace] != msg.sender) revert NamespaceNotOwned();
        namespaceOwner[namespace] = newOwner;
    }

    function grantAccess(bytes32 id, address user) external exists(id) onlyArtifactOwner(id) {
        hasAccess[id][user] = true;
        emit AccessGranted(id, user);
    }

    function revokeAccess(bytes32 id, address user) external exists(id) onlyArtifactOwner(id) {
        hasAccess[id][user] = false;
        emit AccessRevoked(id, user);
    }

    function addCollaborator(bytes32 id, address user) external exists(id) onlyArtifactOwner(id) {
        isCollaborator[id][user] = true;
        hasAccess[id][user] = true; // Collaborators imply access
    }

    function removeCollaborator(bytes32 id, address user) external exists(id) onlyArtifactOwner(id) {
        isCollaborator[id][user] = false;
    }

    function toggleStar(bytes32 id) external nonReentrant exists(id) {
        bool starred = !hasStarred[id][msg.sender];
        hasStarred[id][msg.sender] = starred;

        Artifact storage artifact = artifacts[id];
        if (starred) {
            artifact.starCount++;
        } else if (artifact.starCount > 0) {
            artifact.starCount--;
        }

        emit ArtifactStarred(id, msg.sender, starred);
    }

    function checkAccess(bytes32 id, address user) public view virtual returns (bool) {
        Artifact storage artifact = artifacts[id];
        if (artifact.visibility == Visibility.PUBLIC) return true;
        if (artifact.owner == user) return true;
        return hasAccess[id][user];
    }

    // Admin

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setPublishFee(uint256 _fee) external onlyOwner {
        publishFee = _fee;
    }

    function setStorageFeePerGB(uint256 _fee) external onlyOwner {
        storageFeePerGB = _fee;
    }

    function verifyArtifact(bytes32 id) external onlyOwner exists(id) {
        artifacts[id].isVerified = true;
    }

    function unverifyArtifact(bytes32 id) external onlyOwner exists(id) {
        artifacts[id].isVerified = false;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }
}
