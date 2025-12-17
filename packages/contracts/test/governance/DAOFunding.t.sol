// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {DAORegistry} from "../../src/governance/DAORegistry.sol";
import {DAOFunding} from "../../src/governance/DAOFunding.sol";
import {IDAORegistry} from "../../src/governance/interfaces/IDAORegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock ERC20 for testing
contract MockERC20 is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract DAOFundingTest is Test {
    DAORegistry public registry;
    DAOFunding public funding;
    MockERC20 public token;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public treasury = address(4);
    address public projectOwner = address(5);
    
    bytes32 public daoId;

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy contracts
        registry = new DAORegistry(owner);
        token = new MockERC20();
        funding = new DAOFunding(address(registry), address(token), owner);
        
        // Create a test DAO
        IDAORegistry.CEOPersona memory ceoPersona = IDAORegistry.CEOPersona({
            name: "Test CEO",
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
        
        daoId = registry.createDAO(
            "test-dao",
            "Test DAO",
            "A test DAO",
            treasury,
            "",
            ceoPersona,
            params
        );
        
        vm.stopPrank();
        
        // Mint tokens for testing
        token.mint(user1, 100 ether);
        token.mint(user2, 100 ether);
        token.mint(address(funding), 1000 ether); // Fund the contract
    }

    // ============ Project Proposal Tests ============

    function testProposeProject() public {
        bytes32 registryId = keccak256("test-package");
        address[] memory additionalRecipients = new address[](0);
        uint256[] memory shares = new uint256[](0);
        
        vm.prank(user1);
        bytes32 projectId = funding.proposeProject(
            daoId,
            DAOFunding.ProjectType.PACKAGE,
            registryId,
            "Test Package",
            "A test package for funding",
            projectOwner,
            additionalRecipients,
            shares
        );
        
        assertTrue(projectId != bytes32(0), "Project ID should not be zero");
        
        DAOFunding.FundingProject memory project = funding.getProject(projectId);
        assertEq(project.name, "Test Package");
        assertEq(project.primaryRecipient, projectOwner);
        assertEq(uint256(project.status), uint256(DAOFunding.FundingStatus.PROPOSED));
    }

    function testAcceptProject() public {
        bytes32 registryId = keccak256("accept-test");
        address[] memory additionalRecipients = new address[](0);
        uint256[] memory shares = new uint256[](0);
        
        vm.prank(user1);
        bytes32 projectId = funding.proposeProject(
            daoId,
            DAOFunding.ProjectType.PACKAGE,
            registryId,
            "Accept Test",
            "Test",
            projectOwner,
            additionalRecipients,
            shares
        );
        
        // Accept project (owner is DAO admin)
        vm.prank(owner);
        funding.acceptProject(projectId);
        
        DAOFunding.FundingProject memory project = funding.getProject(projectId);
        assertEq(uint256(project.status), uint256(DAOFunding.FundingStatus.ACTIVE));
    }

    // ============ Staking Tests ============

    function testStakeToProject() public {
        // Create and accept project
        bytes32 registryId = keccak256("stake-test");
        address[] memory additionalRecipients = new address[](0);
        uint256[] memory shares = new uint256[](0);
        
        vm.prank(user1);
        bytes32 projectId = funding.proposeProject(
            daoId,
            DAOFunding.ProjectType.PACKAGE,
            registryId,
            "Stake Test",
            "Test",
            projectOwner,
            additionalRecipients,
            shares
        );
        
        vm.prank(owner);
        funding.acceptProject(projectId);
        
        // Stake to project
        uint256 stakeAmount = 1 ether;
        
        vm.startPrank(user1);
        token.approve(address(funding), stakeAmount);
        funding.stake(projectId, stakeAmount);
        vm.stopPrank();
        
        (uint256 totalStake, uint256 numStakers) = funding.getProjectEpochStake(projectId, 1);
        assertEq(totalStake, stakeAmount);
        assertEq(numStakers, 1);
    }

    // ============ Epoch Tests ============

    function testCreateEpoch() public {
        vm.prank(owner);
        funding.createEpoch(daoId, 100 ether, 50 ether);
        
        DAOFunding.FundingEpoch memory epoch = funding.getCurrentEpoch(daoId);
        assertEq(epoch.epochId, 1);
        assertEq(epoch.totalBudget, 100 ether);
        assertEq(epoch.matchingPool, 50 ether);
        assertFalse(epoch.finalized);
    }

    // ============ CEO Weight Tests ============

    function testSetCEOWeight() public {
        // Create and accept project
        bytes32 registryId = keccak256("ceo-weight-test");
        address[] memory additionalRecipients = new address[](0);
        uint256[] memory shares = new uint256[](0);
        
        vm.prank(user1);
        bytes32 projectId = funding.proposeProject(
            daoId,
            DAOFunding.ProjectType.REPO,
            registryId,
            "CEO Weight Test",
            "Test",
            projectOwner,
            additionalRecipients,
            shares
        );
        
        vm.prank(owner);
        funding.acceptProject(projectId);
        
        // Set CEO weight (owner is DAO admin)
        vm.prank(owner);
        funding.setCEOWeight(projectId, 3000); // 30%
        
        DAOFunding.FundingProject memory project = funding.getProject(projectId);
        assertEq(project.ceoWeight, 3000);
    }

    // ============ Multi-DAO Tests ============

    function testMultiDAOFunding() public {
        // Create second DAO
        IDAORegistry.CEOPersona memory ceoPersona2 = IDAORegistry.CEOPersona({
            name: "Second CEO",
            pfpCid: "",
            description: "Test",
            personality: "Test",
            traits: new string[](0)
        });
        
        IDAORegistry.GovernanceParams memory params2 = IDAORegistry.GovernanceParams({
            minQualityScore: 80,
            councilVotingPeriod: 5 days,
            gracePeriod: 2 days,
            minProposalStake: 0.05 ether,
            quorumBps: 6000
        });
        
        vm.prank(user2);
        bytes32 daoId2 = registry.createDAO(
            "second-dao",
            "Second DAO",
            "Another DAO",
            address(6),
            "",
            ceoPersona2,
            params2
        );
        
        // Create projects for both DAOs
        address[] memory additionalRecipients = new address[](0);
        uint256[] memory shares = new uint256[](0);
        
        vm.prank(user1);
        bytes32 project1 = funding.proposeProject(
            daoId,
            DAOFunding.ProjectType.PACKAGE,
            keccak256("dao1-pkg"),
            "DAO 1 Package",
            "Test",
            projectOwner,
            additionalRecipients,
            shares
        );
        
        vm.prank(user1);
        bytes32 project2 = funding.proposeProject(
            daoId2,
            DAOFunding.ProjectType.REPO,
            keccak256("dao2-repo"),
            "DAO 2 Repo",
            "Test",
            address(7),
            additionalRecipients,
            shares
        );
        
        // Verify projects belong to correct DAOs
        DAOFunding.FundingProject memory p1 = funding.getProject(project1);
        DAOFunding.FundingProject memory p2 = funding.getProject(project2);
        
        assertEq(p1.daoId, daoId);
        assertEq(p2.daoId, daoId2);
        
        // Get projects by DAO
        bytes32[] memory dao1Projects = funding.getDAOProjects(daoId);
        bytes32[] memory dao2Projects = funding.getDAOProjects(daoId2);
        
        assertEq(dao1Projects.length, 1);
        assertEq(dao2Projects.length, 1);
        assertEq(dao1Projects[0], project1);
        assertEq(dao2Projects[0], project2);
    }
}

