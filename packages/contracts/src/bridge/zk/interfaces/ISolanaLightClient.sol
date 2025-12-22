// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ISolanaLightClient
 * @notice Interface for Solana light client on EVM
 * @dev Verifies Solana consensus using ZK proofs
 */
interface ISolanaLightClient {
    function getLatestSlot() external view returns (uint64);
    function getBankHash(uint64 slot) external view returns (bytes32);
    function getCurrentEpoch() external view returns (uint64 epoch, bytes32 stakesRoot);
    function isSlotVerified(uint64 slot) external view returns (bool);
    function updateState(
        uint64 slot,
        bytes32 bankHash,
        bytes32 epochStakesRoot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external;
}

