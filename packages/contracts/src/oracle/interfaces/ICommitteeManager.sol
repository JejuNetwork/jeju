// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICommitteeManager
 * @author Jeju Network
 * @notice Interface for managing oracle committees per feed
 */
interface ICommitteeManager {
    // ============ Enums ============

    enum SelectionMode {
        GOVERNANCE,
        STAKE_WEIGHTED,
        RANDOM_STAKE_WEIGHTED
    }

    // ============ Structs ============

    struct Committee {
        bytes32 feedId;
        uint256 round;
        address[] members;
        uint8 threshold;
        uint256 activeUntil;
        address leader;
        bool isActive;
    }

    struct CommitteeAssignment {
        bytes32 operatorId;
        bytes32 feedId;
        uint256 round;
        bool isLeader;
        uint256 assignedAt;
    }

    struct CommitteeConfig {
        bytes32 feedId;
        uint8 targetSize;
        uint8 minSize;
        uint8 threshold;
        uint256 rotationPeriod;
        SelectionMode selectionMode;
    }

    // ============ Events ============

    event CommitteeFormed(
        bytes32 indexed feedId, uint256 indexed round, address[] members, address leader, uint256 activeUntil
    );

    event CommitteeRotated(bytes32 indexed feedId, uint256 indexed oldRound, uint256 indexed newRound);

    event MemberAdded(bytes32 indexed feedId, uint256 indexed round, address indexed member);

    event MemberRemoved(bytes32 indexed feedId, uint256 indexed round, address indexed member, string reason);

    event LeaderRotated(bytes32 indexed feedId, uint256 indexed round, address indexed newLeader);

    event CommitteeConfigUpdated(bytes32 indexed feedId);

    // ============ Errors ============

    error CommitteeNotFound(bytes32 feedId);
    error CommitteeNotActive(bytes32 feedId);
    error NotCommitteeMember(address account, bytes32 feedId);
    error AlreadyCommitteeMember(address account, bytes32 feedId);
    error InsufficientOperators(uint256 available, uint256 required);
    error RotationTooSoon(uint256 nextRotation, uint256 currentTime);
    error InvalidCommitteeConfig();
    error OperatorNotEligible(bytes32 operatorId);

    // ============ Committee Formation ============

    function formCommittee(bytes32 feedId) external returns (uint256 round);

    function rotateCommittee(bytes32 feedId) external returns (uint256 newRound);

    function rotateLeader(bytes32 feedId) external;

    function addMember(bytes32 feedId, address member) external;

    function removeMember(bytes32 feedId, address member, string calldata reason) external;

    // ============ Configuration ============

    function setCommitteeConfig(
        bytes32 feedId,
        uint8 targetSize,
        uint8 minSize,
        uint8 threshold,
        uint256 rotationPeriod,
        SelectionMode selectionMode
    ) external;

    function setAllowlist(bytes32 feedId, address[] calldata operators, bool allowed) external;

    // ============ View Functions ============

    function getCommittee(bytes32 feedId) external view returns (Committee memory);

    function getCommitteeAtRound(bytes32 feedId, uint256 round) external view returns (Committee memory);

    function getCommitteeConfig(bytes32 feedId) external view returns (CommitteeConfig memory);

    function getCurrentRound(bytes32 feedId) external view returns (uint256);

    function isCommitteeMember(bytes32 feedId, address account) external view returns (bool);

    function isCommitteeLeader(bytes32 feedId, address account) external view returns (bool);

    function getOperatorAssignments(bytes32 operatorId) external view returns (CommitteeAssignment[] memory);

    function getOperatorFeeds(address operator) external view returns (bytes32[] memory);

    function canRotate(bytes32 feedId) external view returns (bool);

    function getNextRotationTime(bytes32 feedId) external view returns (uint256);

    function getEligibleOperators(bytes32 feedId) external view returns (address[] memory);

    function isOperatorAllowlisted(bytes32 feedId, address operator) external view returns (bool);
}
