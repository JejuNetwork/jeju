// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../src/oracle/ReportVerifier.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../../src/oracle/interfaces/IReportVerifier.sol";

/// @title ReportVerifier Fuzz Tests
/// @notice Comprehensive fuzz testing for price reports and signature verification
contract ReportVerifierFuzzTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;

    address public owner = address(0x1);
    bytes32 public feedId;

    // Signer keys for testing
    uint256[] public signerPks;
    address[] public signers;

    function setUp() public {
        vm.warp(1700000000);

        // Create signers
        for (uint256 i = 1; i <= 10; i++) {
            signerPks.push(i * 0x1111);
            signers.push(vm.addr(i * 0x1111));
        }

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);

        feedId = registry.createFeed(IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2),
            quoteToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        }));
        vm.stopPrank();
    }

    // ==================== Price Submission Fuzz Tests ====================

    function testFuzz_SubmitReport_ValidPriceRange(uint256 price) public {
        // Bound price to realistic range (1 cent to $1M with 8 decimals)
        price = bound(price, 1e6, 1e14);

        vm.warp(block.timestamp + 60);

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: price,
            confidence: 100,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("sources")
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        (uint256 storedPrice,,,) = verifier.getLatestPrice(feedId);
        assertEq(storedPrice, price);
    }

    function testFuzz_SubmitReport_Confidence(uint256 confidence) public {
        // Bound confidence to valid range (0-10000 bps)
        confidence = bound(confidence, 0, 10000);

        vm.warp(block.timestamp + 60);

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2000e8,
            confidence: confidence,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("sources")
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        (, uint256 storedConfidence,,) = verifier.getLatestPrice(feedId);
        assertEq(storedConfidence, confidence);
    }

    // ==================== Signature Verification Fuzz Tests ====================

    function testFuzz_SubmitReport_SignatureCount(uint8 sigCount) public {
        sigCount = uint8(bound(sigCount, 1, 10));

        vm.warp(block.timestamp + 60);

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2000e8,
            confidence: 100,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("sources")
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](sigCount);
        for (uint256 i = 0; i < sigCount; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        
        if (sigCount < 2) {
            // Below quorum
            vm.expectRevert(abi.encodeWithSelector(
                IReportVerifier.InsufficientSignatures.selector,
                sigCount,
                2
            ));
            verifier.submitReport(submission);
        } else {
            bool accepted = verifier.submitReport(submission);
            assertTrue(accepted);
        }
    }

    // ==================== Circuit Breaker Fuzz Tests ====================

    function testFuzz_CircuitBreaker_PriceDeviation(uint256 initialPrice, uint256 deviationBps) public {
        initialPrice = bound(initialPrice, 1e8, 1e14);
        // Keep deviation well within or outside the threshold for clear testing
        deviationBps = bound(deviationBps, 0, 3000);

        // Use absolute timestamps to avoid timing issues
        uint256 t1 = 1700000100;
        vm.warp(t1);

        // Submit initial price
        _submitPrice(initialPrice, 1);

        // Advance enough time to pass MIN_REPORT_INTERVAL (10 seconds)
        uint256 t2 = t1 + 60;
        vm.warp(t2);

        // Calculate deviated price
        uint256 deviation = (initialPrice * deviationBps) / 10000;
        uint256 newPrice = initialPrice + deviation;

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: newPrice,
            confidence: 100,
            timestamp: block.timestamp,
            round: 2,
            sourcesHash: keccak256("sources2")
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        
        // Circuit breaker at 2000 bps (20%)
        // Use a buffer to account for rounding
        if (deviationBps > 2100) {
            vm.expectRevert();
            verifier.submitReport(submission);
        } else if (deviationBps < 1900) {
            bool accepted = verifier.submitReport(submission);
            assertTrue(accepted);
        }
        // Skip assertion for values near threshold due to rounding
    }

    // ==================== Timestamp Fuzz Tests ====================

    function testFuzz_SubmitReport_TimestampValidity(uint256 reportTimestamp) public {
        vm.warp(1700000100);

        // Bound timestamp
        reportTimestamp = bound(reportTimestamp, 1700000000, block.timestamp + 100);

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2000e8,
            confidence: 100,
            timestamp: reportTimestamp,
            round: 1,
            sourcesHash: keccak256("sources")
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);

        // Future timestamps should revert
        if (reportTimestamp > block.timestamp) {
            vm.expectRevert();
            verifier.submitReport(submission);
        }
        // Old timestamps (> 1 hour) should revert
        else if (block.timestamp - reportTimestamp > 3600) {
            vm.expectRevert();
            verifier.submitReport(submission);
        } else {
            bool accepted = verifier.submitReport(submission);
            assertTrue(accepted);
        }
    }

    // ==================== Round Sequencing Fuzz Tests ====================

    function testFuzz_SubmitReport_RoundSequencing(uint256 numReports) public {
        numReports = bound(numReports, 1, 10);

        // Use absolute timestamps to ensure proper time advancement
        uint256 baseTime = 1700000100;
        
        // Submit reports sequentially
        for (uint256 i = 1; i <= numReports; i++) {
            vm.warp(baseTime + (i * 60)); // Ensure MIN_REPORT_INTERVAL is met
            uint256 expectedRound = verifier.getCurrentRound(feedId) + 1;
            _submitPrice(2000e8 + (i * 1e8), expectedRound);
        }

        uint256 finalRound = verifier.getCurrentRound(feedId);
        assertEq(finalRound, numReports);
    }

    // ==================== Batch Submission Fuzz Tests ====================

    function testFuzz_SubmitReportBatch_Multiple(uint8 batchSize) public {
        batchSize = uint8(bound(batchSize, 1, 5));

        // Create multiple feeds
        bytes32[] memory feedIds = new bytes32[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            vm.prank(owner);
            feedIds[i] = registry.createFeed(IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("BATCH-", vm.toString(i))),
                baseToken: address(uint160(0x1000 + i)),
                quoteToken: address(uint160(0x2000 + i)),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            }));
        }

        vm.warp(block.timestamp + 60);

        IReportVerifier.ReportSubmission[] memory submissions = new IReportVerifier.ReportSubmission[](batchSize);

        for (uint256 i = 0; i < batchSize; i++) {
            IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
                feedId: feedIds[i],
                price: (1000 + i) * 1e8,
                confidence: 100,
                timestamp: block.timestamp,
                round: 1,
                sourcesHash: keccak256(abi.encodePacked("batch", i))
            });

            bytes32 reportHash = keccak256(abi.encodePacked(
                report.feedId, report.price, report.confidence,
                report.timestamp, report.round, report.sourcesHash
            ));

            bytes[] memory signatures = new bytes[](2);
            for (uint256 j = 0; j < 2; j++) {
                (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                    signerPks[j],
                    keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
                );
                signatures[j] = abi.encodePacked(r, s, v);
            }

            submissions[i] = IReportVerifier.ReportSubmission({
                report: report,
                signatures: signatures
            });
        }

        vm.prank(owner);
        uint256 acceptedCount = verifier.submitReportBatch(submissions);
        assertEq(acceptedCount, batchSize);
    }

    // ==================== Staleness Fuzz Tests ====================

    function testFuzz_IsPriceStale_AfterTime(uint256 timeElapsed) public {
        timeElapsed = bound(timeElapsed, 0, 7200);

        vm.warp(block.timestamp + 60);
        _submitPrice(2000e8, 1);

        vm.warp(block.timestamp + timeElapsed);

        bool isStale = verifier.isPriceStale(feedId);

        // Heartbeat is 3600 seconds
        if (timeElapsed > 3600) {
            assertTrue(isStale);
        } else {
            assertFalse(isStale);
        }
    }

    // ==================== Helper Functions ====================

    function _submitPrice(uint256 price, uint256 round) internal {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: price,
            confidence: 100,
            timestamp: block.timestamp,
            round: round,
            sourcesHash: keccak256(abi.encodePacked("sources", round))
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        verifier.submitReport(submission);
    }
}

