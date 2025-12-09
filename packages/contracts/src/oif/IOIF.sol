// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOIF - Open Intents Framework Interfaces
 * @notice Standard interfaces for OIF protocol components
 * @dev Based on ERC-7683 cross-chain intent standard
 */

// ============ Order Types ============

struct GaslessCrossChainOrder {
    address originSettler;
    address user;
    uint256 nonce;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderDataType;
    bytes orderData;
}

struct Output {
    bytes32 token; // Token address as bytes32 for cross-chain compatibility
    uint256 amount;
    bytes32 recipient; // Recipient as bytes32 for cross-chain compatibility
    uint256 chainId;
}

struct FillInstruction {
    uint64 destinationChainId;
    bytes32 destinationSettler;
    bytes originData;
}

struct ResolvedCrossChainOrder {
    address user;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderId;
    Output[] maxSpent;
    Output[] minReceived;
    FillInstruction[] fillInstructions;
}

// ============ Input Settler Interface ============

interface IInputSettler {
    /// @notice Emitted when an order is opened
    event Open(bytes32 indexed orderId, ResolvedCrossChainOrder order);

    /// @notice Opens a new cross-chain order
    /// @param order The order to open
    function open(GaslessCrossChainOrder calldata order) external;

    /// @notice Opens an order on behalf of a user (gasless)
    /// @param order The order to open
    /// @param signature User's signature authorizing the order
    /// @param originFillerData Optional data for the filler
    function openFor(GaslessCrossChainOrder calldata order, bytes calldata signature, bytes calldata originFillerData)
        external;

    /// @notice Resolves an order into its execution details
    /// @param order The order to resolve
    /// @param originFillerData Data provided by the filler
    /// @return resolved The resolved order details
    function resolveFor(GaslessCrossChainOrder calldata order, bytes calldata originFillerData)
        external
        view
        returns (ResolvedCrossChainOrder memory resolved);
}

// ============ Output Settler Interface ============

interface IOutputSettler {
    /// @notice Emitted when an order is filled
    event Fill(bytes32 indexed orderId, bytes32 indexed originData, bytes fillerData);

    /// @notice Fills an order on the destination chain
    /// @param orderId The order ID to fill
    /// @param originData Data from the origin chain
    /// @param fillerData Data provided by the filler
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external payable;
}

// ============ Oracle Interface ============

interface IOracle {
    /// @notice Checks if an order has been attested (output delivered)
    /// @param orderId The order ID to check
    /// @return attested Whether the output has been attested
    function hasAttested(bytes32 orderId) external view returns (bool);

    /// @notice Gets the attestation data for an order
    /// @param orderId The order ID to get attestation for
    /// @return attestation The attestation proof data
    function getAttestation(bytes32 orderId) external view returns (bytes memory);

    /// @notice Submits an attestation for an order
    /// @param orderId The order ID
    /// @param proof The proof data
    function submitAttestation(bytes32 orderId, bytes calldata proof) external;
}

// ============ Solver Registry Interface ============

interface ISolverRegistry {
    struct SolverInfo {
        address solver;
        uint256 stakedAmount;
        uint256 slashedAmount;
        uint256 totalFills;
        uint256 successfulFills;
        uint256[] supportedChains;
        bool isActive;
        uint256 registeredAt;
    }

    event SolverRegistered(address indexed solver, uint256 stakeAmount, uint256[] chains);
    event SolverStakeDeposited(address indexed solver, uint256 amount, uint256 totalStake);
    event SolverSlashed(address indexed solver, bytes32 indexed orderId, uint256 amount);
    event SolverWithdrawn(address indexed solver, uint256 amount);

    function register(uint256[] calldata chains) external payable;
    function addStake() external payable;
    function startUnbonding(uint256 amount) external;
    function completeUnbonding() external;
    function slash(address solver, bytes32 orderId, uint256 amount, address victim) external;
    function getSolver(address solver) external view returns (SolverInfo memory);
    function isSolverActive(address solver) external view returns (bool);
    function getSolverStake(address solver) external view returns (uint256);
}

// ============ Settlement Callback Interface ============

interface ISettlementCallback {
    /// @notice Called after an order is successfully settled
    /// @param orderId The settled order ID
    /// @param solver The solver that filled the order
    /// @param amount The amount settled
    function onSettlement(bytes32 orderId, address solver, uint256 amount) external;
}

// ============ Compute Intent Types ============

// Order type for compute rental intents
bytes32 constant COMPUTE_RENTAL_ORDER_TYPE = keccak256("ComputeRental");

// Order type for AI inference intents
bytes32 constant COMPUTE_INFERENCE_ORDER_TYPE = keccak256("ComputeInference");

// Compute rental order data
struct ComputeRentalOrderData {
    address provider; // Target compute provider
    uint256 durationHours; // Rental duration in hours
    string sshPublicKey; // User's SSH public key
    string containerImage; // Docker image to run
    string startupScript; // Startup script to execute
}

// AI inference order data
struct ComputeInferenceOrderData {
    address provider; // Target provider (0x0 = any)
    string model; // Model to use
    bytes prompt; // Encoded prompt data
    uint256 maxInputTokens; // Max input tokens
    uint256 maxOutputTokens; // Max output tokens
}
