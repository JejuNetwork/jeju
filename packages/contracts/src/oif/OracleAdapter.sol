// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracle} from "./IOIF.sol";

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
 * @dev Verifies Hyperlane message proofs
 */
contract HyperlaneOracle is OracleAdapter {
    /// @notice Hyperlane Mailbox contract
    address public mailbox;

    /// @notice Hyperlane ISM (Interchain Security Module)
    address public ism;

    /// @notice Domain IDs for each chain
    mapping(uint256 => uint32) public domainIds;

    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event ISMUpdated(address indexed oldISM, address indexed newISM);
    event DomainIdSet(uint256 indexed chainId, uint32 domainId);

    function setMailbox(address _mailbox) external onlyOwner {
        emit MailboxUpdated(mailbox, _mailbox);
        mailbox = _mailbox;
    }

    function setISM(address _ism) external onlyOwner {
        emit ISMUpdated(ism, _ism);
        ism = _ism;
    }

    function setDomainId(uint256 chainId, uint32 domainId) external onlyOwner {
        domainIds[chainId] = domainId;
        emit DomainIdSet(chainId, domainId);
    }

    /// @dev Verify Hyperlane message proof
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal view override {
        // In production, this would:
        // 1. Decode the Hyperlane message from proof
        // 2. Verify the message via ISM.verify()
        // 3. Check the message contains the orderId fill confirmation

        // For now, trust authorized attesters
        // Full implementation would call:
        // require(IInterchainSecurityModule(ism).verify(metadata, message), "Invalid proof");
    }
}

/**
 * @title SuperchainOracle
 * @notice Oracle for OP Superchain native interop
 * @dev Uses L2-to-L2 cross-chain messaging via shared sequencer
 */
contract SuperchainOracle is OracleAdapter {
    /// @notice CrossL2Inbox predeploy address
    address public constant CROSS_L2_INBOX = 0x4200000000000000000000000000000000000022;

    /// @notice L2ToL2CrossDomainMessenger predeploy
    address public constant L2_TO_L2_MESSENGER = 0x4200000000000000000000000000000000000023;

    /// @notice Valid source chains
    mapping(uint256 => bool) public validSourceChains;

    event SourceChainUpdated(uint256 indexed chainId, bool valid);

    function setSourceChain(uint256 chainId, bool valid) external onlyOwner {
        validSourceChains[chainId] = valid;
        emit SourceChainUpdated(chainId, valid);
    }

    /// @dev Verify Superchain cross-L2 message
    function _verifyProof(bytes32 orderId, bytes calldata proof) internal view override {
        // In production, this would:
        // 1. Decode the Identifier from proof
        // 2. Call CrossL2Inbox.validateMessage() to verify
        // 3. Ensure the message is from a valid source chain

        // For now, trust authorized attesters
        // Full implementation would verify via:
        // ICrossL2Inbox(CROSS_L2_INBOX).validateMessage(identifier, messageHash)
    }
}
