// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IPredimarket
 * @notice Interface for Council to interact with Predimarket for futarchy escalation
 */
interface IPredimarket {
    enum MarketCategory {
        GENERAL,
        MODERATION_NETWORK_BAN,
        MODERATION_APP_BAN,
        MODERATION_LABEL_HACKER,
        MODERATION_LABEL_SCAMMER,
        MODERATION_APPEAL,
        GOVERNANCE_VETO // New category for vetoed governance proposals

    }

    struct ModerationMetadata {
        uint256 targetAgentId;
        bytes32 evidenceHash;
        address reporter;
        uint256 reportId;
    }

    /**
     * @notice Create a moderation/governance market
     * @param sessionId Unique market identifier
     * @param question Market question
     * @param liquidityParameter LMSR liquidity parameter
     * @param category Market category
     * @param metadata Additional metadata
     */
    function createModerationMarket(
        bytes32 sessionId,
        string calldata question,
        uint256 liquidityParameter,
        MarketCategory category,
        ModerationMetadata calldata metadata
    ) external;

    /**
     * @notice Get market prices
     * @param sessionId Market ID
     * @return yesPrice Price of YES in basis points
     * @return noPrice Price of NO in basis points
     */
    function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice);

    /**
     * @notice Get market details
     * @param sessionId Market ID
     */
    function getMarket(bytes32 sessionId)
        external
        view
        returns (
            bytes32 _sessionId,
            string memory question,
            uint256 yesShares,
            uint256 noShares,
            uint256 liquidityParameter,
            uint256 totalVolume,
            uint256 createdAt,
            bool resolved,
            bool outcome,
            uint8 gameType,
            address gameContract,
            MarketCategory category
        );

    /**
     * @notice Check if market is resolved
     * @param sessionId Market ID
     * @return resolved Whether market is resolved
     * @return outcome The outcome if resolved
     */
    function isMarketResolved(bytes32 sessionId) external view returns (bool resolved, bool outcome);
}
