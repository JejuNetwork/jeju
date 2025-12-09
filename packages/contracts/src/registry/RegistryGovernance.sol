// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IdentityRegistry.sol";

interface IPredimarket {
    function createMarket(bytes32 sessionId, string memory question, uint256 liquidityParameter) external;
    function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice);
    function getMarket(bytes32 sessionId)
        external
        view
        returns (
            bytes32 id,
            string memory question,
            uint256 yesShares,
            uint256 noShares,
            uint256 liquidityParameter,
            uint256 totalVolume,
            uint256 createdAt,
            bool resolved,
            bool outcome
        );
}

/**
 * @title RegistryGovernance
 * @author Jeju Network
 * @notice Futarchy-based governance for IdentityRegistry
 * @dev Uses prediction markets to govern agent banning and slashing decisions
 *
 * How it works:
 * 1. Anyone can propose ban/slash for an agent (requires proposal bond)
 * 2. Creates two conditional prediction markets:
 *    - Market A: "Network quality improves IF we ban Agent X"
 *    - Market B: "Network quality improves IF we don't ban Agent X"
 * 3. Community (+ guardians with weighted votes) trades on markets
 * 4. Execute if Market A > Market B + confidence threshold
 * 5. Multi-sig approval + timelock for safety
 * 6. Appeals mechanism for unfair decisions
 *
 * Security:
 * - 7-day voting period
 * - 7-day timelock after voting
 * - Multi-sig approval (1/1 localnet, 2/3 testnet, 3/5 mainnet)
 * - Proposal bonds discourage spam
 * - Appeal mechanism prevents false positives
 * - Guardian system for rapid response
 *
 * @custom:security-contact security@jeju.network
 */
