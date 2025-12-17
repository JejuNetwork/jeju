// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReputationProviderRegistry
 * @notice Permissionless registry for reputation providers with staked governance
 * @dev Community proposes changes via staked proposals with challenge period.
 *      AI Council makes final decisions. Stakes redistributed based on outcome.
 */
contract ReputationProviderRegistry is Ownable, Pausable, ReentrancyGuard {
    enum ProposalType { ADD_PROVIDER, REMOVE_PROVIDER, UPDATE_WEIGHT, SUSPEND_PROVIDER, UNSUSPEND_PROVIDER }
    enum ProposalStatus { PENDING, COUNCIL_REVIEW, APPROVED, REJECTED, EXECUTED, CANCELLED }

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
        bytes32 councilDecisionHash;
        string councilReason;
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

    address public councilGovernance;
    address public treasury;
    uint256 public totalProtocolFees;
    uint256 private _nextProposalId;

    event ProviderAdded(address indexed provider, string name, uint256 weight);
    event ProviderRemoved(address indexed provider);
    event ProviderWeightUpdated(address indexed provider, uint256 oldWeight, uint256 newWeight);
    event ProviderSuspended(address indexed provider);
    event ProviderUnsuspended(address indexed provider);
    event ProposalCreated(bytes32 indexed proposalId, ProposalType proposalType, address indexed targetProvider, address indexed proposer, uint256 stake);
    event ProposalVoted(bytes32 indexed proposalId, address indexed voter, bool inFavor, uint256 stake);
    event OpinionAdded(bytes32 indexed proposalId, address indexed author, bool inFavor, uint256 stake, string ipfsHash);
    event ProposalStatusChanged(bytes32 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event CouncilDecision(bytes32 indexed proposalId, bool approved, bytes32 decisionHash, string reason);
    event RewardsClaimed(bytes32 indexed proposalId, address indexed claimer, uint256 amount, string claimType);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed proposer, uint256 penaltyAmount);
    event ProviderFeedbackRecorded(address indexed provider, uint256 agentId, uint8 score);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event CouncilGovernanceUpdated(address oldAddress, address newAddress);
    event TreasuryUpdated(address oldAddress, address newAddress);

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

    constructor(address _councilGovernance, address _treasury, address _owner) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        councilGovernance = _councilGovernance;
        treasury = _treasury;
    }

    function proposeAddProvider(
        address providerContract,
        string calldata name,
        string calldata description,
        uint256 proposedWeight
    ) external payable nonReentrant whenNotPaused returns (bytes32) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providerContract == address(0)) revert InvalidAddress();
        if (providers[providerContract].addedAt != 0) revert ProviderExists();
        if (proposedWeight > MAX_WEIGHT) revert InvalidWeight();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        return _createProposal(ProposalType.ADD_PROVIDER, providerContract, name, description, proposedWeight);
    }

    function proposeRemoveProvider(address providerContract) external payable nonReentrant whenNotPaused returns (bytes32) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providers[providerContract].addedAt == 0) revert ProviderNotFound();
        return _createProposal(ProposalType.REMOVE_PROVIDER, providerContract, "", "", 0);
    }

    function proposeUpdateWeight(address providerContract, uint256 newWeight) external payable nonReentrant whenNotPaused returns (bytes32) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        if (providers[providerContract].addedAt == 0) revert ProviderNotFound();
        if (newWeight > MAX_WEIGHT) revert InvalidWeight();
        return _createProposal(ProposalType.UPDATE_WEIGHT, providerContract, "", "", newWeight);
    }

    function proposeSuspendProvider(address providerContract) external payable nonReentrant whenNotPaused returns (bytes32) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        ReputationProvider storage p = providers[providerContract];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (p.isSuspended) revert ProviderSuspendedError();
        return _createProposal(ProposalType.SUSPEND_PROVIDER, providerContract, "", "", 0);
    }

    function proposeUnsuspendProvider(address providerContract) external payable nonReentrant whenNotPaused returns (bytes32) {
        if (msg.value < MIN_PROPOSAL_STAKE) revert InsufficientStake();
        ReputationProvider storage p = providers[providerContract];
        if (p.addedAt == 0) revert ProviderNotFound();
        if (!p.isSuspended) revert ProviderNotActive();
        return _createProposal(ProposalType.UNSUSPEND_PROVIDER, providerContract, "", "", 0);
    }

    function _createProposal(
        ProposalType proposalType,
        address targetProvider,
        string memory name,
        string memory description,
        uint256 proposedWeight
    ) internal returns (bytes32 proposalId) {
        proposalId = keccak256(abi.encodePacked(_nextProposalId++, proposalType, targetProvider, msg.sender, block.timestamp));

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            proposalType: proposalType,
            targetProvider: targetProvider,
            providerName: name,
            providerDescription: description,
            proposedWeight: proposedWeight,
            proposer: msg.sender,
            stake: msg.value,
            forStake: 0,
            againstStake: 0,
            forCount: 0,
            againstCount: 0,
            createdAt: block.timestamp,
            challengeEnds: block.timestamp + CHALLENGE_PERIOD,
            timelockEnds: 0,
            status: ProposalStatus.PENDING,
            councilDecisionHash: bytes32(0),
            councilReason: "",
            proposerClaimed: false
        });

        allProposalIds.push(proposalId);
        emit ProposalCreated(proposalId, proposalType, targetProvider, msg.sender, msg.value);
    }

    function vote(bytes32 proposalId, bool inFavor) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_VOTE_STAKE) revert InsufficientStake();
        
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp > p.challengeEnds) revert ChallengePeriodEnded();
        if (hasVoted[proposalId][msg.sender] || msg.sender == p.proposer) revert AlreadyVoted();

        uint256 voteIndex = proposalVotes[proposalId].length;
        proposalVotes[proposalId].push(Vote({
            voter: msg.sender,
            stake: msg.value,
            reputation: 0,
            inFavor: inFavor,
            timestamp: block.timestamp,
            claimed: false
        }));
        userVoteIndex[proposalId][msg.sender] = voteIndex;
        hasVoted[proposalId][msg.sender] = true;

        if (inFavor) {
            p.forStake += msg.value;
            p.forCount++;
        } else {
            p.againstStake += msg.value;
            p.againstCount++;
        }

        emit ProposalVoted(proposalId, msg.sender, inFavor, msg.value);
    }

    function addOpinion(bytes32 proposalId, bool inFavor, string calldata ipfsHash, string calldata summary) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_OPINION_STAKE) revert InsufficientStake();
        
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp > p.challengeEnds) revert ChallengePeriodEnded();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();
        if (hasOpined[proposalId][msg.sender]) revert AlreadyOpined();

        uint256 opinionIndex = proposalOpinions[proposalId].length;
        proposalOpinions[proposalId].push(Opinion({
            author: msg.sender,
            stake: msg.value,
            reputation: 0,
            inFavor: inFavor,
            ipfsHash: ipfsHash,
            summary: summary,
            timestamp: block.timestamp,
            claimed: false
        }));

        userOpinionIndex[proposalId][msg.sender] = opinionIndex;
        hasOpined[proposalId][msg.sender] = true;

        if (inFavor) {
            p.forStake += msg.value;
        } else {
            p.againstStake += msg.value;
        }

        emit OpinionAdded(proposalId, msg.sender, inFavor, msg.value, ipfsHash);
    }

    function cancelProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (msg.sender != p.proposer) revert NotProposer();
        if (p.status != ProposalStatus.PENDING) revert CannotCancelAfterReview();

        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.CANCELLED;

        uint256 penalty = (p.stake * CANCEL_PENALTY_BPS) / 10000;
        uint256 refund = p.stake - penalty;
        totalProtocolFees += penalty;
        p.proposerClaimed = true;

        if (refund > 0) {
            (bool success,) = msg.sender.call{value: refund}("");
            require(success, "Transfer failed");
        }

        emit ProposalCancelled(proposalId, msg.sender, penalty);
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.CANCELLED);
    }

    function advanceToCouncilReview(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (block.timestamp <= p.challengeEnds) revert ChallengePeriodActive();

        ProposalStatus oldStatus = p.status;
        
        if (p.forStake + p.againstStake < MIN_QUORUM_STAKE || p.forCount + p.againstCount < MIN_QUORUM_VOTERS) {
            p.status = ProposalStatus.REJECTED;
            emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.REJECTED);
            return;
        }

        p.status = ProposalStatus.COUNCIL_REVIEW;
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.COUNCIL_REVIEW);
    }

    function submitCouncilDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, string calldata reason) external {
        if (msg.sender != councilGovernance) revert NotAuthorized();

        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.COUNCIL_REVIEW) revert ProposalNotInReview();

        p.councilDecisionHash = decisionHash;
        p.councilReason = reason;

        ProposalStatus oldStatus = p.status;
        if (approved) {
            p.status = ProposalStatus.APPROVED;
            p.timelockEnds = block.timestamp + TIMELOCK_PERIOD;
        } else {
            p.status = ProposalStatus.REJECTED;
        }

        emit CouncilDecision(proposalId, approved, decisionHash, reason);
        emit ProposalStatusChanged(proposalId, oldStatus, p.status);
    }

    function executeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.APPROVED) revert ProposalNotApproved();
        if (block.timestamp < p.timelockEnds) revert TimelockNotComplete();

        ProposalStatus oldStatus = p.status;
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

        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.EXECUTED);
    }

    function _addProvider(address providerContract, string memory name, string memory description, uint256 weight) internal {
        providers[providerContract] = ReputationProvider({
            providerContract: providerContract,
            name: name,
            description: description,
            weight: weight,
            addedAt: block.timestamp,
            isActive: true,
            isSuspended: false,
            totalFeedbackCount: 0,
            accuracyScore: 5000,
            lastFeedbackAt: 0
        });
        providerList.push(providerContract);
        activeProviderCount++;
        totalWeight += weight;
        emit ProviderAdded(providerContract, name, weight);
    }

    function _removeProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        if (p.isActive && !p.isSuspended) {
            activeProviderCount--;
            totalWeight -= p.weight;
        } else if (p.isActive) {
            activeProviderCount--;
        }
        p.isActive = false;
        emit ProviderRemoved(providerContract);
    }

    function _updateWeight(address providerContract, uint256 newWeight) internal {
        ReputationProvider storage p = providers[providerContract];
        uint256 oldWeight = p.weight;
        if (p.isActive && !p.isSuspended) {
            totalWeight = totalWeight - oldWeight + newWeight;
        }
        p.weight = newWeight;
        emit ProviderWeightUpdated(providerContract, oldWeight, newWeight);
    }

    function _suspendProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        p.isSuspended = true;
        if (p.isActive) {
            totalWeight -= p.weight;
        }
        emit ProviderSuspended(providerContract);
    }

    function _unsuspendProvider(address providerContract) internal {
        ReputationProvider storage p = providers[providerContract];
        p.isSuspended = false;
        if (p.isActive) {
            totalWeight += p.weight;
        }
        emit ProviderUnsuspended(providerContract);
    }

    function claimRewards(bytes32 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.EXECUTED && p.status != ProposalStatus.REJECTED && p.status != ProposalStatus.CANCELLED) {
            revert ProposalNotApproved();
        }

        uint256 totalClaim = 0;
        string memory claimType = "";

        if (msg.sender == p.proposer && !p.proposerClaimed) {
            uint256 claim = _calculateStakeClaim(p, p.stake, true, true);
            if (claim > 0) {
                totalClaim += claim;
                p.proposerClaimed = true;
                claimType = "proposer";
            }
        }

        if (hasVoted[proposalId][msg.sender]) {
            uint256 idx = userVoteIndex[proposalId][msg.sender];
            Vote storage v = proposalVotes[proposalId][idx];
            if (!v.claimed) {
                uint256 claim = _calculateStakeClaim(p, v.stake, v.inFavor, false);
                if (claim > 0) {
                    totalClaim += claim;
                    v.claimed = true;
                    claimType = bytes(claimType).length > 0 ? "proposer+vote" : "vote";
                }
            }
        }

        if (hasOpined[proposalId][msg.sender]) {
            uint256 idx = userOpinionIndex[proposalId][msg.sender];
            Opinion storage o = proposalOpinions[proposalId][idx];
            if (!o.claimed && o.stake > 0) {
                uint256 claim = _calculateStakeClaim(p, o.stake, o.inFavor, false);
                if (claim > 0) {
                    totalClaim += claim;
                    o.claimed = true;
                    claimType = bytes(claimType).length > 0 ? string(abi.encodePacked(claimType, "+opinion")) : "opinion";
                }
            }
        }

        if (totalClaim == 0) revert NothingToClaim();

        (bool success,) = msg.sender.call{value: totalClaim}("");
        require(success, "Transfer failed");
        
        emit RewardsClaimed(proposalId, msg.sender, totalClaim, claimType);
    }

    function _calculateStakeClaim(Proposal storage p, uint256 stake, bool inFavor, bool isProposer) internal view returns (uint256) {
        if (p.status == ProposalStatus.CANCELLED) return 0;
        
        bool proposalPassed = p.status == ProposalStatus.EXECUTED;
        bool won = isProposer ? proposalPassed : ((inFavor && proposalPassed) || (!inFavor && !proposalPassed));
        
        if (!won) return 0;

        uint256 losingPool = proposalPassed ? p.againstStake : (p.forStake + p.stake);
        uint256 winningPool = proposalPassed ? (p.forStake + p.stake) : p.againstStake;
        
        if (winningPool == 0) return stake;
        
        uint256 distributablePool = losingPool - (losingPool * PROTOCOL_FEE_BPS) / 10000;
        return stake + (distributablePool * WINNER_SHARE_BPS * stake) / (winningPool * 10000);
    }

    function getAggregatedReputation(uint256 agentId) external view returns (uint256 weightedScore, uint256[] memory providerScores, uint256[] memory providerWeights) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            ReputationProvider storage p = providers[providerList[i]];
            if (p.isActive && !p.isSuspended) activeCount++;
        }

        providerScores = new uint256[](activeCount);
        providerWeights = new uint256[](activeCount);
        uint256 totalWeightedScore = 0;
        uint256 idx = 0;

        for (uint256 i = 0; i < providerList.length; i++) {
            ReputationProvider storage p = providers[providerList[i]];
            if (!p.isActive || p.isSuspended) continue;

            uint256 score = _getProviderScore(p.providerContract, agentId);
            uint256 normalizedWeight = totalWeight > 0 ? (p.weight * 10000) / totalWeight : 10000 / activeCount;
            
            providerScores[idx] = score;
            providerWeights[idx] = normalizedWeight;
            totalWeightedScore += score * normalizedWeight;
            idx++;
        }

        weightedScore = totalWeightedScore / 10000;
        if (weightedScore > 10000) weightedScore = 10000;
    }

    function _getProviderScore(address provider, uint256 agentId) internal view returns (uint256) {
        (bool success, bytes memory data) = provider.staticcall(abi.encodeWithSignature("getReputationScore(uint256)", agentId));
        if (success && data.length >= 32) {
            uint256 score = abi.decode(data, (uint256));
            return score > 10000 ? 10000 : score;
        }
        return 5000;
    }

    function recordProviderFeedback(address provider, uint256 agentId, uint8 score) external {
        ReputationProvider storage p = providers[provider];
        if (p.addedAt == 0) return;
        p.totalFeedbackCount++;
        p.lastFeedbackAt = block.timestamp;
        emit ProviderFeedbackRecorded(provider, agentId, score);
    }

    function getProvider(address providerContract) external view returns (ReputationProvider memory) {
        return providers[providerContract];
    }

    function getAllProviders() external view returns (address[] memory) {
        return providerList;
    }

    function getActiveProviders() external view returns (address[] memory activeProviders) {
        uint256 count = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) count++;
        }
        activeProviders = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < providerList.length; i++) {
            if (providers[providerList[i]].isActive && !providers[providerList[i]].isSuspended) {
                activeProviders[idx++] = providerList[i];
            }
        }
    }

    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getProposalVotes(bytes32 proposalId) external view returns (Vote[] memory) {
        return proposalVotes[proposalId];
    }

    function getProposalOpinions(bytes32 proposalId) external view returns (Opinion[] memory) {
        return proposalOpinions[proposalId];
    }

    function getAllProposals() external view returns (bytes32[] memory) {
        return allProposalIds;
    }

    function isQuorumReached(bytes32 proposalId) external view returns (bool reached, uint256 currentStake, uint256 currentVoters) {
        Proposal storage p = proposals[proposalId];
        currentStake = p.forStake + p.againstStake;
        currentVoters = p.forCount + p.againstCount;
        reached = currentStake >= MIN_QUORUM_STAKE && currentVoters >= MIN_QUORUM_VOTERS;
    }

    function getClaimableAmount(bytes32 proposalId, address user) external view returns (uint256 total) {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.EXECUTED && p.status != ProposalStatus.REJECTED && p.status != ProposalStatus.CANCELLED) {
            return 0;
        }

        if (user == p.proposer && !p.proposerClaimed) {
            total += _calculateStakeClaim(p, p.stake, true, true);
        }
        if (hasVoted[proposalId][user]) {
            Vote storage v = proposalVotes[proposalId][userVoteIndex[proposalId][user]];
            if (!v.claimed) total += _calculateStakeClaim(p, v.stake, v.inFavor, false);
        }
        if (hasOpined[proposalId][user]) {
            Opinion storage o = proposalOpinions[proposalId][userOpinionIndex[proposalId][user]];
            if (!o.claimed && o.stake > 0) total += _calculateStakeClaim(p, o.stake, o.inFavor, false);
        }
    }

    function initializeProvider(address providerContract, string calldata name, string calldata description, uint256 weight) external onlyOwner {
        if (providers[providerContract].addedAt != 0) revert ProviderExists();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        _addProvider(providerContract, name, description, weight);
    }

    function setCouncilGovernance(address _councilGovernance) external onlyOwner {
        emit CouncilGovernanceUpdated(councilGovernance, _councilGovernance);
        councilGovernance = _councilGovernance;
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

    function emergencyRejectProposal(bytes32 proposalId, string calldata reason) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.status != ProposalStatus.COUNCIL_REVIEW) revert ProposalNotInReview();
        require(block.timestamp > p.challengeEnds + 30 days, "Not stuck long enough");
        ProposalStatus oldStatus = p.status;
        p.status = ProposalStatus.REJECTED;
        p.councilReason = reason;
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.REJECTED);
    }

    function version() external pure returns (string memory) { return "2.0.0"; }

    receive() external payable {}
}
