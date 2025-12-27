// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {NetworkRegistry} from "./NetworkRegistry.sol";
import {ICouncilGovernance} from "../governance/interfaces/ICouncilGovernance.sol";

/**
 * @title FederationGovernance
 * @author Jeju Network
 * @notice AI DAO-controlled governance for federation membership
 * @dev Prevents Sybil attacks on sequencer set through:
 *      1. Economic barriers (10 ETH stake)
 *      2. AI Autocrat evaluation
 *      3. Prediction market voting
 *      4. Guardian oversight
 *      5. Time-locked approval
 *
 * Flow for VERIFIED (sequencer-eligible) status:
 * 1. Network stakes 10+ ETH → auto-creates NetworkApprovalProposal
 * 2. AI agents evaluate: uptime, unique genesis, RPC health, operator reputation
 * 3. Prediction market: "Federation quality improves IF we approve Network X"
 * 4. If market confidence > threshold → moves to Autocrat review
 * 5. Autocrat (AI DAO) gives final approval
 * 6. 7-day timelock before VERIFIED status active
 * 7. Guardian monitoring can trigger re-evaluation
 *
 * Sybil Protection:
 * - Can't just spin up 10 fake chains and take over sequencer
 * - Each needs 10 ETH (100 ETH for 10 chains)
 * - Each needs AI approval (catches obvious fakes)
 * - Market prediction filters low-quality chains
 * - Guardians can challenge suspicious networks
 */
