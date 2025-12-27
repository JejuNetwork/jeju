// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ComputeRentalOrderData,
    ComputeInferenceOrderData,
    COMPUTE_RENTAL_ORDER_TYPE,
    COMPUTE_INFERENCE_ORDER_TYPE
} from "./IOIF.sol";
import {BaseOutputSettler} from "./BaseOutputSettler.sol";

/**
 * @title ComputeOutputSettler
 * @author Jeju Network
 * @notice OIF OutputSettler for compute intents (rentals + inference)
 * @dev Extends BaseOutputSettler with compute-specific fill logic
 *
 * Flow:
 * 1. User creates compute intent on source chain (locks payment)
 * 2. Compute solver monitors for compute intents
 * 3. Solver calls fillComputeRental/fillComputeInference
 * 4. This contract calls ComputeRental/InferenceServing
 * 5. Oracle attests fill, solver claims payment on source chain
 */
contract ComputeOutputSettler is BaseOutputSettler {
    using SafeERC20 for IERC20;

    // ============ State ============

    address public computeRental;
    address public inferenceServing;
    address public ledgerManager;

    /// @notice Compute-specific fill records
    mapping(bytes32 => ComputeFillRecord) public computeFillRecords;

    // ============ Structs ============

    struct ComputeFillRecord {
        address solver;
        address user;
        bytes32 rentalId;
        uint256 paymentAmount;
        uint256 filledBlock;
        bool isRental;
    }

    // ============ Events ============

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
    event ComputeContractsUpdated(address computeRental, address inferenceServing, address ledgerManager);

    // ============ Errors ============

    error InvalidProvider();
    error ComputeRentalNotSet();
    error InferenceServingNotSet();
    error RentalCreationFailed();
    // Note: OrderAlreadyFilled, InsufficientLiquidity, etc. inherited from BaseOutputSettler

    // ============ Constructor ============

    constructor(uint256 _chainId, address _computeRental, address _inferenceServing, address _ledgerManager)
        BaseOutputSettler(_chainId)
    {
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
        emit ComputeContractsUpdated(_computeRental, _inferenceServing, _ledgerManager);
    }

    // ============ IOutputSettler Implementation ============

    /// @notice Fills an order on the destination chain
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
            // Standard token fill - delegate to base
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

        // Call ComputeRental.createRentalFor
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

        computeFillRecords[orderId] = ComputeFillRecord({
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

        computeFillRecords[orderId] = ComputeFillRecord({
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
        ComputeFillRecord storage record = computeFillRecords[orderId];
        if (record.solver != msg.sender) revert InvalidProvider();
        if (inferenceServing == address(0)) revert InferenceServingNotSet();

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
            recipient: recipient,
            token: token,
            amount: amount,
            gasProvided: gasAmount,
            filledBlock: block.number,
            filledTimestamp: block.timestamp
        });

        emit OrderFilled(orderId, msg.sender, recipient, token, amount);

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

    // ============ View Functions ============

    function getComputeFillRecord(bytes32 orderId) external view returns (ComputeFillRecord memory) {
        return computeFillRecords[orderId];
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
