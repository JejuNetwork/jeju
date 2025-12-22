// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IZKBridge
 * @notice Interface for ZK light client cross-chain bridge
 * @dev Used for EVM <-> Solana trustless bridging with ZK proofs
 */
interface IZKBridge {
    // ============ Enums ============

    enum TransferStatus {
        NONE,
        PENDING,
        COMPLETED,
        FAILED,
        REFUNDED
    }

    // ============ Structs ============

    struct TransferRequest {
        address sender;
        bytes32 recipient;
        address token;
        uint256 amount;
        uint256 destChainId;
        bytes payload;
        uint256 nonce;
        uint256 timestamp;
    }

    // ============ Events ============

    event TransferInitiated(
        bytes32 indexed transferId,
        address indexed token,
        address indexed sender,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId
    );

    event TransferCompleted(
        bytes32 indexed transferId,
        address indexed token,
        bytes32 sender,
        address indexed recipient,
        uint256 amount
    );

    event TransferFailed(
        bytes32 indexed transferId,
        string reason
    );

    // ============ Functions ============

    function initiateTransfer(
        address token,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId,
        bytes calldata payload
    ) external payable returns (bytes32 transferId);

    function completeTransfer(
        bytes32 transferId,
        address token,
        bytes32 sender,
        address recipient,
        uint256 amount,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external;

    function getTransferStatus(bytes32 transferId) external view returns (TransferStatus);

    function getTransferFee(uint256 destChainId, uint256 payloadLength) external view returns (uint256);

    function isTokenRegistered(address token) external view returns (bool);
}

