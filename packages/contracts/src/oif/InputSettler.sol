// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {
    IInputSettler,
    IOracle,
    GaslessCrossChainOrder,
    ResolvedCrossChainOrder,
    Output,
    FillInstruction
} from "./IOIF.sol";

/**
 * @title InputSettler
 * @author Jeju Network
 * @notice OIF InputSettler for receiving intents and locking user funds
 * @dev Implements ERC-7683 compatible input settlement for cross-chain intents
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
contract InputSettler is IInputSettler, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    /// @notice Order data type for standard cross-chain swap
    bytes32 public constant SWAP_ORDER_TYPE = keccak256("CrossChainSwap");

    /// @notice Blocks before solver can claim (fraud proof window)
    uint256 public constant CLAIM_DELAY = 150;

    // ============ State Variables ============

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Oracle contract for cross-chain attestations
    IOracle public oracle;

    /// @notice Solver registry contract
    address public solverRegistry;

    /// @notice Order storage
    mapping(bytes32 => Order) public orders;

    /// @notice User nonces for replay protection
    mapping(address => uint256) public nonces;

    // ============ Structs ============

    struct Order {
        address user;
        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 outputAmount;
        uint256 destinationChainId;
        address recipient;
        uint256 maxFee;
        uint32 openDeadline;
        uint32 fillDeadline;
        address solver;
        bool filled;
        bool refunded;
        uint256 createdBlock;
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

    event OrderClaimed(bytes32 indexed orderId, address indexed solver, uint256 claimBlock);

    event OrderSettled(bytes32 indexed orderId, address indexed solver, uint256 amount, uint256 fee);

    event OrderRefunded(bytes32 indexed orderId, address indexed user, uint256 amount);

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ============ Errors ============

    error OrderExpired();
    error OrderNotExpired();
    error OrderAlreadyFilled();
    error OrderAlreadyRefunded();
    error OrderNotFound();
    error InvalidSignature();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidDeadline();
    error NotAttested();
    error ClaimDelayNotPassed();
    error OnlySolver();
    error TransferFailed();

    // ============ Constructor ============

    constructor(uint256 _chainId, address _oracle, address _solverRegistry) Ownable(msg.sender) {
        chainId = _chainId;
        oracle = IOracle(_oracle);
        solverRegistry = _solverRegistry;
    }

    // ============ Admin Functions ============

    function setOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(address(oracle), _oracle);
        oracle = IOracle(_oracle);
    }

    function setSolverRegistry(address _registry) external onlyOwner {
        solverRegistry = _registry;
    }

    // ============ Order Management ============

    /// @inheritdoc IInputSettler
    function open(GaslessCrossChainOrder calldata order) external override nonReentrant {
        _openOrder(order, msg.sender, "");
    }

    /// @inheritdoc IInputSettler
    function openFor(GaslessCrossChainOrder calldata order, bytes calldata signature, bytes calldata originFillerData)
        external
        override
        nonReentrant
    {
        // Verify signature
        bytes32 orderHash = keccak256(abi.encode(order));
        address signer = orderHash.toEthSignedMessageHash().recover(signature);
        if (signer != order.user) revert InvalidSignature();

        _openOrder(order, order.user, originFillerData);
    }

    function _openOrder(GaslessCrossChainOrder calldata order, address user, bytes memory originFillerData) internal {
        // Validate order
        if (block.number > order.openDeadline) revert OrderExpired();
        if (order.fillDeadline <= order.openDeadline) revert InvalidDeadline();

        // Decode order data (inputToken, inputAmount, outputToken, outputAmount, destChain, recipient, maxFee)
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
        bytes32 orderId = keccak256(
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

        // Update nonce
        nonces[user] = order.nonce + 1;

        // Store order
        orders[orderId] = Order({
            user: user,
            inputToken: inputToken,
            inputAmount: inputAmount,
            outputToken: outputToken,
            outputAmount: outputAmount,
            destinationChainId: destinationChainId,
            recipient: recipient,
            maxFee: maxFee,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            solver: address(0),
            filled: false,
            refunded: false,
            createdBlock: block.number
        });

        // Emit events
        emit OrderCreated(orderId, user, inputToken, inputAmount, destinationChainId, recipient, order.fillDeadline);

        // Build resolved order for Open event
        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(inputToken))),
            amount: inputAmount,
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
            destinationSettler: bytes32(0), // Will be filled by aggregator
            originData: originFillerData
        });

        ResolvedCrossChainOrder memory resolved = ResolvedCrossChainOrder({
            user: user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });

        emit Open(orderId, resolved);
    }

    /// @inheritdoc IInputSettler
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

    // ============ Solver Functions ============

    /// @notice Claim an order (solver commits to fill)
    /// @param orderId The order to claim
    function claimOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled || order.refunded) revert OrderAlreadyFilled();
        if (block.number > order.openDeadline) revert OrderExpired();
        if (order.solver != address(0)) revert OrderAlreadyFilled();

        order.solver = msg.sender;

        emit OrderClaimed(orderId, msg.sender, block.number);
    }

    /// @notice Settle an order after oracle attestation
    /// @param orderId The order to settle
    function settle(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled) revert OrderAlreadyFilled();
        if (order.refunded) revert OrderAlreadyRefunded();
        if (order.solver != msg.sender) revert OnlySolver();

        // Check oracle attestation
        if (!oracle.hasAttested(orderId)) revert NotAttested();

        // Check claim delay
        // Note: In production, this would check the block when attestation was received
        if (block.number < order.createdBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        order.filled = true;

        // Transfer input tokens to solver
        uint256 fee = order.maxFee; // In production, use actual fee from fill
        uint256 solverReceives = order.inputAmount;

        if (order.inputToken == address(0)) {
            (bool success,) = msg.sender.call{value: solverReceives}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(order.inputToken).safeTransfer(msg.sender, solverReceives);
        }

        emit OrderSettled(orderId, msg.sender, solverReceives, fee);
    }

    // ============ User Functions ============

    /// @notice Refund an expired order
    /// @param orderId The order to refund
    function refund(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled) revert OrderAlreadyFilled();
        if (order.refunded) revert OrderAlreadyRefunded();
        if (block.number <= order.fillDeadline) revert OrderNotExpired();

        order.refunded = true;

        // Return input tokens to user
        if (order.inputToken == address(0)) {
            (bool success,) = order.user.call{value: order.inputAmount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(order.inputToken).safeTransfer(order.user, order.inputAmount);
        }

        emit OrderRefunded(orderId, order.user, order.inputAmount);
    }

    // ============ View Functions ============

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function canSettle(bytes32 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        return !order.filled && !order.refunded && order.solver != address(0) && oracle.hasAttested(orderId)
            && block.number >= order.createdBlock + CLAIM_DELAY;
    }

    function canRefund(bytes32 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        return !order.filled && !order.refunded && block.number > order.fillDeadline;
    }

    function getUserNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
