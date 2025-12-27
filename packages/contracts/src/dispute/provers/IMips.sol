// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IMIPS
 * @notice Interface for the MIPS VM contract used in Cannon fraud proofs.
 * @dev Based on Optimism's MIPS.sol from optimism contracts-bedrock
 *
 * The MIPS VM executes MIPS instructions to verify state transitions.
 * It uses a PreimageOracle for loading external data during execution.
 *
 * For Decentralized integration:
 * 1. Deploy MIPS.sol from Optimism monorepo
 * 2. Deploy PreimageOracle.sol
 * 3. Update CannonProver to use real MIPS address
 * 4. Configure op-challenger with Cannon binary
 */
interface IMIPS {
    /// @notice Executes a single MIPS instruction and returns the post-state hash.
    /// @param _stateData The encoded MIPS state before execution.
    /// @param _proof The proof data for memory accesses.
    /// @param _localContext Context hash for preimage oracle lookups.
    /// @return The post-state hash after executing the instruction.
    function step(bytes calldata _stateData, bytes calldata _proof, bytes32 _localContext) external returns (bytes32);

    /// @notice Returns the address of the PreimageOracle used by this MIPS VM.
    function oracle() external view returns (address);
}

/**
 * @title IPreimageOracle
 * @notice Interface for the PreimageOracle used by MIPS VM.
 * @dev Stores and retrieves preimages by their keccak256 hash.
 *
 * Preimages are loaded into the oracle before MIPS execution,
 * then read during execution via oracle lookups.
 */
interface IPreimageOracle {
    /// @notice Reads a preimage from the oracle.
    /// @param _key The keccak256 hash of the preimage.
    /// @param _offset The offset within the preimage to read.
    /// @return dat_ The 32-byte word at the given offset.
    /// @return datLen_ The total length of the preimage.
    function readPreimage(bytes32 _key, uint256 _offset) external view returns (bytes32 dat_, uint256 datLen_);

    /// @notice Loads local data into the oracle for a specific context.
    /// @param _ident The identifier for the local data.
    /// @param _localContext The context hash for this data.
    /// @param _word The 32-byte word to store.
    /// @param _size The size of the data in bytes (1-32).
    /// @param _partOffset The offset within the preimage being loaded.
    /// @return key_ The key under which the data was stored.
    function loadLocalData(uint256 _ident, bytes32 _localContext, bytes32 _word, uint256 _size, uint256 _partOffset)
        external
        returns (bytes32 key_);

    /// @notice Loads a keccak256 preimage into the oracle.
    /// @param _partOffset The offset of this part within the full preimage.
    /// @param _preimage The preimage bytes to load.
    /// @return key_ The keccak256 hash of the full preimage.
    /// @return partOffset_ The offset used for this load.
    function loadKeccak256PreimagePart(uint256 _partOffset, bytes calldata _preimage)
        external
        returns (bytes32 key_, uint256 partOffset_);

    /// @notice Loads a sha256 preimage into the oracle.
    /// @param _partOffset The offset of this part within the full preimage.
    /// @param _preimage The preimage bytes to load.
    /// @return key_ The sha256 hash of the full preimage.
    /// @return partOffset_ The offset used for this load.
    function loadSha256PreimagePart(uint256 _partOffset, bytes calldata _preimage)
        external
        returns (bytes32 key_, uint256 partOffset_);

    /// @notice Loads a blob preimage into the oracle.
    /// @param _z The point to evaluate.
    /// @param _y The claimed evaluation.
    /// @param _commitment The KZG commitment.
    /// @param _proof The KZG proof.
    /// @param _partOffset The offset of this part within the full preimage.
    function loadBlobPreimagePart(
        uint256 _z,
        uint256 _y,
        bytes calldata _commitment,
        bytes calldata _proof,
        uint256 _partOffset
    ) external;
}

/**
 * @title DisputeTypes
 * @notice Common types used in Optimism's dispute game system.
 */
library DisputeTypes {
    /// @notice The maximum depth of the game tree.
    uint256 constant MAX_GAME_DEPTH = 73;

    /// @notice The duration of the game (7 days for Decentralized).
    uint256 constant GAME_DURATION = 7 days;

    /// @notice The absolute prestate hash (genesis state).
    bytes32 constant ABSOLUTE_PRESTATE = bytes32(0);

    /// @notice Enum for claim positions in the bisection game.
    enum Position {
        ROOT,
        LEFT,
        RIGHT
    }

    /// @notice Struct for a claim in the bisection game.
    struct ClaimData {
        uint32 parentIndex;
        address counteredBy;
        address claimant;
        uint128 bond;
        bytes32 claim;
        Position position;
        Clock clock;
    }

    /// @notice Struct for tracking game time.
    struct Clock {
        uint64 duration;
        uint64 timestamp;
    }
}
