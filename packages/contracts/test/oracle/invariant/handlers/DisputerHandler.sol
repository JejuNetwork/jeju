// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReportVerifier} from "../../../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../../../src/oracle/DisputeGame.sol";
import {IDisputeGame} from "../../../../src/oracle/interfaces/IDisputeGame.sol";

/// @title DisputerHandler
/// @notice Handler for simulating disputer actions in invariant tests
contract DisputerHandler is Test {
    ReportVerifier public verifier;
    DisputeGame public disputeGame;

    // Disputer addresses
    address[] public disputers;

    // Tracked disputes
    bytes32[] public openDisputes;
    bytes32[] public resolvedDisputes;

    // Metrics
    uint256 public totalDisputesOpened;
    uint256 public totalDisputesChallenged;
    uint256 public totalDisputesResolved;
    uint256 public totalDisputesExpired;
    uint256 public totalBondsPaid;
    uint256 public totalRewardsEarned;

    // Ghost variables
    uint256 public ghost_maxConcurrentDisputes;
    uint256 public ghost_avgDisputeTime;

    constructor(ReportVerifier _verifier, DisputeGame _disputeGame, uint256 numDisputers) {
        verifier = _verifier;
        disputeGame = _disputeGame;

        // Create disputers with ETH
        for (uint256 i = 0; i < numDisputers; i++) {
            address disputer = address(uint160(0x5000 + i));
            disputers.push(disputer);
            vm.deal(disputer, 1000 ether);
        }
    }

    /// @notice Open a dispute on a processed report
    function openDispute(uint256 disputerIndex, bytes32 reportHash, uint256 bondAmount) external {
        if (disputers.length == 0) return;
        
        disputerIndex = bound(disputerIndex, 0, disputers.length - 1);
        bondAmount = bound(bondAmount, 100 ether, 500 ether);

        address disputer = disputers[disputerIndex];

        if (disputer.balance < bondAmount) return;
        if (!verifier.isReportProcessed(reportHash)) return;

        // Check if already disputed
        bytes32[] memory activeDisputes = disputeGame.getActiveDisputes();
        for (uint256 i = 0; i < activeDisputes.length; i++) {
            IDisputeGame.Dispute memory d = disputeGame.getDispute(activeDisputes[i]);
            if (d.reportHash == reportHash) return;
        }

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: bondAmount}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );
        
        openDisputes.push(disputeId);
        totalDisputesOpened++;
        totalBondsPaid += bondAmount;

        if (openDisputes.length > ghost_maxConcurrentDisputes) {
            ghost_maxConcurrentDisputes = openDisputes.length;
        }
    }

    /// @notice Challenge an open dispute
    function challengeDispute(uint256 disputeIndex, uint256 challengerIndex) external {
        if (openDisputes.length == 0 || disputers.length == 0) return;

        disputeIndex = bound(disputeIndex, 0, openDisputes.length - 1);
        challengerIndex = bound(challengerIndex, 0, disputers.length - 1);

        bytes32 disputeId = openDisputes[disputeIndex];
        address challenger = disputers[challengerIndex];

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        
        if (dispute.status != IDisputeGame.DisputeStatus.OPEN) return;
        if (challenger.balance < dispute.bond) return;

        vm.prank(challenger);
        disputeGame.challengeDispute{value: dispute.bond}(disputeId);
        totalDisputesChallenged++;
    }

    /// @notice Attempt to expire old disputes
    function expireDispute(uint256 disputeIndex) external {
        if (openDisputes.length == 0) return;

        disputeIndex = bound(disputeIndex, 0, openDisputes.length - 1);
        bytes32 disputeId = openDisputes[disputeIndex];

        disputeGame.expireDispute(disputeId);
        totalDisputesExpired++;
        _removeFromOpen(disputeIndex);
        resolvedDisputes.push(disputeId);
    }

    /// @notice Advance time (affects dispute deadlines)
    function advanceTime(uint256 hours_) external {
        hours_ = bound(hours_, 1, 96); // Max 4 days
        vm.warp(block.timestamp + hours_ * 1 hours);
    }

    /// @notice Process all expirable disputes
    function processExpiredDisputes() external {
        for (uint256 i = openDisputes.length; i > 0; i--) {
            bytes32 disputeId = openDisputes[i - 1];
            IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);

            if (block.timestamp >= dispute.deadline) {
                disputeGame.expireDispute(disputeId);
                totalDisputesExpired++;
                _removeFromOpen(i - 1);
                resolvedDisputes.push(disputeId);
            }
        }
    }

    // ==================== View Functions ====================

    function getOpenDisputeCount() external view returns (uint256) {
        return openDisputes.length;
    }

    function getResolvedDisputeCount() external view returns (uint256) {
        return resolvedDisputes.length;
    }

    function getDisputeRate() external view returns (uint256) {
        if (totalDisputesOpened == 0) return 0;
        return (totalDisputesResolved * 10000) / totalDisputesOpened;
    }

    function _removeFromOpen(uint256 index) internal {
        if (index >= openDisputes.length) return;
        openDisputes[index] = openDisputes[openDisputes.length - 1];
        openDisputes.pop();
    }

    receive() external payable {}
}
