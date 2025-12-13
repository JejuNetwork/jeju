// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RoomRegistry
 * @author Jeju Network
 * @notice Manages multi-agent coordination rooms
 * @dev Enables agents to coordinate via shared state, supporting:
 *      - Collaborative rooms (agents work together)
 *      - Adversarial rooms (red team vs blue team)
 *      - Debate rooms (structured argument)
 *      - Council rooms (governance/voting)
 *
 * @custom:security-contact security@jeju.network
 */
contract RoomRegistry is Ownable, ReentrancyGuard, Pausable {
    // ============ Enums ============

    enum RoomType {
        COLLABORATION,  // Agents work together toward a goal
        ADVERSARIAL,    // Red team vs blue team competition
        DEBATE,         // Structured argument with judges
        COUNCIL         // Governance/voting decisions
    }

    enum AgentRole {
        PARTICIPANT,    // Standard member
        MODERATOR,      // Can manage room
        RED_TEAM,       // Adversarial attacker
        BLUE_TEAM,      // Adversarial defender
        OBSERVER        // Read-only access
    }

    enum RoomPhase {
        SETUP,          // Room being configured
        ACTIVE,         // Room is live
        PAUSED,         // Temporarily paused
        COMPLETED,      // Room finished
        ARCHIVED        // Historical record
    }

    // ============ Structs ============

    struct Room {
        uint256 roomId;
        address owner;
        string name;
        string description;
        string stateCid;        // IPFS CID for room state
        RoomType roomType;
        RoomPhase phase;
        uint256 maxMembers;
        bool turnBased;
        uint256 turnTimeout;    // seconds
        uint256 createdAt;
        uint256 updatedAt;
        bool active;
    }

    struct Member {
        uint256 agentId;
        AgentRole role;
        int256 score;           // For adversarial rooms
        uint256 joinedAt;
        uint256 lastActiveAt;
        uint256 messageCount;
        bool active;
    }

    struct RoomConfig {
        uint256 maxMembers;
        bool turnBased;
        uint256 turnTimeout;
        uint256 redTeamTarget;  // Target score for red team win
        uint256 blueTeamTarget; // Target score for blue team win
        bytes customRules;      // Encoded custom rules
    }

    // ============ State Variables ============

    /// @notice All rooms by ID
    mapping(uint256 => Room) public rooms;

    /// @notice Room members: roomId => agentId => member
    mapping(uint256 => mapping(uint256 => Member)) public members;

    /// @notice Room member lists: roomId => agentId[]
    mapping(uint256 => uint256[]) private _memberLists;

    /// @notice Agent room memberships: agentId => roomId[]
    mapping(uint256 => uint256[]) public agentRooms;

    /// @notice Room configurations
    mapping(uint256 => RoomConfig) public roomConfigs;

    /// @notice Next room ID
    uint256 public nextRoomId = 1;

    /// @notice Total active rooms
    uint256 public totalActiveRooms;

    /// @notice Max members per room
    uint256 public maxMembersLimit = 100;

    /// @notice Message count per room
    mapping(uint256 => uint256) public roomMessageCount;

    // ============ Events ============

    event RoomCreated(uint256 indexed roomId, address indexed owner, string name, RoomType roomType);
    event MemberJoined(uint256 indexed roomId, uint256 indexed agentId, AgentRole role);
    event MemberLeft(uint256 indexed roomId, uint256 indexed agentId);
    event MemberRoleUpdated(uint256 indexed roomId, uint256 indexed agentId, AgentRole newRole);
    event StateUpdated(uint256 indexed roomId, string stateCid, uint256 version);
    event PhaseChanged(uint256 indexed roomId, RoomPhase oldPhase, RoomPhase newPhase);
    event ScoreUpdated(uint256 indexed roomId, uint256 indexed agentId, int256 delta, int256 newScore);
    event MessagePosted(uint256 indexed roomId, uint256 indexed agentId, uint256 messageIndex);
    event RoomCompleted(uint256 indexed roomId, uint256 winnerId, string reason);

    // ============ Errors ============

    error RoomNotFound(uint256 roomId);
    error RoomNotActive(uint256 roomId);
    error NotRoomOwner(uint256 roomId, address caller);
    error NotRoomMember(uint256 roomId, uint256 agentId);
    error AlreadyMember(uint256 roomId, uint256 agentId);
    error RoomFull(uint256 roomId);
    error InvalidPhaseTransition(RoomPhase current, RoomPhase requested);
    error NotModerator(uint256 roomId, address caller);
    error InvalidRole();
    error InvalidRoomType();

    // ============ Modifiers ============

    modifier roomExists(uint256 roomId) {
        if (rooms[roomId].createdAt == 0) {
            revert RoomNotFound(roomId);
        }
        _;
    }

    modifier roomActive(uint256 roomId) {
        if (!rooms[roomId].active) {
            revert RoomNotActive(roomId);
        }
        _;
    }

    modifier onlyRoomOwner(uint256 roomId) {
        if (rooms[roomId].owner != msg.sender) {
            revert NotRoomOwner(roomId, msg.sender);
        }
        _;
    }

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Room Management ============

    /**
     * @notice Create a new room
     * @param name Room name
     * @param description Room description
     * @param roomType Type of room
     * @param config Room configuration
     * @return roomId The created room ID
     */
    function createRoom(
        string calldata name,
        string calldata description,
        RoomType roomType,
        bytes calldata config
    ) external whenNotPaused returns (uint256 roomId) {
        roomId = nextRoomId++;

        // Decode and validate config
        RoomConfig memory roomConfig = _decodeConfig(config, roomType);
        
        if (roomConfig.maxMembers == 0) {
            roomConfig.maxMembers = 10;
        }
        if (roomConfig.maxMembers > maxMembersLimit) {
            roomConfig.maxMembers = maxMembersLimit;
        }

        rooms[roomId] = Room({
            roomId: roomId,
            owner: msg.sender,
            name: name,
            description: description,
            stateCid: "",
            roomType: roomType,
            phase: RoomPhase.SETUP,
            maxMembers: roomConfig.maxMembers,
            turnBased: roomConfig.turnBased,
            turnTimeout: roomConfig.turnTimeout,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            active: true
        });

        roomConfigs[roomId] = roomConfig;
        totalActiveRooms++;

        emit RoomCreated(roomId, msg.sender, name, roomType);
    }

    /**
     * @notice Join an agent to a room
     * @param roomId The room ID
     * @param agentId The agent ID (ERC-8004)
     * @param role Agent's role in the room
     */
    function joinRoom(uint256 roomId, uint256 agentId, AgentRole role)
        external
        roomExists(roomId)
        roomActive(roomId)
    {
        Room storage room = rooms[roomId];
        
        // Check if already a member
        if (members[roomId][agentId].joinedAt != 0) {
            revert AlreadyMember(roomId, agentId);
        }

        // Check room capacity
        if (_memberLists[roomId].length >= room.maxMembers) {
            revert RoomFull(roomId);
        }

        // Validate role for room type
        _validateRoleForRoomType(room.roomType, role);

        members[roomId][agentId] = Member({
            agentId: agentId,
            role: role,
            score: 0,
            joinedAt: block.timestamp,
            lastActiveAt: block.timestamp,
            messageCount: 0,
            active: true
        });

        _memberLists[roomId].push(agentId);
        agentRooms[agentId].push(roomId);

        emit MemberJoined(roomId, agentId, role);
    }

    /**
     * @notice Leave a room
     * @param roomId The room ID
     * @param agentId The agent ID
     */
    function leaveRoom(uint256 roomId, uint256 agentId)
        external
        roomExists(roomId)
    {
        if (members[roomId][agentId].joinedAt == 0) {
            revert NotRoomMember(roomId, agentId);
        }

        members[roomId][agentId].active = false;
        
        // Remove from member list (gas intensive, but necessary for accurate counts)
        _removeMemberFromList(roomId, agentId);
        
        emit MemberLeft(roomId, agentId);
    }

    /**
     * @notice Update room state (IPFS CID)
     * @param roomId The room ID
     * @param stateCid New state CID
     */
    function updateRoomState(uint256 roomId, string calldata stateCid)
        external
        roomExists(roomId)
        roomActive(roomId)
    {
        Room storage room = rooms[roomId];
        room.stateCid = stateCid;
        room.updatedAt = block.timestamp;

        emit StateUpdated(roomId, stateCid, room.updatedAt);
    }

    /**
     * @notice Change room phase
     * @param roomId The room ID
     * @param newPhase New phase
     */
    function setPhase(uint256 roomId, RoomPhase newPhase)
        external
        roomExists(roomId)
        onlyRoomOwner(roomId)
    {
        Room storage room = rooms[roomId];
        RoomPhase oldPhase = room.phase;

        // Validate phase transition
        _validatePhaseTransition(oldPhase, newPhase);

        room.phase = newPhase;
        room.updatedAt = block.timestamp;

        if (newPhase == RoomPhase.COMPLETED || newPhase == RoomPhase.ARCHIVED) {
            room.active = false;
            totalActiveRooms--;
        }

        emit PhaseChanged(roomId, oldPhase, newPhase);
    }

    // ============ Scoring (Adversarial Rooms) ============

    /**
     * @notice Update agent score
     * @param roomId The room ID
     * @param agentId The agent ID
     * @param delta Score change (can be negative)
     */
    function updateScore(uint256 roomId, uint256 agentId, int256 delta)
        external
        roomExists(roomId)
        roomActive(roomId)
    {
        if (members[roomId][agentId].joinedAt == 0) {
            revert NotRoomMember(roomId, agentId);
        }

        Member storage member = members[roomId][agentId];
        member.score += delta;
        member.lastActiveAt = block.timestamp;

        emit ScoreUpdated(roomId, agentId, delta, member.score);
    }

    /**
     * @notice Record a message post (increments count)
     * @param roomId The room ID
     * @param agentId The agent posting
     */
    function recordMessage(uint256 roomId, uint256 agentId)
        external
        roomExists(roomId)
        roomActive(roomId)
    {
        if (members[roomId][agentId].joinedAt == 0) {
            revert NotRoomMember(roomId, agentId);
        }

        Member storage member = members[roomId][agentId];
        member.messageCount++;
        member.lastActiveAt = block.timestamp;
        roomMessageCount[roomId]++;

        emit MessagePosted(roomId, agentId, roomMessageCount[roomId]);
    }

    /**
     * @notice Complete room with winner
     * @param roomId The room ID
     * @param winnerId Winning agent ID (0 for draw)
     * @param reason Reason for completion
     */
    function completeRoom(uint256 roomId, uint256 winnerId, string calldata reason)
        external
        roomExists(roomId)
        onlyRoomOwner(roomId)
    {
        Room storage room = rooms[roomId];
        room.phase = RoomPhase.COMPLETED;
        room.active = false;
        room.updatedAt = block.timestamp;
        totalActiveRooms--;

        emit RoomCompleted(roomId, winnerId, reason);
        emit PhaseChanged(roomId, room.phase, RoomPhase.COMPLETED);
    }

    // ============ View Functions ============

    /**
     * @notice Get room info
     */
    function getRoom(uint256 roomId) external view returns (
        address owner,
        string memory name,
        string memory stateCid,
        RoomType roomType,
        bool active
    ) {
        Room storage room = rooms[roomId];
        return (room.owner, room.name, room.stateCid, room.roomType, room.active);
    }

    /**
     * @notice Get room members
     */
    function getMembers(uint256 roomId) external view returns (
        uint256[] memory agentIds,
        AgentRole[] memory roles
    ) {
        uint256[] storage memberList = _memberLists[roomId];
        uint256 count = memberList.length;
        
        agentIds = new uint256[](count);
        roles = new AgentRole[](count);
        
        for (uint256 i = 0; i < count; i++) {
            uint256 agentId = memberList[i];
            agentIds[i] = agentId;
            roles[i] = members[roomId][agentId].role;
        }
    }

    /**
     * @notice Get member info
     */
    function getMember(uint256 roomId, uint256 agentId) external view returns (Member memory) {
        return members[roomId][agentId];
    }

    /**
     * @notice Get agent's rooms
     */
    function getAgentRooms(uint256 agentId) external view returns (uint256[] memory) {
        return agentRooms[agentId];
    }

    /**
     * @notice Get room scores (for adversarial)
     */
    function getScores(uint256 roomId) external view returns (
        uint256[] memory agentIds,
        int256[] memory scores
    ) {
        uint256[] storage memberList = _memberLists[roomId];
        uint256 count = memberList.length;
        
        agentIds = new uint256[](count);
        scores = new int256[](count);
        
        for (uint256 i = 0; i < count; i++) {
            uint256 agentId = memberList[i];
            agentIds[i] = agentId;
            scores[i] = members[roomId][agentId].score;
        }
    }

    /**
     * @notice Get member count
     */
    function getMemberCount(uint256 roomId) external view returns (uint256) {
        return _memberLists[roomId].length;
    }

    /**
     * @notice Check if agent is member
     */
    function isMember(uint256 roomId, uint256 agentId) external view returns (bool) {
        return members[roomId][agentId].joinedAt != 0 && members[roomId][agentId].active;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set max members limit
     */
    function setMaxMembersLimit(uint256 limit) external onlyOwner {
        maxMembersLimit = limit;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    function _decodeConfig(bytes calldata config, RoomType roomType) internal pure returns (RoomConfig memory) {
        if (config.length == 0) {
            return RoomConfig({
                maxMembers: 10,
                turnBased: false,
                turnTimeout: 300,
                redTeamTarget: 100,
                blueTeamTarget: 100,
                customRules: ""
            });
        }

        // Simple decode - in production use proper ABI decode
        (uint256 maxMembers, bool turnBased, uint256 turnTimeout) = abi.decode(config, (uint256, bool, uint256));
        
        return RoomConfig({
            maxMembers: maxMembers,
            turnBased: turnBased,
            turnTimeout: turnTimeout,
            redTeamTarget: roomType == RoomType.ADVERSARIAL ? 100 : 0,
            blueTeamTarget: roomType == RoomType.ADVERSARIAL ? 100 : 0,
            customRules: ""
        });
    }

    function _validateRoleForRoomType(RoomType roomType, AgentRole role) internal pure {
        if (roomType == RoomType.ADVERSARIAL) {
            // Adversarial rooms require red/blue team or observer roles
            if (role != AgentRole.RED_TEAM && role != AgentRole.BLUE_TEAM && role != AgentRole.OBSERVER && role != AgentRole.MODERATOR) {
                revert InvalidRole();
            }
        }
    }

    function _validatePhaseTransition(RoomPhase current, RoomPhase requested) internal pure {
        // Valid transitions:
        // SETUP -> ACTIVE
        // ACTIVE -> PAUSED, COMPLETED
        // PAUSED -> ACTIVE, COMPLETED
        // COMPLETED -> ARCHIVED
        
        if (current == RoomPhase.SETUP && requested != RoomPhase.ACTIVE) {
            revert InvalidPhaseTransition(current, requested);
        }
        if (current == RoomPhase.ACTIVE && requested != RoomPhase.PAUSED && requested != RoomPhase.COMPLETED) {
            revert InvalidPhaseTransition(current, requested);
        }
        if (current == RoomPhase.PAUSED && requested != RoomPhase.ACTIVE && requested != RoomPhase.COMPLETED) {
            revert InvalidPhaseTransition(current, requested);
        }
        if (current == RoomPhase.COMPLETED && requested != RoomPhase.ARCHIVED) {
            revert InvalidPhaseTransition(current, requested);
        }
        if (current == RoomPhase.ARCHIVED) {
            revert InvalidPhaseTransition(current, requested);
        }
    }

    function _removeMemberFromList(uint256 roomId, uint256 agentId) internal {
        uint256[] storage list = _memberLists[roomId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == agentId) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
    }
}
