// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * @title LocalCrossDomainMessenger
 * @notice Local simulation of OP Stack CrossDomainMessenger for L1↔L2 messaging
 * @dev Used for local development. The message-relay service watches SentMessage events
 *      and calls relayMessage on the target chain's messenger.
 */
contract LocalCrossDomainMessenger is Ownable {
    // ============ Events ============
    
    /// @notice Emitted when a message is sent to the other chain
    event SentMessage(
        address indexed target,
        address sender,
        bytes message,
        uint256 messageNonce,
        uint256 gasLimit
    );

    /// @notice Emitted when a message is relayed from the other chain
    event RelayedMessage(bytes32 indexed msgHash);

    /// @notice Emitted when a message relay fails
    event FailedRelayedMessage(bytes32 indexed msgHash);

    // ============ State ============

    /// @notice Address of the messenger on the other chain
    address public otherMessenger;

    /// @notice Authorized relayer addresses (message relay service)
    mapping(address => bool) public authorizedRelayers;

    /// @notice The sender of the current cross-domain message being executed
    address public xDomainMessageSender;

    /// @notice Nonce for sent messages
    uint256 public messageNonce;

    /// @notice Processed message hashes
    mapping(bytes32 => bool) public successfulMessages;
    mapping(bytes32 => bool) public failedMessages;

    // ============ Errors ============

    error NotAuthorizedRelayer();
    error MessageAlreadyRelayed();
    error NoXDomainMessageSender();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        // Owner is initial authorized relayer
        authorizedRelayers[msg.sender] = true;
    }

    // ============ Admin Functions ============

    /// @notice Set the other chain's messenger address
    function setOtherMessenger(address _otherMessenger) external onlyOwner {
        otherMessenger = _otherMessenger;
    }

    /// @notice Authorize or deauthorize a relayer
    function setAuthorizedRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
    }

    // ============ Message Sending ============

    /**
     * @notice Send a message to the other chain
     * @param target Address to call on the other chain
     * @param message Calldata to pass to the target
     * @param gasLimit Gas limit for execution on the other chain
     */
    function sendMessage(
        address target,
        bytes calldata message,
        uint32 gasLimit
    ) external {
        emit SentMessage(target, msg.sender, message, messageNonce, gasLimit);
        messageNonce++;
    }

    // ============ Message Relaying ============

    /**
     * @notice Relay a message from the other chain
     * @dev Called by the message relay service
     * @param target Address to call
     * @param sender Original sender on the other chain
     * @param message Calldata to pass
     * @param _nonce Message nonce (for replay protection)
     */
    function relayMessage(
        address target,
        address sender,
        bytes calldata message,
        uint256 _nonce
    ) external {
        if (!authorizedRelayers[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedRelayer();
        }

        bytes32 msgHash = keccak256(abi.encode(target, sender, message, _nonce));

        if (successfulMessages[msgHash] || failedMessages[msgHash]) {
            revert MessageAlreadyRelayed();
        }

        // Set the cross-domain sender for the duration of the call
        xDomainMessageSender = sender;

        // Execute the message
        (bool success,) = target.call(message);

        // Clear the sender
        xDomainMessageSender = address(0);

        if (success) {
            successfulMessages[msgHash] = true;
            emit RelayedMessage(msgHash);
        } else {
            failedMessages[msgHash] = true;
            emit FailedRelayedMessage(msgHash);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get the cross-domain message sender
     * @dev Must be called during message execution (inside relayMessage call)
     */
    function getCrossDomainMessageSender() external view returns (address) {
        if (xDomainMessageSender == address(0)) {
            revert NoXDomainMessageSender();
        }
        return xDomainMessageSender;
    }
}

