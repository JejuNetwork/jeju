// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAutocratTreasury
 * @notice Interface for AutocratTreasury contract
 */
interface IAutocratTreasury {
    enum ProfitSource {
        DEX_ARBITRAGE,
        CROSS_CHAIN_ARBITRAGE,
        SANDWICH,
        LIQUIDATION,
        SOLVER_FEE,
        ORACLE_KEEPER,
        OTHER
    }

    function depositProfit(
        address token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    ) external payable;

    function distributeProfits(address token) external;
    function withdrawOperatorEarnings(address token) external;
    function authorizedOperators(address operator) external view returns (bool);
    function totalProfitsByToken(address token) external view returns (uint256);
    function totalProfitsBySource(ProfitSource source) external view returns (uint256);
}

/**
 * @title IBlockBuilderMarketplace
 * @notice Interface for BlockBuilderMarketplace contract
 */
interface IBlockBuilderMarketplace {
    enum AccessTier {
        NONE,
        BRONZE,
        SILVER,
        GOLD,
        PLATINUM
    }

    enum BundleStatus {
        PENDING,
        INCLUDED,
        FAILED,
        EXPIRED,
        REFUNDED
    }

    function registerBuilder(uint256 agentId) external payable;
    function increaseStake(uint256 agentId) external payable;
    function withdrawStake(uint256 agentId, uint256 amount) external;
    function deactivateBuilder(uint256 agentId) external;
    
    function submitBundle(
        uint256 agentId,
        uint256 targetBlock,
        bytes32 bundleHash,
        uint256 maxGasPrice
    ) external payable returns (bytes32 bundleId);
    
    function markBundleIncluded(bytes32 bundleId, bytes32 inclusionTxHash) external;
    function markBundleFailed(bytes32 bundleId, string calldata reason, bool shouldSlash) external;
    function expireBundle(bytes32 bundleId) external;
    
    function getBuilderTier(uint256 agentId) external view returns (AccessTier);
    function getBundlesForBlock(uint256 targetBlock) external view returns (bytes32[] memory);
    function hasAccess(uint256 agentId, AccessTier requiredTier) external view returns (bool);
}
