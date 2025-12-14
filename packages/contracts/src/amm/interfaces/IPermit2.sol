// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPermit2
/// @notice Interface for Uniswap's Permit2 contract
/// @dev Enables gasless token approvals via signatures
interface IPermit2 {
    /// @notice Token permission details
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    /// @notice Permit transfer from structure
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Batch permit transfer from structure
    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Signature transfer details
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Single permit2 transfer with signature
    /// @param permit Permit details
    /// @param transferDetails Transfer details
    /// @param owner Token owner
    /// @param signature EIP-712 signature
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Batch permit2 transfer with signature
    /// @param permit Permit details
    /// @param transferDetails Array of transfer details
    /// @param owner Token owner
    /// @param signature EIP-712 signature
    function permitTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Transfer tokens using existing allowance
    /// @param token Token to transfer
    /// @param from Sender address
    /// @param to Recipient address
    /// @param amount Amount to transfer
    function transferFrom(address token, address from, address to, uint256 amount) external;
}
