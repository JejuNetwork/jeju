// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CouncilRegistryIntegration
 * @author Jeju Network
 * @notice Provides council agents with access to all ERC-8004 registry data
 * @dev Aggregates data from IdentityRegistry, ReputationRegistry, and ReputationProviders
 *      for use in council decision making. Calculates composite scores for:
 *      - Agent trustworthiness
 *      - Provider reputation and stake
 *      - Weighted voting power
 *      - Security council eligibility
 *
 * The AI DAO uses this contract to:
 * - Query agent data for proposal evaluation
 * - Calculate reputation-weighted votes
 * - Verify provider stakes before trusting their inputs
 * - Search and filter agents by various criteria
 *
 * @custom:security-contact security@jeju.network
 */
interface IIdentityRegistry {
    enum StakeTier {
        NONE,
        SMALL,
        MEDIUM,
        HIGH
    }

    struct AgentRegistration {
        uint256 agentId;
        address owner;
        StakeTier tier;
        address stakedToken;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isBanned;
        bool isSlashed;
    }

    function getAgent(uint256 agentId) external view returns (AgentRegistration memory);
    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
    function getA2AEndpoint(uint256 agentId) external view returns (string memory);
    function getMCPEndpoint(uint256 agentId) external view returns (string memory);
    function getAgentTags(uint256 agentId) external view returns (string[] memory);
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory);
    function getActiveAgents(uint256 offset, uint256 limit) external view returns (uint256[] memory);
    function totalAgents() external view returns (uint256);
}

interface IReputationRegistry {
    function getSummary(uint256 agentId, address[] calldata clients, bytes32 tag1, bytes32 tag2)
        external
        view
        returns (uint64 count, uint8 averageScore);
    function getClients(uint256 agentId) external view returns (address[] memory);
}

interface IReputationProvider {
    function getAgentViolationCount(uint256 agentId) external view returns (uint256);
    function getProviderAgentId() external view returns (uint256);
    function isAuthorizedOperator(address operator) external view returns (bool);
}

interface IStaking {
    function getStake(address staker) external view returns (uint256);
    function getStakeTime(address staker) external view returns (uint256);
}

