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
 */
contract CrossChainBridge is ICrossChainBridge {
    using SolanaTypes for SolanaTypes.Slot;
    using SolanaTypes for SolanaTypes.Pubkey;

    ISolanaLightClient public immutable solanaLightClient;
    IGroth16Verifier public immutable transferVerifier;
    uint256 public immutable chainId;
    uint256 public constant SOLANA_CHAIN_ID = 101;

    uint256 public transferNonce;
    uint256 public baseFee;
    uint256 public feePerByte;
    address public admin;
    address public feeCollector;
    bool public paused;

    mapping(address => bytes32) public tokenToSolanaMint;
    mapping(bytes32 => address) public solanaMintToToken;
    mapping(address => bool) public isTokenHome;
    mapping(bytes32 => TransferRecord) public transfers;
    mapping(bytes32 => bool) public completedTransfers;
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
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error TokenNotRegistered();
    error TransferAlreadyCompleted();
    error InsufficientFee();
    error InvalidProof();
    error SlotNotVerified();
    error OnlyAdmin();
    error TokenTransferFailed();
    error ContractPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
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

    function initiateTransfer(
        address token,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId,
        bytes calldata payload
    ) external payable override whenNotPaused returns (bytes32 transferId) {
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();

        uint256 requiredFee = getTransferFee(destChainId, payload.length);
        if (msg.value < requiredFee) revert InsufficientFee();

        transferNonce++;
        transferId = keccak256(
            abi.encodePacked(chainId, destChainId, token, msg.sender, recipient, amount, transferNonce)
        );

        CrossChainToken tokenContract = CrossChainToken(token);
        if (isTokenHome[token]) {
            bool success = tokenContract.transferFrom(msg.sender, address(this), amount);
            if (!success) revert TokenTransferFailed();
        } else {
            tokenContract.bridgeBurn(msg.sender, amount);
        }

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

        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }
    }

    function completeTransfer(
        bytes32 transferId,
        address token,
        bytes32 sender,
        address recipient,
        uint256 amount,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external override whenNotPaused {
        if (completedTransfers[transferId]) revert TransferAlreadyCompleted();
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();

        if (!solanaLightClient.isSlotVerified(slot)) revert SlotNotVerified();

        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];

        if (!transferVerifier.verifyProof(a, b, c, publicInputs)) {
            revert InvalidProof();
        }

        require(bytes32(publicInputs[0]) == transferId, "Transfer ID mismatch");
        require(publicInputs[1] == slot, "Slot mismatch");
        require(bytes32(publicInputs[2]) == tokenToSolanaMint[token], "Token mismatch");
        require(bytes32(publicInputs[3]) == sender, "Sender mismatch");
        require(address(uint160(publicInputs[4])) == recipient, "Recipient mismatch");
        require(publicInputs[5] == amount, "Amount mismatch");

        bytes32 bankHash = solanaLightClient.getBankHash(slot);
        require(bytes32(publicInputs[6]) == bankHash, "Bank hash mismatch");

        completedTransfers[transferId] = true;

        CrossChainToken tokenContract = CrossChainToken(token);
        if (isTokenHome[token]) {
            bool success = tokenContract.transfer(recipient, amount);
            if (!success) revert TokenTransferFailed();
        } else {
            tokenContract.bridgeMint(recipient, amount);
        }

        emit TransferCompleted(transferId, token, sender, recipient, amount);
    }

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
        uint256 fee = baseFee + (feePerByte * payloadLength);

        if (destChainId == SOLANA_CHAIN_ID || chainId == SOLANA_CHAIN_ID) {
            fee = fee * 2;
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

    function pause() external onlyAdmin {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    receive() external payable {}
}
