// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title GameOracle
 * @author Jeju Network
 * @notice Generic oracle for game prediction outcomes with commit-reveal pattern
 * @dev Extends PredictionOracle pattern for any game integration
 *
 * Game Integration Pattern:
 * - Questions are committed by authorized game server
 * - Users trade on prediction markets via Predimarket
 * - Questions resolve with TEE-verified outcomes
 * - Results published on-chain for composability
 *
 * Security Model:
 * - Commit-reveal prevents front-running
 * - Only authorized game server can publish
 * - TEE attestation provides verifiable compute (optional)
 * - Outcomes are immutable once revealed
 *
 * External Usage:
 * Any contract can read outcomes via IPredictionOracle:
 *   (bool outcome, bool finalized) = oracle.getOutcome(sessionId);
 *
 * Example:
 *   // 1. Game server commits at question creation
 *   oracle.commitGame(questionId, questionNumber, question, commitment, category);
 *
 *   // 2. Users trade on Predimarket or custom contracts
 *
 *   // 3. Game server reveals after resolution
 *   oracle.revealGame(sessionId, outcome, salt, teeQuote, winners, totalPayout);
 *
 *   // 4. External contracts read outcome via IPredictionOracle
 *   (bool outcome, bool finalized) = oracle.getOutcome(sessionId);
 *
 * ERC-8004 Metadata:
 * {
 *   "type": "prediction-oracle",
 *   "subtype": "game",
 *   "name": "Game Oracle",
 *   "category": "social-prediction",
 *   "version": "1.0.0"
 * }
 */
