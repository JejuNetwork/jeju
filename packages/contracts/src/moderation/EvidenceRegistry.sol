// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EvidenceRegistry is Ownable, Pausable, ReentrancyGuard {
    enum EvidencePosition { FOR_ACTION, AGAINST_ACTION }
    enum EvidenceStatus { ACTIVE, REWARDED, SLASHED }

    struct Evidence {
        bytes32 evidenceId;
        bytes32 caseId;
        address submitter;
        uint256 stake;
        uint256 submitterReputation;
        string ipfsHash;
        string summary;
        EvidencePosition position;
        uint256 supportStake;
        uint256 opposeStake;
        uint256 supporterCount;
        uint256 opposerCount;
        uint256 submittedAt;
        uint256 timeWeight;
        EvidenceStatus status;
        bool submitterClaimed;
    }

    struct EvidenceSupport {
        address supporter;
        uint256 stake;
        uint256 reputation;
        bool isSupporting;
        string comment;
        uint256 timestamp;
        uint256 timeWeight;
        bool claimed;
    }

    struct CaseEvidence {
        bytes32[] evidenceIds;
        uint256 totalForStake;
        uint256 totalAgainstStake;
        uint256 caseCreatedAt;
        uint256 caseEndsAt;
        bool resolved;
        bool outcomeWasAction;
        uint256 protocolFeesCollected;
    }

    uint256 public constant MIN_EVIDENCE_STAKE = 0.001 ether;
    uint256 public constant MIN_SUPPORT_STAKE = 0.0005 ether;
    uint256 public constant MAX_SUMMARY_LENGTH = 500;
    uint256 public constant MAX_EVIDENCE_PER_CASE = 50;
    uint256 public constant MAX_SUPPORTS_PER_EVIDENCE = 100;
    uint256 public constant WINNER_SHARE_BPS = 8500;
    uint256 public constant PROTOCOL_FEE_BPS = 500;
    uint256 public constant SUBMITTER_BONUS_BPS = 1000;
    uint256 public constant TIME_WEIGHT_BPS_PER_HOUR = 100;
    uint256 public constant MAX_TIME_BONUS_BPS = 7200;

    mapping(bytes32 => Evidence) public evidence;
    mapping(bytes32 => EvidenceSupport[]) public evidenceSupport;
    mapping(bytes32 => mapping(address => uint256)) public userSupportIndex;
    mapping(bytes32 => mapping(address => bool)) public hasSupported;
    mapping(bytes32 => CaseEvidence) public caseEvidence;
    mapping(address => bytes32[]) public userEvidence;
    mapping(bytes32 => uint256) public caseEvidenceCount;
    mapping(bytes32 => mapping(address => bytes32[])) public userCaseEvidence;

    uint256 private _nextEvidenceId;
    address public moderationMarketplace;
    address public reputationProvider;
    address public treasury;
    uint256 public totalProtocolFees;

    event EvidenceSubmitted(bytes32 indexed evidenceId, bytes32 indexed caseId, address indexed submitter, uint256 stake, EvidencePosition position, string ipfsHash, uint256 timeWeight);
    event EvidenceSupported(bytes32 indexed evidenceId, address indexed supporter, uint256 stake, bool isSupporting, string comment, uint256 timeWeight);
    event CaseRegistered(bytes32 indexed caseId, uint256 createdAt, uint256 endsAt);
    event CaseResolved(bytes32 indexed caseId, bool outcomeWasAction, uint256 totalForStake, uint256 totalAgainstStake, uint256 protocolFees);
    event RewardsClaimed(bytes32 indexed evidenceId, address indexed claimer, uint256 amount, bool wasSubmitter);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event ConfigUpdated(string indexed config, address oldVal, address newVal);

    error InsufficientStake();
    error SummaryTooLong();
    error CaseAlreadyResolved();
    error CaseNotRegistered();
    error EvidenceNotFound();
    error AlreadySupported();
    error CannotSupportOwnEvidence();
    error MaxEvidenceReached();
    error MaxSupportsReached();
    error NotAuthorized();
    error NothingToClaim();
    error InvalidAddress();
    error CaseNotResolved();
    error VotingEnded();

    constructor(address _marketplace, address _repProvider, address _treasury, address _owner) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        moderationMarketplace = _marketplace;
        reputationProvider = _repProvider;
        treasury = _treasury;
    }

    function registerCase(bytes32 caseId, uint256 createdAt, uint256 endsAt) external {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();
        if (caseEvidence[caseId].caseCreatedAt != 0) revert CaseAlreadyResolved();
        caseEvidence[caseId].caseCreatedAt = createdAt;
        caseEvidence[caseId].caseEndsAt = endsAt;
        emit CaseRegistered(caseId, createdAt, endsAt);
    }

    function submitEvidence(bytes32 caseId, string calldata ipfsHash, string calldata summary, EvidencePosition position) external payable nonReentrant whenNotPaused returns (bytes32 evidenceId) {
        if (msg.value < MIN_EVIDENCE_STAKE) revert InsufficientStake();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();

        CaseEvidence storage ce = caseEvidence[caseId];
        _validateActiveCase(ce);
        if (caseEvidenceCount[caseId] >= MAX_EVIDENCE_PER_CASE) revert MaxEvidenceReached();

        evidenceId = keccak256(abi.encodePacked(_nextEvidenceId++, caseId, msg.sender, block.timestamp));
        uint256 tw = _calculateTimeWeight(ce.caseEndsAt);

        evidence[evidenceId] = Evidence(evidenceId, caseId, msg.sender, msg.value, _getReputation(msg.sender), ipfsHash, summary, position, 0, 0, 0, 0, block.timestamp, tw, EvidenceStatus.ACTIVE, false);

        ce.evidenceIds.push(evidenceId);
        caseEvidenceCount[caseId]++;
        _addWeightedStake(ce, position, (msg.value * tw) / 10000);

        userEvidence[msg.sender].push(evidenceId);
        userCaseEvidence[caseId][msg.sender].push(evidenceId);

        emit EvidenceSubmitted(evidenceId, caseId, msg.sender, msg.value, position, ipfsHash, tw);
    }

    function supportEvidence(bytes32 evidenceId, bool isSupporting, string calldata comment) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_SUPPORT_STAKE) revert InsufficientStake();
        
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) revert EvidenceNotFound();
        if (e.submitter == msg.sender) revert CannotSupportOwnEvidence();
        
        CaseEvidence storage ce = caseEvidence[e.caseId];
        _validateActiveCase(ce);
        if (hasSupported[evidenceId][msg.sender]) revert AlreadySupported();
        if (evidenceSupport[evidenceId].length >= MAX_SUPPORTS_PER_EVIDENCE) revert MaxSupportsReached();

        uint256 tw = _calculateTimeWeight(ce.caseEndsAt);
        evidenceSupport[evidenceId].push(EvidenceSupport(msg.sender, msg.value, _getReputation(msg.sender), isSupporting, comment, block.timestamp, tw, false));

        userSupportIndex[evidenceId][msg.sender] = evidenceSupport[evidenceId].length - 1;
        hasSupported[evidenceId][msg.sender] = true;

        if (isSupporting) { e.supportStake += msg.value; e.supporterCount++; }
        else { e.opposeStake += msg.value; e.opposerCount++; }

        bool addToFor = isSupporting == (e.position == EvidencePosition.FOR_ACTION);
        _addWeightedStake(ce, addToFor ? EvidencePosition.FOR_ACTION : EvidencePosition.AGAINST_ACTION, (msg.value * tw) / 10000);

        emit EvidenceSupported(evidenceId, msg.sender, msg.value, isSupporting, comment, tw);
    }

    function resolveCase(bytes32 caseId, bool outcomeWasAction) external nonReentrant {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();

        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();

        ce.resolved = true;
        ce.outcomeWasAction = outcomeWasAction;

        uint256 totalPot;
        for (uint256 i; i < ce.evidenceIds.length; i++) {
            Evidence storage e = evidence[ce.evidenceIds[i]];
            e.status = ((e.position == EvidencePosition.FOR_ACTION) == outcomeWasAction) ? EvidenceStatus.REWARDED : EvidenceStatus.SLASHED;
            totalPot += e.stake + e.supportStake + e.opposeStake;
        }

        ce.protocolFeesCollected = (totalPot * PROTOCOL_FEE_BPS) / 10000;
        totalProtocolFees += ce.protocolFeesCollected;

        emit CaseResolved(caseId, outcomeWasAction, ce.totalForStake, ce.totalAgainstStake, ce.protocolFeesCollected);
    }

    function claimRewards(bytes32 evidenceId) external nonReentrant {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) revert EvidenceNotFound();
        if (!caseEvidence[e.caseId].resolved) revert CaseNotResolved();

        (uint256 claim, bool wasSubmitter) = _processClaim(evidenceId, msg.sender);
        if (claim == 0) revert NothingToClaim();

        _transfer(msg.sender, claim);
        emit RewardsClaimed(evidenceId, msg.sender, claim, wasSubmitter);
    }

    function batchClaimRewards(bytes32[] calldata ids) external nonReentrant {
        uint256 total;
        for (uint256 i; i < ids.length; i++) {
            (uint256 claim,) = _processClaim(ids[i], msg.sender);
            total += claim;
        }
        if (total == 0) revert NothingToClaim();
        _transfer(msg.sender, total);
    }

    function _processClaim(bytes32 evidenceId, address claimer) internal returns (uint256 claim, bool wasSubmitter) {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0 || !caseEvidence[e.caseId].resolved) return (0, false);

        CaseEvidence storage ce = caseEvidence[e.caseId];

        if (e.submitter == claimer && !e.submitterClaimed && e.stake > 0) {
            uint256 c = _calcClaim(ce, e.stake, e.status == EvidenceStatus.REWARDED, true);
            if (c > 0) { claim += c; e.submitterClaimed = true; wasSubmitter = true; }
        }

        if (hasSupported[evidenceId][claimer]) {
            EvidenceSupport storage s = evidenceSupport[evidenceId][userSupportIndex[evidenceId][claimer]];
            if (!s.claimed && s.stake > 0) {
                bool won = s.isSupporting ? e.status == EvidenceStatus.REWARDED : e.status == EvidenceStatus.SLASHED;
                uint256 c = _calcClaim(ce, s.stake, won, false);
                if (c > 0) { claim += c; s.claimed = true; }
            }
        }
    }

    function _calcClaim(CaseEvidence storage ce, uint256 stake, bool won, bool isSubmitter) internal view returns (uint256) {
        if (!won) return 0;
        (uint256 winPool, uint256 losePool) = _calcPools(ce);
        if (winPool == 0) return stake;
        uint256 dist = losePool - (losePool * PROTOCOL_FEE_BPS) / 10000;
        uint256 share = (dist * WINNER_SHARE_BPS * stake) / (winPool * 10000);
        if (isSubmitter) share += (dist * SUBMITTER_BONUS_BPS * stake) / (winPool * 10000);
        return stake + share;
    }

    function _calcPools(CaseEvidence storage ce) internal view returns (uint256 win, uint256 lose) {
        for (uint256 i; i < ce.evidenceIds.length; i++) {
            Evidence storage ev = evidence[ce.evidenceIds[i]];
            uint256 evTotal = ev.stake + ev.supportStake;
            if (ev.status == EvidenceStatus.REWARDED) { win += evTotal; lose += ev.opposeStake; }
            else { lose += evTotal; win += ev.opposeStake; }
        }
    }

    function _validateActiveCase(CaseEvidence storage ce) internal view {
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > ce.caseEndsAt) revert VotingEnded();
    }

    function _addWeightedStake(CaseEvidence storage ce, EvidencePosition pos, uint256 weighted) internal {
        if (pos == EvidencePosition.FOR_ACTION) ce.totalForStake += weighted;
        else ce.totalAgainstStake += weighted;
    }

    function _calculateTimeWeight(uint256 endsAt) internal view returns (uint256) {
        if (block.timestamp >= endsAt) return 10000;
        uint256 bonus = ((endsAt - block.timestamp) / 1 hours) * TIME_WEIGHT_BPS_PER_HOUR;
        return 10000 + (bonus > MAX_TIME_BONUS_BPS ? MAX_TIME_BONUS_BPS : bonus);
    }

    function _getReputation(address user) internal view returns (uint256) {
        if (reputationProvider == address(0)) return 5000;
        (bool ok, bytes memory data) = reputationProvider.staticcall(abi.encodeWithSignature("getReputation(address)", user));
        if (ok && data.length >= 32) { uint256 r = abi.decode(data, (uint256)); return r > 10000 ? 10000 : r; }
        return 5000;
    }

    function _transfer(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function getCaseEvidence(bytes32 id) external view returns (bytes32[] memory, uint256, uint256, bool) {
        CaseEvidence storage ce = caseEvidence[id];
        return (ce.evidenceIds, ce.totalForStake, ce.totalAgainstStake, ce.resolved);
    }
    function getCaseEvidenceDetails(bytes32 id) external view returns (CaseEvidence memory) { return caseEvidence[id]; }
    function getEvidence(bytes32 id) external view returns (Evidence memory) { return evidence[id]; }
    function getEvidenceSupport(bytes32 id) external view returns (EvidenceSupport[] memory) { return evidenceSupport[id]; }
    function getUserEvidence(address u) external view returns (bytes32[] memory) { return userEvidence[u]; }
    function getUserCaseEvidence(bytes32 c, address u) external view returns (bytes32[] memory) { return userCaseEvidence[c][u]; }

    function getClaimableAmount(bytes32 evidenceId, address user) external view returns (uint256 total) {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0 || !caseEvidence[e.caseId].resolved) return 0;
        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (e.submitter == user && !e.submitterClaimed && e.stake > 0)
            total += _calcClaim(ce, e.stake, e.status == EvidenceStatus.REWARDED, true);
        if (hasSupported[evidenceId][user]) {
            EvidenceSupport storage s = evidenceSupport[evidenceId][userSupportIndex[evidenceId][user]];
            if (!s.claimed && s.stake > 0)
                total += _calcClaim(ce, s.stake, s.isSupporting ? e.status == EvidenceStatus.REWARDED : e.status == EvidenceStatus.SLASHED, false);
        }
    }

    function isCaseActive(bytes32 id) external view returns (bool) {
        CaseEvidence storage ce = caseEvidence[id];
        return ce.caseCreatedAt != 0 && !ce.resolved && block.timestamp <= ce.caseEndsAt;
    }
    function getCurrentTimeWeight(bytes32 id) external view returns (uint256) {
        CaseEvidence storage ce = caseEvidence[id];
        return ce.caseCreatedAt == 0 ? 10000 : _calculateTimeWeight(ce.caseEndsAt);
    }

    function setModerationMarketplace(address v) external onlyOwner { emit ConfigUpdated("marketplace", moderationMarketplace, v); moderationMarketplace = v; }
    function setReputationProvider(address v) external onlyOwner { emit ConfigUpdated("reputation", reputationProvider, v); reputationProvider = v; }
    function setTreasury(address v) external onlyOwner { if (v == address(0)) revert InvalidAddress(); emit ConfigUpdated("treasury", treasury, v); treasury = v; }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawProtocolFees() external onlyOwner {
        uint256 amt = totalProtocolFees;
        if (amt == 0) revert NothingToClaim();
        totalProtocolFees = 0;
        _transfer(treasury, amt);
        emit ProtocolFeesWithdrawn(treasury, amt);
    }

    function emergencyWithdraw() external onlyOwner {
        if (address(this).balance > 0) _transfer(treasury, address(this).balance);
    }

    function version() external pure returns (string memory) { return "2.0.0"; }
    receive() external payable {}
}

