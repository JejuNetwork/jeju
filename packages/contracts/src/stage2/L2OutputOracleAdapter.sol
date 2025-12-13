// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./SequencerRegistry.sol";
import "./DisputeGameFactory.sol";

/// @notice Adapter to integrate SequencerRegistry with L2OutputOracle for Stage 2
contract L2OutputOracleAdapter {
    SequencerRegistry public immutable sequencerRegistry;
    DisputeGameFactory public immutable disputeGameFactory;
    address public immutable l2OutputOracle;
    address public owner;

    mapping(bytes32 => bool) public challengedOutputs;
    uint256 public outputDeletedCount;

    event OutputChallenged(bytes32 indexed outputRoot, uint256 indexed outputIndex, address indexed challenger);
    event OutputDeleted(bytes32 indexed outputRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error OutputAlreadyChallenged();
    error OutputNotChallenged();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _sequencerRegistry, address payable _disputeGameFactory, address _l2OutputOracle) {
        sequencerRegistry = SequencerRegistry(_sequencerRegistry);
        disputeGameFactory = DisputeGameFactory(_disputeGameFactory);
        l2OutputOracle = _l2OutputOracle;
        owner = msg.sender;
    }

    function isAuthorizedSequencer(address proposer) external view returns (bool) {
        return sequencerRegistry.isActiveSequencer(proposer);
    }

    function getSequencerWeight(address sequencer) external view returns (uint256) {
        return sequencerRegistry.getSelectionWeight(sequencer);
    }

    function getActiveSequencers() external view returns (address[] memory, uint256[] memory) {
        return sequencerRegistry.getActiveSequencers();
    }

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

    function markOutputDeleted(bytes32 outputRoot) external onlyOwner {
        if (!challengedOutputs[outputRoot]) revert OutputNotChallenged();
        outputDeletedCount++;
        emit OutputDeleted(outputRoot);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
