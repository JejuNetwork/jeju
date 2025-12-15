// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ICrossChainBridge.sol";
import "../interfaces/ISolanaLightClient.sol";
import "../interfaces/IGroth16Verifier.sol";
import "../tokens/CrossChainToken.sol";
import "../libraries/SolanaTypes.sol";

/**
 * @title CrossChainBridge
 * @notice Trustless bridge between EVM chains and Solana
 * @dev Uses ZK proofs verified by the Solana Light Client
 *
 * Transfer Flow (EVM → Solana):
 * 1. User calls initiateTransfer(), tokens are locked/burned
 * 2. Relayer observes event, submits to Solana program
 * 3. Solana program verifies EVM state proof, mints tokens
 *
 * Transfer Flow (Solana → EVM):
 * 1. User calls Solana program, tokens are locked/burned
 * 2. Relayer generates ZK proof of Solana state
 * 3. Relayer calls completeTransfer() with proof
 * 4. Bridge verifies proof via light client, mints tokens
 */
contract CrossChainBridge is ICrossChainBridge {
    using SolanaTypes for SolanaTypes.Slot;
    using SolanaTypes for SolanaTypes.Pubkey;


    /// @notice Solana light client for state verification
    ISolanaLightClient public immutable solanaLightClient;

    /// @notice Transfer proof verifier
    IGroth16Verifier public immutable transferVerifier;

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice Solana chain ID constant
    uint256 public constant SOLANA_CHAIN_ID = 101;

    /// @notice Transfer nonce for this chain
    uint256 public transferNonce;

    /// @notice Base fee for transfers (in wei)
    uint256 public baseFee;

    /// @notice Fee per byte of payload
    uint256 public feePerByte;

    /// @notice Admin address
    address public admin;

    /// @notice Fee collector address
    address public feeCollector;

    /// @notice Token registration: EVM token -> Solana mint
    mapping(address => bytes32) public tokenToSolanaMint;

    /// @notice Reverse mapping: Solana mint -> EVM token
    mapping(bytes32 => address) public solanaMintToToken;

    /// @notice Whether token is "home" on this chain (lock) or wrapped (burn)
    mapping(address => bool) public isTokenHome;

    /// @notice Transfer records
    mapping(bytes32 => TransferRecord) public transfers;

    /// @notice Completed transfer IDs (for replay protection)
    mapping(bytes32 => bool) public completedTransfers;

    /// @notice Pending outbound transfers
    bytes32[] public pendingOutbound;


    struct TransferRecord {
        TransferRequest request;
        TransferStatus status;
        uint64 completedSlot;
        bytes32 completedTxHash;
    }


    event TokenRegistered(address indexed token, bytes32 indexed solanaMint, bool isHome);
    event FeeUpdated(uint256 baseFee, uint256 feePerByte);
    event FeesCollected(address indexed collector, uint256 amount);


    error TokenNotRegistered();
    error TransferAlreadyCompleted();
    error InsufficientFee();
    error InvalidProof();
    error SlotNotVerified();
    error OnlyAdmin();
    error TokenTransferFailed();


    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }


    constructor(
        address _solanaLightClient,
        address _transferVerifier,
        uint256 _baseFee,
        uint256 _feePerByte
    ) {
        solanaLightClient = ISolanaLightClient(_solanaLightClient);
        transferVerifier = IGroth16Verifier(_transferVerifier);
        chainId = block.chainid;
        baseFee = _baseFee;
        feePerByte = _feePerByte;
        admin = msg.sender;
        feeCollector = msg.sender;
    }

    // TRANSFER INITIATION (EVM → Solana)

    /**
     * @notice Initiate a cross-chain transfer to Solana
     */
    function initiateTransfer(
        address token,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId,
        bytes calldata payload
    ) external payable override returns (bytes32 transferId) {
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();

        // Calculate and verify fee
        uint256 requiredFee = getTransferFee(destChainId, payload.length);
        if (msg.value < requiredFee) revert InsufficientFee();

        // Generate transfer ID
        transferNonce++;
        transferId = keccak256(
            abi.encodePacked(chainId, destChainId, token, msg.sender, recipient, amount, transferNonce)
        );

        // Handle tokens based on whether this is home chain
        CrossChainToken tokenContract = CrossChainToken(token);
        if (isTokenHome[token]) {
            // Lock tokens in bridge
            bool success = tokenContract.transferFrom(msg.sender, address(this), amount);
            if (!success) revert TokenTransferFailed();
        } else {
            // Burn wrapped tokens
            tokenContract.bridgeBurn(msg.sender, amount);
        }

        // Create transfer record
        TransferRequest memory request = TransferRequest({
            transferId: transferId,
            sourceChainId: chainId,
            destChainId: destChainId,
            token: token,
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            nonce: transferNonce,
            timestamp: block.timestamp,
            payload: payload
        });

        transfers[transferId] = TransferRecord({
            request: request,
            status: TransferStatus.PENDING,
            completedSlot: 0,
            completedTxHash: bytes32(0)
        });

        pendingOutbound.push(transferId);

        emit TransferInitiated(transferId, token, msg.sender, recipient, amount, destChainId);

        // Refund excess fee
        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }
    }

    // TRANSFER COMPLETION (Solana → EVM)

    /**
     * @notice Complete a transfer from Solana
     * @dev Verifies ZK proof of transfer on Solana via light client
     */
    function completeTransfer(
        bytes32 transferId,
        address token,
        bytes32 sender,
        address recipient,
        uint256 amount,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external override {
        if (completedTransfers[transferId]) revert TransferAlreadyCompleted();
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();

        // Verify slot is verified in light client
        if (!solanaLightClient.isSlotVerified(slot)) revert SlotNotVerified();

        // Verify the ZK proof of transfer
        // Public inputs encode the transfer details
        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];

        if (!transferVerifier.verifyProof(a, b, c, publicInputs)) {
            revert InvalidProof();
        }

        // Validate public inputs match transfer
        require(bytes32(publicInputs[0]) == transferId, "Transfer ID mismatch");
        require(publicInputs[1] == slot, "Slot mismatch");
        require(bytes32(publicInputs[2]) == tokenToSolanaMint[token], "Token mismatch");
        require(bytes32(publicInputs[3]) == sender, "Sender mismatch");
        require(address(uint160(publicInputs[4])) == recipient, "Recipient mismatch");
        require(publicInputs[5] == amount, "Amount mismatch");

        // Verify against light client state
        bytes32 bankHash = solanaLightClient.getBankHash(slot);
        require(bytes32(publicInputs[6]) == bankHash, "Bank hash mismatch");

        // Mark completed
        completedTransfers[transferId] = true;

        // Handle tokens
        CrossChainToken tokenContract = CrossChainToken(token);
        if (isTokenHome[token]) {
            // Unlock tokens from bridge
            bool success = tokenContract.transfer(recipient, amount);
            if (!success) revert TokenTransferFailed();
        } else {
            // Mint wrapped tokens
            tokenContract.bridgeMint(recipient, amount);
        }

        emit TransferCompleted(transferId, token, sender, recipient, amount);
    }

    // TOKEN REGISTRATION

    /**
     * @notice Register a token for cross-chain transfers
     */
    function registerToken(
        address token,
        bytes32 solanaMint,
        bool _isHomeChain
    ) external override onlyAdmin {
        tokenToSolanaMint[token] = solanaMint;
        solanaMintToToken[solanaMint] = token;
        isTokenHome[token] = _isHomeChain;

        emit TokenRegistered(token, solanaMint, _isHomeChain);
    }


    function getTransferStatus(
        bytes32 transferId
    ) external view override returns (TransferStatus) {
        return transfers[transferId].status;
    }

    function getTransferFee(
        uint256 destChainId,
        uint256 payloadLength
    ) public view override returns (uint256) {
        // Base fee + per-byte fee for payload
        uint256 fee = baseFee + (feePerByte * payloadLength);

        // Add premium for cross-ecosystem transfers (EVM <-> Solana)
        if (destChainId == SOLANA_CHAIN_ID || chainId == SOLANA_CHAIN_ID) {
            fee = fee * 2; // 2x for ZK proof costs
        }

        return fee;
    }

    function isTokenRegistered(address token) external view override returns (bool) {
        return tokenToSolanaMint[token] != bytes32(0);
    }

    function getPendingOutboundCount() external view returns (uint256) {
        return pendingOutbound.length;
    }


    function setFees(uint256 _baseFee, uint256 _feePerByte) external onlyAdmin {
        baseFee = _baseFee;
        feePerByte = _feePerByte;
        emit FeeUpdated(_baseFee, _feePerByte);
    }

    function setFeeCollector(address _feeCollector) external onlyAdmin {
        feeCollector = _feeCollector;
    }

    function collectFees() external {
        uint256 balance = address(this).balance;
        payable(feeCollector).transfer(balance);
        emit FeesCollected(feeCollector, balance);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        admin = newAdmin;
    }

    // RECEIVE

    receive() external payable {}
}
