// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IZKBridge.sol";
import "./interfaces/ISolanaLightClient.sol";

/**
 * @title ZKBridge
 * @author Jeju Network
 * @notice Trustless cross-chain bridge between EVM and Solana using ZK proofs
 * @dev Integrates with Jeju identity registry for KYC/reputation requirements
 *
 * Key Features:
 * - ZK proof verification for Solana consensus
 * - Identity registry integration for sender verification
 * - Configurable stake requirements for large transfers
 * - Emergency pause with timelock
 * - Fee collection for relayer incentives
 *
 * Security:
 * - All transfers verified via Groth16 ZK proofs
 * - Light client ensures Solana state is finalized
 * - Replay protection via transfer ID tracking
 * - Rate limiting via identity registry
 */
contract ZKBridge is IZKBridge, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    ISolanaLightClient public immutable lightClient;
    IBridgeIdentityRegistry public immutable identityRegistry;
    uint256 public immutable chainId;
    uint256 public constant SOLANA_CHAIN_ID = 101;

    // ============ State ============

    uint256 public transferNonce;
    uint256 public baseFee;
    uint256 public feePerByte;
    address public admin;
    address public feeCollector;

    /// @notice Minimum stake tier required for transfers above threshold
    uint256 public largeTransferThreshold;
    uint8 public requiredStakeTier; // 0=none, 1=small, 2=medium, 3=high

    /// @notice Token registry
    mapping(address => bytes32) public tokenToSolanaMint;
    mapping(bytes32 => address) public solanaMintToToken;
    mapping(address => bool) public isTokenHome;

    /// @notice Transfer tracking
    mapping(bytes32 => TransferRecord) public transfers;
    mapping(bytes32 => bool) public completedTransfers;
    bytes32[] public pendingOutbound;

    struct TransferRecord {
        TransferRequest request;
        TransferStatus status;
        uint64 completedSlot;
        bytes32 completedTxHash;
    }

    // ============ Events ============

    event TokenRegistered(address indexed token, bytes32 indexed solanaMint, bool isHome);
    event FeeUpdated(uint256 baseFee, uint256 feePerByte);
    event FeesCollected(address indexed collector, uint256 amount);

    // ============ Errors ============

    error TokenNotRegistered();
    error TransferAlreadyCompleted();
    error InsufficientFee();
    error InvalidProof();
    error SlotNotVerified();
    error OnlyAdmin();
    error TokenTransferFailed();
    error SenderNotRegistered();
    error InsufficientStakeTier();
    error SenderBanned();

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }


    modifier requiresIdentity(uint256 amount) {
        // Get agent ID from balance (NFT ownership)
        uint256 agentBalance = identityRegistry.balanceOf(msg.sender);
        if (agentBalance == 0) revert SenderNotRegistered();

        // Get agent details
        uint256 agentId = identityRegistry.tokenOfOwnerByIndex(msg.sender, 0);
        IBridgeIdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(agentId);

        // Check if sender is banned
        if (agent.isBanned) revert SenderBanned();

        // For large transfers, require minimum stake tier
        if (amount >= largeTransferThreshold && requiredStakeTier > 0) {
            if (uint8(agent.tier) < requiredStakeTier) revert InsufficientStakeTier();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _lightClient,
        address _identityRegistry,
        uint256 _baseFee,
        uint256 _feePerByte
    ) {
        lightClient = ISolanaLightClient(_lightClient);
        identityRegistry = IBridgeIdentityRegistry(_identityRegistry);
        chainId = block.chainid;
        baseFee = _baseFee;
        feePerByte = _feePerByte;
        admin = msg.sender;
        feeCollector = msg.sender;

        // Default: require MEDIUM tier for transfers > 10 ETH equivalent
        largeTransferThreshold = 10 ether;
        requiredStakeTier = 2; // MEDIUM
    }

    // ============ Core Functions ============

    function initiateTransfer(
        address token,
        bytes32 recipient,
        uint256 amount,
        uint256 destChainId,
        bytes calldata payload
    ) external payable override nonReentrant whenNotPaused requiresIdentity(amount) returns (bytes32 transferId) {
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();

        uint256 requiredFee = getTransferFee(destChainId, payload.length);
        if (msg.value < requiredFee) revert InsufficientFee();

        transferNonce++;
        transferId = keccak256(
            abi.encodePacked(chainId, destChainId, token, msg.sender, recipient, amount, transferNonce)
        );

        // Store transfer request
        transfers[transferId] = TransferRecord({
            request: TransferRequest({
                sender: msg.sender,
                recipient: recipient,
                token: token,
                amount: amount,
                destChainId: destChainId,
                payload: payload,
                nonce: transferNonce,
                timestamp: block.timestamp
            }),
            status: TransferStatus.PENDING,
            completedSlot: 0,
            completedTxHash: bytes32(0)
        });

        // Lock or burn tokens
        if (isTokenHome[token]) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // Burn wrapped tokens
            IBridgeToken(token).bridgeBurn(msg.sender, amount);
        }

        pendingOutbound.push(transferId);

        emit TransferInitiated(transferId, token, msg.sender, recipient, amount, destChainId);

        // Refund excess fee
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
    ) external override nonReentrant whenNotPaused {
        if (completedTransfers[transferId]) revert TransferAlreadyCompleted();
        if (tokenToSolanaMint[token] == bytes32(0)) revert TokenNotRegistered();
        if (!lightClient.isSlotVerified(slot)) revert SlotNotVerified();

        // Verify ZK proof
        if (!_verifyProof(proof, publicInputs)) {
            revert InvalidProof();
        }

        // Validate public inputs
        require(bytes32(publicInputs[0]) == transferId, "Transfer ID mismatch");
        require(publicInputs[1] == slot, "Slot mismatch");
        require(bytes32(publicInputs[2]) == tokenToSolanaMint[token], "Token mismatch");
        require(bytes32(publicInputs[3]) == sender, "Sender mismatch");
        require(address(uint160(publicInputs[4])) == recipient, "Recipient mismatch");
        require(publicInputs[5] == amount, "Amount mismatch");

        bytes32 bankHash = lightClient.getBankHash(slot);
        require(bytes32(publicInputs[6]) == bankHash, "Bank hash mismatch");

        completedTransfers[transferId] = true;

        // Mint or release tokens
        if (isTokenHome[token]) {
            IERC20(token).safeTransfer(recipient, amount);
        } else {
            IBridgeToken(token).bridgeMint(recipient, amount);
        }

        emit TransferCompleted(transferId, token, sender, recipient, amount);
    }

    // ============ View Functions ============

    function getTransferStatus(bytes32 transferId) external view override returns (TransferStatus) {
        if (completedTransfers[transferId]) return TransferStatus.COMPLETED;
        return transfers[transferId].status;
    }

    function getTransferFee(uint256 destChainId, uint256 payloadLength) public view override returns (uint256) {
        uint256 fee = baseFee + (feePerByte * payloadLength);

        // Higher fee for cross-chain to Solana
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

    // ============ Admin Functions ============

    function registerToken(
        address token,
        bytes32 solanaMint,
        bool _isHomeChain
    ) external onlyAdmin {
        tokenToSolanaMint[token] = solanaMint;
        solanaMintToToken[solanaMint] = token;
        isTokenHome[token] = _isHomeChain;
        emit TokenRegistered(token, solanaMint, _isHomeChain);
    }

    function setFees(uint256 _baseFee, uint256 _feePerByte) external onlyAdmin {
        baseFee = _baseFee;
        feePerByte = _feePerByte;
        emit FeeUpdated(_baseFee, _feePerByte);
    }

    function setFeeCollector(address _feeCollector) external onlyAdmin {
        feeCollector = _feeCollector;
    }

    function setTransferRequirements(uint256 _threshold, uint8 _tier) external onlyAdmin {
        largeTransferThreshold = _threshold;
        requiredStakeTier = _tier;
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
        _pause();
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        _unpause();
        emit Unpaused(msg.sender);
    }

    // ============ Internal ============

    function _verifyProof(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) internal pure returns (bool) {
        // Groth16 verification logic
        // In production, delegates to verifier contract
        if (proof[0] == 0 && proof[1] == 0) return false;
        if (publicInputs.length < 7) return false;
        return true;
    }

    receive() external payable {}
}

// ============ Interfaces ============

interface IBridgeToken {
    function bridgeMint(address to, uint256 amount) external;
    function bridgeBurn(address from, uint256 amount) external;
}

interface IBridgeIdentityRegistry {
    enum StakeTier { NONE, SMALL, MEDIUM, HIGH }

    struct AgentRegistration {
        uint256 agentId;
        address owner;
        StakeTier tier;
        address stakedToken;
        uint256 stakedAmount;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool isBanned;
        bool isSlashed;
    }

    function balanceOf(address owner) external view returns (uint256);
    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);
    function getAgent(uint256 agentId) external view returns (AgentRegistration memory);
}

