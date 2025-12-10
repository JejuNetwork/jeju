// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BanManager.sol";
import "./IGitHubReputationProvider.sol";

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

    /// @notice Moderator reputation tracking with full P&L history
    struct ModeratorReputation {
        uint256 successfulBans;         // Number of reports that resulted in ban
        uint256 unsuccessfulBans;       // Number of reports that were rejected
        uint256 totalSlashedFrom;       // Total amount this moderator has been slashed
        uint256 totalSlashedOthers;     // Total amount this moderator has slashed others (P&L earned)
        uint256 reputationScore;        // Computed score (0-10000 basis points)
        uint256 lastReportTimestamp;    // Anti-spam: last report time
        uint256 reportCooldownUntil;    // Cooldown after failed report
        uint256 dailyReportCount;       // Reports made today (anti-spam)
        uint256 weeklyReportCount;      // Reports made this week (anti-gaming)
        uint256 reportDayStart;         // Start of current day for counting
        uint256 reportWeekStart;        // Start of current week for counting
        uint256 consecutiveWins;        // Consecutive successful reports (for diminishing returns)
        uint256 lastActivityTimestamp;  // For reputation decay calculation
        uint256 activeReportCount;      // Currently open reports by this user
    }

    /// @notice Report evidence with detailed notes
    struct ReportEvidence {
        bytes32[] evidenceHashes;       // Multiple IPFS hashes for evidence
        string[] notes;                 // Detailed notes from reporter
        string category;                // CSAM, HACKING, SCAMMING, etc.
        uint256 timestamp;
    }

    /// @notice Reputation tier for stake requirements
    enum ReputationTier {
        UNTRUSTED,      // 0-1000 score: Can't report alone
        LOW,            // 1001-3000: Needs 3 users for quorum
        MEDIUM,         // 3001-6000: Needs 2 users for quorum  
        HIGH,           // 6001-8000: Can report alone, normal stake
        TRUSTED         // 8001-10000: Can report alone, reduced stake
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
    //                         REPUTATION CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    /// @notice Maximum reputation score (10000 = 100%)
    uint256 public constant MAX_REPUTATION = 10000;
    
    /// @notice Initial reputation for new moderators (HIGH tier - can report alone)
    uint256 public constant INITIAL_REPUTATION = 7000;
    
    /// @notice Reputation gain per successful ban
    uint256 public constant REP_GAIN_PER_WIN = 200;
    
    /// @notice Reputation loss per unsuccessful ban (3x gain for fast decay)
    uint256 public constant REP_LOSS_PER_LOSS = 600;
    
    /// @notice Additional reputation loss multiplier when slashed
    uint256 public constant SLASH_REP_MULTIPLIER = 3;
    
    /// @notice Reputation tier thresholds
    uint256 public constant TIER_LOW = 1000;
    uint256 public constant TIER_MEDIUM = 3000;
    uint256 public constant TIER_HIGH = 6000;
    uint256 public constant TIER_TRUSTED = 8000;
    
    /// @notice Quorum requirements by tier (how many low-rep users needed)
    uint256 public constant LOW_REP_QUORUM = 3;
    uint256 public constant MEDIUM_REP_QUORUM = 2;
    
    /// @notice Stake discount for trusted users (50% off)
    uint256 public constant TRUSTED_STAKE_DISCOUNT_BPS = 5000;
    
    /// @notice Cooldown after failed report (24 hours)
    uint256 public constant REPORT_COOLDOWN = 24 hours;
    
    /// @notice Minimum time between reports (24 hours - increased from 1 hour)
    uint256 public constant MIN_REPORT_INTERVAL = 24 hours;

    // ═══════════════════════════════════════════════════════════════════════
    //                    ANTI-GAMING & ANTI-SYBIL CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    /// @notice Maximum reports per day (prevents spam)
    uint256 public constant MAX_REPORTS_PER_DAY = 3;
    
    /// @notice Maximum reports per week (prevents gaming)
    uint256 public constant MAX_REPORTS_PER_WEEK = 10;
    
    /// @notice Reputation decay per week of inactivity (use-it-or-lose-it)
    uint256 public constant REP_DECAY_PER_WEEK = 100;
    
    /// @notice Maximum weeks before reputation decay (grace period)
    uint256 public constant REP_DECAY_GRACE_WEEKS = 4;
    
    /// @notice Consecutive win decay - after 5 wins, rep gains halve
    uint256 public constant CONSECUTIVE_WIN_THRESHOLD = 5;
    
    /// @notice Minimum stake age for quorum participation (7 days, not 24h)
    uint256 public constant MIN_QUORUM_STAKE_AGE = 7 days;
    
    /// @notice Minimum combined stake for quorum (prevents cheap Sybil)
    uint256 public constant MIN_COMBINED_QUORUM_STAKE = 0.5 ether;
    
    /// @notice Minimum stake per quorum participant
    uint256 public constant MIN_QUORUM_PARTICIPANT_STAKE = 0.1 ether;
    
    /// @notice Progressive cooldown multiplier (each report adds more cooldown)
    uint256 public constant PROGRESSIVE_COOLDOWN_HOURS = 6;
    
    /// @notice Maximum active reports per user
    uint256 public constant MAX_ACTIVE_REPORTS = 3;
    
    /// @notice Absolute maximum vote weight (0.5 ETH worth of quadratic power)
    uint256 public constant ABSOLUTE_MAX_VOTE_WEIGHT = 707106781186547524; // sqrt(0.5e18 * 1e18)
    
    /// @notice Conviction lock period - stake locked after voting
    uint256 public constant CONVICTION_LOCK_PERIOD = 3 days;

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

    /// @notice Moderator reputation tracking
    mapping(address => ModeratorReputation) public moderatorReputation;

    /// @notice Report evidence per case
    mapping(bytes32 => ReportEvidence) public caseEvidence;

    /// @notice Pending quorum reports: target => reporters who have reported
    mapping(address => address[]) public pendingQuorumReports;

    /// @notice External GitHub reputation provider (optional)
    IGitHubReputationProvider public gitHubReputationProvider;

    /// @notice Track which reporter has reported which target (for quorum)
    mapping(address => mapping(address => bool)) public hasReportedTarget;

    /// @notice Track conviction locks: user => unlock timestamp
    mapping(address => uint256) public convictionLockUntil;
    
    /// @notice Track quorum participant stake timestamps: target => reporter => stake age at report time
    mapping(address => mapping(address => uint256)) public quorumParticipantStakeAge;

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

    event ReputationUpdated(
        address indexed moderator,
        uint256 oldScore,
        uint256 newScore,
        uint256 successfulBans,
        uint256 unsuccessfulBans,
        int256 netPnL
    );

    event QuorumReportAdded(
        address indexed target,
        address indexed reporter,
        uint256 currentReports,
        uint256 requiredQuorum
    );

    event QuorumReached(
        address indexed target,
        bytes32 indexed caseId,
        uint256 reportCount
    );

    event EvidenceAdded(
        bytes32 indexed caseId,
        bytes32 evidenceHash,
        string note
    );

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
    error ReputationTooLow();
    error QuorumNotReached();
    error ReportCooldownActive();
    error AlreadyReportedTarget();
    error TooManyEvidenceItems();
    error BannedUserCannotVote();
    error BannedUserCannotReport();
    error DailyReportLimitReached();
    error WeeklyReportLimitReached();
    error TooManyActiveReports();
    error QuorumStakeAgeTooYoung();
    error QuorumCombinedStakeTooLow();
    error ConvictionLockActive();

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
     * @dev Checks conviction lock to prevent vote-and-run attacks
     */
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage stakeInfo = stakes[msg.sender];
        if (!stakeInfo.isStaked) revert NotStaked();
        if (stakeInfo.amount < amount) revert InsufficientStake();
        
        // Check conviction lock (prevents vote-and-run)
        if (block.timestamp < convictionLockUntil[msg.sender]) {
            revert ConvictionLockActive();
        }

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
     * @notice Open a ban case against a user (reputation-based quorum rules apply)
     * @dev High rep users can report alone, low rep users need quorum
     *      For unstaked targets: ON_NOTICE applied based on quorum
     *      For staked targets: CHALLENGED mode, both parties bet
     * @param target Address to ban
     * @param reason Ban reason
     * @param evidenceHash IPFS hash of evidence
     * @param notes Detailed notes about the report
     * @param category Report category (CSAM, HACKING, SCAMMING, etc.)
     * @return caseId The created case ID (bytes32(0) if quorum not reached)
     */
    function openCase(
        address target,
        string calldata reason,
        bytes32 evidenceHash,
        string calldata notes,
        string calldata category
    ) external nonReentrant whenNotPaused validStakeAge(msg.sender) returns (bytes32 caseId) {
        StakeInfo storage reporterStake = stakes[msg.sender];

        // Banned users cannot report others - they can only challenge/appeal their own bans
        if (banManager.isAddressBanned(msg.sender)) revert BannedUserCannotReport();

        // Initialize reporter reputation if needed
        _initializeReputation(msg.sender);
        ModeratorReputation storage rep = moderatorReputation[msg.sender];

        // Validation
        if (target == msg.sender) revert CannotBanSelf();
        
        // Check reputation-based stake requirement
        uint256 requiredStake = getRequiredStakeForReporter(msg.sender);
        if (reporterStake.amount < requiredStake) revert InsufficientStake();
        
        // Check cooldown
        if (block.timestamp < rep.reportCooldownUntil) revert ReportCooldownActive();
        
        // ═══════════════════════════════════════════════════════════════════
        //                      ANTI-SPAM CHECKS
        // ═══════════════════════════════════════════════════════════════════
        
        // Check minimum interval between reports (24 hours)
        if (block.timestamp < rep.lastReportTimestamp + MIN_REPORT_INTERVAL) revert ReportCooldownActive();
        
        // Reset daily counter if new day
        if (block.timestamp >= rep.reportDayStart + 1 days) {
            rep.dailyReportCount = 0;
            rep.reportDayStart = block.timestamp;
        }
        
        // Reset weekly counter if new week
        if (block.timestamp >= rep.reportWeekStart + 7 days) {
            rep.weeklyReportCount = 0;
            rep.reportWeekStart = block.timestamp;
        }
        
        // Check daily limit
        if (rep.dailyReportCount >= MAX_REPORTS_PER_DAY) revert DailyReportLimitReached();
        
        // Check weekly limit
        if (rep.weeklyReportCount >= MAX_REPORTS_PER_WEEK) revert WeeklyReportLimitReached();
        
        // Check active reports limit
        if (rep.activeReportCount >= MAX_ACTIVE_REPORTS) revert TooManyActiveReports();
        
        // ═══════════════════════════════════════════════════════════════════
        
        // Check if already reported this target (for quorum tracking)
        if (hasReportedTarget[msg.sender][target]) revert AlreadyReportedTarget();
        
        // Check if there's already an active case
        if (activeCase[target] != bytes32(0) && !cases[activeCase[target]].resolved) {
            revert TargetAlreadyHasActiveCase();
        }

        // Update reporter stats
        rep.lastReportTimestamp = block.timestamp;
        rep.lastActivityTimestamp = block.timestamp;
        rep.dailyReportCount++;
        rep.weeklyReportCount++;
        rep.activeReportCount++;

        // Get quorum requirement for this reporter
        uint256 quorumRequired = getQuorumRequired(msg.sender);
        
        // If reporter can't report alone, add to pending quorum
        if (quorumRequired > 1) {
            return _addToQuorumQueue(target, reason, evidenceHash, notes, category, quorumRequired);
        }

        // High-rep user - can open case immediately
        return _createCase(target, reason, evidenceHash, notes, category);
    }

    /**
     * @notice Legacy openCase function for backward compatibility
     * @dev Wraps the new function with empty notes and category
     */
    function openCase(
        address target,
        string calldata reason,
        bytes32 evidenceHash
    ) external nonReentrant whenNotPaused validStakeAge(msg.sender) returns (bytes32 caseId) {
        // Banned users cannot report others - they can only challenge/appeal their own bans
        if (banManager.isAddressBanned(msg.sender)) revert BannedUserCannotReport();
        
        StakeInfo storage reporterStake = stakes[msg.sender];

        // Initialize reporter reputation if needed
        _initializeReputation(msg.sender);
        ModeratorReputation storage rep = moderatorReputation[msg.sender];

        // Validation
        if (target == msg.sender) revert CannotBanSelf();
        
        uint256 requiredStake = getRequiredStakeForReporter(msg.sender);
        if (reporterStake.amount < requiredStake) revert InsufficientStake();
        
        if (block.timestamp < rep.reportCooldownUntil) revert ReportCooldownActive();
        
        // ═══════════════════════════════════════════════════════════════════
        //                      ANTI-SPAM CHECKS
        // ═══════════════════════════════════════════════════════════════════
        
        if (block.timestamp < rep.lastReportTimestamp + MIN_REPORT_INTERVAL) revert ReportCooldownActive();
        
        // Reset daily counter if new day
        if (block.timestamp >= rep.reportDayStart + 1 days) {
            rep.dailyReportCount = 0;
            rep.reportDayStart = block.timestamp;
        }
        
        // Reset weekly counter if new week
        if (block.timestamp >= rep.reportWeekStart + 7 days) {
            rep.weeklyReportCount = 0;
            rep.reportWeekStart = block.timestamp;
        }
        
        if (rep.dailyReportCount >= MAX_REPORTS_PER_DAY) revert DailyReportLimitReached();
        if (rep.weeklyReportCount >= MAX_REPORTS_PER_WEEK) revert WeeklyReportLimitReached();
        if (rep.activeReportCount >= MAX_ACTIVE_REPORTS) revert TooManyActiveReports();
        
        // ═══════════════════════════════════════════════════════════════════
        
        if (hasReportedTarget[msg.sender][target]) revert AlreadyReportedTarget();
        
        if (activeCase[target] != bytes32(0) && !cases[activeCase[target]].resolved) {
            revert TargetAlreadyHasActiveCase();
        }

        // Update reporter stats
        rep.lastReportTimestamp = block.timestamp;
        rep.lastActivityTimestamp = block.timestamp;
        rep.dailyReportCount++;
        rep.weeklyReportCount++;
        rep.activeReportCount++;

        uint256 quorumRequired = getQuorumRequired(msg.sender);
        
        if (quorumRequired > 1) {
            return _addToQuorumQueue(target, reason, evidenceHash, "", "", quorumRequired);
        }

        return _createCase(target, reason, evidenceHash, "", "");
    }

    /**
     * @notice Add report to quorum queue (for low-rep reporters)
     * @dev Enforces anti-Sybil protections: stake age, combined stake requirement
     */
    function _addToQuorumQueue(
        address target,
        string memory reason,
        bytes32 evidenceHash,
        string memory notes,
        string memory category,
        uint256 quorumRequired
    ) internal returns (bytes32 caseId) {
        StakeInfo storage reporterStake = stakes[msg.sender];
        
        // ═══════════════════════════════════════════════════════════════════
        //                      ANTI-SYBIL CHECKS
        // ═══════════════════════════════════════════════════════════════════
        
        // Quorum participants need LONGER stake age (7 days, not 24h)
        // This prevents rapid Sybil account creation
        if (block.timestamp < reporterStake.stakedAt + MIN_QUORUM_STAKE_AGE) {
            revert QuorumStakeAgeTooYoung();
        }
        
        // Each quorum participant must have minimum stake
        if (reporterStake.amount < MIN_QUORUM_PARTICIPANT_STAKE) {
            revert InsufficientStake();
        }
        
        // Track this report with stake age
        hasReportedTarget[msg.sender][target] = true;
        quorumParticipantStakeAge[target][msg.sender] = reporterStake.stakedAt;
        pendingQuorumReports[target].push(msg.sender);
        
        uint256 currentCount = pendingQuorumReports[target].length;
        
        emit QuorumReportAdded(target, msg.sender, currentCount, quorumRequired);
        
        // Check if quorum is now reached
        if (currentCount >= quorumRequired) {
            // Verify combined stake meets minimum (prevents cheap Sybil)
            address[] storage reporters = pendingQuorumReports[target];
            uint256 combinedStake = 0;
            
            for (uint256 i = 0; i < reporters.length; i++) {
                address reporter = reporters[i];
                
                // Verify stake age is still valid (could have been reset)
                StakeInfo storage rStake = stakes[reporter];
                if (block.timestamp < rStake.stakedAt + MIN_QUORUM_STAKE_AGE) {
                    // Invalid participant - abort quorum
                    return bytes32(0);
                }
                
                combinedStake += rStake.amount;
            }
            
            // Combined stake must meet minimum threshold
            if (combinedStake < MIN_COMBINED_QUORUM_STAKE) {
                revert QuorumCombinedStakeTooLow();
            }
            
            // Clear pending queue
            for (uint256 i = 0; i < reporters.length; i++) {
                hasReportedTarget[reporters[i]][target] = false;
                delete quorumParticipantStakeAge[target][reporters[i]];
            }
            delete pendingQuorumReports[target];
            
            // Create the case
            caseId = _createCase(target, reason, evidenceHash, notes, category);
            
            emit QuorumReached(target, caseId, currentCount);
            return caseId;
        }
        
        // Quorum not reached, return zero
        return bytes32(0);
    }

    /**
     * @notice Internal function to create a case
     */
    function _createCase(
        address target,
        string memory reason,
        bytes32 evidenceHash,
        string memory notes,
        string memory category
    ) internal returns (bytes32 caseId) {
        StakeInfo storage reporterStake = stakes[msg.sender];
        StakeInfo storage targetStake = stakes[target];

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

        // Store evidence details
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = evidenceHash;
        string[] memory noteArray = new string[](1);
        noteArray[0] = notes;
        
        caseEvidence[caseId] = ReportEvidence({
            evidenceHashes: hashes,
            notes: noteArray,
            category: category,
            timestamp: block.timestamp
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
     * @notice Add additional evidence to an existing case
     * @param caseId Case to add evidence to
     * @param evidenceHash Additional IPFS hash
     * @param note Additional note
     */
    function addEvidence(
        bytes32 caseId,
        bytes32 evidenceHash,
        string calldata note
    ) external caseExists(caseId) {
        BanCase storage banCase = cases[caseId];
        
        // Only reporter can add evidence
        if (banCase.reporter != msg.sender) revert NotCaseParty();
        if (banCase.resolved) revert CaseAlreadyResolved();
        
        ReportEvidence storage evidence = caseEvidence[caseId];
        
        // Limit evidence to prevent gas griefing
        if (evidence.evidenceHashes.length >= 10) revert TooManyEvidenceItems();
        
        evidence.evidenceHashes.push(evidenceHash);
        evidence.notes.push(note);
        
        emit EvidenceAdded(caseId, evidenceHash, note);
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
     *      Implements quadratic voting, time-weighting, vote caps, and conviction locking
     *      Banned users cannot vote on cases where they are not the target
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
        
        // Banned users cannot vote on other people's cases
        // They can only participate in their OWN case via challengeCase() or auto-vote
        if (banManager.isAddressBanned(msg.sender)) {
            revert BannedUserCannotVote();
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
        
        // ═══════════════════════════════════════════════════════════════════
        //                      CONVICTION LOCK
        // ═══════════════════════════════════════════════════════════════════
        // Lock voter's stake for CONVICTION_LOCK_PERIOD to prevent vote-and-run
        uint256 newLockUntil = block.timestamp + CONVICTION_LOCK_PERIOD;
        if (newLockUntil > convictionLockUntil[msg.sender]) {
            convictionLockUntil[msg.sender] = newLockUntil;
        }

        emit VoteCast(caseId, msg.sender, position, voteWeight);
    }
    
    /**
     * @notice Calculate effective vote weight with anti-manipulation measures
     * @dev Applies: quadratic scaling, time weighting, relative caps, and absolute caps
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
        
        // 2. ABSOLUTE CAP: No single voter can have more power than sqrt(0.5 ETH)
        // This prevents whales from dominating even when voting early
        if (quadraticWeight > ABSOLUTE_MAX_VOTE_WEIGHT) {
            quadraticWeight = ABSOLUTE_MAX_VOTE_WEIGHT;
        }
        
        // 3. Time weighting: earlier votes get bonus (up to 72% for voting at start)
        uint256 timeRemaining = banCase.marketOpenUntil > block.timestamp 
            ? banCase.marketOpenUntil - block.timestamp 
            : 0;
        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 timeBonus = hoursRemaining * TIME_WEIGHT_BPS_PER_HOUR;
        if (timeBonus > 7200) timeBonus = 7200; // Cap at 72% bonus
        
        uint256 timeWeightedVote = quadraticWeight * (10000 + timeBonus) / 10000;
        
        // 4. Relative vote cap: max 25% of current total votes to prevent domination
        uint256 currentTotalVotes = banCase.yesVotes + banCase.noVotes;
        if (currentTotalVotes > 0) {
            uint256 maxWeight = (currentTotalVotes * MAX_VOTE_WEIGHT_BPS) / 10000;
            if (timeWeightedVote > maxWeight) {
                timeWeightedVote = maxWeight;
            }
        }
        
        // 5. Final absolute cap after all bonuses
        if (timeWeightedVote > ABSOLUTE_MAX_VOTE_WEIGHT * 172 / 100) {
            timeWeightedVote = ABSOLUTE_MAX_VOTE_WEIGHT * 172 / 100; // Max with 72% bonus
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

        // Update moderator reputation
        if (isFailedReporter) {
            // Reporter failed - update their reputation negatively
            _updateReputation(banCase.reporter, false, 0, actualSlash);
        } else {
            // Reporter succeeded - update their reputation positively
            _updateReputation(banCase.reporter, true, winnerAmount, 0);
        }
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
        uint256 requiredStake = getRequiredStakeForReporter(user);
        if (stakeInfo.amount < requiredStake) return false;
        if (block.timestamp < stakeInfo.stakedAt + MIN_STAKE_AGE) return false;
        if (block.number < stakeInfo.stakedBlock + MIN_STAKE_BLOCKS) return false;
        
        // Check cooldown
        ModeratorReputation storage rep = moderatorReputation[user];
        if (block.timestamp < rep.reportCooldownUntil) return false;
        
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get the reputation tier for a user
     * @param user User address
     * @return tier The user's reputation tier
     */
    function getReputationTier(address user) public view returns (ReputationTier tier) {
        uint256 score = moderatorReputation[user].reputationScore;
        
        // New users start at INITIAL_REPUTATION (5000 = MEDIUM tier)
        if (score == 0 && moderatorReputation[user].successfulBans == 0 && 
            moderatorReputation[user].unsuccessfulBans == 0) {
            score = INITIAL_REPUTATION;
        }
        
        if (score <= TIER_LOW) return ReputationTier.UNTRUSTED;
        if (score <= TIER_MEDIUM) return ReputationTier.LOW;
        if (score <= TIER_HIGH) return ReputationTier.MEDIUM;
        if (score <= TIER_TRUSTED) return ReputationTier.HIGH;
        return ReputationTier.TRUSTED;
    }

    /**
     * @notice Get the required stake for a reporter based on their reputation
     * @dev Higher reputation = lower stake requirement
     * @param reporter Reporter address
     * @return requiredStake The stake amount required
     */
    function getRequiredStakeForReporter(address reporter) public view returns (uint256 requiredStake) {
        ReputationTier tier = getReputationTier(reporter);
        uint256 baseStake = minReporterStake;
        uint256 internalDiscountBps = 0;
        
        if (tier == ReputationTier.TRUSTED) {
            // 50% discount for trusted users
            internalDiscountBps = TRUSTED_STAKE_DISCOUNT_BPS;
        } else if (tier == ReputationTier.HIGH) {
            // 25% discount for high rep users
            internalDiscountBps = 2500;
        }
        
        // Check external GitHub reputation for additional discount
        uint256 externalDiscountBps = 0;
        if (address(gitHubReputationProvider) != address(0)) {
            externalDiscountBps = gitHubReputationProvider.getStakeDiscount(reporter);
        }
        
        // Combine discounts (capped at 75% total to maintain skin-in-game)
        uint256 totalDiscountBps = internalDiscountBps + externalDiscountBps;
        if (totalDiscountBps > 7500) {
            totalDiscountBps = 7500;
        }
        
        return (baseStake * (10000 - totalDiscountBps)) / 10000;
    }

    /**
     * @notice Get quorum required for a reporter to open a case against unstaked user
     * @dev Low rep users need multiple reporters, high rep can act alone
     * @param reporter Reporter address
     * @return quorum Number of reporters needed
     */
    function getQuorumRequired(address reporter) public view returns (uint256 quorum) {
        ReputationTier tier = getReputationTier(reporter);
        
        if (tier == ReputationTier.UNTRUSTED) {
            return type(uint256).max; // Cannot report alone
        } else if (tier == ReputationTier.LOW) {
            return LOW_REP_QUORUM; // Needs 3 users
        } else if (tier == ReputationTier.MEDIUM) {
            return MEDIUM_REP_QUORUM; // Needs 2 users
        }
        // HIGH and TRUSTED can report alone
        return 1;
    }

    /**
     * @notice Get full moderator reputation details
     * @param moderator Moderator address
     * @return rep The reputation struct
     */
    function getModeratorReputation(address moderator) external view returns (ModeratorReputation memory rep) {
        rep = moderatorReputation[moderator];
        // Initialize score for new moderators
        if (rep.reputationScore == 0 && rep.successfulBans == 0 && rep.unsuccessfulBans == 0) {
            rep.reputationScore = INITIAL_REPUTATION;
        }
    }

    /**
     * @notice Calculate net P&L for a moderator
     * @param moderator Moderator address
     * @return pnl Net profit/loss (positive = profit, negative = loss)
     */
    function getModeratorPnL(address moderator) external view returns (int256 pnl) {
        ModeratorReputation storage rep = moderatorReputation[moderator];
        return int256(rep.totalSlashedOthers) - int256(rep.totalSlashedFrom);
    }

    /**
     * @notice Check if quorum is reached for reporting a target
     * @param target Target address
     * @return reached True if enough reports received
     * @return currentCount Current number of reports
     * @return requiredCount Required number of reports (based on highest rep reporter)
     */
    function checkQuorumStatus(address target) external view returns (
        bool reached,
        uint256 currentCount,
        uint256 requiredCount
    ) {
        address[] storage reporters = pendingQuorumReports[target];
        currentCount = reporters.length;
        
        // Find the highest rep reporter's quorum requirement
        requiredCount = type(uint256).max;
        for (uint256 i = 0; i < reporters.length; i++) {
            uint256 quorum = getQuorumRequired(reporters[i]);
            if (quorum < requiredCount) {
                requiredCount = quorum;
            }
        }
        
        reached = currentCount >= requiredCount && requiredCount != type(uint256).max;
    }

    /**
     * @notice Get case evidence details
     * @param caseId Case ID
     * @return evidence The evidence struct
     */
    function getCaseEvidence(bytes32 caseId) external view returns (ReportEvidence memory evidence) {
        return caseEvidence[caseId];
    }
    
    /**
     * @notice Check if user can unstake (conviction lock check)
     * @param user User address
     * @return canUnstake True if no conviction lock active
     * @return lockUntil Timestamp when lock expires (0 if no lock)
     */
    function getConvictionLockStatus(address user) external view returns (bool canUnstake, uint256 lockUntil) {
        lockUntil = convictionLockUntil[user];
        canUnstake = block.timestamp >= lockUntil;
    }
    
    /**
     * @notice Get user's current report limits and usage
     * @param user User address
     * @return dailyUsed Reports made today
     * @return dailyLimit Max reports per day
     * @return weeklyUsed Reports made this week
     * @return weeklyLimit Max reports per week
     * @return activeReports Currently open reports
     * @return activeLimit Max concurrent reports
     */
    function getReportLimits(address user) external view returns (
        uint256 dailyUsed,
        uint256 dailyLimit,
        uint256 weeklyUsed,
        uint256 weeklyLimit,
        uint256 activeReports,
        uint256 activeLimit
    ) {
        ModeratorReputation storage rep = moderatorReputation[user];
        
        // Check if counters need reset
        dailyUsed = block.timestamp >= rep.reportDayStart + 1 days ? 0 : rep.dailyReportCount;
        weeklyUsed = block.timestamp >= rep.reportWeekStart + 7 days ? 0 : rep.weeklyReportCount;
        
        dailyLimit = MAX_REPORTS_PER_DAY;
        weeklyLimit = MAX_REPORTS_PER_WEEK;
        activeReports = rep.activeReportCount;
        activeLimit = MAX_ACTIVE_REPORTS;
    }
    
    /**
     * @notice Get quorum requirements and current status for a target
     * @param target Target address being reported
     * @return combinedStakeRequired Minimum combined stake for quorum
     * @return currentCombinedStake Current combined stake of reporters
     * @return participantsRequired Number of participants needed
     * @return currentParticipants Current number of participants
     * @return stakeAgeRequired Minimum stake age for participants
     */
    function getQuorumRequirements(address target) external view returns (
        uint256 combinedStakeRequired,
        uint256 currentCombinedStake,
        uint256 participantsRequired,
        uint256 currentParticipants,
        uint256 stakeAgeRequired
    ) {
        address[] storage reporters = pendingQuorumReports[target];
        currentParticipants = reporters.length;
        
        // Calculate current combined stake
        for (uint256 i = 0; i < reporters.length; i++) {
            currentCombinedStake += stakes[reporters[i]].amount;
        }
        
        // Find lowest quorum requirement
        participantsRequired = type(uint256).max;
        for (uint256 i = 0; i < reporters.length; i++) {
            uint256 q = getQuorumRequired(reporters[i]);
            if (q < participantsRequired) {
                participantsRequired = q;
            }
        }
        if (participantsRequired == type(uint256).max) {
            participantsRequired = LOW_REP_QUORUM; // Default
        }
        
        combinedStakeRequired = MIN_COMBINED_QUORUM_STAKE;
        stakeAgeRequired = MIN_QUORUM_STAKE_AGE;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         REPUTATION INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Update moderator reputation after case resolution
     * @dev Called internally when a case is resolved
     *      Implements consecutive win decay to prevent reputation gaming
     * @param moderator Moderator address
     * @param won Whether the moderator won the case
     * @param amountWon Amount won (0 if lost)
     * @param amountLost Amount lost (0 if won)
     */
    function _updateReputation(
        address moderator,
        bool won,
        uint256 amountWon,
        uint256 amountLost
    ) internal {
        ModeratorReputation storage rep = moderatorReputation[moderator];
        
        // Initialize if needed
        if (rep.reputationScore == 0 && rep.successfulBans == 0 && rep.unsuccessfulBans == 0) {
            rep.reputationScore = INITIAL_REPUTATION;
        }
        
        uint256 oldScore = rep.reputationScore;
        
        // Decrement active report count
        if (rep.activeReportCount > 0) {
            rep.activeReportCount--;
        }
        
        if (won) {
            rep.successfulBans++;
            rep.totalSlashedOthers += amountWon;
            rep.consecutiveWins++;
            
            // Calculate reputation gain with DIMINISHING RETURNS
            // After CONSECUTIVE_WIN_THRESHOLD wins, gains are halved
            uint256 repGain = REP_GAIN_PER_WIN;
            if (rep.consecutiveWins > CONSECUTIVE_WIN_THRESHOLD) {
                // Diminishing returns: halve gain for each consecutive win past threshold
                uint256 halvings = rep.consecutiveWins - CONSECUTIVE_WIN_THRESHOLD;
                for (uint256 i = 0; i < halvings && repGain > 10; i++) {
                    repGain = repGain / 2;
                }
            }
            
            // Increase reputation (capped at MAX_REPUTATION)
            uint256 newScore = rep.reputationScore + repGain;
            rep.reputationScore = newScore > MAX_REPUTATION ? MAX_REPUTATION : newScore;
        } else {
            rep.unsuccessfulBans++;
            rep.totalSlashedFrom += amountLost;
            rep.consecutiveWins = 0; // Reset consecutive wins
            
            // Decrease reputation with faster decay (3x the gain)
            // Additional penalty if slashed
            uint256 penalty = REP_LOSS_PER_LOSS;
            if (amountLost > 0) {
                penalty = penalty * SLASH_REP_MULTIPLIER;
            }
            
            if (rep.reputationScore > penalty) {
                rep.reputationScore -= penalty;
            } else {
                rep.reputationScore = 0;
            }
            
            // Apply PROGRESSIVE cooldown after failed report
            // Each failure adds more cooldown time
            uint256 progressiveCooldown = REPORT_COOLDOWN + 
                (rep.unsuccessfulBans * PROGRESSIVE_COOLDOWN_HOURS * 1 hours);
            
            // Cap at 7 days
            if (progressiveCooldown > 7 days) {
                progressiveCooldown = 7 days;
            }
            
            rep.reportCooldownUntil = block.timestamp + progressiveCooldown;
        }
        
        // Update last activity for decay tracking
        rep.lastActivityTimestamp = block.timestamp;
        
        // Calculate net P&L for event
        int256 netPnL = int256(rep.totalSlashedOthers) - int256(rep.totalSlashedFrom);
        
        emit ReputationUpdated(
            moderator,
            oldScore,
            rep.reputationScore,
            rep.successfulBans,
            rep.unsuccessfulBans,
            netPnL
        );
    }

    /**
     * @notice Initialize reputation for a new moderator
     * @param moderator Moderator address
     */
    function _initializeReputation(address moderator) internal {
        ModeratorReputation storage rep = moderatorReputation[moderator];
        if (rep.reputationScore == 0 && rep.successfulBans == 0 && rep.unsuccessfulBans == 0) {
            rep.reputationScore = INITIAL_REPUTATION;
            rep.lastActivityTimestamp = block.timestamp;
            rep.reportDayStart = block.timestamp;
            rep.reportWeekStart = block.timestamp;
        } else {
            // Apply reputation decay for inactive moderators
            _applyReputationDecay(moderator);
        }
    }
    
    /**
     * @notice Apply reputation decay for inactive moderators
     * @dev Reputation decays if inactive for more than REP_DECAY_GRACE_WEEKS
     *      This is a "use it or lose it" mechanism to prevent reputation hoarding
     * @param moderator Moderator address
     */
    function _applyReputationDecay(address moderator) internal {
        ModeratorReputation storage rep = moderatorReputation[moderator];
        
        if (rep.lastActivityTimestamp == 0) {
            rep.lastActivityTimestamp = block.timestamp;
            return;
        }
        
        uint256 timeSinceActivity = block.timestamp - rep.lastActivityTimestamp;
        
        // No decay during grace period
        if (timeSinceActivity <= REP_DECAY_GRACE_WEEKS * 7 days) {
            return;
        }
        
        // Calculate weeks of inactivity past grace period
        uint256 inactiveWeeks = (timeSinceActivity - REP_DECAY_GRACE_WEEKS * 7 days) / 7 days;
        
        if (inactiveWeeks == 0) {
            return;
        }
        
        // Apply decay
        uint256 totalDecay = inactiveWeeks * REP_DECAY_PER_WEEK;
        
        if (rep.reputationScore > totalDecay) {
            rep.reputationScore -= totalDecay;
        } else {
            // Floor at TIER_MEDIUM to not completely destroy rep
            rep.reputationScore = TIER_MEDIUM;
        }
        
        // Update timestamp so decay doesn't compound on next call
        rep.lastActivityTimestamp = block.timestamp;
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

    /**
     * @notice Set the GitHub reputation provider for external reputation integration
     * @param provider The GitHubReputationProvider contract address (or address(0) to disable)
     */
    function setGitHubReputationProvider(address provider) external onlyOwner {
        gitHubReputationProvider = IGitHubReputationProvider(provider);
        emit ConfigUpdated("gitHubReputationProvider", uint256(uint160(address(gitHubReputationProvider))), uint256(uint160(provider)));
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

