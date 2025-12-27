// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "../sequencer/SequencerRegistry.sol";
import "../dispute/DisputeGameFactory.sol";
import "../da/DACommitmentVerifier.sol";
import "../da/CalldataFallback.sol";

/// @notice Adapter to integrate SequencerRegistry with L2OutputOracle for Decentralized
contract L2OutputOracleAdapter {
    SequencerRegistry public immutable sequencerRegistry;
    DisputeGameFactory public immutable disputeGameFactory;
    address public immutable l2OutputOracle;
    address public owner;

    // DA Commitment verification
    DACommitmentVerifier public daCommitmentVerifier;
    CalldataFallback public calldataFallback;

    // Output with DA commitment
    struct Output {
        bytes32 outputRoot;
        uint256 timestamp;
        uint256 l2BlockNumber;
        bytes32 daCommitment; // Required DA commitment
        bool daVerified; // Has DA been verified
        bool isCalldataFallback; // True if using calldata fallback
    }

    mapping(bytes32 => bool) public challengedOutputs;
    mapping(bytes32 => Output) private _outputs;
    mapping(uint256 => bytes32) private _outputRootByIndex;
    uint256 public outputDeletedCount;
    uint256 public outputCount;

    event OutputChallenged(bytes32 indexed outputRoot, uint256 indexed outputIndex, address indexed challenger);
    event OutputDeleted(bytes32 indexed outputRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OutputProposed(
        bytes32 indexed outputRoot, uint256 indexed l2BlockNumber, bytes32 indexed daCommitment, bool isCalldataFallback
    );
    event DAVerified(bytes32 indexed outputRoot, bytes32 indexed daCommitment);
    event DAVerifierSet(address indexed verifier);
    event CalldataFallbackSet(address indexed fallback_);

    error NotOwner();
    error OutputAlreadyChallenged();
    error OutputNotChallenged();
    error NotAuthorizedSequencer();
    error DACommitmentRequired();
    error DAVerificationFailed();
    error OutputNotFound();
    error InvalidDAProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedSequencer() {
        if (!sequencerRegistry.isActiveSequencer(msg.sender)) revert NotAuthorizedSequencer();
        _;
    }

    constructor(address payable _sequencerRegistry, address payable _disputeGameFactory, address _l2OutputOracle) {
        sequencerRegistry = SequencerRegistry(payable(_sequencerRegistry));
        disputeGameFactory = DisputeGameFactory(_disputeGameFactory);
        l2OutputOracle = _l2OutputOracle;
        owner = msg.sender;
    }

    // ============ Output Proposal ============

    /**
     * @notice Propose a new output with DA commitment
     * @param _outputRoot The L2 output root
     * @param _l2BlockNumber The L2 block number
     * @param _daCommitment The DA commitment (blob ID or calldata hash)
     * @param _daProof Proof linking output to DA commitment
     */
    function proposeOutput(bytes32 _outputRoot, uint256 _l2BlockNumber, bytes32 _daCommitment, bytes calldata _daProof)
        external
        onlyAuthorizedSequencer
    {
        if (_daCommitment == bytes32(0)) revert DACommitmentRequired();

        bool isCalldata = false;
        bool verified = false;

        // Verify DA commitment
        if (address(daCommitmentVerifier) != address(0)) {
            IDACommitmentVerifier.DACommitment memory commitment = IDACommitmentVerifier.DACommitment({
                blobId: _daCommitment,
                commitment: _daCommitment,
                merkleRoot: bytes32(0),
                submittedAt: block.timestamp,
                isCalldata: false
            });

            verified = daCommitmentVerifier.verifyCommitment(_outputRoot, commitment, _daProof);

            // If DA verification fails, check calldata fallback
            if (!verified && address(calldataFallback) != address(0)) {
                if (calldataFallback.blobExists(_daCommitment)) {
                    isCalldata = true;
                    verified = true;
                }
            }
        } else {
            // No verifier set - accept commitment but mark as unverified
            verified = false;
        }

        _outputs[_outputRoot] = Output({
            outputRoot: _outputRoot,
            timestamp: block.timestamp,
            l2BlockNumber: _l2BlockNumber,
            daCommitment: _daCommitment,
            daVerified: verified,
            isCalldataFallback: isCalldata
        });

        _outputRootByIndex[outputCount] = _outputRoot;
        outputCount++;

        // Register commitment with verifier
        if (address(daCommitmentVerifier) != address(0)) {
            IDACommitmentVerifier.DACommitment memory regCommitment = IDACommitmentVerifier.DACommitment({
                blobId: _daCommitment,
                commitment: _daCommitment,
                merkleRoot: bytes32(0),
                submittedAt: block.timestamp,
                isCalldata: isCalldata
            });
            daCommitmentVerifier.registerCommitment(_outputRoot, regCommitment);
        }

        emit OutputProposed(_outputRoot, _l2BlockNumber, _daCommitment, isCalldata);
    }

    /**
     * @notice Post output data to calldata fallback
     * @param _batchData The batch data to store
     */
    function postCalldataFallback(bytes calldata _batchData)
        external
        payable
        onlyAuthorizedSequencer
        returns (bytes32)
    {
        if (address(calldataFallback) == address(0)) revert DAVerificationFailed();

        return calldataFallback.postCalldata{value: msg.value}(_batchData);
    }

    // ============ Sequencer Functions ============

    function isAuthorizedSequencer(address proposer) external view returns (bool) {
        return sequencerRegistry.isActiveSequencer(proposer);
    }

    function getSequencerWeight(address sequencer) external view returns (uint256) {
        return sequencerRegistry.getSelectionWeight(sequencer);
    }

    function getActiveSequencers() external view returns (address[] memory, uint256[] memory) {
        return sequencerRegistry.getActiveSequencers();
    }

    // ============ Challenge Functions ============

    function challengeOutput(
        uint256 outputIndex,
        bytes32 outputRoot,
        bytes32 correctRoot,
        DisputeGameFactory.GameType gameType,
        DisputeGameFactory.ProverType proverType
    ) external payable returns (bytes32 gameId) {
        if (challengedOutputs[outputRoot]) revert OutputAlreadyChallenged();

        gameId = disputeGameFactory.createGame{value: msg.value}(
            address(0), // Proposer tracked separately
            outputRoot,
            correctRoot,
            gameType,
            proverType
        );

        challengedOutputs[outputRoot] = true;
        emit OutputChallenged(outputRoot, outputIndex, msg.sender);
    }

    /**
     * @notice Challenge output for DA unavailability
     */
    function challengeDAUnavailability(bytes32 outputRoot) external payable {
        Output storage output = _outputs[outputRoot];
        if (output.timestamp == 0) revert OutputNotFound();
        if (challengedOutputs[outputRoot]) revert OutputAlreadyChallenged();

        if (address(daCommitmentVerifier) != address(0)) {
            daCommitmentVerifier.challengeUnavailability{value: msg.value}(outputRoot, output.daCommitment);
        }

        challengedOutputs[outputRoot] = true;
        emit OutputChallenged(outputRoot, 0, msg.sender);
    }

    function markOutputDeleted(bytes32 outputRoot) external onlyOwner {
        if (!challengedOutputs[outputRoot]) revert OutputNotChallenged();
        outputDeletedCount++;
        emit OutputDeleted(outputRoot);
    }

    // ============ View Functions ============

    /**
     * @notice Get output details
     */
    function getOutput(bytes32 outputRoot) external view returns (Output memory) {
        return _outputs[outputRoot];
    }

    /**
     * @notice Get output by index
     */
    function getOutputByIndex(uint256 index) external view returns (Output memory) {
        bytes32 outputRoot = _outputRootByIndex[index];
        return _outputs[outputRoot];
    }

    /**
     * @notice Check if output has valid DA commitment
     */
    function hasValidDACommitment(bytes32 outputRoot) external view returns (bool) {
        Output storage output = _outputs[outputRoot];
        if (output.timestamp == 0) return false;
        if (challengedOutputs[outputRoot]) return false;
        return output.daVerified || output.isCalldataFallback;
    }

    /// @notice Gets the output root at a specific index from the L2OutputOracle
    /// @param _outputIndex The index of the output to retrieve
    /// @return outputRoot The output root at the given index
    /// @return timestamp The timestamp when the output was proposed
    /// @return l2BlockNumber The L2 block number for this output
    function getOutputRootAt(uint256 _outputIndex)
        external
        view
        returns (bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber)
    {
        // Call the L2OutputOracle to get the output proposal
        (bool success, bytes memory data) =
            l2OutputOracle.staticcall(abi.encodeWithSignature("getL2Output(uint256)", _outputIndex));
        require(success, "L2OutputOracle call failed");

        // Decode the OutputProposal struct
        (outputRoot, timestamp, l2BlockNumber) = abi.decode(data, (bytes32, uint128, uint128));
    }

    /// @notice Verifies a withdrawal proof against an output root
    /// @param _outputIndex The index of the output to verify against
    /// @param _withdrawalHash The hash of the withdrawal to verify
    /// @param _storageRoot The message passer storage root from the output
    /// @param _proof The Merkle proof of inclusion
    /// @return valid True if the proof is valid
    function verifyWithdrawalProof(
        uint256 _outputIndex,
        bytes32 _withdrawalHash,
        bytes32 _storageRoot,
        bytes32[] calldata _proof
    ) external view returns (bool valid) {
        // Get the output root at the index
        (bool success, bytes memory data) =
            l2OutputOracle.staticcall(abi.encodeWithSignature("getL2Output(uint256)", _outputIndex));
        if (!success) return false;

        (bytes32 outputRoot,,) = abi.decode(data, (bytes32, uint128, uint128));
        if (outputRoot == bytes32(0)) return false;
        if (challengedOutputs[outputRoot]) return false;

        // Compute the storage key for the withdrawal hash
        bytes32 storageKey = keccak256(abi.encode(_withdrawalHash, uint256(1)));

        // Verify the Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(storageKey, bytes32(uint256(1))));
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < _proof.length; i++) {
            bytes32 proofElement = _proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == _storageRoot;
    }

    // ============ Admin ============

    function setDACommitmentVerifier(address _verifier) external onlyOwner {
        daCommitmentVerifier = DACommitmentVerifier(_verifier);
        emit DAVerifierSet(_verifier);
    }

    function setCalldataFallback(address _fallback) external onlyOwner {
        calldataFallback = CalldataFallback(_fallback);
        emit CalldataFallbackSet(_fallback);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
