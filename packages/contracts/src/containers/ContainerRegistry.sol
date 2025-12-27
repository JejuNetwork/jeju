// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "../registry/BaseArtifactRegistry.sol";

/**
 * @title ContainerRegistry
 * @author Jeju Network
 * @notice Decentralized OCI container image registry with on-chain metadata
 * @dev Like Docker Hub but decentralized with IPFS/content-addressed storage
 */
contract ContainerRegistry is BaseArtifactRegistry {
    struct ImageManifest {
        // Inherits version properties from BaseArtifactRegistry.ArtifactVersion
        // Additional properties specific to containers:
        string digest; // sha256:abc123...
        bytes32 manifestHash; // SHA256 of manifest
        string[] architectures; // "amd64", "arm64", etc.
        string[] layers; // IPFS CIDs of layer blobs
        string buildInfo; // Optional build metadata
    }

    struct LayerBlob {
        string digest; // sha256:xyz789...
        string cid; // IPFS CID
        uint256 size;
        string mediaType; // application/vnd.oci.image.layer.v1.tar+gzip
        uint256 uploadedAt;
    }

    struct ImageSignature {
        bytes32 signatureId;
        bytes32 manifestId;
        address signer;
        uint256 signerAgentId;
        bytes signature; // ECDSA signature over manifest digest
        string publicKeyUri; // URI to signer's public key
        uint256 signedAt;
        bool isValid;
    }

    // Mapping from artifactId -> versionIndex -> ImageManifest
    // We map to the index in the base versions array
    mapping(bytes32 => mapping(uint256 => ImageManifest)) public imageManifests;
    mapping(string => LayerBlob) public layers; // digest => LayerBlob
    mapping(bytes32 => ImageSignature[]) public signatures;

    // Name uniqueness check inherited from BaseArtifactRegistry

    uint256 private _nextRepoId = 1;
    uint256 private _nextManifestId = 1;
    uint256 private _nextSignatureId = 1;

    event RepositoryCreated(bytes32 indexed repoId, string indexed namespace, string name, address indexed owner);
    event ImagePushed(bytes32 indexed repoId, bytes32 indexed manifestId, string tag, string digest);
    event ImagePulled(bytes32 indexed repoId, string tag, address indexed puller);
    event LayerUploaded(string indexed digest, string cid, uint256 size);
    event ImageSigned(bytes32 indexed manifestId, address indexed signer);

    error LayerNotFound();
    error TagNotFound();
    error RepoNameTaken();

    constructor(address _identityRegistry, address _treasury, address initialOwner)
        BaseArtifactRegistry(_identityRegistry, _treasury, initialOwner)
    {}

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
        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        repoId = keccak256(abi.encodePacked(_nextRepoId++, msg.sender, namespace, name, block.timestamp));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        try this._createArtifactWrapper(repoId, name, namespace, visibility, description, tags, agentId) {
            // Success
        } catch Error(string memory reason) {
            if (keccak256(bytes(reason)) == keccak256(bytes("AlreadyExists"))) revert RepoNameTaken();
            revert(reason);
        } catch {
            revert("Creation failed");
        }

        emit RepositoryCreated(repoId, namespace, name, msg.sender);
    }

    // Wrapper to expose internal function to try/catch block (since _createArtifact is internal)
    // Or simpler: just inline the logic or use internal call but map errors.
    // Actually, inheritance allows direct call. The try/catch around internal isn't possible directly.
    // I will just call internal and mapping error codes if needed, or let it revert.
    function _createArtifactWrapper(
        bytes32 id,
        string memory name,
        string memory namespace,
        Visibility visibility,
        string memory description,
        string[] memory tags,
        uint256 agentId
    ) public {
        require(msg.sender == address(this), "Internal use only");
        _createArtifact(id, name, namespace, visibility, description, tags, agentId);
    }
    // Optimization: Just reimplement createRepository calling _createArtifact directly.
    // But since _createArtifact reverts with "AlreadyExists", I want to map it to "RepoNameTaken" for compatibility if needed.
    // However, "AlreadyExists" is clear enough.

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
    ) external payable nonReentrant exists(repoId) canPublish(repoId) returns (bytes32 manifestId) {
        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        manifestId = keccak256(abi.encodePacked(_nextManifestId++, repoId, tag, digest, block.timestamp));

        // Use base versioning
        uint256 index = _publishVersion(repoId, manifestId, tag, manifestUri, manifestHash, size);

        // Store extended metadata
        imageManifests[repoId][index] = ImageManifest({
            digest: digest,
            manifestHash: manifestHash,
            architectures: architectures,
            layers: layerCids,
            buildInfo: buildInfo
        });

        emit ImagePushed(repoId, manifestId, tag, digest);
    }

    /**
     * @notice Upload a layer blob
     */
    function uploadLayer(string calldata digest, string calldata cid, uint256 size, string calldata mediaType)
        external
        nonReentrant
        whenNotPaused
    {
        layers[digest] =
            LayerBlob({digest: digest, cid: cid, size: size, mediaType: mediaType, uploadedAt: block.timestamp});

        emit LayerUploaded(digest, cid, size);
    }

    /**
     * @notice Pull/access an image (tracks pulls)
     */
    function pullImage(bytes32 repoId, string calldata tag) external nonReentrant exists(repoId) {
        Artifact storage repo = artifacts[repoId];

        // Check access for private repos
        if (!checkAccess(repoId, msg.sender)) {
            revert AccessDenied();
        }

        repo.downloadCount++;
        emit ImagePulled(repoId, tag, msg.sender);
    }

    /**
     * @notice Sign an image manifest
     */
    function signImage(bytes32 repoId, string calldata tag, bytes calldata signature, string calldata publicKeyUri)
        external
        nonReentrant
        exists(repoId)
    {
        uint256 idx = versionIndex[repoId][tag];
        // Check if version exists
        if (versions[repoId].length <= idx || keccak256(bytes(versions[repoId][idx].version)) != keccak256(bytes(tag)))
        {
            revert TagNotFound();
        }

        bytes32 manifestId = versions[repoId][idx].versionId;
        bytes32 signatureId = keccak256(abi.encodePacked(_nextSignatureId++, manifestId, msg.sender));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        signatures[manifestId].push(
            ImageSignature({
                signatureId: signatureId,
                manifestId: manifestId,
                signer: msg.sender,
                signerAgentId: agentId,
                signature: signature,
                publicKeyUri: publicKeyUri,
                signedAt: block.timestamp,
                isValid: true
            })
        );

        emit ImageSigned(manifestId, msg.sender);
    }

    function _getAgentIdForAddress(address /* addr */ ) internal pure returns (uint256) {
        return 0; // Would query indexer in production
    }

    function getRepository(bytes32 repoId) external view returns (Artifact memory) {
        return artifacts[repoId];
    }

    // Helper to combine base version data with extended manifest data
    struct FullManifest {
        ArtifactVersion base;
        ImageManifest extended;
    }

    function getManifests(bytes32 repoId) external view returns (FullManifest[] memory) {
        ArtifactVersion[] memory baseVersions = versions[repoId];
        FullManifest[] memory result = new FullManifest[](baseVersions.length);

        for (uint256 i = 0; i < baseVersions.length; i++) {
            result[i] = FullManifest({base: baseVersions[i], extended: imageManifests[repoId][i]});
        }
        return result;
    }

    function getManifestByTag(bytes32 repoId, string calldata tag) external view returns (FullManifest memory) {
        uint256 idx = versionIndex[repoId][tag];
        if (versions[repoId].length <= idx) revert TagNotFound();

        ArtifactVersion memory base = versions[repoId][idx];
        if (keccak256(bytes(base.version)) != keccak256(bytes(tag))) revert TagNotFound();

        return FullManifest({base: base, extended: imageManifests[repoId][idx]});
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
        return allArtifacts.length;
    }

    function getRepositoryIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 end = offset + limit;
        if (end > allArtifacts.length) end = allArtifacts.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allArtifacts[i];
        }
        return result;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    receive() external payable {}
}
