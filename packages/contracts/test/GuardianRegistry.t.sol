// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/work/GuardianRegistry.sol";
import "../src/registry/IdentityRegistry.sol";

contract GuardianRegistryTest is Test {
    GuardianRegistry public guardianRegistry;
    IdentityRegistry public identityRegistry;
    
    address public owner = address(1);
    address public guardian1 = address(2);
    address public guardian2 = address(3);
    
    uint256 public constant MIN_STAKE = 0.1 ether;
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy IdentityRegistry
        identityRegistry = new IdentityRegistry();
        
        // Deploy GuardianRegistry (needs treasury address too)
        guardianRegistry = new GuardianRegistry(
            address(identityRegistry),
            address(4), // treasury
            owner
        );
        
        vm.stopPrank();
        
        // Fund test accounts
        vm.deal(guardian1, 10 ether);
        vm.deal(guardian2, 10 ether);
    }
    
    function test_RegisterGuardian() public {
        // First register an agent in IdentityRegistry
        vm.startPrank(guardian1);
        uint256 agentId = identityRegistry.register("ipfs://metadata...");
        
        // Register as guardian
        string[] memory specializations = new string[](2);
        specializations[0] = "solidity";
        specializations[1] = "security";
        
        guardianRegistry.registerGuardian{value: MIN_STAKE}(agentId, specializations);
        
        vm.stopPrank();
        
        // Verify registration
        GuardianRegistry.Guardian memory guardian = guardianRegistry.getGuardian(agentId);
        assertEq(guardian.owner, guardian1);
        assertTrue(guardian.isActive);
        assertEq(guardian.stakedAmount, MIN_STAKE);
    }
    
    function test_RevertRegisterWithoutAgent() public {
        vm.startPrank(guardian1);
        
        string[] memory specializations = new string[](1);
        specializations[0] = "solidity";
        
        // Should fail because no agent registered with this ID - reverts with ERC721NonexistentToken
        vm.expectRevert();
        guardianRegistry.registerGuardian{value: MIN_STAKE}(999, specializations);
        
        vm.stopPrank();
    }
    
    function test_SubmitReview() public {
        // Setup: Register guardian
        vm.startPrank(guardian1);
        uint256 agentId = identityRegistry.register("ipfs://...");
        
        string[] memory specs = new string[](1);
        specs[0] = "code-review";
        guardianRegistry.registerGuardian{value: MIN_STAKE}(agentId, specs);
        
        // Submit a review
        bytes32 subjectId = keccak256("bounty-123");
        string[] memory suggestions = new string[](1);
        suggestions[0] = "Consider adding input validation";
        
        bytes32 reviewId = guardianRegistry.submitReview(
            subjectId,
            "bounty",
            GuardianRegistry.ReviewAction.APPROVE,
            "ipfs://review-notes...",
            suggestions
        );
        
        vm.stopPrank();
        
        // Verify review was recorded
        assertTrue(reviewId != bytes32(0));
    }
    
    function test_BanGuardian() public {
        // Setup: Register guardian
        vm.startPrank(guardian1);
        uint256 agentId = identityRegistry.register("ipfs://...");
        
        string[] memory specs = new string[](1);
        specs[0] = "testing";
        guardianRegistry.registerGuardian{value: MIN_STAKE}(agentId, specs);
        vm.stopPrank();
        
        // Ban as owner
        vm.prank(owner);
        guardianRegistry.banGuardian(agentId, "Malicious behavior");
        
        // Verify banned
        GuardianRegistry.Guardian memory guardian = guardianRegistry.getGuardian(agentId);
        assertTrue(guardian.isBanned);
    }
    
    function test_GetActiveGuardianCount() public {
        // Register two guardians
        vm.startPrank(guardian1);
        uint256 agentId1 = identityRegistry.register("ipfs://1");
        string[] memory specs = new string[](1);
        specs[0] = "solidity";
        guardianRegistry.registerGuardian{value: MIN_STAKE}(agentId1, specs);
        vm.stopPrank();
        
        vm.startPrank(guardian2);
        uint256 agentId2 = identityRegistry.register("ipfs://2");
        guardianRegistry.registerGuardian{value: MIN_STAKE}(agentId2, specs);
        vm.stopPrank();
        
        // Get active guardian count
        uint256 count = guardianRegistry.getActiveGuardianCount();
        assertEq(count, 2);
    }
}

