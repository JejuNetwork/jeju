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
 * @dev Security features:
 *      - forceInclude() is NEVER pausable - users can always force-include transactions
 *      - Only Security Council can pause (for emergencies)
 *      - Unpause requires timelock (7 days)
 *      - Registry changes require timelock (2 days)
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

    struct PendingRegistryChange {
        address newRegistry;
        uint256 executeAfter;
    }

    uint256 public constant INCLUSION_WINDOW_BLOCKS = 50;
    uint256 public constant MIN_FEE = 0.001 ether;
    uint256 public constant EXPIRY_WINDOW = 1 days;
    uint256 public constant UNPAUSE_DELAY = 7 days;
    uint256 public constant REGISTRY_CHANGE_DELAY = 2 days;

    address public immutable batchInbox;
    address public sequencerRegistry;
    address public securityCouncil;
    
    mapping(bytes32 => QueuedTx) public queuedTxs;
    bytes32[] public pendingTxIds;
    uint256 public totalPendingFees;
    
    uint256 public pendingUnpauseTime;
    PendingRegistryChange public pendingRegistryChange;

    event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock);
    event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot);
    event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward);
    event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund);
    event SequencerRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event EmergencyPause(address indexed by);
    event UnpauseProposed(uint256 executeAfter);
    event UnpauseExecuted();
    event RegistryChangeProposed(address indexed newRegistry, uint256 executeAfter);
    event SecurityCouncilUpdated(address indexed oldCouncil, address indexed newCouncil);

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
    error NotSecurityCouncil();
    error NoPendingUnpause();
    error NoPendingChange();
    error TimelockNotExpired();

    modifier onlySecurityCouncil() {
        if (msg.sender != securityCouncil) revert NotSecurityCouncil();
        _;
    }

    error BatchInboxNotContract();
    
    /// @param _batchInbox Batch inbox contract address
    /// @param _sequencerRegistry Sequencer registry for active sequencer checks
    /// @param _securityCouncil Security council for emergency pause
    /// @param _owner Contract owner
    /// @param _skipContractCheck Set to true only in tests - production must be false
    constructor(
        address _batchInbox, 
        address _sequencerRegistry, 
        address _securityCouncil,
        address _owner,
        bool _skipContractCheck
    ) Ownable(_owner) {
        if (_batchInbox == address(0)) revert ZeroAddress();
        // SECURITY: Validate batchInbox is a contract, not an EOA (skip in tests)
        if (!_skipContractCheck) {
            uint256 codeSize;
            assembly { codeSize := extcodesize(_batchInbox) }
            if (codeSize == 0) revert BatchInboxNotContract();
        }
        
        batchInbox = _batchInbox;
        sequencerRegistry = _sequencerRegistry;
        securityCouncil = _securityCouncil;
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

    /// @notice Force include a transaction after the inclusion window has expired
    /// @dev CRITICAL: This function is NOT affected by pause - users can ALWAYS force-include transactions
    /// This is intentional to ensure the anti-censorship mechanism cannot be disabled
    /// CEI pattern: state updates happen before external calls
    function forceInclude(bytes32 txId) external nonReentrant {
        QueuedTx storage qtx = queuedTxs[txId];
        if (qtx.sender == address(0)) revert TxNotFound();
        if (qtx.included || qtx.expired) revert TxAlreadyIncluded();
        if (block.number <= qtx.queuedAtBlock + INCLUSION_WINDOW_BLOCKS) revert WindowNotExpired();

        // CEI: Cache values before state changes
        uint256 fee = qtx.fee;
        address txSender = qtx.sender;
        uint256 gasLimit = qtx.gasLimit;
        bytes memory data = qtx.data;
        
        // CEI: Update state BEFORE external calls
        qtx.included = true;
        totalPendingFees -= fee;

        // External call to batch inbox
        (bool ok,) = batchInbox.call(abi.encodePacked(bytes1(0x7e), txSender, gasLimit, data));
        if (!ok) {
            // Revert state changes on failure
            qtx.included = false;
            totalPendingFees += fee;
            revert ForceFailed();
        }

        // Transfer reward to forcer
        _transfer(msg.sender, fee);
        emit TxForced(txId, msg.sender, fee);
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

    // ============ Security Council Functions ============

    /// @notice Emergency pause - only Security Council can pause
    /// @dev This pauses queueTx but NOT forceInclude (anti-censorship must always work)
    function pause() external onlySecurityCouncil { 
        _pause(); 
        emit EmergencyPause(msg.sender);
    }

    // ============ Owner Functions with Timelock ============

    /// @notice Propose unpause - requires 7 day timelock
    function proposeUnpause() external onlyOwner {
        pendingUnpauseTime = block.timestamp + UNPAUSE_DELAY;
        emit UnpauseProposed(pendingUnpauseTime);
    }

    /// @notice Execute unpause after timelock expires
    function executeUnpause() external {
        if (pendingUnpauseTime == 0) revert NoPendingUnpause();
        if (block.timestamp < pendingUnpauseTime) revert TimelockNotExpired();
        pendingUnpauseTime = 0;
        _unpause();
        emit UnpauseExecuted();
    }

    /// @notice Propose a new sequencer registry - requires 2 day timelock
    function proposeSequencerRegistry(address _registry) external onlyOwner {
        pendingRegistryChange = PendingRegistryChange({
            newRegistry: _registry,
            executeAfter: block.timestamp + REGISTRY_CHANGE_DELAY
        });
        emit RegistryChangeProposed(_registry, block.timestamp + REGISTRY_CHANGE_DELAY);
    }

    /// @notice Execute sequencer registry change after timelock expires
    function executeSequencerRegistry() external {
        if (pendingRegistryChange.executeAfter == 0) revert NoPendingChange();
        if (block.timestamp < pendingRegistryChange.executeAfter) revert TimelockNotExpired();
        
        emit SequencerRegistryUpdated(sequencerRegistry, pendingRegistryChange.newRegistry);
        sequencerRegistry = pendingRegistryChange.newRegistry;
        delete pendingRegistryChange;
    }

    /// @notice Update security council - only callable by owner (governance timelock)
    function setSecurityCouncil(address _newCouncil) external onlyOwner {
        emit SecurityCouncilUpdated(securityCouncil, _newCouncil);
        securityCouncil = _newCouncil;
    }

    receive() external payable {}
}
