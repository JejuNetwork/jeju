// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IPredictionOracle
 * @notice Generic interface for prediction game oracles
 * @dev External contracts (like Predimarket) use this interface to query game outcomes
 * 
 * This allows ANY prediction market contract to trustlessly access game results
 * without needing to know the game's internal logic.
 */
interface IPredictionOracle {
    /**
     * @notice Get the outcome and finalization status of a game
     * @param sessionId The unique game session ID
     * @return outcome The game outcome (true=YES, false=NO)
     * @return finalized Whether the outcome has been revealed and finalized
     */
    function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized);

    /**
     * @notice Check if an address was a winner in a specific game
     * @param sessionId The game session ID
     * @param player The address to check
     * @return True if the address won, false otherwise
     */
    function isWinner(bytes32 sessionId, address player) external view returns (bool);

    /**
     * @notice Verify that a commitment exists in the oracle
     * @param commitment The commitment hash
     * @return True if commitment exists
     */
    function verifyCommitment(bytes32 commitment) external view returns (bool);
}

/**
 * @notice Example external betting contract using IPredictionOracle
 * @dev This shows how Predimarket or any other contract can bet on Caliguland games
 */
contract ExamplePredictionContract {
    IPredictionOracle public oracle;

    struct Bet {
        bytes32 gameSessionId;
        bool predictedOutcome;
        uint256 amount;
        address bettor;
    }

    mapping(uint256 => Bet) public bets;
    uint256 public nextBetId;

    constructor(address _oracle) {
        oracle = IPredictionOracle(_oracle);
    }

    /**
     * @notice Place a bet on a Caliguland game outcome
     */
    function placeBet(bytes32 gameSessionId, bool predictedOutcome) external payable {
        bets[nextBetId++] = Bet({
            gameSessionId: gameSessionId,
            predictedOutcome: predictedOutcome,
            amount: msg.value,
            bettor: msg.sender
        });
    }

    /**
     * @notice Claim winnings after game is finalized
     */
    function claim(uint256 betId) external {
        Bet storage bet = bets[betId];
        if (bet.bettor != msg.sender) revert("Not your bet");

        (bool outcome, bool finalized) = oracle.getOutcome(bet.gameSessionId);
        if (!finalized) revert("Game not finalized");
        
        if (outcome == bet.predictedOutcome) {
            uint256 payout = bet.amount * 2;
            payable(msg.sender).transfer(payout);
        }
    }
}

