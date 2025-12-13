// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IL2OutputOracle
 * @notice Interface for OP Stack L2OutputOracle contract
 * @dev Deployed on L1 to track L2 state commitments
 */
interface IL2OutputOracle {
    struct OutputProposal {
        bytes32 outputRoot;
        uint128 timestamp;
        uint128 l2BlockNumber;
    }

    /// @notice Get output proposal by index
    function getL2Output(uint256 _l2OutputIndex) external view returns (OutputProposal memory);

    /// @notice Get the index of the first output after a given block number
    function getL2OutputIndexAfter(uint256 _l2BlockNumber) external view returns (uint256);

    /// @notice Get the latest output index
    function latestOutputIndex() external view returns (uint256);

    /// @notice Get the starting block number
    function startingBlockNumber() external view returns (uint256);

    /// @notice Get the latest L2 block number committed
    function latestBlockNumber() external view returns (uint256);
}

/**
 * @title L2OutputVerifier
 * @author Jeju Network
 * @notice Verifies L2 state roots against OP Stack L2OutputOracle
 * @dev Used by L1StakeManager for automated dispute resolution
 *
 * ## How It Works:
 *
 * 1. Each OP Stack L2 (Base, Optimism, etc.) has an L2OutputOracle on L1
 * 2. The oracle stores outputRoots = keccak256(version, stateRoot, messagePasserRoot, blockHash)
 * 3. This verifier checks if a given block number has been committed to L1
 * 4. For full state verification, provers must also submit merkle proofs
 *
 * ## Output Root Structure:
 *
 * outputRoot = keccak256(abi.encode(
 *     bytes32(0),              // version
 *     stateRoot,               // MPT root of all L2 accounts
 *     messagePasserStorageRoot,// MPT root of L2→L1 message passer
 *     blockHash                // Latest L2 block hash
 * ));
 *
 * ## Verification Levels:
 *
 * 1. Block Existence: Confirms output exists for L2 block (this contract)
 * 2. Output Root Match: Verifies computed outputRoot matches oracle (requires full preimage)
 * 3. State Proof: MPT proof against stateRoot (requires separate merkle verifier)
 *
 * @custom:security-contact security@jeju.network
 */
