// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

/**
 * @title IPackageRegistry
 * @notice Interface for the decentralized package registry (JejuPkg)
 */
interface IPackageRegistry {
    // ============ Structs ============

    struct Package {
        bytes32 packageId;
        string name;
        string scope; // e.g., "@jeju" (empty for unscoped)
        address owner;
        uint256 agentId;
        bytes32 jnsNode;
        string description;
        string license;
        string homepage;
        string repository;
        bytes32 latestVersion;
        uint256 createdAt;
        uint256 updatedAt;
        bool deprecated;
        uint256 downloadCount;
    }

    struct Version {
        bytes32 versionId;
        bytes32 packageId;
        string version; // semver string e.g., "1.0.0"
        bytes32 tarballCid; // IPFS CID of the tarball
        bytes32 integrityHash; // SHA-512 integrity hash
        bytes32 manifestCid; // IPFS CID of package.json
        uint256 size;
        address publisher;
        uint256 publishedAt;
        bool deprecated;
        string deprecationMessage;
    }

    struct Maintainer {
        address user;
        uint256 agentId;
        bool canPublish;
        bool canManage;
        uint256 addedAt;
    }

    // ============ Events ============

    event PackageCreated(
        bytes32 indexed packageId,
        string name,
        string scope,
        address indexed owner
    );

    event PackageTransferred(
        bytes32 indexed packageId,
        address indexed oldOwner,
        address indexed newOwner
    );

    event PackageDeprecated(
        bytes32 indexed packageId,
        bool deprecated
    );

    event VersionPublished(
        bytes32 indexed packageId,
        bytes32 indexed versionId,
        string version,
        bytes32 tarballCid,
        address indexed publisher
    );

    event VersionDeprecated(
        bytes32 indexed packageId,
        string version,
        string message
    );

    event MaintainerAdded(
        bytes32 indexed packageId,
        address indexed user,
        bool canPublish,
        bool canManage
    );

    event MaintainerRemoved(
        bytes32 indexed packageId,
        address indexed user
    );

    event DownloadRecorded(
        bytes32 indexed packageId,
        bytes32 indexed versionId,
        address indexed downloader
    );

    // ============ Package Management ============

    function createPackage(
        string calldata name,
        string calldata scope,
        string calldata description,
        string calldata license,
        uint256 agentId
    ) external returns (bytes32 packageId);

    function updatePackage(
        bytes32 packageId,
        string calldata description,
        string calldata license,
        string calldata homepage,
        string calldata repository
    ) external;

    function transferOwnership(bytes32 packageId, address newOwner) external;

    function deprecatePackage(bytes32 packageId, bool deprecated) external;

    // ============ Version Management ============

    function publishVersion(
        bytes32 packageId,
        string calldata version,
        bytes32 tarballCid,
        bytes32 integrityHash,
        bytes32 manifestCid,
        uint256 size
    ) external returns (bytes32 versionId);

    function deprecateVersion(
        bytes32 packageId,
        string calldata version,
        string calldata message
    ) external;

    function setLatestVersion(bytes32 packageId, string calldata version) external;

    // ============ Maintainer Management ============

    function addMaintainer(
        bytes32 packageId,
        address user,
        bool canPublish,
        bool canManage
    ) external;

    function removeMaintainer(bytes32 packageId, address user) external;

    function updateMaintainer(
        bytes32 packageId,
        address user,
        bool canPublish,
        bool canManage
    ) external;

    // ============ View Functions ============

    function getPackage(bytes32 packageId) external view returns (Package memory);

    function getPackageByName(string calldata name, string calldata scope) external view returns (Package memory);

    function getVersion(bytes32 packageId, string calldata version) external view returns (Version memory);

    function getLatestVersion(bytes32 packageId) external view returns (Version memory);

    function getVersions(bytes32 packageId) external view returns (Version[] memory);

    function getMaintainers(bytes32 packageId) external view returns (Maintainer[] memory);

    function canPublish(bytes32 packageId, address user) external view returns (bool);

    function canManage(bytes32 packageId, address user) external view returns (bool);

    function getPackagesByOwner(address owner) external view returns (bytes32[] memory);

    function packageExists(bytes32 packageId) external view returns (bool);

    function versionExists(bytes32 packageId, string calldata version) external view returns (bool);

    function getPackageCount() external view returns (uint256);

    function recordDownload(bytes32 packageId, bytes32 versionId) external;
}

