// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IOracleNetworkConnector
/// @notice Interface for oracle network connector - tracks operator performance
interface IOracleNetworkConnector {
    function recordReportSubmission(bytes32 operatorId, bool accepted) external;
    function recordDisputeOutcome(bytes32 operatorId, bool lost) external;
    function recordHeartbeat(bytes32 operatorId) external;
    function workerToOperator(address worker) external view returns (bytes32);
}
