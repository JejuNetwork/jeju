// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {DisputeGame} from "../../../../src/oracle/DisputeGame.sol";
import {ReportVerifier} from "../../../../src/oracle/ReportVerifier.sol";
import {FeedRegistry} from "../../../../src/oracle/FeedRegistry.sol";

/// @title Dispute Handler for Invariant Tests
/// @notice Handler for dispute game invariant tests
contract DisputeHandler is Test {
    DisputeGame public disputeGame;
    ReportVerifier public verifier;
    FeedRegistry public registry;
    bytes32 public feedId;
    address public owner;

    uint256 public disputesOpened;
    uint256 public disputesResolved;

    constructor(
        DisputeGame _disputeGame,
        ReportVerifier _verifier,
        FeedRegistry _registry,
        bytes32 _feedId,
        address _owner
    ) {
        disputeGame = _disputeGame;
        verifier = _verifier;
        registry = _registry;
        feedId = _feedId;
        owner = _owner;
    }

    // Add handler functions as needed
}
