// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ThresholdBatchSubmitter
 * @notice Requires N-of-M sequencer signatures to submit batches to L1.
 *         This provides true threshold security - no single sequencer can submit alone.
 * 
 * Security Features:
 * - Minimum threshold of 2 enforced (no single signer)
 * - Maximum 100 sequencers to prevent gas DoS
 * - Admin changes require timelock delay
 * - syncFromRegistry restricted to registry contract
 */
contract ThresholdBatchSubmitter is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============
    
    /// @notice Minimum threshold required (at least 2-of-N)
    uint256 public constant MIN_THRESHOLD = 2;
    
    /// @notice Maximum sequencers to prevent gas DoS on verification
    uint256 public constant MAX_SEQUENCERS = 100;
    
    /// @notice Admin change timelock delay
    uint256 public constant ADMIN_TIMELOCK_DELAY = 2 days;

    // ============ Immutables ============
    
    /// @notice Batch inbox address (where batches are ultimately sent)
    address public immutable batchInbox;
    
    /// @notice Domain separator for EIP-712 style signing
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ State ============
    
    /// @notice Sequencer registry for authorized signers
    address public sequencerRegistry;

    /// @notice Threshold configuration
    uint256 public threshold;
    uint256 public sequencerCount;

    /// @notice Authorized sequencers (address => isAuthorized)
    mapping(address => bool) public isSequencer;
    address[] public sequencers;

    /// @notice Nonce to prevent replay attacks
    uint256 public nonce;
    
    /// @notice Pending admin changes with timelock
    struct PendingChange {
        bytes32 changeType;
        bytes data;
        uint256 executeAfter;
        bool executed;
    }
    mapping(bytes32 => PendingChange) public pendingChanges;

    // ============ Constants for Signing ============
    
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)");

    // ============ Events ============
    
    event BatchSubmitted(bytes32 indexed batchHash, uint256 indexed nonce, address[] signers);
    event SequencerAdded(address indexed sequencer);
    event SequencerRemoved(address indexed sequencer);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event SequencerRegistryUpdated(address oldRegistry, address newRegistry);
    event AdminChangeProposed(bytes32 indexed changeId, bytes32 changeType, uint256 executeAfter);
    event AdminChangeExecuted(bytes32 indexed changeId);
    event AdminChangeCancelled(bytes32 indexed changeId);

    // ============ Errors ============
    
    error InsufficientSignatures(uint256 provided, uint256 required);
    error InvalidSignature(address recovered, uint256 index);
    error DuplicateSigner(address signer);
    error NotAuthorizedSequencer(address signer);
    error InvalidThreshold(uint256 threshold, uint256 sequencerCount);
    error BatchSubmissionFailed();
    error ZeroAddress();
    error ThresholdTooLow();
    error MaxSequencersReached();
    error NotSequencerRegistry();
    error TimelockNotExpired();
    error ChangeNotFound();
    error ChangeAlreadyExecuted();

    // ============ Modifiers ============
    
    modifier onlySequencerRegistry() {
        if (msg.sender != sequencerRegistry) revert NotSequencerRegistry();
        _;
    }

    // ============ Constructor ============

    constructor(address _batchInbox, address _owner, uint256 _threshold) Ownable(_owner) {
        if (_batchInbox == address(0)) revert ZeroAddress();
        if (_threshold < MIN_THRESHOLD) revert ThresholdTooLow();
        
        batchInbox = _batchInbox;
        threshold = _threshold;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ThresholdBatchSubmitter"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ============ Core Functions ============

    function submitBatch(bytes calldata batchData, bytes[] calldata signatures, address[] calldata signers)
        external
        nonReentrant
    {
        uint256 sigCount = signatures.length;
        if (sigCount < threshold) revert InsufficientSignatures(sigCount, threshold);
        if (sigCount != signers.length) revert InsufficientSignatures(signers.length, sigCount);

        bytes32 digest = _hashTypedData(keccak256(batchData), nonce);

        // Use bitmap for O(1) duplicate detection instead of O(n²)
        uint256 signerBitmap;
        
        for (uint256 i = 0; i < sigCount; i++) {
            address recovered = digest.recover(signatures[i]);
            if (recovered != signers[i]) revert InvalidSignature(recovered, i);
            if (!isSequencer[recovered]) revert NotAuthorizedSequencer(recovered);

            // Get sequencer index for bitmap
            uint256 seqIndex = _getSequencerIndex(recovered);
            uint256 bit = 1 << seqIndex;
            if (signerBitmap & bit != 0) revert DuplicateSigner(recovered);
            signerBitmap |= bit;
        }

        uint256 currentNonce = nonce++;
        (bool success,) = batchInbox.call(batchData);
        if (!success) revert BatchSubmissionFailed();

        emit BatchSubmitted(keccak256(batchData), currentNonce, signers);
    }

    function getBatchDigest(bytes calldata batchData) external view returns (bytes32) {
        return _hashTypedData(keccak256(batchData), nonce);
    }

    function getBatchDigestWithNonce(bytes calldata batchData, uint256 _nonce) external view returns (bytes32) {
        return _hashTypedData(keccak256(batchData), _nonce);
    }

    function _hashTypedData(bytes32 batchHash, uint256 _nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(BATCH_TYPEHASH, batchHash, _nonce, block.chainid));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }
    
    function _getSequencerIndex(address seq) internal view returns (uint256) {
        for (uint256 i = 0; i < sequencers.length; i++) {
            if (sequencers[i] == seq) return i;
        }
        revert NotAuthorizedSequencer(seq);
    }

    // ============ Timelocked Admin Functions ============

    /// @notice Propose adding a sequencer (requires timelock)
    function proposeAddSequencer(address sequencer) external onlyOwner returns (bytes32 changeId) {
        if (sequencer == address(0)) revert ZeroAddress();
        if (sequencerCount >= MAX_SEQUENCERS) revert MaxSequencersReached();
        
        changeId = keccak256(abi.encodePacked("ADD_SEQUENCER", sequencer, block.timestamp));
        pendingChanges[changeId] = PendingChange({
            changeType: keccak256("ADD_SEQUENCER"),
            data: abi.encode(sequencer),
            executeAfter: block.timestamp + ADMIN_TIMELOCK_DELAY,
            executed: false
        });
        
        emit AdminChangeProposed(changeId, keccak256("ADD_SEQUENCER"), block.timestamp + ADMIN_TIMELOCK_DELAY);
    }
    
    /// @notice Execute a pending sequencer addition
    function executeAddSequencer(bytes32 changeId) external {
        PendingChange storage change = pendingChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert TimelockNotExpired();
        if (change.changeType != keccak256("ADD_SEQUENCER")) revert ChangeNotFound();
        
        change.executed = true;
        address sequencer = abi.decode(change.data, (address));
        
        if (!isSequencer[sequencer]) {
            isSequencer[sequencer] = true;
            sequencers.push(sequencer);
            sequencerCount++;
            emit SequencerAdded(sequencer);
        }
        
        emit AdminChangeExecuted(changeId);
    }

    /// @notice Propose removing a sequencer (requires timelock)
    function proposeRemoveSequencer(address sequencer) external onlyOwner returns (bytes32 changeId) {
        changeId = keccak256(abi.encodePacked("REMOVE_SEQUENCER", sequencer, block.timestamp));
        pendingChanges[changeId] = PendingChange({
            changeType: keccak256("REMOVE_SEQUENCER"),
            data: abi.encode(sequencer),
            executeAfter: block.timestamp + ADMIN_TIMELOCK_DELAY,
            executed: false
        });
        
        emit AdminChangeProposed(changeId, keccak256("REMOVE_SEQUENCER"), block.timestamp + ADMIN_TIMELOCK_DELAY);
    }
    
    /// @notice Execute a pending sequencer removal
    function executeRemoveSequencer(bytes32 changeId) external {
        PendingChange storage change = pendingChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert TimelockNotExpired();
        if (change.changeType != keccak256("REMOVE_SEQUENCER")) revert ChangeNotFound();
        
        change.executed = true;
        address sequencer = abi.decode(change.data, (address));
        
        _removeSequencerInternal(sequencer);
        
        emit AdminChangeExecuted(changeId);
    }
    
    function _removeSequencerInternal(address sequencer) internal {
        if (!isSequencer[sequencer]) return;

        isSequencer[sequencer] = false;

        // Remove from array
        for (uint256 i = 0; i < sequencers.length; i++) {
            if (sequencers[i] == sequencer) {
                sequencers[i] = sequencers[sequencers.length - 1];
                sequencers.pop();
                break;
            }
        }
        sequencerCount--;

        // Adjust threshold if needed, but never below MIN_THRESHOLD
        if (threshold > sequencerCount && sequencerCount >= MIN_THRESHOLD) {
            uint256 oldThreshold = threshold;
            threshold = sequencerCount;
            emit ThresholdUpdated(oldThreshold, threshold);
        }

        emit SequencerRemoved(sequencer);
    }

    /// @notice Cancel a pending admin change
    function cancelChange(bytes32 changeId) external onlyOwner {
        PendingChange storage change = pendingChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        
        delete pendingChanges[changeId];
        emit AdminChangeCancelled(changeId);
    }

    /// @notice Propose threshold change (requires timelock)
    function proposeSetThreshold(uint256 _threshold) external onlyOwner returns (bytes32 changeId) {
        if (_threshold < MIN_THRESHOLD || _threshold > sequencerCount) {
            revert InvalidThreshold(_threshold, sequencerCount);
        }
        
        changeId = keccak256(abi.encodePacked("SET_THRESHOLD", _threshold, block.timestamp));
        pendingChanges[changeId] = PendingChange({
            changeType: keccak256("SET_THRESHOLD"),
            data: abi.encode(_threshold),
            executeAfter: block.timestamp + ADMIN_TIMELOCK_DELAY,
            executed: false
        });
        
        emit AdminChangeProposed(changeId, keccak256("SET_THRESHOLD"), block.timestamp + ADMIN_TIMELOCK_DELAY);
    }
    
    /// @notice Execute a pending threshold change
    function executeSetThreshold(bytes32 changeId) external {
        PendingChange storage change = pendingChanges[changeId];
        if (change.executeAfter == 0) revert ChangeNotFound();
        if (change.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert TimelockNotExpired();
        if (change.changeType != keccak256("SET_THRESHOLD")) revert ChangeNotFound();
        
        change.executed = true;
        uint256 _threshold = abi.decode(change.data, (uint256));
        
        // Re-validate at execution time
        if (_threshold < MIN_THRESHOLD || _threshold > sequencerCount) {
            revert InvalidThreshold(_threshold, sequencerCount);
        }
        
        uint256 oldThreshold = threshold;
        threshold = _threshold;
        emit ThresholdUpdated(oldThreshold, _threshold);
        emit AdminChangeExecuted(changeId);
    }

    function setSequencerRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        address oldRegistry = sequencerRegistry;
        sequencerRegistry = _registry;
        emit SequencerRegistryUpdated(oldRegistry, _registry);
    }

    /// @notice Sync from registry - can only be called by the registry itself
    function syncFromRegistry() external onlySequencerRegistry {
        (address[] memory activeSequencers,) = ISequencerRegistry(sequencerRegistry).getActiveSequencers();

        // Clear current
        uint256 len = sequencers.length;
        for (uint256 i = 0; i < len; i++) {
            isSequencer[sequencers[i]] = false;
        }
        delete sequencers;

        // Add active (up to MAX_SEQUENCERS)
        uint256 toAdd = activeSequencers.length > MAX_SEQUENCERS ? MAX_SEQUENCERS : activeSequencers.length;
        for (uint256 i = 0; i < toAdd; i++) {
            address seq = activeSequencers[i];
            if (seq != address(0) && !isSequencer[seq]) {
                isSequencer[seq] = true;
                sequencers.push(seq);
            }
        }

        sequencerCount = sequencers.length;
        
        // Ensure threshold is valid
        if (threshold > sequencerCount && sequencerCount >= MIN_THRESHOLD) {
            threshold = sequencerCount;
        } else if (sequencerCount < MIN_THRESHOLD) {
            threshold = MIN_THRESHOLD; // Will prevent submissions until enough sequencers
        }
    }

    // ============ View Functions ============

    function getSequencers() external view returns (address[] memory) {
        return sequencers;
    }

    function getCurrentNonce() external view returns (uint256) {
        return nonce;
    }
    
    function getPendingChange(bytes32 changeId) external view returns (PendingChange memory) {
        return pendingChanges[changeId];
    }
}

interface ISequencerRegistry {
    function getActiveSequencers() external view returns (address[] memory addresses, uint256[] memory weights);
}