contract RegistryGovernance is Ownable, Pausable, ReentrancyGuard {
    // ============ Enums ============

    enum ProposalType {
        BAN_AGENT, // Permanent ban + slash entire stake
        SLASH_STAKE, // Slash percentage but don't ban
        UPDATE_GUARDIAN // Add/remove guardian

    }

    enum ProposalStatus {
        PENDING, // Voting in progress
        PASSED, // Market confidence met, awaiting execution
        EXECUTED, // Executed successfully
        REJECTED, // Market confidence not met
        VETOED, // Vetoed by multi-sig
        APPEALED // Under appeal review

    }

    enum Environment {
        LOCALNET, // 1/1 multi-sig
        TESTNET, // 2/3 multi-sig
        MAINNET // 3/5 multi-sig

    }

    // ============ Structs ============

    struct GovernanceProposal {
        bytes32 proposalId;
        ProposalType proposalType;
        uint256 targetAgentId;
        address proposer;
        uint256 proposalBond;
        uint256 slashPercentageBPS; // For SLASH_STAKE type
        bytes32 yesMarketId; // "Quality improves IF we take action"
        bytes32 noMarketId; // "Quality improves IF we don't take action"
        uint256 createdAt;
        uint256 votingEnds;
        uint256 executeAfter; // Timelock
        ProposalStatus status;
        string reason;
        // Multi-sig approvals
        address[] approvers;
        mapping(address => bool) hasApproved;
        uint256 approvalCount;
    }

    struct Guardian {
        address guardian;
        uint256 agentId; // Must be HIGH tier staker
        uint256 votingWeight; // Multiplier for market participation
        uint256 appointedAt;
        uint256 performanceScore; // 0-10000
        bool isActive;
    }

    struct Appeal {
        uint256 agentId;
        bytes32 proposalId;
        address appellant;
        string evidence; // IPFS hash
        uint256 appealBond;
        uint256 appealedAt;
        bool reviewed;
        bool approved;
        address[] guardianVotes;
        mapping(address => bool) hasVoted;
        uint256 approveCount;
    }

    struct MultiSigConfig {
        uint256 threshold;
        uint256 total;
        address[] signers;
        mapping(address => bool) isSigner;
    }

    // ============ State Variables ============

    IdentityRegistry public immutable registry;
    IPredimarket public immutable predimarket;

    Environment public currentEnvironment;
    MultiSigConfig internal _multiSigConfig;

    mapping(bytes32 => GovernanceProposal) public proposals;
    bytes32[] public allProposalIds;

    mapping(address => Guardian) public guardians;
    address[] public allGuardians;

    mapping(bytes32 => Appeal) public appeals;
    bytes32[] public allAppealIds;

    // Proposal tracking per agent
    mapping(uint256 => bytes32[]) public agentProposals;

    // Parameters
    uint256 public votingPeriod = 7 days;
    uint256 public timelockPeriod = 7 days;
    uint256 public confidenceThreshold = 1000; // 10% difference required
    uint256 public proposalBond = 0.01 ether;
    uint256 public appealBond = 0.05 ether;
    uint256 public defaultLiquidity = 1000 ether;
    uint256 public guardianVotingWeight = 3; // 3x multiplier

    // Treasury addresses for slash redistribution
    address public treasury;
    address public guardianRewardPool;

    // ============ Events ============

    event ProposalCreated(
        bytes32 indexed proposalId,
        ProposalType proposalType,
        uint256 indexed targetAgentId,
        address indexed proposer,
        bytes32 yesMarketId,
        bytes32 noMarketId
    );
    event ProposalStatusChanged(bytes32 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event ProposalExecuted(bytes32 indexed proposalId, uint256 targetAgentId);
    event ProposalRejected(bytes32 indexed proposalId, string reason);
    event ProposalVetoed(bytes32 indexed proposalId, address indexed vetoer);
    event ProposalApproved(bytes32 indexed proposalId, address indexed approver, uint256 approvalCount);

    event GuardianAdded(address indexed guardian, uint256 indexed agentId);
    event GuardianRemoved(address indexed guardian);
    event GuardianWeightUpdated(address indexed guardian, uint256 oldWeight, uint256 newWeight);

    event AppealSubmitted(
        bytes32 indexed appealId, uint256 indexed agentId, bytes32 indexed proposalId, address appellant
    );
    event AppealReviewed(bytes32 indexed appealId, bool approved);
    event AppealVoted(bytes32 indexed appealId, address indexed guardian, bool approve);

    event EnvironmentUpdated(Environment oldEnv, Environment newEnv);
    event MultiSigUpdated(uint256 threshold, uint256 total);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ============ Errors ============

    error ProposalNotFound();
    error ProposalNotPending();
    error ProposalNotReady();
    error VotingNotEnded();
    error NotGuardian();
    error AppealNotFound();
    error AlreadyVoted();
    error NotMultiSigSigner();
    error AlreadyApproved();

    // ============ Constructor ============

    constructor(
        address payable _registry,
        address _predimarket,
        address _treasury,
        Environment _environment,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        require(_predimarket != address(0), "Invalid predimarket");
        require(_treasury != address(0), "Invalid treasury");

        registry = IdentityRegistry(_registry);
        predimarket = IPredimarket(_predimarket);
        treasury = _treasury;
        guardianRewardPool = _treasury; // Initially same as treasury
        currentEnvironment = _environment;

        // Setup multi-sig based on environment
        _setupMultiSig(_environment, initialOwner);
    }

    // ============ Proposal Creation ============

    /**
     * @notice Create a ban proposal for an agent
     * @param agentId Target agent ID
     * @param reason Reason for ban
     * @return proposalId Proposal ID
     */
    function proposeBan(uint256 agentId, string calldata reason)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 proposalId)
    {
        require(registry.agentExists(agentId), "Agent does not exist");
        require(msg.value >= proposalBond, "Insufficient bond");
        require(bytes(reason).length > 0, "Reason required");

        proposalId = _createProposal(
            ProposalType.BAN_AGENT,
            agentId,
            10000, // 100% slash on ban
            reason
        );
    }

    /**
     * @notice Create a slash proposal for an agent
     * @param agentId Target agent ID
     * @param slashPercentageBPS Percentage to slash (10000 = 100%)
     * @param reason Reason for slash
     * @return proposalId Proposal ID
     */
    function proposeSlash(uint256 agentId, uint256 slashPercentageBPS, string calldata reason)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 proposalId)
    {
        require(registry.agentExists(agentId), "Agent does not exist");
        require(msg.value >= proposalBond, "Insufficient bond");
        require(slashPercentageBPS > 0 && slashPercentageBPS <= 10000, "Invalid slash percentage");
        require(bytes(reason).length > 0, "Reason required");

        proposalId = _createProposal(ProposalType.SLASH_STAKE, agentId, slashPercentageBPS, reason);
    }

    /**
     * @dev Internal proposal creation
     */
    function _createProposal(
        ProposalType proposalType,
        uint256 agentId,
        uint256 slashPercentageBPS,
        string memory reason
    ) internal returns (bytes32 proposalId) {
        proposalId = keccak256(abi.encodePacked(proposalType, agentId, msg.sender, block.timestamp));

        // Create conditional markets
        string memory actionText = proposalType == ProposalType.BAN_AGENT ? "ban" : "slash";

        bytes32 yesMarketId = bytes32(uint256(uint160(address(this))) | uint256(proposalId) | 1);
        bytes32 noMarketId = bytes32(uint256(uint160(address(this))) | uint256(proposalId) | 2);

        predimarket.createMarket(
            yesMarketId,
            string(abi.encodePacked("Network quality improves IF we ", actionText, " Agent #", _uint2str(agentId))),
            defaultLiquidity
        );

        predimarket.createMarket(
            noMarketId,
            string(
                abi.encodePacked("Network quality improves IF we DON'T ", actionText, " Agent #", _uint2str(agentId))
            ),
            defaultLiquidity
        );

        // Store proposal
        GovernanceProposal storage proposal = proposals[proposalId];
        proposal.proposalId = proposalId;
        proposal.proposalType = proposalType;
        proposal.targetAgentId = agentId;
        proposal.proposer = msg.sender;
        proposal.proposalBond = msg.value;
        proposal.slashPercentageBPS = slashPercentageBPS;
        proposal.yesMarketId = yesMarketId;
        proposal.noMarketId = noMarketId;
        proposal.createdAt = block.timestamp;
        proposal.votingEnds = block.timestamp + votingPeriod;
        proposal.executeAfter = block.timestamp + votingPeriod + timelockPeriod;
        proposal.status = ProposalStatus.PENDING;
        proposal.reason = reason;

        allProposalIds.push(proposalId);
        agentProposals[agentId].push(proposalId);

        emit ProposalCreated(proposalId, proposalType, agentId, msg.sender, yesMarketId, noMarketId);
    }

    // ============ Proposal Execution ============

    /**
     * @notice Execute proposal if conditions met
     * @param proposalId Proposal ID
     */
    function executeProposal(bytes32 proposalId) external nonReentrant {
        GovernanceProposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.PENDING) revert ProposalNotPending();

        // Check voting period ended
        if (block.timestamp < proposal.votingEnds) revert VotingNotEnded();

        // Check market confidence
        (uint256 yesPrice, uint256 noPrice) = predimarket.getMarketPrices(proposal.yesMarketId);

        if (yesPrice > noPrice + confidenceThreshold) {
            // Market shows confidence in action
            proposal.status = ProposalStatus.PASSED;
            emit ProposalStatusChanged(proposalId, ProposalStatus.PENDING, ProposalStatus.PASSED);
        } else {
            // Market doesn't show confidence
            // CEI PATTERN: State changes BEFORE external calls
            proposal.status = ProposalStatus.REJECTED;
            emit ProposalRejected(proposalId, "Insufficient market confidence");
            emit ProposalStatusChanged(proposalId, ProposalStatus.PENDING, ProposalStatus.REJECTED);

            // External call LAST (reentrancy safe)
            (bool success,) = proposal.proposer.call{value: proposal.proposalBond}("");
            require(success, "Bond refund failed");
        }
    }

    /**
     * @notice Approve proposal (multi-sig signer only)
     * @param proposalId Proposal ID
     */
    function approveProposal(bytes32 proposalId) external {
        if (!_multiSigConfig.isSigner[msg.sender]) revert NotMultiSigSigner();

        GovernanceProposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.PASSED) revert ProposalNotReady();
        if (proposal.hasApproved[msg.sender]) revert AlreadyApproved();

        proposal.hasApproved[msg.sender] = true;
        proposal.approvers.push(msg.sender);
        proposal.approvalCount++;

        emit ProposalApproved(proposalId, msg.sender, proposal.approvalCount);

        // Execute if threshold met and timelock expired
        if (proposal.approvalCount >= _multiSigConfig.threshold && block.timestamp >= proposal.executeAfter) {
            _executeProposal(proposal);
        }
    }

    /**
     * @dev Internal execution after approvals
     * @custom:security CEI pattern: Update all state before external calls
     */
    function _executeProposal(GovernanceProposal storage proposal) internal {
        IdentityRegistry.AgentRegistration memory agent = registry.getAgent(proposal.targetAgentId);

        // Cache values before state changes
        ProposalType proposalType = proposal.proposalType;
        uint256 targetAgentId = proposal.targetAgentId;
        uint256 slashPercentageBPS = proposal.slashPercentageBPS;
        string memory reason = proposal.reason;
        address proposer = proposal.proposer;
        uint256 bondAmount = proposal.proposalBond;
        bytes32 proposalId = proposal.proposalId;

        // EFFECTS: Update state FIRST (CEI pattern)
        proposal.status = ProposalStatus.EXECUTED;

        // Emit events before external calls
        emit ProposalStatusChanged(proposalId, ProposalStatus.PASSED, ProposalStatus.EXECUTED);
        emit ProposalExecuted(proposalId, targetAgentId);

        // INTERACTIONS: All external calls LAST
        if (proposalType == ProposalType.BAN_AGENT) {
            // Ban and slash
            registry.banAgent(targetAgentId, reason);

            if (agent.stakedAmount > 0) {
                // Redistribute: 50% treasury, 30% proposer, 20% guardians
                address[] memory recipients = new address[](3);
                uint256[] memory percentages = new uint256[](3);

                recipients[0] = treasury;
                recipients[1] = proposer;
                recipients[2] = guardianRewardPool;

                percentages[0] = 5000; // 50%
                percentages[1] = 3000; // 30%
                percentages[2] = 2000; // 20%

                registry.slashAgent(targetAgentId, slashPercentageBPS, reason, recipients, percentages);
            }
        } else if (proposalType == ProposalType.SLASH_STAKE) {
            // Slash only
            if (agent.stakedAmount > 0) {
                address[] memory recipients = new address[](3);
                uint256[] memory percentages = new uint256[](3);

                recipients[0] = treasury;
                recipients[1] = proposer;
                recipients[2] = guardianRewardPool;

                percentages[0] = 5000;
                percentages[1] = 3000;
                percentages[2] = 2000;

                registry.slashAgent(targetAgentId, slashPercentageBPS, reason, recipients, percentages);
            }
        }

        // Refund bond LAST
        (bool success,) = proposer.call{value: bondAmount}("");
        require(success, "Bond refund failed");
    }

    /**
     * @notice Veto proposal (owner only, emergency)
     * @param proposalId Proposal ID
     */
    function vetoProposal(bytes32 proposalId) external onlyOwner {
        GovernanceProposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.PENDING && proposal.status != ProposalStatus.PASSED) {
            revert ProposalNotReady();
        }

        // CEI PATTERN: State changes BEFORE external calls
        ProposalStatus oldStatus = proposal.status;
        proposal.status = ProposalStatus.VETOED;
        emit ProposalVetoed(proposalId, msg.sender);
        emit ProposalStatusChanged(proposalId, oldStatus, ProposalStatus.VETOED);

        // External call LAST (reentrancy safe)
        (bool success,) = proposal.proposer.call{value: proposal.proposalBond}("");
        require(success, "Bond refund failed");
    }

    // ============ Guardian Management ============

    /**
     * @notice Add a guardian (owner only)
     * @param guardian Guardian address
     * @param agentId Guardian's agent ID (must be HIGH tier)
     */
    function addGuardian(address guardian, uint256 agentId) external onlyOwner {
        require(!guardians[guardian].isActive, "Already guardian");

        IdentityRegistry.AgentRegistration memory agent = registry.getAgent(agentId);
        require(agent.owner == guardian, "Not agent owner");
        require(agent.tier == IdentityRegistry.StakeTier.HIGH, "Must be HIGH tier");
        require(!agent.isBanned, "Agent banned");

        guardians[guardian] = Guardian({
            guardian: guardian,
            agentId: agentId,
            votingWeight: guardianVotingWeight,
            appointedAt: block.timestamp,
            performanceScore: 10000, // Start at 100%
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

        // Remove from array (gas optimized)
        uint256 length = allGuardians.length;
        for (uint256 i = 0; i < length; i++) {
            if (allGuardians[i] == guardian) {
                allGuardians[i] = allGuardians[length - 1];
                allGuardians.pop();
                break;
            }
        }

        emit GuardianRemoved(guardian);
    }

    // ============ Appeal System ============

    /**
     * @notice Submit appeal for ban
     * @param proposalId Proposal that resulted in ban
     * @param evidence IPFS hash of evidence
     * @return appealId Appeal ID
     */
    function submitAppeal(bytes32 proposalId, string calldata evidence)
        external
        payable
        nonReentrant
        returns (bytes32 appealId)
    {
        GovernanceProposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.EXECUTED) revert ProposalNotFound();

        IdentityRegistry.AgentRegistration memory agent = registry.getAgent(proposal.targetAgentId);
        require(msg.sender == agent.owner, "Not agent owner");
        require(msg.value >= appealBond, "Insufficient bond");
        require(block.timestamp < proposal.executeAfter + 7 days, "Appeal period expired");

        appealId = keccak256(abi.encodePacked(proposalId, msg.sender, block.timestamp));

        Appeal storage appeal = appeals[appealId];
        appeal.agentId = proposal.targetAgentId;
        appeal.proposalId = proposalId;
        appeal.appellant = msg.sender;
        appeal.evidence = evidence;
        appeal.appealBond = msg.value;
        appeal.appealedAt = block.timestamp;
        appeal.reviewed = false;
        appeal.approved = false;

        allAppealIds.push(appealId);

        // Update proposal status
        proposal.status = ProposalStatus.APPEALED;
        emit ProposalStatusChanged(proposalId, ProposalStatus.EXECUTED, ProposalStatus.APPEALED);

        emit AppealSubmitted(appealId, proposal.targetAgentId, proposalId, msg.sender);
    }

    /**
     * @notice Vote on appeal (guardian only)
     * @param appealId Appeal ID
     * @param approve Whether to approve appeal
     */
    function voteOnAppeal(bytes32 appealId, bool approve) external {
        if (!guardians[msg.sender].isActive) revert NotGuardian();

        Appeal storage appeal = appeals[appealId];
        if (appeal.reviewed) revert AppealNotFound();
        if (appeal.hasVoted[msg.sender]) revert AlreadyVoted();

        appeal.hasVoted[msg.sender] = true;
        appeal.guardianVotes.push(msg.sender);

        if (approve) {
            appeal.approveCount++;
        }

        emit AppealVoted(appealId, msg.sender, approve);

        // Execute if 2/3 guardians voted
        if (appeal.guardianVotes.length >= (allGuardians.length * 2) / 3) {
            _executeAppeal(appeal);
        }
    }

    /**
     * @dev Execute appeal decision
     */
    function _executeAppeal(Appeal storage appeal) internal {
        // CEI PATTERN: State changes BEFORE external calls
        appeal.reviewed = true;

        // Require 2/3 approval
        bool approved = appeal.approveCount >= (allGuardians.length * 2) / 3;
        appeal.approved = approved;

        if (approved) {
            // Update ALL state first
            GovernanceProposal storage proposal = proposals[appeal.proposalId];
            proposal.status = ProposalStatus.REJECTED;
            emit ProposalStatusChanged(appeal.proposalId, ProposalStatus.APPEALED, ProposalStatus.REJECTED);

            // Then external calls (reentrancy safe)
            registry.unbanAgent(appeal.agentId);

            // Refund appeal bond LAST
            (bool success,) = appeal.appellant.call{value: appeal.appealBond}("");
            require(success, "Bond refund failed");
        }

        emit AppealReviewed(appeal.proposalId, approved);
    }

    // ============ Multi-Sig Management ============

    /**
     * @dev Setup multi-sig based on environment
     */
    function _setupMultiSig(Environment env, address admin) internal {
        if (env == Environment.LOCALNET) {
            _multiSigConfig.threshold = 1;
            _multiSigConfig.total = 1;
            _multiSigConfig.signers = [admin];
            _multiSigConfig.isSigner[admin] = true;
        } else if (env == Environment.TESTNET) {
            _multiSigConfig.threshold = 2;
            _multiSigConfig.total = 3;
            _multiSigConfig.signers = [admin];
            _multiSigConfig.isSigner[admin] = true;
        } else if (env == Environment.MAINNET) {
            _multiSigConfig.threshold = 3;
            _multiSigConfig.total = 5;
            _multiSigConfig.signers = [admin];
            _multiSigConfig.isSigner[admin] = true;
        }

        emit MultiSigUpdated(_multiSigConfig.threshold, _multiSigConfig.total);
    }

    /**
     * @notice Add multi-sig signer (owner only)
     * @param signer Signer address
     */
    function addSigner(address signer) external onlyOwner {
        require(!_multiSigConfig.isSigner[signer], "Already signer");
        require(_multiSigConfig.signers.length < _multiSigConfig.total, "Max signers reached");

        _multiSigConfig.signers.push(signer);
        _multiSigConfig.isSigner[signer] = true;

        emit MultiSigUpdated(_multiSigConfig.threshold, _multiSigConfig.total);
    }

    /**
     * @notice Remove multi-sig signer (owner only)
     * @param signer Signer address
     */
    function removeSigner(address signer) external onlyOwner {
        require(_multiSigConfig.isSigner[signer], "Not signer");

        _multiSigConfig.isSigner[signer] = false;

        for (uint256 i = 0; i < _multiSigConfig.signers.length; i++) {
            if (_multiSigConfig.signers[i] == signer) {
                _multiSigConfig.signers[i] = _multiSigConfig.signers[_multiSigConfig.signers.length - 1];
                _multiSigConfig.signers.pop();
                break;
            }
        }

        emit MultiSigUpdated(_multiSigConfig.threshold, _multiSigConfig.total);
    }

    // ============ Parameter Management ============

    function setVotingPeriod(uint256 newPeriod) external onlyOwner {
        votingPeriod = newPeriod;
    }

    function setTimelockPeriod(uint256 newPeriod) external onlyOwner {
        timelockPeriod = newPeriod;
    }

    function setConfidenceThreshold(uint256 newThreshold) external onlyOwner {
        confidenceThreshold = newThreshold;
    }

    function setProposalBond(uint256 newBond) external onlyOwner {
        proposalBond = newBond;
    }

    function setAppealBond(uint256 newBond) external onlyOwner {
        appealBond = newBond;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setGuardianRewardPool(address newPool) external onlyOwner {
        require(newPool != address(0), "Invalid pool");
        guardianRewardPool = newPool;
    }

    function setEnvironment(Environment newEnv) external onlyOwner {
        Environment oldEnv = currentEnvironment;
        currentEnvironment = newEnv;
        emit EnvironmentUpdated(oldEnv, newEnv);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    function getProposal(bytes32 proposalId)
        external
        view
        returns (
            ProposalType proposalType,
            uint256 targetAgentId,
            address proposer,
            ProposalStatus status,
            uint256 approvalCount,
            uint256 votingEnds,
            uint256 executeAfter,
            string memory reason
        )
    {
        GovernanceProposal storage p = proposals[proposalId];
        return (
            p.proposalType,
            p.targetAgentId,
            p.proposer,
            p.status,
            p.approvalCount,
            p.votingEnds,
            p.executeAfter,
            p.reason
        );
    }

    function getMultiSigConfig() external view returns (uint256 threshold, uint256 total, address[] memory signers) {
        return (_multiSigConfig.threshold, _multiSigConfig.total, _multiSigConfig.signers);
    }

    function getAllGuardians() external view returns (address[] memory) {
        return allGuardians;
    }

    function getAgentProposals(uint256 agentId) external view returns (bytes32[] memory) {
        return agentProposals[agentId];
    }

    // ============ Internal Helpers ============

    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function version() external pure returns (string memory) {
        return "1.0.0-futarchy";
    }

    receive() external payable {}
}
