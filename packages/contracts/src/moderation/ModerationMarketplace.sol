// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BanManager.sol";

/**
 * @title ModerationMarketplace
 * @author Jeju Network
 * @notice Futarchy-based moderation system where users bet on ban outcomes
 * @dev Implements stake-weighted moderation with flash loan protection
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              CORE MECHANICS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. IMMEDIATE NOTICE BAN (Staked → Unstaked):
 *    - Staked users can immediately flag unstaked users as "ON_NOTICE"
 *    - The flagged user is immediately restricted from network actions
 *    - A moderation market is created for community voting
 *
 * 2. CHALLENGE MODE (Both Staked):
 *    - If the flagged user stakes, both parties bet their stakes
 *    - Community votes via futarchy prediction market
 *    - Winner takes share of loser's stake
 *
 * 3. RE-REVIEW MECHANISM:
 *    - Banned users can request re-review by staking 10x original stake
 *    - Creates new market where banner risks their original stake
 *    - Higher stakes = more serious conviction in the outcome
 *
 * 4. FLASH LOAN PROTECTION:
 *    - Minimum stake age: 24 hours before voting power activates
 *    - Block-based cooldowns for all stake changes
 *    - Time-weighted voting to prevent last-minute manipulation
 *    - Checkpoint system for stake balances
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              FEE STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - Winners get 90% of loser's stake
 * - Protocol treasury gets 5%
 * - Market makers get 5%
 *
 * @custom:security-contact security@jeju.network
 */
