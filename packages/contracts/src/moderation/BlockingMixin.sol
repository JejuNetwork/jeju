// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {IUserBlockRegistry} from "./interfaces/IUserBlockRegistry.sol";

/**
 * @title BlockingMixin
 * @notice Library for checking user-to-user blocks in contracts
 * @dev Similar pattern to ModerationMixin but for personal blocks
 *
 * Usage:
 * ```
 * using BlockingMixin for BlockingMixin.Data;
 *
 * BlockingMixin.Data public blocking;
 *
 * function transfer(address to, uint256 amount) external {
 *     blocking.requireNotBlocked(msg.sender, to);
 *     // ... transfer logic
 * }
 * ```
 */
library BlockingMixin {
    // ============ Structs ============

    struct Data {
        /// @notice UserBlockRegistry contract reference
        address blockRegistry;
    }

    // ============ Errors ============

    error UserBlocked(address source, address target);
    error AgentBlocked(uint256 sourceAgentId, uint256 targetAgentId);
    error InteractionBlocked();

    // ============ Events ============

    event BlockRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ============ View Functions ============

    /**
     * @notice Check if target has blocked source (address-based)
     * @param self BlockingMixin data
     * @param source The initiating address
     * @param target The receiving address
     * @return blocked True if interaction is blocked
     */
    function isBlocked(Data storage self, address source, address target) internal view returns (bool) {
        if (self.blockRegistry == address(0)) return false;

        (bool success, bytes memory data) = self.blockRegistry.staticcall(
            abi.encodeWithSelector(IUserBlockRegistry.isInteractionBlocked.selector, source, target)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        return false;
    }

    /**
     * @notice Check if target agent has blocked source agent
     * @param self BlockingMixin data
     * @param sourceAgentId The initiating agent
     * @param targetAgentId The receiving agent
     * @return blocked True if interaction is blocked
     */
    function isAgentBlocked(Data storage self, uint256 sourceAgentId, uint256 targetAgentId)
        internal
        view
        returns (bool)
    {
        if (self.blockRegistry == address(0)) return false;
        if (sourceAgentId == 0 || targetAgentId == 0) return false;

        (bool success, bytes memory data) = self.blockRegistry.staticcall(
            abi.encodeWithSelector(IUserBlockRegistry.isAgentInteractionBlocked.selector, sourceAgentId, targetAgentId)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        return false;
    }

    /**
     * @notice Check if any type of block is active
     * @param self BlockingMixin data
     * @param sourceAddress The initiating address
     * @param targetAddress The receiving address
     * @param sourceAgentId The initiating agent (0 if none)
     * @param targetAgentId The receiving agent (0 if none)
     * @return blocked True if any blocking relationship exists
     */
    function isAnyBlockActive(
        Data storage self,
        address sourceAddress,
        address targetAddress,
        uint256 sourceAgentId,
        uint256 targetAgentId
    ) internal view returns (bool) {
        if (self.blockRegistry == address(0)) return false;

        (bool success, bytes memory data) = self.blockRegistry.staticcall(
            abi.encodeWithSelector(
                IUserBlockRegistry.isAnyBlockActive.selector, sourceAddress, targetAddress, sourceAgentId, targetAgentId
            )
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        return false;
    }

    // ============ Require Functions ============

    /**
     * @notice Require that target has not blocked source
     * @param self BlockingMixin data
     * @param source The initiating address
     * @param target The receiving address
     */
    function requireNotBlocked(Data storage self, address source, address target) internal view {
        if (isBlocked(self, source, target)) {
            revert UserBlocked(source, target);
        }
    }

    /**
     * @notice Require that target agent has not blocked source agent
     * @param self BlockingMixin data
     * @param sourceAgentId The initiating agent
     * @param targetAgentId The receiving agent
     */
    function requireAgentNotBlocked(Data storage self, uint256 sourceAgentId, uint256 targetAgentId) internal view {
        if (isAgentBlocked(self, sourceAgentId, targetAgentId)) {
            revert AgentBlocked(sourceAgentId, targetAgentId);
        }
    }

    /**
     * @notice Require no blocks exist in any form
     * @param self BlockingMixin data
     * @param sourceAddress The initiating address
     * @param targetAddress The receiving address
     * @param sourceAgentId The initiating agent (0 if none)
     * @param targetAgentId The receiving agent (0 if none)
     */
    function requireNotBlockedAny(
        Data storage self,
        address sourceAddress,
        address targetAddress,
        uint256 sourceAgentId,
        uint256 targetAgentId
    ) internal view {
        if (isAnyBlockActive(self, sourceAddress, targetAddress, sourceAgentId, targetAgentId)) {
            revert InteractionBlocked();
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the block registry address
     * @param self BlockingMixin data
     * @param _blockRegistry New registry address
     */
    function setBlockRegistry(Data storage self, address _blockRegistry) internal {
        address oldRegistry = self.blockRegistry;
        self.blockRegistry = _blockRegistry;
        emit BlockRegistryUpdated(oldRegistry, _blockRegistry);
    }
}
