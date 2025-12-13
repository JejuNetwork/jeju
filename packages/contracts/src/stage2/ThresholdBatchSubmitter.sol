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
 */
contract ThresholdBatchSubmitter is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Batch inbox address (where batches are ultimately sent)
    address public immutable batchInbox;

    // Sequencer registry for authorized signers
    address public sequencerRegistry;

    // Threshold configuration
    uint256 public threshold;
    uint256 public sequencerCount;

    // Authorized sequencers (address => isAuthorized)
    mapping(address => bool) public isSequencer;
    address[] public sequencers;

    // Nonce to prevent replay attacks
    uint256 public nonce;

    // Domain separator for EIP-712 style signing
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)");

    event BatchSubmitted(bytes32 indexed batchHash, uint256 indexed nonce, address[] signers);
    event SequencerAdded(address indexed sequencer);
    event SequencerRemoved(address indexed sequencer);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event SequencerRegistryUpdated(address oldRegistry, address newRegistry);

    error InsufficientSignatures(uint256 provided, uint256 required);
    error InvalidSignature(address recovered, uint256 index);
    error DuplicateSigner(address signer);
    error NotAuthorizedSequencer(address signer);
    error InvalidThreshold(uint256 threshold, uint256 sequencerCount);
    error BatchSubmissionFailed();
    error ZeroAddress();

    constructor(address _batchInbox, address _owner, uint256 _threshold) Ownable(_owner) {
        if (_batchInbox == address(0)) revert ZeroAddress();
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

    function submitBatch(bytes calldata batchData, bytes[] calldata signatures, address[] calldata signers)
        external
        nonReentrant
    {
        uint256 sigCount = signatures.length;
        if (sigCount < threshold) revert InsufficientSignatures(sigCount, threshold);
        if (sigCount != signers.length) revert InsufficientSignatures(signers.length, sigCount);

        bytes32 digest = _hashTypedData(keccak256(batchData), nonce);

        for (uint256 i = 0; i < sigCount; i++) {
            address recovered = digest.recover(signatures[i]);
            if (recovered != signers[i]) revert InvalidSignature(recovered, i);
            if (!isSequencer[recovered]) revert NotAuthorizedSequencer(recovered);

            // Check for duplicates (only need to check previous signers)
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == recovered) revert DuplicateSigner(recovered);
            }
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

    // Admin functions

    function addSequencer(address sequencer) external onlyOwner {
        if (sequencer == address(0)) revert ZeroAddress();
        if (isSequencer[sequencer]) return;

        isSequencer[sequencer] = true;
        sequencers.push(sequencer);
        sequencerCount++;

        emit SequencerAdded(sequencer);
    }

    function removeSequencer(address sequencer) external onlyOwner {
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

        // Adjust threshold if needed
        if (threshold > sequencerCount && sequencerCount > 0) {
            uint256 oldThreshold = threshold;
            threshold = sequencerCount;
            emit ThresholdUpdated(oldThreshold, threshold);
        }

        emit SequencerRemoved(sequencer);
    }

    function setThreshold(uint256 _threshold) external onlyOwner {
        if (_threshold == 0 || _threshold > sequencerCount) {
            revert InvalidThreshold(_threshold, sequencerCount);
        }
        uint256 oldThreshold = threshold;
        threshold = _threshold;
        emit ThresholdUpdated(oldThreshold, _threshold);
    }

    function setSequencerRegistry(address _registry) external onlyOwner {
        address oldRegistry = sequencerRegistry;
        sequencerRegistry = _registry;
        emit SequencerRegistryUpdated(oldRegistry, _registry);
    }

    function syncFromRegistry() external {
        if (sequencerRegistry == address(0)) revert ZeroAddress();

        (address[] memory activeSequencers,) = ISequencerRegistry(sequencerRegistry).getActiveSequencers();

        // Clear current
        uint256 len = sequencers.length;
        for (uint256 i = 0; i < len; i++) {
            isSequencer[sequencers[i]] = false;
        }
        delete sequencers;

        // Add active
        for (uint256 i = 0; i < activeSequencers.length; i++) {
            address seq = activeSequencers[i];
            if (seq != address(0) && !isSequencer[seq]) {
                isSequencer[seq] = true;
                sequencers.push(seq);
            }
        }

        sequencerCount = sequencers.length;
        if (threshold > sequencerCount && sequencerCount > 0) {
            threshold = sequencerCount;
        }
    }

    function getSequencers() external view returns (address[] memory) {
        return sequencers;
    }

    function getCurrentNonce() external view returns (uint256) {
        return nonce;
    }
}

interface ISequencerRegistry {
    function getActiveSequencers() external view returns (address[] memory addresses, uint256[] memory weights);
}
