// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IStage2Contracts
 * @notice Interfaces for Stage 2 contracts integration
 */

interface ISequencerRegistry {
    function register(uint256 _agentId, uint256 _stakeAmount) external;
    function unregister() external;
    function getActiveSequencers() external view returns (address[] memory addresses, uint256[] memory weights);
    function getSelectionWeight(address _sequencer) external view returns (uint256 weight);
    function recordBlockProposed(address _sequencer, uint256 _blockNumber) external;
    function slash(address _sequencer, uint8 _reason) external;
    function isActiveSequencer(address _sequencer) external view returns (bool);
}

interface IGovernanceTimelock {
    function proposeUpgrade(address _target, bytes calldata _data, string calldata _description) external returns (bytes32 proposalId);
    function proposeEmergencyBugfix(address _target, bytes calldata _data, string calldata _description, bytes32 _bugProof) external returns (bytes32 proposalId);
    function execute(bytes32 _proposalId) external;
    function cancel(bytes32 _proposalId) external;
    function canExecute(bytes32 _proposalId) external view returns (bool);
    function timeRemaining(bytes32 _proposalId) external view returns (uint256);
}

interface IDisputeGameFactory {
    function createGame(
        address _proposer,
        bytes32 _stateRoot,
        bytes32 _claimRoot,
        uint8 _gameType,
        uint8 _proverType
    ) external payable returns (bytes32 gameId);
    function resolveChallengerWins(bytes32 _gameId, bytes calldata _proof) external;
    function resolveProposerWins(bytes32 _gameId, bytes calldata _defenseProof) external;
    function resolveTimeout(bytes32 _gameId) external;
    function isGame(bytes32 _gameId) external view returns (bool);
    function getActiveGames() external view returns (bytes32[] memory);
}

