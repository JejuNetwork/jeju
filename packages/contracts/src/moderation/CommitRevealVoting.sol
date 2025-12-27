// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CommitRevealVoting
 * @author Jeju Network
 * @notice Extension for ModerationMarketplace implementing commit-reveal voting
 * @dev Prevents vote buying and last-minute manipulation by hiding votes until reveal
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              COMMIT-REVEAL SCHEME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. COMMIT PHASE:
 *    - Voters submit hash(vote, salt) during voting period
 *    - Actual vote direction is hidden
 *    - Stakes are locked upon commit
 *
 * 2. REVEAL PHASE:
 *    - After voting ends, voters reveal their actual votes
 *    - Contract verifies hash matches commit
 *    - Unrevealed votes are forfeited (penalized)
 *
 * 3. RESOLUTION:
 *    - Only revealed votes count toward outcome
 *    - Winners split losers' stakes
 *    - Non-revealers lose their stake entirely
 *
 */
contract CommitRevealVoting is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct VoteCommit {
        bytes32 commitHash; // hash(caseId, position, salt)
        uint256 stakeAmount; // Locked stake
        uint256 committedAt; // Block when committed
        bool revealed; // Whether vote was revealed
        bool forfeited; // Whether stake was forfeited for not revealing
    }

    struct CaseVoting {
        bytes32 caseId;
        uint256 commitPhaseEnd; // When commit phase ends
        uint256 revealPhaseEnd; // When reveal phase ends
        uint256 yesVotesRevealed; // Total revealed YES votes
        uint256 noVotesRevealed; // Total revealed NO votes
        uint256 totalCommitted; // Total stakes committed
        uint256 totalRevealed; // Total stakes revealed
        uint256 totalForfeited; // Stakes from non-revealers
        bool resolved;
        uint8 outcome; // 0=pending, 1=BAN_UPHELD, 2=BAN_REJECTED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant COMMIT_PHASE_DURATION = 2 days;
    uint256 public constant REVEAL_PHASE_DURATION = 1 days;
    uint256 public constant MIN_STAKE_FOR_VOTE = 0.01 ether;
    uint256 public constant FORFEIT_SLASH_BPS = 10000; // 100% - forfeit all
    uint256 public constant WINNER_SHARE_BPS = 8500; // 85% to winners
    uint256 public constant TREASURY_SHARE_BPS = 1000; // 10% to treasury
    uint256 public constant VOTER_BONUS_BPS = 500; // 5% bonus to early revealers

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    // caseId => voter => commit
    mapping(bytes32 => mapping(address => VoteCommit)) public commits;

    // caseId => case voting data
    mapping(bytes32 => CaseVoting) public caseVoting;

    // List of voters per case for iteration
    mapping(bytes32 => address[]) public caseVoters;

    // Track revealed vote positions: caseId => voter => position (0=YES, 1=NO)
    mapping(bytes32 => mapping(address => uint8)) public revealedPositions;

    address public moderationMarketplace;
    address public treasury;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event VoteCommitted(bytes32 indexed caseId, address indexed voter, bytes32 commitHash, uint256 stakeAmount);

    event VoteRevealed(bytes32 indexed caseId, address indexed voter, uint8 position, uint256 weight);

    event VoteForfeited(bytes32 indexed caseId, address indexed voter, uint256 forfeitedAmount);

    event CaseResolved(
        bytes32 indexed caseId, uint8 outcome, uint256 yesVotes, uint256 noVotes, uint256 totalForfeited
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error CaseNotFound();
    error CommitPhaseEnded();
    error RevealPhaseNotStarted();
    error RevealPhaseEnded();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error InvalidCommitHash();
    error InsufficientStake();
    error CaseNotResolved();
    error AlreadyResolved();
    error NoEarningsToClaim();
    error BatchTooLarge();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _marketplace, address _treasury, address _owner) Ownable(_owner) {
        moderationMarketplace = _marketplace;
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              COMMIT PHASE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize commit-reveal voting for a case
     * @param caseId The case to initialize voting for
     */
    function initializeVoting(bytes32 caseId) external {
        if (msg.sender != moderationMarketplace) revert CaseNotFound();

        CaseVoting storage voting = caseVoting[caseId];
        voting.caseId = caseId;
        voting.commitPhaseEnd = block.timestamp + COMMIT_PHASE_DURATION;
        voting.revealPhaseEnd = block.timestamp + COMMIT_PHASE_DURATION + REVEAL_PHASE_DURATION;
    }

    /**
     * @notice Commit a vote (hash of position + salt)
     * @param caseId The case to vote on
     * @param commitHash hash(caseId, position, salt)
     */
    function commitVote(bytes32 caseId, bytes32 commitHash) external payable nonReentrant {
        CaseVoting storage voting = caseVoting[caseId];

        if (voting.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp > voting.commitPhaseEnd) revert CommitPhaseEnded();
        if (commits[caseId][msg.sender].stakeAmount > 0) revert AlreadyCommitted();
        if (msg.value < MIN_STAKE_FOR_VOTE) revert InsufficientStake();

        commits[caseId][msg.sender] = VoteCommit({
            commitHash: commitHash,
            stakeAmount: msg.value,
            committedAt: block.number,
            revealed: false,
            forfeited: false
        });

        voting.totalCommitted += msg.value;
        caseVoters[caseId].push(msg.sender);

        emit VoteCommitted(caseId, msg.sender, commitHash, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              REVEAL PHASE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Reveal a previously committed vote
     * @param caseId The case
     * @param position 0 = YES (ban), 1 = NO (clear)
     * @param salt The random salt used in commit
     */
    function revealVote(bytes32 caseId, uint8 position, bytes32 salt) external nonReentrant {
        CaseVoting storage voting = caseVoting[caseId];
        VoteCommit storage commit = commits[caseId][msg.sender];

        if (voting.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp < voting.commitPhaseEnd) revert RevealPhaseNotStarted();
        if (block.timestamp > voting.revealPhaseEnd) revert RevealPhaseEnded();
        if (commit.revealed) revert AlreadyRevealed();
        if (commit.stakeAmount == 0) revert CaseNotFound();

        // Verify commit hash
        bytes32 expectedHash = keccak256(abi.encodePacked(caseId, position, salt, msg.sender));
        if (commit.commitHash != expectedHash) revert InvalidCommitHash();

        commit.revealed = true;
        voting.totalRevealed += commit.stakeAmount;
        revealedPositions[caseId][msg.sender] = position;

        // Count vote with stake weight
        if (position == 0) {
            voting.yesVotesRevealed += commit.stakeAmount;
        } else {
            voting.noVotesRevealed += commit.stakeAmount;
        }

        emit VoteRevealed(caseId, msg.sender, position, commit.stakeAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Maximum voters to process in a single transaction to prevent DoS
    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @notice Track processed index for forfeit processing
    mapping(bytes32 => uint256) public forfeitProcessedIndex;

    /**
     * @notice Process forfeits for a batch of voters (call multiple times if needed)
     * @param caseId The case to process forfeits for
     * @param maxToProcess Maximum number of voters to process in this call
     */
    function processForfeits(bytes32 caseId, uint256 maxToProcess) external nonReentrant {
        CaseVoting storage voting = caseVoting[caseId];

        if (voting.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp <= voting.revealPhaseEnd) revert RevealPhaseNotStarted();
        if (maxToProcess > MAX_BATCH_SIZE) revert BatchTooLarge();

        address[] storage voters = caseVoters[caseId];
        uint256 startIdx = forfeitProcessedIndex[caseId];
        uint256 endIdx = startIdx + maxToProcess;
        if (endIdx > voters.length) endIdx = voters.length;

        for (uint256 i = startIdx; i < endIdx; i++) {
            VoteCommit storage commit = commits[caseId][voters[i]];
            if (!commit.revealed && !commit.forfeited) {
                commit.forfeited = true;
                voting.totalForfeited += commit.stakeAmount;
                emit VoteForfeited(caseId, voters[i], commit.stakeAmount);
            }
        }

        forfeitProcessedIndex[caseId] = endIdx;
    }

    /**
     * @notice Resolve the case after reveal phase ends
     * @param caseId The case to resolve
     * @dev If there are many voters, call processForfeits() first in batches
     */
    function resolveCase(bytes32 caseId) external nonReentrant {
        CaseVoting storage voting = caseVoting[caseId];

        if (voting.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp <= voting.revealPhaseEnd) revert RevealPhaseNotStarted();
        if (voting.resolved) revert AlreadyResolved();

        // Process remaining forfeits for non-revealers (limited batch)
        address[] storage voters = caseVoters[caseId];
        uint256 startIdx = forfeitProcessedIndex[caseId];
        uint256 endIdx = startIdx + MAX_BATCH_SIZE;
        if (endIdx > voters.length) endIdx = voters.length;

        for (uint256 i = startIdx; i < endIdx; i++) {
            VoteCommit storage commit = commits[caseId][voters[i]];
            if (!commit.revealed && !commit.forfeited) {
                commit.forfeited = true;
                voting.totalForfeited += commit.stakeAmount;
                emit VoteForfeited(caseId, voters[i], commit.stakeAmount);
            }
        }
        forfeitProcessedIndex[caseId] = endIdx;

        // Determine outcome
        voting.resolved = true;
        if (voting.yesVotesRevealed > voting.noVotesRevealed) {
            voting.outcome = 1; // BAN_UPHELD
        } else if (voting.noVotesRevealed > voting.yesVotesRevealed) {
            voting.outcome = 2; // BAN_REJECTED
        } else {
            // Tie goes to NO (presumption of innocence)
            voting.outcome = 2;
        }

        emit CaseResolved(
            caseId, voting.outcome, voting.yesVotesRevealed, voting.noVotesRevealed, voting.totalForfeited
        );

        // Distribute rewards to winners
        _distributeRewards(caseId);
    }

    // Track pending withdrawals for pull pattern
    mapping(bytes32 => mapping(address => uint256)) public pendingWithdrawals;

    event WithdrawalPending(bytes32 indexed caseId, address indexed voter, uint256 amount);

    /**
     * @notice Distribute stakes to winners using pull pattern to prevent DoS
     * @dev Uses pull pattern instead of push to prevent DoS from reverting recipients
     */
    function _distributeRewards(bytes32 caseId) internal {
        CaseVoting storage voting = caseVoting[caseId];

        uint256 loserPool;
        uint256 winnerPool;
        bool yesWon = voting.outcome == 1;

        if (yesWon) {
            loserPool = voting.noVotesRevealed;
            winnerPool = voting.yesVotesRevealed;
        } else {
            loserPool = voting.yesVotesRevealed;
            winnerPool = voting.noVotesRevealed;
        }

        // Add forfeited stakes to distribution pool
        uint256 totalPrize = loserPool + voting.totalForfeited;

        if (totalPrize == 0 || winnerPool == 0) return;

        // Treasury cut - use pull pattern for treasury too
        uint256 treasuryCut = (totalPrize * TREASURY_SHARE_BPS) / 10000;
        if (treasuryCut > 0) {
            // Try direct transfer to treasury, if fails, make it claimable
            (bool success,) = treasury.call{value: treasuryCut}("");
            if (!success) {
                pendingWithdrawals[caseId][treasury] += treasuryCut;
                emit WithdrawalPending(caseId, treasury, treasuryCut);
            }
        }

        uint256 winnerPrize = totalPrize - treasuryCut;

        // Use pull pattern: calculate rewards and store for withdrawal
        // This prevents DoS from reverting recipients
        address[] storage voters = caseVoters[caseId];
        uint256 votersLen = voters.length;

        for (uint256 i = 0; i < votersLen; i++) {
            VoteCommit storage commit = commits[caseId][voters[i]];

            if (!commit.revealed || commit.forfeited) continue;

            // Winners are determined by stake proportion - only pay winning side
            uint8 voterPosition = revealedPositions[caseId][voters[i]];
            bool isWinner = (voting.outcome == 1 && voterPosition == 0) // BAN_UPHELD and voted YES
                || (voting.outcome == 2 && voterPosition == 1); // BAN_REJECTED and voted NO

            if (!isWinner) continue;

            // Return original stake + proportional winnings
            uint256 share = commit.stakeAmount + ((commit.stakeAmount * winnerPrize) / winnerPool);

            // Store for pull withdrawal instead of pushing
            pendingWithdrawals[caseId][voters[i]] = share;
            emit WithdrawalPending(caseId, voters[i], share);
        }
    }

    /**
     * @notice Withdraw pending rewards from a resolved case (pull pattern)
     * @param caseId The case ID
     */
    function withdrawReward(bytes32 caseId) external nonReentrant {
        uint256 amount = pendingWithdrawals[caseId][msg.sender];
        if (amount == 0) revert NoEarningsToClaim();

        // CEI: Clear before transfer
        pendingWithdrawals[caseId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) {
            // Re-credit on failure so user can try again
            pendingWithdrawals[caseId][msg.sender] = amount;
            revert CaseNotResolved();
        }
    }

    /**
     * @notice Get pending withdrawal amount for a voter
     */
    function getPendingWithdrawal(bytes32 caseId, address voter) external view returns (uint256) {
        return pendingWithdrawals[caseId][voter];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Generate commit hash for a vote
     */
    function generateCommitHash(bytes32 caseId, uint8 position, bytes32 salt, address voter)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(caseId, position, salt, voter));
    }

    /**
     * @notice Get voting status for a case
     */
    function getVotingStatus(bytes32 caseId)
        external
        view
        returns (
            uint256 commitPhaseEnd,
            uint256 revealPhaseEnd,
            uint256 totalCommitted,
            uint256 totalRevealed,
            bool resolved,
            uint8 outcome
        )
    {
        CaseVoting storage voting = caseVoting[caseId];
        return (
            voting.commitPhaseEnd,
            voting.revealPhaseEnd,
            voting.totalCommitted,
            voting.totalRevealed,
            voting.resolved,
            voting.outcome
        );
    }

    /**
     * @notice Get voter's commit status
     */
    function getCommitStatus(bytes32 caseId, address voter)
        external
        view
        returns (bool hasCommitted, bool hasRevealed, uint256 stakeAmount, bool forfeited)
    {
        VoteCommit storage commit = commits[caseId][voter];
        return (commit.stakeAmount > 0, commit.revealed, commit.stakeAmount, commit.forfeited);
    }

    /**
     * @notice Check which phase the voting is in
     */
    function getPhase(bytes32 caseId) external view returns (string memory) {
        CaseVoting storage voting = caseVoting[caseId];

        if (voting.caseId == bytes32(0)) return "NOT_FOUND";
        if (voting.resolved) return "RESOLVED";
        if (block.timestamp <= voting.commitPhaseEnd) return "COMMIT";
        if (block.timestamp <= voting.revealPhaseEnd) return "REVEAL";
        return "AWAITING_RESOLUTION";
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function setMarketplace(address _marketplace) external onlyOwner {
        moderationMarketplace = _marketplace;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    receive() external payable {}
}
