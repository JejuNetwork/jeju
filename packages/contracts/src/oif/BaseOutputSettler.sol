// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOutputSettler} from "./IOIF.sol";

/**
 * @title BaseOutputSettler
 * @author Jeju Network
 * @notice Abstract base contract for OIF OutputSettlers
 * @dev Implementations override fill-specific logic
 */
abstract contract BaseOutputSettler is IOutputSettler, Ownable, ReentrancyGuard {
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
        bytes32 indexed orderId,
        address indexed solver,
        address indexed recipient,
        address token,
        uint256 amount
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

    /**
     * @notice Deposit ERC20 liquidity for filling orders
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function depositLiquidity(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        solverLiquidity[msg.sender][token] += amount;

        emit LiquidityDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Deposit ETH for gas sponsorship
     */
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        solverETH[msg.sender] += msg.value;

        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Withdraw ERC20 liquidity
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (solverLiquidity[msg.sender][token] < amount) revert InsufficientLiquidity();

        solverLiquidity[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw ETH
     * @param amount Amount to withdraw
     */
    function withdrawETH(uint256 amount) external nonReentrant {
        if (solverETH[msg.sender] < amount) revert InsufficientLiquidity();

        solverETH[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit LiquidityWithdrawn(msg.sender, address(0), amount);
    }

    // ============ Fill Functions ============

    /**
     * @notice Fill an order with tokens from solver's liquidity
     * @param orderId Order ID
     * @param token Token to transfer
     * @param amount Amount to transfer
     * @param recipient Recipient address
     * @param gasAmount Gas to include (ETH)
     */
    function fillWithLiquidity(
        bytes32 orderId,
        address token,
        uint256 amount,
        address recipient,
        uint256 gasAmount
    ) external nonReentrant {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
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

        emit Fill(orderId, bytes32(0), abi.encode(token, amount, recipient, gasAmount));
        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

        // Transfer from liquidity pool
        if (token == address(0)) {
            uint256 total = amount + gasAmount;
            if (solverETH[msg.sender] < total) revert InsufficientLiquidity();
            solverETH[msg.sender] -= total;
            (bool success,) = recipient.call{value: total}("");
            if (!success) revert TransferFailed();
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

    /**
     * @notice Fill order directly (without pre-deposited liquidity)
     * @param orderId Order to fill
     * @param token Token to transfer
     * @param amount Amount to transfer
     * @param recipient Address to receive tokens
     */
    function fillDirect(
        bytes32 orderId,
        address token,
        uint256 amount,
        address recipient
    ) external payable nonReentrant {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        // Mark filled before external calls (CEI)
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

        emit Fill(orderId, bytes32(0), abi.encode(token, amount, recipient, uint256(0)));
        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

        // Transfer directly
        if (token == address(0)) {
            if (msg.value < amount) revert InsufficientLiquidity();
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();

            // Refund excess
            if (msg.value > amount) {
                (bool refundSuccess,) = msg.sender.call{value: msg.value - amount}("");
                if (!refundSuccess) revert TransferFailed();
            }
        } else {
            IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Check if order is filled
     * @param orderId Order ID
     * @return filled True if filled
     */
    function isFilled(bytes32 orderId) external view returns (bool) {
        return filledOrders[orderId];
    }

    /**
     * @notice Get fill record
     * @param orderId Order ID
     * @return record Fill record
     */
    function getFillRecord(bytes32 orderId) external view returns (FillRecord memory) {
        return fillRecords[orderId];
    }

    /**
     * @notice Get solver's token liquidity
     * @param solver Solver address
     * @param token Token address
     * @return amount Liquidity amount
     */
    function getSolverLiquidity(address solver, address token) external view returns (uint256) {
        return solverLiquidity[solver][token];
    }

    /**
     * @notice Get solver's ETH balance
     * @param solver Solver address
     * @return amount ETH amount
     */
    function getSolverETH(address solver) external view returns (uint256) {
        return solverETH[solver];
    }

    // ============ Abstract Functions ============

    /**
     * @notice Fill an order - must be implemented by subclasses
     * @dev Required by IOutputSettler interface
     * @param orderId Order ID to fill
     * @param originData Data from origin chain
     * @param fillerData Data provided by filler
     */
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata fillerData
    ) external payable virtual override;

    // ============ Receive ============

    receive() external payable {}
}
