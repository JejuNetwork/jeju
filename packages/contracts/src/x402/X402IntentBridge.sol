// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {GaslessCrossChainOrder, ResolvedCrossChainOrder, Output, FillInstruction} from "../oif/IOIF.sol";

interface IX402Facilitator {
    function settleWithAuthorization(
        address payer,
        address recipient,
        address token,
        uint256 amount,
        string calldata resource,
        string calldata nonce,
        uint256 timestamp,
        bytes calldata paymentSignature,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        bytes calldata authSignature
    ) external returns (bytes32 paymentId);
}

interface IEIP3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

interface IOIFOracle {
    function hasAttested(bytes32 orderId) external view returns (bool);
    function getAttestation(bytes32 orderId) external view returns (bytes memory);
}

/**
 * @title X402IntentBridge
 * @notice Bridges x402 gasless payments with Open Intents Framework for cross-chain settlement
 * @dev Enables users to pay for cross-chain intents using EIP-3009 gasless authorizations
 *
 * Flow:
 * 1. User creates cross-chain intent (swap USDC on Chain A for ETH on Chain B)
 * 2. User signs x402 payment + EIP-3009 authorization for input tokens
 * 3. Solver fills intent on destination chain
 * 4. Oracle attests fill completion
 * 5. Bridge releases input tokens to solver via x402 gasless settlement
 *
 * Benefits:
 * - User never needs native gas tokens
 * - Single signature covers both intent authorization and token transfer
 * - Atomic cross-chain execution
 */
contract X402IntentBridge is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // EIP-712 typehash for x402 cross-chain intent
    bytes32 public constant CROSSCHAIN_X402_TYPEHASH = keccak256(
        "CrossChainX402Payment(address payer,address inputToken,uint256 inputAmount,uint256 destinationChain,address outputToken,uint256 minOutputAmount,address recipient,uint256 deadline,bytes32 intentNonce)"
    );

    // X402 Facilitator for gasless settlements
    IX402Facilitator public facilitator;

    // Oracle for cross-chain attestations
    address public oracle;

    // Registered solvers
    mapping(address => bool) public registeredSolvers;

    // Intent state
    struct Intent {
        address payer;
        address inputToken;
        uint256 inputAmount;
        uint256 destinationChain;
        address outputToken;
        uint256 minOutputAmount;
        address recipient;
        uint256 deadline;
        address solver;
        bool filled;
        bool settled;
    }

    mapping(bytes32 => Intent) public intents;

    // Events
    event IntentCreated(
        bytes32 indexed intentId,
        address indexed payer,
        address inputToken,
        uint256 inputAmount,
        uint256 destinationChain,
        address recipient
    );

    event IntentFilled(bytes32 indexed intentId, address indexed solver, uint256 outputAmount);

    event IntentSettled(bytes32 indexed intentId, address indexed solver, uint256 inputAmount);

    // Errors
    error InvalidSignature();
    error IntentExpired();
    error IntentAlreadyFilled();
    error IntentNotFilled();
    error NotAuthorizedSolver();
    error OracleNotAttested();
    error InvalidAmount();

    constructor(address _facilitator, address _oracle, address _owner)
        Ownable(_owner)
        EIP712("X402 Intent Bridge", "1")
    {
        facilitator = IX402Facilitator(_facilitator);
        oracle = _oracle;
    }

    /**
     * @notice Create a cross-chain intent with x402 payment authorization
     * @dev User signs both intent and EIP-3009 authorization in one flow
     */
    function createIntent(
        address inputToken,
        uint256 inputAmount,
        uint256 destinationChain,
        address outputToken,
        uint256 minOutputAmount,
        address recipient,
        uint256 deadline,
        bytes32 intentNonce,
        bytes calldata intentSignature,
        // EIP-3009 params for gasless release
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        bytes calldata authSignature
    ) external nonReentrant returns (bytes32 intentId) {
        if (inputAmount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert IntentExpired();

        // Verify intent signature
        bytes32 structHash = keccak256(
            abi.encode(
                CROSSCHAIN_X402_TYPEHASH,
                msg.sender,
                inputToken,
                inputAmount,
                destinationChain,
                outputToken,
                minOutputAmount,
                recipient,
                deadline,
                intentNonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, intentSignature) != msg.sender) revert InvalidSignature();

        intentId = keccak256(abi.encodePacked(msg.sender, intentNonce, block.chainid, block.timestamp));

        // Lock input tokens using EIP-3009 (gasless for user)
        IEIP3009(inputToken).transferWithAuthorization(
            msg.sender, address(this), inputAmount, validAfter, validBefore, authNonce, authSignature
        );

        intents[intentId] = Intent({
            payer: msg.sender,
            inputToken: inputToken,
            inputAmount: inputAmount,
            destinationChain: destinationChain,
            outputToken: outputToken,
            minOutputAmount: minOutputAmount,
            recipient: recipient,
            deadline: deadline,
            solver: address(0),
            filled: false,
            settled: false
        });

        emit IntentCreated(intentId, msg.sender, inputToken, inputAmount, destinationChain, recipient);
    }

    /**
     * @notice Solver claims intent to fill
     */
    function claimIntent(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        if (intent.filled) revert IntentAlreadyFilled();
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (!registeredSolvers[msg.sender]) revert NotAuthorizedSolver();

        intent.solver = msg.sender;
    }

    /**
     * @notice Mark intent as filled using OIF oracle attestation
     * @param intentId The intent to mark filled
     * @param outputAmount Amount delivered on destination
     */
    function markFilled(bytes32 intentId, uint256 outputAmount) external {
        Intent storage intent = intents[intentId];
        if (intent.payer == address(0)) revert IntentExpired();
        if (intent.filled) revert IntentAlreadyFilled();

        // Verify oracle has attested to the fill
        if (!IOIFOracle(oracle).hasAttested(intentId)) revert OracleNotAttested();

        require(outputAmount >= intent.minOutputAmount, "Output below minimum");

        intent.filled = true;
        emit IntentFilled(intentId, intent.solver, outputAmount);
    }

    /**
     * @notice Check if intent can be settled (oracle attested)
     */
    function canSettle(bytes32 intentId) external view returns (bool) {
        Intent storage intent = intents[intentId];
        return intent.filled && !intent.settled && IOIFOracle(oracle).hasAttested(intentId);
    }

    /**
     * @notice Settle intent - release locked tokens to solver
     */
    function settleIntent(bytes32 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];
        if (!intent.filled) revert IntentNotFilled();
        if (intent.settled) revert IntentAlreadyFilled();
        if (msg.sender != intent.solver) revert NotAuthorizedSolver();

        intent.settled = true;

        // Release locked tokens to solver
        IERC20(intent.inputToken).safeTransfer(intent.solver, intent.inputAmount);

        emit IntentSettled(intentId, intent.solver, intent.inputAmount);
    }

    /**
     * @notice Refund expired intent
     */
    function refundIntent(bytes32 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];
        require(!intent.filled, "Intent already filled");
        require(!intent.settled, "Intent already settled");
        require(block.timestamp > intent.deadline, "Intent not expired");

        intent.settled = true;
        IERC20(intent.inputToken).safeTransfer(intent.payer, intent.inputAmount);
    }

    // Admin functions
    function setFacilitator(address _facilitator) external onlyOwner {
        facilitator = IX402Facilitator(_facilitator);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function registerSolver(address solver, bool registered) external onlyOwner {
        registeredSolvers[solver] = registered;
    }
}
