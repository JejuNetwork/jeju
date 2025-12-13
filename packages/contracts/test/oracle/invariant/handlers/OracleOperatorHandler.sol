// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../../src/oracle/ReportVerifier.sol";
import {TWAPLibrary} from "../../../../src/oracle/TWAPLibrary.sol";
import {IFeedRegistry} from "../../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../../../src/oracle/interfaces/IReportVerifier.sol";

/// @title OracleOperatorHandler
/// @notice Handler for simulating oracle operator actions in invariant tests
contract OracleOperatorHandler is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;

    // Operator state
    uint256[] public operatorPks;
    address[] public operators;
    uint256 public numOperators;

    // Feed state
    bytes32[] public feedIds;
    mapping(bytes32 => uint256) public feedRounds;
    mapping(bytes32 => uint256) public feedPrices;

    // Metrics
    uint256 public totalReportsSubmitted;
    uint256 public totalReportsAccepted;
    uint256 public totalReportsRejected;

    // Ghost variables for invariant checking
    mapping(bytes32 => uint256) public ghost_lastUpdateTime;
    mapping(bytes32 => uint256) public ghost_lastPrice;
    uint256 public ghost_maxPriceDeviation;

    constructor(
        FeedRegistry _registry,
        ReportVerifier _verifier,
        uint256 _numOperators
    ) {
        registry = _registry;
        verifier = _verifier;
        numOperators = _numOperators;

        // Create operators
        for (uint256 i = 1; i <= _numOperators; i++) {
            uint256 pk = i * 0x1111;
            operatorPks.push(pk);
            operators.push(vm.addr(pk));
        }
    }

    function addFeed(bytes32 feedId) external {
        feedIds.push(feedId);
        feedRounds[feedId] = 0;
        feedPrices[feedId] = 2000e8; // Initial price
    }

    /// @notice Submit a price report with random parameters
    function submitReport(
        uint256 feedIndex,
        uint256 priceDeviation,
        uint256 numSigners
    ) external {
        if (feedIds.length == 0) return;

        feedIndex = bound(feedIndex, 0, feedIds.length - 1);
        priceDeviation = bound(priceDeviation, 0, 1500); // Max 15% deviation
        numSigners = bound(numSigners, 1, operators.length);

        bytes32 feedId = feedIds[feedIndex];
        uint256 currentPrice = feedPrices[feedId];
        uint256 newRound = feedRounds[feedId] + 1;

        // Calculate new price with deviation
        bool increase = uint256(keccak256(abi.encodePacked(block.timestamp, feedIndex))) % 2 == 0;
        uint256 deviation = (currentPrice * priceDeviation) / 10000;
        uint256 newPrice = increase ? currentPrice + deviation : currentPrice - deviation;

        // Create report
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: newPrice,
            confidence: 100,
            timestamp: block.timestamp,
            round: newRound,
            sourcesHash: keccak256(abi.encodePacked("sources", newRound))
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        // Sign with operators
        bytes[] memory signatures = new bytes[](numSigners);
        for (uint256 i = 0; i < numSigners; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                operatorPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        totalReportsSubmitted++;

        bool accepted = verifier.submitReport(submission);
        
        if (accepted) {
            totalReportsAccepted++;
            feedRounds[feedId] = newRound;
            
            if (feedPrices[feedId] > 0) {
                uint256 actualDeviation = TWAPLibrary.calculateDeviation(feedPrices[feedId], newPrice);
                if (actualDeviation > ghost_maxPriceDeviation) {
                    ghost_maxPriceDeviation = actualDeviation;
                }
            }
            
            feedPrices[feedId] = newPrice;
            ghost_lastUpdateTime[feedId] = block.timestamp;
            ghost_lastPrice[feedId] = newPrice;
        } else {
            totalReportsRejected++;
        }
    }

    /// @notice Simulate time passage (affects staleness)
    function advanceTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 7200); // Max 2 hours
        vm.warp(block.timestamp + seconds_);
    }

    /// @notice Submit batch of reports
    function submitBatchReports(uint256 batchSize) external {
        batchSize = bound(batchSize, 1, feedIds.length);

        for (uint256 i = 0; i < batchSize; i++) {
            this.submitReport(i, 100, 3); // 1% deviation, 3 signers
        }
    }

    // ==================== View Functions ====================

    function getAcceptanceRate() external view returns (uint256) {
        if (totalReportsSubmitted == 0) return 0;
        return (totalReportsAccepted * 10000) / totalReportsSubmitted;
    }

    function getOperator(uint256 index) external view returns (address, uint256) {
        require(index < operators.length, "Index out of bounds");
        return (operators[index], operatorPks[index]);
    }

    function getFeedCount() external view returns (uint256) {
        return feedIds.length;
    }

    function _calculateDeviation(uint256 oldPrice, uint256 newPrice) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        uint256 diff = oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice;
        return (diff * 10000) / oldPrice;
    }
}
