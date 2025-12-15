// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISolanaLightClient
 * @notice Interface for Solana light client on EVM
 * @dev Verifies Solana consensus using ZK proofs
 */
interface ISolanaLightClient {
    /// @notice Emitted when light client state is updated
    event StateUpdated(
        uint64 indexed slot,
        bytes32 bankHash,
        uint64 epoch,
        bytes32 epochStakesRoot
    );

    /// @notice Emitted when epoch stakes are updated
    event EpochStakesUpdated(uint64 indexed epoch, bytes32 stakesRoot, uint256 totalStake);

    /**
     * @notice Update the light client with a new Solana state
     * @param slot Solana slot number
     * @param bankHash Bank hash at this slot
     * @param epochStakesRoot Root of validator stakes merkle tree
     * @param proof Groth16 proof of supermajority consensus
     * @param publicInputs Public inputs for the proof
     */
    function updateState(
        uint64 slot,
        bytes32 bankHash,
        bytes32 epochStakesRoot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external;

    /**
     * @notice Verify a Solana account proof against the current state
     * @param account Solana account pubkey (32 bytes)
     * @param slot Slot at which the account state was captured
     * @param data Account data to verify
     * @param proof Merkle proof of account inclusion
     * @return valid True if account proof is valid
     */
    function verifyAccountProof(
        bytes32 account,
        uint64 slot,
        bytes calldata data,
        bytes32[] calldata proof
    ) external view returns (bool valid);

    /**
     * @notice Get the latest verified slot
     * @return slot Latest slot
     */
    function getLatestSlot() external view returns (uint64 slot);

    /**
     * @notice Get the bank hash for a specific slot
     * @param slot Slot to query
     * @return bankHash Bank hash at that slot (zero if not verified)
     */
    function getBankHash(uint64 slot) external view returns (bytes32 bankHash);

    /**
     * @notice Get current epoch information
     * @return epoch Current epoch
     * @return stakesRoot Current epoch stakes root
     */
    function getCurrentEpoch() external view returns (uint64 epoch, bytes32 stakesRoot);

    /**
     * @notice Check if a slot has been verified
     * @param slot Slot to check
     * @return verified True if slot has been verified
     */
    function isSlotVerified(uint64 slot) external view returns (bool verified);
}
