// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {IIdentityRegistry} from "../src/registry/interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistryTest
 * @notice Comprehensive tests for ERC-8004 Identity Registry
 */
contract IdentityRegistryTest is Test {
    IdentityRegistry public registry;
    
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);
    
    event Registered(uint256 indexed agentId, string tokenURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId, 
        string indexed indexedKey, 
        string key, 
        bytes value
    );
    
    function setUp() public {
        registry = new IdentityRegistry();
    }
    
    // ============ Registration Tests ============
    
    function testRegisterWithTokenURI() public {
        vm.startPrank(alice);
        
        string memory uri = "ipfs://QmTest123";
        vm.expectEmit(true, true, false, true);
        emit Registered(1, uri, alice);
        
        uint256 agentId = registry.register(uri);
        
        assertEq(agentId, 1);
        assertEq(registry.ownerOf(agentId), alice);
        assertEq(registry.tokenURI(agentId), uri);
        assertEq(registry.totalAgents(), 1);
        assertTrue(registry.agentExists(agentId));
        
        vm.stopPrank();
    }
    
    function testRegisterWithMetadata() public {
        vm.startPrank(alice);
        
        string memory uri = "ipfs://QmTest123";
        
        IIdentityRegistry.MetadataEntry[] memory metadata = new IIdentityRegistry.MetadataEntry[](2);
        metadata[0] = IIdentityRegistry.MetadataEntry({
            key: "name",
            value: abi.encode("Test Agent")
        });
        metadata[1] = IIdentityRegistry.MetadataEntry({
            key: "version",
            value: abi.encode("1.0.0")
        });
        
        uint256 agentId = registry.register(uri, metadata);
        
        assertEq(agentId, 1);
        assertEq(abi.decode(registry.getMetadata(agentId, "name"), (string)), "Test Agent");
        assertEq(abi.decode(registry.getMetadata(agentId, "version"), (string)), "1.0.0");
        
        vm.stopPrank();
    }
    
    function testRegisterWithoutTokenURI() public {
        vm.startPrank(alice);
        
        uint256 agentId = registry.register();
        
        assertEq(agentId, 1);
        assertEq(registry.ownerOf(agentId), alice);
        assertEq(registry.tokenURI(agentId), "");
        
        vm.stopPrank();
    }
    
    function testMultipleRegistrations() public {
        vm.prank(alice);
        registry.register("ipfs://agent1");
        
        vm.prank(bob);
        registry.register("ipfs://agent2");
        
        vm.prank(charlie);
        registry.register("ipfs://agent3");
        
        // If any registration fails, test crashes before we get here
        assertEq(registry.totalAgents(), 3);
        assertEq(registry.ownerOf(1), alice);
        assertEq(registry.ownerOf(2), bob);
        assertEq(registry.ownerOf(3), charlie);
    }
    
    // ============ Metadata Tests ============
    
    function testSetMetadata() public {
        vm.startPrank(alice);
        uint256 agentId = registry.register();
        
        bytes memory value = abi.encode("Test Value");
        
        vm.expectEmit(true, true, false, true);
        emit MetadataSet(agentId, "testKey", "testKey", value);
        
        registry.setMetadata(agentId, "testKey", value);
        
        bytes memory retrieved = registry.getMetadata(agentId, "testKey");
        assertEq(keccak256(retrieved), keccak256(value));
        
        vm.stopPrank();
    }
    
    function testSetMetadataAsApproved() public {
        vm.prank(alice);
        uint256 agentId = registry.register();
        
        // Approve bob
        vm.prank(alice);
        registry.approve(bob, agentId);
        
        // Bob can set metadata
        vm.prank(bob);
        bytes memory value = abi.encode("Set by approved");
        registry.setMetadata(agentId, "key", value);
        
        assertEq(keccak256(registry.getMetadata(agentId, "key")), keccak256(value));
    }
    
    function testSetMetadataAsOperator() public {
        vm.prank(alice);
        uint256 agentId = registry.register();
        
        // Set bob as operator for all
        vm.prank(alice);
        registry.setApprovalForAll(bob, true);
        
        // Bob can set metadata
        vm.prank(bob);
        bytes memory value = abi.encode("Set by operator");
        registry.setMetadata(agentId, "key", value);
        
        assertEq(keccak256(registry.getMetadata(agentId, "key")), keccak256(value));
    }
    
    function testCannotSetMetadataUnauthorized() public {
        vm.prank(alice);
        uint256 agentId = registry.register();
        
        vm.prank(bob);
        vm.expectRevert("Not authorized");
        registry.setMetadata(agentId, "key", abi.encode("value"));
    }
    
    function testCannotSetEmptyKey() public {
        vm.prank(alice);
        uint256 agentId = registry.register();
        
        vm.prank(alice);
        vm.expectRevert("Empty key");
        registry.setMetadata(agentId, "", abi.encode("value"));
    }
    
    // ============ NFT Transfer Tests ============
    
    function testTransferAgent() public {
        vm.prank(alice);
        uint256 agentId = registry.register("ipfs://test");
        
        // Transfer from alice to bob
        vm.prank(alice);
        registry.transferFrom(alice, bob, agentId);
        
        assertEq(registry.ownerOf(agentId), bob);
        
        // Bob can now set metadata
        vm.prank(bob);
        registry.setMetadata(agentId, "key", abi.encode("set by new owner"));
        
        // Alice can't set metadata anymore
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        registry.setMetadata(agentId, "key", abi.encode("fail"));
    }
    
    // ============ View Function Tests ============
    
    function testTotalAgents() public {
        assertEq(registry.totalAgents(), 0);
        
        vm.prank(alice);
        registry.register();
        assertEq(registry.totalAgents(), 1);
        
        vm.prank(bob);
        registry.register();
        assertEq(registry.totalAgents(), 2);
    }
    
    function testAgentExists() public {
        assertFalse(registry.agentExists(1));
        assertFalse(registry.agentExists(999));
        
        vm.prank(alice);
        uint256 agentId = registry.register();
        
        assertTrue(registry.agentExists(agentId));
        assertFalse(registry.agentExists(agentId + 1));
    }
    
    function testGetMetadataNonExistentAgent() public {
        vm.expectRevert("Agent does not exist");
        registry.getMetadata(999, "key");
    }
    
    // ============ ERC-721 Compliance Tests ============
    
    function testERC721Name() public view {
        assertEq(registry.name(), "ERC-8004 Trustless Agent");
    }
    
    function testERC721Symbol() public view {
        assertEq(registry.symbol(), "AGENT");
    }
    
    function testSupportsInterface() public view {
        // ERC-721
        assertTrue(registry.supportsInterface(0x80ac58cd));
        // ERC-721 Metadata
        assertTrue(registry.supportsInterface(0x5b5e139f));
        // ERC-165
        assertTrue(registry.supportsInterface(0x01ffc9a7));
    }
    
    // ============ Version Test ============
    
    function testVersion() public view {
        assertEq(registry.version(), "2.0.0-governance");
    }
    
    // ============ Complex Scenario Tests ============
    
    function testFullAgentLifecycle() public {
        // Register agent
        vm.startPrank(alice);
        uint256 agentId = registry.register("ipfs://agent-config");
        
        // Set initial metadata
        registry.setMetadata(agentId, "name", abi.encode("AI Assistant"));
        registry.setMetadata(agentId, "model", abi.encode("GPT-4"));
        registry.setMetadata(agentId, "capabilities", abi.encode("chat,code,analysis"));
        
        // Verify metadata
        assertEq(abi.decode(registry.getMetadata(agentId, "name"), (string)), "AI Assistant");
        assertEq(abi.decode(registry.getMetadata(agentId, "model"), (string)), "GPT-4");
        
        // Update metadata
        registry.setMetadata(agentId, "model", abi.encode("GPT-4-Turbo"));
        assertEq(abi.decode(registry.getMetadata(agentId, "model"), (string)), "GPT-4-Turbo");
        
        // Transfer to new owner
        registry.transferFrom(alice, bob, agentId);
        vm.stopPrank();
        
        // New owner can update
        vm.prank(bob);
        registry.setMetadata(agentId, "owner", abi.encode("Bob"));
        
        assertEq(registry.ownerOf(agentId), bob);
        assertEq(abi.decode(registry.getMetadata(agentId, "owner"), (string)), "Bob");
    }
}

