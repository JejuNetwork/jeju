// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {DAORegistry} from "../../src/governance/DAORegistry.sol";
import {IDAORegistry} from "../../src/governance/interfaces/IDAORegistry.sol";

contract DAORegistryTest is Test {
    DAORegistry public registry;
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public treasury = address(4);

    function setUp() public {
        vm.prank(owner);
        registry = new DAORegistry(owner);
    }

    // ============ DAO Creation Tests ============

    function testCreateDAO() public {
        vm.prank(user1);

        string[] memory traits = new string[](2);
        traits[0] = "strategic";
        traits[1] = "fair";

        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Test Director",
            pfpCid: "ipfs://test",
            description: "A test Director",
            personality: "Analytical",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        bytes32 daoId = registry.createDAO(
            "test-dao", "Test DAO", "A test DAO for testing", treasury, "ipfs://manifest", directorPersona, params
        );

        assertTrue(daoId != bytes32(0), "DAO ID should not be zero");
        assertTrue(registry.daoExists(daoId), "DAO should exist");
        assertEq(registry.getDAOCount(), 1, "Should have 1 DAO");
    }

    function testCreateMultipleDAOs() public {
        string[] memory traits1 = new string[](1);
        traits1[0] = "strategic";

        IDAORegistry.DirectorPersona memory directorPersona1 = IDAORegistry.DirectorPersona({
            name: "Jeju Director",
            pfpCid: "",
            description: "Jeju Network governance leader",
            personality: "Professional",
            traits: traits1,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        string[] memory traits2 = new string[](2);
        traits2[0] = "innovative";
        traits2[1] = "user-focused";

        IDAORegistry.DirectorPersona memory directorPersona2 = IDAORegistry.DirectorPersona({
            name: "Apps Lead",
            pfpCid: "",
            description: "Apps DAO leader",
            personality: "Innovative yet pragmatic",
            traits: traits2,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        // Create Jeju DAO
        vm.prank(user1);
        bytes32 jejuId =
            registry.createDAO("jeju", "Jeju DAO", "Jeju Network chain governance", treasury, "", directorPersona1, params);

        // Create Apps DAO
        vm.prank(user2);
        bytes32 appsId =
            registry.createDAO("apps", "Apps DAO", "Jeju apps governance", address(5), "", directorPersona2, params);

        assertEq(registry.getDAOCount(), 2, "Should have 2 DAOs");
        assertTrue(jejuId != appsId, "DAO IDs should be unique");

        // Check personas
        IDAORegistry.DirectorPersona memory jejuPersona = registry.getDirectorPersona(jejuId);
        assertEq(jejuPersona.name, "Jeju Director");

        IDAORegistry.DirectorPersona memory appsPersona = registry.getDirectorPersona(appsId);
        assertEq(appsPersona.name, "Apps Lead");
    }

    function testGetActiveDAOs() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 dao1 = registry.createDAO("dao1", "DAO 1", "Test", treasury, "", directorPersona, params);

        vm.prank(user2);
        bytes32 dao2 = registry.createDAO("dao2", "DAO 2", "Test", treasury, "", directorPersona, params);

        bytes32[] memory activeDAOs = registry.getActiveDAOs();
        assertEq(activeDAOs.length, 2, "Should have 2 active DAOs");

        // Pause one DAO
        vm.prank(user1);
        registry.setDAOStatus(dao1, IDAORegistry.DAOStatus.PAUSED);

        activeDAOs = registry.getActiveDAOs();
        assertEq(activeDAOs.length, 1, "Should have 1 active DAO");
        assertEq(activeDAOs[0], dao2, "Active DAO should be dao2");
    }

    function testGetDAOByName() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("unique-dao", "Unique DAO", "Test", treasury, "", directorPersona, params);

        IDAORegistry.DAO memory dao = registry.getDAOByName("unique-dao");
        assertEq(dao.daoId, daoId, "Should find DAO by name");
        assertEq(dao.displayName, "Unique DAO");
    }

    // ============ Board Member Tests ============

    function testAddBoardMember() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", directorPersona, params);

        // Add board member
        vm.prank(user1);
        registry.addBoardMember(daoId, address(10), 1, "Treasury", 100, false);

        IDAORegistry.BoardMember[] memory members = registry.getBoardMembers(daoId);
        assertEq(members.length, 1, "Should have 1 board member");
        assertEq(members[0].member, address(10));
        assertEq(members[0].role, "Treasury");
        assertEq(members[0].weight, 100);
        assertTrue(members[0].isActive);
        assertFalse(members[0].isHuman);
    }

    function testAddHumanBoardMember() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", directorPersona, params);

        // Add human board member
        vm.prank(user1);
        registry.addBoardMember(daoId, address(10), 0, "Treasury", 100, true);

        IDAORegistry.BoardMember[] memory members = registry.getBoardMembers(daoId);
        assertEq(members.length, 1, "Should have 1 board member");
        assertEq(members[0].member, address(10));
        assertTrue(members[0].isHuman, "Should be human");
    }

    // ============ Package/Repo Linking Tests ============

    function testLinkPackage() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", directorPersona, params);

        bytes32 packageId = keccak256("test-package");

        vm.prank(user1);
        registry.linkPackage(daoId, packageId);

        bytes32[] memory packages = registry.getLinkedPackages(daoId);
        assertEq(packages.length, 1, "Should have 1 linked package");
        assertEq(packages[0], packageId);

        assertEq(registry.getPackageDAO(packageId), daoId, "Reverse lookup should work");
    }

    // ============ Access Control Tests ============

    function testOnlyDAOAdminCanUpdate() public {
        string[] memory traits = new string[](0);
        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Director",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", directorPersona, params);

        // Non-admin should fail
        vm.prank(user2);
        vm.expectRevert(DAORegistry.NotAuthorized.selector);
        registry.updateDAO(daoId, "New Name", "New Desc", "");

        // Admin should succeed
        vm.prank(user1);
        registry.updateDAO(daoId, "New Name", "New Desc", "");

        IDAORegistry.DAO memory dao = registry.getDAO(daoId);
        assertEq(dao.displayName, "New Name");
    }

    function testGetDAOFull() public {
        string[] memory traits = new string[](2);
        traits[0] = "wise";
        traits[1] = "fair";

        IDAORegistry.DirectorPersona memory directorPersona = IDAORegistry.DirectorPersona({
            name: "Test Director",
            pfpCid: "ipfs://pfp",
            description: "A great Director",
            personality: "Strategic",
            traits: traits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 80,
            boardVotingPeriod: 5 days,
            gracePeriod: 2 days,
            minProposalStake: 0.1 ether,
            quorumBps: 6000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO(
            "full-test", "Full Test DAO", "Testing getDAOFull", treasury, "ipfs://manifest", directorPersona, params
        );

        // Add board member
        vm.prank(user1);
        registry.addBoardMember(daoId, address(10), 1, "Treasury", 100, false);

        // Link package
        vm.prank(user1);
        registry.linkPackage(daoId, keccak256("pkg1"));

        // Get full DAO
        IDAORegistry.DAOFull memory daoFull = registry.getDAOFull(daoId);

        assertEq(daoFull.dao.name, "full-test");
        assertEq(daoFull.dao.displayName, "Full Test DAO");
        assertEq(daoFull.directorPersona.name, "Test Director");
        assertEq(daoFull.params.minQualityScore, 80);
        assertEq(daoFull.boardMembers.length, 1);
        assertEq(daoFull.linkedPackages.length, 1);
    }

    function testHumanDirector() public {
        string[] memory traits = new string[](0);

        // Create a human director
        IDAORegistry.DirectorPersona memory humanDirector = IDAORegistry.DirectorPersona({
            name: "Human Director",
            pfpCid: "",
            description: "A human leading the DAO",
            personality: "Decisive",
            traits: traits,
            isHuman: true,
            humanAddress: user2,
            agentId: 0,
            decisionFallbackDays: 14 // 14 day fallback period
        });

        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });

        vm.prank(user1);
        bytes32 daoId = registry.createDAO("human-led", "Human Led DAO", "Test", treasury, "", humanDirector, params);

        IDAORegistry.DirectorPersona memory persona = registry.getDirectorPersona(daoId);
        assertTrue(persona.isHuman, "Director should be human");
        assertEq(persona.humanAddress, user2, "Human address should match");
        assertEq(persona.decisionFallbackDays, 14, "Fallback days should be 14");
    }
}
