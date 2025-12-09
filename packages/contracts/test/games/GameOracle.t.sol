// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {GameOracle} from "../../src/games/GameOracle.sol";

/**
 * @title GameOracleTest
 * @notice Tests for GameOracle - generic game prediction oracle
 * @dev Tests the IPredictionOracle implementation that external contracts query
 *
 * Architecture:
 * - Game engine commits/reveals outcomes via GameOracle
 * - GameOracle stores outcomes on-chain
 * - External contracts (Predimarket, etc.) query getOutcome(sessionId)
 */
contract GameOracleTest is Test {
    GameOracle public oracle;

    address public owner = address(0x1000);
    address public gameServer = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);

    bytes32 public sessionId;
    string public questionId = "test-question-1";
    string public question = "Will Bitcoin reach $100k in 2024?";
    bytes32 public commitment;
    bytes32 public salt = keccak256("secret-salt");
    bool public outcome = true;

    event GameCommitted(
        bytes32 indexed sessionId, string questionId, uint256 questionNumber, string question, bytes32 commitment
    );

    event GameRevealed(bytes32 indexed sessionId, string questionId, bool outcome, uint256 winnersCount);

    function setUp() public {
        oracle = new GameOracle(gameServer, owner);
        commitment = keccak256(abi.encode(outcome, salt));
    }

    function test_CommitGame() public {
        vm.prank(gameServer);

        vm.expectEmit(false, false, false, true);
        emit GameCommitted(bytes32(0), questionId, 1, question, commitment);

        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        assertTrue(sessionId != bytes32(0), "Session ID should be set");

        (string memory storedQuestionId,,,,) = oracle.gameMetadata(sessionId);
        assertEq(storedQuestionId, questionId, "Question ID should match");

        (, bool finalized) = oracle.getOutcome(sessionId);
        assertFalse(finalized, "Should not be finalized");

        (uint256 committed, uint256 revealed, uint256 pending) = oracle.getStatistics();
        assertEq(committed, 1, "Should have 1 committed");
        assertEq(revealed, 0, "Should have 0 revealed");
        assertEq(pending, 1, "Should have 1 pending");
    }

    function test_RevealGame() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        address[] memory winners = new address[](2);
        winners[0] = user1;
        winners[1] = user2;

        vm.prank(gameServer);
        vm.expectEmit(true, false, false, true);
        emit GameRevealed(sessionId, questionId, outcome, 2);

        oracle.revealGame(sessionId, outcome, salt, "", winners, 1000 * 10 ** 18);

        (bool outcomeResult, bool finalized) = oracle.getOutcome(sessionId);
        assertTrue(finalized, "Should be finalized");
        assertEq(outcomeResult, outcome, "Outcome should match");

        address[] memory storedWinners = oracle.getWinners(sessionId);
        assertEq(storedWinners.length, 2, "Should have 2 winners");
        assertEq(storedWinners[0], user1, "First winner should match");
        assertEq(storedWinners[1], user2, "Second winner should match");

        (uint256 committed, uint256 revealed, uint256 pending) = oracle.getStatistics();
        assertEq(committed, 1, "Should have 1 committed");
        assertEq(revealed, 1, "Should have 1 revealed");
        assertEq(pending, 0, "Should have 0 pending");
    }

    function test_IPredictionOracleInterface() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        (, bool finalizedBefore) = oracle.getOutcome(sessionId);
        assertFalse(finalizedBefore, "Should not be finalized before reveal");

        address[] memory winners = new address[](1);
        winners[0] = user1;

        vm.prank(gameServer);
        oracle.revealGame(sessionId, outcome, salt, "", winners, 0);

        (bool outcomeAfter, bool finalizedAfter) = oracle.getOutcome(sessionId);
        assertTrue(finalizedAfter, "Should be finalized after reveal");
        assertTrue(outcomeAfter, "Outcome should be YES (true)");

        assertTrue(oracle.isWinner(sessionId, user1), "User1 should be winner");
        assertFalse(oracle.isWinner(sessionId, user2), "User2 should not be winner");

        assertTrue(oracle.verifyCommitment(commitment), "Commitment should exist");
        assertFalse(oracle.verifyCommitment(bytes32(0)), "Zero commitment should not exist");
    }

    function test_RevealWithInvalidSalt() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        bytes32 wrongSalt = keccak256("wrong-salt");
        address[] memory winners = new address[](0);

        vm.prank(gameServer);
        vm.expectRevert(GameOracle.CommitmentMismatch.selector);
        oracle.revealGame(sessionId, outcome, wrongSalt, "", winners, 0);
    }

    function test_OnlyGameServerCanCommit() public {
        vm.prank(user1);
        vm.expectRevert(GameOracle.OnlyGameServer.selector);
        oracle.commitGame(questionId, 1, question, commitment, "crypto");
    }

    function test_OnlyGameServerCanReveal() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        address[] memory winners = new address[](0);
        vm.prank(user1);
        vm.expectRevert(GameOracle.OnlyGameServer.selector);
        oracle.revealGame(sessionId, outcome, salt, "", winners, 0);
    }

    function test_BatchCommit() public {
        string[] memory questionIds = new string[](3);
        uint256[] memory questionNumbers = new uint256[](3);
        string[] memory questions = new string[](3);
        bytes32[] memory _commitments = new bytes32[](3);
        string[] memory categories = new string[](3);

        for (uint256 i = 0; i < 3; i++) {
            questionIds[i] = string(abi.encodePacked("batch-question-", vm.toString(i)));
            questionNumbers[i] = 100 + i;
            questions[i] = string(abi.encodePacked("Batch Question ", vm.toString(i), "?"));
            _commitments[i] = keccak256(abi.encodePacked("batch-commit-", i));
            categories[i] = "batch-test";
        }

        (uint256 committedBefore,,) = oracle.getStatistics();

        vm.prank(gameServer);
        bytes32[] memory _sessionIds =
            oracle.batchCommitGames(questionIds, questionNumbers, questions, _commitments, categories);

        assertEq(_sessionIds.length, 3, "Should create 3 sessions");

        (uint256 committedAfter,,) = oracle.getStatistics();
        assertEq(committedAfter, committedBefore + 3, "Should have 3 more committed");

        for (uint256 i = 0; i < 3; i++) {
            (, bool finalized) = oracle.getOutcome(_sessionIds[i]);
            assertFalse(finalized, "Each session should not be finalized yet");
        }
    }

    function test_BatchReveal() public {
        string[] memory questionIds = new string[](2);
        uint256[] memory questionNumbers = new uint256[](2);
        string[] memory questions = new string[](2);
        bytes32[] memory _commitments = new bytes32[](2);
        string[] memory categories = new string[](2);
        bytes32[] memory salts = new bytes32[](2);
        bool[] memory outcomes = new bool[](2);

        for (uint256 i = 0; i < 2; i++) {
            questionIds[i] = string(abi.encodePacked("batch-reveal-", vm.toString(i)));
            questionNumbers[i] = 200 + i;
            questions[i] = string(abi.encodePacked("Batch Reveal ", vm.toString(i), "?"));
            salts[i] = keccak256(abi.encodePacked("salt-", i));
            outcomes[i] = i % 2 == 0;
            _commitments[i] = keccak256(abi.encode(outcomes[i], salts[i]));
            categories[i] = "batch-reveal";
        }

        vm.prank(gameServer);
        bytes32[] memory _sessionIds =
            oracle.batchCommitGames(questionIds, questionNumbers, questions, _commitments, categories);

        bytes[] memory teeQuotes = new bytes[](2);
        address[][] memory winnersArrays = new address[][](2);
        uint256[] memory totalPayouts = new uint256[](2);

        for (uint256 i = 0; i < 2; i++) {
            teeQuotes[i] = "";
            winnersArrays[i] = new address[](0);
            totalPayouts[i] = 0;
        }

        vm.prank(gameServer);
        oracle.batchRevealGames(_sessionIds, outcomes, salts, teeQuotes, winnersArrays, totalPayouts);

        for (uint256 i = 0; i < 2; i++) {
            (bool _outcome, bool finalized) = oracle.getOutcome(_sessionIds[i]);
            assertTrue(finalized, "Should be finalized");
            assertEq(_outcome, outcomes[i], "Outcome should match");
        }
    }

    function test_PauseUnpause() public {
        vm.prank(owner);
        oracle.pause();

        vm.prank(gameServer);
        vm.expectRevert();
        oracle.commitGame(questionId, 1, question, commitment, "crypto");

        vm.prank(owner);
        oracle.unpause();

        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        assertTrue(sessionId != bytes32(0), "Should work after unpause");
    }

    function test_CannotCommitSameQuestionTwice() public {
        vm.startPrank(gameServer);

        oracle.commitGame(questionId, 1, question, commitment, "crypto");

        bytes32 newCommitment = keccak256(abi.encode(false, salt));
        vm.expectRevert(abi.encodeWithSelector(GameOracle.QuestionAlreadyCommitted.selector, questionId));
        oracle.commitGame(questionId, 2, "Different question?", newCommitment, "crypto");

        vm.stopPrank();
    }

    function test_QuestionIdMappings() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        bytes32 lookedUpSessionId = oracle.getSessionIdByQuestionId(questionId);
        assertEq(lookedUpSessionId, sessionId, "Session ID lookup should match");

        string memory lookedUpQuestionId = oracle.getQuestionIdBySessionId(sessionId);
        assertEq(lookedUpQuestionId, questionId, "Question ID lookup should match");
    }

    function test_ContractMetadata() public view {
        string memory metadata = oracle.getContractMetadata();
        assertTrue(bytes(metadata).length > 0, "Metadata should not be empty");
        assertEq(
            keccak256(bytes(metadata)),
            keccak256(
                bytes(
                    '{"type":"prediction-oracle","subtype":"game","name":"Game Oracle","category":"social-prediction","version":"1.0.0"}'
                )
            ),
            "Metadata should match expected format"
        );
    }

    function test_UpdateGameServer() public {
        address newServer = address(0x999);

        vm.prank(owner);
        oracle.updateGameServer(newServer);

        assertEq(oracle.gameServer(), newServer, "Game server should be updated");

        vm.prank(newServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");
        assertTrue(sessionId != bytes32(0), "New server should be able to commit");
    }

    function test_GetCompleteGameInfo() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        (GameOracle.GameMetadata memory metadata, GameOracle.GameOutcome memory game) =
            oracle.getCompleteGameInfo(sessionId);

        assertEq(metadata.questionId, questionId, "Question ID should match");
        assertEq(metadata.questionNumber, 1, "Question number should match");
        assertEq(metadata.category, "crypto", "Category should match");
        assertEq(game.question, question, "Question should match");
        assertFalse(game.finalized, "Should not be finalized");
    }

    function test_GetSessionIdsRange() public {
        vm.startPrank(gameServer);

        for (uint256 i = 0; i < 5; i++) {
            string memory qId = string(abi.encodePacked("range-test-", vm.toString(i)));
            bytes32 comm = keccak256(abi.encodePacked("range-commit-", i));
            oracle.commitGame(qId, i, "Test question?", comm, "test");
        }

        vm.stopPrank();

        bytes32[] memory range = oracle.getSessionIdsRange(1, 3);
        assertEq(range.length, 3, "Should return 3 sessions");

        bytes32[] memory all = oracle.getAllSessionIds();
        assertEq(all.length, 5, "Should have 5 total sessions");
    }

    function test_CannotRevealTwice() public {
        vm.prank(gameServer);
        sessionId = oracle.commitGame(questionId, 1, question, commitment, "crypto");

        address[] memory winners = new address[](0);

        vm.prank(gameServer);
        oracle.revealGame(sessionId, outcome, salt, "", winners, 0);

        vm.prank(gameServer);
        vm.expectRevert(GameOracle.AlreadyFinalized.selector);
        oracle.revealGame(sessionId, outcome, salt, "", winners, 0);
    }

    function test_RevealNonexistentSession() public {
        bytes32 fakeSessionId = keccak256("fake");
        address[] memory winners = new address[](0);

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(GameOracle.SessionNotFound.selector, fakeSessionId));
        oracle.revealGame(fakeSessionId, outcome, salt, "", winners, 0);
    }
}