contract L2OutputVerifier is Ownable {
    // ============ Constants ============

    /// @notice Output root version (OP Stack v1)
    bytes32 public constant OUTPUT_ROOT_VERSION = bytes32(0);

    /// @notice Minimum finality delay (7 days for optimistic rollups)
    uint256 public constant MIN_FINALITY_DELAY = 7 days;

    // ============ State Variables ============

    /// @notice L2OutputOracle addresses per chain ID
    mapping(uint256 => address) public l2OutputOracles;

    /// @notice Custom finality delays per chain (for ZK rollups)
    mapping(uint256 => uint256) public chainFinalityDelays;

    /// @notice Whether a chain uses ZK proofs (instant finality after proof)
    mapping(uint256 => bool) public isZKChain;

    /// @notice Cached output roots for gas efficiency
    mapping(bytes32 => bool) public verifiedOutputs; // keccak256(chainId, blockNumber, outputRoot) => verified

    // ============ Events ============

    event OracleRegistered(uint256 indexed chainId, address oracle, bool isZK);
    event FinalityDelayUpdated(uint256 indexed chainId, uint256 delay);
    event OutputVerified(uint256 indexed chainId, uint256 indexed blockNumber, bytes32 outputRoot);

    // ============ Errors ============

    error OracleNotRegistered();
    error BlockNotFinalized();
    error BlockNotCommitted();
    error InvalidOutputRoot();
    error InvalidProof();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin Functions ============

    /**
     * @notice Register an L2OutputOracle for a chain
     * @param chainId L2 chain ID
     * @param oracle L2OutputOracle address on L1
     * @param isZK Whether this chain uses ZK proofs
     */
    function registerOracle(uint256 chainId, address oracle, bool isZK) external onlyOwner {
        l2OutputOracles[chainId] = oracle;
        isZKChain[chainId] = isZK;

        // Set default finality delay
        if (isZK) {
            chainFinalityDelays[chainId] = 1 hours; // ZK rollups finalize quickly
        } else {
            chainFinalityDelays[chainId] = MIN_FINALITY_DELAY; // Optimistic rollups need 7 days
        }

        emit OracleRegistered(chainId, oracle, isZK);
    }

    /**
     * @notice Update finality delay for a chain
     * @param chainId L2 chain ID
     * @param delay New finality delay in seconds
     */
    function setFinalityDelay(uint256 chainId, uint256 delay) external onlyOwner {
        chainFinalityDelays[chainId] = delay;
        emit FinalityDelayUpdated(chainId, delay);
    }

    // ============ Verification Functions ============

    /**
     * @notice Verify that an output exists for a given L2 block number
     * @param chainId L2 chain ID
     * @param l2BlockNumber L2 block number to verify
     * @return exists Whether an output exists
     * @return finalized Whether the output is past finality delay
     * @return outputRoot The output root (if exists)
     */
    function verifyBlockExists(uint256 chainId, uint256 l2BlockNumber)
        external
        view
        returns (bool exists, bool finalized, bytes32 outputRoot)
    {
        address oracle = l2OutputOracles[chainId];
        if (oracle == address(0)) return (false, false, bytes32(0));

        IL2OutputOracle l2Oracle = IL2OutputOracle(oracle);

        // Check if block has been committed
        uint256 latestBlock = l2Oracle.latestBlockNumber();
        if (l2BlockNumber > latestBlock) return (false, false, bytes32(0));

        // Get the output for this block
        uint256 outputIndex = l2Oracle.getL2OutputIndexAfter(l2BlockNumber);
        IL2OutputOracle.OutputProposal memory proposal = l2Oracle.getL2Output(outputIndex);

        exists = true;
        outputRoot = proposal.outputRoot;

        // Check finality
        uint256 finalityDelay = chainFinalityDelays[chainId];
        finalized = block.timestamp >= proposal.timestamp + finalityDelay;
    }

    /**
     * @notice Verify a state root is part of a committed output
     * @param chainId L2 chain ID
     * @param l2BlockNumber L2 block number
     * @param stateRoot State root to verify
     * @param messagePasserStorageRoot Message passer storage root
     * @param blockHash L2 block hash
     * @return valid Whether the state root is valid
     * @dev Recomputes outputRoot from components and compares to oracle
     */
    function verifyStateRoot(
        uint256 chainId,
        uint256 l2BlockNumber,
        bytes32 stateRoot,
        bytes32 messagePasserStorageRoot,
        bytes32 blockHash
    ) external returns (bool valid) {
        address oracle = l2OutputOracles[chainId];
        if (oracle == address(0)) revert OracleNotRegistered();

        IL2OutputOracle l2Oracle = IL2OutputOracle(oracle);

        // Get the committed output for this block
        uint256 outputIndex = l2Oracle.getL2OutputIndexAfter(l2BlockNumber);
        IL2OutputOracle.OutputProposal memory proposal = l2Oracle.getL2Output(outputIndex);

        // Verify the block number matches
        if (proposal.l2BlockNumber < l2BlockNumber) revert BlockNotCommitted();

        // Check finality
        uint256 finalityDelay = chainFinalityDelays[chainId];
        if (block.timestamp < proposal.timestamp + finalityDelay) revert BlockNotFinalized();

        // Recompute the output root from provided components
        bytes32 computedOutputRoot =
            keccak256(abi.encode(OUTPUT_ROOT_VERSION, stateRoot, messagePasserStorageRoot, blockHash));

        // Verify against oracle
        if (computedOutputRoot != proposal.outputRoot) revert InvalidOutputRoot();

        // Cache for future queries
        bytes32 cacheKey = keccak256(abi.encodePacked(chainId, l2BlockNumber, proposal.outputRoot));
        verifiedOutputs[cacheKey] = true;

        emit OutputVerified(chainId, l2BlockNumber, proposal.outputRoot);

        return true;
    }

    /**
     * @notice Simplified verification stub for L1StakeManager compatibility
     * @dev Always returns false - full verification requires chainId and outputRoot preimage.
     *      Dispute resolution falls back to arbitrator voting.
     */
    function verifyStateRoot(bytes32, uint256) external pure returns (bool) {
        return false;
    }

    // ============ View Functions ============

    /**
     * @notice Get the L2OutputOracle for a chain
     * @param chainId L2 chain ID
     * @return oracle Oracle address
     */
    function getOracle(uint256 chainId) external view returns (address) {
        return l2OutputOracles[chainId];
    }

    /**
     * @notice Get the finality delay for a chain
     * @param chainId L2 chain ID
     * @return delay Finality delay in seconds
     */
    function getFinalityDelay(uint256 chainId) external view returns (uint256) {
        return chainFinalityDelays[chainId];
    }

    /**
     * @notice Check if an output has been verified and cached
     * @param chainId L2 chain ID
     * @param blockNumber L2 block number
     * @param outputRoot Output root to check
     * @return verified Whether this output was previously verified
     */
    function isOutputVerified(uint256 chainId, uint256 blockNumber, bytes32 outputRoot) external view returns (bool) {
        bytes32 cacheKey = keccak256(abi.encodePacked(chainId, blockNumber, outputRoot));
        return verifiedOutputs[cacheKey];
    }

    /**
     * @notice Get the latest committed block number for a chain
     * @param chainId L2 chain ID
     * @return Latest committed L2 block number (0 if oracle not registered)
     */
    function getLatestCommittedBlock(uint256 chainId) external view returns (uint256) {
        address oracle = l2OutputOracles[chainId];
        if (oracle == address(0)) return 0;
        return IL2OutputOracle(oracle).latestBlockNumber();
    }
}

