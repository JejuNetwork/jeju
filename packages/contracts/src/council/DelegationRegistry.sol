// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DelegationRegistry
 * @author Jeju Network
 * @notice Vote delegation system for Jeju DAO governance
 * @dev Implements:
 *      - Delegate registration with profiles
 *      - Voting power delegation (1:1 with token balance)
 *      - Reputation-weighted security council selection
 *      - Delegate recommendations by combined score
 *
 * Security Council Selection:
 * - Top N delegates by (delegation * reputation * stake)
 * - Must have minimum stake (HIGH tier)
 * - Must have minimum reputation (80+)
 * - Must have minimum delegated power (1% of total)
 *
 * @custom:security-contact security@jeju.network
 */
interface IIdentityRegistry {
    struct AgentRegistration {
        uint256 id;
        address owner;
        string name;
        string role;
        uint256 stakedAmount;
        uint8 tier;
        bool isBanned;
    }

    function getAgent(uint256 agentId) external view returns (AgentRegistration memory);
    function getAgentByOwner(address owner) external view returns (uint256);
    function agentExists(uint256 agentId) external view returns (bool);
}

interface IReputationRegistry {
    function getReputationScore(uint256 agentId) external view returns (uint256);
}

contract DelegationRegistry is Ownable, ReentrancyGuard {
    // ============================================================================
    // Structs
    // ============================================================================

    struct Delegate {
        address delegate;
        uint256 agentId;
        string name;
        string profileHash;       // IPFS hash of detailed profile
        string[] expertise;       // Areas of expertise
        uint256 totalDelegated;   // Total voting power delegated
        uint256 delegatorCount;   // Number of delegators
        uint256 registeredAt;
        bool isActive;
        uint256 proposalsVoted;
        uint256 proposalsCreated;
    }

    struct Delegation {
        address delegator;
        address delegate;
        uint256 amount;           // Voting power delegated
        uint256 delegatedAt;
        uint256 lockedUntil;      // Optional lock period
    }

    struct SecurityCouncilMember {
        address member;
        uint256 agentId;
        uint256 combinedScore;    // delegation * reputation * stake
        uint256 electedAt;
    }

    // ============================================================================
    // State
    // ============================================================================

    IERC20 public governanceToken;
    IIdentityRegistry public identityRegistry;
    IReputationRegistry public reputationRegistry;

    mapping(address => Delegate) public delegates;
    address[] public allDelegates;

    mapping(address => Delegation) public delegations;
    mapping(address => address[]) public delegatorsByDelegate;

    SecurityCouncilMember[] public securityCouncil;
    mapping(address => bool) public isSecurityCouncilMember;

    uint256 public securityCouncilSize = 5;
    uint256 public minDelegationForCouncil = 1e18;     // 1% of total (scaled)
    uint256 public minReputationForCouncil = 80;       // 80/100
    uint256 public minStakeForCouncil = 1 ether;       // HIGH tier equivalent
    uint256 public minDelegationLockPeriod = 7 days;

    uint256 public totalDelegatedPower;

    // ============================================================================
    // Events
    // ============================================================================

    event DelegateRegistered(
        address indexed delegate,
        uint256 indexed agentId,
        string name
    );

    event DelegateProfileUpdated(
        address indexed delegate,
        string newProfileHash
    );

    event DelegateDeactivated(
        address indexed delegate
    );

    event VotingPowerDelegated(
        address indexed delegator,
        address indexed delegate,
        uint256 amount,
        uint256 lockedUntil
    );

    event DelegationRevoked(
        address indexed delegator,
        address indexed previousDelegate,
        uint256 amount
    );

    event SecurityCouncilUpdated(
        address[] newMembers
    );

    event DelegateVoted(
        address indexed delegate,
        bytes32 indexed proposalId
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error NotRegisteredDelegate();
    error AlreadyRegistered();
    error NotAgentOwner();
    error InsufficientStake();
    error InsufficientReputation();
    error AlreadyDelegated();
    error NotDelegated();
    error DelegationLocked();
    error CannotDelegateToSelf();
    error DelegateNotActive();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _governanceToken,
        address _identityRegistry,
        address _reputationRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_governanceToken != address(0), "Invalid token");
        require(_identityRegistry != address(0), "Invalid identity");
        require(_reputationRegistry != address(0), "Invalid reputation");

        governanceToken = IERC20(_governanceToken);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
    }

    // ============================================================================
    // Delegate Registration
    // ============================================================================

    /**
     * @notice Register as a delegate
     * @param agentId Agent ID to associate with delegate
     * @param name Display name
     * @param profileHash IPFS hash of detailed profile
     * @param expertise Array of expertise areas
     */
    function registerAsDelegate(
        uint256 agentId,
        string calldata name,
        string calldata profileHash,
        string[] calldata expertise
    ) external nonReentrant {
        if (delegates[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        IIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);
        if (agent.owner != msg.sender) revert NotAgentOwner();
        if (agent.isBanned) revert InsufficientReputation();

        delegates[msg.sender] = Delegate({
            delegate: msg.sender,
            agentId: agentId,
            name: name,
            profileHash: profileHash,
            expertise: expertise,
            totalDelegated: 0,
            delegatorCount: 0,
            registeredAt: block.timestamp,
            isActive: true,
            proposalsVoted: 0,
            proposalsCreated: 0
        });

        allDelegates.push(msg.sender);

        emit DelegateRegistered(msg.sender, agentId, name);
    }

    /**
     * @notice Update delegate profile
     */
    function updateProfile(
        string calldata newProfileHash,
        string[] calldata newExpertise
    ) external {
        Delegate storage d = delegates[msg.sender];
        if (d.registeredAt == 0) revert NotRegisteredDelegate();

        d.profileHash = newProfileHash;
        d.expertise = newExpertise;

        emit DelegateProfileUpdated(msg.sender, newProfileHash);
    }

    /**
     * @notice Deactivate delegate status
     */
    function deactivateDelegate() external {
        Delegate storage d = delegates[msg.sender];
        if (d.registeredAt == 0) revert NotRegisteredDelegate();

        d.isActive = false;
        emit DelegateDeactivated(msg.sender);
    }

    // ============================================================================
    // Delegation
    // ============================================================================

    /**
     * @notice Delegate voting power to a registered delegate
     * @param to Delegate address
     * @param amount Amount of voting power to delegate
     * @param lockPeriod How long to lock delegation (0 for no lock)
     */
    function delegate(
        address to,
        uint256 amount,
        uint256 lockPeriod
    ) external nonReentrant {
        if (to == msg.sender) revert CannotDelegateToSelf();
        if (delegations[msg.sender].amount > 0) revert AlreadyDelegated();

        Delegate storage d = delegates[to];
        if (d.registeredAt == 0 || !d.isActive) revert DelegateNotActive();

        uint256 balance = governanceToken.balanceOf(msg.sender);
        uint256 delegateAmount = amount > balance ? balance : amount;

        uint256 lockedUntil = lockPeriod > 0
            ? block.timestamp + lockPeriod
            : 0;

        delegations[msg.sender] = Delegation({
            delegator: msg.sender,
            delegate: to,
            amount: delegateAmount,
            delegatedAt: block.timestamp,
            lockedUntil: lockedUntil
        });

        delegatorsByDelegate[to].push(msg.sender);

        d.totalDelegated += delegateAmount;
        d.delegatorCount++;
        totalDelegatedPower += delegateAmount;

        emit VotingPowerDelegated(msg.sender, to, delegateAmount, lockedUntil);
    }

    /**
     * @notice Revoke delegation
     */
    function revokeDelegation() external nonReentrant {
        Delegation storage del = delegations[msg.sender];
        if (del.amount == 0) revert NotDelegated();
        if (del.lockedUntil > 0 && block.timestamp < del.lockedUntil) {
            revert DelegationLocked();
        }

        address previousDelegate = del.delegate;
        uint256 amount = del.amount;

        Delegate storage d = delegates[previousDelegate];
        d.totalDelegated -= amount;
        d.delegatorCount--;
        totalDelegatedPower -= amount;

        // Remove from delegators array
        address[] storage delegators = delegatorsByDelegate[previousDelegate];
        for (uint256 i = 0; i < delegators.length; i++) {
            if (delegators[i] == msg.sender) {
                delegators[i] = delegators[delegators.length - 1];
                delegators.pop();
                break;
            }
        }

        delete delegations[msg.sender];

        emit DelegationRevoked(msg.sender, previousDelegate, amount);
    }

    /**
     * @notice Change delegation to a new delegate
     */
    function redelegate(address newDelegate, uint256 newLockPeriod) external nonReentrant {
        Delegation storage del = delegations[msg.sender];
        if (del.amount == 0) revert NotDelegated();
        if (del.lockedUntil > 0 && block.timestamp < del.lockedUntil) {
            revert DelegationLocked();
        }
        if (newDelegate == msg.sender) revert CannotDelegateToSelf();

        Delegate storage newDel = delegates[newDelegate];
        if (newDel.registeredAt == 0 || !newDel.isActive) revert DelegateNotActive();

        address previousDelegate = del.delegate;
        uint256 amount = del.amount;

        // Update old delegate
        Delegate storage oldDel = delegates[previousDelegate];
        oldDel.totalDelegated -= amount;
        oldDel.delegatorCount--;

        // Remove from old delegators array
        address[] storage oldDelegators = delegatorsByDelegate[previousDelegate];
        for (uint256 i = 0; i < oldDelegators.length; i++) {
            if (oldDelegators[i] == msg.sender) {
                oldDelegators[i] = oldDelegators[oldDelegators.length - 1];
                oldDelegators.pop();
                break;
            }
        }

        // Update to new delegate
        newDel.totalDelegated += amount;
        newDel.delegatorCount++;
        delegatorsByDelegate[newDelegate].push(msg.sender);

        del.delegate = newDelegate;
        del.delegatedAt = block.timestamp;
        del.lockedUntil = newLockPeriod > 0 ? block.timestamp + newLockPeriod : 0;

        emit DelegationRevoked(msg.sender, previousDelegate, amount);
        emit VotingPowerDelegated(msg.sender, newDelegate, amount, del.lockedUntil);
    }

    // ============================================================================
    // Security Council
    // ============================================================================

    /**
     * @notice Update security council based on current delegate stats
     * @dev Selects top N delegates by combined score who meet requirements
     */
    function updateSecurityCouncil() external {
        // Clear existing council
        for (uint256 i = 0; i < securityCouncil.length; i++) {
            isSecurityCouncilMember[securityCouncil[i].member] = false;
        }
        delete securityCouncil;

        // Calculate scores for all eligible delegates
        uint256 eligibleCount = 0;
        address[] memory eligibleAddresses = new address[](allDelegates.length);
        uint256[] memory scores = new uint256[](allDelegates.length);

        for (uint256 i = 0; i < allDelegates.length; i++) {
            address addr = allDelegates[i];
            Delegate storage d = delegates[addr];

            if (!d.isActive) continue;

            // Get stake from identity registry
            IIdentityRegistry.AgentRegistration memory agent =
                identityRegistry.getAgent(d.agentId);
            if (agent.stakedAmount < minStakeForCouncil) continue;
            if (agent.isBanned) continue;

            // Get reputation
            uint256 reputation = reputationRegistry.getReputationScore(d.agentId);
            if (reputation < minReputationForCouncil) continue;

            // Check minimum delegation
            uint256 delegationShare = totalDelegatedPower > 0
                ? (d.totalDelegated * 1e18) / totalDelegatedPower
                : 0;
            if (delegationShare < minDelegationForCouncil / 100) continue;

            // Calculate combined score
            uint256 score = (d.totalDelegated * reputation * agent.stakedAmount) / 1e36;

            eligibleAddresses[eligibleCount] = addr;
            scores[eligibleCount] = score;
            eligibleCount++;
        }

        // Select top N
        for (uint256 i = 0; i < securityCouncilSize && i < eligibleCount; i++) {
            uint256 bestIdx = i;
            uint256 bestScore = scores[i];

            for (uint256 j = i + 1; j < eligibleCount; j++) {
                if (scores[j] > bestScore) {
                    bestScore = scores[j];
                    bestIdx = j;
                }
            }

            if (bestIdx != i) {
                (eligibleAddresses[i], eligibleAddresses[bestIdx]) =
                    (eligibleAddresses[bestIdx], eligibleAddresses[i]);
                (scores[i], scores[bestIdx]) = (scores[bestIdx], scores[i]);
            }

            address member = eligibleAddresses[i];
            Delegate storage d = delegates[member];

            securityCouncil.push(SecurityCouncilMember({
                member: member,
                agentId: d.agentId,
                combinedScore: scores[i],
                electedAt: block.timestamp
            }));

            isSecurityCouncilMember[member] = true;
        }

        // Emit event with new council
        address[] memory newMembers = new address[](securityCouncil.length);
        for (uint256 i = 0; i < securityCouncil.length; i++) {
            newMembers[i] = securityCouncil[i].member;
        }
        emit SecurityCouncilUpdated(newMembers);
    }

    // ============================================================================
    // Voting Tracking
    // ============================================================================

    /**
     * @notice Record that a delegate voted on a proposal
     * @param delegateAddr Delegate who voted
     * @param proposalId Proposal voted on
     */
    function recordDelegateVote(address delegateAddr, bytes32 proposalId) external onlyOwner {
        Delegate storage d = delegates[delegateAddr];
        if (d.registeredAt != 0) {
            d.proposalsVoted++;
            emit DelegateVoted(delegateAddr, proposalId);
        }
    }

    /**
     * @notice Record that a delegate created a proposal
     */
    function recordProposalCreated(address delegateAddr) external onlyOwner {
        Delegate storage d = delegates[delegateAddr];
        if (d.registeredAt != 0) {
            d.proposalsCreated++;
        }
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Get recommended delegates sorted by score
     * @param limit Maximum number of delegates to return
     */
    function getTopDelegates(uint256 limit)
        external
        view
        returns (Delegate[] memory)
    {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allDelegates.length; i++) {
            if (delegates[allDelegates[i]].isActive) activeCount++;
        }

        uint256 resultSize = limit < activeCount ? limit : activeCount;
        Delegate[] memory result = new Delegate[](resultSize);

        // Simple selection sort for top N
        address[] memory sorted = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allDelegates.length; i++) {
            if (delegates[allDelegates[i]].isActive) {
                sorted[idx++] = allDelegates[i];
            }
        }

        for (uint256 i = 0; i < resultSize; i++) {
            uint256 bestIdx = i;
            uint256 bestDelegated = delegates[sorted[i]].totalDelegated;

            for (uint256 j = i + 1; j < activeCount; j++) {
                if (delegates[sorted[j]].totalDelegated > bestDelegated) {
                    bestDelegated = delegates[sorted[j]].totalDelegated;
                    bestIdx = j;
                }
            }

            if (bestIdx != i) {
                (sorted[i], sorted[bestIdx]) = (sorted[bestIdx], sorted[i]);
            }

            result[i] = delegates[sorted[i]];
        }

        return result;
    }

    function getDelegate(address addr) external view returns (Delegate memory) {
        return delegates[addr];
    }

    function getDelegation(address delegator) external view returns (Delegation memory) {
        return delegations[delegator];
    }

    function getDelegators(address delegateAddr) external view returns (address[] memory) {
        return delegatorsByDelegate[delegateAddr];
    }

    function getSecurityCouncil() external view returns (address[] memory) {
        address[] memory result = new address[](securityCouncil.length);
        for (uint256 i = 0; i < securityCouncil.length; i++) {
            result[i] = securityCouncil[i].member;
        }
        return result;
    }

    function getSecurityCouncilDetails()
        external
        view
        returns (SecurityCouncilMember[] memory)
    {
        return securityCouncil;
    }

    function getAllDelegates() external view returns (address[] memory) {
        return allDelegates;
    }

    function getVotingPower(address account) external view returns (uint256) {
        Delegation storage del = delegations[account];
        if (del.amount > 0) {
            // User has delegated - their voting power is held by delegate
            return 0;
        }

        Delegate storage d = delegates[account];
        if (d.registeredAt != 0 && d.isActive) {
            // Delegate has own balance + delegated power
            return governanceToken.balanceOf(account) + d.totalDelegated;
        }

        // Regular user with no delegation
        return governanceToken.balanceOf(account);
    }

    // ============================================================================
    // Configuration
    // ============================================================================

    function setSecurityCouncilSize(uint256 newSize) external onlyOwner {
        require(newSize > 0, "Must be at least 1");
        securityCouncilSize = newSize;
    }

    function setMinDelegationForCouncil(uint256 minDelegation) external onlyOwner {
        minDelegationForCouncil = minDelegation;
    }

    function setMinReputationForCouncil(uint256 minRep) external onlyOwner {
        require(minRep <= 100, "Max 100");
        minReputationForCouncil = minRep;
    }

    function setMinStakeForCouncil(uint256 minStake) external onlyOwner {
        minStakeForCouncil = minStake;
    }

    function setRegistries(
        address newIdentity,
        address newReputation
    ) external onlyOwner {
        if (newIdentity != address(0)) {
            identityRegistry = IIdentityRegistry(newIdentity);
        }
        if (newReputation != address(0)) {
            reputationRegistry = IReputationRegistry(newReputation);
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

