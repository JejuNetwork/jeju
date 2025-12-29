// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDAORegistry} from "../governance/interfaces/IDAORegistry.sol";

/**
 * @title SupremeCourt
 * @author Jeju Network
 * @notice Appeals court for moderation decisions
 * @dev Handles cases where:
 *      1. Original ban case had thin market participation
 *      2. User stakes significant amount for appeal
 *      3. New evidence is presented
 *
 * Flow: Appeal Filed -> Board Review -> Director Final Decision
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract SupremeCourt is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum AppealStatus {
        FILED,
        BOARD_REVIEW,
        DIRECTOR_DECISION,
        RESOLVED
    }

    // ============ Structs ============

    struct Appeal {
        bytes32 appealId;
        bytes32 originalCaseId; // From ModerationMarketplace
        address appellant;
        uint256 stakeAmount;
        string newEvidenceCid; // IPFS CID of new evidence
        AppealStatus status;
        uint256 boardVotesFor; // Votes in favor of appellant
        uint256 boardVotesAgainst; // Votes against appellant
        uint256 boardVoteDeadline;
        bool directorDecision; // true = restore account
        string directorReasoning;
        uint256 filedAt;
        uint256 resolvedAt;
        bool outcome; // true = ban reversed, account restored
    }

    struct BoardVote {
        address voter;
        bool inFavorOfAppellant;
        string reasoning;
        uint256 votedAt;
        bool isHuman;
    }

    // ============ Constants ============

    uint256 public constant BOARD_REVIEW_PERIOD = 7 days;
    uint256 public constant MIN_BOARD_VOTES = 3;
    uint256 public constant THIN_MARKET_THRESHOLD = 10; // Original case had < 10 voters

    // ============ State ============

    IDAORegistry public daoRegistry;
    IERC20 public stakeToken;
    address public moderationMarketplace;
    address public insuranceFund;
    bytes32 public networkDaoId; // Jeju network DAO for governance

    uint256 public appealStakeMinimum = 1000e18; // 1000 JEJU minimum
    uint256 public appealCount;

    mapping(bytes32 => Appeal) private _appeals;
    mapping(bytes32 => mapping(address => BoardVote)) private _boardVotes;
    mapping(bytes32 => address[]) private _boardVoters;
    mapping(bytes32 => bool) private _hasActiveAppeal; // originalCaseId => hasActive
    mapping(address => bytes32[]) private _userAppeals;

    bytes32[] private _allAppealIds;

    // ============ Events ============

    event AppealFiled(
        bytes32 indexed appealId, bytes32 indexed originalCaseId, address indexed appellant, uint256 stakeAmount
    );
    event BoardVoteCast(bytes32 indexed appealId, address indexed voter, bool inFavorOfAppellant, bool isHuman);
    event BoardReviewComplete(bytes32 indexed appealId, uint256 votesFor, uint256 votesAgainst);
    event DirectorDecisionMade(bytes32 indexed appealId, bool restoreAccount, string reasoning);
    event AppealResolved(bytes32 indexed appealId, bool outcome, uint256 resolvedAt);
    event StakeReturned(bytes32 indexed appealId, address indexed appellant, uint256 amount);
    event StakeSlashed(bytes32 indexed appealId, address indexed appellant, uint256 amount);
    event AppealStakeMinimumUpdated(uint256 oldMinimum, uint256 newMinimum);
    event ThinMarketThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error AppealNotFound();
    error InvalidStatus();
    error NotAppellant();
    error NotBoardMember();
    error AlreadyVoted();
    error VotingPeriodNotEnded();
    error VotingPeriodEnded();
    error NotDirector();
    error AppealAlreadyExists();
    error InvalidAddress();
    error CaseNotEligible();
    error InsufficientBoardVotes();

    // ============ Modifiers ============

    modifier onlyBoardMember() {
        if (!daoRegistry.isBoardMember(networkDaoId, msg.sender)) revert NotBoardMember();
        _;
    }

    modifier onlyDirector() {
        IDAORegistry.DirectorPersona memory persona = daoRegistry.getDirectorPersona(networkDaoId);
        bool isDirector = false;
        if (persona.isHuman) {
            isDirector = msg.sender == persona.humanAddress;
        } else {
            IDAORegistry.DAO memory dao = daoRegistry.getDAO(networkDaoId);
            isDirector = msg.sender == dao.directorAgent;
        }
        if (!isDirector && msg.sender != owner()) revert NotDirector();
        _;
    }

    modifier appealExists(bytes32 appealId) {
        if (_appeals[appealId].filedAt == 0) revert AppealNotFound();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _daoRegistry,
        address _stakeToken,
        address _moderationMarketplace,
        address _insuranceFund,
        bytes32 _networkDaoId,
        address _owner
    ) Ownable(_owner) {
        if (_daoRegistry == address(0)) revert InvalidAddress();
        if (_stakeToken == address(0)) revert InvalidAddress();
        if (_insuranceFund == address(0)) revert InvalidAddress();

        daoRegistry = IDAORegistry(_daoRegistry);
        stakeToken = IERC20(_stakeToken);
        moderationMarketplace = _moderationMarketplace;
        insuranceFund = _insuranceFund;
        networkDaoId = _networkDaoId;
    }

    // ============ Appeal Filing ============

    /**
     * @notice File an appeal against a moderation decision
     * @param originalCaseId The case ID from ModerationMarketplace
     * @param newEvidenceCid IPFS CID containing new evidence
     * @param stakeAmount Amount to stake (must be >= appealStakeMinimum)
     */
    function fileAppeal(bytes32 originalCaseId, string calldata newEvidenceCid, uint256 stakeAmount)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 appealId)
    {
        if (stakeAmount < appealStakeMinimum) {
            revert InsufficientStake(stakeAmount, appealStakeMinimum);
        }
        if (_hasActiveAppeal[originalCaseId]) {
            revert AppealAlreadyExists();
        }

        // Transfer stake
        stakeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        appealId = keccak256(abi.encodePacked(originalCaseId, msg.sender, block.timestamp, appealCount++));

        _appeals[appealId] = Appeal({
            appealId: appealId,
            originalCaseId: originalCaseId,
            appellant: msg.sender,
            stakeAmount: stakeAmount,
            newEvidenceCid: newEvidenceCid,
            status: AppealStatus.BOARD_REVIEW,
            boardVotesFor: 0,
            boardVotesAgainst: 0,
            boardVoteDeadline: block.timestamp + BOARD_REVIEW_PERIOD,
            directorDecision: false,
            directorReasoning: "",
            filedAt: block.timestamp,
            resolvedAt: 0,
            outcome: false
        });

        _hasActiveAppeal[originalCaseId] = true;
        _userAppeals[msg.sender].push(appealId);
        _allAppealIds.push(appealId);

        emit AppealFiled(appealId, originalCaseId, msg.sender, stakeAmount);
    }

    // ============ Board Review ============

    /**
     * @notice Cast a vote on an appeal (Board members only)
     * @param appealId The appeal to vote on
     * @param inFavorOfAppellant Whether to vote in favor of restoring the account
     * @param reasoning Explanation for the vote
     */
    function castBoardVote(bytes32 appealId, bool inFavorOfAppellant, string calldata reasoning)
        external
        onlyBoardMember
        appealExists(appealId)
    {
        Appeal storage appeal = _appeals[appealId];
        if (appeal.status != AppealStatus.BOARD_REVIEW) revert InvalidStatus();
        if (block.timestamp > appeal.boardVoteDeadline) revert VotingPeriodEnded();
        if (_boardVotes[appealId][msg.sender].votedAt != 0) revert AlreadyVoted();

        // Check if voter is human
        IDAORegistry.BoardMember[] memory members = daoRegistry.getBoardMembers(networkDaoId);
        bool isHuman = false;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].member == msg.sender) {
                isHuman = members[i].isHuman;
                break;
            }
        }

        _boardVotes[appealId][msg.sender] = BoardVote({
            voter: msg.sender,
            inFavorOfAppellant: inFavorOfAppellant,
            reasoning: reasoning,
            votedAt: block.timestamp,
            isHuman: isHuman
        });

        _boardVoters[appealId].push(msg.sender);

        if (inFavorOfAppellant) {
            appeal.boardVotesFor++;
        } else {
            appeal.boardVotesAgainst++;
        }

        emit BoardVoteCast(appealId, msg.sender, inFavorOfAppellant, isHuman);
    }

    /**
     * @notice Complete board review and advance to Director decision
     * @param appealId The appeal to advance
     */
    function completeReview(bytes32 appealId) external appealExists(appealId) {
        Appeal storage appeal = _appeals[appealId];
        if (appeal.status != AppealStatus.BOARD_REVIEW) revert InvalidStatus();
        if (block.timestamp < appeal.boardVoteDeadline) revert VotingPeriodNotEnded();

        uint256 totalVotes = appeal.boardVotesFor + appeal.boardVotesAgainst;
        if (totalVotes < MIN_BOARD_VOTES) revert InsufficientBoardVotes();

        appeal.status = AppealStatus.DIRECTOR_DECISION;

        emit BoardReviewComplete(appealId, appeal.boardVotesFor, appeal.boardVotesAgainst);
    }

    // ============ Director Decision ============

    /**
     * @notice Make final decision on an appeal (Director only)
     * @param appealId The appeal to decide
     * @param restoreAccount Whether to restore the banned account
     * @param reasoning Explanation for the decision
     */
    function makeDirectorDecision(bytes32 appealId, bool restoreAccount, string calldata reasoning)
        external
        onlyDirector
        appealExists(appealId)
    {
        Appeal storage appeal = _appeals[appealId];
        if (appeal.status != AppealStatus.DIRECTOR_DECISION) revert InvalidStatus();

        appeal.directorDecision = restoreAccount;
        appeal.directorReasoning = reasoning;
        appeal.status = AppealStatus.RESOLVED;
        appeal.resolvedAt = block.timestamp;
        appeal.outcome = restoreAccount;

        emit DirectorDecisionMade(appealId, restoreAccount, reasoning);

        // Handle stake
        if (restoreAccount) {
            // Appeal successful - return stake to appellant
            stakeToken.safeTransfer(appeal.appellant, appeal.stakeAmount);
            emit StakeReturned(appealId, appeal.appellant, appeal.stakeAmount);
        } else {
            // Appeal rejected - slash stake to insurance fund
            stakeToken.safeTransfer(insuranceFund, appeal.stakeAmount);
            emit StakeSlashed(appealId, appeal.appellant, appeal.stakeAmount);
        }

        // Clear active appeal flag
        _hasActiveAppeal[appeal.originalCaseId] = false;

        emit AppealResolved(appealId, restoreAccount, block.timestamp);
    }

    // ============ View Functions ============

    function getAppeal(bytes32 appealId) external view returns (Appeal memory) {
        return _appeals[appealId];
    }

    function getBoardVotes(bytes32 appealId) external view returns (BoardVote[] memory) {
        address[] memory voters = _boardVoters[appealId];
        BoardVote[] memory votes = new BoardVote[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            votes[i] = _boardVotes[appealId][voters[i]];
        }
        return votes;
    }

    function getUserAppeals(address user) external view returns (bytes32[] memory) {
        return _userAppeals[user];
    }

    function hasActiveAppeal(bytes32 originalCaseId) external view returns (bool) {
        return _hasActiveAppeal[originalCaseId];
    }

    function getAllAppeals() external view returns (bytes32[] memory) {
        return _allAppealIds;
    }

    function getActiveAppeals() external view returns (Appeal[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _allAppealIds.length; i++) {
            if (_appeals[_allAppealIds[i]].status != AppealStatus.RESOLVED) {
                activeCount++;
            }
        }

        Appeal[] memory active = new Appeal[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < _allAppealIds.length; i++) {
            if (_appeals[_allAppealIds[i]].status != AppealStatus.RESOLVED) {
                active[index] = _appeals[_allAppealIds[i]];
                index++;
            }
        }

        return active;
    }

    function getAppealStats()
        external
        view
        returns (uint256 total, uint256 pending, uint256 approved, uint256 rejected)
    {
        total = _allAppealIds.length;
        for (uint256 i = 0; i < _allAppealIds.length; i++) {
            Appeal storage appeal = _appeals[_allAppealIds[i]];
            if (appeal.status != AppealStatus.RESOLVED) {
                pending++;
            } else if (appeal.outcome) {
                approved++;
            } else {
                rejected++;
            }
        }
    }

    // ============ Admin Functions ============

    function setAppealStakeMinimum(uint256 newMinimum) external onlyOwner {
        emit AppealStakeMinimumUpdated(appealStakeMinimum, newMinimum);
        appealStakeMinimum = newMinimum;
    }

    function setModerationMarketplace(address newMarketplace) external onlyOwner {
        if (newMarketplace == address(0)) revert InvalidAddress();
        moderationMarketplace = newMarketplace;
    }

    function setInsuranceFund(address newFund) external onlyOwner {
        if (newFund == address(0)) revert InvalidAddress();
        insuranceFund = newFund;
    }

    function setDAORegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidAddress();
        daoRegistry = IDAORegistry(newRegistry);
    }

    function setNetworkDaoId(bytes32 newDaoId) external onlyOwner {
        networkDaoId = newDaoId;
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
}

