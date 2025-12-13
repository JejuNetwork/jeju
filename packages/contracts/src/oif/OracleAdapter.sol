// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracle} from "./IOIF.sol";

// ============ Hyperlane Interfaces ============

interface IMailbox {
    function localDomain() external view returns (uint32);
    function delivered(bytes32 messageId) external view returns (bool);
    function process(bytes calldata metadata, bytes calldata message) external;
}

interface IInterchainSecurityModule {
    function verify(bytes calldata metadata, bytes calldata message) external returns (bool);
    function moduleType() external view returns (uint8);
}

interface IMessageRecipient {
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external payable;
}

// ============ Superchain Interfaces ============

interface ICrossL2Inbox {
    struct Identifier {
        address origin;
        uint256 blockNumber;
        uint256 logIndex;
        uint256 timestamp;
        uint256 chainId;
    }

    function validateMessage(Identifier calldata id, bytes32 messageHash) external view;
    function origin() external view returns (address);
    function blockNumber() external view returns (uint256);
    function logIndex() external view returns (uint256);
    function timestamp() external view returns (uint256);
    function chainId() external view returns (uint256);
}

interface IL2ToL2CrossDomainMessenger {
    function crossDomainMessageSender() external view returns (address);
    function crossDomainMessageSource() external view returns (uint256);
    function sendMessage(uint256 destination, address target, bytes calldata message) external returns (bytes32);
    function relayMessage(ICrossL2Inbox.Identifier calldata id, address sentTo, bytes calldata sentMessage)
        external
        payable;
}

/**
 * @title OracleAdapter
 * @author Jeju Network
 * @notice Base oracle adapter for cross-chain attestations
 * @dev Implement specific oracles (Hyperlane, Superchain, etc.) by extending this
 */
abstract contract OracleAdapter is IOracle, Ownable {
    // ============ State Variables ============

    /// @notice Attestation storage: orderId => attested
    mapping(bytes32 => bool) public attestations;

    /// @notice Attestation proofs: orderId => proof
    mapping(bytes32 => bytes) public proofs;

    /// @notice Attestation timestamps: orderId => timestamp
    mapping(bytes32 => uint256) public attestedAt;

    /// @notice Authorized attesters
    mapping(address => bool) public authorizedAttesters;

    // ============ Events ============

    event AttestationSubmitted(bytes32 indexed orderId, address indexed attester, uint256 timestamp);
    event AttesterUpdated(address indexed attester, bool authorized);

    // ============ Errors ============

    error UnauthorizedAttester();
    error AlreadyAttested();
    error NotAttested();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin ============

    function setAttester(address attester, bool authorized) external onlyOwner {
        authorizedAttesters[attester] = authorized;
        emit AttesterUpdated(attester, authorized);
    }

    // ============ IOracle Implementation ============

    /// @inheritdoc IOracle
    function hasAttested(bytes32 orderId) external view override returns (bool) {
        return attestations[orderId];
    }

    /// @inheritdoc IOracle
    function getAttestation(bytes32 orderId) external view override returns (bytes memory) {
        if (!attestations[orderId]) revert NotAttested();
        return proofs[orderId];
    }

    /// @inheritdoc IOracle
    function submitAttestation(bytes32 orderId, bytes calldata proof) external override {
        if (!authorizedAttesters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedAttester();
        }
        if (attestations[orderId]) revert AlreadyAttested();

        // Verify proof (implemented by specific oracle)
        _verifyProof(orderId, proof);

        attestations[orderId] = true;
        proofs[orderId] = proof;
        attestedAt[orderId] = block.timestamp;

        emit AttestationSubmitted(orderId, msg.sender, block.timestamp);
    }

    /// @notice Verify the attestation proof
    /// @dev Override in specific oracle implementations
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal virtual;

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }
}

/**
 * @title SimpleOracle
 * @notice Simple trusted attester oracle for testing/development
 * @dev Uses trusted attesters to submit attestations (no cryptographic verification)
 */
contract SimpleOracle is OracleAdapter {
    /// @dev No verification - trusts authorized attesters
    function _verifyProof(bytes32, bytes calldata) internal pure override {
        // Trust authorized attester
    }
}

