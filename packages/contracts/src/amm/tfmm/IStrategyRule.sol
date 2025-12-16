// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IStrategyRule
 * @author Jeju Network
 * @notice Interface for TFMM strategy rules
 */
interface IStrategyRule {
    /**
     * @notice Calculate new weights based on oracle prices
     * @param pool Pool address
     * @param prices Current oracle prices for each token
     * @param currentWeights Current normalized weights
     * @return newWeights New target weights
     * @return blocksToTarget Blocks to interpolate over (0 = use default)
     */
    function calculateWeights(
        address pool,
        uint256[] calldata prices,
        uint256[] calldata currentWeights
    ) external view returns (uint256[] memory newWeights, uint256 blocksToTarget);

    /**
     * @notice Get strategy name
     */
    function name() external view returns (string memory);

    /**
     * @notice Get strategy parameters
     */
    function getParameters() external view returns (bytes memory);
}

