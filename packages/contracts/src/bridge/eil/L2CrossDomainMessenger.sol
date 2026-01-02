// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title L2CrossDomainMessenger
 * @notice L2 side of the cross-domain messaging system
 * @dev Emits SentMessage events that the relay service picks up and delivers to L1
 *
 * Security Model:
 * - Only authorized relayers can call relayMessage
 * - Messages are verified via hash to prevent replay
 * - xDomainMessageSender is only set during message execution
 */
contract L2CrossDomainMessenger {
    /// @notice The L1 messenger address (set after deployment)
    address public l1Messenger;

    /// @notice The address of the sender of the current cross-domain message
    address public xDomainMessageSender;

    /// @notice Message nonce for ordering
    uint256 public messageNonce;

    /// @notice Mapping of message hash to whether it has been relayed
    mapping(bytes32 => bool) public successfulMessages;

    /// @notice Authorized relayers who can relay messages
    mapping(address => bool) public authorizedRelayers;

    /// @notice Owner for configuration
    address public owner;

    event SentMessage(
        address indexed target,
        address sender,
        bytes message,
        uint256 messageNonce,
        uint256 gasLimit
    );

    event RelayedMessage(bytes32 indexed msgHash);
    event FailedRelayedMessage(bytes32 indexed msgHash);
    event RelayerUpdated(address indexed relayer, bool authorized);

    error NotOwner();
    error NotAuthorizedRelayer();
    error MessageAlreadyRelayed();
    error MessageRelayFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender]) revert NotAuthorizedRelayer();
        _;
    }

    constructor() {
        owner = msg.sender;
        // Owner is also an authorized relayer by default
        authorizedRelayers[msg.sender] = true;
    }

    /// @notice Set the L1 messenger address
    function setL1Messenger(address _l1Messenger) external onlyOwner {
        l1Messenger = _l1Messenger;
    }

    /// @notice Add or remove an authorized relayer
    function setRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    /// @notice Send a cross-domain message to L1
    /// @param _target Target contract on L1
    /// @param _message Encoded function call
    /// @param _gasLimit Gas limit for L1 execution
    function sendMessage(
        address _target,
        bytes calldata _message,
        uint32 _gasLimit
    ) external {
        uint256 nonce = messageNonce++;

        emit SentMessage(_target, msg.sender, _message, nonce, _gasLimit);
    }

    /// @notice Relay a message from L1
    /// @dev Only authorized relayers can call this
    function relayMessage(
        address _target,
        address _sender,
        bytes calldata _message,
        uint256 _messageNonce
    ) external onlyRelayer {
        bytes32 msgHash = keccak256(abi.encode(_target, _sender, _message, _messageNonce));

        if (successfulMessages[msgHash]) revert MessageAlreadyRelayed();

        xDomainMessageSender = _sender;

        (bool success,) = _target.call(_message);

        xDomainMessageSender = address(0);

        if (success) {
            successfulMessages[msgHash] = true;
            emit RelayedMessage(msgHash);
        } else {
            emit FailedRelayedMessage(msgHash);
            revert MessageRelayFailed();
        }
    }

    /// @notice Get the sender of the current cross-domain message
    function getCrossDomainMessageSender() external view returns (address) {
        return xDomainMessageSender;
    }
}