/**
 * @title HyperlaneOracle
 * @notice Hyperlane-based oracle for cross-chain attestations
 * @dev Verifies Hyperlane message proofs using ISM verification
 *
 * ## Proof Format:
 * proof = abi.encode(metadata, message, sourceChainId)
 * - metadata: ISM-specific verification data
 * - message: Hyperlane message bytes
 * - sourceChainId: Origin chain ID
 *
 * ## Message Body Format:
 * body = abi.encode(orderId, outputToken, amount, recipient, fillBlock)
 */
contract HyperlaneOracle is OracleAdapter {
    /// @notice Hyperlane Mailbox contract
    IMailbox public mailbox;

    /// @notice Hyperlane ISM (Interchain Security Module)
    IInterchainSecurityModule public ism;

    /// @notice Domain IDs for each chain: chainId => Hyperlane domain
    mapping(uint256 => uint32) public domainIds;

    /// @notice Trusted sender addresses on each domain: domain => sender
    mapping(uint32 => bytes32) public trustedSenders;

    /// @notice Processed message IDs to prevent replay
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Whether to require full ISM verification (can be disabled for testing)
    bool public requireISMVerification = true;

    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event ISMUpdated(address indexed oldISM, address indexed newISM);
    event DomainIdSet(uint256 indexed chainId, uint32 domainId);
    event TrustedSenderSet(uint32 indexed domain, bytes32 sender);
    event MessageVerified(bytes32 indexed messageId, bytes32 indexed orderId, uint32 origin);

    error InvalidMessageFormat();
    error UntrustedSender();
    error MessageAlreadyProcessed();
    error ISMVerificationFailed();
    error MailboxNotSet();
    error ISMNotSet();

    function setMailbox(address _mailbox) external onlyOwner {
        emit MailboxUpdated(address(mailbox), _mailbox);
        mailbox = IMailbox(_mailbox);
    }

    function setISM(address _ism) external onlyOwner {
        emit ISMUpdated(address(ism), _ism);
        ism = IInterchainSecurityModule(_ism);
    }

    function setDomainId(uint256 chainId, uint32 domainId) external onlyOwner {
        domainIds[chainId] = domainId;
        emit DomainIdSet(chainId, domainId);
    }

    function setTrustedSender(uint32 domain, bytes32 sender) external onlyOwner {
        trustedSenders[domain] = sender;
        emit TrustedSenderSet(domain, sender);
    }

    function setRequireISMVerification(bool _require) external onlyOwner {
        requireISMVerification = _require;
    }

    /**
     * @notice Verify Hyperlane message proof
     * @dev Decodes and verifies the Hyperlane message using ISM
     * @param orderId The order ID being attested
     * @param proof Encoded proof data: (metadata, message, sourceChainId)
     */
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal override {
        // Decode proof
        (bytes memory metadata, bytes memory message, uint256 sourceChainId) =
            abi.decode(proof, (bytes, bytes, uint256));

        // Parse Hyperlane message format (see Hyperlane docs)
        // Message format: version(1) + nonce(4) + origin(4) + sender(32) + dest(4) + recipient(32) + body(variable)
        if (message.length < 77) revert InvalidMessageFormat();

        uint32 messageOrigin;
        bytes32 sender;
        bytes32 recipient;
        bytes memory body;

        assembly {
            // Skip version(1) + nonce(4)
            messageOrigin := mload(add(message, 37)) // offset 5, 4 bytes
            sender := mload(add(message, 41)) // offset 9, 32 bytes
            // Skip dest(4)
            recipient := mload(add(message, 77)) // offset 45, 32 bytes
        }

        // Extract body (everything after 77-byte header) using assembly for gas efficiency
        uint256 bodyLength = message.length - 77;
        body = new bytes(bodyLength);
        assembly {
            // Copy body data: from message[77] to body
            let src := add(add(message, 0x20), 77)
            let dst := add(body, 0x20)
            for { let i := 0 } lt(i, bodyLength) { i := add(i, 32) } { mstore(add(dst, i), mload(add(src, i))) }
        }

        // Verify origin matches expected chain
        if (domainIds[sourceChainId] != messageOrigin) revert InvalidMessageFormat();

        // Verify sender is trusted OutputSettler on source chain
        if (trustedSenders[messageOrigin] != sender) revert UntrustedSender();

        // Compute message ID
        bytes32 messageId = keccak256(message);

        // Check for replay
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();

        // Verify with ISM if configured and required
        if (requireISMVerification && address(ism) != address(0)) {
            bool verified = ism.verify(metadata, message);
            if (!verified) revert ISMVerificationFailed();
        }

        // Decode body to verify orderId
        (bytes32 proofOrderId,,,,) = abi.decode(body, (bytes32, address, uint256, address, uint256));
        if (proofOrderId != orderId) revert InvalidMessageFormat();

        // Mark as processed
        processedMessages[messageId] = true;

        emit MessageVerified(messageId, orderId, messageOrigin);
    }

    /**
     * @notice Handle incoming Hyperlane message (alternative attestation path)
     * @dev Called by Mailbox when receiving a message
     */
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external {
        if (address(mailbox) == address(0)) revert MailboxNotSet();
        require(msg.sender == address(mailbox), "Only mailbox");
        if (trustedSenders[origin] != sender) revert UntrustedSender();

        // Decode body to get orderId
        (bytes32 orderId,,,,) = abi.decode(body, (bytes32, address, uint256, address, uint256));

        // Auto-attest the order
        if (!attestations[orderId]) {
            attestations[orderId] = true;
            proofs[orderId] = body;
            attestedAt[orderId] = block.timestamp;

            emit AttestationSubmitted(orderId, msg.sender, block.timestamp);
        }
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}

/**
 * @title SuperchainOracle
 * @notice Oracle for OP Superchain native interop
 * @dev Uses L2-to-L2 cross-chain messaging via shared sequencer
 *
 * ## Proof Format:
 * proof = abi.encode(identifier, messageHash, messageBody)
 * - identifier: CrossL2Inbox.Identifier struct
 * - messageHash: keccak256 of the cross-chain message
 * - messageBody: The actual message content
 *
 * ## Security Model:
 * - Uses OP Superchain's native L2-to-L2 messaging
 * - Messages are validated by the shared sequencer
 * - CrossL2Inbox validates message inclusion in the chain
 */
contract SuperchainOracle is OracleAdapter {
    /// @notice CrossL2Inbox predeploy address (OP Superchain)
    ICrossL2Inbox public constant CROSS_L2_INBOX = ICrossL2Inbox(0x4200000000000000000000000000000000000022);

    /// @notice L2ToL2CrossDomainMessenger predeploy (OP Superchain)
    IL2ToL2CrossDomainMessenger public constant L2_TO_L2_MESSENGER =
        IL2ToL2CrossDomainMessenger(0x4200000000000000000000000000000000000023);

    /// @notice Valid source chains: chainId => allowed
    mapping(uint256 => bool) public validSourceChains;

    /// @notice Trusted OutputSettler addresses per chain: chainId => address
    mapping(uint256 => address) public trustedOutputSettlers;

    /// @notice Processed message hashes to prevent replay
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Whether to require full CrossL2Inbox verification (can be disabled for testing)
    bool public requireInboxVerification = true;

    /// @notice This chain's ID for self-reference checks
    uint256 public immutable localChainId;

    event SourceChainUpdated(uint256 indexed chainId, bool valid);
    event TrustedOutputSettlerSet(uint256 indexed chainId, address settler);
    event SuperchainMessageVerified(bytes32 indexed messageHash, bytes32 indexed orderId, uint256 sourceChain);

    error InvalidSourceChain();
    error UntrustedOutputSettler();
    error MessageAlreadyProcessed();
    error InboxVerificationFailed();
    error InvalidIdentifier();
    error OrderIdMismatch();
    error SameChainNotAllowed();

    constructor(uint256 _localChainId) {
        localChainId = _localChainId;
    }

    function setSourceChain(uint256 chainId, bool valid) external onlyOwner {
        validSourceChains[chainId] = valid;
        emit SourceChainUpdated(chainId, valid);
    }

    function setTrustedOutputSettler(uint256 chainId, address settler) external onlyOwner {
        trustedOutputSettlers[chainId] = settler;
        emit TrustedOutputSettlerSet(chainId, settler);
    }

    function setRequireInboxVerification(bool _require) external onlyOwner {
        requireInboxVerification = _require;
    }

    /**
     * @notice Verify Superchain cross-L2 message proof
     * @dev Validates the message through CrossL2Inbox
     * @param orderId The order ID being attested
     * @param proof Encoded proof: (identifier, messageHash, messageBody)
     */
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal override {
        // Decode proof
        (ICrossL2Inbox.Identifier memory identifier, bytes32 messageHash, bytes memory messageBody) =
            abi.decode(proof, (ICrossL2Inbox.Identifier, bytes32, bytes));

        // Validate source chain
        if (!validSourceChains[identifier.chainId]) revert InvalidSourceChain();
        if (identifier.chainId == localChainId) revert SameChainNotAllowed();

        // Validate trusted sender
        if (trustedOutputSettlers[identifier.chainId] != identifier.origin) {
            revert UntrustedOutputSettler();
        }

        // Check for replay
        if (processedMessages[messageHash]) revert MessageAlreadyProcessed();

        // Verify message hash matches body
        if (keccak256(messageBody) != messageHash) revert InvalidIdentifier();

        // Verify through CrossL2Inbox if enabled
        if (requireInboxVerification) {
            // This will revert if the message is not valid
            // The inbox validates that the message exists in the source chain's state
            CROSS_L2_INBOX.validateMessage(identifier, messageHash);
        }

        // Decode message body to verify orderId
        // Expected format: abi.encode(orderId, outputToken, amount, recipient, fillBlock)
        (bytes32 proofOrderId,,,,) = abi.decode(messageBody, (bytes32, address, uint256, address, uint256));
        if (proofOrderId != orderId) revert OrderIdMismatch();

        // Mark as processed
        processedMessages[messageHash] = true;

        emit SuperchainMessageVerified(messageHash, orderId, identifier.chainId);
    }

    /**
     * @notice Handle incoming L2-to-L2 message (alternative attestation path)
     * @dev Called via relayMessage when receiving cross-chain messages
     * @param orderId Order ID to attest
     * @param outputToken Output token address
     * @param amount Output amount
     * @param recipient Recipient address
     * @param fillBlock Block number of fill
     */
    function handleCrossChainFill(
        bytes32 orderId,
        address outputToken,
        uint256 amount,
        address recipient,
        uint256 fillBlock
    ) external {
        // Verify caller is the L2ToL2CrossDomainMessenger
        require(msg.sender == address(L2_TO_L2_MESSENGER), "Only messenger");

        // Get the cross-domain sender info
        address xDomainSender = L2_TO_L2_MESSENGER.crossDomainMessageSender();
        uint256 xDomainSource = L2_TO_L2_MESSENGER.crossDomainMessageSource();

        // Validate source chain and sender
        if (!validSourceChains[xDomainSource]) revert InvalidSourceChain();
        if (trustedOutputSettlers[xDomainSource] != xDomainSender) revert UntrustedOutputSettler();

        // Auto-attest the order
        if (!attestations[orderId]) {
            attestations[orderId] = true;
            proofs[orderId] = abi.encode(orderId, outputToken, amount, recipient, fillBlock);
            attestedAt[orderId] = block.timestamp;

            emit AttestationSubmitted(orderId, msg.sender, block.timestamp);
        }
    }

    /**
     * @notice Get identifier info for debugging
     */
    function getIdentifierInfo(bytes calldata proof)
        external
        pure
        returns (address origin, uint256 blockNumber, uint256 logIndex, uint256 timestamp, uint256 chainId)
    {
        (ICrossL2Inbox.Identifier memory id,,) = abi.decode(proof, (ICrossL2Inbox.Identifier, bytes32, bytes));
        return (id.origin, id.blockNumber, id.logIndex, id.timestamp, id.chainId);
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}
