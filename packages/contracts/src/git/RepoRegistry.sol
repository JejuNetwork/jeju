// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRepoRegistry} from "./IRepoRegistry.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title RepoRegistry
 * @author Jeju Network
 * @notice On-chain registry for decentralized git repositories
 * @dev Stores repository metadata with content pointers to IPFS/Arweave
 *
 * Architecture:
 * - Repositories identified by bytes32 repoId (keccak256 of owner + name)
 * - Git objects stored off-chain (IPFS), only CID references on-chain
 * - Branch tips tracked on-chain for consensus
 * - Integration with ERC-8004 IdentityRegistry for agent-linked repos
 * - JNS integration for human-readable names (alice.jeju/my-repo)
 *
 * Access Control:
 * - Owner: Full control (transfer, archive, manage collaborators)
 * - Admin: Can push, create branches, add collaborators
 * - Write: Can push to unprotected branches
 * - Read: Can clone (only meaningful for private repos)
 *
 * @custom:security-contact security@jeju.network
 */
contract RepoRegistry is IRepoRegistry, Ownable, Pausable, ReentrancyGuard {
    IIdentityRegistry public identityRegistry;

    mapping(bytes32 => Repository) private _repositories;
    mapping(address => mapping(bytes32 => bytes32)) private _ownerNameToRepo;
    mapping(bytes32 => mapping(bytes32 => Branch)) private _branches;
    mapping(bytes32 => bytes32[]) private _branchNames;
    mapping(bytes32 => mapping(address => Collaborator)) private _collaborators;
    mapping(bytes32 => address[]) private _collaboratorAddresses;
    mapping(address => bytes32[]) private _userRepositories;
    mapping(bytes32 => mapping(address => bool)) private _stars;
    bytes32[] private _allRepoIds;
    mapping(bytes32 => PushEvent[]) private _pushHistory;
    uint256 public constant MAX_PUSH_HISTORY = 100;
    string public constant DEFAULT_BRANCH = "main";

    error RepoAlreadyExists();
    error RepoNotFound();
    error BranchNotFound();
    error BranchAlreadyExists();
    error BranchIsProtected();
    error NotAuthorized();
    error NotOwner();
    error InvalidName();
    error InvalidCommitCid();
    error ConcurrentPushConflict();
    error CannotForkPrivateRepo();
    error AlreadyStarred();
    error NotStarred();
    error CannotRemoveOwner();
    error InvalidAgentId();
    error NotAgentOwner();
    error CannotDeleteDefaultBranch();

    modifier repoExists(bytes32 repoId) {
        if (_repositories[repoId].createdAt == 0) revert RepoNotFound();
        _;
    }

    modifier onlyRepoOwner(bytes32 repoId) {
        if (_repositories[repoId].owner != msg.sender) revert NotOwner();
        _;
    }

    modifier canWrite(bytes32 repoId) {
        if (!hasWriteAccess(repoId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier canRead(bytes32 repoId) {
        if (!hasReadAccess(repoId, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier canAdmin(bytes32 repoId) {
        Repository storage repo = _repositories[repoId];
        if (repo.owner != msg.sender) {
            Collaborator storage collab = _collaborators[repoId][msg.sender];
            if (collab.role != CollaboratorRole.ADMIN) revert NotAuthorized();
        }
        _;
    }

    constructor(address _owner, address _identityRegistry) Ownable(_owner) {
        if (_identityRegistry != address(0)) {
            identityRegistry = IIdentityRegistry(_identityRegistry);
        }
    }

    /**
     * @notice Create a new repository
     * @param name Repository name (alphanumeric, hyphens, underscores)
     * @param description Short description
     * @param jnsNode JNS node hash for name resolution (optional)
     * @param agentId ERC-8004 agent ID to link (0 for none)
     * @param visibility Public or private
     * @return repoId The created repository ID
     */
    function createRepository(
        string calldata name,
        string calldata description,
        bytes32 jnsNode,
        uint256 agentId,
        RepoVisibility visibility
    ) external whenNotPaused returns (bytes32 repoId) {
        if (bytes(name).length == 0 || bytes(name).length > 100) revert InvalidName();
        if (!_isValidName(name)) revert InvalidName();

        // Verify agent ownership if provided
        if (agentId > 0) {
            if (address(identityRegistry) == address(0)) revert InvalidAgentId();
            if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
            if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        }

        // Generate repo ID from owner + name
        bytes32 nameHash = keccak256(bytes(name));
        repoId = keccak256(abi.encodePacked(msg.sender, nameHash));

        // Check for duplicates
        if (_repositories[repoId].createdAt != 0) revert RepoAlreadyExists();
        if (_ownerNameToRepo[msg.sender][nameHash] != bytes32(0)) revert RepoAlreadyExists();

        // Create repository
        _repositories[repoId] = Repository({
            repoId: repoId,
            owner: msg.sender,
            agentId: agentId,
            name: name,
            description: description,
            jnsNode: jnsNode,
            headCommitCid: bytes32(0),
            metadataCid: bytes32(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            visibility: visibility,
            archived: false,
            starCount: 0,
            forkCount: 0,
            forkedFrom: bytes32(0)
        });

        _ownerNameToRepo[msg.sender][nameHash] = repoId;
        _allRepoIds.push(repoId);
        _userRepositories[msg.sender].push(repoId);

        emit RepositoryCreated(repoId, msg.sender, name, agentId, visibility);
    }

    /**
     * @notice Update repository metadata
     */
    function updateRepository(
        bytes32 repoId,
        string calldata description,
        bytes32 metadataCid
    ) external repoExists(repoId) onlyRepoOwner(repoId) {
        Repository storage repo = _repositories[repoId];
        repo.description = description;
        repo.metadataCid = metadataCid;
        repo.updatedAt = block.timestamp;

        emit RepositoryUpdated(repoId, description, metadataCid);
    }

    /**
     * @notice Transfer repository ownership
     */
    function transferOwnership(
        bytes32 repoId,
        address newOwner
    ) external repoExists(repoId) onlyRepoOwner(repoId) {
        require(newOwner != address(0), "Invalid new owner");

        Repository storage repo = _repositories[repoId];
        address oldOwner = repo.owner;

        // Update mappings
        bytes32 nameHash = keccak256(bytes(repo.name));
        delete _ownerNameToRepo[oldOwner][nameHash];
        _ownerNameToRepo[newOwner][nameHash] = repoId;

        repo.owner = newOwner;
        repo.updatedAt = block.timestamp;

        // Add to new owner's repositories
        _userRepositories[newOwner].push(repoId);

        emit RepositoryTransferred(repoId, oldOwner, newOwner);
    }

    /**
     * @notice Archive or unarchive a repository
     */
    function archiveRepository(
        bytes32 repoId,
        bool archived
    ) external repoExists(repoId) onlyRepoOwner(repoId) {
        Repository storage repo = _repositories[repoId];
        repo.archived = archived;
        repo.updatedAt = block.timestamp;

        emit RepositoryArchived(repoId, archived);
    }

    /**
     * @notice Fork a public repository
     */
    function forkRepository(bytes32 repoId) external repoExists(repoId) returns (bytes32 newRepoId) {
        Repository storage sourceRepo = _repositories[repoId];

        if (sourceRepo.visibility == RepoVisibility.PRIVATE) {
            if (!hasReadAccess(repoId, msg.sender)) revert CannotForkPrivateRepo();
        }

        // Create new repo with same name under forker's ownership
        string memory forkName = string(abi.encodePacked(sourceRepo.name, "-fork"));
        bytes32 nameHash = keccak256(bytes(forkName));
        newRepoId = keccak256(abi.encodePacked(msg.sender, nameHash));

        if (_repositories[newRepoId].createdAt != 0) {
            // Name collision - add timestamp
            forkName = string(abi.encodePacked(sourceRepo.name, "-fork-", _toString(block.timestamp)));
            nameHash = keccak256(bytes(forkName));
            newRepoId = keccak256(abi.encodePacked(msg.sender, nameHash));
        }

        _repositories[newRepoId] = Repository({
            repoId: newRepoId,
            owner: msg.sender,
            agentId: 0,
            name: forkName,
            description: sourceRepo.description,
            jnsNode: bytes32(0),
            headCommitCid: sourceRepo.headCommitCid,
            metadataCid: sourceRepo.metadataCid,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            visibility: RepoVisibility.PUBLIC,
            archived: false,
            starCount: 0,
            forkCount: 0,
            forkedFrom: repoId
        });

        _ownerNameToRepo[msg.sender][nameHash] = newRepoId;
        _allRepoIds.push(newRepoId);
        _userRepositories[msg.sender].push(newRepoId);

        // Copy branches
        bytes32[] storage sourceBranches = _branchNames[repoId];
        for (uint256 i = 0; i < sourceBranches.length; i++) {
            bytes32 branchHash = sourceBranches[i];
            Branch storage sourceBranch = _branches[repoId][branchHash];
            _branches[newRepoId][branchHash] = Branch({
                repoId: newRepoId,
                name: sourceBranch.name,
                tipCommitCid: sourceBranch.tipCommitCid,
                lastPusher: msg.sender,
                updatedAt: block.timestamp,
                protected_: false
            });
            _branchNames[newRepoId].push(branchHash);
        }

        // Increment fork count on source
        sourceRepo.forkCount++;

        emit RepositoryForked(newRepoId, repoId, msg.sender);
    }

    /**
     * @notice Push commits to a branch (update tip)
     * @param repoId Repository ID
     * @param branch Branch name
     * @param newCommitCid CID of new tip commit
     * @param expectedOldCid Expected current tip (for optimistic concurrency)
     * @param commitCount Number of commits in this push
     */
    function pushBranch(
        bytes32 repoId,
        string calldata branch,
        bytes32 newCommitCid,
        bytes32 expectedOldCid,
        uint256 commitCount
    ) external repoExists(repoId) canWrite(repoId) whenNotPaused {
        Repository storage repo = _repositories[repoId];
        if (repo.archived) revert NotAuthorized();

        bytes32 branchHash = keccak256(bytes(branch));
        Branch storage branchData = _branches[repoId][branchHash];

        if (branchData.updatedAt == 0) {
            // Branch doesn't exist - create it
            _createBranchInternal(repoId, branch, newCommitCid);
            return;
        }

        // Check for protected branch
        if (branchData.protected_) {
            // Only admins can push to protected branches
            if (repo.owner != msg.sender) {
                Collaborator storage collab = _collaborators[repoId][msg.sender];
                if (collab.role != CollaboratorRole.ADMIN) revert BranchIsProtected();
            }
        }

        // Optimistic concurrency check
        if (expectedOldCid != bytes32(0) && branchData.tipCommitCid != expectedOldCid) {
            revert ConcurrentPushConflict();
        }

        bytes32 oldCid = branchData.tipCommitCid;
        branchData.tipCommitCid = newCommitCid;
        branchData.lastPusher = msg.sender;
        branchData.updatedAt = block.timestamp;

        // Update repo head if this is the default branch
        if (keccak256(bytes(branch)) == keccak256(bytes(DEFAULT_BRANCH))) {
            repo.headCommitCid = newCommitCid;
        }
        repo.updatedAt = block.timestamp;

        // Record push event
        _recordPush(repoId, branch, oldCid, newCommitCid, commitCount);

        emit BranchPushed(repoId, branch, oldCid, newCommitCid, msg.sender);
    }

    /**
     * @notice Create a new branch
     */
    function createBranch(
        bytes32 repoId,
        string calldata branch,
        bytes32 tipCommitCid
    ) external repoExists(repoId) canWrite(repoId) {
        _createBranchInternal(repoId, branch, tipCommitCid);
    }

    function _createBranchInternal(bytes32 repoId, string calldata branch, bytes32 tipCommitCid) internal {
        bytes32 branchHash = keccak256(bytes(branch));

        if (_branches[repoId][branchHash].updatedAt != 0) revert BranchAlreadyExists();

        _branches[repoId][branchHash] = Branch({
            repoId: repoId,
            name: branch,
            tipCommitCid: tipCommitCid,
            lastPusher: msg.sender,
            updatedAt: block.timestamp,
            protected_: false
        });

        _branchNames[repoId].push(branchHash);

        // Set as head if it's the first branch or default branch
        Repository storage repo = _repositories[repoId];
        if (repo.headCommitCid == bytes32(0) || keccak256(bytes(branch)) == keccak256(bytes(DEFAULT_BRANCH))) {
            repo.headCommitCid = tipCommitCid;
        }

        emit BranchCreated(repoId, branch, tipCommitCid, msg.sender);
    }

    /**
     * @notice Delete a branch
     */
    function deleteBranch(
        bytes32 repoId,
        string calldata branch
    ) external repoExists(repoId) canWrite(repoId) {
        bytes32 branchHash = keccak256(bytes(branch));

        // Cannot delete default branch
        if (branchHash == keccak256(bytes(DEFAULT_BRANCH))) revert CannotDeleteDefaultBranch();

        Branch storage branchData = _branches[repoId][branchHash];
        if (branchData.updatedAt == 0) revert BranchNotFound();
        if (branchData.protected_) revert BranchIsProtected();

        delete _branches[repoId][branchHash];

        // Remove from branch names array
        bytes32[] storage names = _branchNames[repoId];
        for (uint256 i = 0; i < names.length; i++) {
            if (names[i] == branchHash) {
                names[i] = names[names.length - 1];
                names.pop();
                break;
            }
        }

        emit BranchDeleted(repoId, branch, msg.sender);
    }

    /**
     * @notice Set branch protection
     */
    function setBranchProtection(
        bytes32 repoId,
        string calldata branch,
        bool protected_
    ) external repoExists(repoId) canAdmin(repoId) {
        bytes32 branchHash = keccak256(bytes(branch));
        Branch storage branchData = _branches[repoId][branchHash];

        if (branchData.updatedAt == 0) revert BranchNotFound();

        branchData.protected_ = protected_;

        emit BranchProtectionSet(repoId, branch, protected_);
    }

    /**
     * @notice Add a collaborator to a repository
     */
    function addCollaborator(
        bytes32 repoId,
        address user,
        CollaboratorRole role
    ) external repoExists(repoId) canAdmin(repoId) {
        require(user != address(0), "Invalid user");
        require(role != CollaboratorRole.NONE, "Invalid role");

        Collaborator storage collab = _collaborators[repoId][user];
        
        if (collab.addedAt == 0) {
            _collaboratorAddresses[repoId].push(user);
            _userRepositories[user].push(repoId);
        }

        collab.user = user;
        collab.role = role;
        collab.addedAt = block.timestamp;

        emit CollaboratorAdded(repoId, user, role);
    }

    /**
     * @notice Remove a collaborator
     */
    function removeCollaborator(
        bytes32 repoId,
        address user
    ) external repoExists(repoId) canAdmin(repoId) {
        if (user == _repositories[repoId].owner) revert CannotRemoveOwner();

        Collaborator storage collab = _collaborators[repoId][user];
        if (collab.addedAt == 0) revert NotAuthorized();

        delete _collaborators[repoId][user];

        // Remove from addresses array
        address[] storage addrs = _collaboratorAddresses[repoId];
        for (uint256 i = 0; i < addrs.length; i++) {
            if (addrs[i] == user) {
                addrs[i] = addrs[addrs.length - 1];
                addrs.pop();
                break;
            }
        }

        emit CollaboratorRemoved(repoId, user);
    }

    /**
     * @notice Change collaborator role
     */
    function changeCollaboratorRole(
        bytes32 repoId,
        address user,
        CollaboratorRole newRole
    ) external repoExists(repoId) canAdmin(repoId) {
        if (user == _repositories[repoId].owner) revert CannotRemoveOwner();

        Collaborator storage collab = _collaborators[repoId][user];
        if (collab.addedAt == 0) revert NotAuthorized();

        collab.role = newRole;

        emit CollaboratorRoleChanged(repoId, user, newRole);
    }

    /**
     * @notice Star a repository
     */
    function starRepository(bytes32 repoId) external repoExists(repoId) {
        if (_stars[repoId][msg.sender]) revert AlreadyStarred();

        _stars[repoId][msg.sender] = true;
        _repositories[repoId].starCount++;

        emit RepositoryStarred(repoId, msg.sender);
    }

    /**
     * @notice Unstar a repository
     */
    function unstarRepository(bytes32 repoId) external repoExists(repoId) {
        if (!_stars[repoId][msg.sender]) revert NotStarred();

        _stars[repoId][msg.sender] = false;
        _repositories[repoId].starCount--;

        emit RepositoryUnstarred(repoId, msg.sender);
    }

    function getRepository(bytes32 repoId) external view returns (Repository memory) {
        return _repositories[repoId];
    }

    function getRepositoryByName(
        address owner,
        string calldata name
    ) external view returns (Repository memory) {
        bytes32 nameHash = keccak256(bytes(name));
        bytes32 repoId = _ownerNameToRepo[owner][nameHash];
        return _repositories[repoId];
    }

    function getBranch(
        bytes32 repoId,
        string calldata branch
    ) external view returns (Branch memory) {
        bytes32 branchHash = keccak256(bytes(branch));
        return _branches[repoId][branchHash];
    }

    function getBranches(bytes32 repoId) external view returns (Branch[] memory) {
        bytes32[] storage names = _branchNames[repoId];
        Branch[] memory branches = new Branch[](names.length);

        for (uint256 i = 0; i < names.length; i++) {
            branches[i] = _branches[repoId][names[i]];
        }

        return branches;
    }

    function getCollaborator(
        bytes32 repoId,
        address user
    ) external view returns (Collaborator memory) {
        return _collaborators[repoId][user];
    }

    function getCollaborators(bytes32 repoId) external view returns (Collaborator[] memory) {
        address[] storage addrs = _collaboratorAddresses[repoId];
        Collaborator[] memory collabs = new Collaborator[](addrs.length);

        for (uint256 i = 0; i < addrs.length; i++) {
            collabs[i] = _collaborators[repoId][addrs[i]];
        }

        return collabs;
    }

    function hasWriteAccess(bytes32 repoId, address user) public view returns (bool) {
        Repository storage repo = _repositories[repoId];
        if (repo.createdAt == 0) return false;
        if (repo.owner == user) return true;

        Collaborator storage collab = _collaborators[repoId][user];
        return collab.role == CollaboratorRole.WRITE || collab.role == CollaboratorRole.ADMIN;
    }

    function hasReadAccess(bytes32 repoId, address user) public view returns (bool) {
        Repository storage repo = _repositories[repoId];
        if (repo.createdAt == 0) return false;
        if (repo.visibility == RepoVisibility.PUBLIC) return true;
        if (repo.owner == user) return true;

        Collaborator storage collab = _collaborators[repoId][user];
        return collab.role != CollaboratorRole.NONE;
    }

    function isOwner(bytes32 repoId, address user) external view returns (bool) {
        return _repositories[repoId].owner == user;
    }

    function getUserRepositories(address user) external view returns (bytes32[] memory) {
        return _userRepositories[user];
    }

    function hasStarred(bytes32 repoId, address user) external view returns (bool) {
        return _stars[repoId][user];
    }

    function getRepositoryCount() external view returns (uint256) {
        return _allRepoIds.length;
    }

    function getAllRepositories(uint256 offset, uint256 limit) external view returns (Repository[] memory) {
        uint256 total = _allRepoIds.length;
        if (offset >= total) {
            return new Repository[](0);
        }

        uint256 count = limit;
        if (offset + limit > total) {
            count = total - offset;
        }

        Repository[] memory repos = new Repository[](count);
        for (uint256 i = 0; i < count; i++) {
            repos[i] = _repositories[_allRepoIds[offset + i]];
        }

        return repos;
    }

    function getPushHistory(bytes32 repoId) external view returns (PushEvent[] memory) {
        return _pushHistory[repoId];
    }

    function _recordPush(
        bytes32 repoId,
        string calldata branch,
        bytes32 oldCid,
        bytes32 newCid,
        uint256 commitCount
    ) internal {
        PushEvent[] storage history = _pushHistory[repoId];

        // Remove oldest if at capacity
        if (history.length >= MAX_PUSH_HISTORY) {
            for (uint256 i = 0; i < history.length - 1; i++) {
                history[i] = history[i + 1];
            }
            history.pop();
        }

        history.push(PushEvent({
            repoId: repoId,
            branch: branch,
            oldCommitCid: oldCid,
            newCommitCid: newCid,
            pusher: msg.sender,
            timestamp: block.timestamp,
            commitCount: commitCount
        }));
    }

    function _isValidName(string calldata name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            bool isValid = (char >= 0x30 && char <= 0x39) || // 0-9
                (char >= 0x41 && char <= 0x5A) || // A-Z
                (char >= 0x61 && char <= 0x7A) || // a-z
                char == 0x2D || // -
                char == 0x5F || // _
                char == 0x2E; // .
            if (!isValid) return false;
        }
        // Cannot start with dot or hyphen
        if (nameBytes[0] == 0x2E || nameBytes[0] == 0x2D) return false;
        return true;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
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

