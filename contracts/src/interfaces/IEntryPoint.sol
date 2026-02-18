// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IEntryPoint
 * @notice Minimal interface for ERC-4337 EntryPoint v0.6.0
 */
interface IEntryPoint {
    /**
     * @notice Deposit ETH for an account
     * @param account The account to deposit for
     */
    function depositTo(address account) external payable;

    /**
     * @notice Withdraw ETH from deposit
     * @param withdrawAddress Address to withdraw to
     * @param withdrawAmount Amount to withdraw
     */
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

    /**
     * @notice Get the deposit balance of an account
     * @param account The account to query
     * @return The deposit balance
     */
    function balanceOf(address account) external view returns (uint256);
}
