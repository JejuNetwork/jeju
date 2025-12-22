// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {RoomRegistry} from "../../src/agents/RoomRegistry.sol";

contract RoomRegistryTest is Test {
    RoomRegistry public registry;
    
    address public owner;
    address public user1;
    address public user2;
    
    uint256 public constant AGENT_1 = 1;
    uint256 public constant AGENT_2 = 2;
    uint256 public constant AGENT_3 = 3;
    
    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        
        vm.prank(owner);
        registry = new RoomRegistry();
    }
    
    // ============ Room Creation Tests ============
    
    function test_CreateRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom(
            "Test Room",
            "A collaboration room",
            RoomRegistry.RoomType.COLLABORATION,
            ""
        );
        
        assertEq(roomId, 1);
        assertEq(registry.totalActiveRooms(), 1);
        
        (address roomOwner, string memory name,, RoomRegistry.RoomType roomType, bool active) = registry.getRoom(roomId);
        assertEq(roomOwner, user1);
        assertEq(name, "Test Room");
        assertEq(uint8(roomType), uint8(RoomRegistry.RoomType.COLLABORATION));
        assertTrue(active);
    }
    
    function test_CreateRoomWithConfig() public {
        bytes memory config = abi.encode(uint256(20), true, uint256(600));
        
        vm.prank(user1);
        uint256 roomId = registry.createRoom(
            "Turn-Based Room",
            "A turn-based debate room",
            RoomRegistry.RoomType.DEBATE,
            config
        );
        
        (uint256 maxMembers, bool turnBased, uint256 turnTimeout,,, ) = registry.roomConfigs(roomId);
        assertEq(maxMembers, 20);
        assertTrue(turnBased);
        assertEq(turnTimeout, 600);
    }
    
    function test_CreateAdversarialRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom(
            "Red vs Blue",
            "Adversarial competition",
            RoomRegistry.RoomType.ADVERSARIAL,
            ""
        );
        
        (,,,RoomRegistry.RoomType roomType,) = registry.getRoom(roomId);
        assertEq(uint8(roomType), uint8(RoomRegistry.RoomType.ADVERSARIAL));
    }
    
    // ============ Member Management Tests ============
    
    function test_JoinRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        assertTrue(registry.isMember(roomId, AGENT_1));
        assertEq(registry.getMemberCount(roomId), 1);
    }
    
    function test_JoinRoom_RevertIfAlreadyMember() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RoomRegistry.AlreadyMember.selector, roomId, AGENT_1));
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
    }
    
    function test_JoinRoom_RevertIfFull() public {
        bytes memory config = abi.encode(uint256(2), false, uint256(300));
        
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Small Room", "", RoomRegistry.RoomType.COLLABORATION, config);
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_2, RoomRegistry.AgentRole.PARTICIPANT);
        
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RoomRegistry.RoomFull.selector, roomId));
        registry.joinRoom(roomId, AGENT_3, RoomRegistry.AgentRole.PARTICIPANT);
    }
    
    function test_JoinAdversarialRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Red vs Blue", "", RoomRegistry.RoomType.ADVERSARIAL, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.RED_TEAM);
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_2, RoomRegistry.AgentRole.BLUE_TEAM);
        
        RoomRegistry.Member memory redMember = registry.getMember(roomId, AGENT_1);
        RoomRegistry.Member memory blueMember = registry.getMember(roomId, AGENT_2);
        
        assertEq(uint8(redMember.role), uint8(RoomRegistry.AgentRole.RED_TEAM));
        assertEq(uint8(blueMember.role), uint8(RoomRegistry.AgentRole.BLUE_TEAM));
    }
    
    function test_LeaveRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        assertEq(registry.getMemberCount(roomId), 1);
        
        vm.prank(user2);
        registry.leaveRoom(roomId, AGENT_1);
        
        assertFalse(registry.isMember(roomId, AGENT_1));
        assertEq(registry.getMemberCount(roomId), 0);
    }
    
    // ============ State Management Tests ============
    
    function test_UpdateRoomState() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.updateRoomState(roomId, "QmTestCid123");
        
        (,, string memory stateCid,,) = registry.getRoom(roomId);
        assertEq(stateCid, "QmTestCid123");
    }
    
    function test_SetPhase() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        // SETUP -> ACTIVE
        vm.prank(user1);
        registry.setPhase(roomId, RoomRegistry.RoomPhase.ACTIVE);
        
        // ACTIVE -> PAUSED
        vm.prank(user1);
        registry.setPhase(roomId, RoomRegistry.RoomPhase.PAUSED);
        
        // PAUSED -> COMPLETED
        vm.prank(user1);
        registry.setPhase(roomId, RoomRegistry.RoomPhase.COMPLETED);
        
        (,,,, bool active) = registry.getRoom(roomId);
        assertFalse(active);
    }
    
    function test_SetPhase_RevertInvalidTransition() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        // Cannot go from SETUP directly to COMPLETED
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(
            RoomRegistry.InvalidPhaseTransition.selector,
            RoomRegistry.RoomPhase.SETUP,
            RoomRegistry.RoomPhase.COMPLETED
        ));
        registry.setPhase(roomId, RoomRegistry.RoomPhase.COMPLETED);
    }
    
    // ============ Scoring Tests ============
    
    function test_UpdateScore() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Competition", "", RoomRegistry.RoomType.ADVERSARIAL, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.RED_TEAM);
        
        vm.prank(user2);
        registry.updateScore(roomId, AGENT_1, 10);
        
        RoomRegistry.Member memory member = registry.getMember(roomId, AGENT_1);
        assertEq(member.score, 10);
        
        // Negative score
        vm.prank(user2);
        registry.updateScore(roomId, AGENT_1, -5);
        
        member = registry.getMember(roomId, AGENT_1);
        assertEq(member.score, 5);
    }
    
    function test_RecordMessage() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Chat", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        vm.prank(user2);
        registry.recordMessage(roomId, AGENT_1);
        
        RoomRegistry.Member memory member = registry.getMember(roomId, AGENT_1);
        assertEq(member.messageCount, 1);
        assertEq(registry.roomMessageCount(roomId), 1);
    }
    
    // ============ Room Completion Tests ============
    
    function test_CompleteRoom() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Competition", "", RoomRegistry.RoomType.ADVERSARIAL, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.RED_TEAM);
        
        vm.prank(user1);
        registry.completeRoom(roomId, AGENT_1, "Red team wins!");
        
        (,,,, bool active) = registry.getRoom(roomId);
        assertFalse(active);
    }
    
    // ============ View Function Tests ============
    
    function test_GetMembers() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_2, RoomRegistry.AgentRole.MODERATOR);
        
        (uint256[] memory agentIds, RoomRegistry.AgentRole[] memory roles) = registry.getMembers(roomId);
        
        assertEq(agentIds.length, 2);
        assertEq(agentIds[0], AGENT_1);
        assertEq(agentIds[1], AGENT_2);
        assertEq(uint8(roles[0]), uint8(RoomRegistry.AgentRole.PARTICIPANT));
        assertEq(uint8(roles[1]), uint8(RoomRegistry.AgentRole.MODERATOR));
    }
    
    function test_GetScores() public {
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Competition", "", RoomRegistry.RoomType.ADVERSARIAL, "");
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_1, RoomRegistry.AgentRole.RED_TEAM);
        
        vm.prank(user2);
        registry.joinRoom(roomId, AGENT_2, RoomRegistry.AgentRole.BLUE_TEAM);
        
        vm.prank(user2);
        registry.updateScore(roomId, AGENT_1, 50);
        
        vm.prank(user2);
        registry.updateScore(roomId, AGENT_2, 30);
        
        (uint256[] memory agentIds, int256[] memory scores) = registry.getScores(roomId);
        
        assertEq(scores[0], 50);
        assertEq(scores[1], 30);
    }
    
    function test_GetAgentRooms() public {
        vm.prank(user1);
        uint256 room1 = registry.createRoom("Room 1", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(user1);
        uint256 room2 = registry.createRoom("Room 2", "", RoomRegistry.RoomType.DEBATE, "");
        
        vm.startPrank(user2);
        registry.joinRoom(room1, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        registry.joinRoom(room2, AGENT_1, RoomRegistry.AgentRole.PARTICIPANT);
        vm.stopPrank();
        
        uint256[] memory rooms = registry.getAgentRooms(AGENT_1);
        assertEq(rooms.length, 2);
        assertEq(rooms[0], room1);
        assertEq(rooms[1], room2);
    }
    
    // ============ Admin Tests ============
    
    function test_SetMaxMembersLimit() public {
        vm.prank(owner);
        registry.setMaxMembersLimit(50);
        
        assertEq(registry.maxMembersLimit(), 50);
    }
    
    function test_PauseUnpause() public {
        vm.prank(owner);
        registry.pause();
        
        vm.prank(user1);
        vm.expectRevert();
        registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        
        vm.prank(owner);
        registry.unpause();
        
        vm.prank(user1);
        uint256 roomId = registry.createRoom("Test", "", RoomRegistry.RoomType.COLLABORATION, "");
        assertEq(roomId, 1);
    }
}
