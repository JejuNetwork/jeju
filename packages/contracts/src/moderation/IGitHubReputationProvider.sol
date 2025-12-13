// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IGitHubReputationProvider
 * @notice Interface for GitHub reputation integration
 */
interface IGitHubReputationProvider {
    /**
     * @notice Get stake discount based on GitHub reputation
     * @param wallet The wallet address to check
     * @return discountBps Discount in basis points (0-5000 = 0-50%)
     */
    function getStakeDiscount(address wallet) external view returns (uint256 discountBps);

    /**
     * @notice Check if wallet has a valid reputation boost
     * @param wallet The wallet address to check
     * @return hasBoost Whether they qualify for reputation boost
     * @return score Their current score (0-100)
     */
    function hasReputationBoost(address wallet) external view returns (bool hasBoost, uint8 score);

    /**
     * @notice Get reputation score for an agent
     * @param agentId The agent ID
     * @return score The reputation score (0-100)
     * @return isValid Whether the attestation is valid
     * @return lastUpdated When the score was last updated
     */
    function getAgentReputation(uint256 agentId)
        external
        view
        returns (uint8 score, bool isValid, uint256 lastUpdated);
}