contract FederationGovernance is Ownable, ReentrancyGuard, Pausable {
    // ============ Enums ============

    enum ProposalStatus {
        PENDING_MARKET, // Prediction market voting
        MARKET_PASSED, // Market confidence met
        AUTOCRAT_REVIEW, // AI DAO reviewing
        APPROVED, // AI approved, in timelock
        ACTIVE, // Network is VERIFIED
        REJECTED, // Did not pass market or AI review
        CHALLENGED, // Under guardian review
        REVOKED // VERIFIED status revoked

    }

    enum ChallengeReason {
        SYBIL_SUSPECTED, // Multiple networks from same operator
        DOWNTIME, // Network unresponsive
        MALICIOUS_BEHAVIOR, // Evidence of malicious activity
        INVALID_GENESIS, // Genesis hash mismatch
        RPC_FAILURE, // RPC endpoints not working
        OTHER // Other reason with evidence

    }

    // ============ Structs ============

    struct NetworkProposal {
        bytes32 proposalId;
        uint256 chainId;
        address operator;
        uint256 stake;
        uint256 createdAt;
        uint256 marketVotingEnds;
        uint256 timelockEnds;
        ProposalStatus status;
        bytes32 marketId;
        // AI evaluation scores (0-100)
        uint8 uptimeScore;
        uint8 uniquenessScore;
        uint8 rpcHealthScore;
        uint8 operatorReputationScore;
        uint8 overallScore;
        // Autocrat decision
        bool autocratApproved;
        bytes32 autocratDecisionHash;
        string autocratReason;
        // Challenge tracking
        bool isChallenged;
        bytes32 challengeId;
    }

    struct Challenge {
        bytes32 challengeId;
        uint256 chainId;
        address challenger;
        ChallengeReason reason;
        string evidence; // IPFS hash
        uint256 challengeBond;
        uint256 createdAt;
        bool resolved;
        bool upheld;
        uint256 guardianVoteCount;
        uint256 guardianApproveCount;
        mapping(address => bool) guardianVoted;
    }

    struct Guardian {
        address guardian;
        uint256 agentId; // Must be VERIFIED network operator or HIGH tier staker
        uint256 votingPower;
        uint256 appointedAt;
        uint256 challengesReviewed;
        uint256 correctDecisions;
        bool isActive;
    }

    struct OperatorHistory {
        uint256[] chainIds;
        uint256 totalNetworks;
        uint256 approvedNetworks;
        uint256 rejectedNetworks;
        uint256 revokedNetworks;
        uint256 firstRegistration;
        bool isBanned;
        string banReason;
    }

    // ============ Constants ============

    uint256 public constant MIN_STAKE_FOR_PROPOSAL = 10 ether;
    uint256 public constant MARKET_VOTING_PERIOD = 7 days;
    uint256 public constant AUTOCRAT_REVIEW_PERIOD = 3 days;
    uint256 public constant TIMELOCK_PERIOD = 7 days;
    uint256 public constant CHALLENGE_BOND = 1 ether;
    uint256 public constant GUARDIAN_VOTE_THRESHOLD = 3; // Minimum votes to resolve
    uint256 public constant MAX_NETWORKS_PER_OPERATOR = 5; // Sybil limit

    // Confidence thresholds (basis points, 10000 = 100%)
    uint256 public constant MARKET_CONFIDENCE_THRESHOLD = 6000; // 60% yes
    uint256 public constant AI_SCORE_THRESHOLD = 70; // 70/100 overall score

    // ============ State Variables ============

    NetworkRegistry public immutable networkRegistry;
    ICouncilGovernance public councilGovernance;
    address public predictionMarket;
    address public aiOracle; // Oracle for AI evaluation scores

    mapping(bytes32 => NetworkProposal) public proposals;
    mapping(uint256 => bytes32) public chainIdToProposal;
    bytes32[] public allProposalIds;

    mapping(bytes32 => Challenge) internal _challenges;
    bytes32[] public allChallengeIds;

    mapping(address => Guardian) public guardians;
    address[] public allGuardians;

    mapping(address => OperatorHistory) public operatorHistories;

    // Treasury for slashed stakes and challenge bonds
    address public treasury;

    // Sequencer rotation tracking
    uint256[] public verifiedChainIds;
    mapping(uint256 => uint256) public chainIdToVerifiedIndex;
    uint256 public currentSequencerIndex;
    uint256 public lastRotation;
    uint256 public rotationInterval = 1 days;

    // ============ Events ============

    event ProposalCreated(bytes32 indexed proposalId, uint256 indexed chainId, address indexed operator, uint256 stake);
    event ProposalStatusChanged(bytes32 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event AIEvaluationReceived(
        bytes32 indexed proposalId,
        uint8 uptimeScore,
        uint8 uniquenessScore,
        uint8 rpcHealthScore,
        uint8 operatorReputationScore,
        uint8 overallScore
    );
    event AutocratDecision(bytes32 indexed proposalId, bool approved, bytes32 decisionHash, string reason);
    event NetworkVerified(uint256 indexed chainId, address indexed operator);
    event NetworkRevoked(uint256 indexed chainId, string reason);

    event ChallengeCreated(
        bytes32 indexed challengeId, uint256 indexed chainId, address indexed challenger, ChallengeReason reason
    );
    event ChallengeVoted(bytes32 indexed challengeId, address indexed guardian, bool upheld);
    event ChallengeResolved(bytes32 indexed challengeId, bool upheld);

    event GuardianAdded(address indexed guardian, uint256 agentId);
    event GuardianRemoved(address indexed guardian);

    event OperatorBanned(address indexed operator, string reason);
    event SequencerRotated(uint256 indexed oldChainId, uint256 indexed newChainId);

    // ============ Errors ============

    error ProposalNotFound();
    error ProposalNotReady();
    error InsufficientStake();
    error NetworkAlreadyProposed();
    error OperatorIsBanned();
    error TooManyNetworks();
    error ChallengeNotFound();
    error NotGuardian();
    error AlreadyVoted();
    error ChallengeBondRequired();
    error NotAIOracle();
    error NotAutocrat();
    error TimelockNotExpired();
    error InvalidChainId();
    error NotOperator();

    // ============ Modifiers ============

    modifier onlyAIOracle() {
        if (msg.sender != aiOracle) revert NotAIOracle();
        _;
    }

    modifier onlyGuardian() {
        if (!guardians[msg.sender].isActive) revert NotGuardian();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _networkRegistry,
        address _councilGovernance,
        address _predictionMarket,
        address _aiOracle,
        address _treasury
    ) Ownable(msg.sender) {
        networkRegistry = NetworkRegistry(payable(_networkRegistry));
        councilGovernance = ICouncilGovernance(_councilGovernance);
        predictionMarket = _predictionMarket;
        aiOracle = _aiOracle;
        treasury = _treasury;
    }

    // ============ Proposal Creation ============

    /**
     * @notice Called by NetworkRegistry when a network stakes enough for VERIFIED
     * @dev Auto-creates a governance proposal for AI DAO review
     * @param chainId The chain ID requesting VERIFIED status
     * @param operator The network operator address
     * @param stake Amount staked
     */
    function createNetworkProposal(uint256 chainId, address operator, uint256 stake)
        external
        returns (bytes32 proposalId)
    {
        // Only NetworkRegistry can create proposals
        require(msg.sender == address(networkRegistry), "Only NetworkRegistry");
        if (stake < MIN_STAKE_FOR_PROPOSAL) revert InsufficientStake();
        if (chainIdToProposal[chainId] != bytes32(0)) revert NetworkAlreadyProposed();

        // Check operator limits
        OperatorHistory storage history = operatorHistories[operator];
        if (history.isBanned) revert OperatorIsBanned();
        if (history.totalNetworks >= MAX_NETWORKS_PER_OPERATOR) revert TooManyNetworks();

        proposalId = keccak256(abi.encodePacked(chainId, operator, stake, block.timestamp));

        // Create prediction market for this network
        bytes32 marketId = _createPredictionMarket(chainId, operator);

        NetworkProposal storage proposal = proposals[proposalId];
        proposal.proposalId = proposalId;
        proposal.chainId = chainId;
        proposal.operator = operator;
        proposal.stake = stake;
        proposal.createdAt = block.timestamp;
        proposal.marketVotingEnds = block.timestamp + MARKET_VOTING_PERIOD;
        proposal.status = ProposalStatus.PENDING_MARKET;
        proposal.marketId = marketId;

        chainIdToProposal[chainId] = proposalId;
        allProposalIds.push(proposalId);

        // Update operator history
        history.chainIds.push(chainId);
        history.totalNetworks++;
        if (history.firstRegistration == 0) {
            history.firstRegistration = block.timestamp;
        }

        emit ProposalCreated(proposalId, chainId, operator, stake);
    }

    /**
     * @dev Creates a prediction market for network approval
     */
    function _createPredictionMarket(uint256 chainId, address operator) internal returns (bytes32 marketId) {
        // Market ID derived from chain
        marketId = keccak256(abi.encodePacked("NETWORK_APPROVAL", chainId, block.timestamp));

        // In production, this would call the prediction market contract
        // string memory question = string(abi.encodePacked(
        //     "Should network ", _uint2str(chainId), " from ", _addr2str(operator),
        //     " be granted VERIFIED (sequencer) status?"
        // ));
        // IPredictionMarket(predictionMarket).createMarket(marketId, question, defaultLiquidity);
    }

    // ============ AI Evaluation ============

    /**
     * @notice Submit AI evaluation scores for a network proposal
     * @dev Called by AI Oracle after evaluating the network
     * @param proposalId The proposal to evaluate
     * @param uptimeScore Network uptime score (0-100)
     * @param uniquenessScore Genesis/chain uniqueness score (0-100)
     * @param rpcHealthScore RPC endpoint health score (0-100)
     * @param operatorReputationScore Operator on-chain history score (0-100)
     */
    function submitAIEvaluation(
        bytes32 proposalId,
        uint8 uptimeScore,
        uint8 uniquenessScore,
        uint8 rpcHealthScore,
        uint8 operatorReputationScore
    ) external onlyAIOracle {
        NetworkProposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();

        proposal.uptimeScore = uptimeScore;
        proposal.uniquenessScore = uniquenessScore;
        proposal.rpcHealthScore = rpcHealthScore;
        proposal.operatorReputationScore = operatorReputationScore;

        // Calculate overall score (weighted average)
        proposal.overallScore = uint8(
            (
                uint256(uptimeScore) * 30 + uint256(uniquenessScore) * 25 + uint256(rpcHealthScore) * 25
                    + uint256(operatorReputationScore) * 20
            ) / 100
        );

        emit AIEvaluationReceived(
            proposalId, uptimeScore, uniquenessScore, rpcHealthScore, operatorReputationScore, proposal.overallScore
        );
    }

    // ============ Market Resolution ============

    /**
     * @notice Resolve market voting and move to next stage
     * @param proposalId The proposal to resolve
     */
    function resolveMarketVoting(bytes32 proposalId) external nonReentrant {
        NetworkProposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.PENDING_MARKET) revert ProposalNotReady();
        require(block.timestamp >= proposal.marketVotingEnds, "Voting not ended");

        // Get market result (in production, from prediction market contract)
        uint256 yesPercentage = _getMarketResult(proposal.marketId);

        if (yesPercentage >= MARKET_CONFIDENCE_THRESHOLD && proposal.overallScore >= AI_SCORE_THRESHOLD) {
            // Passed market and AI threshold → move to Autocrat review
            proposal.status = ProposalStatus.AUTOCRAT_REVIEW;
            emit ProposalStatusChanged(proposalId, ProposalStatus.PENDING_MARKET, ProposalStatus.AUTOCRAT_REVIEW);

            // Create Council governance proposal for Autocrat
            _createAutocratProposal(proposalId);
        } else {
            // Failed → reject and potentially refund
            _rejectProposal(proposal, "Market confidence or AI score too low");
        }
    }

    /**
     * @dev Creates a Council governance proposal for Autocrat review
     */
    function _createAutocratProposal(bytes32 proposalId) internal {
        // In production, this would create a proposal in CouncilGovernance
        // for the AI Autocrat to review and approve
    }

    /**
     * @dev Get market voting result - uses TWAP when available, falls back to instant price
     */
    function _getMarketResult(bytes32 marketId) internal view returns (uint256) {
        if (predictionMarket == address(0)) {
            // Fallback for testing only
            return 7000;
        }

        // Try TWAP first: getTWAPData(bytes32) returns (count, avgYes, avgNo, start, end, ready)
        (bool success, bytes memory data) =
            predictionMarket.staticcall(abi.encodeWithSignature("getTWAPData(bytes32)", marketId));

        if (success && data.length >= 192) {
            (uint256 count, uint256 avgYes, uint256 avgNo,,, bool ready) =
                abi.decode(data, (uint256, uint256, uint256, uint256, uint256, bool));

            if (ready && count >= 2) {
                uint256 total = avgYes + avgNo;
                if (total > 0) {
                    return (avgYes * 10000) / total;
                }
            }
        }

        // Fallback: instant price via getMarketPrices(bytes32)
        (success, data) = predictionMarket.staticcall(abi.encodeWithSignature("getMarketPrices(bytes32)", marketId));

        if (success && data.length >= 64) {
            (uint256 yesPrice, uint256 noPrice) = abi.decode(data, (uint256, uint256));
            uint256 total = yesPrice + noPrice;
            if (total > 0) {
                return (yesPrice * 10000) / total;
            }
        }

        return 5000; // Neutral if no market data
    }

    // ============ Autocrat Decision ============

    /**
     * @notice Submit Autocrat (AI DAO) decision on a network proposal
     * @dev Called by Council governance after Autocrat review
     * @param proposalId The proposal being decided
     * @param approved Whether the network is approved
     * @param decisionHash IPFS hash of full decision rationale
     * @param reason Brief reason for decision
     */
    function submitAutocratDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, string calldata reason)
        external
    {
        // Only Council governance can submit Autocrat decisions
        require(msg.sender == address(councilGovernance), "Only CouncilGovernance");

        NetworkProposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.AUTOCRAT_REVIEW) revert ProposalNotReady();

        proposal.autocratApproved = approved;
        proposal.autocratDecisionHash = decisionHash;
        proposal.autocratReason = reason;

        if (approved) {
            proposal.status = ProposalStatus.APPROVED;
            proposal.timelockEnds = block.timestamp + TIMELOCK_PERIOD;
            emit ProposalStatusChanged(proposalId, ProposalStatus.AUTOCRAT_REVIEW, ProposalStatus.APPROVED);
        } else {
            _rejectProposal(proposal, reason);
        }

        emit AutocratDecision(proposalId, approved, decisionHash, reason);
    }

    // ============ Execution ============

    /**
     * @notice Execute approved proposal after timelock
     * @param proposalId The proposal to execute
     */
    function executeProposal(bytes32 proposalId) external nonReentrant {
        NetworkProposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.APPROVED) revert ProposalNotReady();
        if (block.timestamp < proposal.timelockEnds) revert TimelockNotExpired();

        // Update status
        proposal.status = ProposalStatus.ACTIVE;
        emit ProposalStatusChanged(proposalId, ProposalStatus.APPROVED, ProposalStatus.ACTIVE);

        // Update NetworkRegistry to set VERIFIED status
        networkRegistry.setVerifiedByGovernance(proposal.chainId);

        // Add to verified chain list for sequencer rotation
        verifiedChainIds.push(proposal.chainId);
        chainIdToVerifiedIndex[proposal.chainId] = verifiedChainIds.length - 1;

        // Update operator history
        operatorHistories[proposal.operator].approvedNetworks++;

        emit NetworkVerified(proposal.chainId, proposal.operator);
    }

    /**
     * @dev Reject a proposal and update state
     */
    function _rejectProposal(NetworkProposal storage proposal, string memory reason) internal {
        ProposalStatus oldStatus = proposal.status;
        proposal.status = ProposalStatus.REJECTED;

        // Update operator history
        operatorHistories[proposal.operator].rejectedNetworks++;

        emit ProposalStatusChanged(proposal.proposalId, oldStatus, ProposalStatus.REJECTED);
    }

    // ============ Challenge System ============

    /**
     * @notice Challenge a verified network's status
     * @param chainId The chain ID to challenge
     * @param reason Reason for challenge
     * @param evidence IPFS hash of evidence
     */
    function challengeNetwork(uint256 chainId, ChallengeReason reason, string calldata evidence)
        external
        payable
        nonReentrant
        returns (bytes32 challengeId)
    {
        if (msg.value < CHALLENGE_BOND) revert ChallengeBondRequired();

        bytes32 proposalId = chainIdToProposal[chainId];
        if (proposalId == bytes32(0)) revert ProposalNotFound();

        NetworkProposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.ACTIVE) revert ProposalNotReady();

        challengeId = keccak256(abi.encodePacked(chainId, msg.sender, block.timestamp, reason));

        Challenge storage challenge = _challenges[challengeId];
        challenge.challengeId = challengeId;
        challenge.chainId = chainId;
        challenge.challenger = msg.sender;
        challenge.reason = reason;
        challenge.evidence = evidence;
        challenge.challengeBond = msg.value;
        challenge.createdAt = block.timestamp;

        proposal.isChallenged = true;
        proposal.challengeId = challengeId;
        proposal.status = ProposalStatus.CHALLENGED;

        allChallengeIds.push(challengeId);

        emit ChallengeCreated(challengeId, chainId, msg.sender, reason);
        emit ProposalStatusChanged(proposalId, ProposalStatus.ACTIVE, ProposalStatus.CHALLENGED);
    }

    /**
     * @notice Vote on a challenge (guardian only)
     * @param challengeId The challenge to vote on
     * @param upheld Whether to uphold the challenge (revoke network)
     */
    function voteOnChallenge(bytes32 challengeId, bool upheld) external onlyGuardian {
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.createdAt == 0) revert ChallengeNotFound();
        require(!challenge.resolved, "Already resolved");
        if (challenge.guardianVoted[msg.sender]) revert AlreadyVoted();

        challenge.guardianVoted[msg.sender] = true;
        challenge.guardianVoteCount++;
        if (upheld) {
            challenge.guardianApproveCount++;
        }

        // Update guardian stats
        guardians[msg.sender].challengesReviewed++;

        emit ChallengeVoted(challengeId, msg.sender, upheld);

        // Check if enough votes to resolve
        if (challenge.guardianVoteCount >= GUARDIAN_VOTE_THRESHOLD) {
            _resolveChallenge(challenge);
        }
    }

    /**
     * @dev Resolve a challenge after enough guardian votes
     */
    function _resolveChallenge(Challenge storage challenge) internal {
        challenge.resolved = true;

        // Upheld if majority of voters approve
        bool upheld = challenge.guardianApproveCount > challenge.guardianVoteCount / 2;
        challenge.upheld = upheld;

        bytes32 proposalId = chainIdToProposal[challenge.chainId];
        NetworkProposal storage proposal = proposals[proposalId];

        if (upheld) {
            // Revoke VERIFIED status
            proposal.status = ProposalStatus.REVOKED;

            // Remove from verified chains
            _removeFromVerifiedChains(challenge.chainId);

            // Update histories
            operatorHistories[proposal.operator].revokedNetworks++;

            // Reward challenger
            (bool success,) = challenge.challenger.call{value: challenge.challengeBond}("");
            require(success, "Reward transfer failed");

            // Slash network's stake (keep in registry for slashing)
            networkRegistry.revokeVerifiedStatus(challenge.chainId);

            emit NetworkRevoked(challenge.chainId, "Challenge upheld");
        } else {
            // Challenge rejected, restore network
            proposal.status = ProposalStatus.ACTIVE;
            proposal.isChallenged = false;

            // Forfeit challenger's bond to treasury
            (bool success,) = treasury.call{value: challenge.challengeBond}("");
            require(success, "Treasury transfer failed");
        }

        emit ChallengeResolved(challenge.challengeId, upheld);
        emit ProposalStatusChanged(proposalId, ProposalStatus.CHALLENGED, proposal.status);
    }

    /**
     * @dev Remove a chain from the verified list
     */
    function _removeFromVerifiedChains(uint256 chainId) internal {
        uint256 index = chainIdToVerifiedIndex[chainId];
        uint256 lastIndex = verifiedChainIds.length - 1;

        if (index != lastIndex) {
            uint256 lastChainId = verifiedChainIds[lastIndex];
            verifiedChainIds[index] = lastChainId;
            chainIdToVerifiedIndex[lastChainId] = index;
        }

        verifiedChainIds.pop();
        delete chainIdToVerifiedIndex[chainId];
    }

    // ============ Guardian Management ============

    /**
     * @notice Add a guardian (owner only)
     * @param guardian Guardian address
     * @param agentId Guardian's agent ID (must be from VERIFIED network or HIGH tier)
     */
    function addGuardian(address guardian, uint256 agentId) external onlyOwner {
        require(!guardians[guardian].isActive, "Already guardian");

        guardians[guardian] = Guardian({
            guardian: guardian,
            agentId: agentId,
            votingPower: 1,
            appointedAt: block.timestamp,
            challengesReviewed: 0,
            correctDecisions: 0,
            isActive: true
        });

        allGuardians.push(guardian);
        emit GuardianAdded(guardian, agentId);
    }

    /**
     * @notice Remove a guardian (owner only)
     * @param guardian Guardian address
     */
    function removeGuardian(address guardian) external onlyOwner {
        require(guardians[guardian].isActive, "Not guardian");
        guardians[guardian].isActive = false;

        // Remove from array
        for (uint256 i = 0; i < allGuardians.length; i++) {
            if (allGuardians[i] == guardian) {
                allGuardians[i] = allGuardians[allGuardians.length - 1];
                allGuardians.pop();
                break;
            }
        }

        emit GuardianRemoved(guardian);
    }

    // ============ Operator Management ============

    /**
     * @notice Ban an operator from creating more network proposals
     * @param operator Address to ban
     * @param reason Reason for ban
     */
    function banOperator(address operator, string calldata reason) external onlyOwner {
        OperatorHistory storage history = operatorHistories[operator];
        history.isBanned = true;
        history.banReason = reason;

        emit OperatorBanned(operator, reason);
    }

    // ============ Sequencer Rotation ============

    /**
     * @notice Rotate the current sequencer (called periodically)
     * @dev Uses round-robin across verified chains
     */
    function rotateSequencer() external {
        require(block.timestamp >= lastRotation + rotationInterval, "Too soon");
        require(verifiedChainIds.length > 0, "No verified chains");

        uint256 oldChainId =
            verifiedChainIds.length > currentSequencerIndex ? verifiedChainIds[currentSequencerIndex] : 0;

        currentSequencerIndex = (currentSequencerIndex + 1) % verifiedChainIds.length;
        uint256 newChainId = verifiedChainIds[currentSequencerIndex];

        lastRotation = block.timestamp;

        emit SequencerRotated(oldChainId, newChainId);
    }

    /**
     * @notice Get the current sequencer chain ID
     */
    function getCurrentSequencer() external view returns (uint256) {
        if (verifiedChainIds.length == 0) return 0;
        return verifiedChainIds[currentSequencerIndex];
    }

    /**
     * @notice Check if a chain is eligible to be sequencer
     */
    function isSequencerEligible(uint256 chainId) external view returns (bool) {
        bytes32 proposalId = chainIdToProposal[chainId];
        if (proposalId == bytes32(0)) return false;
        return proposals[proposalId].status == ProposalStatus.ACTIVE;
    }

    // ============ View Functions ============

    function getProposal(bytes32 proposalId)
        external
        view
        returns (
            uint256 chainId,
            address operator,
            uint256 stake,
            ProposalStatus status,
            uint8 overallScore,
            bool autocratApproved,
            uint256 timelockEnds
        )
    {
        NetworkProposal storage p = proposals[proposalId];
        return (p.chainId, p.operator, p.stake, p.status, p.overallScore, p.autocratApproved, p.timelockEnds);
    }

    function getChallenge(bytes32 challengeId)
        external
        view
        returns (
            uint256 chainId,
            address challenger,
            ChallengeReason reason,
            string memory evidence,
            uint256 challengeBond,
            bool resolved,
            bool upheld,
            uint256 voteCount,
            uint256 approveCount
        )
    {
        Challenge storage c = _challenges[challengeId];
        return (
            c.chainId,
            c.challenger,
            c.reason,
            c.evidence,
            c.challengeBond,
            c.resolved,
            c.upheld,
            c.guardianVoteCount,
            c.guardianApproveCount
        );
    }

    function getOperatorHistory(address operator)
        external
        view
        returns (
            uint256 totalNetworks,
            uint256 approvedNetworks,
            uint256 rejectedNetworks,
            uint256 revokedNetworks,
            bool isBanned
        )
    {
        OperatorHistory storage h = operatorHistories[operator];
        return (h.totalNetworks, h.approvedNetworks, h.rejectedNetworks, h.revokedNetworks, h.isBanned);
    }

    function getVerifiedChainIds() external view returns (uint256[] memory) {
        return verifiedChainIds;
    }

    function getAllGuardians() external view returns (address[] memory) {
        return allGuardians;
    }

    // ============ Admin Functions ============

    function setCouncilGovernance(address _councilGovernance) external onlyOwner {
        councilGovernance = ICouncilGovernance(_councilGovernance);
    }

    function setPredictionMarket(address _predictionMarket) external onlyOwner {
        predictionMarket = _predictionMarket;
    }

    function setAIOracle(address _aiOracle) external onlyOwner {
        aiOracle = _aiOracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function setRotationInterval(uint256 _interval) external onlyOwner {
        rotationInterval = _interval;
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

    receive() external payable {}
}
