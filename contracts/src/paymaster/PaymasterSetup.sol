// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LiquidityPaymaster} from "./LiquidityPaymaster.sol";
import {LiquidityVault} from "../liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../distributor/FeeDistributor.sol";

/**
 * @title PaymasterSetup
 * @notice Helper contract for setting up newly deployed paymasters
 * @dev Operators call this after PaymasterFactory deployment to wire contracts together
 * 
 * Usage:
 * 1. Factory deploys vault, distributor, paymaster (all owned by operator)
 * 2. Operator calls setupPaymaster() to wire them together
 * 3. System is ready to use
 * 
 * This two-step process eliminates the ownership transfer window vulnerability.
 */
contract PaymasterSetup {
    /**
     * @notice Wire up paymaster components and set initial fee
     * @param vault LiquidityVault address
     * @param distributor FeeDistributor address
     * @param paymaster LiquidityPaymaster address
     * @param feeMargin Initial fee margin to set
     * @dev Must be called by operator who owns all three contracts
     */
    function setupPaymaster(
        address payable vault,
        address payable distributor,
        address payable paymaster,
        uint256 feeMargin
    ) external {
        // Wire vault
        LiquidityVault(vault).setPaymaster(paymaster);
        LiquidityVault(vault).setFeeDistributor(distributor);
        
        // Wire distributor
        FeeDistributor(distributor).setPaymaster(paymaster);
        
        // Set initial fee (uses emergency function to bypass timelock for initial setup)
        LiquidityPaymaster(paymaster).emergencySetFeeMargin(feeMargin);
    }
}

