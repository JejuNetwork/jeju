// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title Mailbox
 * @notice Minimal Hyperlane Mailbox implementation
 * @dev This is a simplified version for testing. Production should use Hyperlane's official contracts.
 */
contract Mailbox is Ownable2Step {
    // Domain ID for this chain
    uint32 public immutable localDomain;

    // Message nonce
    uint32 public nonce;

    // Default ISM (can be overridden per recipient)
    address public defaultIsm;

    // Default hook (post-dispatch)
    address public defaultHook;

    // Required hook (always called)
    address public requiredHook;

    // Delivered messages
    mapping(bytes32 => bool) public delivered;

    // Recipient ISM overrides
    mapping(address => address) public recipientIsmOverrides;

    // Events
    event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message);

    event DispatchId(bytes32 indexed messageId);

    event Process(uint32 indexed origin, bytes32 indexed sender, address indexed recipient);

    event ProcessId(bytes32 indexed messageId);

    constructor(uint32 _localDomain, address _owner) Ownable(_owner) {
        localDomain = _localDomain;
    }

    /**
     * @notice Set the default ISM
     */
    function setDefaultIsm(address _ism) external onlyOwner {
        defaultIsm = _ism;
    }

    /**
     * @notice Set the default hook
     */
    function setDefaultHook(address _hook) external onlyOwner {
        defaultHook = _hook;
    }

    /**
     * @notice Set the required hook
     */
    function setRequiredHook(address _hook) external onlyOwner {
        requiredHook = _hook;
    }

    /**
     * @notice Dispatch a message to a remote chain
     * @param _destination Domain ID of destination chain
     * @param _recipient Recipient address as bytes32
     * @param _body Message body
     * @return messageId The unique message identifier
     */
    function dispatch(uint32 _destination, bytes32 _recipient, bytes calldata _body)
        external
        payable
        returns (bytes32 messageId)
    {
        bytes memory emptyMetadata;
        return _dispatch(_destination, _recipient, _body, emptyMetadata);
    }

    /**
     * @notice Dispatch with metadata
     */
    function dispatch(uint32 _destination, bytes32 _recipient, bytes calldata _body, bytes calldata _metadata)
        external
        payable
        returns (bytes32 messageId)
    {
        return _dispatch(_destination, _recipient, _body, _metadata);
    }

    function _dispatch(uint32 _destination, bytes32 _recipient, bytes calldata _body, bytes memory _metadata)
        internal
        returns (bytes32 messageId)
    {
        uint32 _nonce = nonce;
        nonce = _nonce + 1;

        // Build message
        bytes memory message = abi.encodePacked(
            uint8(3), // version
            _nonce,
            localDomain,
            bytes32(uint256(uint160(msg.sender))), // sender as bytes32
            _destination,
            _recipient,
            _body
        );

        messageId = keccak256(message);

        // Call required hook if set
        if (requiredHook != address(0)) {
            IPostDispatchHook(requiredHook).postDispatch{value: msg.value}(_metadata, message);
        }

        // Call default hook if set
        if (defaultHook != address(0) && defaultHook != requiredHook) {
            IPostDispatchHook(defaultHook).postDispatch(_metadata, message);
        }

        emit Dispatch(msg.sender, _destination, _recipient, message);
        emit DispatchId(messageId);
    }

    /**
     * @notice Process an incoming message
     * @param _metadata ISM metadata for verification
     * @param _message The full message bytes
     */
    function process(bytes calldata _metadata, bytes calldata _message) external {
        // Parse message
        (,, uint32 origin, bytes32 sender,, bytes32 recipientBytes32, bytes memory body) = _parseMessage(_message);

        address recipient = address(uint160(uint256(recipientBytes32)));
        bytes32 messageId = keccak256(_message);

        require(!delivered[messageId], "Already delivered");
        delivered[messageId] = true;

        // Get ISM
        address ism = recipientIsmOverrides[recipient];
        if (ism == address(0)) ism = defaultIsm;

        // Verify with ISM
        if (ism != address(0)) {
            require(IInterchainSecurityModule(ism).verify(_metadata, _message), "ISM verification failed");
        }

        // Deliver to recipient
        IMessageRecipient(recipient).handle(origin, sender, body);

        emit Process(origin, sender, recipient);
        emit ProcessId(messageId);
    }

    function _parseMessage(bytes calldata _message)
        internal
        pure
        returns (
            uint8 version,
            uint32 nonce_,
            uint32 origin,
            bytes32 sender,
            uint32 destination,
            bytes32 recipient,
            bytes memory body
        )
    {
        version = uint8(_message[0]);
        nonce_ = uint32(bytes4(_message[1:5]));
        origin = uint32(bytes4(_message[5:9]));
        sender = bytes32(_message[9:41]);
        destination = uint32(bytes4(_message[41:45]));
        recipient = bytes32(_message[45:77]);
        body = _message[77:];
    }

    /**
     * @notice Get the recipient ISM
     */
    function getRecipientIsm(address _recipient) external view returns (address) {
        address ism = recipientIsmOverrides[_recipient];
        return ism == address(0) ? defaultIsm : ism;
    }

    /**
     * @notice Quote dispatch fee
     */
    function quoteDispatch(uint32 _destination, bytes32, bytes calldata) external view returns (uint256) {
        if (requiredHook == address(0)) return 0;
        return IPostDispatchHook(requiredHook).quoteDispatch("", abi.encodePacked(_destination));
    }
}

interface IInterchainSecurityModule {
    function verify(bytes calldata _metadata, bytes calldata _message) external returns (bool);
}

interface IMessageRecipient {
    function handle(uint32 _origin, bytes32 _sender, bytes calldata _body) external;
}

interface IPostDispatchHook {
    function postDispatch(bytes calldata _metadata, bytes calldata _message) external payable;
    function quoteDispatch(bytes calldata _metadata, bytes calldata _message) external view returns (uint256);
}






