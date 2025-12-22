// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Treasury} from "./Treasury.sol";

/**
 * @title GameTreasury
 * @notice Treasury for TEE-operated games/agents with built-in TEE mode
 */
contract GameTreasury is Treasury {
    constructor(uint256 dailyLimit, address admin) Treasury("GameTreasury", dailyLimit, admin) {
        // Auto-enable TEE mode with sensible defaults
        enableTEEMode(30 minutes, 1 hours);
    }
}
