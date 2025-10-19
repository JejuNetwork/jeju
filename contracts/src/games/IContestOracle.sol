// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IContestOracle
 * @notice Generic interface for contest-based oracle games
 * @dev Extends prediction oracle pattern to support rankings and multiple winners
 * 
 * This interface allows ANY prediction market or betting contract to integrate with
 * contest-based games like races, competitions, tournaments, etc.
 */
interface IContestOracle {
    /**
     * @notice Contest modes supported
     */
    enum ContestMode {
        SINGLE_WINNER,    // One winner only
        TOP_THREE,        // Top 3 ranked (1st, 2nd, 3rd)
        FULL_RANKING      // All contestants ranked in order
    }

    /**
     * @notice Contest state
     */
    enum ContestState {
        PENDING,     // Created but not started
        ACTIVE,      // Currently running
        FINISHED,    // Completed with results
        CANCELLED    // Cancelled (refund bets)
    }

    /**
     * @notice Get contest details
     * @param contestId Unique contest identifier
     * @return state Current state of the contest
     * @return mode Contest mode (winner/top3/ranking)
     * @return startTime When contest started (0 if pending)
     * @return endTime When contest ended (0 if not finished)
     * @return optionCount Number of options/contestants
     */
    function getContestInfo(bytes32 contestId) external view returns (
        ContestState state,
        ContestMode mode,
        uint256 startTime,
        uint256 endTime,
        uint256 optionCount
    );

    /**
     * @notice Get contest options/contestants
     * @param contestId Unique contest identifier
     * @return names Array of option names
     */
    function getOptions(bytes32 contestId) external view returns (string[] memory names);

    /**
     * @notice Get winner for single-winner contests
     * @param contestId Unique contest identifier
     * @return winner Index of winning option (0-based)
     * @return finalized Whether result is finalized
     */
    function getWinner(bytes32 contestId) external view returns (uint256 winner, bool finalized);

    /**
     * @notice Get top 3 rankings
     * @param contestId Unique contest identifier
     * @return rankings Array of 3 option indices [1st, 2nd, 3rd]
     * @return finalized Whether results are finalized
     */
    function getTop3(bytes32 contestId) external view returns (uint256[3] memory rankings, bool finalized);

    /**
     * @notice Get full rankings
     * @param contestId Unique contest identifier
     * @return rankings Array of all option indices in order (1st to last)
     * @return finalized Whether results are finalized
     */
    function getFullRanking(bytes32 contestId) external view returns (uint256[] memory rankings, bool finalized);

    /**
     * @notice Get binary outcome for prediction markets
     * @dev Maps contest result to true/false for simple betting
     * @param contestId Unique contest identifier
     * @param outcomeDefinition How to interpret winner as binary (e.g., "option >= 2")
     * @return outcome Binary result
     * @return finalized Whether result is finalized
     */
    function getBinaryOutcome(bytes32 contestId, bytes memory outcomeDefinition) external view returns (bool outcome, bool finalized);

    /**
     * @notice Check if specific option won
     * @param contestId Unique contest identifier
     * @param optionIndex Index of option to check
     * @return True if this option won (or placed in top 3 for TOP_THREE mode)
     */
    function isWinningOption(bytes32 contestId, uint256 optionIndex) external view returns (bool);

    /**
     * @notice Events
     */
    event ContestCreated(bytes32 indexed contestId, ContestMode mode, string[] options, uint256 startTime);
    event ContestStarted(bytes32 indexed contestId, uint256 timestamp);
    event ContestFinished(bytes32 indexed contestId, uint256 timestamp);
    event OutcomeCommitted(bytes32 indexed contestId, bytes32 commitment);
    event OutcomeRevealed(bytes32 indexed contestId, uint256[] rankings);
    event ContestCancelled(bytes32 indexed contestId, string reason);
}

