// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ICommitteeManager} from "./interfaces/ICommitteeManager.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";

/// @title CommitteeManager
/// @notice Manages oracle committee assignments for each feed
contract CommitteeManager is ICommitteeManager, Ownable, Pausable {
    uint8 public constant MIN_COMMITTEE_SIZE = 3;
    uint8 public constant MAX_COMMITTEE_SIZE = 21;
    uint256 public constant MIN_ROTATION_PERIOD = 1 hours;
    uint256 public constant DEFAULT_ROTATION_PERIOD = 24 hours;

    IFeedRegistry public immutable feedRegistry;

    mapping(bytes32 => Committee) private _committees;
    mapping(bytes32 => mapping(uint256 => Committee)) private _historicalCommittees;
    mapping(bytes32 => CommitteeConfig) private _configs;
    mapping(bytes32 => mapping(address => bool)) private _allowlist;
    mapping(address => bool) private _globalAllowlist;
    mapping(address => bytes32[]) private _operatorFeeds;
    mapping(address => bytes32) public operatorIds;
    mapping(bytes32 => uint256) private _lastRotationTime;
    mapping(address => bool) public committeeManagers;

    constructor(address _feedRegistry, address initialOwner) Ownable(initialOwner) {
        feedRegistry = IFeedRegistry(_feedRegistry);
        committeeManagers[initialOwner] = true;
    }

    modifier onlyCommitteeManager() {
        if (!committeeManagers[msg.sender] && msg.sender != owner()) revert InvalidCommitteeConfig();
        _;
    }

    modifier feedMustExist(bytes32 feedId) {
        if (!feedRegistry.feedExists(feedId)) revert CommitteeNotFound(feedId);
        _;
    }

    function formCommittee(bytes32 feedId)
        external
        onlyCommitteeManager
        feedMustExist(feedId)
        whenNotPaused
        returns (uint256 round)
    {
        CommitteeConfig storage config = _configs[feedId];
        if (config.feedId == bytes32(0)) {
            IFeedRegistry.FeedSpec memory spec = feedRegistry.getFeed(feedId);
            config.feedId = feedId;
            config.targetSize = spec.minOracles > 0 ? spec.minOracles : MIN_COMMITTEE_SIZE;
            config.minSize = MIN_COMMITTEE_SIZE;
            config.threshold = spec.quorumThreshold > 0 ? spec.quorumThreshold : 2;
            config.rotationPeriod = DEFAULT_ROTATION_PERIOD;
            config.selectionMode = SelectionMode.GOVERNANCE;
        }

        address[] memory eligible = _getEligibleOperatorsInternal(feedId);
        if (eligible.length < config.minSize) revert InsufficientOperators(eligible.length, config.minSize);

        uint256 memberCount = eligible.length > config.targetSize ? config.targetSize : eligible.length;
        address[] memory members = new address[](memberCount);
        for (uint256 i = 0; i < memberCount; i++) {
            members[i] = eligible[i];
        }

        round = _committees[feedId].round + 1;
        Committee storage committee = _committees[feedId];
        committee.feedId = feedId;
        committee.round = round;
        committee.members = members;
        committee.threshold = config.threshold;
        committee.activeUntil = block.timestamp + config.rotationPeriod;
        committee.leader = members[0];
        committee.isActive = true;

        _historicalCommittees[feedId][round] = committee;
        for (uint256 i = 0; i < members.length; i++) {
            _addOperatorFeed(members[i], feedId);
        }
        _lastRotationTime[feedId] = block.timestamp;

        emit CommitteeFormed(feedId, round, members, members[0], committee.activeUntil);
    }

    function rotateCommittee(bytes32 feedId)
        external
        onlyCommitteeManager
        feedMustExist(feedId)
        returns (uint256 newRound)
    {
        Committee storage committee = _committees[feedId];
        if (!committee.isActive) revert CommitteeNotActive(feedId);

        CommitteeConfig storage config = _configs[feedId];
        if (block.timestamp < _lastRotationTime[feedId] + config.rotationPeriod) {
            revert RotationTooSoon(_lastRotationTime[feedId] + config.rotationPeriod, block.timestamp);
        }

        uint256 oldRound = committee.round;
        for (uint256 i = 0; i < committee.members.length; i++) {
            _removeOperatorFeed(committee.members[i], feedId);
        }

        address[] memory eligible = _getEligibleOperatorsInternal(feedId);
        if (eligible.length < config.minSize) revert InsufficientOperators(eligible.length, config.minSize);

        uint256 memberCount = eligible.length > config.targetSize ? config.targetSize : eligible.length;
        address[] memory members = new address[](memberCount);
        for (uint256 i = 0; i < memberCount; i++) {
            members[i] = eligible[i];
        }

        newRound = oldRound + 1;
        committee.round = newRound;
        committee.members = members;
        committee.activeUntil = block.timestamp + config.rotationPeriod;
        committee.leader = members[0];

        _historicalCommittees[feedId][newRound] = committee;
        for (uint256 i = 0; i < members.length; i++) {
            _addOperatorFeed(members[i], feedId);
        }
        _lastRotationTime[feedId] = block.timestamp;

        emit CommitteeRotated(feedId, oldRound, newRound);
        emit CommitteeFormed(feedId, newRound, members, members[0], committee.activeUntil);
    }

    function rotateLeader(bytes32 feedId) external onlyCommitteeManager feedMustExist(feedId) {
        Committee storage committee = _committees[feedId];
        if (!committee.isActive) revert CommitteeNotActive(feedId);
        if (committee.members.length == 0) revert CommitteeNotFound(feedId);

        uint256 currentIndex;
        for (uint256 i = 0; i < committee.members.length; i++) {
            if (committee.members[i] == committee.leader) {
                currentIndex = i;
                break;
            }
        }
        committee.leader = committee.members[(currentIndex + 1) % committee.members.length];
        emit LeaderRotated(feedId, committee.round, committee.leader);
    }

    function addMember(bytes32 feedId, address member) external onlyCommitteeManager feedMustExist(feedId) {
        Committee storage committee = _committees[feedId];
        if (!committee.isActive) revert CommitteeNotActive(feedId);

        for (uint256 i = 0; i < committee.members.length; i++) {
            if (committee.members[i] == member) revert AlreadyCommitteeMember(member, feedId);
        }
        if (committee.members.length >= MAX_COMMITTEE_SIZE) revert InvalidCommitteeConfig();

        _allowlist[feedId][member] = true;
        address[] memory newMembers = new address[](committee.members.length + 1);
        for (uint256 i = 0; i < committee.members.length; i++) {
            newMembers[i] = committee.members[i];
        }
        newMembers[committee.members.length] = member;
        committee.members = newMembers;
        _addOperatorFeed(member, feedId);
        emit MemberAdded(feedId, committee.round, member);
    }

    function removeMember(bytes32 feedId, address member, string calldata reason)
        external
        onlyCommitteeManager
        feedMustExist(feedId)
    {
        Committee storage committee = _committees[feedId];
        uint256 memberIndex;
        bool found;
        for (uint256 i = 0; i < committee.members.length; i++) {
            if (committee.members[i] == member) {
                found = true;
                memberIndex = i;
                break;
            }
        }
        if (!found) revert NotCommitteeMember(member, feedId);

        uint8 minSize = _configs[feedId].minSize;
        if (committee.members.length <= minSize) revert InsufficientOperators(committee.members.length - 1, minSize);

        address[] memory newMembers = new address[](committee.members.length - 1);
        uint256 j;
        for (uint256 i = 0; i < committee.members.length; i++) {
            if (i != memberIndex) newMembers[j++] = committee.members[i];
        }
        committee.members = newMembers;

        if (committee.leader == member && newMembers.length > 0) {
            committee.leader = newMembers[0];
            emit LeaderRotated(feedId, committee.round, committee.leader);
        }
        _removeOperatorFeed(member, feedId);
        emit MemberRemoved(feedId, committee.round, member, reason);
    }

    function setCommitteeConfig(
        bytes32 feedId,
        uint8 targetSize,
        uint8 minSize,
        uint8 threshold,
        uint256 rotationPeriod,
        SelectionMode selectionMode
    ) external onlyCommitteeManager feedMustExist(feedId) {
        if (
            targetSize < minSize || targetSize > MAX_COMMITTEE_SIZE || minSize < MIN_COMMITTEE_SIZE
                || threshold > minSize || threshold == 0 || rotationPeriod < MIN_ROTATION_PERIOD
        ) {
            revert InvalidCommitteeConfig();
        }
        _configs[feedId] = CommitteeConfig(feedId, targetSize, minSize, threshold, rotationPeriod, selectionMode);
        emit CommitteeConfigUpdated(feedId);
    }

    function setAllowlist(bytes32 feedId, address[] calldata operators, bool allowed) external onlyCommitteeManager {
        for (uint256 i = 0; i < operators.length; i++) {
            _allowlist[feedId][operators[i]] = allowed;
        }
    }

    function setGlobalAllowlist(address[] calldata operators, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < operators.length; i++) {
            _globalAllowlist[operators[i]] = allowed;
        }
    }

    function getCommittee(bytes32 feedId) external view returns (Committee memory) {
        return _committees[feedId];
    }

    function getCommitteeAtRound(bytes32 feedId, uint256 round) external view returns (Committee memory) {
        return _historicalCommittees[feedId][round];
    }

    function getCommitteeConfig(bytes32 feedId) external view returns (CommitteeConfig memory) {
        return _configs[feedId];
    }

    function getCurrentRound(bytes32 feedId) external view returns (uint256) {
        return _committees[feedId].round;
    }

    function isCommitteeMember(bytes32 feedId, address account) external view returns (bool) {
        Committee storage c = _committees[feedId];
        for (uint256 i = 0; i < c.members.length; i++) {
            if (c.members[i] == account) return true;
        }
        return false;
    }

    function isCommitteeLeader(bytes32 feedId, address account) external view returns (bool) {
        return _committees[feedId].leader == account;
    }

    function getOperatorAssignments(bytes32) external pure returns (CommitteeAssignment[] memory) {
        return new CommitteeAssignment[](0);
    }

    function getOperatorFeeds(address operator) external view returns (bytes32[] memory) {
        return _operatorFeeds[operator];
    }

    function canRotate(bytes32 feedId) external view returns (bool) {
        CommitteeConfig storage c = _configs[feedId];
        return c.feedId == bytes32(0) || block.timestamp >= _lastRotationTime[feedId] + c.rotationPeriod;
    }

    function getNextRotationTime(bytes32 feedId) external view returns (uint256) {
        CommitteeConfig storage c = _configs[feedId];
        return c.feedId == bytes32(0) ? block.timestamp : _lastRotationTime[feedId] + c.rotationPeriod;
    }

    function getEligibleOperators(bytes32 feedId) external view returns (address[] memory) {
        return _getEligibleOperatorsInternal(feedId);
    }

    function isOperatorAllowlisted(bytes32 feedId, address operator) external view returns (bool) {
        return _allowlist[feedId][operator] || _globalAllowlist[operator];
    }

    function _getEligibleOperatorsInternal(bytes32 feedId) internal view returns (address[] memory) {
        Committee storage c = _committees[feedId];
        if (!c.isActive || c.members.length == 0) return new address[](0);

        uint256 count;
        for (uint256 i; i < c.members.length; ++i) {
            if (_allowlist[feedId][c.members[i]] || _globalAllowlist[c.members[i]]) ++count;
        }
        address[] memory eligible = new address[](count);
        uint256 idx;
        for (uint256 i; i < c.members.length; ++i) {
            if (_allowlist[feedId][c.members[i]] || _globalAllowlist[c.members[i]]) eligible[idx++] = c.members[i];
        }
        return eligible;
    }

    function _addOperatorFeed(address operator, bytes32 feedId) internal {
        bytes32[] storage feeds = _operatorFeeds[operator];
        for (uint256 i = 0; i < feeds.length; i++) {
            if (feeds[i] == feedId) return;
        }
        feeds.push(feedId);
    }

    function _removeOperatorFeed(address operator, bytes32 feedId) internal {
        bytes32[] storage feeds = _operatorFeeds[operator];
        for (uint256 i = 0; i < feeds.length; i++) {
            if (feeds[i] == feedId) {
                feeds[i] = feeds[feeds.length - 1];
                feeds.pop();
                return;
            }
        }
    }

    function setCommitteeManager(address manager, bool allowed) external onlyOwner {
        committeeManagers[manager] = allowed;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
