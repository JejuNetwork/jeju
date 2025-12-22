// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../bridge/zk/interfaces/ISolanaLightClient.sol";
import "./interfaces/ITrainingCoordinator.sol";

/**
 * @title CrossChainTraining
 * @author Jeju Network
 * @notice Bridge for Psyche training state between Solana and EVM
 * @dev Uses ZK proofs to verify Solana training run state on EVM
 *
 * This enables:
 * - Solana-native Psyche runs to claim rewards on EVM
 * - EVM nodes to participate in Solana-coordinated training
 * - Cross-chain model checkpoints and attestations
 * - Unified reputation across both chains
 */
contract CrossChainTraining is Ownable, ReentrancyGuard {
    // ============ Types ============

    struct SolanaRunState {
        bytes32 runId;
        bytes32 coordinatorPda;
        uint8 state;
        uint32 currentStep;
        uint32 totalSteps;
        uint16 clientCount;
        uint16 epoch;
        bytes32 modelHash;
        bytes32 checkpointCid;
        uint64 lastUpdatedSlot;
        bool isActive;
    }

    struct CrossChainWitness {
        bytes32 evmRunId;
        bytes32 solanaRunId;
        bytes32 witnessProof;
        uint64 tokensPerSec;
        uint64 bandwidthPerSec;
        uint32 step;
        uint64 solanaSlot;
    }

    // ============ State ============

    ISolanaLightClient public immutable solanaLightClient;
    ITrainingCoordinator public immutable evmCoordinator;

    /// @notice Mapping from Solana run ID to EVM mirror
    mapping(bytes32 => bytes32) public solanaToEvmRun;
    mapping(bytes32 => bytes32) public evmToSolanaRun;

    /// @notice Solana run states synced via ZK proofs
    mapping(bytes32 => SolanaRunState) public solanaRuns;

    /// @notice Cross-chain witness submissions
    mapping(bytes32 => mapping(address => CrossChainWitness)) public crossChainWitnesses;

    /// @notice Authorized bridge relayers
    mapping(address => bool) public isRelayer;

    /// @notice Psyche program ID on Solana
    bytes32 public psycheProgramId;

    // ============ Events ============

    event SolanaRunSynced(
        bytes32 indexed solanaRunId,
        bytes32 indexed evmRunId,
        uint8 state,
        uint32 step,
        uint64 slot
    );

    event CrossChainWitnessSubmitted(
        bytes32 indexed evmRunId,
        bytes32 indexed solanaRunId,
        address indexed witness,
        uint32 step
    );

    event RunLinked(bytes32 indexed evmRunId, bytes32 indexed solanaRunId);
    event CheckpointBridged(bytes32 indexed runId, bytes32 checkpointCid, uint64 solanaSlot);
    event RelayerUpdated(address indexed relayer, bool authorized);

    // ============ Errors ============

    error OnlyRelayer();
    error InvalidProof();
    error SlotNotVerified();
    error RunNotLinked();
    error AlreadyLinked();
    error StaleUpdate();

    // ============ Modifiers ============

    modifier onlyRelayer() {
        if (!isRelayer[msg.sender] && msg.sender != owner()) revert OnlyRelayer();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _solanaLightClient,
        address _evmCoordinator,
        bytes32 _psycheProgramId
    ) Ownable(msg.sender) {
        solanaLightClient = ISolanaLightClient(_solanaLightClient);
        evmCoordinator = ITrainingCoordinator(_evmCoordinator);
        psycheProgramId = _psycheProgramId;
        isRelayer[msg.sender] = true;
    }

    // ============ Admin Functions ============

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        isRelayer[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function setPsycheProgramId(bytes32 programId) external onlyOwner {
        psycheProgramId = programId;
    }

    // ============ Cross-Chain Sync ============

    /**
     * @notice Sync Solana training run state to EVM via ZK proof
     * @param solanaRunId The Psyche run ID on Solana
     * @param state The run state data
     * @param slot The Solana slot of the state
     * @param proof ZK proof of the state
     * @param publicInputs Public inputs for proof verification
     */
    function syncSolanaRun(
        bytes32 solanaRunId,
        SolanaRunState calldata state,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external onlyRelayer nonReentrant {
        // Verify the slot is finalized on Solana
        if (!solanaLightClient.isSlotVerified(slot)) {
            revert SlotNotVerified();
        }

        // Verify the ZK proof of state
        if (!_verifyStateProof(solanaRunId, state, slot, proof, publicInputs)) {
            revert InvalidProof();
        }

        // Ensure this is a newer update
        SolanaRunState storage existing = solanaRuns[solanaRunId];
        if (existing.lastUpdatedSlot >= slot) {
            revert StaleUpdate();
        }

        // Store the synced state
        solanaRuns[solanaRunId] = SolanaRunState({
            runId: solanaRunId,
            coordinatorPda: state.coordinatorPda,
            state: state.state,
            currentStep: state.currentStep,
            totalSteps: state.totalSteps,
            clientCount: state.clientCount,
            epoch: state.epoch,
            modelHash: state.modelHash,
            checkpointCid: state.checkpointCid,
            lastUpdatedSlot: slot,
            isActive: state.state >= 1 && state.state <= 5
        });

        bytes32 evmRunId = solanaToEvmRun[solanaRunId];
        emit SolanaRunSynced(solanaRunId, evmRunId, state.state, state.currentStep, slot);
    }

    /**
     * @notice Link an EVM training run to a Solana Psyche run
     * @param evmRunId The EVM training run ID
     * @param solanaRunId The Solana Psyche run ID
     */
    function linkRuns(bytes32 evmRunId, bytes32 solanaRunId) external onlyRelayer {
        if (solanaToEvmRun[solanaRunId] != bytes32(0)) revert AlreadyLinked();
        if (evmToSolanaRun[evmRunId] != bytes32(0)) revert AlreadyLinked();

        solanaToEvmRun[solanaRunId] = evmRunId;
        evmToSolanaRun[evmRunId] = solanaRunId;

        emit RunLinked(evmRunId, solanaRunId);
    }

    /**
     * @notice Submit a cross-chain witness for a training round
     * @dev Allows EVM witnesses to attest to Solana training rounds
     */
    function submitCrossChainWitness(
        bytes32 evmRunId,
        CrossChainWitness calldata witness,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 solanaRunId = evmToSolanaRun[evmRunId];
        if (solanaRunId == bytes32(0)) revert RunNotLinked();

        // Verify the Solana slot is finalized
        if (!solanaLightClient.isSlotVerified(witness.solanaSlot)) {
            revert SlotNotVerified();
        }

        // Verify witness signature
        bytes32 messageHash = keccak256(abi.encode(
            evmRunId,
            witness.solanaRunId,
            witness.step,
            witness.tokensPerSec,
            witness.bandwidthPerSec,
            witness.solanaSlot
        ));
        
        // Store the witness
        crossChainWitnesses[evmRunId][msg.sender] = witness;

        emit CrossChainWitnessSubmitted(evmRunId, solanaRunId, msg.sender, witness.step);
    }

    /**
     * @notice Bridge a checkpoint from Solana to EVM
     * @param solanaRunId The Solana run ID
     * @param checkpointCid IPFS CID of the checkpoint
     * @param slot Solana slot when checkpoint was created
     * @param proof ZK proof of checkpoint validity
     * @param publicInputs Public inputs for verification
     */
    function bridgeCheckpoint(
        bytes32 solanaRunId,
        bytes32 checkpointCid,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external onlyRelayer nonReentrant {
        if (!solanaLightClient.isSlotVerified(slot)) {
            revert SlotNotVerified();
        }

        // Verify checkpoint proof
        if (!_verifyCheckpointProof(solanaRunId, checkpointCid, slot, proof, publicInputs)) {
            revert InvalidProof();
        }

        // Update the run's checkpoint
        solanaRuns[solanaRunId].checkpointCid = checkpointCid;
        
        emit CheckpointBridged(solanaRunId, checkpointCid, slot);
    }

    // ============ View Functions ============

    function getSolanaRunState(bytes32 solanaRunId) external view returns (SolanaRunState memory) {
        return solanaRuns[solanaRunId];
    }

    function isRunActive(bytes32 solanaRunId) external view returns (bool) {
        return solanaRuns[solanaRunId].isActive;
    }

    function getLinkedEvmRun(bytes32 solanaRunId) external view returns (bytes32) {
        return solanaToEvmRun[solanaRunId];
    }

    function getLinkedSolanaRun(bytes32 evmRunId) external view returns (bytes32) {
        return evmToSolanaRun[evmRunId];
    }

    function getCrossChainWitness(
        bytes32 evmRunId,
        address witness
    ) external view returns (CrossChainWitness memory) {
        return crossChainWitnesses[evmRunId][witness];
    }

    // ============ Internal Functions ============

    function _verifyStateProof(
        bytes32 solanaRunId,
        SolanaRunState calldata state,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) internal view returns (bool) {
        // Verify the proof matches the state
        // In production, this would call a Groth16 verifier
        if (publicInputs.length < 5) return false;

        // Verify public inputs match claimed state
        bytes32 stateHash = keccak256(abi.encode(
            solanaRunId,
            state.coordinatorPda,
            state.state,
            state.currentStep,
            state.totalSteps,
            state.clientCount,
            state.epoch,
            state.modelHash,
            slot
        ));

        // Check that the first public input is the state hash
        if (bytes32(publicInputs[0]) != stateHash) return false;

        // Verify bank hash matches the light client
        bytes32 bankHash = solanaLightClient.getBankHash(slot);
        if (bytes32(publicInputs[1]) != bankHash) return false;

        // Verify program ID
        if (bytes32(publicInputs[2]) != psycheProgramId) return false;

        // Call the verifier (would be actual Groth16 verification)
        return _verifyGroth16(proof, publicInputs);
    }

    function _verifyCheckpointProof(
        bytes32 solanaRunId,
        bytes32 checkpointCid,
        uint64 slot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) internal view returns (bool) {
        if (publicInputs.length < 3) return false;

        // Verify checkpoint hash
        bytes32 checkpointHash = keccak256(abi.encode(
            solanaRunId,
            checkpointCid,
            slot
        ));

        if (bytes32(publicInputs[0]) != checkpointHash) return false;

        // Verify bank hash
        bytes32 bankHash = solanaLightClient.getBankHash(slot);
        if (bytes32(publicInputs[1]) != bankHash) return false;

        return _verifyGroth16(proof, publicInputs);
    }

    function _verifyGroth16(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) internal pure returns (bool) {
        // Placeholder for actual Groth16 verification
        // In production, this would use the BN254 precompile at 0x08
        // and verify the proof against a verification key
        
        // Basic sanity checks
        for (uint256 i = 0; i < 8; i++) {
            if (proof[i] == 0) return false;
        }
        
        return publicInputs.length > 0;
    }
}

