// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {RepoRegistry} from "../../src/git/RepoRegistry.sol";
import {IRepoRegistry} from "../../src/git/IRepoRegistry.sol";

contract RepoRegistryTest is Test {
    RepoRegistry public registry;

    address public owner;
    address public user1;
    address public user2;
    address public collaborator;

    bytes32 public constant COMMIT_CID_1 = keccak256("commit1");
    bytes32 public constant COMMIT_CID_2 = keccak256("commit2");
    bytes32 public constant COMMIT_CID_3 = keccak256("commit3");

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        collaborator = makeAddr("collaborator");

        vm.prank(owner);
        registry = new RepoRegistry(owner, address(0));
    }

    // ============ Repository Creation Tests ============

    function test_CreateRepository() public {
        vm.prank(user1);
        bytes32 repoId = registry.createRepository(
            "my-repo", "A test repository", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC
        );

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertEq(repo.owner, user1);
        assertEq(repo.name, "my-repo");
        assertEq(repo.description, "A test repository");
        assertEq(uint8(repo.visibility), uint8(IRepoRegistry.RepoVisibility.PUBLIC));
        assertFalse(repo.archived);
    }

    function test_CreatePrivateRepository() public {
        vm.prank(user1);
        bytes32 repoId = registry.createRepository(
            "private-repo", "A private repository", bytes32(0), 0, IRepoRegistry.RepoVisibility.PRIVATE
        );

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertEq(uint8(repo.visibility), uint8(IRepoRegistry.RepoVisibility.PRIVATE));
    }

    function test_CreateRepository_RevertIfEmptyName() public {
        vm.prank(user1);
        vm.expectRevert(RepoRegistry.InvalidName.selector);
        registry.createRepository("", "Description", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
    }

    function test_CreateRepository_RevertIfInvalidName() public {
        vm.prank(user1);
        vm.expectRevert(RepoRegistry.InvalidName.selector);
        registry.createRepository("-invalid-start", "Description", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
    }

    function test_CreateRepository_RevertIfDuplicate() public {
        vm.prank(user1);
        registry.createRepository("my-repo", "First repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        vm.expectRevert(RepoRegistry.RepoAlreadyExists.selector);
        registry.createRepository("my-repo", "Duplicate", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
    }

    // ============ Repository Management Tests ============

    function test_UpdateRepository() public {
        vm.prank(user1);
        bytes32 repoId = registry.createRepository(
            "my-repo", "Original description", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC
        );

        bytes32 metadataCid = keccak256("metadata");

        vm.prank(user1);
        registry.updateRepository(repoId, "New description", metadataCid);

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertEq(repo.description, "New description");
        assertEq(repo.metadataCid, metadataCid);
    }

    function test_TransferOwnership() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.transferOwnership(repoId, user2);

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertEq(repo.owner, user2);
    }

    function test_ArchiveRepository() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.archiveRepository(repoId, true);

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertTrue(repo.archived);

        vm.prank(user1);
        registry.archiveRepository(repoId, false);

        repo = registry.getRepository(repoId);
        assertFalse(repo.archived);
    }

    // ============ Fork Tests ============

    function test_ForkRepository() public {
        vm.prank(user1);
        bytes32 originalRepoId = registry.createRepository(
            "original-repo", "Original repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC
        );

        // Create a branch first
        vm.prank(user1);
        registry.createBranch(originalRepoId, "main", COMMIT_CID_1);

        vm.prank(user2);
        bytes32 forkedRepoId = registry.forkRepository(originalRepoId);

        IRepoRegistry.Repository memory forked = registry.getRepository(forkedRepoId);
        assertEq(forked.owner, user2);
        assertEq(forked.forkedFrom, originalRepoId);

        IRepoRegistry.Repository memory original = registry.getRepository(originalRepoId);
        assertEq(original.forkCount, 1);
    }

    function test_ForkRepository_RevertIfPrivateAndNotCollaborator() public {
        vm.prank(user1);
        bytes32 repoId = registry.createRepository(
            "private-repo", "Private repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PRIVATE
        );

        vm.prank(user2);
        vm.expectRevert(RepoRegistry.CannotForkPrivateRepo.selector);
        registry.forkRepository(repoId);
    }

    // ============ Branch Tests ============

    function test_CreateBranch() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        IRepoRegistry.Branch memory branch = registry.getBranch(repoId, "main");
        assertEq(branch.name, "main");
        assertEq(branch.tipCommitCid, COMMIT_CID_1);
    }

    function test_PushBranch() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        registry.pushBranch(repoId, "main", COMMIT_CID_2, COMMIT_CID_1, 1);

        IRepoRegistry.Branch memory branch = registry.getBranch(repoId, "main");
        assertEq(branch.tipCommitCid, COMMIT_CID_2);
    }

    function test_PushBranch_RevertIfConcurrentConflict() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        vm.expectRevert(RepoRegistry.ConcurrentPushConflict.selector);
        registry.pushBranch(repoId, "main", COMMIT_CID_2, COMMIT_CID_3, 1); // Wrong expected CID
    }

    function test_DeleteBranch() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        registry.createBranch(repoId, "feature", COMMIT_CID_1);

        vm.prank(user1);
        registry.deleteBranch(repoId, "feature");

        IRepoRegistry.Branch[] memory branches = registry.getBranches(repoId);
        assertEq(branches.length, 1);
    }

    function test_DeleteBranch_RevertIfDefault() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        vm.expectRevert(RepoRegistry.CannotDeleteDefaultBranch.selector);
        registry.deleteBranch(repoId, "main");
    }

    function test_SetBranchProtection() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        registry.setBranchProtection(repoId, "main", true);

        IRepoRegistry.Branch memory branch = registry.getBranch(repoId, "main");
        assertTrue(branch.protected_);
    }

    // ============ Collaborator Tests ============

    function test_AddCollaborator() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.addCollaborator(repoId, collaborator, IRepoRegistry.CollaboratorRole.WRITE);

        IRepoRegistry.Collaborator memory collab = registry.getCollaborator(repoId, collaborator);
        assertEq(collab.user, collaborator);
        assertEq(uint8(collab.role), uint8(IRepoRegistry.CollaboratorRole.WRITE));
    }

    function test_CollaboratorCanPush() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        registry.addCollaborator(repoId, collaborator, IRepoRegistry.CollaboratorRole.WRITE);

        vm.prank(collaborator);
        registry.pushBranch(repoId, "main", COMMIT_CID_2, COMMIT_CID_1, 1);

        IRepoRegistry.Branch memory branch = registry.getBranch(repoId, "main");
        assertEq(branch.tipCommitCid, COMMIT_CID_2);
    }

    function test_RemoveCollaborator() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.addCollaborator(repoId, collaborator, IRepoRegistry.CollaboratorRole.WRITE);

        vm.prank(user1);
        registry.removeCollaborator(repoId, collaborator);

        IRepoRegistry.Collaborator[] memory collabs = registry.getCollaborators(repoId);
        assertEq(collabs.length, 0);
    }

    function test_ChangeCollaboratorRole() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.addCollaborator(repoId, collaborator, IRepoRegistry.CollaboratorRole.READ);

        vm.prank(user1);
        registry.changeCollaboratorRole(repoId, collaborator, IRepoRegistry.CollaboratorRole.ADMIN);

        IRepoRegistry.Collaborator memory collab = registry.getCollaborator(repoId, collaborator);
        assertEq(uint8(collab.role), uint8(IRepoRegistry.CollaboratorRole.ADMIN));
    }

    // ============ Star Tests ============

    function test_StarAndUnstar() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user2);
        registry.starRepository(repoId);

        assertTrue(registry.hasStarred(repoId, user2));

        IRepoRegistry.Repository memory repo = registry.getRepository(repoId);
        assertEq(repo.starCount, 1);

        vm.prank(user2);
        registry.unstarRepository(repoId);

        assertFalse(registry.hasStarred(repoId, user2));

        repo = registry.getRepository(repoId);
        assertEq(repo.starCount, 0);
    }

    function test_Star_RevertIfAlreadyStarred() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user2);
        registry.starRepository(repoId);

        vm.prank(user2);
        vm.expectRevert(RepoRegistry.AlreadyStarred.selector);
        registry.starRepository(repoId);
    }

    // ============ View Functions Tests ============

    function test_GetRepositoryByName() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        IRepoRegistry.Repository memory repo = registry.getRepositoryByName(user1, "my-repo");
        assertEq(repo.name, "my-repo");
    }

    function test_HasWriteAccess() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        assertTrue(registry.hasWriteAccess(repoId, user1));
        assertFalse(registry.hasWriteAccess(repoId, user2));

        vm.prank(user1);
        registry.addCollaborator(repoId, user2, IRepoRegistry.CollaboratorRole.WRITE);

        assertTrue(registry.hasWriteAccess(repoId, user2));
    }

    function test_HasReadAccess() public {
        vm.prank(user1);
        bytes32 repoId = registry.createRepository(
            "private-repo", "Private repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PRIVATE
        );

        assertTrue(registry.hasReadAccess(repoId, user1));
        assertFalse(registry.hasReadAccess(repoId, user2));

        vm.prank(user1);
        registry.addCollaborator(repoId, user2, IRepoRegistry.CollaboratorRole.READ);

        assertTrue(registry.hasReadAccess(repoId, user2));
    }

    function test_GetUserRepositories() public {
        vm.startPrank(user1);
        bytes32 repo1 = registry.createRepository("repo1", "", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
        bytes32 repo2 = registry.createRepository("repo2", "", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
        vm.stopPrank();

        bytes32[] memory repos = registry.getUserRepositories(user1);
        assertEq(repos.length, 2);
        assertEq(repos[0], repo1);
        assertEq(repos[1], repo2);
    }

    function test_GetPushHistory() public {
        vm.prank(user1);
        bytes32 repoId =
            registry.createRepository("my-repo", "Test repo", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(user1);
        registry.createBranch(repoId, "main", COMMIT_CID_1);

        vm.prank(user1);
        registry.pushBranch(repoId, "main", COMMIT_CID_2, COMMIT_CID_1, 3);

        IRepoRegistry.PushEvent[] memory history = registry.getPushHistory(repoId);
        assertEq(history.length, 1);
        assertEq(history[0].commitCount, 3);
    }

    // ============ Admin Tests ============

    function test_PauseUnpause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(user1);
        vm.expectRevert();
        registry.createRepository("my-repo", "", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);

        vm.prank(owner);
        registry.unpause();

        vm.prank(user1);
        registry.createRepository("my-repo", "", bytes32(0), 0, IRepoRegistry.RepoVisibility.PUBLIC);
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }
}
