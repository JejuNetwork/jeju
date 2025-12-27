// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ThresholdBatchSubmitter
 * @notice N-of-M threshold signatures for batch submission. Min 2 signers, max 100.
 */
contract ThresholdBatchSubmitter is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============
    uint256 public constant MIN_THRESHOLD = 2;
    uint256 public constant MAX_SEQUENCERS = 100;
    uint256 public constant ADMIN_TIMELOCK_DELAY = 2 days;
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)");

    // ============ Immutables ============
    address public immutable batchInbox;
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ State ============
    address public sequencerRegistry;
    uint256 public threshold;
    uint256 public sequencerCount;
    uint256 public nonce;
    mapping(address => bool) public isSequencer;
    address[] public sequencers;

    struct PendingChange {
        bytes32 changeType;
        bytes data;
        uint256 executeAfter;
        bool executed;
    }

    mapping(bytes32 => PendingChange) public pendingChanges;

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

    modifier onlySequencerRegistry() {
        if (msg.sender != sequencerRegistry) revert NotSequencerRegistry();
        _;
    }

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

    // ============ Core ============

    function submitBatch(bytes calldata batchData, bytes[] calldata signatures, address[] calldata signers)
        external
        nonReentrant
    {
        uint256 sigCount = signatures.length;
        if (sigCount < threshold) revert InsufficientSignatures(sigCount, threshold);
        if (sigCount != signers.length) revert InsufficientSignatures(signers.length, sigCount);

        bytes32 digest = _hashTypedData(keccak256(batchData), nonce);
        uint256 signerBitmap;

        for (uint256 i; i < sigCount; ++i) {
            address recovered = digest.recover(signatures[i]);
            if (recovered != signers[i]) revert InvalidSignature(recovered, i);
            if (!isSequencer[recovered]) revert NotAuthorizedSequencer(recovered);
            uint256 bit = 1 << _getSequencerIndex(recovered);
            if (signerBitmap & bit != 0) revert DuplicateSigner(recovered);
            signerBitmap |= bit;
        }

        uint256 currentNonce = nonce++;
        (bool ok,) = batchInbox.call(batchData);
        if (!ok) revert BatchSubmissionFailed();
        emit BatchSubmitted(keccak256(batchData), currentNonce, signers);
    }

    function getBatchDigest(bytes calldata batchData) external view returns (bytes32) {
        return _hashTypedData(keccak256(batchData), nonce);
    }

    function getBatchDigestWithNonce(bytes calldata batchData, uint256 _nonce) external view returns (bytes32) {
        return _hashTypedData(keccak256(batchData), _nonce);
    }

    function _hashTypedData(bytes32 batchHash, uint256 _nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(BATCH_TYPEHASH, batchHash, _nonce, block.chainid))
            )
        );
    }

    function _getSequencerIndex(address seq) internal view returns (uint256) {
        for (uint256 i; i < sequencers.length; ++i) {
            if (sequencers[i] == seq) return i;
        }
        revert NotAuthorizedSequencer(seq);
    }

    // ============ Timelocked Admin ============

    function _proposeChange(bytes32 changeType, bytes memory data) internal returns (bytes32 changeId) {
        changeId = keccak256(abi.encodePacked(changeType, data, block.timestamp));
        uint256 executeAfter = block.timestamp + ADMIN_TIMELOCK_DELAY;
        pendingChanges[changeId] = PendingChange(changeType, data, executeAfter, false);
        emit AdminChangeProposed(changeId, changeType, executeAfter);
    }

    function _executeChange(bytes32 changeId, bytes32 expectedType) internal returns (bytes memory) {
        PendingChange storage c = pendingChanges[changeId];
        if (c.executeAfter == 0) revert ChangeNotFound();
        if (c.executed) revert ChangeAlreadyExecuted();
        if (block.timestamp < c.executeAfter) revert TimelockNotExpired();
        if (c.changeType != expectedType) revert ChangeNotFound();
        c.executed = true;
        emit AdminChangeExecuted(changeId);
        return c.data;
    }

    function proposeAddSequencer(address seq) external onlyOwner returns (bytes32) {
        if (seq == address(0)) revert ZeroAddress();
        if (sequencerCount >= MAX_SEQUENCERS) revert MaxSequencersReached();
        return _proposeChange(keccak256("ADD_SEQUENCER"), abi.encode(seq));
    }

    function executeAddSequencer(bytes32 changeId) external {
        address seq = abi.decode(_executeChange(changeId, keccak256("ADD_SEQUENCER")), (address));
        if (!isSequencer[seq]) {
            isSequencer[seq] = true;
            sequencers.push(seq);
            sequencerCount++;
            emit SequencerAdded(seq);
        }
    }

    function proposeRemoveSequencer(address seq) external onlyOwner returns (bytes32) {
        return _proposeChange(keccak256("REMOVE_SEQUENCER"), abi.encode(seq));
    }

    function executeRemoveSequencer(bytes32 changeId) external {
        address seq = abi.decode(_executeChange(changeId, keccak256("REMOVE_SEQUENCER")), (address));
        _removeSequencerInternal(seq);
    }

    function proposeSetThreshold(uint256 _threshold) external onlyOwner returns (bytes32) {
        if (_threshold < MIN_THRESHOLD || _threshold > sequencerCount) {
            revert InvalidThreshold(_threshold, sequencerCount);
        }
        return _proposeChange(keccak256("SET_THRESHOLD"), abi.encode(_threshold));
    }

    function executeSetThreshold(bytes32 changeId) external {
        uint256 _threshold = abi.decode(_executeChange(changeId, keccak256("SET_THRESHOLD")), (uint256));
        if (_threshold < MIN_THRESHOLD || _threshold > sequencerCount) {
            revert InvalidThreshold(_threshold, sequencerCount);
        }
        emit ThresholdUpdated(threshold, _threshold);
        threshold = _threshold;
    }

    function cancelChange(bytes32 changeId) external onlyOwner {
        PendingChange storage c = pendingChanges[changeId];
        if (c.executeAfter == 0) revert ChangeNotFound();
        if (c.executed) revert ChangeAlreadyExecuted();
        delete pendingChanges[changeId];
        emit AdminChangeCancelled(changeId);
    }

    function _removeSequencerInternal(address seq) internal {
        if (!isSequencer[seq]) return;
        isSequencer[seq] = false;
        for (uint256 i; i < sequencers.length; ++i) {
            if (sequencers[i] == seq) {
                sequencers[i] = sequencers[sequencers.length - 1];
                sequencers.pop();
                break;
            }
        }
        sequencerCount--;
        if (threshold > sequencerCount && sequencerCount >= MIN_THRESHOLD) {
            emit ThresholdUpdated(threshold, sequencerCount);
            threshold = sequencerCount;
        }
        emit SequencerRemoved(seq);
    }

    // ============ Registry Sync ============

    function setSequencerRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        emit SequencerRegistryUpdated(sequencerRegistry, _registry);
        sequencerRegistry = _registry;
    }

    function syncFromRegistry() external onlySequencerRegistry {
        (address[] memory active,) = ISequencerRegistry(sequencerRegistry).getActiveSequencers();
        for (uint256 i; i < sequencers.length; ++i) {
            isSequencer[sequencers[i]] = false;
        }
        delete sequencers;

        uint256 toAdd = active.length > MAX_SEQUENCERS ? MAX_SEQUENCERS : active.length;
        for (uint256 i; i < toAdd; ++i) {
            if (active[i] != address(0) && !isSequencer[active[i]]) {
                isSequencer[active[i]] = true;
                sequencers.push(active[i]);
            }
        }
        sequencerCount = sequencers.length;
        if (threshold > sequencerCount && sequencerCount >= MIN_THRESHOLD) threshold = sequencerCount;
        else if (sequencerCount < MIN_THRESHOLD) threshold = MIN_THRESHOLD;
    }

    // ============ View ============
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
    function getActiveSequencers() external view returns (address[] memory, uint256[] memory);
}
