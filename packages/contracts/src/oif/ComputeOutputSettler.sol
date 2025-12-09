// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    IOutputSettler,
    ComputeRentalOrderData,
    ComputeInferenceOrderData,
    COMPUTE_RENTAL_ORDER_TYPE,
    COMPUTE_INFERENCE_ORDER_TYPE
} from "./IOIF.sol";

/**
 * @title ComputeOutputSettler
 * @author Jeju Network
 * @notice OIF OutputSettler for compute intents (rentals + inference)
 * @dev Routes cross-chain compute intents to ComputeRental/InferenceServing contracts
 *
 * Flow:
 * 1. User creates compute intent on source chain (locks payment)
 * 2. Compute solver monitors for compute intents
 * 3. Solver calls fillComputeRental/fillComputeInference
 * 4. This contract calls ComputeRental/InferenceServing
 * 5. Oracle attests fill, solver claims payment on source chain
 */
contract ComputeOutputSettler is IOutputSettler, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    uint256 public immutable chainId;
    address public computeRental;
    address public inferenceServing;
    address public ledgerManager;

    mapping(address => mapping(address => uint256)) public solverLiquidity;
    mapping(address => uint256) public solverETH;
    mapping(bytes32 => bool) public filledOrders;
    mapping(bytes32 => FillRecord) public fillRecords;

    struct FillRecord {
        address solver;
        address user;
        bytes32 rentalId;
        uint256 paymentAmount;
        uint256 filledBlock;
        bool isRental;
    }

    // ============ Events ============

    event LiquidityDeposited(address indexed solver, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed solver, address indexed token, uint256 amount);
    event ComputeRentalFilled(
        bytes32 indexed orderId, bytes32 indexed rentalId, address indexed provider, address user, uint256 durationHours
    );
    event ComputeInferenceFilled(bytes32 indexed orderId, address indexed provider, address indexed user, string model);
    event InferenceSettled(
        bytes32 indexed orderId,
        address indexed provider,
        address indexed user,
        uint256 inputTokens,
        uint256 outputTokens
    );

    // ============ Errors ============

    error OrderAlreadyFilled();
    error InsufficientLiquidity();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidProvider();
    error TransferFailed();
    error ComputeRentalNotSet();
    error InferenceServingNotSet();
    error RentalCreationFailed();

    // ============ Constructor ============

    constructor(uint256 _chainId, address _computeRental, address _inferenceServing, address _ledgerManager)
        Ownable(msg.sender)
    {
        chainId = _chainId;
        computeRental = _computeRental;
        inferenceServing = _inferenceServing;
        ledgerManager = _ledgerManager;
    }

    // ============ Admin ============

    function setComputeContracts(address _computeRental, address _inferenceServing, address _ledgerManager)
        external
        onlyOwner
    {
        computeRental = _computeRental;
        inferenceServing = _inferenceServing;
        ledgerManager = _ledgerManager;
    }

    // ============ Solver Liquidity ============

    function depositLiquidity(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        solverLiquidity[msg.sender][token] += amount;
        emit LiquidityDeposited(msg.sender, token, amount);
    }

    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        solverETH[msg.sender] += msg.value;
        emit LiquidityDeposited(msg.sender, address(0), msg.value);
    }

    function withdrawLiquidity(address token, uint256 amount) external nonReentrant {
        if (solverLiquidity[msg.sender][token] < amount) revert InsufficientLiquidity();
        solverLiquidity[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, token, amount);
    }

    function withdrawETH(uint256 amount) external nonReentrant {
        if (solverETH[msg.sender] < amount) revert InsufficientLiquidity();
        solverETH[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit LiquidityWithdrawn(msg.sender, address(0), amount);
    }

    // ============ Fill (IOutputSettler) ============

    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData)
        external
        payable
        override
        nonReentrant
    {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();

        // Decode order type from first 32 bytes of originData
        bytes32 orderType = bytes32(0);
        if (originData.length >= 32) {
            orderType = bytes32(originData[:32]);
        }

        if (orderType == COMPUTE_RENTAL_ORDER_TYPE) {
            (ComputeRentalOrderData memory data, address user, uint256 payment) =
                abi.decode(fillerData, (ComputeRentalOrderData, address, uint256));
            _fillRental(orderId, data, user, payment);
        } else if (orderType == COMPUTE_INFERENCE_ORDER_TYPE) {
            (ComputeInferenceOrderData memory data, address user, uint256 payment) =
                abi.decode(fillerData, (ComputeInferenceOrderData, address, uint256));
            _fillInference(orderId, data, user, payment);
        } else {
            // Standard token fill
            (address token, uint256 amount, address recipient, uint256 gas) =
                abi.decode(fillerData, (address, uint256, address, uint256));
            _fillToken(orderId, token, amount, recipient, gas);
        }

        emit Fill(orderId, keccak256(originData), fillerData);
    }

    // ============ Compute Rental Fill ============

    function fillComputeRental(bytes32 orderId, ComputeRentalOrderData calldata data, address user, uint256 payment)
        external
        nonReentrant
        returns (bytes32 rentalId)
    {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
        rentalId = _fillRental(orderId, data, user, payment);
        emit Fill(orderId, COMPUTE_RENTAL_ORDER_TYPE, abi.encode(rentalId));
    }

    function _fillRental(bytes32 orderId, ComputeRentalOrderData memory data, address user, uint256 payment)
        internal
        returns (bytes32 rentalId)
    {
        if (computeRental == address(0)) revert ComputeRentalNotSet();
        if (data.provider == address(0)) revert InvalidProvider();
        if (user == address(0)) revert InvalidRecipient();

        // CEI: Mark filled before external call
        filledOrders[orderId] = true;

        // Deduct solver's ETH
        if (solverETH[msg.sender] < payment) revert InsufficientLiquidity();
        solverETH[msg.sender] -= payment;

        // Call ComputeRental.createRentalFor to properly assign the user
        (bool success, bytes memory result) = computeRental.call{value: payment}(
            abi.encodeWithSignature(
                "createRentalFor(address,address,uint256,string,string,string)",
                user,
                data.provider,
                data.durationHours,
                data.sshPublicKey,
                data.containerImage,
                data.startupScript
            )
        );
        if (!success) revert RentalCreationFailed();
        rentalId = abi.decode(result, (bytes32));

        fillRecords[orderId] = FillRecord({
            solver: msg.sender,
            user: user,
            rentalId: rentalId,
            paymentAmount: payment,
            filledBlock: block.number,
            isRental: true
        });

        emit ComputeRentalFilled(orderId, rentalId, data.provider, user, data.durationHours);
    }

    // ============ Compute Inference Fill ============

    function fillComputeInference(
        bytes32 orderId,
        ComputeInferenceOrderData calldata data,
        address user,
        uint256 payment
    ) external nonReentrant {
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
        _fillInference(orderId, data, user, payment);
        emit Fill(orderId, COMPUTE_INFERENCE_ORDER_TYPE, abi.encode(data.model));
    }

    function _fillInference(bytes32 orderId, ComputeInferenceOrderData memory data, address user, uint256 payment)
        internal
    {
        if (user == address(0)) revert InvalidRecipient();

        // CEI: Mark filled
        filledOrders[orderId] = true;

        // For cross-chain inference:
        // 1. Solver executes inference off-chain with a provider
        // 2. Solver deposits payment to LedgerManager on user's behalf
        // 3. Solver calls InferenceServing.settle with provider signature
        //
        // This simplified version just records the fill.
        // The actual settlement is done separately via settleInference().

        fillRecords[orderId] = FillRecord({
            solver: msg.sender,
            user: user,
            rentalId: bytes32(0),
            paymentAmount: payment,
            filledBlock: block.number,
            isRental: false
        });

        emit ComputeInferenceFilled(orderId, data.provider, user, data.model);
    }

    /**
     * @notice Settle an inference request with provider signature
     * @dev Solver calls this after executing inference off-chain
     * @param orderId The original order ID
     * @param provider Provider address
     * @param requestHash Hash of the request
     * @param inputTokens Number of input tokens
     * @param outputTokens Number of output tokens
     * @param nonce User's nonce with provider
     * @param signature Provider's settlement signature
     */
    function settleInference(
        bytes32 orderId,
        address provider,
        bytes32 requestHash,
        uint256 inputTokens,
        uint256 outputTokens,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant {
        FillRecord storage record = fillRecords[orderId];
        if (record.solver != msg.sender) revert InvalidProvider();
        if (inferenceServing == address(0)) revert InferenceServingNotSet();

        // Call InferenceServing.settle
        // Note: This requires the user to have deposited and acknowledged the provider
        (bool success,) = inferenceServing.call(
            abi.encodeWithSignature(
                "settle(address,bytes32,uint256,uint256,uint256,bytes)",
                provider,
                requestHash,
                inputTokens,
                outputTokens,
                nonce,
                signature
            )
        );

        // Don't revert on failure - settlement might be done separately
        if (success) {
            emit InferenceSettled(orderId, provider, record.user, inputTokens, outputTokens);
        }
    }

    // ============ Standard Token Fill ============

    function _fillToken(bytes32 orderId, address token, uint256 amount, address recipient, uint256 gasAmount)
        internal
    {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        filledOrders[orderId] = true;

        fillRecords[orderId] = FillRecord({
            solver: msg.sender,
            user: recipient,
            rentalId: bytes32(0),
            paymentAmount: amount,
            filledBlock: block.number,
            isRental: false
        });

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
                (bool success,) = recipient.call{value: gasAmount}("");
                if (!success) revert TransferFailed();
            }
        }
    }

    // ============ View ============

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
