// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Contest} from "src/games/Contest.sol";
import {IPredictionOracle} from "src/prediction-markets/IPredictionOracle.sol";

contract ContestTest is Test {
    Contest public contest;

    address owner = address(this);
    address teePublisher = address(0x1);
    address player1 = address(0x2);
    address player2 = address(0x3);

    bytes32 testContainerHash;
    uint256 testWinner = 2; // Storm (index 2, ranking 0=winner)
    string[] testOptions;

    event ContestAnnounced(bytes32 indexed contestId, uint256 startTime, string[] options);
    event ContestStarted(bytes32 indexed contestId, uint256 timestamp);
    event GracePeriodStarted(bytes32 indexed contestId, uint256 timestamp);
    event ContestFinalized(bytes32 indexed contestId, uint256 winner, bytes32 containerHash, uint256 timestamp);

    function setUp() public {
        contest = new Contest(teePublisher);

        // Generate test container hash
        testContainerHash = keccak256(abi.encodePacked("ehorse-tee:v1.0.0"));

        // Approve container hash
        contest.approveContainerHash(testContainerHash, true);

        // Setup test options
        testOptions = new string[](4);
        testOptions[0] = "Thunder";
        testOptions[1] = "Lightning";
        testOptions[2] = "Storm";
        testOptions[3] = "Blaze";
    }

    // ============ Deployment Tests ============

    function testDeployment() public view {
        assertEq(contest.owner(), owner);
        assertEq(contest.teePublisher(), teePublisher);
        assertEq(contest.contestCount(), 0);
    }

    function testContractMetadata() public view {
        assertEq(contest.CONTRACT_NAME(), "TEE Contest Oracle");
        assertEq(contest.CONTRACT_VERSION(), "2.0.0");
        assertEq(contest.CONTRACT_TYPE(), "tee-oracle");
    }

    function testContainerHashApproval() public view {
        assertTrue(contest.trustedContainerHashes(testContainerHash));
    }

    // ============ Contest Announcement Tests ============

    function testAnnounceContest() public {
        vm.prank(teePublisher);

        uint256 startTime = block.timestamp + 30;

        vm.expectEmit(false, false, false, false);
        emit ContestAnnounced(bytes32(0), startTime, testOptions);

        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        assertEq(contest.contestCount(), 1);
        assertEq(contest.currentContestId(), contestId);
    }

    function testAnnounceContestOnlyTEEPublisher() public {
        vm.prank(player1);

        vm.expectRevert(abi.encodeWithSignature("OnlyTEEPublisher()"));
        contest.announceContest(testOptions, block.timestamp + 30, IPredictionOracle.ContestMode.SINGLE_WINNER);
    }

    function testOwnerCanAnnounce() public {
        vm.prank(owner);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        assertEq(contest.contestCount(), 1);
        assertTrue(contestId != bytes32(0));
    }

    // ============ Contest Start Tests ============

    function testStartContest() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Advance time to start
        vm.warp(startTime);

        vm.expectEmit(true, false, false, false);
        emit ContestStarted(contestId, startTime);

        contest.startContest(contestId);

        vm.stopPrank();

        // Verify contest is active
        (IPredictionOracle.ContestState state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.ACTIVE));
    }

    function testStartContestTooEarly() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Try to start before scheduled time
        vm.expectRevert(abi.encodeWithSignature("InvalidState()"));
        contest.startContest(contestId);

        vm.stopPrank();
    }

    // ============ Grace Period Tests ============

    function testStartGracePeriod() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60); // After contest duration

        vm.expectEmit(true, false, false, false);
        emit GracePeriodStarted(contestId, block.timestamp);

        contest.startGracePeriod(contestId);

        vm.stopPrank();

        // Verify grace period active
        (IPredictionOracle.ContestState state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.GRACE_PERIOD));
    }

    function testGracePeriodWrongState() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Try to start grace period before contest is active
        vm.expectRevert(abi.encodeWithSignature("InvalidState()"));
        contest.startGracePeriod(contestId);

        vm.stopPrank();
    }

    // ============ Result Publication Tests ============

    function testPublishResults() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90); // After grace period

        // Generate mock TEE attestation
        bytes memory attestationQuote = abi.encodePacked("mock-sgx-quote");
        bytes memory signature = abi.encodePacked("mock-signature");

        vm.expectEmit(true, false, false, false);
        emit ContestFinalized(contestId, testWinner, testContainerHash, block.timestamp);

        contest.publishResults(contestId, testWinner, testContainerHash, attestationQuote, signature);

        vm.stopPrank();

        // Verify results
        (uint256 winner, bool finalized) = contest.getWinner(contestId);
        assertEq(winner, testWinner);
        assertTrue(finalized);
    }

    function testPublishResultsUntrustedContainer() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);

        // Try with untrusted container
        bytes32 untrustedHash = keccak256(abi.encodePacked("malicious"));

        vm.expectRevert(abi.encodeWithSignature("UntrustedContainer()"));
        contest.publishResults(contestId, testWinner, untrustedHash, "", "");

        vm.stopPrank();
    }

    function testPublishResultsTooEarly() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId); // graceStartTime = block.timestamp = startTime + 60

        // Record when grace started
        uint256 graceStartTime = block.timestamp;

        // Try to publish before grace period ends (need to wait 30s from when startGracePeriod was called)
        vm.warp(graceStartTime + 15); // Only 15s into 30s grace period

        vm.expectRevert(abi.encodeWithSignature("StillInGracePeriod()"));
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        vm.stopPrank();
    }

    function testPublishResultsInvalidWinner() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);

        // Try with invalid winner (only 0-3 valid)
        vm.expectRevert(abi.encodeWithSignature("InvalidOption()"));
        contest.publishResults(contestId, 5, testContainerHash, "", "");

        vm.stopPrank();
    }

    // ============ Oracle Interface Tests ============

    function testGetOutcome() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Before finalization
        (bool outcome, bool finalized) = contest.getOutcome(contestId);
        assertFalse(finalized);

        // Complete lifecycle
        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        // After finalization
        (outcome, finalized) = contest.getOutcome(contestId);
        assertTrue(finalized);
        assertTrue(outcome); // Winner is 2 (Storm), so outcome = true (index >= 2)

        vm.stopPrank();
    }

    function testBinaryOutcomeMapping() public {
        vm.startPrank(teePublisher);

        // Test option 0-1 = NO (false)
        uint256 startTime = block.timestamp + 30;
        bytes32 contestId1 =
            contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId1);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId1);

        vm.warp(startTime + 90);
        contest.publishResults(contestId1, 0, testContainerHash, "", ""); // Thunder

        (bool outcome1, bool finalized1) = contest.getOutcome(contestId1);
        assertTrue(finalized1);
        assertFalse(outcome1); // Option 0 < midpoint (2) = NO

        // Test option 2-3 = YES (true)
        startTime = block.timestamp + 30;
        bytes32 contestId2 =
            contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId2);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId2);

        vm.warp(startTime + 90);
        contest.publishResults(contestId2, 3, testContainerHash, "", ""); // Blaze

        (bool outcome2, bool finalized2) = contest.getOutcome(contestId2);
        assertTrue(finalized2);
        assertTrue(outcome2); // Option 3 >= midpoint (2) = YES

        vm.stopPrank();
    }

    // ============ Contest Interface Tests ============

    function testGetContestInfo() public {
        vm.prank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        (
            IPredictionOracle.ContestState state,
            IPredictionOracle.ContestMode mode,
            uint256 returnedStartTime,
            uint256 endTime,
            uint256 optionCount
        ) = contest.getContestInfo(contestId);

        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.PENDING));
        assertEq(uint8(mode), uint8(IPredictionOracle.ContestMode.SINGLE_WINNER));
        assertEq(returnedStartTime, startTime);
        assertEq(endTime, 0);
        assertEq(optionCount, 4);
    }

    function testGetOptions() public {
        vm.prank(teePublisher);

        bytes32 contestId =
            contest.announceContest(testOptions, block.timestamp + 30, IPredictionOracle.ContestMode.SINGLE_WINNER);

        string[] memory options = contest.getOptions(contestId);
        assertEq(options.length, 4);
        assertEq(options[0], "Thunder");
        assertEq(options[1], "Lightning");
        assertEq(options[2], "Storm");
        assertEq(options[3], "Blaze");
    }

    function testIsWinningOption() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        // Check winning option
        assertTrue(contest.isWinningOption(contestId, testWinner));
        assertFalse(contest.isWinningOption(contestId, 0));
        assertFalse(contest.isWinningOption(contestId, 1));
        assertFalse(contest.isWinningOption(contestId, 3));

        vm.stopPrank();
    }

    // ============ TEE Attestation Tests ============

    function testAttestationStorage() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);

        bytes memory mockAttestation = abi.encodePacked("sgx-quote-data");
        bytes memory mockSignature = abi.encodePacked("tee-signature");

        contest.publishResults(contestId, testWinner, testContainerHash, mockAttestation, mockSignature);

        vm.stopPrank();

        // Verify attestation was stored
        (bytes32 containerHash, bytes memory attestationQuote, bytes memory signature, uint256 timestamp) =
            contest.getContestAttestation(contestId);

        assertEq(containerHash, testContainerHash);
        assertEq(attestationQuote, mockAttestation);
        assertEq(signature, mockSignature);
        assertEq(timestamp, block.timestamp);
    }

    function testVerifyCommitment() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Before results
        assertFalse(contest.verifyCommitment(contestId));

        // Complete lifecycle
        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);
        contest.publishResults(contestId, testWinner, testContainerHash, "quote", "sig");

        // After results - verifies attestation exists
        assertTrue(contest.verifyCommitment(contestId));

        vm.stopPrank();
    }

    // ============ Admin Tests ============

    function testSetTEEPublisher() public {
        address newPublisher = address(0x4);

        contest.setTEEPublisher(newPublisher);

        assertEq(contest.teePublisher(), newPublisher);
    }

    function testSetTEEPublisherOnlyOwner() public {
        vm.prank(player1);

        vm.expectRevert();
        contest.setTEEPublisher(address(0x4));
    }

    function testApproveContainerHash() public {
        bytes32 newHash = keccak256(abi.encodePacked("new-container"));

        contest.approveContainerHash(newHash, true);
        assertTrue(contest.trustedContainerHashes(newHash));

        contest.approveContainerHash(newHash, false);
        assertFalse(contest.trustedContainerHashes(newHash));
    }

    function testPause() public {
        contest.pause();

        // Can't announce contest when paused
        vm.prank(teePublisher);
        vm.expectRevert();
        contest.announceContest(testOptions, block.timestamp + 30, IPredictionOracle.ContestMode.SINGLE_WINNER);
    }

    function testUnpause() public {
        contest.pause();
        contest.unpause();

        // Can announce contest after unpause
        vm.prank(teePublisher);
        bytes32 contestId =
            contest.announceContest(testOptions, block.timestamp + 30, IPredictionOracle.ContestMode.SINGLE_WINNER);
        assertTrue(contestId != bytes32(0));
    }

    // ============ History Tests ============

    function testContestHistory() public {
        vm.startPrank(teePublisher);

        // Create and finish multiple contests
        for (uint256 i = 0; i < 3; i++) {
            uint256 startTime = block.timestamp + 30;
            bytes32 contestId =
                contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

            vm.warp(startTime);
            contest.startContest(contestId);

            vm.warp(startTime + 60);
            contest.startGracePeriod(contestId);

            vm.warp(startTime + 90);
            contest.publishResults(contestId, i % 4, testContainerHash, "", "");

            vm.warp(startTime + 150); // Move time forward for next contest
        }

        vm.stopPrank();

        bytes32[] memory history = contest.getContestHistory();
        assertEq(history.length, 3);
    }

    // ============ Full Lifecycle Test ============

    function testCompleteContestLifecycle() public {
        vm.startPrank(teePublisher);

        // 1. Announce contest (PENDING)
        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        (IPredictionOracle.ContestState state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.PENDING));

        (uint256 winner, bool finalized) = contest.getWinner(contestId);
        assertFalse(finalized);

        // 2. Start contest (ACTIVE - trading opens)
        vm.warp(startTime);
        contest.startContest(contestId);

        (state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.ACTIVE));

        // 3. Start grace period (GRACE_PERIOD - trading frozen)
        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        (state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.GRACE_PERIOD));

        // 4. Publish results (FINISHED)
        vm.warp(startTime + 90);
        bytes memory attestation = abi.encodePacked("sgx-attestation");
        bytes memory sig = abi.encodePacked("tee-signature");

        contest.publishResults(contestId, testWinner, testContainerHash, attestation, sig);

        // Verify finished state
        (state,,,,) = contest.getContestInfo(contestId);
        assertEq(uint8(state), uint8(IPredictionOracle.ContestState.FINISHED));

        (winner, finalized) = contest.getWinner(contestId);
        assertTrue(finalized);
        assertEq(winner, testWinner);

        // Verify binary outcome (for Predimarket)
        (bool outcome, bool outcomeFinalized) = contest.getOutcome(contestId);
        assertTrue(outcomeFinalized);
        assertTrue(outcome); // Winner 2 >= midpoint(2) = YES

        // Verify attestation
        assertTrue(contest.verifyCommitment(contestId));

        vm.stopPrank();
    }

    // ============ Ranking System Tests ============

    function testRankingSystemZeroIsWinner() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);

        // Publish with winner at index 0 (Thunder)
        // Ranking: 0=1st place (winner), 1=2nd, 2=3rd, 3=4th
        contest.publishResults(contestId, 0, testContainerHash, "", "");

        (uint256 winner, bool finalized) = contest.getWinner(contestId);
        assertEq(winner, 0); // Thunder won
        assertTrue(finalized);

        // Binary mapping: 0 < midpoint(2) = NO
        (bool outcome,) = contest.getOutcome(contestId);
        assertFalse(outcome);

        vm.stopPrank();
    }

    // ============ games() Compatibility Tests ============

    function testGamesCompatibilityFunction() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);
        bytes memory mockQuote = abi.encodePacked("attestation");
        contest.publishResults(contestId, testWinner, testContainerHash, mockQuote, "sig");

        // Test games() function (for MarketFactory compatibility)
        (
            bytes32 sessionId,
            string memory question,
            bool outcome,
            , // commitment - not used in assertions
            , // salt - not used in assertions
            uint256 returnedStartTime,
            uint256 endTime,
            bytes memory teeQuote,
            address[] memory winners,
            , // totalPayout - not used in assertions
            bool finalized
        ) = contest.games(contestId);

        assertEq(sessionId, contestId);
        assertTrue(bytes(question).length > 0); // Question generated
        assertTrue(outcome); // Winner 2 = YES
        assertEq(returnedStartTime, startTime);
        assertTrue(endTime > 0);
        assertEq(teeQuote, mockQuote);
        assertEq(winners.length, 0); // No individual winners in contests
        assertTrue(finalized);

        vm.stopPrank();
    }

    // ============ State Machine Tests ============

    function testStateMachineEnforcement() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        // Can't skip to grace period from PENDING
        vm.expectRevert(abi.encodeWithSignature("InvalidState()"));
        contest.startGracePeriod(contestId);

        // Must start contest first
        vm.warp(startTime);
        contest.startContest(contestId);

        // Can't publish results without grace period
        vm.warp(startTime + 60);
        vm.expectRevert(abi.encodeWithSignature("NotInGracePeriod()"));
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        // Must enter grace period
        contest.startGracePeriod(contestId);

        // Can't publish during grace period
        vm.expectRevert(abi.encodeWithSignature("StillInGracePeriod()"));
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        // Must wait for grace period to end
        vm.warp(startTime + 90);
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        assertTrue(true); // Lifecycle completed successfully

        vm.stopPrank();
    }

    // ============ Multiple Winners/Rankings Tests ============

    function testTop3Rankings() public {
        vm.startPrank(teePublisher);

        uint256 startTime = block.timestamp + 30;
        bytes32 contestId = contest.announceContest(testOptions, startTime, IPredictionOracle.ContestMode.SINGLE_WINNER);

        vm.warp(startTime);
        contest.startContest(contestId);

        vm.warp(startTime + 60);
        contest.startGracePeriod(contestId);

        vm.warp(startTime + 90);
        contest.publishResults(contestId, testWinner, testContainerHash, "", "");

        // Get top3 (for SINGLE_WINNER mode, winner goes in first place)
        (uint256[3] memory rankings, bool finalized) = contest.getTop3(contestId);
        assertTrue(finalized);
        assertEq(rankings[0], testWinner);
        assertEq(rankings[1], 0);
        assertEq(rankings[2], 0);

        vm.stopPrank();
    }
}
