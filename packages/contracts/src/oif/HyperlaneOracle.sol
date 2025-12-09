// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracle} from "./IOIF.sol";

/**
 * @title HyperlaneOracle
 * @author Jeju Network
 * @notice Oracle for cross-chain attestations via Hyperlane
 * @dev Receives messages from Hyperlane mailbox and attests order fulfillment
 *
 * ## How it works:
 * 1. OutputSettler on destination chain emits Fill event
 * 2. Hyperlane relayer sends message to this oracle
 * 3. Oracle verifies message and stores attestation
 * 4. InputSettler checks attestation before releasing funds
 *
 * ## Security:
 * - Only Hyperlane mailbox can call handle()
 * - Attestations are immutable once set
 * - Trusted relayer model (Hyperlane security)
 */
contract HyperlaneOracle is IOracle, Ownable {
    // ============ State Variables ============

    /// @notice Hyperlane mailbox contract
    address public mailbox;

    /// @notice Attestations: orderId => attested
    mapping(bytes32 => bool) public attestations;

    /// @notice Attestation data: orderId => proof data
    mapping(bytes32 => bytes) public attestationData;

    /// @notice Trusted remote OutputSettlers: chainId => address
    mapping(uint32 => bytes32) public trustedRemotes;

    /// @notice Block when attestation was received
    mapping(bytes32 => uint256) public attestedBlock;

    // ============ Events ============

    event AttestationReceived(
        bytes32 indexed orderId, uint32 indexed originChain, address indexed solver, uint256 amount
    );

    event TrustedRemoteSet(uint32 indexed chainId, bytes32 remote);
    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);

    // ============ Errors ============

    error OnlyMailbox();
    error UntrustedRemote();
    error AlreadyAttested();

    // ============ Modifiers ============

    modifier onlyMailbox() {
        if (msg.sender != mailbox) revert OnlyMailbox();
        _;
    }

    // ============ Constructor ============

    constructor(address _mailbox) Ownable(msg.sender) {
        mailbox = _mailbox;
    }

    // ============ Admin Functions ============

    function setMailbox(address _mailbox) external onlyOwner {
        emit MailboxUpdated(mailbox, _mailbox);
        mailbox = _mailbox;
    }

    function setTrustedRemote(uint32 chainId, bytes32 remote) external onlyOwner {
        trustedRemotes[chainId] = remote;
        emit TrustedRemoteSet(chainId, remote);
    }

    // ============ Hyperlane Handler ============

    /**
     * @notice Handle incoming message from Hyperlane
     * @param origin Origin chain domain
     * @param sender Sender address on origin chain
     * @param body Message body (encoded attestation)
     */
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external onlyMailbox {
        // Verify sender is trusted OutputSettler
        if (trustedRemotes[origin] != sender) revert UntrustedRemote();

        // Decode attestation
        (bytes32 orderId, address solver,, uint256 amount,,) =
            abi.decode(body, (bytes32, address, address, uint256, address, uint256));

        if (attestations[orderId]) revert AlreadyAttested();

        attestations[orderId] = true;
        attestationData[orderId] = body;
        attestedBlock[orderId] = block.number;

        emit AttestationReceived(orderId, origin, solver, amount);
    }

    // ============ IOracle Implementation ============

    /// @inheritdoc IOracle
    function hasAttested(bytes32 orderId) external view override returns (bool) {
        return attestations[orderId];
    }

    /// @inheritdoc IOracle
    function getAttestation(bytes32 orderId) external view override returns (bytes memory) {
        return attestationData[orderId];
    }

    /// @inheritdoc IOracle
    /// @dev In Hyperlane model, attestations come via handle(), not direct submission
    function submitAttestation(bytes32 orderId, bytes calldata proof) external override {
        // Only owner can submit manual attestations (for testing/emergency)
        require(msg.sender == owner(), "Only owner");
        if (attestations[orderId]) revert AlreadyAttested();

        attestations[orderId] = true;
        attestationData[orderId] = proof;
        attestedBlock[orderId] = block.number;
    }

    // ============ View Functions ============

    function getAttestedBlock(bytes32 orderId) external view returns (uint256) {
        return attestedBlock[orderId];
    }

    function isTrustedRemote(uint32 chainId, bytes32 remote) external view returns (bool) {
        return trustedRemotes[chainId] == remote;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
