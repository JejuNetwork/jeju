// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IL2OutputOracle.sol";

/// @title WithdrawalPortal
/// @notice L1 contract that enables users to prove and finalize withdrawals from L2.
///         This implements the "escape hatch" for Stage 2 decentralization - users can
///         exit based purely on L1 data even if all sequencers go offline.
/// @dev Withdrawals go through two phases:
///      1. Prove: User submits Merkle proof of withdrawal message against L2 output root
///      2. Finalize: After 7-day challenge period, user can finalize and receive funds
contract WithdrawalPortal is ReentrancyGuard {
    /// @notice Withdrawal proof information stored during prove phase
    struct ProvenWithdrawal {
        bytes32 outputRoot;
        uint128 timestamp;
        uint128 l2OutputIndex;
    }

    /// @notice Withdrawal transaction structure (matches L2ToL1MessagePasser)
    struct WithdrawalTransaction {
        uint256 nonce;
        address sender;
        address target;
        uint256 value;
        uint256 gasLimit;
        bytes data;
    }

    /// @notice Output root proof structure for verifying against L2 state
    struct OutputRootProof {
        bytes32 version;
        bytes32 stateRoot;
        bytes32 messagePasserStorageRoot;
        bytes32 latestBlockhash;
    }

    /// @notice The L2 output oracle contract
    IL2OutputOracle public immutable l2Oracle;

    /// @notice Minimum time that must elapse before a proven withdrawal can be finalized (7 days)
    uint256 public constant FINALIZATION_PERIOD_SECONDS = 7 days;

    /// @notice Mapping of withdrawal hashes to proven withdrawal data
    mapping(bytes32 => ProvenWithdrawal) public provenWithdrawals;

    /// @notice Mapping of withdrawal hashes to whether they've been finalized
    mapping(bytes32 => bool) public finalizedWithdrawals;

    /// @notice Emitted when a withdrawal is proven
    event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from, address indexed to, uint256 nonce);

    /// @notice Emitted when a withdrawal is finalized
    event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success);

    error InvalidProof();
    error OutputRootMismatch();
    error WithdrawalNotProven();
    error WithdrawalAlreadyFinalized();
    error ChallengePeriodNotElapsed();
    error ExecutionFailed();
    error InvalidOutputRootProof();
    error ZeroAddress();
    error ProofAlreadySubmitted();

    /// @param _l2Oracle Address of the L2OutputOracle contract
    constructor(address _l2Oracle) {
        if (_l2Oracle == address(0)) revert ZeroAddress();
        l2Oracle = IL2OutputOracle(_l2Oracle);
    }

    /// @notice Proves a withdrawal transaction by verifying its inclusion in the L2 state
    /// @param _tx The withdrawal transaction to prove
    /// @param _l2OutputIndex The index of the L2 output in the oracle
    /// @param _outputRootProof The proof of the output root components
    /// @param _withdrawalProof The Merkle proof of the withdrawal in the message passer storage
    function proveWithdrawal(
        WithdrawalTransaction calldata _tx,
        uint256 _l2OutputIndex,
        OutputRootProof calldata _outputRootProof,
        bytes32[] calldata _withdrawalProof
    ) external nonReentrant {
        // Compute the withdrawal hash
        bytes32 withdrawalHash = hashWithdrawal(_tx);

        // Get the output proposal from the oracle
        IL2OutputOracle.OutputProposal memory proposal = l2Oracle.getL2Output(_l2OutputIndex);

        // Verify the output root proof reconstructs to the stored output root
        bytes32 computedOutputRoot = computeOutputRoot(_outputRootProof);
        if (computedOutputRoot != proposal.outputRoot) revert OutputRootMismatch();

        // Verify the withdrawal hash is included in the message passer storage
        // The withdrawal hash should be stored at a slot derived from the sentMessages mapping
        bytes32 storageKey = computeStorageKey(withdrawalHash);
        if (
            !verifyMerkleProof(
                _withdrawalProof, _outputRootProof.messagePasserStorageRoot, storageKey, bytes32(uint256(1))
            )
        ) {
            revert InvalidProof();
        }

        // Prevent re-proving if already proven with same or later output
        ProvenWithdrawal memory existing = provenWithdrawals[withdrawalHash];
        if (existing.timestamp != 0 && existing.l2OutputIndex >= _l2OutputIndex) {
            revert ProofAlreadySubmitted();
        }

        // Store the proven withdrawal
        provenWithdrawals[withdrawalHash] = ProvenWithdrawal({
            outputRoot: proposal.outputRoot,
            timestamp: uint128(block.timestamp),
            l2OutputIndex: uint128(_l2OutputIndex)
        });

        emit WithdrawalProven(withdrawalHash, _tx.sender, _tx.target, _tx.nonce);
    }

    /// @notice Finalizes a withdrawal after the challenge period has elapsed
    /// @param _tx The withdrawal transaction to finalize
    function finalizeWithdrawal(WithdrawalTransaction calldata _tx) external nonReentrant {
        bytes32 withdrawalHash = hashWithdrawal(_tx);

        // Check withdrawal was proven
        ProvenWithdrawal memory proven = provenWithdrawals[withdrawalHash];
        if (proven.timestamp == 0) revert WithdrawalNotProven();

        // Check withdrawal hasn't been finalized
        if (finalizedWithdrawals[withdrawalHash]) revert WithdrawalAlreadyFinalized();

        // Check challenge period has elapsed
        if (block.timestamp < proven.timestamp + FINALIZATION_PERIOD_SECONDS) {
            revert ChallengePeriodNotElapsed();
        }

        // Verify the output root is still valid (hasn't been challenged and deleted)
        IL2OutputOracle.OutputProposal memory proposal = l2Oracle.getL2Output(proven.l2OutputIndex);
        if (proposal.outputRoot != proven.outputRoot) revert OutputRootMismatch();

        // Mark as finalized BEFORE external call (CEI pattern)
        finalizedWithdrawals[withdrawalHash] = true;

        // Execute the withdrawal
        bool success;
        if (_tx.data.length > 0) {
            (success,) = _tx.target.call{value: _tx.value, gas: _tx.gasLimit}(_tx.data);
        } else {
            (success,) = _tx.target.call{value: _tx.value, gas: _tx.gasLimit}("");
        }

        emit WithdrawalFinalized(withdrawalHash, success);

        // Note: We emit success status but don't revert on failure.
        // This matches Optimism's design - the withdrawal is marked finalized
        // even if the target call fails, to prevent griefing attacks.
    }

    /// @notice Computes the hash of a withdrawal transaction
    /// @param _tx The withdrawal transaction
    /// @return The keccak256 hash
    function hashWithdrawal(WithdrawalTransaction memory _tx) public pure returns (bytes32) {
        return keccak256(abi.encode(_tx.nonce, _tx.sender, _tx.target, _tx.value, _tx.gasLimit, _tx.data));
    }

    /// @notice Computes the output root from its components
    /// @param _proof The output root proof containing all components
    /// @return The computed output root
    function computeOutputRoot(OutputRootProof memory _proof) public pure returns (bytes32) {
        return keccak256(
            abi.encode(_proof.version, _proof.stateRoot, _proof.messagePasserStorageRoot, _proof.latestBlockhash)
        );
    }

    /// @notice Computes the storage key for a withdrawal hash in the message passer
    /// @param _withdrawalHash The withdrawal hash
    /// @return The storage slot key
    function computeStorageKey(bytes32 _withdrawalHash) public pure returns (bytes32) {
        // Storage slot for sentMessages[_withdrawalHash] in L2ToL1MessagePasser
        // sentMessages is at slot 1, so we compute keccak256(key . slot)
        return keccak256(abi.encode(_withdrawalHash, uint256(1)));
    }

    /// @notice Verifies a Merkle-Patricia trie proof for storage inclusion
    /// @param _proof The proof nodes
    /// @param _root The storage root to verify against
    /// @param _key The storage key being proven
    /// @param _value The expected value at the key
    /// @return True if the proof is valid
    function verifyMerkleProof(bytes32[] calldata _proof, bytes32 _root, bytes32 _key, bytes32 _value)
        public
        pure
        returns (bool)
    {
        // For simplicity, we use a binary Merkle proof verification
        // In production, this would use RLP-encoded Merkle-Patricia trie proofs
        bytes32 leaf = keccak256(abi.encodePacked(_key, _value));
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < _proof.length; i++) {
            bytes32 proofElement = _proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == _root;
    }

    /// @notice Checks if a withdrawal has been proven
    /// @param _withdrawalHash The withdrawal hash to check
    /// @return True if the withdrawal has been proven
    function isWithdrawalProven(bytes32 _withdrawalHash) external view returns (bool) {
        return provenWithdrawals[_withdrawalHash].timestamp != 0;
    }

    /// @notice Checks if a withdrawal has been finalized
    /// @param _withdrawalHash The withdrawal hash to check
    /// @return True if the withdrawal has been finalized
    function isWithdrawalFinalized(bytes32 _withdrawalHash) external view returns (bool) {
        return finalizedWithdrawals[_withdrawalHash];
    }

    /// @notice Returns the timestamp when a withdrawal can be finalized
    /// @param _withdrawalHash The withdrawal hash
    /// @return The finalization timestamp (0 if not proven)
    function getFinalizationTime(bytes32 _withdrawalHash) external view returns (uint256) {
        ProvenWithdrawal memory proven = provenWithdrawals[_withdrawalHash];
        if (proven.timestamp == 0) return 0;
        return proven.timestamp + FINALIZATION_PERIOD_SECONDS;
    }

    /// @notice Allows the portal to receive ETH for withdrawal payouts
    receive() external payable {}
}
