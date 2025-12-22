// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Treasury} from "./Treasury.sol";

/**
 * @title ProfitTreasury
 * @notice Treasury with built-in profit distribution enabled
 */
contract ProfitTreasury is Treasury {
    constructor(
        uint256 dailyLimit,
        address admin,
        address _protocolRecipient,
        address _stakersRecipient,
        address _insuranceRecipient
    ) Treasury("ProfitTreasury", dailyLimit, admin) {
        // Auto-enable profit distribution
        enableProfitDistribution(_protocolRecipient, _stakersRecipient, _insuranceRecipient);
    }
}
