// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title IOptimismPortal
/// @notice Interface for OP Stack OptimismPortal with Decentralized modifications
/// @dev This interface shows what changes are needed to OptimismPortal for Decentralized
interface IOptimismPortal {
    function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes memory _data)
        external
        payable;

    function finalizeWithdrawalTransaction(bytes memory _tx) external;
    function proveWithdrawalTransaction(
        bytes memory _tx,
        uint256 _l2OutputIndex,
        bytes32 _outputRootProof,
        bytes[] calldata _withdrawalProof
    ) external;

    function paused() external view returns (bool);
    function l2Oracle() external view returns (address);
    function governanceTimelock() external view returns (address);
}

/// @title IOptimismPortalDecentralized
/// @notice Additional interface for Decentralized specific functions
interface IOptimismPortalDecentralized {
    function pause() external;
    function unpause() external;
    function setGasPayingToken(address _token, uint8 _decimals, bytes32 _name, bytes32 _symbol) external;

    event TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes opaqueData);
    event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from, address indexed to);
    event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success);
}
