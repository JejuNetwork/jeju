// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOutputSettler} from "./IOIF.sol";
import {BaseOutputSettler} from "./BaseOutputSettler.sol";

/**
 * @title OutputSettler
 * @author Jeju Network
 * @notice OIF OutputSettler for solver fills on destination chain
 * @dev Extends BaseOutputSettler with standard token fill implementation
 *
 * ## How it works:
 * 1. Solver calls fill() with the order details
 * 2. OutputSettler transfers tokens from solver to recipient
 * 3. Emits Fill event that oracle monitors
 * 4. Oracle relays attestation to source chain InputSettler
 *
 * ## Security:
 * - Solver must have deposited liquidity
 * - Fill must match order parameters
 * - Double-fill prevention via orderId tracking
 */
contract OutputSettler is BaseOutputSettler {
    using SafeERC20 for IERC20;

    // ============ Constructor ============

    constructor(uint256 _chainId) BaseOutputSettler(_chainId) {}

    // ============ IOutputSettler Implementation ============

    /// @notice Fills an order on the destination chain
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata fillerData
    ) external payable override nonReentrant {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();

        // Decode fill parameters
        (address token, uint256 amount, address recipient, uint256 gasAmount) =
            abi.decode(fillerData, (address, uint256, address, uint256));

        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        // Mark filled before external calls (CEI)
        filledOrders[orderId] = true;
        fillRecords[orderId] = FillRecord({
            solver: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            gasProvided: gasAmount,
            filledBlock: block.number,
            filledTimestamp: block.timestamp
        });

        emit Fill(orderId, keccak256(originData), fillerData);
        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

        // Transfer to recipient
        if (token == address(0)) {
            uint256 totalRequired = amount + gasAmount;
            if (msg.value >= totalRequired) {
                // Solver sent ETH with tx
                (bool success,) = recipient.call{value: totalRequired}("");
                if (!success) revert TransferFailed();

                // Refund excess
                if (msg.value > totalRequired) {
                    (bool refundSuccess,) = msg.sender.call{value: msg.value - totalRequired}("");
                    if (!refundSuccess) revert TransferFailed();
                }
            } else {
                // Use deposited ETH
                if (solverETH[msg.sender] < totalRequired) revert InsufficientLiquidity();
                solverETH[msg.sender] -= totalRequired;
                (bool success,) = recipient.call{value: totalRequired}("");
                if (!success) revert TransferFailed();
            }
        } else {
            if (solverLiquidity[msg.sender][token] < amount) revert InsufficientLiquidity();
            solverLiquidity[msg.sender][token] -= amount;
            IERC20(token).safeTransfer(recipient, amount);

            if (gasAmount > 0) {
                if (solverETH[msg.sender] < gasAmount) revert InsufficientLiquidity();
                solverETH[msg.sender] -= gasAmount;
                (bool gasSuccess,) = recipient.call{value: gasAmount}("");
                if (!gasSuccess) revert TransferFailed();
            }
        }
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
