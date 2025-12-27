// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {GaslessCrossChainOrder, ResolvedCrossChainOrder, Output, FillInstruction} from "./IOIF.sol";
import {BaseInputSettler} from "./BaseInputSettler.sol";

/**
 * @title InputSettler
 * @author Jeju Network
 * @notice OIF InputSettler for receiving token intents and locking user funds
 * @dev Extends BaseInputSettler with ERC20/ETH-specific asset handling
 *
 * ## How it works:
 * 1. User submits an intent via open() or openFor() (gasless)
 * 2. User's input tokens are locked in this contract
 * 3. Solver fills the intent on the destination chain via OutputSettler
 * 4. Oracle attests that output was delivered
 * 5. Once attested, solver can claim locked input tokens
 *
 * ## Security:
 * - Funds are locked until oracle attestation OR expiry
 * - Users can refund expired intents
 * - Solver must be registered in SolverRegistry
 */
contract InputSettler is BaseInputSettler {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Order data type for standard cross-chain swap
    bytes32 public constant SWAP_ORDER_TYPE = keccak256("CrossChainSwap");

    // ============ State Variables ============

    /// @notice Token order storage
    mapping(bytes32 => TokenOrder) public orders;

    // ============ Structs ============

    struct TokenOrder {
        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 outputAmount;
        uint256 destinationChainId;
        address recipient;
        uint256 maxFee;
    }

    // ============ Events ============

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed user,
        address inputToken,
        uint256 inputAmount,
        uint256 destinationChainId,
        address recipient,
        uint32 fillDeadline
    );

    // ============ Errors ============

    error InvalidAmount();
    error InvalidRecipient();
    error TransferFailed();

    // ============ Constructor ============

    constructor(uint256 _chainId, address _oracle, address _solverRegistry)
        BaseInputSettler(_chainId, _oracle, _solverRegistry)
    {}

    // ============ Asset Handling Implementation ============

    /// @inheritdoc BaseInputSettler
    function _lockAssets(GaslessCrossChainOrder calldata order, address user)
        internal
        override
        returns (bytes32 orderId)
    {
        // Decode order data
        (
            address inputToken,
            uint256 inputAmount,
            address outputToken,
            uint256 outputAmount,
            uint256 destinationChainId,
            address recipient,
            uint256 maxFee
        ) = abi.decode(order.orderData, (address, uint256, address, uint256, uint256, address, uint256));

        if (inputAmount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        // Generate order ID
        orderId = keccak256(
            abi.encodePacked(user, order.nonce, chainId, inputToken, inputAmount, destinationChainId, block.number)
        );

        // Lock input tokens
        if (inputToken == address(0)) {
            // Native ETH - verify sufficient value was sent
            require(msg.value >= inputAmount, "Insufficient ETH sent");
            // Refund excess
            if (msg.value > inputAmount) {
                (bool success,) = user.call{value: msg.value - inputAmount}("");
                require(success, "ETH refund failed");
            }
        } else {
            IERC20(inputToken).safeTransferFrom(user, address(this), inputAmount);
        }

        // Store order details
        orders[orderId] = TokenOrder({
            inputToken: inputToken,
            inputAmount: inputAmount,
            outputToken: outputToken,
            outputAmount: outputAmount,
            destinationChainId: destinationChainId,
            recipient: recipient,
            maxFee: maxFee
        });

        emit OrderCreated(orderId, user, inputToken, inputAmount, destinationChainId, recipient, order.fillDeadline);
    }

    /// @inheritdoc BaseInputSettler
    function _releaseAssetsToSolver(bytes32 orderId, address solver) internal override {
        TokenOrder storage order = orders[orderId];

        if (order.inputToken == address(0)) {
            (bool success,) = solver.call{value: order.inputAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(order.inputToken).safeTransfer(solver, order.inputAmount);
        }
    }

    /// @inheritdoc BaseInputSettler
    function _refundAssetsToUser(bytes32 orderId) internal override {
        TokenOrder storage order = orders[orderId];
        OrderState storage state = _orderStates[orderId];

        if (order.inputToken == address(0)) {
            (bool success,) = state.user.call{value: order.inputAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(order.inputToken).safeTransfer(state.user, order.inputAmount);
        }
    }

    /// @inheritdoc BaseInputSettler
    function _buildResolvedOrder(
        GaslessCrossChainOrder calldata order,
        bytes32 orderId,
        address user,
        bytes memory originFillerData
    ) internal view override returns (ResolvedCrossChainOrder memory resolved) {
        TokenOrder storage tokenOrder = orders[orderId];

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(tokenOrder.inputToken))),
            amount: tokenOrder.inputAmount,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: chainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(tokenOrder.outputToken))),
            amount: tokenOrder.outputAmount,
            recipient: bytes32(uint256(uint160(tokenOrder.recipient))),
            chainId: tokenOrder.destinationChainId
        });

        FillInstruction[] memory fillInstructions = new FillInstruction[](1);
        fillInstructions[0] = FillInstruction({
            destinationChainId: SafeCast.toUint64(tokenOrder.destinationChainId),
            destinationSettler: bytes32(0),
            originData: originFillerData
        });

        resolved = ResolvedCrossChainOrder({
            user: user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });
    }

    // ============ View Functions ============

    /// @notice Resolve a gasless order into a full resolved order
    function resolveFor(GaslessCrossChainOrder calldata order, bytes calldata originFillerData)
        external
        view
        override
        returns (ResolvedCrossChainOrder memory resolved)
    {
        // Decode order data
        (
            address inputToken,
            uint256 inputAmount,
            address outputToken,
            uint256 outputAmount,
            uint256 destinationChainId,
            address recipient,
            uint256 maxFee
        ) = abi.decode(order.orderData, (address, uint256, address, uint256, uint256, address, uint256));

        bytes32 orderId = keccak256(
            abi.encodePacked(
                order.user, order.nonce, chainId, inputToken, inputAmount, destinationChainId, block.number
            )
        );

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(inputToken))),
            amount: inputAmount + maxFee,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: chainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(outputToken))),
            amount: outputAmount,
            recipient: bytes32(uint256(uint160(recipient))),
            chainId: destinationChainId
        });

        FillInstruction[] memory fillInstructions = new FillInstruction[](1);
        fillInstructions[0] = FillInstruction({
            destinationChainId: SafeCast.toUint64(destinationChainId),
            destinationSettler: bytes32(0),
            originData: originFillerData
        });

        resolved = ResolvedCrossChainOrder({
            user: order.user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });
    }

    /**
     * @notice Get token order details
     * @param orderId Order ID
     * @return order Token order details
     */
    function getOrder(bytes32 orderId) external view returns (TokenOrder memory) {
        return orders[orderId];
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
