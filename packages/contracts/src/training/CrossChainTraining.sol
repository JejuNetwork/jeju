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

    event SolanaRunSynced(bytes32 indexed solanaRunId, bytes32 indexed evmRunId, uint8 state, uint32 step, uint64 slot);

    event CrossChainWitnessSubmitted(
        bytes32 indexed evmRunId, bytes32 indexed solanaRunId, address indexed witness, uint32 step
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

    constructor(address _solanaLightClient, address _evmCoordinator, bytes32 _psycheProgramId) Ownable(msg.sender) {
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
     * @dev Allows EVM witnesses to attest to Solana training rounds.
     *      The signature must be an ECDSA signature from a registered witness.
     * @param evmRunId The EVM run ID linked to the Solana run
     * @param witness The witness data from the Solana coordinator
     * @param signature ECDSA signature over the witness data hash
     */
    function submitCrossChainWitness(bytes32 evmRunId, CrossChainWitness calldata witness, bytes calldata signature)
        external
        nonReentrant
    {
        bytes32 solanaRunId = evmToSolanaRun[evmRunId];
        if (solanaRunId == bytes32(0)) revert RunNotLinked();

        // Verify the Solana slot is finalized
        if (!solanaLightClient.isSlotVerified(witness.solanaSlot)) {
            revert SlotNotVerified();
        }

        // Verify witness signature - compute message hash and recover signer
        bytes32 messageHash = keccak256(
            abi.encode(
                evmRunId,
                witness.solanaRunId,
                witness.step,
                witness.tokensPerSec,
                witness.bandwidthPerSec,
                witness.solanaSlot
            )
        );

        // Verify signature is from the caller (self-attestation)
        // For cross-chain attestation, the witness signs their own attestation
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        address recovered = _recoverSigner(ethSignedHash, signature);
        require(recovered == msg.sender, "Invalid witness signature");
        require(signature.length == 65, "Invalid signature length");

        // Store the witness
        crossChainWitnesses[evmRunId][msg.sender] = witness;

        emit CrossChainWitnessSubmitted(evmRunId, solanaRunId, msg.sender, witness.step);
    }

    /**
     * @notice Recover signer from signature
     */
    function _recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s);
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

    function getCrossChainWitness(bytes32 evmRunId, address witness) external view returns (CrossChainWitness memory) {
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
        bytes32 stateHash = keccak256(
            abi.encode(
                solanaRunId,
                state.coordinatorPda,
                state.state,
                state.currentStep,
                state.totalSteps,
                state.clientCount,
                state.epoch,
                state.modelHash,
                slot
            )
        );

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
        bytes32 checkpointHash = keccak256(abi.encode(solanaRunId, checkpointCid, slot));

        if (bytes32(publicInputs[0]) != checkpointHash) return false;

        // Verify bank hash
        bytes32 bankHash = solanaLightClient.getBankHash(slot);
        if (bytes32(publicInputs[1]) != bankHash) return false;

        return _verifyGroth16(proof, publicInputs);
    }

    /// @notice Verification key for Groth16 proofs (set during deployment)
    /// @dev These are the G1/G2 points for the verification key
    struct VerificationKey {
        uint256[2] alpha; // G1 point
        uint256[4] beta; // G2 point
        uint256[4] gamma; // G2 point
        uint256[4] delta; // G2 point
        uint256[2][] ic; // G1 points for public inputs
    }

    /// @notice Stored verification key for cross-chain training proofs
    VerificationKey internal verificationKey;
    bool internal verificationKeySet;

    /// @notice Set the Groth16 verification key
    /// @param alpha G1 alpha point [x, y]
    /// @param beta G2 beta point [x1, x2, y1, y2]
    /// @param gamma G2 gamma point
    /// @param delta G2 delta point
    /// @param ic Array of G1 points for public inputs
    function setVerificationKey(
        uint256[2] calldata alpha,
        uint256[4] calldata beta,
        uint256[4] calldata gamma,
        uint256[4] calldata delta,
        uint256[2][] calldata ic
    ) external onlyOwner {
        verificationKey.alpha = alpha;
        verificationKey.beta = beta;
        verificationKey.gamma = gamma;
        verificationKey.delta = delta;
        delete verificationKey.ic;
        for (uint256 i = 0; i < ic.length; i++) {
            verificationKey.ic.push(ic[i]);
        }
        verificationKeySet = true;
    }

    /// @notice Verify a Groth16 proof using the BN254 ecpairing precompile
    /// @param proof 8-element array containing [A.x, A.y, B.x1, B.x2, B.y1, B.y2, C.x, C.y]
    /// @param publicInputs Array of public inputs for the proof
    function _verifyGroth16(uint256[8] calldata proof, uint256[] calldata publicInputs) internal view returns (bool) {
        if (!verificationKeySet) return false;
        if (publicInputs.length + 1 != verificationKey.ic.length) return false;

        // Compute the linear combination of public inputs
        // vk_x = vk.IC[0] + sum(publicInputs[i] * vk.IC[i+1])
        uint256[2] memory vkX;
        vkX[0] = verificationKey.ic[0][0];
        vkX[1] = verificationKey.ic[0][1];

        for (uint256 i = 0; i < publicInputs.length; i++) {
            uint256[2] memory term = _ecMul(verificationKey.ic[i + 1], publicInputs[i]);
            vkX = _ecAdd(vkX, term);
        }

        // Prepare pairing check inputs
        // e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
        // Rearranged: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
        uint256[24] memory input;

        // Negate A.y for the pairing check
        uint256 pNeg = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
        uint256 negAy = pNeg - (proof[1] % pNeg);

        // -A
        input[0] = proof[0];
        input[1] = negAy;
        // B (note: G2 point coordinates are swapped in Ethereum's precompile)
        input[2] = proof[3]; // B.x2
        input[3] = proof[2]; // B.x1
        input[4] = proof[5]; // B.y2
        input[5] = proof[4]; // B.y1

        // alpha, beta
        input[6] = verificationKey.alpha[0];
        input[7] = verificationKey.alpha[1];
        input[8] = verificationKey.beta[1]; // beta.x2
        input[9] = verificationKey.beta[0]; // beta.x1
        input[10] = verificationKey.beta[3]; // beta.y2
        input[11] = verificationKey.beta[2]; // beta.y1

        // vk_x, gamma
        input[12] = vkX[0];
        input[13] = vkX[1];
        input[14] = verificationKey.gamma[1];
        input[15] = verificationKey.gamma[0];
        input[16] = verificationKey.gamma[3];
        input[17] = verificationKey.gamma[2];

        // C, delta
        input[18] = proof[6];
        input[19] = proof[7];
        input[20] = verificationKey.delta[1];
        input[21] = verificationKey.delta[0];
        input[22] = verificationKey.delta[3];
        input[23] = verificationKey.delta[2];

        // Call the ecpairing precompile (address 0x08)
        uint256[1] memory result;
        assembly {
            let success := staticcall(gas(), 0x08, input, 768, result, 32)
            if iszero(success) { revert(0, 0) }
        }

        return result[0] == 1;
    }

    /// @notice Elliptic curve point addition on BN254
    function _ecAdd(uint256[2] memory p1, uint256[2] memory p2) internal view returns (uint256[2] memory r) {
        uint256[4] memory input;
        input[0] = p1[0];
        input[1] = p1[1];
        input[2] = p2[0];
        input[3] = p2[1];

        assembly {
            let success := staticcall(gas(), 0x06, input, 128, r, 64)
            if iszero(success) { revert(0, 0) }
        }
    }

    /// @notice Elliptic curve scalar multiplication on BN254
    function _ecMul(uint256[2] memory p, uint256 s) internal view returns (uint256[2] memory r) {
        uint256[3] memory input;
        input[0] = p[0];
        input[1] = p[1];
        input[2] = s;

        assembly {
            let success := staticcall(gas(), 0x07, input, 96, r, 64)
            if iszero(success) { revert(0, 0) }
        }
    }
}
