// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReputationProviderRegistry is Ownable, Pausable, ReentrancyGuard {
    enum ProposalType {
        ADD_PROVIDER,
        REMOVE_PROVIDER,
        UPDATE_WEIGHT,
        SUSPEND_PROVIDER,
        UNSUSPEND_PROVIDER
    }
    enum ProposalStatus {
        PENDING,
        BOARD_REVIEW,
        APPROVED,
        REJECTED,
        EXECUTED,
        CANCELLED
    }

    struct ReputationProvider {
        address providerContract;
        string name;
        string description;
        uint256 weight;
        uint256 addedAt;
        bool isActive;
        bool isSuspended;
        uint256 totalFeedbackCount;
        uint256 accuracyScore;
        uint256 lastFeedbackAt;
    }

    struct Proposal {
        bytes32 proposalId;
        ProposalType proposalType;
        address targetProvider;
        string providerName;
        string providerDescription;
        uint256 proposedWeight;
        address proposer;
        uint256 stake;
        uint256 forStake;
        uint256 againstStake;
        uint256 forCount;
        uint256 againstCount;
        uint256 createdAt;
        uint256 challengeEnds;
        uint256 timelockEnds;
        ProposalStatus status;
        bytes32 boardDecisionHash;
        string boardReason;
        bool proposerClaimed;
    }

    struct Opinion {
        address author;
        uint256 stake;
        uint256 reputation;
        bool inFavor;
        string ipfsHash;
        string summary;
        uint256 timestamp;
        bool claimed;
    }

    struct Vote {
        address voter;
        uint256 stake;
        uint256 reputation;
        bool inFavor;
        uint256 timestamp;
        bool claimed;
    }

    uint256 public constant MIN_PROPOSAL_STAKE = 0.01 ether;
    uint256 public constant MIN_VOTE_STAKE = 0.001 ether;
    uint256 public constant MIN_OPINION_STAKE = 0.0005 ether;
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant TIMELOCK_PERIOD = 2 days;
    uint256 public constant MAX_WEIGHT = 10000;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_DESCRIPTION_LENGTH = 256;
    uint256 public constant MAX_SUMMARY_LENGTH = 280;
    uint256 public constant WINNER_SHARE_BPS = 8500;
    uint256 public constant PROTOCOL_FEE_BPS = 500;
    uint256 public constant CANCEL_PENALTY_BPS = 5000;
    uint256 public constant MIN_QUORUM_STAKE = 0.1 ether;
    uint256 public constant MIN_QUORUM_VOTERS = 3;

    mapping(address => ReputationProvider) public providers;
    address[] public providerList;
    uint256 public activeProviderCount;
    uint256 public totalWeight;

    mapping(bytes32 => Proposal) public proposals;
    bytes32[] public allProposalIds;
    mapping(bytes32 => Vote[]) public proposalVotes;
    mapping(bytes32 => mapping(address => uint256)) public userVoteIndex;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => Opinion[]) public proposalOpinions;
    mapping(bytes32 => mapping(address => uint256)) public userOpinionIndex;
    mapping(bytes32 => mapping(address => bool)) public hasOpined;

    address public boardGovernance;
    address public treasury;
    uint256 public totalProtocolFees;
    uint256 private _nextProposalId;

    event ProviderAdded(address indexed provider, string name, uint256 weight);
    event ProviderRemoved(address indexed provider);
    event ProviderWeightUpdated(address indexed provider, uint256 oldWeight, uint256 newWeight);
    event ProviderSuspended(address indexed provider);
    event ProviderUnsuspended(address indexed provider);
    event ProposalCreated(
        bytes32 indexed proposalId,
        ProposalType proposalType,
        address indexed targetProvider,
        address indexed proposer,
        uint256 stake
    );
    event ProposalVoted(bytes32 indexed proposalId, address indexed voter, bool inFavor, uint256 stake);
    event OpinionAdded(
        bytes32 indexed proposalId, address indexed author, bool inFavor, uint256 stake, string ipfsHash
    );
    event ProposalStatusChanged(bytes32 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event BoardDecision(bytes32 indexed proposalId, bool approved, bytes32 decisionHash, string reason);
    event RewardsClaimed(bytes32 indexed proposalId, address indexed claimer, uint256 amount);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed proposer, uint256 penalty);
    event ProviderFeedbackRecorded(address indexed provider, uint256 agentId, uint8 score);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event ConfigUpdated(string indexed key, address oldVal, address newVal);

    error InsufficientStake();
    error InvalidAddress();
    error ProviderExists();
    error ProviderNotFound();
    error ProviderNotActive();
    error ProviderSuspendedError();
    error ProposalNotFound();
    error ChallengePeriodActive();
    error ChallengePeriodEnded();
    error TimelockNotComplete();
    error NotAuthorized();
    error AlreadyVoted();
    error AlreadyOpined();
    error InvalidWeight();
    error NameTooLong();
    error DescriptionTooLong();
    error SummaryTooLong();
    error ProposalNotPending();
    error ProposalNotApproved();
    error ProposalNotInReview();
    error NothingToClaim();
    error NotProposer();
    error CannotCancelAfterReview();

    constructor(address _board, address _treasury, address _owner) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        boardGovernance = _board;
        treasury = _treasury;
    }

    function proposeAddProvider(address provider, string calldata name, string calldata desc, uint256 weight)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32)
    {
        _validateProposalStake();
        if (provider == address(0)) revert InvalidAddress();
        if (providers[provider].addedAt != 0) revert ProviderExists();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(desc).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        return _createProposal(ProposalType.ADD_PROVIDER, provider, name, desc, weight);
    }

    function proposeRemoveProvider(address provider) external payable nonReentrant whenNotPaused returns (bytes32) {
        _validateProposalStake();
        if (providers[provider].addedAt == 0) revert ProviderNotFound();
        return _createProposal(ProposalType.REMOVE_PROVIDER, provider, "", "", 0);
    }

    function proposeUpdateWeight(address provider, uint256 weight)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32)
    {
        _validateProposalStake();
        if (providers[provider].addedAt == 0) revert ProviderNotFound();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        return _createProposal(ProposalType.UPDATE_WEIGHT, provider, "", "", weight);
    }

    function proposeSuspendProvider(address provider) external payable nonReentrant whenNotPaused returns (bytes32) {
        _validateProposalStake();
        ReputationProvider storage p = providers[provider];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (p.isSuspended) revert ProviderSuspendedError();
        return _createProposal(ProposalType.SUSPEND_PROVIDER, provider, "", "", 0);
    }

    function proposeUnsuspendProvider(address provider) external payable nonReentrant whenNotPaused returns (bytes32) {
        _validateProposalStake();
        ReputationProvider storage p = providers[provider];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (!p.isSuspended) revert ProviderNotActive();
        return _createProposal(ProposalType.UNSUSPEND_PROVIDER, provider, "", "", 0);
    }

    function _validateProposalStake() internal view {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
    }

    function _createProposal(ProposalType pType, address target, string memory name, string memory desc, uint256 weight)
        internal
        returns (bytes32 id)
    {
        id = keccak256(abi.encodePacked(_nextProposalId++, pType, target, msg.sender, block.timestamp));
        proposals[id] = Proposal(
            id,
            pType,
            target,
            name,
            desc,
            weight,
            msg.sender,
            msg.value,
            0,
            0,
            0,
            0,
            block.timestamp,
            block.timestamp + CHALLENGE_PERIOD,
            0,
            ProposalStatus.PENDING,
            bytes32(0),
            "",
            false
        );
        allProposalIds.push(id);
        emit ProposalCreated(id, pType, target, msg.sender, msg.value);
    }

    function vote(bytes32 id, bool inFavor) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_VOTE_STAKE) revert InsufficientStake();
        Proposal storage p = proposals[id];
        _validatePendingProposal(p);
        if (hasVoted[id][msg.sender] || msg.sender == p.proposer) revert AlreadyVoted();

        proposalVotes[id].push(Vote(msg.sender, msg.value, 0, inFavor, block.timestamp, false));
        userVoteIndex[id][msg.sender] = proposalVotes[id].length - 1;
        hasVoted[id][msg.sender] = true;

        if (inFavor) {
            p.forStake += msg.value;
            p.forCount++;
        } else {
            p.againstStake += msg.value;
            p.againstCount++;
        }

        emit ProposalVoted(id, msg.sender, inFavor, msg.value);
    }

    function addOpinion(bytes32 id, bool inFavor, string calldata ipfsHash, string calldata summary)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (msg.value < MIN_OPINION_STAKE) revert InsufficientStake();
        Proposal storage p = proposals[id];
        _validatePendingProposal(p);
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();
        if (hasOpined[id][msg.sender]) revert AlreadyOpined();

        proposalOpinions[id].push(Opinion(msg.sender, msg.value, 0, inFavor, ipfsHash, summary, block.timestamp, false));
        userOpinionIndex[id][msg.sender] = proposalOpinions[id].length - 1;
        hasOpined[id][msg.sender] = true;

        if (inFavor) p.forStake += msg.value;
        else p.againstStake += msg.value;

        emit OpinionAdded(id, msg.sender, inFavor, msg.value, ipfsHash);
    }

    function _validatePendingProposal(Proposal storage p) internal view {
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp > p.challengeEnds) revert ChallengePeriodEnded();
    }

    function cancelProposal(bytes32 id) external nonReentrant {
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (msg.sender != p.proposer) revert NotProposer();
        if (p.status != ProposalStatus.PENDING) revert CannotCancelAfterReview();

        ProposalStatus old = p.status;
        p.status = ProposalStatus.CANCELLED;
        uint256 penalty = (p.stake * CANCEL_PENALTY_BPS) / 10000;
        totalProtocolFees += penalty;
        p.proposerClaimed = true;

        if (p.stake > penalty) _transfer(msg.sender, p.stake - penalty);

        emit ProposalCancelled(id, msg.sender, penalty);
        emit ProposalStatusChanged(id, old, ProposalStatus.CANCELLED);
    }

    function advanceToBoardReview(bytes32 id) external {
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp <= p.challengeEnds) revert ChallengePeriodActive();

        ProposalStatus old = p.status;
        if (p.forStake + p.againstStake < MIN_QUORUM_STAKE || p.forCount + p.againstCount < MIN_QUORUM_VOTERS) {
            p.status = ProposalStatus.REJECTED;
        } else {
            p.status = ProposalStatus.BOARD_REVIEW;
        }
        emit ProposalStatusChanged(id, old, p.status);
    }

    function submitBoardDecision(bytes32 id, bool approved, bytes32 hash, string calldata reason) external {
        if (msg.sender != boardGovernance) revert NotAuthorized();
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.BOARD_REVIEW) revert ProposalNotInReview();

        p.boardDecisionHash = hash;
        p.boardReason = reason;
        ProposalStatus old = p.status;
        p.status = approved ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;
        if (approved) p.timelockEnds = block.timestamp + TIMELOCK_PERIOD;

        emit BoardDecision(id, approved, hash, reason);
        emit ProposalStatusChanged(id, old, p.status);
    }

    function executeProposal(bytes32 id) external nonReentrant {
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.APPROVED) revert ProposalNotApproved();
        if (block.timestamp < p.timelockEnds) revert TimelockNotComplete();

        ProposalStatus old = p.status;
        p.status = ProposalStatus.EXECUTED;

        if (p.proposalType == ProposalType.ADD_PROVIDER) {
            _addProvider(p.targetProvider, p.providerName, p.providerDescription, p.proposedWeight);
        } else if (p.proposalType == ProposalType.REMOVE_PROVIDER) {
            _removeProvider(p.targetProvider);
        } else if (p.proposalType == ProposalType.UPDATE_WEIGHT) {
            _updateWeight(p.targetProvider, p.proposedWeight);
        } else if (p.proposalType == ProposalType.SUSPEND_PROVIDER) {
            _suspendProvider(p.targetProvider);
        } else if (p.proposalType == ProposalType.UNSUSPEND_PROVIDER) {
            _unsuspendProvider(p.targetProvider);
        }

        emit ProposalStatusChanged(id, old, ProposalStatus.EXECUTED);
    }

    function _addProvider(address addr, string memory name, string memory desc, uint256 weight) internal {
        providers[addr] = ReputationProvider(addr, name, desc, weight, block.timestamp, true, false, 0, 5000, 0);
        providerList.push(addr);
        activeProviderCount++;
        totalWeight += weight;
        emit ProviderAdded(addr, name, weight);
    }

    function _removeProvider(address addr) internal {
        ReputationProvider storage p = providers[addr];
        if (p.isActive) {
            activeProviderCount--;
            if (!p.isSuspended) totalWeight -= p.weight;
        }
        p.isActive = false;
        emit ProviderRemoved(addr);
    }

    function _updateWeight(address addr, uint256 newWeight) internal {
        ReputationProvider storage p = providers[addr];
        uint256 old = p.weight;
        if (p.isActive && !p.isSuspended) totalWeight = totalWeight - old + newWeight;
        p.weight = newWeight;
        emit ProviderWeightUpdated(addr, old, newWeight);
    }

    function _suspendProvider(address addr) internal {
        ReputationProvider storage p = providers[addr];
        p.isSuspended = true;
        if (p.isActive) totalWeight -= p.weight;
        emit ProviderSuspended(addr);
    }

    function _unsuspendProvider(address addr) internal {
        ReputationProvider storage p = providers[addr];
        p.isSuspended = false;
        if (p.isActive) totalWeight += p.weight;
        emit ProviderUnsuspended(addr);
    }

    function claimRewards(bytes32 id) external nonReentrant {
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (
            p.status != ProposalStatus.EXECUTED && p.status != ProposalStatus.REJECTED
                && p.status != ProposalStatus.CANCELLED
        ) revert ProposalNotApproved();

        uint256 total;
        if (msg.sender == p.proposer && !p.proposerClaimed) {
            uint256 c = _calcClaim(p, p.stake, true, true);
            if (c > 0) {
                total += c;
                p.proposerClaimed = true;
            }
        }
        if (hasVoted[id][msg.sender]) {
            Vote storage v = proposalVotes[id][userVoteIndex[id][msg.sender]];
            if (!v.claimed) {
                uint256 c = _calcClaim(p, v.stake, v.inFavor, false);
                if (c > 0) {
                    total += c;
                    v.claimed = true;
                }
            }
        }
        if (hasOpined[id][msg.sender]) {
            Opinion storage o = proposalOpinions[id][userOpinionIndex[id][msg.sender]];
            if (!o.claimed && o.stake > 0) {
                uint256 c = _calcClaim(p, o.stake, o.inFavor, false);
                if (c > 0) {
                    total += c;
                    o.claimed = true;
                }
            }
        }

        if (total == 0) revert NothingToClaim();
        _transfer(msg.sender, total);
        emit RewardsClaimed(id, msg.sender, total);
    }

    function _calcClaim(Proposal storage p, uint256 stake, bool inFavor, bool isProposer)
        internal
        view
        returns (uint256)
    {
        if (p.status == ProposalStatus.CANCELLED) return 0;
        bool passed = p.status == ProposalStatus.EXECUTED;
        bool won = isProposer ? passed : ((inFavor && passed) || (!inFavor && !passed));
        if (!won) return 0;

        uint256 losePool = passed ? p.againstStake : (p.forStake + p.stake);
        uint256 winPool = passed ? (p.forStake + p.stake) : p.againstStake;
        if (winPool == 0) return stake;

        uint256 dist = losePool - (losePool * PROTOCOL_FEE_BPS) / 10000;
        return stake + (dist * WINNER_SHARE_BPS * stake) / (winPool * 10000);
    }

    function _transfer(address to, uint256 amt) internal {
        (bool ok,) = to.call{value: amt}("");
        require(ok, "Transfer failed");
    }

    function getAggregatedReputation(uint256 agentId)
        external
        view
        returns (uint256 score, uint256[] memory scores, uint256[] memory weights)
    {
        uint256 cnt = _countActive();
        scores = new uint256[](cnt);
        weights = new uint256[](cnt);
        uint256 total;
        uint256 idx;

        for (uint256 i; i < providerList.length; i++) {
            ReputationProvider storage p = providers[providerList[i]];
            if (!p.isActive || p.isSuspended) continue;
            uint256 s = _getProviderScore(p.providerContract, agentId);
            uint256 w = totalWeight > 0 ? (p.weight * 10000) / totalWeight : 10000 / cnt;
            scores[idx] = s;
            weights[idx] = w;
            total += s * w;
            idx++;
        }
        score = total / 10000;
        if (score > 10000) score = 10000;
    }

    function _countActive() internal view returns (uint256 cnt) {
        for (uint256 i; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) cnt++;
        }
    }

    function _getProviderScore(address addr, uint256 agentId) internal view returns (uint256) {
        (bool ok, bytes memory data) = addr.staticcall(abi.encodeWithSignature("getReputationScore(uint256)", agentId));
        if (ok && data.length >= 32) {
            uint256 s = abi.decode(data, (uint256));
            return s > 10000 ? 10000 : s;
        }
        return 5000;
    }

    function recordProviderFeedback(address addr, uint256 agentId, uint8 score) external {
        ReputationProvider storage p = providers[addr];
        if (p.addedAt == 0) return;
        p.totalFeedbackCount++;
        p.lastFeedbackAt = block.timestamp;
        emit ProviderFeedbackRecorded(addr, agentId, score);
    }

    function getProvider(address addr) external view returns (ReputationProvider memory) {
        return providers[addr];
    }

    function getAllProviders() external view returns (address[] memory) {
        return providerList;
    }

    function getActiveProviders() external view returns (address[] memory out) {
        uint256 cnt = _countActive();
        out = new address[](cnt);
        uint256 idx;
        for (uint256 i; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) {
                out[idx++] = providerList[i];
            }
        }
    }

    function getProposal(bytes32 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function getProposalVotes(bytes32 id) external view returns (Vote[] memory) {
        return proposalVotes[id];
    }

    function getProposalOpinions(bytes32 id) external view returns (Opinion[] memory) {
        return proposalOpinions[id];
    }

    function getAllProposals() external view returns (bytes32[] memory) {
        return allProposalIds;
    }

    function isQuorumReached(bytes32 id) external view returns (bool, uint256, uint256) {
        Proposal storage p = proposals[id];
        uint256 stake = p.forStake + p.againstStake;
        uint256 voters = p.forCount + p.againstCount;
        return (stake >= MIN_QUORUM_STAKE && voters >= MIN_QUORUM_VOTERS, stake, voters);
    }

    function getClaimableAmount(bytes32 id, address user) external view returns (uint256 total) {
        Proposal storage p = proposals[id];
        if (
            p.status != ProposalStatus.EXECUTED && p.status != ProposalStatus.REJECTED
                && p.status != ProposalStatus.CANCELLED
        ) return 0;
        if (user == p.proposer && !p.proposerClaimed) total += _calcClaim(p, p.stake, true, true);
        if (hasVoted[id][user]) {
            Vote storage v = proposalVotes[id][userVoteIndex[id][user]];
            if (!v.claimed) total += _calcClaim(p, v.stake, v.inFavor, false);
        }
        if (hasOpined[id][user]) {
            Opinion storage o = proposalOpinions[id][userOpinionIndex[id][user]];
            if (!o.claimed && o.stake > 0) total += _calcClaim(p, o.stake, o.inFavor, false);
        }
    }

    function initializeProvider(address addr, string calldata name, string calldata desc, uint256 weight)
        external
        onlyOwner
    {
        if (providers[addr].addedAt != 0) revert ProviderExists();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        _addProvider(addr, name, desc, weight);
    }

    function setBoardGovernance(address v) external onlyOwner {
        emit ConfigUpdated("board", boardGovernance, v);
        boardGovernance = v;
    }

    function setTreasury(address v) external onlyOwner {
        if (v == address(0)) revert InvalidAddress();
        emit ConfigUpdated("treasury", treasury, v);
        treasury = v;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawProtocolFees() external onlyOwner {
        uint256 amt = totalProtocolFees;
        if (amt == 0) revert NothingToClaim();
        totalProtocolFees = 0;
        _transfer(treasury, amt);
        emit ProtocolFeesWithdrawn(treasury, amt);
    }

    function emergencyRejectProposal(bytes32 id, string calldata reason) external onlyOwner {
        Proposal storage p = proposals[id];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.BOARD_REVIEW) revert ProposalNotInReview();
        require(block.timestamp > p.challengeEnds + 30 days, "Not stuck");
        ProposalStatus old = p.status;
        p.status = ProposalStatus.REJECTED;
        p.boardReason = reason;
        emit ProposalStatusChanged(id, old, ProposalStatus.REJECTED);
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    receive() external payable {}
}