contract GameOracle is Ownable, Pausable {
    // ============ Types ============

    struct GameOutcome {
        bytes32 sessionId;
        string question;
        bool outcome; // true = YES, false = NO
        bytes32 commitment; // Hash committed at game start
        bytes32 salt; // Salt for commitment
        uint256 startTime;
        uint256 endTime;
        bytes teeQuote; // TEE attestation quote
        uint256 totalPayout;
        bool finalized;
    }

    struct GameMetadata {
        string questionId; // External question ID (e.g., database ID)
        uint256 questionNumber; // Sequential question number
        string category; // Question category
        uint256 createdAt; // Block timestamp of creation
        address creator; // Who committed this game
    }

    // ============ State Variables ============

    /// @notice Mapping from session ID to game outcome
    mapping(bytes32 => GameOutcome) public games;

    /// @notice Track used commitments to prevent reuse
    mapping(bytes32 => bool) public commitments;

    /// @notice Winners per game
    mapping(bytes32 => address[]) private _gameWinners;

    /// @notice Mapping from question ID to session ID for easy lookup
    mapping(string => bytes32) public questionIdToSessionId;

    /// @notice Reverse mapping for convenience
    mapping(bytes32 => string) public sessionIdToQuestionId;

    /// @notice Track game metadata
    mapping(bytes32 => GameMetadata) public gameMetadata;

    /// @notice All session IDs for enumeration
    bytes32[] public allSessionIds;

    /// @notice Authorized game server
    address public gameServer;

    /// @notice TEE verifier contract (optional)
    address public dstackVerifier;

    /// @notice Statistics
    uint256 public gameCount;
    uint256 public totalGamesCommitted;
    uint256 public totalGamesRevealed;

    // ============ Events ============

    event GameCommitted(
        bytes32 indexed sessionId,
        string questionId,
        uint256 questionNumber,
        string question,
        bytes32 commitment
    );

    event GameRevealed(bytes32 indexed sessionId, string questionId, bool outcome, uint256 winnersCount);

    event GameServerUpdated(address indexed oldServer, address indexed newServer);
    event DstackVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // ============ Errors ============

    error OnlyGameServer();
    error QuestionAlreadyCommitted(string questionId);
    error SessionNotFound(bytes32 sessionId);
    error InvalidQuestionId();
    error CommitmentAlreadyExists();
    error GameNotFound();
    error AlreadyFinalized();
    error CommitmentMismatch();

    // ============ Modifiers ============

    modifier onlyGameServer() {
        if (msg.sender != gameServer) revert OnlyGameServer();
        _;
    }

    // ============ Constructor ============

    constructor(address _gameServer, address _owner) Ownable(_owner) {
        gameServer = _gameServer;
        dstackVerifier = address(0);
    }

    // ============ Core Game Functions ============

    /**
     * @notice Commit a game question
     * @param questionId External question ID (for tracking)
     * @param questionNumber Sequential question number
     * @param question The yes/no question text
     * @param commitment Hash of (outcome + salt)
     * @param category Question category (optional metadata)
     * @return sessionId Generated session ID
     */
    function commitGame(
        string calldata questionId,
        uint256 questionNumber,
        string calldata question,
        bytes32 commitment,
        string calldata category
    ) external onlyGameServer whenNotPaused returns (bytes32 sessionId) {
        // Validate inputs
        if (bytes(questionId).length == 0) revert InvalidQuestionId();
        if (questionIdToSessionId[questionId] != bytes32(0)) {
            revert QuestionAlreadyCommitted(questionId);
        }
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        // Generate deterministic session ID from question ID
        sessionId = keccak256(abi.encodePacked("game", questionId, block.timestamp));

        // Store mappings
        questionIdToSessionId[questionId] = sessionId;
        sessionIdToQuestionId[sessionId] = questionId;

        // Store metadata
        gameMetadata[sessionId] = GameMetadata({
            questionId: questionId,
            questionNumber: questionNumber,
            category: category,
            createdAt: block.timestamp,
            creator: msg.sender
        });

        // Track session
        allSessionIds.push(sessionId);
        totalGamesCommitted++;

        // Store game outcome
        games[sessionId] = GameOutcome({
            sessionId: sessionId,
            question: question,
            outcome: false,
            commitment: commitment,
            salt: bytes32(0),
            startTime: block.timestamp,
            endTime: 0,
            teeQuote: "",
            totalPayout: 0,
            finalized: false
        });

        commitments[commitment] = true;
        gameCount++;

        emit GameCommitted(sessionId, questionId, questionNumber, question, commitment);

        return sessionId;
    }

    /**
     * @notice Reveal a game outcome
     * @param sessionId Session ID from commitGame
     * @param outcome The outcome (true=YES, false=NO)
     * @param salt The salt used in commitment
     * @param teeQuote TEE attestation quote (optional, can be empty)
     * @param winners List of winner addresses (players who predicted correctly)
     * @param totalPayout Total prize pool distributed
     */
    function revealGame(
        bytes32 sessionId,
        bool outcome,
        bytes32 salt,
        bytes memory teeQuote,
        address[] calldata winners,
        uint256 totalPayout
    ) external onlyGameServer whenNotPaused {
        // Validate session exists
        string memory questionId = sessionIdToQuestionId[sessionId];
        if (bytes(questionId).length == 0) revert SessionNotFound(sessionId);

        // Update game state
        GameOutcome storage game = games[sessionId];
        if (game.startTime == 0) revert GameNotFound();
        if (game.finalized) revert AlreadyFinalized();

        // Verify commitment
        bytes32 expectedCommitment = keccak256(abi.encode(outcome, salt));
        if (game.commitment != expectedCommitment) revert CommitmentMismatch();

        // Verify TEE quote if verifier is set (view-only call, safe)
        if (dstackVerifier != address(0)) {
            (bool success, bytes memory result) = dstackVerifier.staticcall(
                abi.encodeWithSignature(
                    "verify(bytes,uint256,bytes)", teeQuote, block.timestamp, abi.encode(sessionId, outcome)
                )
            );
            require(success && abi.decode(result, (bool)), "TEE quote verification failed");
        }

        // Update game state
        game.outcome = outcome;
        game.salt = salt;
        game.endTime = block.timestamp;
        game.teeQuote = teeQuote;
        _gameWinners[sessionId] = winners;
        game.totalPayout = totalPayout;
        game.finalized = true;

        totalGamesRevealed++;

        emit GameRevealed(sessionId, questionId, outcome, winners.length);
    }

    /**
     * @notice Batch commit multiple games (gas optimization)
     */
    function batchCommitGames(
        string[] calldata questionIds,
        uint256[] calldata questionNumbers,
        string[] calldata questions,
        bytes32[] calldata gameCommitments,
        string[] calldata categories
    ) external onlyGameServer whenNotPaused returns (bytes32[] memory sessionIds) {
        uint256 length = questionIds.length;
        require(
            length == questionNumbers.length && length == questions.length && length == gameCommitments.length
                && length == categories.length,
            "Array length mismatch"
        );

        sessionIds = new bytes32[](length);

        for (uint256 i = 0; i < length; i++) {
            string calldata questionId = questionIds[i];

            if (bytes(questionId).length == 0) revert InvalidQuestionId();
            if (questionIdToSessionId[questionId] != bytes32(0)) {
                revert QuestionAlreadyCommitted(questionId);
            }

            bytes32 _sessionId = keccak256(abi.encodePacked("game", questionId, block.timestamp, i));

            questionIdToSessionId[questionId] = _sessionId;
            sessionIdToQuestionId[_sessionId] = questionId;

            gameMetadata[_sessionId] = GameMetadata({
                questionId: questionId,
                questionNumber: questionNumbers[i],
                category: categories[i],
                createdAt: block.timestamp,
                creator: msg.sender
            });

            allSessionIds.push(_sessionId);
            totalGamesCommitted++;

            bytes32 _commitment = gameCommitments[i];
            games[_sessionId] = GameOutcome({
                sessionId: _sessionId,
                question: questions[i],
                outcome: false,
                commitment: _commitment,
                salt: bytes32(0),
                startTime: block.timestamp,
                endTime: 0,
                teeQuote: "",
                totalPayout: 0,
                finalized: false
            });

            commitments[_commitment] = true;
            gameCount++;

            emit GameCommitted(_sessionId, questionId, questionNumbers[i], questions[i], _commitment);

            sessionIds[i] = _sessionId;
        }

        return sessionIds;
    }

    /**
     * @notice Batch reveal multiple games (gas optimization)
     */
    function batchRevealGames(
        bytes32[] calldata sessionIds,
        bool[] calldata outcomes,
        bytes32[] calldata salts,
        bytes[] calldata teeQuotes,
        address[][] calldata winnersArrays,
        uint256[] calldata totalPayouts
    ) external onlyGameServer whenNotPaused {
        uint256 length = sessionIds.length;
        require(
            length == outcomes.length && length == salts.length && length == teeQuotes.length
                && length == winnersArrays.length && length == totalPayouts.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < length; i++) {
            bytes32 sessionId = sessionIds[i];
            bool outcome = outcomes[i];
            bytes32 salt = salts[i];
            bytes memory teeQuote = teeQuotes[i];
            address[] calldata winners = winnersArrays[i];
            uint256 totalPayout = totalPayouts[i];

            string memory questionId = sessionIdToQuestionId[sessionId];
            if (bytes(questionId).length == 0) revert SessionNotFound(sessionId);

            GameOutcome storage game = games[sessionId];
            if (game.startTime == 0) revert GameNotFound();
            if (game.finalized) revert AlreadyFinalized();

            bytes32 expectedCommitment = keccak256(abi.encode(outcome, salt));
            if (game.commitment != expectedCommitment) revert CommitmentMismatch();

            game.outcome = outcome;
            game.salt = salt;
            game.endTime = block.timestamp;
            game.teeQuote = teeQuote;
            _gameWinners[sessionId] = winners;
            game.totalPayout = totalPayout;
            game.finalized = true;

            totalGamesRevealed++;

            emit GameRevealed(sessionId, questionId, outcome, winners.length);
        }
    }

    // ============ IPredictionOracle Interface ============

    /**
     * @notice Get game outcome
     * @param sessionId Session ID
     * @return outcome The outcome (true=YES, false=NO)
     * @return finalized Whether the outcome has been revealed
     */
    function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized) {
        GameOutcome storage game = games[sessionId];
        return (game.outcome, game.finalized);
    }

    /**
     * @notice Check if address is a winner
     * @param sessionId Session ID
     * @param player Address to check
     * @return True if the address won
     */
    function isWinner(bytes32 sessionId, address player) external view returns (bool) {
        GameOutcome storage game = games[sessionId];
        if (!game.finalized) return false;

        address[] storage winners = _gameWinners[sessionId];
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == player) return true;
        }
        return false;
    }

    /**
     * @notice Verify a commitment exists
     * @param commitment The commitment hash
     * @return True if commitment exists
     */
    function verifyCommitment(bytes32 commitment) external view returns (bool) {
        return commitments[commitment];
    }

    /**
     * @notice Get winners for a game
     * @param sessionId Session ID
     * @return winners Array of winner addresses
     */
    function getWinners(bytes32 sessionId) external view returns (address[] memory) {
        return _gameWinners[sessionId];
    }

    // ============ Query Functions ============

    /**
     * @notice Get session ID from question ID
     */
    function getSessionIdByQuestionId(string calldata questionId) external view returns (bytes32) {
        return questionIdToSessionId[questionId];
    }

    /**
     * @notice Get question ID from session ID
     */
    function getQuestionIdBySessionId(bytes32 sessionId) external view returns (string memory) {
        return sessionIdToQuestionId[sessionId];
    }

    /**
     * @notice Get game metadata
     */
    function getGameMetadata(bytes32 sessionId) external view returns (GameMetadata memory) {
        return gameMetadata[sessionId];
    }

    /**
     * @notice Get all session IDs (for indexing)
     */
    function getAllSessionIds() external view returns (bytes32[] memory) {
        return allSessionIds;
    }

    /**
     * @notice Get session IDs in range (for pagination)
     */
    function getSessionIdsRange(uint256 start, uint256 limit) external view returns (bytes32[] memory) {
        require(start < allSessionIds.length, "Start index out of bounds");

        uint256 end = start + limit;
        if (end > allSessionIds.length) {
            end = allSessionIds.length;
        }

        bytes32[] memory result = new bytes32[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = allSessionIds[i];
        }

        return result;
    }

    /**
     * @notice Get statistics
     */
    function getStatistics() external view returns (uint256 committed, uint256 revealed, uint256 pending) {
        committed = totalGamesCommitted;
        revealed = totalGamesRevealed;
        pending = totalGamesCommitted - totalGamesRevealed;
    }

    /**
     * @notice Get complete game info (convenience function)
     */
    function getCompleteGameInfo(bytes32 sessionId)
        external
        view
        returns (GameMetadata memory metadata, GameOutcome memory game)
    {
        metadata = gameMetadata[sessionId];
        game = games[sessionId];
        return (metadata, game);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update game server address
     */
    function updateGameServer(address newServer) external onlyOwner {
        require(newServer != address(0), "Invalid address");
        address oldServer = gameServer;
        gameServer = newServer;
        emit GameServerUpdated(oldServer, newServer);
    }

    /**
     * @notice Set the dstack verifier address
     */
    function setDstackVerifier(address _dstackVerifier) external onlyOwner {
        address old = dstackVerifier;
        dstackVerifier = _dstackVerifier;
        emit DstackVerifierUpdated(old, _dstackVerifier);
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

    /**
     * @notice Get contract metadata for ERC-8004 discovery
     */
    function getContractMetadata() external pure returns (string memory) {
        return
        '{"type":"prediction-oracle","subtype":"game","name":"Game Oracle","category":"social-prediction","version":"1.0.0"}';
    }
}

