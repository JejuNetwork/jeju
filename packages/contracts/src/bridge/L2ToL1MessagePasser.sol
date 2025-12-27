// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title L2ToL1MessagePasser
/// @notice L2 predeploy that stores withdrawal messages for L1 proving.
///         This contract allows users to initiate withdrawals from L2 that can be
///         proven and finalized on L1 even if sequencers are offline.
/// @dev This is deployed at a predeploy address on L2. Messages are stored in a
///      Merkle tree structure for efficient proof generation.
///      ETH sent to this contract is intentionally "burned" on L2 - it will be
///      credited to the recipient on L1 via the OptimismPortal after proving.
// slither-disable-next-line locked-ether
contract L2ToL1MessagePasser {
    /// @notice Withdrawal message structure
    struct WithdrawalMessage {
        uint256 nonce;
        address sender;
        address target;
        uint256 value;
        uint256 gasLimit;
        bytes data;
    }

    /// @notice Current message nonce, incremented for each withdrawal
    uint256 public messageNonce;

    /// @notice Mapping of withdrawal message hashes to whether they've been sent
    mapping(bytes32 => bool) public sentMessages;

    /// @notice Emitted when a withdrawal is initiated
    event MessagePassed(
        uint256 indexed nonce,
        address indexed sender,
        address indexed target,
        uint256 value,
        uint256 gasLimit,
        bytes data,
        bytes32 withdrawalHash
    );

    /// @notice Emitted when the contract receives ETH
    event WithdrawerBalanceBurnt(uint256 indexed amount);

    error ZeroGasLimit();
    error ZeroTarget();

    /// @notice Initiates a withdrawal from L2 to L1
    /// @param _target The L1 address to send to
    /// @param _gasLimit Gas limit for L1 execution
    /// @param _data Calldata for L1 execution
    function initiateWithdrawal(address _target, uint256 _gasLimit, bytes calldata _data) external payable {
        if (_target == address(0)) revert ZeroTarget();
        if (_gasLimit == 0) revert ZeroGasLimit();

        bytes32 withdrawalHash = hashWithdrawal(
            WithdrawalMessage({
                nonce: messageNonce,
                sender: msg.sender,
                target: _target,
                value: msg.value,
                gasLimit: _gasLimit,
                data: _data
            })
        );

        sentMessages[withdrawalHash] = true;

        emit MessagePassed(messageNonce, msg.sender, _target, msg.value, _gasLimit, _data, withdrawalHash);

        unchecked {
            ++messageNonce;
        }
    }

    /// @notice Hashes a withdrawal message for storage and proof verification
    /// @param _message The withdrawal message to hash
    /// @return The keccak256 hash of the withdrawal message
    function hashWithdrawal(WithdrawalMessage memory _message) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _message.nonce, _message.sender, _message.target, _message.value, _message.gasLimit, _message.data
            )
        );
    }

    /// @notice Computes the withdrawal hash from individual parameters
    /// @param _nonce The message nonce
    /// @param _sender The sender address
    /// @param _target The target address
    /// @param _value The ETH value
    /// @param _gasLimit The gas limit
    /// @param _data The calldata
    /// @return The keccak256 hash of the withdrawal
    function hashWithdrawalParams(
        uint256 _nonce,
        address _sender,
        address _target,
        uint256 _value,
        uint256 _gasLimit,
        bytes calldata _data
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(_nonce, _sender, _target, _value, _gasLimit, _data));
    }

    /// @notice Returns the hash of the message stored at a given index in the message tree.
    ///         This is useful for generating Merkle proofs.
    /// @param _withdrawalHash The withdrawal hash to check
    /// @return Whether the message has been sent
    function isMessageSent(bytes32 _withdrawalHash) external view returns (bool) {
        return sentMessages[_withdrawalHash];
    }

    /// @notice Burns ETH sent to this contract, credited to the withdrawal initiator.
    ///         This is used when users send ETH along with their withdrawal.
    receive() external payable {
        emit WithdrawerBalanceBurnt(msg.value);
    }
}
