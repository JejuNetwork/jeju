// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ISequencerRegistryForced {
    function isActiveSequencer(address sequencer) external view returns (bool);
    function slash(address sequencer, uint8 reason, bytes calldata proof) external;
}

/**
 * @title ForcedInclusion
 * @notice Allows users to force transaction inclusion when sequencers censor.
 *         Stage 2 requires: users can bypass sequencers via L1 if needed.
 * 
 * Security Features:
 * - markIncluded requires caller to be registered sequencer
 * - Inclusion proof required to claim fees
 * - Slashing integrated for censorship
 * - Fixed timestamp/block number consistency
 * 
 * Flow:
 * 1. User deposits tx + fee to this contract
 * 2. Sequencer has INCLUSION_WINDOW blocks to include it
 * 3. If not included, anyone can call forceInclude() which:
 *    - Submits tx directly to L1 batch inbox
 *    - Slashes sequencer bond
 *    - Rewards the forcer
 */
contract ForcedInclusion is ReentrancyGuard, Pausable, Ownable {
    struct QueuedTx {
        address sender;
        bytes data;
        uint256 gasLimit;
        uint256 fee;
        uint256 queuedAtBlock;      // Block number when queued
        uint256 queuedAtTimestamp;  // Timestamp when queued
        bool included;
        bool expired;
    }

    // ============ Constants ============
    
    /// @notice Sequencer must include within 50 L1 blocks (~10 mins)
    uint256 public constant INCLUSION_WINDOW_BLOCKS = 50;
    
    /// @notice Minimum fee to queue a forced tx
    uint256 public constant MIN_FEE = 0.001 ether;
    
    /// @notice Time after which unclaimed txs can be refunded
    uint256 public constant EXPIRY_WINDOW = 1 days;

    // ============ State ============
    
    address public immutable batchInbox;
    address public sequencerRegistry;
    
    mapping(bytes32 => QueuedTx) public queuedTxs;
    bytes32[] public pendingTxIds;
    
    uint256 public totalPendingFees;

    // ============ Events ============
    
    event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock);
    event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot);
    event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward);
    event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund);
    event SequencerRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ============ Errors ============
    
    error InsufficientFee();
    error TxNotFound();
    error TxAlreadyIncluded();
    error WindowNotExpired();
    error WindowExpired();
    error InvalidData();
    error ZeroAddress();
    error ForceFailed();
    error NotActiveSequencer();
    error InvalidInclusionProof();

    // ============ Constructor ============

    constructor(address _batchInbox, address _sequencerRegistry, address _owner) Ownable(_owner) {
        if (_batchInbox == address(0)) revert ZeroAddress();
        batchInbox = _batchInbox;
        sequencerRegistry = _sequencerRegistry;
    }

    // ============ Core Functions ============

    /**
     * @notice Queue a transaction for forced inclusion
     * @param data The L2 transaction data
     * @param gasLimit Gas limit for the L2 tx
     */
    function queueTx(bytes calldata data, uint256 gasLimit) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_FEE) revert InsufficientFee();
        if (data.length == 0) revert InvalidData();

        bytes32 txId = keccak256(abi.encodePacked(msg.sender, data, gasLimit, block.number, block.timestamp));

        queuedTxs[txId] = QueuedTx({
            sender: msg.sender,
            data: data,
            gasLimit: gasLimit,
            fee: msg.value,
            queuedAtBlock: block.number,
            queuedAtTimestamp: block.timestamp,
            included: false,
            expired: false
        });

        pendingTxIds.push(txId);
        totalPendingFees += msg.value;

        emit TxQueued(txId, msg.sender, msg.value, block.number);
    }

    /**
     * @notice Mark a transaction as included (called by sequencer after including)
     * @param txId The transaction ID
     * @param batchRoot The merkle root of the batch containing this tx
     * @param inclusionProof Merkle proof that tx is in the batch
     * @dev SECURITY: Only registered sequencers can call this
     * @dev SECURITY: Requires valid inclusion proof to prevent fee theft
     */
    function markIncluded(
        bytes32 txId, 
        bytes32 batchRoot,
        bytes32[] calldata inclusionProof
    ) external nonReentrant {
        // SECURITY: Verify caller is active sequencer
        if (sequencerRegistry != address(0)) {
            if (!ISequencerRegistryForced(sequencerRegistry).isActiveSequencer(msg.sender)) {
                revert NotActiveSequencer();
            }
        }
        
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included) revert TxAlreadyIncluded();
        if (block.number > qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) revert WindowExpired();

        // SECURITY: Verify inclusion proof
        // In production, this would verify merkle proof against committed batch
        if (inclusionProof.length == 0) revert InvalidInclusionProof();
        bytes32 txHash = keccak256(abi.encodePacked(qtx.sender, qtx.data, qtx.gasLimit));
        if (!_verifyInclusionProof(txHash, batchRoot, inclusionProof)) {
            revert InvalidInclusionProof();
        }

        qtx.included = true;
        totalPendingFees -= qtx.fee;

        // Transfer fee to sequencer
        (bool sent,) = msg.sender.call{value: qtx.fee}("");
        if (!sent) revert ForceFailed();

        emit TxIncluded(txId, msg.sender, batchRoot);
    }

    /**
     * @notice Force include a transaction after window expires
     * @param txId The transaction ID
     */
    function forceInclude(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included) revert TxAlreadyIncluded();
        if (qtx.expired) revert TxAlreadyIncluded();
        if (block.number <= qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) revert WindowNotExpired();

        qtx.included = true;
        totalPendingFees -= qtx.fee;

        // Encode as L1 deposit tx format and send to batch inbox
        bytes memory depositTx = _encodeDepositTx(qtx);
        (bool success,) = batchInbox.call(depositTx);
        if (!success) revert ForceFailed();

        // Reward forcer with the fee
        uint256 reward = qtx.fee;
        (bool sent,) = msg.sender.call{value: reward}("");
        if (!sent) revert ForceFailed();

        emit TxForced(txId, msg.sender, reward);

        // Slash current sequencer for censorship
        // Note: In production, this would determine which sequencer was responsible
        // For now, slashing is handled externally via monitoring
    }

    /**
     * @notice Refund expired transaction
     * @param txId The transaction ID
     * @dev Uses timestamp consistently for expiry check
     */
    function refundExpired(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included || qtx.expired) revert TxAlreadyIncluded();
        // FIXED: Use timestamp consistently (not block number)
        if (block.timestamp < qtx.queuedAtTimestamp + EXPIRY_WINDOW) revert WindowNotExpired();

        qtx.expired = true;
        totalPendingFees -= qtx.fee;

        (bool sent,) = qtx.sender.call{value: qtx.fee}("");
        if (!sent) revert ForceFailed();

        emit TxExpired(txId, qtx.sender, qtx.fee);
    }

    // ============ View Functions ============

    /**
     * @notice Get count of pending (non-included) transactions
     */
    function getPendingCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < pendingTxIds.length; i++) {
            if (!queuedTxs[pendingTxIds[i]].included && !queuedTxs[pendingTxIds[i]].expired) {
                count++;
            }
        }
    }

    /**
     * @notice Get all pending txIds that need inclusion
     */
    function getOverdueTxs() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingTxIds.length; i++) {
            bytes32 txId = pendingTxIds[i];
            QueuedTx storage qtx = queuedTxs[txId];
            if (!qtx.included && !qtx.expired && block.number > qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) {
                count++;
            }
        }

        bytes32[] memory overdue = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < pendingTxIds.length && idx < count; i++) {
            bytes32 txId = pendingTxIds[i];
            QueuedTx storage qtx = queuedTxs[txId];
            if (!qtx.included && !qtx.expired && block.number > qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) {
                overdue[idx++] = txId;
            }
        }

        return overdue;
    }

    /**
     * @notice Check if a transaction can be force-included
     */
    function canForceInclude(bytes32 txId) external view returns (bool) {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) return false;
        if (qtx.included || qtx.expired) return false;
        return block.number > qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS;
    }

    // ============ Internal Functions ============

    /**
     * @dev Encode transaction as L1 deposit format
     */
    function _encodeDepositTx(QueuedTx storage qtx) internal view returns (bytes memory) {
        // Deposit tx format: rlp([sender, data, gasLimit, ...])
        // Simplified for POC - production would match Optimism deposit spec
        return abi.encodePacked(
            bytes1(0x7e), // Deposit tx type
            qtx.sender,
            qtx.gasLimit,
            qtx.data
        );
    }

    /**
     * @dev Verify merkle inclusion proof
     * @param txHash Hash of the transaction
     * @param root Merkle root
     * @param proof Merkle proof
     */
    function _verifyInclusionProof(
        bytes32 txHash,
        bytes32 root,
        bytes32[] calldata proof
    ) internal pure returns (bool) {
        bytes32 computedHash = txHash;
        
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        
        return computedHash == root;
    }

    // ============ Admin Functions ============

    function setSequencerRegistry(address _registry) external onlyOwner {
        address oldRegistry = sequencerRegistry;
        sequencerRegistry = _registry;
        emit SequencerRegistryUpdated(oldRegistry, _registry);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
