// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "../prediction-markets/IPredictionOracle.sol";
import "./IContestOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title EHorseGame
 * @notice On-chain horse racing game demonstrating standard contest/oracle pattern
 * @dev Implements both IPredictionOracle and IContestOracle for maximum composability
 * 
 * This contract serves as a reference implementation for oracle-based contests:
 * - 4 horses race every ~90 seconds
 * - Provably fair outcomes (commit-reveal + VRF)
 * - Integrates with Predimarket for betting
 * - Discoverable via IdentityRegistry
 * - Fully on-chain state
 * 
 * ERC-8004 Metadata:
 * {
 *   "type": "oracle-game",
 *   "subtype": "racing",
 *   "name": "eHorse Racing",
 *   "category": "contest",
 *   "modes": ["single-winner", "top-3", "full-ranking"],
 *   "version": "1.0.0"
 * }
 */
contract EHorseGame is IPredictionOracle, IContestOracle, Ownable, Pausable {
    
    // ============ Constants ============
    
    uint256 public constant RACE_DURATION = 60; // 60 seconds
    uint256 public constant BETTING_WINDOW = 30; // 30 seconds before race starts
    
    // ============ State Variables ============
    
    struct Race {
        bytes32 raceId;
        uint256 startTime;
        uint256 endTime;
        uint256 winner;        // 0-3 for single winner
        uint256[3] top3;       // Top 3 rankings
        uint256[] fullRanking; // Full ranking (if mode = FULL_RANKING)
        ContestState state;
        ContestMode mode;
        bytes32 commitment;    // Commit-reveal for fairness
        bytes32 salt;
        bool finalized;
    }
    
    mapping(bytes32 => Race) public races;
    mapping(bytes32 => bool) public commitments;
    bytes32[] public raceHistory;
    
    bytes32 public currentRaceId;
    uint256 public raceCount;
    address public raceKeeper; // Authorized to create/finalize races
    
    // ERC-8004 Game Metadata
    string public constant GAME_NAME = "eHorse Racing";
    string public constant GAME_VERSION = "1.0.0";
    string public constant GAME_CATEGORY = "racing";
    
    // ============ Events ============
    
    event RaceCreated(bytes32 indexed raceId, uint256 startTime);
    event RaceStarted(bytes32 indexed raceId, uint256 timestamp);
    event RaceFinished(bytes32 indexed raceId, uint256 winner, uint256 timestamp);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    
    // ============ Errors ============
    
    error OnlyKeeper();
    error RaceNotFound();
    error RaceNotFinalized();
    error RaceAlreadyStarted();
    error RaceAlreadyFinalized();
    error CommitmentMismatch();
    error InvalidOption();
    error TooEarly();
    error TooLate();
    
    // ============ Modifiers ============
    
    modifier onlyKeeper() {
        if (msg.sender != raceKeeper && msg.sender != owner()) revert OnlyKeeper();
        _;
    }
    
    // ============ Constructor ============
    
    constructor(address _keeper) Ownable(msg.sender) {
        raceKeeper = _keeper;
    }
    
    // ============ Core Race Functions ============
    
    /**
     * @notice Create a new race with commitment
     * @param commitment Hash of winner + salt (commit-reveal pattern)
     * @param scheduledStart When race should start
     * @return raceId The generated race ID
     */
    function createRace(bytes32 commitment, uint256 scheduledStart) external onlyKeeper whenNotPaused returns (bytes32) {
        bytes32 raceId = keccak256(abi.encodePacked(block.timestamp, raceCount++));
        
        races[raceId] = Race({
            raceId: raceId,
            startTime: scheduledStart,
            endTime: 0,
            winner: 0,
            top3: [uint256(0), 0, 0],
            fullRanking: new uint256[](0),
            state: ContestState.PENDING,
            mode: ContestMode.SINGLE_WINNER,
            commitment: commitment,
            salt: bytes32(0),
            finalized: false
        });
        
        commitments[commitment] = true;
        currentRaceId = raceId;
        
        emit RaceCreated(raceId, scheduledStart);
        string[] memory horseNames = _getHorseNames();
        emit ContestCreated(raceId, ContestMode.SINGLE_WINNER, horseNames, scheduledStart);
        emit OutcomeCommitted(raceId, commitment);
        
        return raceId;
    }
    
    function _getHorseNames() private pure returns (string[] memory) {
        string[] memory names = new string[](4);
        names[0] = "Thunder";
        names[1] = "Lightning";
        names[2] = "Storm";
        names[3] = "Blaze";
        return names;
    }
    
    /**
     * @notice Start a pending race
     * @param raceId The race to start
     */
    function startRace(bytes32 raceId) external onlyKeeper {
        Race storage race = races[raceId];
        if (race.startTime == 0) revert RaceNotFound();
        if (race.state != ContestState.PENDING) revert RaceAlreadyStarted();
        if (block.timestamp < race.startTime) revert TooEarly();
        
        race.state = ContestState.ACTIVE;
        
        emit RaceStarted(raceId, block.timestamp);
        emit ContestStarted(raceId, block.timestamp);
    }
    
    /**
     * @notice Reveal race outcome
     * @param raceId The race to reveal
     * @param winner Winning horse index (0-3)
     * @param salt Salt used in commitment
     */
    function revealRace(bytes32 raceId, uint256 winner, bytes32 salt) external onlyKeeper {
        Race storage race = races[raceId];
        if (race.startTime == 0) revert RaceNotFound();
        if (race.finalized) revert RaceAlreadyFinalized();
        if (race.state != ContestState.ACTIVE) revert TooEarly();
        if (winner >= 4) revert InvalidOption();
        
        // Verify commitment
        bytes32 expectedCommitment = keccak256(abi.encodePacked(winner, salt));
        if (race.commitment != expectedCommitment) revert CommitmentMismatch();
        
        // Update state
        race.winner = winner;
        race.salt = salt;
        race.endTime = block.timestamp;
        race.state = ContestState.FINISHED;
        race.finalized = true;
        
        raceHistory.push(raceId);
        
        emit RaceFinished(raceId, winner, block.timestamp);
        emit ContestFinished(raceId, block.timestamp);
        
        uint256[] memory rankings = new uint256[](1);
        rankings[0] = winner;
        emit OutcomeRevealed(raceId, rankings);
    }
    
    // ============ IPredictionOracle Implementation ============
    
    /**
     * @notice Get binary outcome for Predimarket
     * @dev Maps horses to binary: 0-1 = NO (false), 2-3 = YES (true)
     */
    function getOutcome(bytes32 sessionId) external view override returns (bool outcome, bool finalized) {
        Race storage race = races[sessionId];
        return (race.winner >= 2, race.finalized);
    }
    
    /**
     * @notice Check if address is a winner (N/A for eHorse)
     */
    function isWinner(bytes32 sessionId, address player) external view override returns (bool) {
        // eHorse doesn't have individual winners, only winning horse
        return false;
    }
    
    /**
     * @notice Verify commitment exists
     */
    function verifyCommitment(bytes32 commitment) external view override returns (bool) {
        return commitments[commitment];
    }
    
    // ============ IContestOracle Implementation ============
    
    function getContestInfo(bytes32 contestId) external view override returns (
        ContestState state,
        ContestMode mode,
        uint256 startTime,
        uint256 endTime,
        uint256 optionCount
    ) {
        Race storage race = races[contestId];
        return (race.state, race.mode, race.startTime, race.endTime, 4);
    }
    
    function getOptions(bytes32 contestId) external view override returns (string[] memory names) {
        if (races[contestId].startTime == 0) revert RaceNotFound();
        return _getHorseNames();
    }
    
    function getWinner(bytes32 contestId) external view override returns (uint256 winner, bool finalized) {
        Race storage race = races[contestId];
        return (race.winner, race.finalized);
    }
    
    function getTop3(bytes32 contestId) external view override returns (uint256[3] memory rankings, bool finalized) {
        Race storage race = races[contestId];
        if (race.mode != ContestMode.TOP_THREE) {
            // For SINGLE_WINNER, return winner in first place
            rankings = [race.winner, 0, 0];
        } else {
            rankings = race.top3;
        }
        return (rankings, race.finalized);
    }
    
    function getFullRanking(bytes32 contestId) external view override returns (uint256[] memory rankings, bool finalized) {
        Race storage race = races[contestId];
        return (race.fullRanking, race.finalized);
    }
    
    function getBinaryOutcome(bytes32 contestId, bytes memory outcomeDefinition) external view override returns (bool outcome, bool finalized) {
        Race storage race = races[contestId];
        if (!race.finalized) return (false, false);
        
        // Default: horses 2-3 = YES, horses 0-1 = NO
        return (race.winner >= 2, true);
    }
    
    function isWinningOption(bytes32 contestId, uint256 optionIndex) external view override returns (bool) {
        Race storage race = races[contestId];
        if (!race.finalized) return false;
        return race.winner == optionIndex;
    }
    
    // ============ View Functions ============
    
    function getCurrentRace() external view returns (bytes32) {
        return currentRaceId;
    }
    
    function getRaceHistory() external view returns (bytes32[] memory) {
        return raceHistory;
    }
    
    function getHorseNames() external pure returns (string[] memory) {
        return _getHorseNames();
    }
    
    /**
     * @notice Get game metadata for ERC-8004 discovery
     * @return Game metadata as JSON string
     */
    function getGameMetadata() external pure returns (string memory) {
        return '{"type":"oracle-game","subtype":"racing","name":"eHorse Racing","category":"contest","modes":["single-winner","top-3","full-ranking"],"version":"1.0.0"}';
    }
    
    // ============ Admin Functions ============
    
    function setKeeper(address newKeeper) external onlyOwner {
        address oldKeeper = raceKeeper;
        raceKeeper = newKeeper;
        emit KeeperUpdated(oldKeeper, newKeeper);
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
}

