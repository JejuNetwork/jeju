// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOutputSettler} from "./IOIF.sol";

/**
 * @title OutputSettler
 * @author Jeju Network
 * @notice OIF OutputSettler for solver fills on destination chain
 * @dev Handles output delivery to users and generates attestation proofs
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
contract OutputSettler is IOutputSettler, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Solver liquidity deposits: solver => token => amount
    mapping(address => mapping(address => uint256)) public solverLiquidity;

    /// @notice Solver ETH deposits for gas sponsorship
    mapping(address => uint256) public solverETH;

    /// @notice Filled orders: orderId => filled
    mapping(bytes32 => bool) public filledOrders;

    /// @notice Fill details: orderId => FillRecord
    mapping(bytes32 => FillRecord) public fillRecords;

    // ============ Structs ============

    struct FillRecord {
        address solver;
        address recipient;
        address token;
        uint256 amount;
        uint256 gasProvided;
        uint256 filledBlock;
        uint256 filledTimestamp;
    }

    // ============ Events ============

    event LiquidityDeposited(address indexed solver, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed solver, address indexed token, uint256 amount);
    event OrderFilled(
        bytes32 indexed orderId, address indexed solver, address indexed recipient, address token, uint256 amount
    );

    // ============ Errors ============

    error OrderAlreadyFilled();
    error InsufficientLiquidity();
    error InvalidAmount();
    error InvalidRecipient();
    error TransferFailed();

    // ============ Constructor ============

    constructor(uint256 _chainId) Ownable(msg.sender) {
        chainId = _chainId;
    }

    // ============ Solver Liquidity Management ============

    /// @notice Deposit ERC20 liquidity for filling orders
    /// @param token Token to deposit
    /// @param amount Amount to deposit
    function depositLiquidity(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        solverLiquidity[msg.sender][token] += amount;

        emit LiquidityDeposited(msg.sender, token, amount);
    }

    /// @notice Deposit ETH for gas sponsorship
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        solverETH[msg.sender] += msg.value;

        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    /// @notice Withdraw ERC20 liquidity
    /// @param token Token to withdraw
    /// @param amount Amount to withdraw
    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (solverLiquidity[msg.sender][token] < amount) revert InsufficientLiquidity();

        solverLiquidity[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, token, amount);
    }

    /// @notice Withdraw ETH
    /// @param amount Amount to withdraw
    function withdrawETH(uint256 amount) external nonReentrant {
        if (solverETH[msg.sender] < amount) revert InsufficientLiquidity();

        solverETH[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit LiquidityWithdrawn(msg.sender, address(0), amount);
    }

    // ============ Order Filling ============

    /// @inheritdoc IOutputSettler
    /// @custom:security CEI pattern: Mark order filled before external calls
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData)
        external
        payable
        override
        nonReentrant
    {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();

        // Decode fill parameters
        // Format: (token, amount, recipient, gasAmount)
        (address token, uint256 amount, address recipient, uint256 gasAmount) =
            abi.decode(fillerData, (address, uint256, address, uint256));

        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        // EFFECTS: Mark as filled BEFORE external calls (CEI pattern)
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

        // Emit events before external calls
        emit Fill(orderId, keccak256(originData), fillerData);
        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

        // INTERACTIONS: Transfer output to recipient
        if (token == address(0)) {
            // Native ETH
            uint256 totalRequired = amount + gasAmount;
            if (msg.value >= totalRequired) {
                // Solver sent ETH with tx
                (bool success,) = recipient.call{value: amount + gasAmount}("");
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
            // ERC20
            if (solverLiquidity[msg.sender][token] < amount) revert InsufficientLiquidity();
            solverLiquidity[msg.sender][token] -= amount;
            IERC20(token).safeTransfer(recipient, amount);

            // Transfer gas if needed
            if (gasAmount > 0) {
                if (solverETH[msg.sender] < gasAmount) revert InsufficientLiquidity();
                solverETH[msg.sender] -= gasAmount;
                (bool gasSuccess,) = recipient.call{value: gasAmount}("");
                if (!gasSuccess) revert TransferFailed();
            }
        }
    }

    /// @notice Fill order directly (without pre-deposited liquidity)
    /// @param orderId Order to fill
    /// @param token Token to transfer
    /// @param amount Amount to transfer
    /// @param recipient Address to receive tokens
    /// @custom:security CEI pattern: Mark order filled before external calls
    function fillDirect(bytes32 orderId, address token, uint256 amount, address recipient)
        external
        payable
        nonReentrant
    {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        // EFFECTS: Mark as filled BEFORE external calls (CEI pattern)
        filledOrders[orderId] = true;
        fillRecords[orderId] = FillRecord({
            solver: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            gasProvided: 0,
            filledBlock: block.number,
            filledTimestamp: block.timestamp
        });

        // Emit events before external calls
        emit Fill(orderId, bytes32(0), abi.encode(token, amount, recipient, uint256(0)));
        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

        // INTERACTIONS: Transfer to recipient
        if (token == address(0)) {
            // Native ETH
            if (msg.value < amount) revert InsufficientLiquidity();
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();

            // Refund excess
            if (msg.value > amount) {
                (bool refundSuccess,) = msg.sender.call{value: msg.value - amount}("");
                if (!refundSuccess) revert TransferFailed();
            }
        } else {
            // ERC20 - transfer from solver
            IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
        }
    }

    // ============ View Functions ============

    function isFilled(bytes32 orderId) external view returns (bool) {
        return filledOrders[orderId];
    }

    function getFillRecord(bytes32 orderId) external view returns (FillRecord memory) {
        return fillRecords[orderId];
    }

    function getSolverLiquidity(address solver, address token) external view returns (uint256) {
        return solverLiquidity[solver][token];
    }

    function getSolverETH(address solver) external view returns (uint256) {
        return solverETH[solver];
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
