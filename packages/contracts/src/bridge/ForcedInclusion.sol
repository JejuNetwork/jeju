// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ISequencerRegistryForced {
    function isActiveSequencer(address sequencer) external view returns (bool);
}

/**
 * @title ForcedInclusion
 * @notice Anti-censorship: queue L2 txs that sequencers must include within 50 blocks or get slashed.
 */
contract ForcedInclusion is ReentrancyGuard, Pausable, Ownable {
    struct QueuedTx {
        address sender;
        bytes data;
        uint256 gasLimit;
        uint256 fee;
        uint256 queuedAtBlock;
        uint256 queuedAtTimestamp;
        bool included;
        bool expired;
    }

    uint256 public constant INCLUSION_WINDOW_BLOCKS = 50;
    uint256 public constant MIN_FEE = 0.001 ether;
    uint256 public constant EXPIRY_WINDOW = 1 days;

    address public immutable batchInbox;
    address public sequencerRegistry;
    mapping(bytes32 => QueuedTx) public queuedTxs;
    bytes32[] public pendingTxIds;
    uint256 public totalPendingFees;

    event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock);
    event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot);
    event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward);
    event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund);
    event SequencerRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

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

    constructor(address _batchInbox, address _sequencerRegistry, address _owner) Ownable(_owner) {
        if (_batchInbox == address(0)) revert ZeroAddress();
        batchInbox = _batchInbox;
        sequencerRegistry = _sequencerRegistry;
    }

    function queueTx(bytes calldata data, uint256 gasLimit) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_FEE) revert InsufficientFee();
        if (data.length == 0) revert InvalidData();

        bytes32 txId = keccak256(abi.encodePacked(msg.sender, data, gasLimit, block.number, block.timestamp));
        queuedTxs[txId] = QueuedTx(msg.sender, data, gasLimit, msg.value, block.number, block.timestamp, false, false);
        pendingTxIds.push(txId);
        totalPendingFees += msg.value;
        emit TxQueued(txId, msg.sender, msg.value, block.number);
    }

    function markIncluded(bytes32 txId, bytes32 batchRoot, bytes32[] calldata proof) external nonReentrant {
        if (sequencerRegistry != address(0) && !ISequencerRegistryForced(sequencerRegistry).isActiveSequencer(msg.sender)) {
            revert NotActiveSequencer();
        }

        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included) revert TxAlreadyIncluded();
        if (block.number > qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) revert WindowExpired();
        if (proof.length == 0 || !_verifyProof(keccak256(abi.encodePacked(qtx.sender, qtx.data, qtx.gasLimit)), batchRoot, proof)) {
            revert InvalidInclusionProof();
        }

        qtx.included = true;
        totalPendingFees -= qtx.fee;
        _transfer(msg.sender, qtx.fee);
        emit TxIncluded(txId, msg.sender, batchRoot);
    }

    function forceInclude(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included || qtx.expired) revert TxAlreadyIncluded();
        if (block.number <= qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) revert WindowNotExpired();

        qtx.included = true;
        totalPendingFees -= qtx.fee;

        (bool ok,) = batchInbox.call(abi.encodePacked(bytes1(0x7e), qtx.sender, qtx.gasLimit, qtx.data));
        if (!ok) revert ForceFailed();

        _transfer(msg.sender, qtx.fee);
        emit TxForced(txId, msg.sender, qtx.fee);
    }

    function refundExpired(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included || qtx.expired) revert TxAlreadyIncluded();
        if (block.timestamp < qtx.queuedAtTimestamp + EXPIRY_WINDOW) revert WindowNotExpired();

        qtx.expired = true;
        totalPendingFees -= qtx.fee;
        _transfer(qtx.sender, qtx.fee);
        emit TxExpired(txId, qtx.sender, qtx.fee);
    }

    function _transfer(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert ForceFailed();
    }

    function _verifyProof(bytes32 leaf, bytes32 root, bytes32[] calldata proof) internal pure returns (bool) {
        bytes32 hash = leaf;
        for (uint256 i; i < proof.length; ++i) {
            hash = hash <= proof[i]
                ? keccak256(abi.encodePacked(hash, proof[i]))
                : keccak256(abi.encodePacked(proof[i], hash));
        }
        return hash == root;
    }

    function canForceInclude(bytes32 txId) external view returns (bool) {
        QueuedTx storage q = queuedTxs[txId];
        return q.sender != address(0) && !q.included && !q.expired && block.number > q.queuedAtBlock + INCLUSION_WINDOW_BLOCKS;
    }

    function getPendingCount() external view returns (uint256 count) {
        for (uint256 i; i < pendingTxIds.length; ++i) {
            QueuedTx storage q = queuedTxs[pendingTxIds[i]];
            if (!q.included && !q.expired) count++;
        }
    }

    function getOverdueTxs() external view returns (bytes32[] memory) {
        uint256 count;
        for (uint256 i; i < pendingTxIds.length; ++i) {
            QueuedTx storage q = queuedTxs[pendingTxIds[i]];
            if (!q.included && !q.expired && block.number > q.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) count++;
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx;
        for (uint256 i; i < pendingTxIds.length && idx < count; ++i) {
            QueuedTx storage q = queuedTxs[pendingTxIds[i]];
            if (!q.included && !q.expired && block.number > q.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) result[idx++] = pendingTxIds[i];
        }
        return result;
    }

    function setSequencerRegistry(address _registry) external onlyOwner {
        emit SequencerRegistryUpdated(sequencerRegistry, _registry);
        sequencerRegistry = _registry;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
