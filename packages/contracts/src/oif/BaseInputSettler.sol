// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

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
 * @title BaseInputSettler
 * @author Jeju Network
 * @notice Abstract base contract for OIF InputSettlers
 * @dev Implementations override asset-specific locking/unlocking logic
 */
abstract contract BaseInputSettler is IInputSettler, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    /// @notice Blocks before solver can claim (fraud proof window)
    uint256 public constant CLAIM_DELAY = 150;

    // ============ State Variables ============

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Oracle contract for cross-chain attestations
    IOracle public oracle;

    /// @notice Solver registry contract
    address public solverRegistry;

    /// @notice User nonces for replay protection
    mapping(address => uint256) public nonces;

    /// @notice Order state tracking
    mapping(bytes32 => OrderState) internal _orderStates;

    // ============ Structs ============

    /// @notice Common order state fields
    struct OrderState {
        address user;
        address solver;
        uint32 openDeadline;
        uint32 fillDeadline;
        uint256 createdBlock;
        bool filled;
        bool refunded;
    }

    // ============ Events ============

    event OrderClaimed(bytes32 indexed orderId, address indexed solver, uint256 claimBlock);
    event OrderSettled(bytes32 indexed orderId, address indexed solver);
    event OrderRefunded(bytes32 indexed orderId, address indexed user);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event SolverRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ============ Errors ============

    error OrderExpired();
    error OrderNotExpired();
    error OrderAlreadyFilled();
    error OrderAlreadyRefunded();
    error OrderNotFound();
    error InvalidSignature();
    error InvalidDeadline();
    error NotAttested();
    error ClaimDelayNotPassed();
    error OnlySolver();
    error AlreadyClaimed();

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
        emit SolverRegistryUpdated(solverRegistry, _registry);
        solverRegistry = _registry;
    }

    // ============ Order Management ============

    /// @notice Opens a new cross-chain order
    function open(GaslessCrossChainOrder calldata order) external override nonReentrant {
        _openOrder(order, msg.sender, "");
    }

    /// @notice Opens an order on behalf of a user (gasless)
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

    /**
     * @notice Internal order opening logic
     * @param order The order to open
     * @param user The user (msg.sender or from signature)
     * @param originFillerData Optional filler data
     */
    function _openOrder(GaslessCrossChainOrder calldata order, address user, bytes memory originFillerData) internal {
        // Validate deadlines
        if (block.number > order.openDeadline) revert OrderExpired();
        if (order.fillDeadline <= order.openDeadline) revert InvalidDeadline();

        // Lock assets and get order ID (implemented by child)
        bytes32 orderId = _lockAssets(order, user);

        // Update nonce
        nonces[user] = order.nonce + 1;

        // Store order state
        _orderStates[orderId] = OrderState({
            user: user,
            solver: address(0),
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            createdBlock: block.number,
            filled: false,
            refunded: false
        });

        // Build and emit resolved order
        ResolvedCrossChainOrder memory resolved = _buildResolvedOrder(order, orderId, user, originFillerData);

        emit Open(orderId, resolved);
    }

    // ============ Solver Functions ============

    /**
     * @notice Claim an order (solver commits to fill)
     * @param orderId The order to claim
     */
    function claimOrder(bytes32 orderId) external nonReentrant {
        OrderState storage state = _orderStates[orderId];

        if (state.user == address(0)) revert OrderNotFound();
        if (state.filled || state.refunded) revert OrderAlreadyFilled();
        if (block.number > state.openDeadline) revert OrderExpired();
        if (state.solver != address(0)) revert AlreadyClaimed();

        state.solver = msg.sender;

        emit OrderClaimed(orderId, msg.sender, block.number);
    }

    /**
     * @notice Settle an order after oracle attestation
     * @param orderId The order to settle
     */
    function settle(bytes32 orderId) external nonReentrant {
        OrderState storage state = _orderStates[orderId];

        if (state.user == address(0)) revert OrderNotFound();
        if (state.filled) revert OrderAlreadyFilled();
        if (state.refunded) revert OrderAlreadyRefunded();
        if (state.solver != msg.sender) revert OnlySolver();

        // Check oracle attestation
        if (!oracle.hasAttested(orderId)) revert NotAttested();

        // Check claim delay (fraud proof window)
        uint256 attestationBlock = oracle.getAttestationBlock(orderId);
        if (attestationBlock == 0) revert NotAttested();
        if (block.number < attestationBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        state.filled = true;

        // Release assets to solver (implemented by child)
        _releaseAssetsToSolver(orderId, msg.sender);

        emit OrderSettled(orderId, msg.sender);
    }

    // ============ User Functions ============

    /**
     * @notice Refund an expired order
     * @param orderId The order to refund
     */
    function refund(bytes32 orderId) external nonReentrant {
        OrderState storage state = _orderStates[orderId];

        if (state.user == address(0)) revert OrderNotFound();
        if (state.filled) revert OrderAlreadyFilled();
        if (state.refunded) revert OrderAlreadyRefunded();
        if (block.number <= state.fillDeadline) revert OrderNotExpired();

        state.refunded = true;

        // Return assets to user (implemented by child)
        _refundAssetsToUser(orderId);

        emit OrderRefunded(orderId, state.user);
    }

    // ============ View Functions ============

    /**
     * @notice Get order state
     * @param orderId Order ID
     * @return state Order state
     */
    function getOrderState(bytes32 orderId) external view returns (OrderState memory) {
        return _orderStates[orderId];
    }

    /**
     * @notice Check if order can be settled
     * @param orderId Order ID
     * @return canSettle True if settleable
     */
    function canSettle(bytes32 orderId) external view returns (bool) {
        OrderState storage state = _orderStates[orderId];
        if (state.filled || state.refunded || state.solver == address(0)) return false;
        if (!oracle.hasAttested(orderId)) return false;

        uint256 attestationBlock = oracle.getAttestationBlock(orderId);
        return attestationBlock > 0 && block.number >= attestationBlock + CLAIM_DELAY;
    }

    /**
     * @notice Check if order can be refunded
     * @param orderId Order ID
     * @return canRefund True if refundable
     */
    function canRefund(bytes32 orderId) external view returns (bool) {
        OrderState storage state = _orderStates[orderId];
        return !state.filled && !state.refunded && block.number > state.fillDeadline;
    }

    /**
     * @notice Get user's current nonce
     * @param user User address
     * @return nonce Current nonce
     */
    function getUserNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    // ============ Abstract Functions ============

    /**
     * @notice Lock assets on order creation
     * @param order The order being created
     * @param user The user creating the order
     * @return orderId The generated order ID
     * @dev Must transfer assets from user to this contract
     */
    function _lockAssets(GaslessCrossChainOrder calldata order, address user)
        internal
        virtual
        returns (bytes32 orderId);

    /**
     * @notice Release locked assets to solver after attestation
     * @param orderId The order ID
     * @param solver The solver to receive assets
     * @dev Must transfer assets from this contract to solver
     */
    function _releaseAssetsToSolver(bytes32 orderId, address solver) internal virtual;

    /**
     * @notice Refund locked assets to user on expiry
     * @param orderId The order ID
     * @dev Must transfer assets from this contract back to user
     */
    function _refundAssetsToUser(bytes32 orderId) internal virtual;

    /**
     * @notice Build ResolvedCrossChainOrder for emission
     * @param order The original order
     * @param orderId The generated order ID
     * @param user The user address
     * @param originFillerData Filler data
     * @return resolved The resolved order
     */
    function _buildResolvedOrder(
        GaslessCrossChainOrder calldata order,
        bytes32 orderId,
        address user,
        bytes memory originFillerData
    ) internal view virtual returns (ResolvedCrossChainOrder memory resolved);

    // ============ Receive ============

    receive() external payable {}
}
