// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ForcedInclusion
 * @notice Allows users to force transaction inclusion when sequencers censor.
 *         Stage 2 requires: users can bypass sequencers via L1 if needed.
 * 
 * Flow:
 * 1. User deposits tx + fee to this contract
 * 2. Sequencer has INCLUSION_WINDOW blocks to include it
 * 3. If not included, anyone can call forceInclude() which:
 *    - Submits tx directly to L1 batch inbox
 *    - Slashes sequencer bond
 *    - Rewards the forcer
 */
contract ForcedInclusion is ReentrancyGuard, Pausable {
    struct QueuedTx {
        address sender;
        bytes data;
        uint256 gasLimit;
        uint256 fee;
        uint256 queuedAt;
        bool included;
        bool expired;
    }

    // Sequencer must include within 50 L1 blocks (~10 mins)
    uint256 public constant INCLUSION_WINDOW = 50;
    
    // Minimum fee to queue a forced tx
    uint256 public constant MIN_FEE = 0.001 ether;
    
    // Time after which unclaimed txs can be refunded
    uint256 public constant EXPIRY_WINDOW = 1 days;

    address public immutable batchInbox;
    address public sequencerRegistry;
    
    mapping(bytes32 => QueuedTx) public queuedTxs;
    bytes32[] public pendingTxIds;
    
    uint256 public totalPendingFees;

    event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAt);
    event TxIncluded(bytes32 indexed txId, address indexed sequencer);
    event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward);
    event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund);

    error InsufficientFee();
    error TxNotFound();
    error TxAlreadyIncluded();
    error WindowNotExpired();
    error WindowExpired();
    error InvalidData();
    error ZeroAddress();
    error ForceFailed();

    constructor(address _batchInbox, address _sequencerRegistry) {
        if (_batchInbox == address(0)) revert ZeroAddress();
        batchInbox = _batchInbox;
        sequencerRegistry = _sequencerRegistry;
    }

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
            queuedAt: block.number,
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
     */
    function markIncluded(bytes32 txId) external {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included) revert TxAlreadyIncluded();
        if (block.number > qtx.queuedAt + INCLUSION_WINDOW) revert WindowExpired();

        qtx.included = true;
        totalPendingFees -= qtx.fee;

        // Transfer fee to sequencer
        (bool sent,) = msg.sender.call{value: qtx.fee}("");
        if (!sent) revert ForceFailed();

        emit TxIncluded(txId, msg.sender);
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
        if (block.number <= qtx.queuedAt + INCLUSION_WINDOW) revert WindowNotExpired();

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

        // TODO: Slash sequencer via SequencerRegistry
        // ISequencerRegistry(sequencerRegistry).slashForCensorship(currentSequencer);
    }

    /**
     * @notice Refund expired transaction
     * @param txId The transaction ID
     */
    function refundExpired(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included || qtx.expired) revert TxAlreadyIncluded();
        if (block.timestamp < qtx.queuedAt + EXPIRY_WINDOW) revert WindowNotExpired();

        qtx.expired = true;
        totalPendingFees -= qtx.fee;

        (bool sent,) = qtx.sender.call{value: qtx.fee}("");
        if (!sent) revert ForceFailed();

        emit TxExpired(txId, qtx.sender, qtx.fee);
    }

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
            if (!qtx.included && !qtx.expired && block.number > qtx.queuedAt + INCLUSION_WINDOW) {
                count++;
            }
        }

        bytes32[] memory overdue = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < pendingTxIds.length && idx < count; i++) {
            bytes32 txId = pendingTxIds[i];
            QueuedTx storage qtx = queuedTxs[txId];
            if (!qtx.included && !qtx.expired && block.number > qtx.queuedAt + INCLUSION_WINDOW) {
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
        return block.number > qtx.queuedAt + INCLUSION_WINDOW;
    }

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

    receive() external payable {}
}

