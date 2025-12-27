// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FederationBridge
 * @notice Cross-chain bridge for Jeju federation (AWS/GCP chains)
 * @dev Enables secure message passing between federated Jeju chains using multi-sig validation.
 *
 * Architecture:
 * - Each chain deploys a FederationBridge pointing to the peer chain
 * - Validators sign messages attesting to cross-chain state
 * - Threshold signatures required to relay messages
 * - Supports arbitrary contract calls and value transfers
 */
contract FederationBridge is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Roles
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Message status
    enum MessageStatus {
        None,      // 0: Not received
        Pending,   // 1: Received but not executed
        Executed,  // 2: Successfully executed
        Failed     // 3: Execution failed
    }

    // Cross-chain message
    struct Message {
        uint256 sourceChainId;
        uint256 targetChainId;
        bytes32 messageId;
        address sender;
        address target;
        bytes data;
        uint256 value;
        uint256 nonce;
        uint256 timestamp;
    }

    // Outbound message record
    struct OutboundMessage {
        bytes32 messageId;
        address sender;
        address target;
        bytes data;
        uint256 value;
        uint256 timestamp;
        bool relayed;
    }

    // Inbound message record
    struct InboundMessage {
        bytes32 messageId;
        address sender;
        address target;
        bytes data;
        uint256 value;
        MessageStatus status;
        uint256 timestamp;
        uint256 confirmations;
    }

    // State
    uint256 public immutable selfChainId;
    uint256 public peerChainId;
    address[] public validators;
    uint256 public threshold;
    uint256 public messageNonce;

    // Message tracking
    mapping(bytes32 => OutboundMessage) public outboundMessages;
    mapping(bytes32 => InboundMessage) public inboundMessages;
    mapping(bytes32 => mapping(address => bool)) public hasConfirmed;

    // Events
    event MessageSent(
        bytes32 indexed messageId,
        uint256 indexed targetChainId,
        address indexed sender,
        address target,
        bytes data,
        uint256 value,
        uint256 nonce
    );

    event MessageReceived(
        bytes32 indexed messageId,
        uint256 indexed sourceChainId,
        address indexed sender,
        address target,
        bytes data,
        uint256 value
    );

    event MessageExecuted(
        bytes32 indexed messageId,
        bool success,
        bytes returnData
    );

    event MessageConfirmed(
        bytes32 indexed messageId,
        address indexed validator,
        uint256 confirmations
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event PeerChainUpdated(uint256 oldChainId, uint256 newChainId);

    // Errors
    error InvalidChainId();
    error InvalidTarget();
    error InsufficientValue();
    error MessageAlreadySent();
    error MessageNotFound();
    error MessageAlreadyExecuted();
    error MessageAlreadyConfirmed();
    error InsufficientConfirmations();
    error InvalidSignatureCount();
    error InvalidSignature();
    error ExecutionFailed();
    error InvalidThreshold();
    error ValidatorAlreadyExists();
    error ValidatorNotFound();

    /**
     * @notice Initialize the federation bridge
     * @param _peerChainId Chain ID of the peer chain
     * @param _validators Initial validator addresses
     * @param _threshold Minimum signatures required
     */
    constructor(
        uint256 _peerChainId,
        address[] memory _validators,
        uint256 _threshold
    ) {
        if (_peerChainId == 0 || _peerChainId == block.chainid) revert InvalidChainId();
        if (_threshold == 0 || _threshold > _validators.length) revert InvalidThreshold();

        selfChainId = block.chainid;
        peerChainId = _peerChainId;
        threshold = _threshold;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        for (uint256 i = 0; i < _validators.length; i++) {
            validators.push(_validators[i]);
            _grantRole(VALIDATOR_ROLE, _validators[i]);
        }
    }

    /**
     * @notice Send a cross-chain message
     * @param targetChainId Target chain ID (must be peer chain)
     * @param target Target contract address
     * @param data Call data
     * @return messageId Unique message identifier
     */
    function sendMessage(
        uint256 targetChainId,
        address target,
        bytes calldata data
    ) external payable returns (bytes32 messageId) {
        if (targetChainId != peerChainId) revert InvalidChainId();
        if (target == address(0)) revert InvalidTarget();

        uint256 nonce = messageNonce++;
        messageId = keccak256(
            abi.encodePacked(
                selfChainId,
                targetChainId,
                msg.sender,
                target,
                data,
                msg.value,
                nonce,
                block.timestamp
            )
        );

        outboundMessages[messageId] = OutboundMessage({
            messageId: messageId,
            sender: msg.sender,
            target: target,
            data: data,
            value: msg.value,
            timestamp: block.timestamp,
            relayed: false
        });

        emit MessageSent(
            messageId,
            targetChainId,
            msg.sender,
            target,
            data,
            msg.value,
            nonce
        );

        return messageId;
    }

    /**
     * @notice Receive and execute a cross-chain message (relayer entry point)
     * @param sourceChainId Source chain ID
     * @param messageId Message identifier
     * @param sender Original sender
     * @param target Target contract
     * @param data Call data
     * @param signatures Validator signatures
     * @return success Whether execution succeeded
     */
    function receiveMessage(
        uint256 sourceChainId,
        bytes32 messageId,
        address sender,
        address target,
        bytes calldata data,
        bytes[] calldata signatures
    ) external nonReentrant returns (bool success) {
        if (sourceChainId != peerChainId) revert InvalidChainId();
        if (signatures.length < threshold) revert InvalidSignatureCount();

        InboundMessage storage inbound = inboundMessages[messageId];
        if (inbound.status == MessageStatus.Executed) revert MessageAlreadyExecuted();

        // Verify signatures
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                sourceChainId,
                selfChainId,
                messageId,
                sender,
                target,
                data
            )
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        uint256 validSignatures = 0;
        address[] memory signers = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedHash.recover(signatures[i]);
            if (!hasRole(VALIDATOR_ROLE, signer)) revert InvalidSignature();

            // Check for duplicate signers
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == signer) revert InvalidSignature();
            }
            signers[i] = signer;
            validSignatures++;
        }

        if (validSignatures < threshold) revert InsufficientConfirmations();

        // Record message
        if (inbound.status == MessageStatus.None) {
            inboundMessages[messageId] = InboundMessage({
                messageId: messageId,
                sender: sender,
                target: target,
                data: data,
                value: 0, // Value handled separately in receive
                status: MessageStatus.Pending,
                timestamp: block.timestamp,
                confirmations: validSignatures
            });

            emit MessageReceived(
                messageId,
                sourceChainId,
                sender,
                target,
                data,
                0
            );
        }

        // Execute call
        (success, ) = target.call(data);

        inboundMessages[messageId].status = success
            ? MessageStatus.Executed
            : MessageStatus.Failed;

        emit MessageExecuted(messageId, success, "");

        return success;
    }

    /**
     * @notice Confirm a message as validator (multi-step relay)
     * @param messageId Message to confirm
     * @param sourceChainId Source chain
     * @param sender Original sender
     * @param target Target contract
     * @param data Call data
     */
    function confirmMessage(
        bytes32 messageId,
        uint256 sourceChainId,
        address sender,
        address target,
        bytes calldata data
    ) external onlyRole(VALIDATOR_ROLE) {
        if (hasConfirmed[messageId][msg.sender]) revert MessageAlreadyConfirmed();

        InboundMessage storage inbound = inboundMessages[messageId];

        if (inbound.status == MessageStatus.None) {
            // First confirmation, create record
            inboundMessages[messageId] = InboundMessage({
                messageId: messageId,
                sender: sender,
                target: target,
                data: data,
                value: 0,
                status: MessageStatus.Pending,
                timestamp: block.timestamp,
                confirmations: 1
            });

            emit MessageReceived(messageId, sourceChainId, sender, target, data, 0);
        } else {
            inbound.confirmations++;
        }

        hasConfirmed[messageId][msg.sender] = true;

        emit MessageConfirmed(messageId, msg.sender, inbound.confirmations);

        // Auto-execute if threshold reached
        if (inbound.confirmations >= threshold && inbound.status == MessageStatus.Pending) {
            (bool success, ) = target.call(data);
            inbound.status = success ? MessageStatus.Executed : MessageStatus.Failed;
            emit MessageExecuted(messageId, success, "");
        }
    }

    /**
     * @notice Get message status
     * @param messageId Message identifier
     * @return status Message status
     * @return timestamp Message timestamp
     */
    function getMessageStatus(
        bytes32 messageId
    ) external view returns (uint8 status, uint256 timestamp) {
        InboundMessage storage inbound = inboundMessages[messageId];
        return (uint8(inbound.status), inbound.timestamp);
    }

    /**
     * @notice Get peer chain ID
     * @return Peer chain ID
     */
    function getPeerChainId() external view returns (uint256) {
        return peerChainId;
    }

    /**
     * @notice Get all validators
     * @return Array of validator addresses
     */
    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    /**
     * @notice Get validator count
     * @return Number of validators
     */
    function getValidatorCount() external view returns (uint256) {
        return validators.length;
    }

    // Admin functions

    /**
     * @notice Add a validator
     * @param validator Validator address to add
     */
    function addValidator(address validator) external onlyRole(ADMIN_ROLE) {
        if (hasRole(VALIDATOR_ROLE, validator)) revert ValidatorAlreadyExists();

        validators.push(validator);
        _grantRole(VALIDATOR_ROLE, validator);

        emit ValidatorAdded(validator);
    }

    /**
     * @notice Remove a validator
     * @param validator Validator address to remove
     */
    function removeValidator(address validator) external onlyRole(ADMIN_ROLE) {
        if (!hasRole(VALIDATOR_ROLE, validator)) revert ValidatorNotFound();

        // Find and remove from array
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == validator) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }

        _revokeRole(VALIDATOR_ROLE, validator);

        // Ensure threshold is still valid
        if (threshold > validators.length) {
            threshold = validators.length;
            emit ThresholdUpdated(threshold + 1, threshold);
        }

        emit ValidatorRemoved(validator);
    }

    /**
     * @notice Update signature threshold
     * @param newThreshold New threshold value
     */
    function setThreshold(uint256 newThreshold) external onlyRole(ADMIN_ROLE) {
        if (newThreshold == 0 || newThreshold > validators.length) revert InvalidThreshold();

        uint256 oldThreshold = threshold;
        threshold = newThreshold;

        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Update peer chain ID (migration)
     * @param newPeerChainId New peer chain ID
     */
    function setPeerChainId(uint256 newPeerChainId) external onlyRole(ADMIN_ROLE) {
        if (newPeerChainId == 0 || newPeerChainId == block.chainid) revert InvalidChainId();

        uint256 oldChainId = peerChainId;
        peerChainId = newPeerChainId;

        emit PeerChainUpdated(oldChainId, newPeerChainId);
    }

    /**
     * @notice Recover stuck funds (emergency)
     * @param token Token address (address(0) for ETH)
     * @param to Recipient
     * @param amount Amount to recover
     */
    function recoverFunds(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            (bool success, ) = token.call(
                abi.encodeWithSignature("transfer(address,uint256)", to, amount)
            );
            require(success, "Token transfer failed");
        }
    }

    /**
     * @notice Receive ETH for cross-chain value transfers
     */
    receive() external payable {}
}
