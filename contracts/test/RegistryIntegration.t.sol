// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/registry/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/registry/ValidationRegistry.sol";

/**
 * @title RegistryIntegrationTest
 * @notice End-to-end integration tests for the complete ERC-8004 registry system
 */
contract RegistryIntegrationTest is Test {
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    ValidationRegistry public validationRegistry;
    
    address public agentOwner = address(0x1);
    address public client = address(0x2);
    address public validator = address(0x3);
    
    uint256 public agentId;
    
    function setUp() public {
        // Deploy all registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));
        validationRegistry = new ValidationRegistry(payable(address(identityRegistry)));
        
        // Register a test agent
        vm.prank(agentOwner);
        agentId = identityRegistry.register("ipfs://test-agent");
    }
    
    // ============ Basic Integration Tests ============
    
    function testRegistriesConnected() public view {
        assertEq(reputationRegistry.getIdentityRegistry(), address(identityRegistry));
        assertEq(validationRegistry.getIdentityRegistry(), address(identityRegistry));
    }
    
    function testFullAgentWorkflow() public {
        // 1. Agent is registered
        assertTrue(identityRegistry.agentExists(agentId));
        assertEq(identityRegistry.ownerOf(agentId), agentOwner);
        
        // 2. Set agent metadata
        vm.startPrank(agentOwner);
        identityRegistry.setMetadata(agentId, "name", abi.encode("Trading Bot"));
        identityRegistry.setMetadata(agentId, "type", abi.encode("financial"));
        vm.stopPrank();
        
        // 3. Verify metadata
        string memory name = abi.decode(identityRegistry.getMetadata(agentId, "name"), (string));
        assertEq(name, "Trading Bot");
        
        // 4. Request validation
        vm.prank(agentOwner);
        validationRegistry.validationRequest(
            validator,
            agentId,
            "ipfs://validation-request",
            keccak256("validation-data")
        );
        
        bytes32[] memory validations = validationRegistry.getAgentValidations(agentId);
        assertEq(validations.length, 1);
        
        // 5. Validator responds
        bytes32 requestHash = validations[0];
        vm.prank(validator);
        validationRegistry.validationResponse(
            requestHash,
            95, // 95% validation score
            "ipfs://validation-result",
            keccak256("result-data"),
            bytes32("approved")
        );
        
        // 6. Check validation status
        (
            address validatorAddr,
            uint256 validatedAgentId,
            uint8 response,
            bytes32 tag,
            uint256 lastUpdate
        ) = validationRegistry.getValidationStatus(requestHash);
        
        assertEq(validatorAddr, validator);
        assertEq(validatedAgentId, agentId);
        assertEq(response, 95);
        assertEq(tag, bytes32("approved"));
        assertGt(lastUpdate, 0);
    }
    
    function testVersions() public view {
        assertEq(identityRegistry.version(), "2.0.0-governance");
        assertEq(reputationRegistry.version(), "1.0.0");
        assertEq(validationRegistry.version(), "1.0.0");
    }
    
    // ============ Multi-Agent Tests ============
    
    function testMultipleAgentsAndValidations() public {
        // Register multiple agents
        address agent1Owner = address(0x10);
        address agent2Owner = address(0x11);
        address agent3Owner = address(0x12);
        
        vm.prank(agent1Owner);
        uint256 agent1 = identityRegistry.register("ipfs://agent1");
        
        vm.prank(agent2Owner);
        uint256 agent2 = identityRegistry.register("ipfs://agent2");
        
        vm.prank(agent3Owner);
        uint256 agent3 = identityRegistry.register("ipfs://agent3");
        
        assertEq(identityRegistry.totalAgents(), 4); // Including setup agent
        
        // Each agent requests validation
        vm.prank(agent1Owner);
        validationRegistry.validationRequest(
            validator,
            agent1,
            "ipfs://val-req-1",
            keccak256("data1")
        );
        
        vm.prank(agent2Owner);
        validationRegistry.validationRequest(
            validator,
            agent2,
            "ipfs://val-req-2",
            keccak256("data2")
        );
        
        vm.prank(agent3Owner);
        validationRegistry.validationRequest(
            validator,
            agent3,
            "ipfs://val-req-3",
            keccak256("data3")
        );
        
        // Validator should have 3 requests
        bytes32[] memory validatorRequests = validationRegistry.getValidatorRequests(validator);
        assertEq(validatorRequests.length, 3);
        
        // Each agent should have 1 validation
        assertEq(validationRegistry.getAgentValidations(agent1).length, 1);
        assertEq(validationRegistry.getAgentValidations(agent2).length, 1);
        assertEq(validationRegistry.getAgentValidations(agent3).length, 1);
    }
    
    // ============ Registry Discovery Tests ============
    
    function testAgentDiscovery() public {
        // Register agents with different metadata for discovery
        vm.startPrank(agentOwner);
        
        uint256 agent1 = identityRegistry.register("ipfs://ai-chat-bot");
        identityRegistry.setMetadata(agent1, "type", abi.encode("chatbot"));
        identityRegistry.setMetadata(agent1, "category", abi.encode("customer-service"));
        
        uint256 agent2 = identityRegistry.register("ipfs://trading-bot");
        identityRegistry.setMetadata(agent2, "type", abi.encode("trading"));
        identityRegistry.setMetadata(agent2, "category", abi.encode("defi"));
        
        vm.stopPrank();
        
        // Verify we can retrieve metadata for discovery
        string memory type1 = abi.decode(identityRegistry.getMetadata(agent1, "type"), (string));
        string memory type2 = abi.decode(identityRegistry.getMetadata(agent2, "type"), (string));
        
        assertEq(type1, "chatbot");
        assertEq(type2, "trading");
    }
    
    // ============ Access Control Tests ============
    
    function testOnlyAgentOwnerCanRequestValidation() public {
        // Non-owner can't request validation
        vm.prank(client);
        vm.expectRevert("Not authorized");
        validationRegistry.validationRequest(
            validator,
            agentId,
            "ipfs://unauthorized-request",
            keccak256("data")
        );
        
        // Owner can request validation
        vm.prank(agentOwner);
        validationRegistry.validationRequest(
            validator,
            agentId,
            "ipfs://authorized-request",
            keccak256("data")
        );
        
        assertEq(validationRegistry.getAgentValidations(agentId).length, 1);
    }
    
    function testOnlyValidatorCanRespond() public {
        // Create validation request
        vm.prank(agentOwner);
        validationRegistry.validationRequest(
            validator,
            agentId,
            "ipfs://request",
            keccak256("data")
        );
        
        bytes32 requestHash = validationRegistry.getAgentValidations(agentId)[0];
        
        // Non-validator can't respond
        vm.prank(client);
        vm.expectRevert("Not authorized validator");
        validationRegistry.validationResponse(
            requestHash,
            90,
            "ipfs://response",
            keccak256("result"),
            bytes32("approved")
        );
        
        // Validator can respond
        vm.prank(validator);
        validationRegistry.validationResponse(
            requestHash,
            90,
            "ipfs://response",
            keccak256("result"),
            bytes32("approved")
        );
        
        (, , uint8 response, , ) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 90);
    }
}

