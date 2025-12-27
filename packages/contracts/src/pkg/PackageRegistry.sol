// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPackageRegistry} from "./IPackageRegistry.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title PackageRegistry
 * @author Jeju Network
 * @notice On-chain registry for decentralized packages (JejuPkg)
 * @dev Stores package metadata with content pointers to IPFS tarballs
 *
 * Architecture:
 * - Packages identified by bytes32 packageId (keccak256 of scope + name)
 * - Package tarballs stored off-chain (IPFS), only CID references on-chain
 * - Supports scoped packages (at-scope/name) and unscoped (name)
 * - Integrity hashes for tamper detection (SHA-512)
 * - Multi-maintainer support with granular permissions
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract PackageRegistry is IPackageRegistry, Ownable, Pausable, ReentrancyGuard {
    // ============ State Variables ============

    /// @notice ERC-8004 Identity Registry for agent verification
    IIdentityRegistry public identityRegistry;

    /// @notice All packages by ID
    mapping(bytes32 => Package) private _packages;

    /// @notice Scope + name to packageId mapping
    mapping(bytes32 => bytes32) private _nameToPackage;

    /// @notice Versions per package
    mapping(bytes32 => mapping(bytes32 => Version)) private _versions;

    /// @notice Version string to versionId per package
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _versionStringToId;

    /// @notice Version list per package (for enumeration)
    mapping(bytes32 => bytes32[]) private _versionList;

    /// @notice Maintainers per package
    mapping(bytes32 => mapping(address => Maintainer)) private _maintainers;

    /// @notice Maintainer addresses per package (for enumeration)
    mapping(bytes32 => address[]) private _maintainerAddresses;

    /// @notice Packages per owner
    mapping(address => bytes32[]) private _ownerPackages;

    /// @notice All package IDs
    bytes32[] private _allPackageIds;

    /// @notice Reserved package names (system packages)
    mapping(bytes32 => bool) private _reservedNames;

    // ============ Errors ============

    error PackageAlreadyExists();
    error PackageNotFound();
    error VersionAlreadyExists();
    error VersionNotFound();
    error NotAuthorized();
    error NotOwner();
    error InvalidName();
    error InvalidVersion();
    error InvalidCid();
    error CannotRemoveOwner();
    error NameReserved();
    error InvalidAgentId();

    // ============ Modifiers ============

    modifier requirePackageExists(bytes32 packageId) {
        if (_packages[packageId].createdAt == 0) revert PackageNotFound();
        _;
    }

    modifier onlyPackageOwner(bytes32 packageId) {
        if (_packages[packageId].owner != msg.sender) revert NotOwner();
        _;
    }

    modifier canPublishPackage(bytes32 packageId) {
        if (!canPublish(packageId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier canManagePackage(bytes32 packageId) {
        if (!canManage(packageId, msg.sender)) revert NotAuthorized();
        _;
    }

    // ============ Constructor ============

    constructor(address _owner, address _identityRegistry) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }

        // Reserve system package names
        _reservedNames[keccak256(bytes("jeju"))] = true;
        _reservedNames[keccak256(bytes("@jejunetwork/core"))] = true;
        _reservedNames[keccak256(bytes("@jejunetwork/cli"))] = true;
    }

    // ============ Package Management ============

    /**
     * @notice Create a new package
     * @param name Package name (alphanumeric, hyphens)
     * @param scope Package scope (e.g., "@jeju") - empty for unscoped
     * @param description Short description
     * @param license SPDX license identifier
     * @param agentId ERC-8004 agent ID to link (0 for none)
     * @return packageId The created package ID
     */
    function createPackage(
        string calldata name,
        string calldata scope,
        string calldata description,
        string calldata license,
        uint256 agentId
    ) external whenNotPaused returns (bytes32 packageId) {
        if (bytes(name).length == 0 || bytes(name).length > 214) revert InvalidName();
        if (!_isValidPackageName(name)) revert InvalidName();

        // Validate scope if provided
        if (bytes(scope).length > 0) {
            if (!_isValidScope(scope)) revert InvalidName();
        }

        // Check reserved names
        bytes32 fullNameHash = keccak256(abi.encodePacked(scope, "/", name));
        if (_reservedNames[fullNameHash]) revert NameReserved();

        // Generate package ID
        packageId = _generatePackageId(name, scope);

        // Check for duplicates
        if (_packages[packageId].createdAt != 0) revert PackageAlreadyExists();

        // Verify agent ownership if provided
        if (agentId > 0 && address(identityRegistry) != address(0)) {
            if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
            if (identityRegistry.ownerOf(agentId) != msg.sender) revert InvalidAgentId();
        }

        // Create package
        _packages[packageId] = Package({
            packageId: packageId,
            name: name,
            scope: scope,
            owner: msg.sender,
            agentId: agentId,
            jnsNode: bytes32(0),
            description: description,
            license: license,
            homepage: "",
            repository: "",
            latestVersion: bytes32(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            deprecated: false,
            downloadCount: 0
        });

        _nameToPackage[fullNameHash] = packageId;
        _allPackageIds.push(packageId);
        _ownerPackages[msg.sender].push(packageId);

        emit PackageCreated(packageId, name, scope, msg.sender);
    }

    /**
     * @notice Update package metadata
     */
    function updatePackage(
        bytes32 packageId,
        string calldata description,
        string calldata license,
        string calldata homepage,
        string calldata repository
    ) external requirePackageExists(packageId) canManagePackage(packageId) {
        Package storage pkg = _packages[packageId];
        pkg.description = description;
        pkg.license = license;
        pkg.homepage = homepage;
        pkg.repository = repository;
        pkg.updatedAt = block.timestamp;
    }

    /**
     * @notice Transfer package ownership
     */
    function transferOwnership(bytes32 packageId, address newOwner)
        external
        requirePackageExists(packageId)
        onlyPackageOwner(packageId)
    {
        require(newOwner != address(0), "Invalid new owner");

        Package storage pkg = _packages[packageId];
        address oldOwner = pkg.owner;

        pkg.owner = newOwner;
        pkg.updatedAt = block.timestamp;

        // Add to new owner's packages
        _ownerPackages[newOwner].push(packageId);

        emit PackageTransferred(packageId, oldOwner, newOwner);
    }

    /**
     * @notice Deprecate or undeprecate a package
     */
    function deprecatePackage(bytes32 packageId, bool deprecated)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        Package storage pkg = _packages[packageId];
        pkg.deprecated = deprecated;
        pkg.updatedAt = block.timestamp;

        emit PackageDeprecated(packageId, deprecated);
    }

    // ============ Version Management ============

    /**
     * @notice Publish a new version
     * @param packageId Package ID
     * @param versionStr Semver string (e.g., "1.0.0")
     * @param tarballCid IPFS CID of the tarball
     * @param integrityHash SHA-512 integrity hash
     * @param manifestCid IPFS CID of package.json
     * @param size Size in bytes
     * @return versionId The version ID
     */
    function publishVersion(
        bytes32 packageId,
        string calldata versionStr,
        bytes32 tarballCid,
        bytes32 integrityHash,
        bytes32 manifestCid,
        uint256 size
    ) external requirePackageExists(packageId) canPublishPackage(packageId) whenNotPaused returns (bytes32 versionId) {
        if (bytes(versionStr).length == 0 || bytes(versionStr).length > 256) revert InvalidVersion();
        if (!_isValidVersion(versionStr)) revert InvalidVersion();
        if (tarballCid == bytes32(0)) revert InvalidCid();

        bytes32 versionHash = keccak256(bytes(versionStr));

        // Check for duplicate version
        if (_versionStringToId[packageId][versionHash] != bytes32(0)) revert VersionAlreadyExists();

        // Generate version ID
        versionId = keccak256(abi.encodePacked(packageId, versionHash, block.timestamp));

        // Create version
        _versions[packageId][versionId] = Version({
            versionId: versionId,
            packageId: packageId,
            version: versionStr,
            tarballCid: tarballCid,
            integrityHash: integrityHash,
            manifestCid: manifestCid,
            size: size,
            publisher: msg.sender,
            publishedAt: block.timestamp,
            deprecated: false,
            deprecationMessage: ""
        });

        _versionStringToId[packageId][versionHash] = versionId;
        _versionList[packageId].push(versionId);

        // Update latest version
        Package storage pkg = _packages[packageId];
        pkg.latestVersion = versionId;
        pkg.updatedAt = block.timestamp;

        emit VersionPublished(packageId, versionId, versionStr, tarballCid, msg.sender);
    }

    /**
     * @notice Deprecate a version
     */
    function deprecateVersion(bytes32 packageId, string calldata versionStr, string calldata message)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        bytes32 versionHash = keccak256(bytes(versionStr));
        bytes32 versionId = _versionStringToId[packageId][versionHash];

        if (versionId == bytes32(0)) revert VersionNotFound();

        Version storage ver = _versions[packageId][versionId];
        ver.deprecated = true;
        ver.deprecationMessage = message;

        emit VersionDeprecated(packageId, versionStr, message);
    }

    /**
     * @notice Set the latest version tag
     */
    function setLatestVersion(bytes32 packageId, string calldata versionStr)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        bytes32 versionHash = keccak256(bytes(versionStr));
        bytes32 versionId = _versionStringToId[packageId][versionHash];

        if (versionId == bytes32(0)) revert VersionNotFound();

        Package storage pkg = _packages[packageId];
        pkg.latestVersion = versionId;
        pkg.updatedAt = block.timestamp;
    }

    // ============ Maintainer Management ============

    /**
     * @notice Add a maintainer
     */
    function addMaintainer(bytes32 packageId, address user, bool canPublishFlag, bool canManageFlag)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        require(user != address(0), "Invalid user");

        Maintainer storage m = _maintainers[packageId][user];

        if (m.addedAt == 0) {
            _maintainerAddresses[packageId].push(user);
        }

        m.user = user;
        m.canPublish = canPublishFlag;
        m.canManage = canManageFlag;
        m.addedAt = block.timestamp;

        emit MaintainerAdded(packageId, user, canPublishFlag, canManageFlag);
    }

    /**
     * @notice Remove a maintainer
     */
    function removeMaintainer(bytes32 packageId, address user)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        if (user == _packages[packageId].owner) revert CannotRemoveOwner();

        Maintainer storage m = _maintainers[packageId][user];
        if (m.addedAt == 0) revert NotAuthorized();

        delete _maintainers[packageId][user];

        // Remove from addresses array
        address[] storage addrs = _maintainerAddresses[packageId];
        for (uint256 i = 0; i < addrs.length; i++) {
            if (addrs[i] == user) {
                addrs[i] = addrs[addrs.length - 1];
                addrs.pop();
                break;
            }
        }

        emit MaintainerRemoved(packageId, user);
    }

    /**
     * @notice Update maintainer permissions
     */
    function updateMaintainer(bytes32 packageId, address user, bool canPublishFlag, bool canManageFlag)
        external
        requirePackageExists(packageId)
        canManagePackage(packageId)
    {
        Maintainer storage m = _maintainers[packageId][user];
        if (m.addedAt == 0) revert NotAuthorized();

        m.canPublish = canPublishFlag;
        m.canManage = canManageFlag;
    }

    // ============ View Functions ============

    function getPackage(bytes32 packageId) external view returns (Package memory) {
        return _packages[packageId];
    }

    function getPackageByName(string calldata name, string calldata scope) external view returns (Package memory) {
        bytes32 fullNameHash = keccak256(abi.encodePacked(scope, "/", name));
        bytes32 packageId = _nameToPackage[fullNameHash];
        return _packages[packageId];
    }

    function getVersion(bytes32 packageId, string calldata versionStr) external view returns (Version memory) {
        bytes32 versionHash = keccak256(bytes(versionStr));
        bytes32 versionId = _versionStringToId[packageId][versionHash];
        return _versions[packageId][versionId];
    }

    function getLatestVersion(bytes32 packageId) external view returns (Version memory) {
        Package storage pkg = _packages[packageId];
        return _versions[packageId][pkg.latestVersion];
    }

    function getVersions(bytes32 packageId) external view returns (Version[] memory) {
        bytes32[] storage versionIds = _versionList[packageId];
        Version[] memory versions = new Version[](versionIds.length);

        for (uint256 i = 0; i < versionIds.length; i++) {
            versions[i] = _versions[packageId][versionIds[i]];
        }

        return versions;
    }

    function getMaintainers(bytes32 packageId) external view returns (Maintainer[] memory) {
        address[] storage addrs = _maintainerAddresses[packageId];
        Maintainer[] memory maintainers = new Maintainer[](addrs.length);

        for (uint256 i = 0; i < addrs.length; i++) {
            maintainers[i] = _maintainers[packageId][addrs[i]];
        }

        return maintainers;
    }

    function canPublish(bytes32 packageId, address user) public view returns (bool) {
        Package storage pkg = _packages[packageId];
        if (pkg.createdAt == 0) return false;
        if (pkg.owner == user) return true;

        Maintainer storage m = _maintainers[packageId][user];
        return m.canPublish;
    }

    function canManage(bytes32 packageId, address user) public view returns (bool) {
        Package storage pkg = _packages[packageId];
        if (pkg.createdAt == 0) return false;
        if (pkg.owner == user) return true;

        Maintainer storage m = _maintainers[packageId][user];
        return m.canManage;
    }

    function getPackagesByOwner(address owner) external view returns (bytes32[] memory) {
        return _ownerPackages[owner];
    }

    function packageExists(bytes32 packageId) external view returns (bool) {
        return _packages[packageId].createdAt != 0;
    }

    function versionExists(bytes32 packageId, string calldata versionStr) external view returns (bool) {
        bytes32 versionHash = keccak256(bytes(versionStr));
        return _versionStringToId[packageId][versionHash] != bytes32(0);
    }

    function getPackageCount() external view returns (uint256) {
        return _allPackageIds.length;
    }

    function getAllPackages(uint256 offset, uint256 limit) external view returns (Package[] memory) {
        uint256 total = _allPackageIds.length;
        if (offset >= total) {
            return new Package[](0);
        }

        uint256 count = limit;
        if (offset + limit > total) {
            count = total - offset;
        }

        Package[] memory packages = new Package[](count);
        for (uint256 i = 0; i < count; i++) {
            packages[i] = _packages[_allPackageIds[offset + i]];
        }

        return packages;
    }

    /**
     * @notice Record a download (callable by anyone, for analytics)
     */
    function recordDownload(bytes32 packageId, bytes32 versionId) external {
        Package storage pkg = _packages[packageId];
        if (pkg.createdAt == 0) return;

        pkg.downloadCount++;

        emit DownloadRecorded(packageId, versionId, msg.sender);
    }

    // ============ Internal Functions ============

    function _generatePackageId(string calldata name, string calldata scope) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(scope, "/", name));
    }

    function _isValidPackageName(string calldata name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0) return false;

        // Must start with a letter or underscore
        bytes1 first = nameBytes[0];
        if (
            !(first >= 0x61 && first <= 0x7A) // a-z
                && !(first >= 0x41 && first <= 0x5A) // A-Z
                && first != 0x5F
        ) {
            // _
            return false;
        }

        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            bool isValid = (char >= 0x30 && char <= 0x39) // 0-9
                || (char >= 0x41 && char <= 0x5A) // A-Z
                || (char >= 0x61 && char <= 0x7A) // a-z
                || char == 0x2D // -
                || char == 0x5F // _
                || char == 0x2E; // .
            if (!isValid) return false;
        }

        return true;
    }

    function _isValidScope(string calldata scope) internal pure returns (bool) {
        bytes memory scopeBytes = bytes(scope);
        if (scopeBytes.length < 2) return false;
        if (scopeBytes[0] != 0x40) return false; // Must start with @

        for (uint256 i = 1; i < scopeBytes.length; i++) {
            bytes1 char = scopeBytes[i];
            bool isValid = (char >= 0x30 && char <= 0x39) // 0-9
                || (char >= 0x41 && char <= 0x5A) // A-Z
                || (char >= 0x61 && char <= 0x7A) // a-z
                || char == 0x2D // -
                || char == 0x5F; // _
            if (!isValid) return false;
        }

        return true;
    }

    function _isValidVersion(string calldata versionStr) internal pure returns (bool) {
        bytes memory versionBytes = bytes(versionStr);
        if (versionBytes.length == 0) return false;

        // Basic semver check - allows x.y.z, x.y.z-pre, x.y.z+build, etc.
        for (uint256 i = 0; i < versionBytes.length; i++) {
            bytes1 char = versionBytes[i];
            bool isValid = (char >= 0x30 && char <= 0x39) // 0-9
                || (char >= 0x41 && char <= 0x5A) // A-Z
                || (char >= 0x61 && char <= 0x7A) // a-z
                || char == 0x2E // .
                || char == 0x2D // -
                || char == 0x2B; // +
            if (!isValid) return false;
        }

        return true;
    }

    // ============ Admin Functions ============

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function reserveName(bytes32 nameHash) external onlyOwner {
        _reservedNames[nameHash] = true;
    }

    function unreserveName(bytes32 nameHash) external onlyOwner {
        _reservedNames[nameHash] = false;
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
}
