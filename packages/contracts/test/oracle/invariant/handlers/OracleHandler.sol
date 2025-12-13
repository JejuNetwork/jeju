// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../../src/oracle/ReportVerifier.sol";

/// @title Oracle Handler for Invariant Tests
/// @notice Handler for oracle reporting invariant tests
contract OracleHandler is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    bytes32 public feedId;
    address public owner;

    uint256 public reportsSubmitted;
    uint256 public reportsAccepted;
    uint256 public lastPrice;
    uint256 public lastRound;

    constructor(
        FeedRegistry _registry,
        ReportVerifier _verifier,
        bytes32 _feedId,
        address _owner
    ) {
        registry = _registry;
        verifier = _verifier;
        feedId = _feedId;
        owner = _owner;
    }

    // Add handler functions as needed
}
