// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PackageRegistry
 * @notice On-chain registry for decentralized NPM packages (JejuPkg)
 * @dev Stores package metadata with IPFS/Arweave content IDs for data permanence
 * 
 * Features:
 * - Package registration and versioning
 * - Publisher verification
 * - Download/publish tracking
 * - ERC-8004 reputation integration
 * - Council proposal linking for deep funding
 */
contract PackageRegistry is Ownable, ReentrancyGuard {
    
    // Package visibility
    enum Visibility { Public, Private, Scoped }
    
    // Package record
    struct Package {
        string name;
        string scope;           // e.g., "@jeju"
        address owner;
        string description;
        Visibility visibility;
        string manifestCid;     // IPFS/Arweave CID of package.json
        string latestVersion;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 downloadCount;
        uint256 publishCount;
        uint256 reputationScore;
        uint256 councilProposalId;
        bool verified;
        bool deprecated;
        string deprecationMessage;
    }
    
    // Version record
    struct PackageVersion {
        string version;
        string tarballCid;      // IPFS/Arweave CID of tarball
        string integrity;       // sha512 hash
        uint256 size;
        uint256 publishedAt;
        address publishedBy;
        bool yanked;
    }
    
    // Publisher account
    struct Publisher {
        address addr;
        string username;
        string jnsName;
        uint256 totalPackages;
        uint256 totalDownloads;
        uint256 totalPublishes;
        uint256 reputationScore;
        uint256 stakedAmount;
        uint256 createdAt;
        bool verified;
    }
    
    // Dist-tag (e.g., latest, next, beta)
    struct DistTag {
        string tag;
        string version;
        uint256 updatedAt;
    }
    
    // Storage
    mapping(bytes32 => Package) public packages;
    mapping(bytes32 => mapping(string => PackageVersion)) public versions;
    mapping(bytes32 => string[]) public versionList;
    mapping(bytes32 => mapping(string => DistTag)) public distTags;
    mapping(bytes32 => mapping(address => bool)) public maintainers;
    mapping(bytes32 => address[]) public maintainerList;
    mapping(address => Publisher) public publishers;
    mapping(address => bytes32[]) public publisherPackages;
    mapping(string => bytes32) public nameToPackage;  // "scope/name" or "name" -> packageId
    
    // Scope ownership
    mapping(string => address) public scopeOwner;
    
    // ERC-8004 integration
    address public reputationRegistry;
    
    // Events
    event PackageCreated(bytes32 indexed packageId, address indexed owner, string name);
    event PackagePublished(bytes32 indexed packageId, string version, string tarballCid);
    event PackageUpdated(bytes32 indexed packageId, string manifestCid);
    event PackageDeprecated(bytes32 indexed packageId, string message);
    event VersionYanked(bytes32 indexed packageId, string version);
    event MaintainerAdded(bytes32 indexed packageId, address indexed maintainer);
    event MaintainerRemoved(bytes32 indexed packageId, address indexed maintainer);
    event DistTagUpdated(bytes32 indexed packageId, string tag, string version);
    event ScopeRegistered(string indexed scope, address indexed owner);
    event CouncilProposalLinked(bytes32 indexed packageId, uint256 proposalId);
    event PublisherRegistered(address indexed publisher, string username);
    event DownloadRecorded(bytes32 indexed packageId, string version, uint256 count);
    
    constructor(address _reputationRegistry) Ownable(msg.sender) {
        reputationRegistry = _reputationRegistry;
    }
    
    // Scope Management
    
    function registerScope(string calldata scope) external {
        require(bytes(scope).length > 0 && bytes(scope)[0] == "@", "Invalid scope");
        require(scopeOwner[scope] == address(0), "Scope taken");
        
        scopeOwner[scope] = msg.sender;
        
        emit ScopeRegistered(scope, msg.sender);
    }
    
    function transferScope(string calldata scope, address newOwner) external {
        require(scopeOwner[scope] == msg.sender, "Not scope owner");
        require(newOwner != address(0), "Invalid address");
        
        scopeOwner[scope] = newOwner;
        
        emit ScopeRegistered(scope, newOwner);
    }
    
    // Publisher Registration
    
    function registerPublisher(string calldata username, string calldata jnsName) external {
        Publisher storage pub = publishers[msg.sender];
        
        if (pub.addr == address(0)) {
            pub.addr = msg.sender;
            pub.createdAt = block.timestamp;
        }
        
        pub.username = username;
        pub.jnsName = jnsName;
        
        emit PublisherRegistered(msg.sender, username);
    }
    
    // Package Management
    
    function createPackage(
        string calldata name,
        string calldata scope,
        string calldata description,
        Visibility visibility,
        string calldata manifestCid
    ) external returns (bytes32 packageId) {
        require(bytes(name).length > 0 && bytes(name).length <= 214, "Invalid name");
        
        // Validate scope ownership if scoped
        if (bytes(scope).length > 0) {
            require(
                scopeOwner[scope] == msg.sender || 
                scopeOwner[scope] == address(0),
                "Not scope owner"
            );
            // Auto-register scope if not taken
            if (scopeOwner[scope] == address(0)) {
                scopeOwner[scope] = msg.sender;
                emit ScopeRegistered(scope, msg.sender);
            }
        }
        
        string memory fullName = bytes(scope).length > 0 
            ? string(abi.encodePacked(scope, "/", name))
            : name;
        
        require(nameToPackage[fullName] == bytes32(0), "Package exists");
        
        packageId = keccak256(abi.encodePacked(msg.sender, fullName, block.timestamp));
        
        packages[packageId] = Package({
            name: name,
            scope: scope,
            owner: msg.sender,
            description: description,
            visibility: visibility,
            manifestCid: manifestCid,
            latestVersion: "",
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            downloadCount: 0,
            publishCount: 0,
            reputationScore: 0,
            councilProposalId: 0,
            verified: false,
            deprecated: false,
            deprecationMessage: ""
        });
        
        maintainers[packageId][msg.sender] = true;
        maintainerList[packageId].push(msg.sender);
        publisherPackages[msg.sender].push(packageId);
        nameToPackage[fullName] = packageId;
        
        // Update publisher stats
        publishers[msg.sender].totalPackages++;
        
        emit PackageCreated(packageId, msg.sender, fullName);
    }
    
    function publishVersion(
        bytes32 packageId,
        string calldata version,
        string calldata tarballCid,
        string calldata integrity,
        uint256 size,
        string calldata manifestCid
    ) external {
        Package storage pkg = packages[packageId];
        require(pkg.owner != address(0), "Package not found");
        require(maintainers[packageId][msg.sender], "Not maintainer");
        require(!pkg.deprecated, "Package deprecated");
        require(bytes(versions[packageId][version].version).length == 0, "Version exists");
        
        versions[packageId][version] = PackageVersion({
            version: version,
            tarballCid: tarballCid,
            integrity: integrity,
            size: size,
            publishedAt: block.timestamp,
            publishedBy: msg.sender,
            yanked: false
        });
        
        versionList[packageId].push(version);
        pkg.manifestCid = manifestCid;
        pkg.latestVersion = version;
        pkg.updatedAt = block.timestamp;
        pkg.publishCount++;
        
        // Update dist-tag
        distTags[packageId]["latest"] = DistTag({
            tag: "latest",
            version: version,
            updatedAt: block.timestamp
        });
        
        // Update publisher stats
        publishers[msg.sender].totalPublishes++;
        
        emit PackagePublished(packageId, version, tarballCid);
        emit DistTagUpdated(packageId, "latest", version);
    }
    
    function updateDistTag(
        bytes32 packageId,
        string calldata tag,
        string calldata version
    ) external {
        require(maintainers[packageId][msg.sender], "Not maintainer");
        require(bytes(versions[packageId][version].version).length > 0, "Version not found");
        
        distTags[packageId][tag] = DistTag({
            tag: tag,
            version: version,
            updatedAt: block.timestamp
        });
        
        emit DistTagUpdated(packageId, tag, version);
    }
    
    function yankVersion(bytes32 packageId, string calldata version) external {
        require(maintainers[packageId][msg.sender], "Not maintainer");
        require(bytes(versions[packageId][version].version).length > 0, "Version not found");
        
        versions[packageId][version].yanked = true;
        
        emit VersionYanked(packageId, version);
    }
    
    function deprecatePackage(bytes32 packageId, string calldata message) external {
        require(packages[packageId].owner == msg.sender, "Not owner");
        
        packages[packageId].deprecated = true;
        packages[packageId].deprecationMessage = message;
        
        emit PackageDeprecated(packageId, message);
    }
    
    // Maintainer Management
    
    function addMaintainer(bytes32 packageId, address maintainer) external {
        require(packages[packageId].owner == msg.sender, "Not owner");
        require(!maintainers[packageId][maintainer], "Already maintainer");
        
        maintainers[packageId][maintainer] = true;
        maintainerList[packageId].push(maintainer);
        
        emit MaintainerAdded(packageId, maintainer);
    }
    
    function removeMaintainer(bytes32 packageId, address maintainer) external {
        require(packages[packageId].owner == msg.sender, "Not owner");
        require(maintainer != msg.sender, "Cannot remove owner");
        require(maintainers[packageId][maintainer], "Not maintainer");
        
        maintainers[packageId][maintainer] = false;
        
        // Remove from list
        address[] storage list = maintainerList[packageId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == maintainer) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        
        emit MaintainerRemoved(packageId, maintainer);
    }
    
    // Transfer ownership
    
    function transferOwnership(bytes32 packageId, address newOwner) external {
        require(packages[packageId].owner == msg.sender, "Not owner");
        require(newOwner != address(0), "Invalid address");
        
        packages[packageId].owner = newOwner;
        
        // Ensure new owner is maintainer
        if (!maintainers[packageId][newOwner]) {
            maintainers[packageId][newOwner] = true;
            maintainerList[packageId].push(newOwner);
        }
    }
    
    // Download tracking (called by off-chain service)
    
    function recordDownloads(bytes32 packageId, string calldata version, uint256 count) external {
        require(msg.sender == owner() || maintainers[packageId][msg.sender], "Not authorized");
        
        packages[packageId].downloadCount += count;
        publishers[packages[packageId].owner].totalDownloads += count;
        
        emit DownloadRecorded(packageId, version, count);
    }
    
    // Council Integration
    
    function linkCouncilProposal(bytes32 packageId, uint256 proposalId) external {
        require(
            packages[packageId].owner == msg.sender ||
            msg.sender == owner(),
            "Not authorized"
        );
        
        packages[packageId].councilProposalId = proposalId;
        
        emit CouncilProposalLinked(packageId, proposalId);
    }
    
    // ERC-8004 Integration
    
    function updateReputationScore(bytes32 packageId, uint256 score) external {
        require(
            msg.sender == reputationRegistry || 
            msg.sender == owner(),
            "Not authorized"
        );
        
        packages[packageId].reputationScore = score;
    }
    
    function updatePublisherReputation(address publisher, uint256 score) external {
        require(
            msg.sender == reputationRegistry || 
            msg.sender == owner(),
            "Not authorized"
        );
        
        publishers[publisher].reputationScore = score;
    }
    
    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        reputationRegistry = _reputationRegistry;
    }
    
    // Verification
    
    function verifyPackage(bytes32 packageId) external onlyOwner {
        packages[packageId].verified = true;
    }
    
    function verifyPublisher(address publisher) external onlyOwner {
        publishers[publisher].verified = true;
    }
    
    // Views
    
    function getPackage(bytes32 packageId) external view returns (Package memory) {
        return packages[packageId];
    }
    
    function getPackageByName(string calldata fullName) external view returns (Package memory) {
        bytes32 packageId = nameToPackage[fullName];
        return packages[packageId];
    }
    
    function getVersion(bytes32 packageId, string calldata version) external view returns (PackageVersion memory) {
        return versions[packageId][version];
    }
    
    function getVersions(bytes32 packageId) external view returns (string[] memory) {
        return versionList[packageId];
    }
    
    function getDistTag(bytes32 packageId, string calldata tag) external view returns (DistTag memory) {
        return distTags[packageId][tag];
    }
    
    function getMaintainers(bytes32 packageId) external view returns (address[] memory) {
        return maintainerList[packageId];
    }
    
    function getPublisher(address addr) external view returns (Publisher memory) {
        return publishers[addr];
    }
    
    function getPublisherPackages(address addr) external view returns (bytes32[] memory) {
        return publisherPackages[addr];
    }
    
    function isMaintainer(bytes32 packageId, address addr) external view returns (bool) {
        return maintainers[packageId][addr];
    }
    
    function getScopeOwner(string calldata scope) external view returns (address) {
        return scopeOwner[scope];
    }
}



