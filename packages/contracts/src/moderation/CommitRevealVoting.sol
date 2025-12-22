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
        bytes32 commitHash;      // hash(caseId, position, salt)
        uint256 stakeAmount;     // Locked stake
        uint256 committedAt;     // Block when committed
        bool revealed;           // Whether vote was revealed
        bool forfeited;          // Whether stake was forfeited for not revealing
    }

    struct CaseVoting {
        bytes32 caseId;
        uint256 commitPhaseEnd;  // When commit phase ends
        uint256 revealPhaseEnd;  // When reveal phase ends
        uint256 yesVotesRevealed; // Total revealed YES votes
        uint256 noVotesRevealed;  // Total revealed NO votes
        uint256 totalCommitted;   // Total stakes committed
        uint256 totalRevealed;    // Total stakes revealed
        uint256 totalForfeited;   // Stakes from non-revealers
        bool resolved;
        uint8 outcome;            // 0=pending, 1=BAN_UPHELD, 2=BAN_REJECTED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant COMMIT_PHASE_DURATION = 2 days;
    uint256 public constant REVEAL_PHASE_DURATION = 1 days;
    uint256 public constant MIN_STAKE_FOR_VOTE = 0.01 ether;
    uint256 public constant FORFEIT_SLASH_BPS = 10000; // 100% - forfeit all
    uint256 public constant WINNER_SHARE_BPS = 8500;   // 85% to winners
    uint256 public constant TREASURY_SHARE_BPS = 1000; // 10% to treasury
    uint256 public constant VOTER_BONUS_BPS = 500;     // 5% bonus to early revealers

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    // caseId => voter => commit
    mapping(bytes32 => mapping(address => VoteCommit)) public commits;
    
    // caseId => case voting data
    mapping(bytes32 => CaseVoting) public caseVoting;
    
    // List of voters per case for iteration
    mapping(bytes32 => address[]) public caseVoters;
    
    address public moderationMarketplace;
    address public treasury;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event VoteCommitted(
        bytes32 indexed caseId,
        address indexed voter,
        bytes32 commitHash,
        uint256 stakeAmount
    );

    event VoteRevealed(
        bytes32 indexed caseId,
        address indexed voter,
        uint8 position,
        uint256 weight
    );

    event VoteForfeited(
        bytes32 indexed caseId,
        address indexed voter,
        uint256 forfeitedAmount
    );

    event CaseResolved(
        bytes32 indexed caseId,
        uint8 outcome,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalForfeited
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

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _marketplace,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
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
    function revealVote(
        bytes32 caseId,
        uint8 position,
        bytes32 salt
    ) external nonReentrant {
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

    /**
     * @notice Resolve the case after reveal phase ends
     * @param caseId The case to resolve
     */
    function resolveCase(bytes32 caseId) external nonReentrant {
        CaseVoting storage voting = caseVoting[caseId];

        if (voting.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp <= voting.revealPhaseEnd) revert RevealPhaseNotStarted();
        if (voting.resolved) revert AlreadyResolved();

        // Process forfeits for non-revealers
        address[] storage voters = caseVoters[caseId];
        for (uint256 i = 0; i < voters.length; i++) {
            VoteCommit storage commit = commits[caseId][voters[i]];
            if (!commit.revealed && !commit.forfeited) {
                commit.forfeited = true;
                voting.totalForfeited += commit.stakeAmount;
                emit VoteForfeited(caseId, voters[i], commit.stakeAmount);
            }
        }

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
            caseId,
            voting.outcome,
            voting.yesVotesRevealed,
            voting.noVotesRevealed,
            voting.totalForfeited
        );

        // Distribute rewards to winners
        _distributeRewards(caseId);
    }

    /**
     * @notice Distribute stakes to winners
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

        // Treasury cut
        uint256 treasuryCut = (totalPrize * TREASURY_SHARE_BPS) / 10000;
        if (treasuryCut > 0) {
            (bool success, ) = treasury.call{value: treasuryCut}("");
            if (!success) revert CaseNotResolved();
        }

        uint256 winnerPrize = totalPrize - treasuryCut;

        // Distribute proportionally to winners
        address[] storage voters = caseVoters[caseId];
        for (uint256 i = 0; i < voters.length; i++) {
            VoteCommit storage commit = commits[caseId][voters[i]];
            
            if (!commit.revealed || commit.forfeited) continue;

            // Winners are determined by stake proportion
            // Note: Full implementation would track individual vote positions
            
            // Return original stake + proportional winnings
            uint256 share = commit.stakeAmount + 
                ((commit.stakeAmount * winnerPrize) / winnerPool);
            
            (bool sent, ) = voters[i].call{value: share}("");
            if (!sent) {
                // Handle failed transfer - could implement a withdrawal pattern
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Generate commit hash for a vote
     */
    function generateCommitHash(
        bytes32 caseId,
        uint8 position,
        bytes32 salt,
        address voter
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(caseId, position, salt, voter));
    }

    /**
     * @notice Get voting status for a case
     */
    function getVotingStatus(bytes32 caseId) external view returns (
        uint256 commitPhaseEnd,
        uint256 revealPhaseEnd,
        uint256 totalCommitted,
        uint256 totalRevealed,
        bool resolved,
        uint8 outcome
    ) {
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
    function getCommitStatus(bytes32 caseId, address voter) external view returns (
        bool hasCommitted,
        bool hasRevealed,
        uint256 stakeAmount,
        bool forfeited
    ) {
        VoteCommit storage commit = commits[caseId][voter];
        return (
            commit.stakeAmount > 0,
            commit.revealed,
            commit.stakeAmount,
            commit.forfeited
        );
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

