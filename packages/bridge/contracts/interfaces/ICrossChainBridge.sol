// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICrossChainBridge
 * @notice Interface for the cross-chain token bridge
 * @dev Handles token transfers between EVM chains and Solana
 */
interface ICrossChainBridge {
    /// @notice Transfer status
    enum TransferStatus {
        PENDING,
        SOURCE_CONFIRMED,
        PROVING,
        PROOF_GENERATED,
        DEST_SUBMITTED,
        COMPLETED,
        FAILED
    }

    /// @notice Cross-chain transfer request
    struct TransferRequest {
        bytes32 transferId;
        uint256 sourceChainId;
        uint256 destChainId;
        address token;
        address sender;
        bytes32 recipient; // Can be EVM address or Solana pubkey
        uint256 amount;
        uint256 nonce;
        uint256 timestamp;
        bytes payload; // Optional: for contract calls
    }

    /// @notice Emitted when a transfer is initiated
    event TransferInitiated(
        bytes32 indexed transferId,
        address indexed token,
        address indexed sender,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId
    );

    /// @notice Emitted when a transfer is completed on destination
    event TransferCompleted(
        bytes32 indexed transferId,
        address indexed token,
        bytes32 sender,
        address indexed recipient,
        uint256 amount
    );

    /// @notice Emitted when a transfer fails
    event TransferFailed(bytes32 indexed transferId, string reason);

    /**
     * @notice Initiate a cross-chain token transfer
     * @param token Token to transfer
     * @param recipient Recipient on destination chain (bytes32 for Solana compatibility)
     * @param amount Amount to transfer
     * @param destChainId Destination chain ID
     * @param payload Optional payload for cross-chain contract call
     * @return transferId Unique transfer identifier
     */
    function initiateTransfer(
        address token,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId,
        bytes calldata payload
    ) external payable returns (bytes32 transferId);

    /**
     * @notice Complete a transfer from Solana (called by relayer with proof)
     * @param transferId Transfer ID from source chain
     * @param token Token being transferred
     * @param sender Sender on Solana (bytes32 pubkey)
     * @param recipient Recipient on this chain
     * @param amount Amount to receive
     * @param slot Solana slot at which transfer was confirmed
     * @param proof ZK proof of transfer inclusion
     * @param publicInputs Public inputs for the proof
     */
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

    /**
     * @notice Get transfer status
     * @param transferId Transfer to query
     * @return status Current status
     */
    function getTransferStatus(bytes32 transferId) external view returns (TransferStatus status);

    /**
     * @notice Get required fee for a transfer
     * @param destChainId Destination chain
     * @param payloadLength Length of optional payload
     * @return fee Required fee in native token
     */
    function getTransferFee(
        uint256 destChainId,
        uint256 payloadLength
    ) external view returns (uint256 fee);

    /**
     * @notice Register a new token for bridging
     * @param token Token address on this chain
     * @param solanaToken Corresponding token address on Solana (mint pubkey)
     * @param isNative Whether this is the home chain for the token
     */
    function registerToken(address token, bytes32 solanaToken, bool isNative) external;

    /**
     * @notice Check if a token is registered
     * @param token Token to check
     * @return registered True if registered
     */
    function isTokenRegistered(address token) external view returns (bool registered);
}
