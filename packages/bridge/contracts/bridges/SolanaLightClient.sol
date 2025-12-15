// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISolanaLightClient.sol";
import "../interfaces/IGroth16Verifier.sol";
import "../libraries/SolanaTypes.sol";

/**
 * @title SolanaLightClient
 * @notice Trustless Solana light client verified by ZK proofs
 * @dev Maintains verified Solana state using SP1 proofs of consensus
 *
 * The light client tracks:
 * - Latest verified slot and bank hash
 * - Current epoch and validator stakes
 * - Historical bank hashes for proof verification
 *
 * State updates require a ZK proof showing supermajority (2/3) of stake
 * voted for the new bank hash.
 */
contract SolanaLightClient is ISolanaLightClient {
    using SolanaTypes for SolanaTypes.Slot;
    using SolanaTypes for SolanaTypes.Epoch;
    using SolanaTypes for SolanaTypes.Pubkey;

    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice The Groth16 verifier for consensus proofs
    IGroth16Verifier public immutable verifier;

    /// @notice Latest verified slot
    uint64 public latestSlot;

    /// @notice Bank hash at latest slot
    bytes32 public latestBankHash;

    /// @notice Current epoch
    uint64 public currentEpoch;

    /// @notice Current epoch stakes merkle root
    bytes32 public epochStakesRoot;

    /// @notice Total stake in current epoch
    uint64 public totalStake;

    /// @notice Number of successful state updates
    uint256 public updateCount;

    /// @notice Minimum slot advancement per update (prevents spam)
    uint64 public constant MIN_SLOT_ADVANCE = 32;

    /// @notice Maximum slots we store for historical verification
    uint256 public constant MAX_HISTORICAL_SLOTS = 1000;

    /// @notice Historical bank hashes: slot -> bankHash
    mapping(uint64 => bytes32) public bankHashes;

    /// @notice Slots that have been verified
    mapping(uint64 => bool) public verifiedSlots;

    /// @notice Admin for initial setup
    address public admin;

    /// @notice Whether the light client is initialized
    bool public initialized;

    // =============================================================================
    // ERRORS
    // =============================================================================

    error NotInitialized();
    error AlreadyInitialized();
    error InvalidProof();
    error SlotTooOld();
    error SlotNotAdvanced();
    error InvalidEpochTransition();
    error OnlyAdmin();

    // =============================================================================
    // MODIFIERS
    // =============================================================================

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    constructor(address _verifier) {
        verifier = IGroth16Verifier(_verifier);
        admin = msg.sender;
    }

    // =============================================================================
    // INITIALIZATION
    // =============================================================================

    /**
     * @notice Initialize the light client with a trusted state
     * @dev Called once to bootstrap the light client
     * @param _slot Initial slot
     * @param _bankHash Initial bank hash
     * @param _epoch Initial epoch
     * @param _epochStakesRoot Initial stakes root
     * @param _totalStake Total stake in epoch
     */
    function initialize(
        uint64 _slot,
        bytes32 _bankHash,
        uint64 _epoch,
        bytes32 _epochStakesRoot,
        uint64 _totalStake
    ) external onlyAdmin {
        if (initialized) revert AlreadyInitialized();

        latestSlot = _slot;
        latestBankHash = _bankHash;
        currentEpoch = _epoch;
        epochStakesRoot = _epochStakesRoot;
        totalStake = _totalStake;

        bankHashes[_slot] = _bankHash;
        verifiedSlots[_slot] = true;

        initialized = true;

        emit StateUpdated(_slot, _bankHash, _epoch, _epochStakesRoot);
    }

    // =============================================================================
    // STATE UPDATES
    // =============================================================================

    /**
     * @notice Update the light client with a new verified Solana state
     * @param slot New slot number
     * @param bankHash Bank hash at the new slot
     * @param newEpochStakesRoot New epoch stakes root (if epoch changed)
     * @param proof Groth16 proof (packed as 8 uint256s)
     * @param publicInputs Public inputs for verification
     */
    function updateState(
        uint64 slot,
        bytes32 bankHash,
        bytes32 newEpochStakesRoot,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external override onlyInitialized {
        // Validate slot advancement
        if (slot <= latestSlot) revert SlotTooOld();
        if (slot < latestSlot + MIN_SLOT_ADVANCE) revert SlotNotAdvanced();

        // Unpack proof
        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];

        // Verify the ZK proof
        // Public inputs encode:
        // [0] = previous slot
        // [1] = previous bank hash (as uint256)
        // [2] = new slot
        // [3] = new bank hash (as uint256)
        // [4] = epoch stakes root (as uint256)
        // [5] = total stake
        // [6] = voting stake (must be >= 2/3 * total stake)
        if (!verifier.verifyProof(a, b, c, publicInputs)) {
            revert InvalidProof();
        }

        // Validate public inputs match our state
        require(publicInputs[0] == latestSlot, "Previous slot mismatch");
        require(bytes32(publicInputs[1]) == latestBankHash, "Previous hash mismatch");
        require(publicInputs[2] == slot, "New slot mismatch");
        require(bytes32(publicInputs[3]) == bankHash, "New hash mismatch");

        // Check supermajority
        uint256 votingStake = publicInputs[6];
        uint256 requiredStake = (uint256(totalStake) * 2) / 3;
        require(votingStake >= requiredStake, "Insufficient voting stake");

        // Update epoch if changed
        uint64 newEpoch = uint64(slot / 432000);
        if (newEpoch > currentEpoch) {
            require(newEpochStakesRoot != bytes32(0), "Must provide new stakes root");
            currentEpoch = newEpoch;
            epochStakesRoot = newEpochStakesRoot;
            totalStake = uint64(publicInputs[5]);

            emit EpochStakesUpdated(newEpoch, newEpochStakesRoot, publicInputs[5]);
        }

        // Store new state
        latestSlot = slot;
        latestBankHash = bankHash;
        bankHashes[slot] = bankHash;
        verifiedSlots[slot] = true;
        updateCount++;

        emit StateUpdated(slot, bankHash, newEpoch, epochStakesRoot);
    }

    // =============================================================================
    // ACCOUNT VERIFICATION
    // =============================================================================

    /**
     * @notice Verify a Solana account proof against a verified state
     * @param account Account pubkey
     * @param slot Slot at which account state was captured
     * @param data Account data
     * @param proof Merkle proof of account inclusion
     * @return valid True if proof is valid
     */
    function verifyAccountProof(
        bytes32 account,
        uint64 slot,
        bytes calldata data,
        bytes32[] calldata proof
    ) external view override onlyInitialized returns (bool valid) {
        // Check slot is verified
        if (!verifiedSlots[slot]) {
            return false;
        }

        bytes32 storedBankHash = bankHashes[slot];
        if (storedBankHash == bytes32(0)) {
            return false;
        }

        // Compute leaf hash
        bytes32 leaf = SolanaTypes.hashAccountData(SolanaTypes.toPubkey(account), data);

        // Verify merkle proof against bank hash
        // Note: In full implementation, need to extract accounts hash from bank hash
        // For now, we assume the proof is against the full bank hash
        return SolanaTypes.verifyAccountMerkleProof(leaf, proof, storedBankHash);
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    function getLatestSlot() external view override returns (uint64) {
        return latestSlot;
    }

    function getBankHash(uint64 slot) external view override returns (bytes32) {
        return bankHashes[slot];
    }

    function getCurrentEpoch() external view override returns (uint64 epoch, bytes32 stakesRoot) {
        return (currentEpoch, epochStakesRoot);
    }

    function isSlotVerified(uint64 slot) external view override returns (bool) {
        return verifiedSlots[slot];
    }

    // =============================================================================
    // ADMIN
    // =============================================================================

    /**
     * @notice Transfer admin rights
     * @param newAdmin New admin address
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        admin = newAdmin;
    }

    /**
     * @notice Update total stake (for epoch transitions without full proof)
     * @dev Only for bootstrapping/emergency; prefer updateState with proof
     */
    function updateTotalStake(uint64 _totalStake) external onlyAdmin {
        totalStake = _totalStake;
    }
}