contract CouncilRegistryIntegration is Ownable, ReentrancyGuard {
    // ============================================================================
    // State
    // ============================================================================

    IIdentityRegistry public identityRegistry;
    IReputationRegistry public reputationRegistry;
    address public stakingContract;

    /// @notice Registered reputation providers
    address[] public reputationProviders;
    mapping(address => bool) public isReputationProvider;

    /// @notice Provider reputation data cache
    mapping(address => ProviderReputation) public providerReputations;

    /// @notice Weights for composite score calculation (in basis points, total 10000)
    uint256 public stakeWeight = 3000; // 30%
    uint256 public reputationWeight = 4000; // 40%
    uint256 public activityWeight = 1500; // 15%
    uint256 public violationPenalty = 1500; // 15%

    /// @notice Minimum score for various actions
    uint256 public minScoreForProposal = 50;
    uint256 public minScoreForVoting = 30;
    uint256 public minScoreForResearch = 70;

    // ============================================================================
    // Structs
    // ============================================================================

    struct AgentProfile {
        uint256 agentId;
        address owner;
        uint8 stakeTier;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isBanned;
        uint64 feedbackCount;
        uint8 averageReputation;
        uint256 violationCount;
        uint256 compositeScore;
        string[] tags;
        string a2aEndpoint;
        string mcpEndpoint;
    }

    struct ProviderReputation {
        address provider;
        uint256 providerAgentId;
        uint256 stakeAmount;
        uint256 stakeTime;
        uint8 averageReputation;
        uint256 violationsReported;
        uint256 operatorCount;
        uint256 lastUpdated;
        uint256 weightedScore;
    }

    struct SearchResult {
        uint256[] agentIds;
        uint256 total;
        uint256 offset;
        uint256 limit;
    }

    struct VotingPower {
        uint256 baseVotes;
        uint256 reputationMultiplier; // 100 = 1x, 200 = 2x
        uint256 stakeMultiplier; // 100 = 1x, 200 = 2x
        uint256 effectiveVotes;
    }

    // ============================================================================
    // Events
    // ============================================================================

    event ReputationProviderAdded(address indexed provider, uint256 agentId);
    event ReputationProviderRemoved(address indexed provider);
    event ProviderReputationUpdated(address indexed provider, uint256 weightedScore);
    event WeightsUpdated(uint256 stake, uint256 reputation, uint256 activity, uint256 penalty);
    event MinScoresUpdated(uint256 proposal, uint256 voting, uint256 research);

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _identityRegistry, address _reputationRegistry, address _stakingContract, address initialOwner)
        Ownable(initialOwner)
    {
        require(_identityRegistry != address(0), "Invalid identity");
        require(_reputationRegistry != address(0), "Invalid reputation");

        identityRegistry = IIdentityRegistry(_identityRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        stakingContract = _stakingContract;
    }

    // ============================================================================
    // Agent Profile Queries
    // ============================================================================

    /**
     * @notice Get comprehensive profile for an agent
     * @param agentId Agent to query
     * @return profile Full profile with composite score
     */
    function getAgentProfile(uint256 agentId) external view returns (AgentProfile memory profile) {
        if (!identityRegistry.agentExists(agentId)) {
            return profile;
        }

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

        profile.agentId = agentId;
        profile.owner = agent.owner;
        profile.stakeTier = uint8(agent.tier);
        profile.stakedAmount = agent.stakedAmount;
        profile.registeredAt = agent.registeredAt;
        profile.lastActivityAt = agent.lastActivityAt;
        profile.isBanned = agent.isBanned;

        // Get reputation data
        (uint64 count, uint8 avgScore) =
            reputationRegistry.getSummary(agentId, new address[](0), bytes32(0), bytes32(0));
        profile.feedbackCount = count;
        profile.averageReputation = avgScore;

        // Get violation count from all providers
        profile.violationCount = _getTotalViolations(agentId);

        // Get tags and endpoints
        profile.tags = identityRegistry.getAgentTags(agentId);
        profile.a2aEndpoint = identityRegistry.getA2AEndpoint(agentId);
        profile.mcpEndpoint = identityRegistry.getMCPEndpoint(agentId);

        // Calculate composite score
        profile.compositeScore = _calculateCompositeScore(
            agent.stakedAmount, avgScore, agent.lastActivityAt, profile.violationCount, agent.isBanned
        );
    }

    /**
     * @notice Get profiles for multiple agents
     * @param agentIds Array of agent IDs
     */
    function getAgentProfiles(uint256[] calldata agentIds) external view returns (AgentProfile[] memory) {
        AgentProfile[] memory profiles = new AgentProfile[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            profiles[i] = this.getAgentProfile(agentIds[i]);
        }
        return profiles;
    }

    /**
     * @notice Get voting power for an address/agent
     * @param voter Address of the voter
     * @param agentId Agent ID (0 if not an agent)
     * @param baseVotes Base number of votes (e.g., token balance)
     */
    function getVotingPower(address voter, uint256 agentId, uint256 baseVotes)
        external
        view
        returns (VotingPower memory power)
    {
        power.baseVotes = baseVotes;
        power.reputationMultiplier = 100; // Default 1x
        power.stakeMultiplier = 100; // Default 1x

        if (agentId > 0 && identityRegistry.agentExists(agentId)) {
            IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

            // Check ownership
            if (agent.owner == voter && !agent.isBanned) {
                // Reputation multiplier: 1x at 50 rep, up to 2x at 100 rep
                (, uint8 avgScore) = reputationRegistry.getSummary(agentId, new address[](0), bytes32(0), bytes32(0));
                if (avgScore >= 50) {
                    power.reputationMultiplier = 100 + ((uint256(avgScore) - 50) * 2);
                }

                // Stake multiplier based on tier
                if (agent.tier == IIdentityRegistry.StakeTier.HIGH) {
                    power.stakeMultiplier = 150; // 1.5x for HIGH stake
                } else if (agent.tier == IIdentityRegistry.StakeTier.MEDIUM) {
                    power.stakeMultiplier = 125; // 1.25x for MEDIUM stake
                } else if (agent.tier == IIdentityRegistry.StakeTier.SMALL) {
                    power.stakeMultiplier = 110; // 1.1x for SMALL stake
                }
            }
        }

        // Calculate effective votes
        power.effectiveVotes = (baseVotes * power.reputationMultiplier * power.stakeMultiplier) / 10000;
    }

    // ============================================================================
    // Provider Reputation
    // ============================================================================

    /**
     * @notice Add a reputation provider to track
     * @param provider Address of the reputation provider contract
     */
    function addReputationProvider(address provider) external onlyOwner {
        require(!isReputationProvider[provider], "Already added");

        uint256 agentId = IReputationProvider(provider).getProviderAgentId();

        reputationProviders.push(provider);
        isReputationProvider[provider] = true;

        // Initialize reputation data
        _updateProviderReputation(provider);

        emit ReputationProviderAdded(provider, agentId);
    }

    /**
     * @notice Remove a reputation provider
     */
    function removeReputationProvider(address provider) external onlyOwner {
        require(isReputationProvider[provider], "Not a provider");

        isReputationProvider[provider] = false;
        delete providerReputations[provider];

        // Remove from array
        for (uint256 i = 0; i < reputationProviders.length; i++) {
            if (reputationProviders[i] == provider) {
                reputationProviders[i] = reputationProviders[reputationProviders.length - 1];
                reputationProviders.pop();
                break;
            }
        }

        emit ReputationProviderRemoved(provider);
    }

    /**
     * @notice Update reputation data for a provider
     */
    function updateProviderReputation(address provider) external {
        require(isReputationProvider[provider], "Not a provider");
        _updateProviderReputation(provider);
    }

    /**
     * @notice Get reputation for a provider, weighted by their own score
     * @param provider Provider address
     * @return rep Provider reputation data
     */
    function getProviderReputation(address provider) external view returns (ProviderReputation memory rep) {
        return providerReputations[provider];
    }

    /**
     * @notice Get all provider reputations
     */
    function getAllProviderReputations() external view returns (ProviderReputation[] memory) {
        ProviderReputation[] memory reps = new ProviderReputation[](reputationProviders.length);
        for (uint256 i = 0; i < reputationProviders.length; i++) {
            reps[i] = providerReputations[reputationProviders[i]];
        }
        return reps;
    }

    /**
     * @notice Get weighted average reputation for an agent across all providers
     * @param agentId Agent to query
     * @return weightedReputation Weighted average (0-100)
     * @return totalWeight Sum of provider weights used
     */
    function getWeightedAgentReputation(uint256 agentId)
        external
        view
        returns (uint256 weightedReputation, uint256 totalWeight)
    {
        uint256 weightedSum = 0;

        for (uint256 i = 0; i < reputationProviders.length; i++) {
            ProviderReputation storage pRep = providerReputations[reputationProviders[i]];

            if (pRep.weightedScore > 0) {
                // Get this agent's score from the provider
                (, uint8 avgScore) = reputationRegistry.getSummary(agentId, new address[](0), bytes32(0), bytes32(0));

                // Weight by provider's own reputation
                weightedSum += uint256(avgScore) * pRep.weightedScore;
                totalWeight += pRep.weightedScore;
            }
        }

        if (totalWeight > 0) {
            weightedReputation = weightedSum / totalWeight;
        }
    }

    // ============================================================================
    // Search & Discovery
    // ============================================================================

    /**
     * @notice Search agents by tag with pagination
     * @param tag Tag to search for
     * @param offset Start index
     * @param limit Max results
     */
    function searchByTag(string calldata tag, uint256 offset, uint256 limit)
        external
        view
        returns (SearchResult memory result)
    {
        uint256[] memory allMatches = identityRegistry.getAgentsByTag(tag);
        result.total = allMatches.length;
        result.offset = offset;
        result.limit = limit;

        if (offset >= allMatches.length) {
            result.agentIds = new uint256[](0);
            return result;
        }

        uint256 end = offset + limit;
        if (end > allMatches.length) end = allMatches.length;

        uint256 count = end - offset;
        result.agentIds = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            result.agentIds[i] = allMatches[offset + i];
        }
    }

    /**
     * @notice Get agents with minimum composite score
     * @param minScore Minimum score (0-100)
     * @param offset Start index
     * @param limit Max results
     */
    function getAgentsByScore(uint256 minScore, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory agentIds, uint256[] memory scores)
    {
        uint256[] memory allAgents = identityRegistry.getActiveAgents(0, 1000);

        // First pass: count matches
        uint256 matchCount = 0;
        for (uint256 i = 0; i < allAgents.length; i++) {
            AgentProfile memory profile = this.getAgentProfile(allAgents[i]);
            if (profile.compositeScore >= minScore && !profile.isBanned) {
                matchCount++;
            }
        }

        // Handle offset
        if (offset >= matchCount) {
            return (new uint256[](0), new uint256[](0));
        }

        uint256 resultCount = matchCount - offset;
        if (resultCount > limit) resultCount = limit;

        agentIds = new uint256[](resultCount);
        scores = new uint256[](resultCount);

        uint256 idx = 0;
        uint256 seen = 0;

        for (uint256 i = 0; i < allAgents.length && idx < resultCount; i++) {
            AgentProfile memory profile = this.getAgentProfile(allAgents[i]);
            if (profile.compositeScore >= minScore && !profile.isBanned) {
                if (seen >= offset) {
                    agentIds[idx] = allAgents[i];
                    scores[idx] = profile.compositeScore;
                    idx++;
                }
                seen++;
            }
        }
    }

    /**
     * @notice Get top agents by composite score
     * @param count Number of top agents to return
     */
    function getTopAgents(uint256 count) external view returns (AgentProfile[] memory) {
        uint256[] memory allAgents = identityRegistry.getActiveAgents(0, 500);

        if (allAgents.length == 0) {
            return new AgentProfile[](0);
        }

        uint256 resultSize = count > allAgents.length ? allAgents.length : count;
        AgentProfile[] memory result = new AgentProfile[](resultSize);

        // Get all profiles with scores
        AgentProfile[] memory allProfiles = new AgentProfile[](allAgents.length);
        for (uint256 i = 0; i < allAgents.length; i++) {
            allProfiles[i] = this.getAgentProfile(allAgents[i]);
        }

        // Selection sort for top N
        for (uint256 i = 0; i < resultSize; i++) {
            uint256 bestIdx = i;
            uint256 bestScore = allProfiles[i].compositeScore;

            for (uint256 j = i + 1; j < allAgents.length; j++) {
                if (allProfiles[j].compositeScore > bestScore && !allProfiles[j].isBanned) {
                    bestScore = allProfiles[j].compositeScore;
                    bestIdx = j;
                }
            }

            if (bestIdx != i) {
                (allProfiles[i], allProfiles[bestIdx]) = (allProfiles[bestIdx], allProfiles[i]);
            }

            result[i] = allProfiles[i];
        }

        return result;
    }

    // ============================================================================
    // Council Decision Support
    // ============================================================================

    /**
     * @notice Check if an agent meets minimum requirements for proposal submission
     */
    function canSubmitProposal(uint256 agentId) external view returns (bool eligible, string memory reason) {
        if (!identityRegistry.agentExists(agentId)) {
            return (false, "Agent does not exist");
        }

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

        if (agent.isBanned) {
            return (false, "Agent is banned");
        }

        AgentProfile memory profile = this.getAgentProfile(agentId);

        if (profile.compositeScore < minScoreForProposal) {
            return (false, "Composite score too low");
        }

        return (true, "");
    }

    /**
     * @notice Check if an agent meets minimum requirements for voting
     */
    function canVote(uint256 agentId) external view returns (bool eligible, string memory reason) {
        if (!identityRegistry.agentExists(agentId)) {
            return (false, "Agent does not exist");
        }

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

        if (agent.isBanned) {
            return (false, "Agent is banned");
        }

        AgentProfile memory profile = this.getAgentProfile(agentId);

        if (profile.compositeScore < minScoreForVoting) {
            return (false, "Composite score too low");
        }

        return (true, "");
    }

    /**
     * @notice Check if an agent can conduct research for the council
     */
    function canConductResearch(uint256 agentId) external view returns (bool eligible, string memory reason) {
        if (!identityRegistry.agentExists(agentId)) {
            return (false, "Agent does not exist");
        }

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

        if (agent.isBanned) {
            return (false, "Agent is banned");
        }

        if (agent.tier < IIdentityRegistry.StakeTier.MEDIUM) {
            return (false, "Insufficient stake tier for research");
        }

        AgentProfile memory profile = this.getAgentProfile(agentId);

        if (profile.compositeScore < minScoreForResearch) {
            return (false, "Composite score too low for research");
        }

        return (true, "");
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _calculateCompositeScore(
        uint256 staked,
        uint8 reputation,
        uint256 lastActivity,
        uint256 violations,
        bool banned
    ) internal view returns (uint256) {
        if (banned) return 0;

        // Normalize stake to 0-100 (assuming max stake of 100 ETH)
        uint256 stakeScore = staked > 100 ether ? 100 : (staked * 100) / 100 ether;

        // Reputation is already 0-100
        uint256 repScore = reputation;

        // Activity score: full points if active in last 30 days, decays after
        uint256 daysSinceActivity = (block.timestamp - lastActivity) / 1 days;
        uint256 activityScore = daysSinceActivity < 30 ? 100 : (daysSinceActivity < 90 ? 50 : 10);

        // Penalty for violations
        uint256 penaltyScore = violations > 10 ? 0 : ((10 - violations) * 10);

        // Calculate weighted average
        uint256 composite = (
            stakeScore * stakeWeight + repScore * reputationWeight + activityScore * activityWeight
                + penaltyScore * violationPenalty
        ) / 10000;

        return composite > 100 ? 100 : composite;
    }

    function _getTotalViolations(uint256 agentId) internal view returns (uint256 total) {
        for (uint256 i = 0; i < reputationProviders.length; i++) {
            total += IReputationProvider(reputationProviders[i]).getAgentViolationCount(agentId);
        }
    }

    function _updateProviderReputation(address provider) internal {
        ProviderReputation storage rep = providerReputations[provider];
        rep.provider = provider;

        // Get provider's agent ID
        rep.providerAgentId = IReputationProvider(provider).getProviderAgentId();

        // Get provider's stake if staking contract is configured
        if (stakingContract != address(0)) {
            rep.stakeAmount = IStaking(stakingContract).getStake(provider);
            rep.stakeTime = IStaking(stakingContract).getStakeTime(provider);
        }

        // Get provider's own reputation
        if (rep.providerAgentId > 0) {
            (, uint8 avgScore) =
                reputationRegistry.getSummary(rep.providerAgentId, new address[](0), bytes32(0), bytes32(0));
            rep.averageReputation = avgScore;
        }

        rep.lastUpdated = block.timestamp;

        // Calculate weighted score for this provider
        // Providers with more stake and higher reputation have more weight
        uint256 stakeWeight_ = rep.stakeAmount / 1e18; // Scale down
        if (stakeWeight_ > 100) stakeWeight_ = 100;

        rep.weightedScore = (stakeWeight_ + rep.averageReputation) / 2;

        emit ProviderReputationUpdated(provider, rep.weightedScore);
    }

    // ============================================================================
    // Configuration
    // ============================================================================

    function setWeights(
        uint256 _stakeWeight,
        uint256 _reputationWeight,
        uint256 _activityWeight,
        uint256 _violationPenalty
    ) external onlyOwner {
        require(_stakeWeight + _reputationWeight + _activityWeight + _violationPenalty == 10000, "Must sum to 10000");
        stakeWeight = _stakeWeight;
        reputationWeight = _reputationWeight;
        activityWeight = _activityWeight;
        violationPenalty = _violationPenalty;
        emit WeightsUpdated(_stakeWeight, _reputationWeight, _activityWeight, _violationPenalty);
    }

    function setMinScores(uint256 _proposal, uint256 _voting, uint256 _research) external onlyOwner {
        require(_proposal <= 100 && _voting <= 100 && _research <= 100, "Max 100");
        minScoreForProposal = _proposal;
        minScoreForVoting = _voting;
        minScoreForResearch = _research;
        emit MinScoresUpdated(_proposal, _voting, _research);
    }

    function setRegistries(address _identity, address _reputation, address _staking) external onlyOwner {
        if (_identity != address(0)) identityRegistry = IIdentityRegistry(_identity);
        if (_reputation != address(0)) reputationRegistry = IReputationRegistry(_reputation);
        if (_staking != address(0)) stakingContract = _staking;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
