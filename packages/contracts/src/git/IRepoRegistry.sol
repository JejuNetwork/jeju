// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IRepoRegistry
 * @notice Interface for the decentralized git repository registry
 */
interface IRepoRegistry {
    // ============ Enums ============

    enum CollaboratorRole {
        NONE,
        READ,
        WRITE,
        ADMIN
    }

    enum RepoVisibility {
        PUBLIC,
        PRIVATE
    }

    // ============ Structs ============

    struct Repository {
        bytes32 repoId;
        address owner;
        uint256 agentId;
        string name;
        string description;
        bytes32 jnsNode;
        bytes32 headCommitCid;
        bytes32 metadataCid;
        uint256 createdAt;
        uint256 updatedAt;
        RepoVisibility visibility;
        bool archived;
        uint256 starCount;
        uint256 forkCount;
        bytes32 forkedFrom;
    }

    struct Branch {
        bytes32 repoId;
        string name;
        bytes32 tipCommitCid;
        address lastPusher;
        uint256 updatedAt;
        bool protected_;
    }

    struct Collaborator {
        address user;
        uint256 agentId;
        CollaboratorRole role;
        uint256 addedAt;
    }

    struct PushEvent {
        bytes32 repoId;
        string branch;
        bytes32 oldCommitCid;
        bytes32 newCommitCid;
        address pusher;
        uint256 timestamp;
        uint256 commitCount;
    }

    // ============ Events ============

    event RepositoryCreated(
        bytes32 indexed repoId,
        address indexed owner,
        string name,
        uint256 agentId,
        RepoVisibility visibility
    );

    event RepositoryUpdated(bytes32 indexed repoId, string description, bytes32 metadataCid);

    event RepositoryTransferred(bytes32 indexed repoId, address indexed oldOwner, address indexed newOwner);

    event RepositoryArchived(bytes32 indexed repoId, bool archived);

    event RepositoryForked(bytes32 indexed repoId, bytes32 indexed forkedFrom, address indexed owner);

    event BranchPushed(
        bytes32 indexed repoId,
        string branch,
        bytes32 oldCommitCid,
        bytes32 newCommitCid,
        address indexed pusher
    );

    event BranchCreated(bytes32 indexed repoId, string branch, bytes32 tipCommitCid, address indexed creator);

    event BranchDeleted(bytes32 indexed repoId, string branch, address indexed deleter);

    event BranchProtectionSet(bytes32 indexed repoId, string branch, bool protected_);

    event CollaboratorAdded(bytes32 indexed repoId, address indexed user, CollaboratorRole role);

    event CollaboratorRemoved(bytes32 indexed repoId, address indexed user);

    event CollaboratorRoleChanged(bytes32 indexed repoId, address indexed user, CollaboratorRole newRole);

    event RepositoryStarred(bytes32 indexed repoId, address indexed user);

    event RepositoryUnstarred(bytes32 indexed repoId, address indexed user);

    // ============ Repository Management ============

    function createRepository(
        string calldata name,
        string calldata description,
        bytes32 jnsNode,
        uint256 agentId,
        RepoVisibility visibility
    ) external returns (bytes32 repoId);

    function updateRepository(bytes32 repoId, string calldata description, bytes32 metadataCid) external;

    function transferOwnership(bytes32 repoId, address newOwner) external;

    function archiveRepository(bytes32 repoId, bool archived) external;

    function forkRepository(bytes32 repoId) external returns (bytes32 newRepoId);

    // ============ Branch Management ============

    function pushBranch(
        bytes32 repoId,
        string calldata branch,
        bytes32 newCommitCid,
        bytes32 expectedOldCid,
        uint256 commitCount
    ) external;

    function createBranch(bytes32 repoId, string calldata branch, bytes32 tipCommitCid) external;

    function deleteBranch(bytes32 repoId, string calldata branch) external;

    function setBranchProtection(bytes32 repoId, string calldata branch, bool protected_) external;

    // ============ Collaborator Management ============

    function addCollaborator(bytes32 repoId, address user, CollaboratorRole role) external;

    function removeCollaborator(bytes32 repoId, address user) external;

    function changeCollaboratorRole(bytes32 repoId, address user, CollaboratorRole newRole) external;

    // ============ Social Features ============

    function starRepository(bytes32 repoId) external;

    function unstarRepository(bytes32 repoId) external;

    // ============ View Functions ============

    function getRepository(bytes32 repoId) external view returns (Repository memory);

    function getRepositoryByName(address owner, string calldata name) external view returns (Repository memory);

    function getBranch(bytes32 repoId, string calldata branch) external view returns (Branch memory);

    function getBranches(bytes32 repoId) external view returns (Branch[] memory);

    function getCollaborator(bytes32 repoId, address user) external view returns (Collaborator memory);

    function getCollaborators(bytes32 repoId) external view returns (Collaborator[] memory);

    function hasWriteAccess(bytes32 repoId, address user) external view returns (bool);

    function hasReadAccess(bytes32 repoId, address user) external view returns (bool);

    function isOwner(bytes32 repoId, address user) external view returns (bool);

    function getUserRepositories(address user) external view returns (bytes32[] memory);

    function hasStarred(bytes32 repoId, address user) external view returns (bool);

    function getRepositoryCount() external view returns (uint256);
}

