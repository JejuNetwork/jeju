// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EvidenceRegistry
 * @notice Community evidence submission for moderation cases with stake-weighted rewards
 * @dev Integrates with ModerationMarketplace. Evidence aligned with outcomes gets rewarded,
 *      opposed evidence is slashed. Time-weighted stakes incentivize early participation.
 */
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
    event ModerationMarketplaceUpdated(address oldAddress, address newAddress);
    event ReputationProviderUpdated(address oldAddress, address newAddress);
    event TreasuryUpdated(address oldAddress, address newAddress);

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

    constructor(address _moderationMarketplace, address _reputationProvider, address _treasury, address _owner) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        moderationMarketplace = _moderationMarketplace;
        reputationProvider = _reputationProvider;
        treasury = _treasury;
    }

    function registerCase(bytes32 caseId, uint256 createdAt, uint256 endsAt) external {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();
        if (caseEvidence[caseId].caseCreatedAt != 0) revert CaseAlreadyResolved();
        caseEvidence[caseId].caseCreatedAt = createdAt;
        caseEvidence[caseId].caseEndsAt = endsAt;
        emit CaseRegistered(caseId, createdAt, endsAt);
    }

    function submitEvidence(
        bytes32 caseId,
        string calldata ipfsHash,
        string calldata summary,
        EvidencePosition position
    ) external payable nonReentrant whenNotPaused returns (bytes32 evidenceId) {
        if (msg.value < MIN_EVIDENCE_STAKE) revert InsufficientStake();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();

        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > ce.caseEndsAt) revert VotingEnded();
        if (caseEvidenceCount[caseId] >= MAX_EVIDENCE_PER_CASE) revert MaxEvidenceReached();

        evidenceId = keccak256(abi.encodePacked(_nextEvidenceId++, caseId, msg.sender, block.timestamp));
        uint256 timeWeight = _calculateTimeWeight(ce.caseEndsAt);

        evidence[evidenceId] = Evidence({
            evidenceId: evidenceId,
            caseId: caseId,
            submitter: msg.sender,
            stake: msg.value,
            submitterReputation: _getReputation(msg.sender),
            ipfsHash: ipfsHash,
            summary: summary,
            position: position,
            supportStake: 0,
            opposeStake: 0,
            supporterCount: 0,
            opposerCount: 0,
            submittedAt: block.timestamp,
            timeWeight: timeWeight,
            status: EvidenceStatus.ACTIVE,
            submitterClaimed: false
        });

        ce.evidenceIds.push(evidenceId);
        caseEvidenceCount[caseId]++;
        
        uint256 weightedStake = (msg.value * timeWeight) / 10000;
        if (position == EvidencePosition.FOR_ACTION) {
            ce.totalForStake += weightedStake;
        } else {
            ce.totalAgainstStake += weightedStake;
        }

        userEvidence[msg.sender].push(evidenceId);
        userCaseEvidence[caseId][msg.sender].push(evidenceId);

        emit EvidenceSubmitted(evidenceId, caseId, msg.sender, msg.value, position, ipfsHash, timeWeight);
    }

    function supportEvidence(bytes32 evidenceId, bool isSupporting, string calldata comment) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_SUPPORT_STAKE) revert InsufficientStake();
        
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) revert EvidenceNotFound();
        if (e.submitter == msg.sender) revert CannotSupportOwnEvidence();
        
        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (ce.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > ce.caseEndsAt) revert VotingEnded();
        if (hasSupported[evidenceId][msg.sender]) revert AlreadySupported();
        if (evidenceSupport[evidenceId].length >= MAX_SUPPORTS_PER_EVIDENCE) revert MaxSupportsReached();

        uint256 timeWeight = _calculateTimeWeight(ce.caseEndsAt);
        uint256 supportIndex = evidenceSupport[evidenceId].length;
        
        evidenceSupport[evidenceId].push(EvidenceSupport({
            supporter: msg.sender,
            stake: msg.value,
            reputation: _getReputation(msg.sender),
            isSupporting: isSupporting,
            comment: comment,
            timestamp: block.timestamp,
            timeWeight: timeWeight,
            claimed: false
        }));

        userSupportIndex[evidenceId][msg.sender] = supportIndex;
        hasSupported[evidenceId][msg.sender] = true;

        if (isSupporting) {
            e.supportStake += msg.value;
            e.supporterCount++;
        } else {
            e.opposeStake += msg.value;
            e.opposerCount++;
        }

        uint256 weightedStake = (msg.value * timeWeight) / 10000;
        bool addToFor = isSupporting ? e.position == EvidencePosition.FOR_ACTION : e.position != EvidencePosition.FOR_ACTION;
        if (addToFor) {
            ce.totalForStake += weightedStake;
        } else {
            ce.totalAgainstStake += weightedStake;
        }

        emit EvidenceSupported(evidenceId, msg.sender, msg.value, isSupporting, comment, timeWeight);
    }

    function resolveCase(bytes32 caseId, bool outcomeWasAction) external nonReentrant {
        if (msg.sender != moderationMarketplace) revert NotAuthorized();

        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) revert CaseNotRegistered();
        if (ce.resolved) revert CaseAlreadyResolved();

        ce.resolved = true;
        ce.outcomeWasAction = outcomeWasAction;

        uint256 totalPot = 0;
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage e = evidence[ce.evidenceIds[i]];
            bool aligned = (e.position == EvidencePosition.FOR_ACTION) == outcomeWasAction;
            e.status = aligned ? EvidenceStatus.REWARDED : EvidenceStatus.SLASHED;
            totalPot += e.stake + e.supportStake + e.opposeStake;
        }

        uint256 protocolFee = (totalPot * PROTOCOL_FEE_BPS) / 10000;
        ce.protocolFeesCollected = protocolFee;
        totalProtocolFees += protocolFee;

        emit CaseResolved(caseId, outcomeWasAction, ce.totalForStake, ce.totalAgainstStake, protocolFee);
    }

    function claimRewards(bytes32 evidenceId) external nonReentrant {
        (uint256 totalClaim, bool wasSubmitter) = _processClaimForEvidence(evidenceId, msg.sender);
        if (totalClaim == 0) revert NothingToClaim();

        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");

        emit RewardsClaimed(evidenceId, msg.sender, totalClaim, wasSubmitter);
    }

    function batchClaimRewards(bytes32[] calldata evidenceIds) external nonReentrant {
        uint256 totalClaim = 0;
        for (uint256 i = 0; i < evidenceIds.length; i++) {
            (uint256 claim,) = _processClaimForEvidence(evidenceIds[i], msg.sender);
            totalClaim += claim;
        }
        if (totalClaim == 0) revert NothingToClaim();

        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");
    }

    function _processClaimForEvidence(bytes32 evidenceId, address claimer) internal returns (uint256 totalClaim, bool wasSubmitter) {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) return (0, false);

        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (!ce.resolved) return (0, false);

        if (e.submitter == claimer && !e.submitterClaimed && e.stake > 0) {
            totalClaim += _calculateClaim(e, ce, e.stake, true, true);
            e.submitterClaimed = true;
            wasSubmitter = true;
        }

        if (hasSupported[evidenceId][claimer]) {
            uint256 idx = userSupportIndex[evidenceId][claimer];
            EvidenceSupport storage support = evidenceSupport[evidenceId][idx];
            if (!support.claimed && support.stake > 0) {
                bool supporterWon = support.isSupporting ? e.status == EvidenceStatus.REWARDED : e.status == EvidenceStatus.SLASHED;
                totalClaim += _calculateClaim(e, ce, support.stake, supporterWon, false);
                support.claimed = true;
            }
        }
    }

    function _calculateClaim(Evidence storage e, CaseEvidence storage ce, uint256 stake, bool won, bool isSubmitter) internal view returns (uint256) {
        if (!won) return 0;

        (uint256 winningPool, uint256 losingPool) = _calculatePools(ce);
        if (winningPool == 0) return stake;

        uint256 distributablePool = losingPool - (losingPool * PROTOCOL_FEE_BPS) / 10000;
        uint256 share = (distributablePool * WINNER_SHARE_BPS * stake) / (winningPool * 10000);
        
        if (isSubmitter) {
            share += (distributablePool * SUBMITTER_BONUS_BPS * stake) / (winningPool * 10000);
        }

        return stake + share;
    }

    function _calculatePools(CaseEvidence storage ce) internal view returns (uint256 winningPool, uint256 losingPool) {
        for (uint256 i = 0; i < ce.evidenceIds.length; i++) {
            Evidence storage ev = evidence[ce.evidenceIds[i]];
            uint256 evidenceTotal = ev.stake + ev.supportStake;
            uint256 oppositionTotal = ev.opposeStake;
            
            if (ev.status == EvidenceStatus.REWARDED) {
                winningPool += evidenceTotal;
                losingPool += oppositionTotal;
            } else {
                losingPool += evidenceTotal;
                winningPool += oppositionTotal;
            }
        }
    }

    function _calculateTimeWeight(uint256 caseEndsAt) internal view returns (uint256) {
        if (block.timestamp >= caseEndsAt) return 10000;
        uint256 hoursRemaining = (caseEndsAt - block.timestamp) / 1 hours;
        uint256 timeBonus = hoursRemaining * TIME_WEIGHT_BPS_PER_HOUR;
        return 10000 + (timeBonus > MAX_TIME_BONUS_BPS ? MAX_TIME_BONUS_BPS : timeBonus);
    }

    function _getReputation(address user) internal view returns (uint256) {
        if (reputationProvider == address(0)) return 5000;
        (bool success, bytes memory data) = reputationProvider.staticcall(abi.encodeWithSignature("getReputation(address)", user));
        if (success && data.length >= 32) {
            uint256 rep = abi.decode(data, (uint256));
            return rep > 10000 ? 10000 : rep;
        }
        return 5000;
    }

    function getCaseEvidence(bytes32 caseId) external view returns (bytes32[] memory, uint256, uint256, bool) {
        CaseEvidence storage ce = caseEvidence[caseId];
        return (ce.evidenceIds, ce.totalForStake, ce.totalAgainstStake, ce.resolved);
    }

    function getCaseEvidenceDetails(bytes32 caseId) external view returns (CaseEvidence memory) {
        return caseEvidence[caseId];
    }

    function getEvidence(bytes32 evidenceId) external view returns (Evidence memory) {
        return evidence[evidenceId];
    }

    function getEvidenceSupport(bytes32 evidenceId) external view returns (EvidenceSupport[] memory) {
        return evidenceSupport[evidenceId];
    }

    function getUserEvidence(address user) external view returns (bytes32[] memory) {
        return userEvidence[user];
    }

    function getUserCaseEvidence(bytes32 caseId, address user) external view returns (bytes32[] memory) {
        return userCaseEvidence[caseId][user];
    }

    function getClaimableAmount(bytes32 evidenceId, address user) external view returns (uint256) {
        Evidence storage e = evidence[evidenceId];
        if (e.submittedAt == 0) return 0;

        CaseEvidence storage ce = caseEvidence[e.caseId];
        if (!ce.resolved) return 0;

        uint256 total = 0;
        if (e.submitter == user && !e.submitterClaimed && e.stake > 0) {
            total += _calculateClaim(e, ce, e.stake, e.status == EvidenceStatus.REWARDED, true);
        }

        if (hasSupported[evidenceId][user]) {
            uint256 idx = userSupportIndex[evidenceId][user];
            EvidenceSupport storage support = evidenceSupport[evidenceId][idx];
            if (!support.claimed && support.stake > 0) {
                bool supporterWon = support.isSupporting ? e.status == EvidenceStatus.REWARDED : e.status == EvidenceStatus.SLASHED;
                total += _calculateClaim(e, ce, support.stake, supporterWon, false);
            }
        }
        return total;
    }

    function isCaseActive(bytes32 caseId) external view returns (bool) {
        CaseEvidence storage ce = caseEvidence[caseId];
        return ce.caseCreatedAt != 0 && !ce.resolved && block.timestamp <= ce.caseEndsAt;
    }

    function getCurrentTimeWeight(bytes32 caseId) external view returns (uint256) {
        CaseEvidence storage ce = caseEvidence[caseId];
        if (ce.caseCreatedAt == 0) return 10000;
        return _calculateTimeWeight(ce.caseEndsAt);
    }

    function setModerationMarketplace(address _moderationMarketplace) external onlyOwner {
        emit ModerationMarketplaceUpdated(moderationMarketplace, _moderationMarketplace);
        moderationMarketplace = _moderationMarketplace;
    }

    function setReputationProvider(address _reputationProvider) external onlyOwner {
        emit ReputationProviderUpdated(reputationProvider, _reputationProvider);
        reputationProvider = _reputationProvider;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawProtocolFees() external onlyOwner {
        uint256 amount = totalProtocolFees;
        if (amount == 0) revert NothingToClaim();
        totalProtocolFees = 0;
        (bool success,) = treasury.call{value: amount}("");
        require(success, "Transfer failed");
        emit ProtocolFeesWithdrawn(treasury, amount);
    }

    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success,) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    function version() external pure returns (string memory) { return "2.0.0"; }

    receive() external payable {}
}