contract ModerationMarketplace is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum BanStatus {
        NONE,           // No ban
        ON_NOTICE,      // Immediate flag by staker (pending market)
        CHALLENGED,     // Target staked, market active
        BANNED,         // Market resolved YES - banned
        CLEARED,        // Market resolved NO - not banned
        APPEALING       // Re-review in progress
    }

    enum MarketOutcome {
        PENDING,        // Voting in progress
        BAN_UPHELD,     // YES won - user is banned
        BAN_REJECTED    // NO won - user is cleared
    }

    enum VotePosition {
        YES,            // Support the ban
        NO              // Oppose the ban
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;           // Block timestamp when staked
        uint256 stakedBlock;        // Block number when staked
        uint256 lastActivityBlock;  // Last stake modification block
        bool isStaked;
    }

    struct BanCase {
        bytes32 caseId;
        address reporter;           // Staked user who initiated ban
        address target;             // User being banned
        uint256 reporterStake;      // Reporter's stake at case creation
        uint256 targetStake;        // Target's stake (0 if unstaked, or stake if challenged)
        string reason;              // Ban reason
        bytes32 evidenceHash;       // IPFS hash of evidence
        BanStatus status;
        uint256 createdAt;
        uint256 marketOpenUntil;    // When voting ends
        uint256 yesVotes;           // Total stake weighted YES votes
        uint256 noVotes;            // Total stake weighted NO votes
        uint256 totalPot;           // Total stakes at risk
        bool resolved;
        MarketOutcome outcome;
        uint256 appealCount;        // Number of times appealed
    }

    struct Vote {
        VotePosition position;
        uint256 weight;             // Stake-weighted vote
        uint256 stakedAt;           // When voter staked (for flash loan check)
        bool hasVoted;
        bool hasClaimed;
    }

    struct StakeCheckpoint {
        uint256 blockNumber;
        uint256 stakeAmount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MIN_STAKE_AGE = 24 hours;           // Anti flash loan
    uint256 public constant MIN_STAKE_BLOCKS = 7200;            // ~24 hours worth of blocks
    uint256 public constant DEFAULT_VOTING_PERIOD = 3 days;
    uint256 public constant APPEAL_VOTING_PERIOD = 7 days;
    uint256 public constant RE_REVIEW_MULTIPLIER = 10;          // 10x stake for re-review
    uint256 public constant WINNER_SHARE_BPS = 9000;            // 90%
    uint256 public constant TREASURY_SHARE_BPS = 500;           // 5%
    uint256 public constant MARKET_MAKER_SHARE_BPS = 500;       // 5%
    uint256 public constant MAX_APPEAL_COUNT = 3;               // Max re-reviews allowed
    
    // ═══════════════════════════════════════════════════════════════════════
    //                         ANTI-MANIPULATION CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    /// @notice Minimum quorum: 10% of total staked must participate
    uint256 public constant MIN_QUORUM_BPS = 1000;
    
    /// @notice Max vote weight per address: 25% of case total votes
    uint256 public constant MAX_VOTE_WEIGHT_BPS = 2500;
    
    /// @notice Failed reporter penalty multiplier (2x their stake)
    uint256 public constant FAILED_REPORT_PENALTY_MULTIPLIER = 2;
    
    /// @notice Time weight bonus: 1% per hour remaining (max 72% bonus for early votes)
    uint256 public constant TIME_WEIGHT_BPS_PER_HOUR = 100;
    
    /// @notice Quadratic voting scale factor (for precision)
    uint256 public constant QUADRATIC_SCALE = 1e18;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice BanManager contract for network ban enforcement
    BanManager public immutable banManager;

    /// @notice Staking token (ETH if address(0))
    IERC20 public immutable stakingToken;

    /// @notice Treasury for protocol fees
    address public treasury;

    /// @notice Minimum stake required to report (increased to prevent griefing)
    uint256 public minReporterStake = 0.1 ether;

    /// @notice Minimum stake to challenge (match reporter)
    uint256 public minChallengeStake = 0.1 ether;

    /// @notice Total staked in the system (for quorum calculation)
    uint256 public totalStaked;

    /// @notice User stakes
    mapping(address => StakeInfo) public stakes;

    /// @notice Stake checkpoints for flash loan protection
    mapping(address => StakeCheckpoint[]) private _stakeCheckpoints;

    /// @notice All ban cases
    mapping(bytes32 => BanCase) public cases;

    /// @notice Votes per case per voter
    mapping(bytes32 => mapping(address => Vote)) public votes;

    /// @notice Active cases per target address
    mapping(address => bytes32) public activeCase;

    /// @notice All case IDs
    bytes32[] public allCaseIds;

    /// @notice Case count
    uint256 private _nextCaseId = 1;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Staked(address indexed user, uint256 amount, uint256 totalStake);
    event Unstaked(address indexed user, uint256 amount, uint256 remainingStake);

    event CaseOpened(
        bytes32 indexed caseId,
        address indexed reporter,
        address indexed target,
        uint256 reporterStake,
        string reason,
        bytes32 evidenceHash
    );

    event CaseChallenged(
        bytes32 indexed caseId,
        address indexed target,
        uint256 targetStake,
        uint256 totalPot
    );

    event VoteCast(
        bytes32 indexed caseId,
        address indexed voter,
        VotePosition position,
        uint256 weight
    );

    event CaseResolved(
        bytes32 indexed caseId,
        MarketOutcome outcome,
        uint256 yesVotes,
        uint256 noVotes
    );

    event RewardsDistributed(
        bytes32 indexed caseId,
        address indexed winner,
        uint256 winnerAmount,
        uint256 treasuryAmount
    );

    event ConfigUpdated(string indexed param, uint256 oldValue, uint256 newValue);

    event AppealOpened(
        bytes32 indexed caseId,
        address indexed appellant,
        uint256 appealStake,
        uint256 appealNumber
    );

    event StakeCheckpointed(address indexed user, uint256 blockNumber, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InsufficientStake();
    error StakeTooYoung();
    error NotStaked();
    error CaseNotFound();
    error CaseNotActive();
    error CaseAlreadyResolved();
    error VotingNotEnded();
    error VotingEnded();
    error AlreadyVoted();
    error NotCaseParty();
    error CannotBanSelf();
    error TargetAlreadyHasActiveCase();
    error MaxAppealsReached();
    error NotBanned();
    error FlashLoanDetected();
    error InvalidAmount();
    error TransferFailed();

    // ═══════════════════════════════════════════════════════════════════════
    //                              MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════

    modifier validStakeAge(address user) {
        StakeInfo storage userStake = stakes[user];
        if (!userStake.isStaked) revert NotStaked();
        if (block.timestamp < userStake.stakedAt + MIN_STAKE_AGE) revert StakeTooYoung();
        if (block.number < userStake.stakedBlock + MIN_STAKE_BLOCKS) revert FlashLoanDetected();
        _;
    }

    modifier caseExists(bytes32 caseId) {
        // slither-disable-next-line incorrect-equality
        if (cases[caseId].createdAt == 0) revert CaseNotFound();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _banManager,
        address _stakingToken,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_banManager != address(0), "Invalid BanManager");
        require(_treasury != address(0), "Invalid treasury");

        banManager = BanManager(_banManager);
        stakingToken = IERC20(_stakingToken); // address(0) for ETH
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STAKING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Stake ETH to gain moderation powers
     * @dev Stake must age MIN_STAKE_AGE before voting power activates
     */
    function stake() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();

        StakeInfo storage stakeInfo = stakes[msg.sender];

        // Create checkpoint before modification
        _checkpoint(msg.sender);

        stakeInfo.amount += msg.value;
        stakeInfo.stakedAt = block.timestamp;
        stakeInfo.stakedBlock = block.number;
        stakeInfo.lastActivityBlock = block.number;
        stakeInfo.isStaked = true;
        
        // Track total staked for quorum calculation
        totalStaked += msg.value;

        emit Staked(msg.sender, msg.value, stakeInfo.amount);
    }

    /**
     * @notice Stake ERC20 tokens
     * @param amount Amount to stake
     */
    function stakeTokens(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (address(stakingToken) == address(0)) revert InvalidAmount();

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        StakeInfo storage stakeInfo = stakes[msg.sender];

        // Create checkpoint before modification
        _checkpoint(msg.sender);

        stakeInfo.amount += amount;
        
        // Track total staked for quorum calculation
        totalStaked += amount;
        stakeInfo.stakedAt = block.timestamp;
        stakeInfo.stakedBlock = block.number;
        stakeInfo.lastActivityBlock = block.number;
        stakeInfo.isStaked = true;

        emit Staked(msg.sender, amount, stakeInfo.amount);
    }

    /**
     * @notice Unstake tokens
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage stakeInfo = stakes[msg.sender];
        if (!stakeInfo.isStaked) revert NotStaked();
        if (stakeInfo.amount < amount) revert InsufficientStake();

        // Check user doesn't have active case where they're a party
        bytes32 activeCaseId = activeCase[msg.sender];
        if (activeCaseId != bytes32(0)) {
            BanCase storage banCase = cases[activeCaseId];
            if (!banCase.resolved) {
                if (banCase.reporter == msg.sender || banCase.target == msg.sender) {
                    revert CaseNotActive();
                }
            }
        }

        // Create checkpoint before modification
        _checkpoint(msg.sender);

        stakeInfo.amount -= amount;
        stakeInfo.lastActivityBlock = block.number;
        
        // Decrease total staked
        totalStaked -= amount;

        // slither-disable-next-line incorrect-equality
        if (stakeInfo.amount == 0) {
            stakeInfo.isStaked = false;
        }

        // Transfer tokens
        if (address(stakingToken) == address(0)) {
            // slither-disable-next-line low-level-calls
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            stakingToken.safeTransfer(msg.sender, amount);
        }

        emit Unstaked(msg.sender, amount, stakeInfo.amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              BAN INITIATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Open a ban case against an unstaked user
     * @dev Only staked users with aged stakes can report
     * @param target Address to ban
     * @param reason Ban reason
     * @param evidenceHash IPFS hash of evidence
     * @return caseId The created case ID
     */
    function openCase(
        address target,
        string calldata reason,
        bytes32 evidenceHash
    ) external nonReentrant whenNotPaused validStakeAge(msg.sender) returns (bytes32 caseId) {
        StakeInfo storage reporterStake = stakes[msg.sender];
        StakeInfo storage targetStake = stakes[target];

        // Validation
        if (target == msg.sender) revert CannotBanSelf();
        if (reporterStake.amount < minReporterStake) revert InsufficientStake();
        if (activeCase[target] != bytes32(0) && !cases[activeCase[target]].resolved) {
            revert TargetAlreadyHasActiveCase();
        }

        // Generate case ID
        caseId = keccak256(abi.encodePacked(_nextCaseId++, msg.sender, target, block.timestamp));

        // Determine if this is immediate ban (unstaked target) or regular case
        BanStatus initialStatus;
        if (!targetStake.isStaked || targetStake.amount == 0) {
            // Unstaked target = immediate ON_NOTICE ban
            initialStatus = BanStatus.ON_NOTICE;
        } else {
            // Staked target = challenged mode, both parties bet
            initialStatus = BanStatus.CHALLENGED;
        }

        // Calculate quadratic vote weights for initial votes
        uint256 reporterVoteWeight = _sqrt(reporterStake.amount * QUADRATIC_SCALE);
        uint256 targetVoteWeight = targetStake.isStaked && targetStake.amount > 0 
            ? _sqrt(targetStake.amount * QUADRATIC_SCALE) 
            : 0;

        // Create case
        cases[caseId] = BanCase({
            caseId: caseId,
            reporter: msg.sender,
            target: target,
            reporterStake: reporterStake.amount,
            targetStake: targetStake.amount,
            reason: reason,
            evidenceHash: evidenceHash,
            status: initialStatus,
            createdAt: block.timestamp,
            marketOpenUntil: block.timestamp + DEFAULT_VOTING_PERIOD,
            yesVotes: reporterVoteWeight,  // Quadratic weighted YES votes
            noVotes: targetVoteWeight,      // Quadratic weighted NO votes
            totalPot: reporterStake.amount + targetStake.amount,
            resolved: false,
            outcome: MarketOutcome.PENDING,
            appealCount: 0
        });

        activeCase[target] = caseId;
        allCaseIds.push(caseId);

        // Record reporter's auto-vote with quadratic weight
        votes[caseId][msg.sender] = Vote({
            position: VotePosition.YES,
            weight: reporterVoteWeight,
            stakedAt: reporterStake.stakedAt,
            hasVoted: true,
            hasClaimed: false
        });

        // Record target's auto-vote if staked
        if (targetStake.isStaked && targetStake.amount > 0) {
            votes[caseId][target] = Vote({
                position: VotePosition.NO,
                weight: targetVoteWeight,
                stakedAt: targetStake.stakedAt,
                hasVoted: true,
                hasClaimed: false
            });
        }

        emit CaseOpened(caseId, msg.sender, target, reporterStake.amount, reason, evidenceHash);

        // Place target on notice via BanManager (immediate restriction)
        if (initialStatus == BanStatus.ON_NOTICE) {
            banManager.placeOnNotice(target, msg.sender, caseId, reason);
        }

        // If target is staked, emit challenge event
        if (initialStatus == BanStatus.CHALLENGED) {
            emit CaseChallenged(caseId, target, targetStake.amount, cases[caseId].totalPot);
            // Update to challenged status in BanManager
            banManager.placeOnNotice(target, msg.sender, caseId, reason);
            banManager.updateBanStatus(target, BanManager.BanType.CHALLENGED);
        }
    }

    /**
     * @notice Challenge a ban case by staking (for ON_NOTICE users)
     * @dev Target must stake at least minChallengeStake to challenge
     *      Uses timestamp for voting period check - intentional design
     * @param caseId Case to challenge
     */
    // slither-disable-next-line timestamp
    function challengeCase(bytes32 caseId) external payable nonReentrant caseExists(caseId) {
        BanCase storage banCase = cases[caseId];

        if (banCase.target != msg.sender) revert NotCaseParty();
        if (banCase.status != BanStatus.ON_NOTICE) revert CaseNotActive();
        if (banCase.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > banCase.marketOpenUntil) revert VotingEnded();

        // Stake the challenge amount
        if (msg.value < minChallengeStake) revert InsufficientStake();

        StakeInfo storage stakeInfo = stakes[msg.sender];

        // Create checkpoint
        _checkpoint(msg.sender);

        stakeInfo.amount += msg.value;
        stakeInfo.stakedAt = block.timestamp;
        stakeInfo.stakedBlock = block.number;
        stakeInfo.lastActivityBlock = block.number;
        stakeInfo.isStaked = true;
        
        // Track total staked
        totalStaked += msg.value;

        // Calculate quadratic vote weight for challenger
        uint256 challengerVoteWeight = _sqrt(msg.value * QUADRATIC_SCALE);

        // Update case
        banCase.targetStake = msg.value;
        banCase.totalPot += msg.value;
        banCase.noVotes += challengerVoteWeight;  // Use quadratic weight
        banCase.status = BanStatus.CHALLENGED;

        // Record target's vote with quadratic weight
        votes[caseId][msg.sender] = Vote({
            position: VotePosition.NO,
            weight: challengerVoteWeight,
            stakedAt: block.timestamp,
            hasVoted: true,
            hasClaimed: false
        });

        emit Staked(msg.sender, msg.value, stakeInfo.amount);
        emit CaseChallenged(caseId, msg.sender, msg.value, banCase.totalPot);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VOTING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Vote on a ban case
     * @dev Stake age is validated for flash loan protection
     *      Uses timestamp for voting period check - intentional design
     *      Implements quadratic voting, time-weighting, and vote caps
     * @param caseId Case to vote on
     * @param position YES or NO
     */
    // slither-disable-next-line timestamp
    function vote(bytes32 caseId, VotePosition position)
        external
        nonReentrant
        caseExists(caseId)
        validStakeAge(msg.sender)
    {
        BanCase storage banCase = cases[caseId];
        Vote storage v = votes[caseId][msg.sender];

        if (banCase.resolved) revert CaseAlreadyResolved();
        if (block.timestamp > banCase.marketOpenUntil) revert VotingEnded();
        if (v.hasVoted) revert AlreadyVoted();

        // Case parties already auto-voted
        if (msg.sender == banCase.reporter || msg.sender == banCase.target) {
            revert AlreadyVoted();
        }

        StakeInfo storage stakeInfo = stakes[msg.sender];
        
        // Calculate effective vote weight with anti-manipulation measures
        uint256 voteWeight = _calculateVoteWeight(stakeInfo.amount, banCase);

        // Record vote
        v.position = position;
        v.weight = voteWeight;
        v.stakedAt = stakeInfo.stakedAt;
        v.hasVoted = true;

        // Update case totals
        if (position == VotePosition.YES) {
            banCase.yesVotes += voteWeight;
        } else {
            banCase.noVotes += voteWeight;
        }

        emit VoteCast(caseId, msg.sender, position, voteWeight);
    }
    
    /**
     * @notice Calculate effective vote weight with anti-manipulation measures
     * @dev Applies: quadratic scaling, time weighting, and vote caps
     *      Division before multiplication is intentional for hour granularity
     *      Timestamp comparisons are intentional for time-based logic
     * @param rawStake User's raw stake amount
     * @param banCase The case being voted on
     * @return effectiveWeight The calculated vote weight
     */
    // slither-disable-next-line divide-before-multiply,timestamp
    function _calculateVoteWeight(uint256 rawStake, BanCase storage banCase) internal view returns (uint256) {
        // 1. Quadratic voting: sqrt(stake) to reduce whale power
        uint256 quadraticWeight = _sqrt(rawStake * QUADRATIC_SCALE);
        
        // 2. Time weighting: earlier votes get bonus (up to 72% for voting at start)
        uint256 timeRemaining = banCase.marketOpenUntil > block.timestamp 
            ? banCase.marketOpenUntil - block.timestamp 
            : 0;
        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 timeBonus = hoursRemaining * TIME_WEIGHT_BPS_PER_HOUR;
        if (timeBonus > 7200) timeBonus = 7200; // Cap at 72% bonus
        
        uint256 timeWeightedVote = quadraticWeight * (10000 + timeBonus) / 10000;
        
        // 3. Vote cap: max 25% of current total votes to prevent whale domination
        uint256 currentTotalVotes = banCase.yesVotes + banCase.noVotes;
        if (currentTotalVotes > 0) {
            uint256 maxWeight = (currentTotalVotes * MAX_VOTE_WEIGHT_BPS) / 10000;
            if (timeWeightedVote > maxWeight) {
                timeWeightedVote = maxWeight;
            }
        }
        
        return timeWeightedVote;
    }
    
    /**
     * @notice Integer square root using Babylonian method
     * @param x Input value
     * @return y Square root of x
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Resolve a completed case
     * @dev Anyone can call after voting period ends
     *      Protected by nonReentrant. State change after external call is benign (case already resolved)
     *      Uses timestamp for voting period check - intentional design
     *      Requires minimum quorum (10% of total staked) for validity
     * @param caseId Case to resolve
     */
    // slither-disable-next-line reentrancy-benign,timestamp
    function resolveCase(bytes32 caseId) external nonReentrant caseExists(caseId) {
        BanCase storage banCase = cases[caseId];

        if (banCase.resolved) revert CaseAlreadyResolved();
        if (block.timestamp < banCase.marketOpenUntil) revert VotingNotEnded();
        
        // Check quorum: at least 10% of total staked must have participated
        uint256 totalVotes = banCase.yesVotes + banCase.noVotes;
        uint256 requiredQuorum = (totalStaked * MIN_QUORUM_BPS) / 10000;
        
        // If quorum not reached, case is auto-rejected (benefit of doubt to target)
        bool quorumReached = totalVotes >= requiredQuorum;

        // Determine outcome (quorum failure = ban rejected)
        bool banUpheld = quorumReached && (banCase.yesVotes > banCase.noVotes);

        // Update case
        banCase.resolved = true;
        banCase.outcome = banUpheld ? MarketOutcome.BAN_UPHELD : MarketOutcome.BAN_REJECTED;
        banCase.status = banUpheld ? BanStatus.BANNED : BanStatus.CLEARED;

        emit CaseResolved(caseId, banCase.outcome, banCase.yesVotes, banCase.noVotes);

        // Distribute rewards (asymmetric slashing applied in _distributeRewards)
        _distributeRewards(caseId);

        // Apply or remove ban via BanManager
        if (banUpheld) {
            // Apply permanent ban
            // slither-disable-next-line encode-packed-collision
            // @audit-ok String concatenation for ban reason, not hashed - no collision risk
            banManager.applyAddressBan(
                banCase.target,
                caseId,
                string(abi.encodePacked("Moderation Market: ", banCase.reason))
            );
        } else {
            // Clear the on-notice ban
            banManager.removeAddressBan(banCase.target);
        }

        // Clear active case
        delete activeCase[banCase.target];
    }

    /**
     * @notice Distribute rewards after case resolution
     * @dev Sends ETH to treasury (protocol fee recipient) - this is intentional
     *      Implements asymmetric slashing: failed reporters lose 2x their stake
     */
    // slither-disable-next-line arbitrary-send-eth
    function _distributeRewards(bytes32 caseId) internal {
        BanCase storage banCase = cases[caseId];

        address winner;
        address loser;
        uint256 loserStake;
        bool isFailedReporter;

        if (banCase.outcome == MarketOutcome.BAN_UPHELD) {
            // Reporter wins, takes target's stake
            winner = banCase.reporter;
            loser = banCase.target;
            loserStake = banCase.targetStake;
            isFailedReporter = false;
        } else {
            // Target wins, takes reporter's stake
            // ASYMMETRIC SLASHING: Failed reporters lose 2x their stake to discourage frivolous reports
            winner = banCase.target;
            loser = banCase.reporter;
            loserStake = banCase.reporterStake * FAILED_REPORT_PENALTY_MULTIPLIER;
            isFailedReporter = true;
        }

        if (loserStake == 0) return;

        // Calculate shares
        uint256 winnerAmount = (loserStake * WINNER_SHARE_BPS) / 10000;
        uint256 treasuryAmount = (loserStake * TREASURY_SHARE_BPS) / 10000;

        // Slash loser's stake (capped at their actual stake)
        StakeInfo storage loserInfo = stakes[loser];
        uint256 actualSlash = loserInfo.amount >= loserStake ? loserStake : loserInfo.amount;
        if (actualSlash > 0) {
            loserInfo.amount -= actualSlash;
            totalStaked -= actualSlash;
            if (loserInfo.amount == 0) {
                loserInfo.isStaked = false;
            }
        }
        
        // Recalculate winner amount based on actual slash
        if (actualSlash < loserStake) {
            winnerAmount = (actualSlash * WINNER_SHARE_BPS) / 10000;
            treasuryAmount = (actualSlash * TREASURY_SHARE_BPS) / 10000;
        }

        // Credit winner's stake (only if winner address is not zero - target may not have staked)
        if (winner != address(0) && winnerAmount > 0) {
            StakeInfo storage winnerInfo = stakes[winner];
            winnerInfo.amount += winnerAmount;
            totalStaked += winnerAmount;
            if (!winnerInfo.isStaked) {
                winnerInfo.isStaked = true;
                winnerInfo.stakedAt = block.timestamp;
                winnerInfo.stakedBlock = block.number;
            }
        }

        // Transfer treasury share
        if (treasuryAmount > 0) {
            if (address(stakingToken) == address(0)) {
                // slither-disable-next-line low-level-calls
                (bool success,) = treasury.call{value: treasuryAmount}("");
                require(success, "Treasury transfer failed");
            } else {
                stakingToken.safeTransfer(treasury, treasuryAmount);
            }
        }

        emit RewardsDistributed(caseId, winner, winnerAmount, treasuryAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              APPEALS / RE-REVIEW
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Request re-review of a ban by staking 10x
     * @dev Only banned users can appeal, max 3 appeals
     * @param caseId Original case to appeal
     */
    function requestReReview(bytes32 caseId) external payable nonReentrant caseExists(caseId) {
        BanCase storage banCase = cases[caseId];

        if (banCase.target != msg.sender) revert NotCaseParty();
        if (banCase.status != BanStatus.BANNED) revert NotBanned();
        if (banCase.appealCount >= MAX_APPEAL_COUNT) revert MaxAppealsReached();

        // Require 10x stake
        uint256 requiredStake = banCase.reporterStake * RE_REVIEW_MULTIPLIER;
        if (msg.value < requiredStake) revert InsufficientStake();

        // Add to stake
        StakeInfo storage stakeInfo = stakes[msg.sender];
        _checkpoint(msg.sender);
        stakeInfo.amount += msg.value;
        stakeInfo.stakedAt = block.timestamp;
        stakeInfo.stakedBlock = block.number;
        stakeInfo.lastActivityBlock = block.number;
        stakeInfo.isStaked = true;
        
        // Track total staked
        totalStaked += msg.value;

        // Calculate quadratic vote weights for appeal
        uint256 reporterVoteWeight = _sqrt(banCase.reporterStake * QUADRATIC_SCALE);
        uint256 appellantVoteWeight = _sqrt(msg.value * QUADRATIC_SCALE);

        // Reopen case for appeal with quadratic weights
        banCase.appealCount++;
        banCase.status = BanStatus.APPEALING;
        banCase.resolved = false;
        banCase.outcome = MarketOutcome.PENDING;
        banCase.targetStake = msg.value;
        banCase.totalPot = banCase.reporterStake + msg.value;
        banCase.yesVotes = reporterVoteWeight;      // Quadratic weighted
        banCase.noVotes = appellantVoteWeight;       // Quadratic weighted
        banCase.marketOpenUntil = block.timestamp + APPEAL_VOTING_PERIOD;

        activeCase[msg.sender] = caseId;

        // Update votes with quadratic weights
        votes[caseId][msg.sender] = Vote({
            position: VotePosition.NO,
            weight: appellantVoteWeight,
            stakedAt: block.timestamp,
            hasVoted: true,
            hasClaimed: false
        });

        emit AppealOpened(caseId, msg.sender, msg.value, banCase.appealCount);
        emit Staked(msg.sender, msg.value, stakeInfo.amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              FLASH LOAN PROTECTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a stake checkpoint
     */
    function _checkpoint(address user) internal {
        StakeInfo storage stakeInfo = stakes[user];
        _stakeCheckpoints[user].push(StakeCheckpoint({
            blockNumber: block.number,
            stakeAmount: stakeInfo.amount
        }));

        emit StakeCheckpointed(user, block.number, stakeInfo.amount);
    }

    /**
     * @notice Get stake at a specific block (for historical verification)
     * @param user User address
     * @param blockNumber Block to query
     * @return Stake amount at that block
     */
    function getStakeAtBlock(address user, uint256 blockNumber) external view returns (uint256) {
        StakeCheckpoint[] storage checkpoints = _stakeCheckpoints[user];

        if (checkpoints.length == 0) return 0;

        // Binary search for the checkpoint
        uint256 low = 0;
        uint256 high = checkpoints.length;

        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (checkpoints[mid].blockNumber <= blockNumber) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return low > 0 ? checkpoints[low - 1].stakeAmount : 0;
    }

    /**
     * @notice Check if user's stake is valid for voting (anti-flash loan)
     * @dev Uses timestamp for stake age check - intentional for flash loan protection
     * @param user User to check
     * @return Valid if stake is old enough
     */
    // slither-disable-next-line timestamp
    function isStakeValidForVoting(address user) external view returns (bool) {
        StakeInfo storage stakeInfo = stakes[user];
        if (!stakeInfo.isStaked) return false;
        if (block.timestamp < stakeInfo.stakedAt + MIN_STAKE_AGE) return false;
        if (block.number < stakeInfo.stakedBlock + MIN_STAKE_BLOCKS) return false;
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get case details
     */
    function getCase(bytes32 caseId) external view returns (BanCase memory) {
        return cases[caseId];
    }

    /**
     * @notice Get user's stake info
     */
    function getStake(address user) external view returns (StakeInfo memory) {
        return stakes[user];
    }

    /**
     * @notice Get vote details for a case
     */
    function getVote(bytes32 caseId, address voter) external view returns (Vote memory) {
        return votes[caseId][voter];
    }

    /**
     * @notice Get all case IDs
     */
    function getAllCaseIds() external view returns (bytes32[] memory) {
        return allCaseIds;
    }

    /**
     * @notice Get case count
     */
    function getCaseCount() external view returns (uint256) {
        return allCaseIds.length;
    }

    /**
     * @notice Check if user is staked and can report
     * @dev Uses timestamp for stake age check - intentional for flash loan protection
     */
    // slither-disable-next-line timestamp
    function canReport(address user) external view returns (bool) {
        StakeInfo storage stakeInfo = stakes[user];
        if (!stakeInfo.isStaked) return false;
        if (stakeInfo.amount < minReporterStake) return false;
        if (block.timestamp < stakeInfo.stakedAt + MIN_STAKE_AGE) return false;
        if (block.number < stakeInfo.stakedBlock + MIN_STAKE_BLOCKS) return false;
        return true;
    }

    /**
     * @notice Check if user is currently banned
     * @dev bytes32(0) check is intentional for empty case detection
     */
    // slither-disable-next-line incorrect-equality,timestamp
    function isBanned(address user) external view returns (bool) {
        bytes32 caseId = activeCase[user];
        if (caseId == bytes32(0)) return false;

        BanCase storage banCase = cases[caseId];
        return banCase.status == BanStatus.BANNED ||
               banCase.status == BanStatus.ON_NOTICE;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function setMinReporterStake(uint256 amount) external onlyOwner {
        uint256 oldValue = minReporterStake;
        minReporterStake = amount;
        emit ConfigUpdated("minReporterStake", oldValue, amount);
    }

    function setMinChallengeStake(uint256 amount) external onlyOwner {
        uint256 oldValue = minChallengeStake;
        minChallengeStake = amount;
        emit ConfigUpdated("minChallengeStake", oldValue, amount);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
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

