// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SolanaTypes
 * @notice Type definitions and utilities for Solana data structures
 */
library SolanaTypes {
    /// @notice Solana slot (64-bit unsigned)
    type Slot is uint64;

    /// @notice Solana epoch (64-bit unsigned)
    type Epoch is uint64;

    /// @notice Solana pubkey (32 bytes)
    type Pubkey is bytes32;

    /// @notice Ed25519 signature (64 bytes)
    struct Ed25519Signature {
        bytes32 r;
        bytes32 s;
    }

    /// @notice Validator stake information
    struct ValidatorStake {
        Pubkey pubkey;
        Pubkey voteAccount;
        uint64 stake; // In lamports
    }

    /// @notice Bank hash commitment
    struct BankHash {
        Slot slot;
        bytes32 hash;
        bytes32 parentHash;
        bytes32 transactionsHash;
        bytes32 accountsHash;
    }

    /// @notice Validator vote
    struct Vote {
        Pubkey validator;
        Slot slot;
        bytes32 hash;
        Ed25519Signature signature;
        uint64 timestamp;
    }

    /// @notice Epoch stake snapshot
    struct EpochStakes {
        Epoch epoch;
        uint64 totalStake;
        bytes32 stakesRoot; // Merkle root of all validator stakes
    }

    /// @notice Account proof for SPV-style verification
    struct AccountProof {
        Pubkey account;
        Slot slot;
        bytes data;
        bytes32[] proof; // Merkle path to accounts hash
    }

    /// @notice Compute pubkey from bytes
    function toPubkey(bytes32 b) internal pure returns (Pubkey) {
        return Pubkey.wrap(b);
    }

    /// @notice Convert pubkey to bytes32
    function toBytes32(Pubkey p) internal pure returns (bytes32) {
        return Pubkey.unwrap(p);
    }

    /// @notice Check if pubkey is zero
    function isZero(Pubkey p) internal pure returns (bool) {
        return Pubkey.unwrap(p) == bytes32(0);
    }

    /// @notice Check if two pubkeys are equal
    function equals(Pubkey a, Pubkey b) internal pure returns (bool) {
        return Pubkey.unwrap(a) == Pubkey.unwrap(b);
    }

    /// @notice Compute slot from uint64
    function toSlot(uint64 s) internal pure returns (Slot) {
        return Slot.wrap(s);
    }

    /// @notice Convert slot to uint64
    function toUint64(Slot s) internal pure returns (uint64) {
        return Slot.unwrap(s);
    }

    /// @notice Compute epoch from uint64
    function toEpoch(uint64 e) internal pure returns (Epoch) {
        return Epoch.wrap(e);
    }

    /// @notice Get epoch for a slot (assuming 432,000 slots per epoch)
    function getEpoch(Slot slot) internal pure returns (Epoch) {
        return Epoch.wrap(Slot.unwrap(slot) / 432000);
    }

    /// @notice Verify merkle proof for account data
    function verifyAccountMerkleProof(
        bytes32 leaf,
        bytes32[] memory proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

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

    /// @notice Hash account data for merkle leaf
    function hashAccountData(Pubkey account, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(Pubkey.unwrap(account), data));
    }
}
