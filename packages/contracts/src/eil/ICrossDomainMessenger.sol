// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICrossDomainMessenger
 * @notice Interface for OP Stack cross-domain messaging
 */
interface ICrossDomainMessenger {
    /**
     * @notice Sends a cross domain message to the target messenger.
     * @param _target Target contract address.
     * @param _message Message to send to the target.
     * @param _minGasLimit Minimum gas limit that the message can be executed with.
     */
    function sendMessage(address _target, bytes calldata _message, uint32 _minGasLimit) external payable;

    /**
     * @notice Retrieves the address of the contract or wallet that initiated the currently
     *         executing message on the other chain.
     * @return Address of the sender of the currently executing message on the other chain.
     */
    function xDomainMessageSender() external view returns (address);
}
