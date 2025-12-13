// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IL2OutputOracle
/// @notice Interface for OP Stack L2OutputOracle with Stage 2 modifications
/// @dev This interface shows what changes are needed to L2OutputOracle for Stage 2
interface IL2OutputOracle {
    struct OutputProposal {
        bytes32 outputRoot;
        uint128 timestamp;
        uint128 l2BlockNumber;
    }

    function proposeL2Output(bytes32 _outputRoot, uint256 _l2BlockNumber, bytes32 _l1BlockHash, uint256 _l1BlockNumber)
        external
        payable;

    function getL2Output(uint256 _l2OutputIndex) external view returns (OutputProposal memory);
    function latestOutputIndex() external view returns (uint256);
    function latestBlockNumber() external view returns (uint256);
    function finalizationPeriodSeconds() external view returns (uint256);
    function sequencerRegistry() external view returns (address);
}

/// @title IL2OutputOracleStage2
/// @notice Additional interface for Stage 2 specific functions
interface IL2OutputOracleStage2 {
    function isRegisteredSequencer(address sequencer) external view returns (bool);
    function deleteL2Output(uint256 _l2OutputIndex) external;

    event OutputProposed(
        bytes32 indexed outputRoot, uint256 indexed l2OutputIndex, uint256 indexed l2BlockNumber, uint256 l1Timestamp
    );
    event OutputDeleted(uint256 indexed l2OutputIndex, bytes32 indexed outputRoot);
}
