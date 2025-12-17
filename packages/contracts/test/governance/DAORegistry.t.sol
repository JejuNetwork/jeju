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
        
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "Test CEO",
            pfpCid: "ipfs://test",
            description: "A test CEO",
            personality: "Analytical",
            traits: new string[](2)
        });
        ceoPersona.traits[0] = "strategic";
        ceoPersona.traits[1] = "fair";
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        bytes32 daoId = registry.createDAO(
            "test-dao",
            "Test DAO",
            "A test DAO for testing",
            treasury,
            "ipfs://manifest",
            ceoPersona,
            params
        );
        
        assertTrue(daoId != bytes32(0), "DAO ID should not be zero");
        assertTrue(registry.daoExists(daoId), "DAO should exist");
        assertEq(registry.getDAOCount(), 1, "Should have 1 DAO");
    }

    function testCreateMultipleDAOs() public {
        IDAORegistry.CEOPersona memory ceoPersona1 = IDAORegistry.CEOPersona({
            name: "Jeju CEO",
            pfpCid: "",
            description: "Jeju Network governance leader",
            personality: "Professional",
            traits: new string[](1)
        });
        ceoPersona1.traits[0] = "strategic";
        
        IDAORegistry.CEOPersona memory ceoPersona2 = IDAORegistry.CEOPersona({
            name: "Monkey King",
            pfpCid: "",
            description: "Babylon DAO leader",
            personality: "Mischievous yet wise",
            traits: new string[](2)
        });
        ceoPersona2.traits[0] = "playful";
        ceoPersona2.traits[1] = "powerful";
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        // Create Jeju DAO
        vm.prank(user1);
        bytes32 jejuId = registry.createDAO(
            "jeju",
            "Jeju DAO",
            "Jeju Network chain governance",
            treasury,
            "",
            ceoPersona1,
            params
        );
        
        // Create Babylon DAO
        vm.prank(user2);
        bytes32 babylonId = registry.createDAO(
            "babylon",
            "Babylon DAO",
            "Babylon game engine governance",
            address(5),
            "",
            ceoPersona2,
            params
        );
        
        assertEq(registry.getDAOCount(), 2, "Should have 2 DAOs");
        assertTrue(jejuId != babylonId, "DAO IDs should be unique");
        
        // Check personas
        IDAORegistry.CEOPersona memory jejuPersona = registry.getCEOPersona(jejuId);
        assertEq(jejuPersona.name, "Jeju CEO");
        
        IDAORegistry.CEOPersona memory babylonPersona = registry.getCEOPersona(babylonId);
        assertEq(babylonPersona.name, "Monkey King");
    }

    function testGetActiveDAOs() public {
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        vm.prank(user1);
        bytes32 dao1 = registry.createDAO("dao1", "DAO 1", "Test", treasury, "", ceoPersona, params);
        
        vm.prank(user2);
        bytes32 dao2 = registry.createDAO("dao2", "DAO 2", "Test", treasury, "", ceoPersona, params);
        
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
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        vm.prank(user1);
        bytes32 daoId = registry.createDAO("unique-dao", "Unique DAO", "Test", treasury, "", ceoPersona, params);
        
        IDAORegistry.DAO memory dao = registry.getDAOByName("unique-dao");
        assertEq(dao.daoId, daoId, "Should find DAO by name");
        assertEq(dao.displayName, "Unique DAO");
    }

    // ============ Council Member Tests ============

    function testAddCouncilMember() public {
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", ceoPersona, params);
        
        // Add council member
        vm.prank(user1);
        registry.addCouncilMember(daoId, address(10), 1, "Treasury", 100);
        
        IDAORegistry.CouncilMember[] memory members = registry.getCouncilMembers(daoId);
        assertEq(members.length, 1, "Should have 1 council member");
        assertEq(members[0].member, address(10));
        assertEq(members[0].role, "Treasury");
        assertEq(members[0].weight, 100);
        assertTrue(members[0].isActive);
    }

    // ============ Package/Repo Linking Tests ============

    function testLinkPackage() public {
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", ceoPersona, params);
        
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
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            councilVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000
        });
        
        vm.prank(user1);
        bytes32 daoId = registry.createDAO("test", "Test", "Test", treasury, "", ceoPersona, params);
        
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
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "Test CEO",
            pfpCid: "ipfs://pfp",
            description: "A great CEO",
            personality: "Strategic",
            traits: new string[](2)
        });
        ceoPersona.traits[0] = "wise";
        ceoPersona.traits[1] = "fair";
        
        IDAORegistry.GovernanceParams memory params = IDAORegistry.GovernanceParams({
            minQualityScore: 80,
            councilVotingPeriod: 5 days,
            gracePeriod: 2 days,
            minProposalStake: 0.1 ether,
            quorumBps: 6000
        });
        
        vm.prank(user1);
        bytes32 daoId = registry.createDAO("full-test", "Full Test DAO", "Testing getDAOFull", treasury, "ipfs://manifest", ceoPersona, params);
        
        // Add council member
        vm.prank(user1);
        registry.addCouncilMember(daoId, address(10), 1, "Treasury", 100);
        
        // Link package
        vm.prank(user1);
        registry.linkPackage(daoId, keccak256("pkg1"));
        
        // Get full DAO
        IDAORegistry.DAOFull memory daoFull = registry.getDAOFull(daoId);
        
        assertEq(daoFull.dao.name, "full-test");
        assertEq(daoFull.dao.displayName, "Full Test DAO");
        assertEq(daoFull.ceoPersona.name, "Test CEO");
        assertEq(daoFull.params.minQualityScore, 80);
        assertEq(daoFull.councilMembers.length, 1);
        assertEq(daoFull.linkedPackages.length, 1);
    }
}

