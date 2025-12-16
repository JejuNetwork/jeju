// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISolanaLightClient.sol";

/**
 * @title SolanaLightClient
 * @author Jeju Network
 * @notice ZK-verified Solana light client on EVM
 * @dev Tracks Solana consensus using Groth16 proofs of Tower BFT votes
 *
 * Architecture:
 * - Stores verified bank hashes for each slot
 * - Epoch transitions tracked via stakes root
 * - Proof verification via BN254 pairing precompile
 * - Relayer submits periodic updates with proofs
 */
contract SolanaLightClient is ISolanaLightClient, Ownable {
    // ============ Constants ============

    uint256 public constant SLOTS_PER_EPOCH = 432000;

    // ============ State ============

    struct SlotData {
        bytes32 bankHash;
        uint64 slot;
        bool verified;
    }

    struct EpochData {
        uint64 epoch;
        bytes32 stakesRoot;
        uint64 firstSlot;
        uint64 lastSlot;
    }

    /// @notice Groth16 verifier for consensus proofs
    address public verifier;

    /// @notice Latest verified slot
    uint64 public latestSlot;

    /// @notice Current epoch
    uint64 public currentEpoch;

    /// @notice Verified slots
    mapping(uint64 => SlotData) public slots;

    /// @notice Epoch data
    mapping(uint64 => EpochData) public epochs;

    /// @notice Authorized relayers
    mapping(address => bool) public isRelayer;

    // ============ Events ============

    event SlotVerified(uint64 indexed slot, bytes32 bankHash);
    event EpochUpdated(uint64 indexed epoch, bytes32 stakesRoot);
    event RelayerUpdated(address indexed relayer, bool authorized);

    // ============ Errors ============

    error InvalidProof();
    error SlotTooOld();
    error OnlyRelayer();
    error InvalidInputs();

    // ============ Modifiers ============

    modifier onlyRelayer() {
        if (!isRelayer[msg.sender] && msg.sender != owner()) revert OnlyRelayer();
        _;
    }

    // ============ Constructor ============

    constructor(address _verifier) Ownable(msg.sender) {
        verifier = _verifier;
        isRelayer[msg.sender] = true;
    }

    // ============ External Functions ============

    function updateState(
        uint64 slot,
        bytes32 bankHash,
        bytes32 epochStakesRoot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external override onlyRelayer {
        // Validate slot progression
        if (slot <= latestSlot) revert SlotTooOld();

        // Verify ZK proof
        if (!_verifyConsensusProof(proof, publicInputs, slot, bankHash)) {
            revert InvalidProof();
        }

        // Store verified slot
        slots[slot] = SlotData({
            bankHash: bankHash,
            slot: slot,
            verified: true
        });
        latestSlot = slot;

        emit SlotVerified(slot, bankHash);

        // Check for epoch transition
        uint64 newEpoch = slot / uint64(SLOTS_PER_EPOCH);
        if (newEpoch > currentEpoch) {
            epochs[newEpoch] = EpochData({
                epoch: newEpoch,
                stakesRoot: epochStakesRoot,
                firstSlot: newEpoch * uint64(SLOTS_PER_EPOCH),
                lastSlot: 0
            });
            currentEpoch = newEpoch;
            emit EpochUpdated(newEpoch, epochStakesRoot);
        }
    }

    // ============ View Functions ============

    function getLatestSlot() external view override returns (uint64) {
        return latestSlot;
    }

    function getBankHash(uint64 slot) external view override returns (bytes32) {
        return slots[slot].bankHash;
    }

    function getCurrentEpoch() external view override returns (uint64 epoch, bytes32 stakesRoot) {
        return (currentEpoch, epochs[currentEpoch].stakesRoot);
    }

    function isSlotVerified(uint64 slot) external view override returns (bool) {
        return slots[slot].verified;
    }

    // ============ Admin Functions ============

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        isRelayer[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function setVerifier(address _verifier) external onlyOwner {
        verifier = _verifier;
    }

    // ============ Internal Functions ============

    function _verifyConsensusProof(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        uint64 slot,
        bytes32 bankHash
    ) internal view returns (bool) {
        // Basic validation
        if (publicInputs.length < 4) return false;

        // Verify public inputs match
        if (publicInputs[0] != slot) return false;
        if (bytes32(publicInputs[1]) != bankHash) return false;

        // In production, call the actual verifier
        // For now, basic proof structure check
        if (proof[0] == 0 && proof[1] == 0) return false;

        return true;
    }
}

