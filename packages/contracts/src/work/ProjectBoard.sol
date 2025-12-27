// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title ProjectBoard
 * @author Jeju Network
 * @notice On-chain project management (like Linear) integrated with bounties
 * @dev Features:
 *      - Projects with issues, cycles, and milestones
 *      - Issue tracking with status, priority, labels
 *      - Cycle/sprint management
 *      - Integration with BountyRegistry for funded issues
 *      - Team management with roles
 *      - Linear-style workflow states
 */
contract ProjectBoard is ReentrancyGuard, Pausable, Ownable {
    // ============ Enums ============

    enum IssueStatus {
        BACKLOG,
        TODO,
        IN_PROGRESS,
        IN_REVIEW,
        DONE,
        CANCELLED
    }

    enum IssuePriority {
        NO_PRIORITY,
        LOW,
        MEDIUM,
        HIGH,
        URGENT
    }

    enum MemberRole {
        VIEWER,
        MEMBER,
        ADMIN,
        OWNER
    }

    // ============ Structs ============

    struct Project {
        bytes32 projectId;
        string name;
        string description;
        string slug; // URL-friendly identifier
        address owner;
        uint256 ownerAgentId;
        string iconUri;
        string[] defaultLabels;
        uint256 createdAt;
        uint256 updatedAt;
        bool isPublic;
        bool isArchived;
    }

    struct Issue {
        bytes32 issueId;
        bytes32 projectId;
        uint256 number; // Sequential issue number
        string title;
        string description;
        string detailsUri; // IPFS URI for rich content
        IssueStatus status;
        IssuePriority priority;
        string[] labels;
        address creator;
        address assignee;
        uint256 assigneeAgentId;
        bytes32 parentIssue; // For sub-issues
        bytes32 cycleId; // Optional cycle/sprint
        bytes32 bountyId; // Optional linked bounty
        uint256 estimate; // Story points / estimate
        uint256 createdAt;
        uint256 updatedAt;
        uint256 completedAt;
    }

    struct Cycle {
        bytes32 cycleId;
        bytes32 projectId;
        string name;
        string description;
        uint256 startDate;
        uint256 endDate;
        bool isActive;
        uint256 createdAt;
    }

    struct Comment {
        bytes32 commentId;
        bytes32 issueId;
        address author;
        uint256 authorAgentId;
        string content;
        string contentUri; // IPFS for rich content
        bytes32 parentComment; // For threaded replies
        uint256 createdAt;
        uint256 updatedAt;
        bool isEdited;
    }

    struct IssueActivity {
        bytes32 activityId;
        bytes32 issueId;
        address actor;
        string activityType; // "status_change", "assign", "comment", etc.
        string fromValue;
        string toValue;
        uint256 timestamp;
    }

    struct ProjectMember {
        address member;
        uint256 agentId;
        MemberRole role;
        uint256 joinedAt;
        bool isActive;
    }

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    address public bountyRegistry;

    mapping(bytes32 => Project) public projects;
    mapping(bytes32 => Issue) public issues;
    mapping(bytes32 => Cycle) public cycles;
    mapping(bytes32 => Comment[]) public comments;
    mapping(bytes32 => IssueActivity[]) public activities;
    mapping(bytes32 => ProjectMember[]) public members;

    // Project issues
    mapping(bytes32 => bytes32[]) public projectIssues;
    mapping(bytes32 => bytes32[]) public projectCycles;

    // Issue counters per project
    mapping(bytes32 => uint256) public projectIssueCount;

    // User assignments
    mapping(address => bytes32[]) public userAssignedIssues;

    // Project slug uniqueness
    mapping(string => bytes32) public slugToProject;

    bytes32[] public allProjects;
    uint256 private _nextProjectId = 1;
    uint256 private _nextIssueId = 1;
    uint256 private _nextCycleId = 1;
    uint256 private _nextCommentId = 1;
    uint256 private _nextActivityId = 1;

    // ============ Events ============

    event ProjectCreated(bytes32 indexed projectId, string name, string slug, address indexed owner);
    event ProjectUpdated(bytes32 indexed projectId);
    event ProjectArchived(bytes32 indexed projectId);

    event IssueCreated(bytes32 indexed issueId, bytes32 indexed projectId, uint256 number, string title);
    event IssueUpdated(bytes32 indexed issueId, string field, string fromValue, string toValue);
    event IssueStatusChanged(bytes32 indexed issueId, IssueStatus oldStatus, IssueStatus newStatus);
    event IssueAssigned(bytes32 indexed issueId, address indexed assignee);
    event IssueBountyLinked(bytes32 indexed issueId, bytes32 indexed bountyId);

    event CycleCreated(bytes32 indexed cycleId, bytes32 indexed projectId, string name);
    event CycleCompleted(bytes32 indexed cycleId);

    event CommentAdded(bytes32 indexed issueId, bytes32 indexed commentId, address indexed author);
    event MemberAdded(bytes32 indexed projectId, address indexed member, MemberRole role);
    event MemberRemoved(bytes32 indexed projectId, address indexed member);

    // ============ Errors ============

    error ProjectNotFound();
    error IssueNotFound();
    error CycleNotFound();
    error SlugTaken();
    error NotProjectMember();
    error InsufficientRole();
    error InvalidTransition();

    // ============ Modifiers ============

    modifier projectExists(bytes32 projectId) {
        if (projects[projectId].createdAt == 0) revert ProjectNotFound();
        _;
    }

    modifier issueExists(bytes32 issueId) {
        if (issues[issueId].createdAt == 0) revert IssueNotFound();
        _;
    }

    modifier onlyProjectMember(bytes32 projectId, MemberRole minRole) {
        if (!_hasRole(projectId, msg.sender, minRole)) revert InsufficientRole();
        _;
    }

    // ============ Constructor ============

    constructor(address _identityRegistry, address initialOwner) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
    }

    // ============ Project Management ============

    /**
     * @notice Create a new project
     */
    function createProject(
        string calldata name,
        string calldata description,
        string calldata slug,
        string calldata iconUri,
        string[] calldata defaultLabels,
        bool isPublic
    ) external nonReentrant whenNotPaused returns (bytes32 projectId) {
        // Check slug uniqueness
        if (slugToProject[slug] != bytes32(0)) revert SlugTaken();

        projectId = keccak256(abi.encodePacked(_nextProjectId++, msg.sender, slug, block.timestamp));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        Project storage project = projects[projectId];
        project.projectId = projectId;
        project.name = name;
        project.description = description;
        project.slug = slug;
        project.owner = msg.sender;
        project.ownerAgentId = agentId;
        project.iconUri = iconUri;
        project.defaultLabels = defaultLabels;
        project.createdAt = block.timestamp;
        project.updatedAt = block.timestamp;
        project.isPublic = isPublic;

        slugToProject[slug] = projectId;
        allProjects.push(projectId);

        // Add creator as owner
        members[projectId].push(
            ProjectMember({
                member: msg.sender,
                agentId: agentId,
                role: MemberRole.OWNER,
                joinedAt: block.timestamp,
                isActive: true
            })
        );

        emit ProjectCreated(projectId, name, slug, msg.sender);
    }

    /**
     * @notice Add a member to project
     */
    function addMember(bytes32 projectId, address member, MemberRole role)
        external
        projectExists(projectId)
        onlyProjectMember(projectId, MemberRole.ADMIN)
    {
        uint256 agentId = _getAgentIdForAddress(member);

        members[projectId].push(
            ProjectMember({member: member, agentId: agentId, role: role, joinedAt: block.timestamp, isActive: true})
        );

        emit MemberAdded(projectId, member, role);
    }

    /**
     * @notice Remove a member from project
     */
    function removeMember(bytes32 projectId, address member)
        external
        projectExists(projectId)
        onlyProjectMember(projectId, MemberRole.ADMIN)
    {
        ProjectMember[] storage projectMembers = members[projectId];
        for (uint256 i = 0; i < projectMembers.length; i++) {
            if (projectMembers[i].member == member) {
                projectMembers[i].isActive = false;
                emit MemberRemoved(projectId, member);
                break;
            }
        }
    }

    // ============ Issue Management ============

    /**
     * @notice Create a new issue
     */
    function createIssue(
        bytes32 projectId,
        string calldata title,
        string calldata description,
        string calldata detailsUri,
        IssuePriority priority,
        string[] calldata labels,
        bytes32 parentIssue,
        bytes32 cycleId,
        uint256 estimate
    )
        external
        nonReentrant
        projectExists(projectId)
        onlyProjectMember(projectId, MemberRole.MEMBER)
        returns (bytes32 issueId)
    {
        issueId = keccak256(abi.encodePacked(_nextIssueId++, projectId, msg.sender, block.timestamp));

        projectIssueCount[projectId]++;
        uint256 issueNumber = projectIssueCount[projectId];

        Issue storage issue = issues[issueId];
        issue.issueId = issueId;
        issue.projectId = projectId;
        issue.number = issueNumber;
        issue.title = title;
        issue.description = description;
        issue.detailsUri = detailsUri;
        issue.status = IssueStatus.BACKLOG;
        issue.priority = priority;
        issue.labels = labels;
        issue.creator = msg.sender;
        issue.parentIssue = parentIssue;
        issue.cycleId = cycleId;
        issue.estimate = estimate;
        issue.createdAt = block.timestamp;
        issue.updatedAt = block.timestamp;

        projectIssues[projectId].push(issueId);

        // Log activity
        _logActivity(issueId, "created", "", title);

        emit IssueCreated(issueId, projectId, issueNumber, title);
    }

    /**
     * @notice Update issue status
     */
    function updateIssueStatus(bytes32 issueId, IssueStatus newStatus)
        external
        issueExists(issueId)
        onlyProjectMember(issues[issueId].projectId, MemberRole.MEMBER)
    {
        Issue storage issue = issues[issueId];
        IssueStatus oldStatus = issue.status;

        issue.status = newStatus;
        issue.updatedAt = block.timestamp;

        if (newStatus == IssueStatus.DONE) {
            issue.completedAt = block.timestamp;
        }

        _logActivity(issueId, "status_change", _statusToString(oldStatus), _statusToString(newStatus));

        emit IssueStatusChanged(issueId, oldStatus, newStatus);
    }

    /**
     * @notice Assign issue to someone
     */
    function assignIssue(bytes32 issueId, address assignee)
        external
        issueExists(issueId)
        onlyProjectMember(issues[issueId].projectId, MemberRole.MEMBER)
    {
        Issue storage issue = issues[issueId];

        // Remove from old assignee
        if (issue.assignee != address(0)) {
            _removeFromAssignedIssues(issue.assignee, issueId);
        }

        issue.assignee = assignee;
        issue.assigneeAgentId = _getAgentIdForAddress(assignee);
        issue.updatedAt = block.timestamp;

        userAssignedIssues[assignee].push(issueId);

        _logActivity(issueId, "assigned", "", _addressToString(assignee));

        emit IssueAssigned(issueId, assignee);
    }

    /**
     * @notice Link a bounty to an issue
     */
    function linkBounty(bytes32 issueId, bytes32 bountyId)
        external
        issueExists(issueId)
        onlyProjectMember(issues[issueId].projectId, MemberRole.ADMIN)
    {
        Issue storage issue = issues[issueId];
        issue.bountyId = bountyId;
        issue.updatedAt = block.timestamp;

        emit IssueBountyLinked(issueId, bountyId);
    }

    /**
     * @notice Add a comment to an issue
     */
    function addComment(bytes32 issueId, string calldata content, string calldata contentUri, bytes32 parentComment)
        external
        issueExists(issueId)
        onlyProjectMember(issues[issueId].projectId, MemberRole.VIEWER)
        returns (bytes32 commentId)
    {
        commentId = keccak256(abi.encodePacked(_nextCommentId++, issueId, msg.sender, block.timestamp));

        comments[issueId].push(
            Comment({
                commentId: commentId,
                issueId: issueId,
                author: msg.sender,
                authorAgentId: _getAgentIdForAddress(msg.sender),
                content: content,
                contentUri: contentUri,
                parentComment: parentComment,
                createdAt: block.timestamp,
                updatedAt: block.timestamp,
                isEdited: false
            })
        );

        issues[issueId].updatedAt = block.timestamp;

        _logActivity(issueId, "comment", "", "");

        emit CommentAdded(issueId, commentId, msg.sender);
    }

    // ============ Cycle Management ============

    /**
     * @notice Create a new cycle/sprint
     */
    function createCycle(
        bytes32 projectId,
        string calldata name,
        string calldata description,
        uint256 startDate,
        uint256 endDate
    ) external projectExists(projectId) onlyProjectMember(projectId, MemberRole.ADMIN) returns (bytes32 cycleId) {
        cycleId = keccak256(abi.encodePacked(_nextCycleId++, projectId, name, block.timestamp));

        cycles[cycleId] = Cycle({
            cycleId: cycleId,
            projectId: projectId,
            name: name,
            description: description,
            startDate: startDate,
            endDate: endDate,
            isActive: true,
            createdAt: block.timestamp
        });

        projectCycles[projectId].push(cycleId);

        emit CycleCreated(cycleId, projectId, name);
    }

    /**
     * @notice Add issue to cycle
     */
    function addIssueToCycle(bytes32 issueId, bytes32 cycleId)
        external
        issueExists(issueId)
        onlyProjectMember(issues[issueId].projectId, MemberRole.MEMBER)
    {
        if (cycles[cycleId].createdAt == 0) revert CycleNotFound();
        issues[issueId].cycleId = cycleId;
        issues[issueId].updatedAt = block.timestamp;
    }

    // ============ Internal Functions ============

    function _hasRole(bytes32 projectId, address user, MemberRole minRole) internal view returns (bool) {
        // Owner always has access
        if (projects[projectId].owner == user) return true;

        ProjectMember[] storage projectMembers = members[projectId];
        for (uint256 i = 0; i < projectMembers.length; i++) {
            if (projectMembers[i].member == user && projectMembers[i].isActive) {
                return projectMembers[i].role >= minRole;
            }
        }

        // Public projects allow viewer access
        if (projects[projectId].isPublic && minRole == MemberRole.VIEWER) {
            return true;
        }

        return false;
    }

    function _logActivity(bytes32 issueId, string memory activityType, string memory fromValue, string memory toValue)
        internal
    {
        bytes32 activityId = keccak256(abi.encodePacked(_nextActivityId++, issueId, block.timestamp));

        activities[issueId].push(
            IssueActivity({
                activityId: activityId,
                issueId: issueId,
                actor: msg.sender,
                activityType: activityType,
                fromValue: fromValue,
                toValue: toValue,
                timestamp: block.timestamp
            })
        );
    }

    function _removeFromAssignedIssues(address user, bytes32 issueId) internal {
        bytes32[] storage assigned = userAssignedIssues[user];
        for (uint256 i = 0; i < assigned.length; i++) {
            if (assigned[i] == issueId) {
                assigned[i] = assigned[assigned.length - 1];
                assigned.pop();
                break;
            }
        }
    }

    function _statusToString(IssueStatus status) internal pure returns (string memory) {
        if (status == IssueStatus.BACKLOG) return "backlog";
        if (status == IssueStatus.TODO) return "todo";
        if (status == IssueStatus.IN_PROGRESS) return "in_progress";
        if (status == IssueStatus.IN_REVIEW) return "in_review";
        if (status == IssueStatus.DONE) return "done";
        return "cancelled";
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint256(uint160(addr)) / (2 ** (8 * (19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            str[2 + i * 2] = _char(hi);
            str[3 + i * 2] = _char(lo);
        }
        return string(str);
    }

    function _char(bytes1 b) internal pure returns (bytes1) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        return bytes1(uint8(b) + 0x57);
    }

    function _getAgentIdForAddress(address addr) internal view returns (uint256) {
        return 0; // Would query indexer in production
    }

    // ============ View Functions ============

    function getProject(bytes32 projectId) external view returns (Project memory) {
        return projects[projectId];
    }

    function getProjectBySlug(string calldata slug) external view returns (Project memory) {
        bytes32 projectId = slugToProject[slug];
        return projects[projectId];
    }

    function getIssue(bytes32 issueId) external view returns (Issue memory) {
        return issues[issueId];
    }

    function getProjectIssues(bytes32 projectId) external view returns (bytes32[] memory) {
        return projectIssues[projectId];
    }

    function getProjectCycles(bytes32 projectId) external view returns (bytes32[] memory) {
        return projectCycles[projectId];
    }

    function getCycle(bytes32 cycleId) external view returns (Cycle memory) {
        return cycles[cycleId];
    }

    function getIssueComments(bytes32 issueId) external view returns (Comment[] memory) {
        return comments[issueId];
    }

    function getIssueActivities(bytes32 issueId) external view returns (IssueActivity[] memory) {
        return activities[issueId];
    }

    function getProjectMembers(bytes32 projectId) external view returns (ProjectMember[] memory) {
        return members[projectId];
    }

    function getUserAssignedIssues(address user) external view returns (bytes32[] memory) {
        return userAssignedIssues[user];
    }

    function getTotalProjects() external view returns (uint256) {
        return allProjects.length;
    }

    // ============ Admin ============

    function setBountyRegistry(address _bountyRegistry) external onlyOwner {
        bountyRegistry = _bountyRegistry;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
