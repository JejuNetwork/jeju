// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {SecurityBountyRegistry} from "../../src/security/SecurityBountyRegistry.sol";

// Mock IdentityRegistry that implements the required interface
contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => bool) public exists;
    uint256 public _totalAgents;
    
    function setAgent(uint256 agentId, address _owner) external {
        owners[agentId] = _owner;
        exists[agentId] = true;
        _totalAgents++;
    }
    
    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }
    
    function agentExists(uint256 agentId) external view returns (bool) {
        return exists[agentId];
    }
    
    function totalAgents() external view returns (uint256) {
        return _totalAgents;
    }
    
    function getAgentProfile(uint256) external pure returns (
        string memory name,
        string memory description,
        string memory avatarCid,
        bool nsfw
    ) {
        return ("Agent", "Test agent", "", false);
    }
    
    // Required for _getAgentId to work
    function getAgentByOwner(address) external pure returns (uint256) {
        return 0; // Return 0 for simplicity
    }
    
    // Make the mock payable
    receive() external payable {}
}

contract SecurityBountyRegistryTest is Test {
    SecurityBountyRegistry public registry;
    MockIdentityRegistry public identityRegistry;
    
    address public owner;
    address public treasury;
    address public ceoAgent;
    address public computeOracle;
    address public researcher;
    
    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        ceoAgent = makeAddr("ceoAgent");
        computeOracle = makeAddr("computeOracle");
        researcher = makeAddr("researcher");
        
        vm.deal(owner, 100 ether);
        vm.deal(treasury, 100 ether);
        vm.deal(researcher, 10 ether);
        
        // Deploy mock identity registry
        identityRegistry = new MockIdentityRegistry();
        
        // Deploy registry
        vm.prank(owner);
        registry = new SecurityBountyRegistry(
            address(identityRegistry),
            treasury,
            ceoAgent,
            owner
        );
        
        // Configure
        vm.prank(owner);
        registry.setComputeOracle(computeOracle);
        
        // Fund the bounty pool
        vm.prank(owner);
        registry.fundBountyPool{value: 50 ether}();
    }
    
    // ============ Submission Tests ============
    
    function test_SubmitVulnerability() public {
        bytes32 encryptedReportCid = keccak256("encrypted-report");
        bytes32 encryptionKeyId = keccak256("key-id");
        bytes32 pocHash = keccak256("proof-of-concept");
        bytes32 vulnHash = keccak256("vuln-description-unique-1");
        
        vm.prank(researcher);
        bytes32 submissionId = registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            encryptedReportCid,
            encryptionKeyId,
            pocHash,
            vulnHash
        );
        
        assertTrue(submissionId != bytes32(0));
    }
    
    function test_SubmitVulnerability_RevertIfInsufficientStake() public {
        vm.prank(researcher);
        vm.expectRevert(SecurityBountyRegistry.InsufficientStake.selector);
        registry.submitVulnerability{value: 0.0001 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            keccak256("vuln-unique-2")
        );
    }
    
    function test_SubmitVulnerability_RevertIfDuplicate() public {
        bytes32 vulnHash = keccak256("unique-vuln-hash-for-dup-test");
        
        vm.prank(researcher);
        registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            vulnHash
        );
        
        vm.prank(researcher);
        vm.expectRevert(SecurityBountyRegistry.DuplicateVulnerability.selector);
        registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report2"),
            keccak256("key2"),
            keccak256("poc2"),
            vulnHash // Same hash
        );
    }
    
    // ============ Validation Flow Tests ============
    
    function test_StartValidation() public {
        vm.prank(researcher);
        bytes32 submissionId = registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            keccak256("vuln-unique-3")
        );
        
        bytes32 sandboxJobId = keccak256("sandbox-job");
        
        vm.prank(computeOracle);
        registry.startValidation(submissionId, sandboxJobId);
    }
    
    function test_CompleteValidation() public {
        vm.prank(researcher);
        bytes32 submissionId = registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            keccak256("vuln-unique-4")
        );
        
        vm.prank(computeOracle);
        registry.startValidation(submissionId, keccak256("sandbox-job"));
        
        vm.prank(computeOracle);
        registry.completeValidation(
            submissionId,
            SecurityBountyRegistry.ValidationResult.VERIFIED,
            "Exploit confirmed in sandbox",
            0.01 ether
        );
    }
    
    // ============ Bounty Pool Tests ============
    
    function test_FundBountyPool() public {
        uint256 poolBefore = registry.totalBountyPool();
        
        vm.prank(owner);
        registry.fundBountyPool{value: 10 ether}();
        
        assertEq(registry.totalBountyPool(), poolBefore + 10 ether);
    }
    
    // ============ Admin Tests ============
    
    function test_SetComputeOracle() public {
        address newOracle = makeAddr("newOracle");
        
        vm.prank(owner);
        registry.setComputeOracle(newOracle);
        
        assertEq(registry.computeOracle(), newOracle);
    }
    
    function test_SetCEOAgent() public {
        address newCEO = makeAddr("newCEO");
        
        vm.prank(owner);
        registry.setCEOAgent(newCEO);
        
        assertEq(registry.ceoAgent(), newCEO);
    }
    
    function test_PauseUnpause() public {
        vm.prank(owner);
        registry.pause();
        
        vm.prank(researcher);
        vm.expectRevert();
        registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            keccak256("vuln-unique-paused")
        );
        
        vm.prank(owner);
        registry.unpause();
        
        vm.prank(researcher);
        registry.submitVulnerability{value: 0.01 ether}(
            SecurityBountyRegistry.Severity.HIGH,
            SecurityBountyRegistry.VulnerabilityType.PRIVILEGE_ESCALATION,
            keccak256("report"),
            keccak256("key"),
            keccak256("poc"),
            keccak256("vuln-unique-unpaused")
        );
    }
    
    // ============ View Functions Tests ============
    
    function test_TotalBountyPool() public view {
        assertEq(registry.totalBountyPool(), 50 ether);
    }
    
    function test_MinStake() public view {
        assertEq(registry.MIN_STAKE(), 0.001 ether);
    }
}
