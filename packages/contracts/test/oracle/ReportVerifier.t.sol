// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../src/oracle/ReportVerifier.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../src/oracle/interfaces/IReportVerifier.sol";

contract ReportVerifierTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;

    address public owner = address(0x1);

    // Test signers
    uint256 public signer1Pk = 0x1111;
    uint256 public signer2Pk = 0x2222;
    uint256 public signer3Pk = 0x3333;
    address public signer1;
    address public signer2;
    address public signer3;

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    bytes32 public feedId;

    function setUp() public {
        // Set a realistic block.timestamp (tests start at timestamp 1)
        vm.warp(1700000000);

        // Derive signer addresses from private keys
        signer1 = vm.addr(signer1Pk);
        signer2 = vm.addr(signer2Pk);
        signer3 = vm.addr(signer3Pk);

        // Deploy contracts
        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);

        // Create a feed
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });
        feedId = registry.createFeed(params);
        vm.stopPrank();
    }

    function test_SubmitReport() public {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8, // $2500 with 8 decimals
            confidence: 9800, // 98%
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes32 reportHash = _computeReportHash(report);

        // Sign with multiple signers
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(signer1Pk, reportHash);
        signatures[1] = _sign(signer2Pk, reportHash);

        IReportVerifier.ReportSubmission memory submission =
            IReportVerifier.ReportSubmission({report: report, signatures: signatures});

        vm.prank(owner);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        // Check price was stored
        (uint256 price, uint256 confidence, uint256 timestamp, bool isValid) = verifier.getLatestPrice(feedId);
        assertEq(price, 2500e8);
        assertEq(confidence, 9800);
        assertEq(timestamp, block.timestamp);
        assertTrue(isValid);

        // Check round
        assertEq(verifier.getCurrentRound(feedId), 1);
    }

    function test_SubmitMultipleReports() public {
        // First report
        IReportVerifier.PriceReport memory report1 = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs1 = new bytes[](2);
        sigs1[0] = _sign(signer1Pk, _computeReportHash(report1));
        sigs1[1] = _sign(signer2Pk, _computeReportHash(report1));

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report1, signatures: sigs1}));

        // Advance time past MIN_REPORT_INTERVAL (10s)
        vm.warp(block.timestamp + 15);

        // Second report with slightly different price
        IReportVerifier.PriceReport memory report2 = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2510e8, // $2510
            confidence: 9700,
            timestamp: block.timestamp,
            round: 2,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs2 = new bytes[](2);
        sigs2[0] = _sign(signer1Pk, _computeReportHash(report2));
        sigs2[1] = _sign(signer2Pk, _computeReportHash(report2));

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report2, signatures: sigs2}));

        // Check updated price
        (uint256 price,,,) = verifier.getLatestPrice(feedId);
        assertEq(price, 2510e8);
        assertEq(verifier.getCurrentRound(feedId), 2);
    }

    function test_GetHistoricalPrice() public {
        // Submit report
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Pk, _computeReportHash(report));
        sigs[1] = _sign(signer2Pk, _computeReportHash(report));

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report, signatures: sigs}));

        // Get historical price
        IReportVerifier.ConsensusPrice memory historical = verifier.getHistoricalPrice(feedId, 1);
        assertEq(historical.price, 2500e8);
        assertEq(historical.round, 1);
    }

    function test_RevertInsufficientSignatures() public {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        // Only 1 signature when quorum is 2
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = _sign(signer1Pk, _computeReportHash(report));

        IReportVerifier.ReportSubmission memory submission =
            IReportVerifier.ReportSubmission({report: report, signatures: signatures});

        vm.expectRevert(abi.encodeWithSelector(IReportVerifier.InsufficientSignatures.selector, 1, 2));
        vm.prank(owner);
        verifier.submitReport(submission);
    }

    function test_RevertDuplicateSignature() public {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes32 reportHash = _computeReportHash(report);

        // Same signer twice
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(signer1Pk, reportHash);
        signatures[1] = _sign(signer1Pk, reportHash); // Duplicate!

        IReportVerifier.ReportSubmission memory submission =
            IReportVerifier.ReportSubmission({report: report, signatures: signatures});

        vm.expectRevert(abi.encodeWithSelector(IReportVerifier.DuplicateSignature.selector, signer1));
        vm.prank(owner);
        verifier.submitReport(submission);
    }

    function test_RevertStaleReport() public {
        // Report with old timestamp (must be more than 1 hour old)
        uint256 oldTimestamp = block.timestamp - 2 hours;
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: oldTimestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Pk, _computeReportHash(report));
        sigs[1] = _sign(signer2Pk, _computeReportHash(report));

        vm.expectRevert(abi.encodeWithSelector(IReportVerifier.StaleReport.selector, oldTimestamp, block.timestamp));
        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report, signatures: sigs}));
    }

    function test_RevertCircuitBreaker() public {
        // Submit first report
        IReportVerifier.PriceReport memory report1 = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs1 = new bytes[](2);
        sigs1[0] = _sign(signer1Pk, _computeReportHash(report1));
        sigs1[1] = _sign(signer2Pk, _computeReportHash(report1));

        vm.prank(owner);
        bool accepted = verifier.submitReport(IReportVerifier.ReportSubmission({report: report1, signatures: sigs1}));
        assertTrue(accepted);

        // Advance time past MIN_REPORT_INTERVAL
        vm.warp(block.timestamp + 15);

        // Try to submit report with >20% deviation (circuit breaker)
        IReportVerifier.PriceReport memory report2 = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 3100e8, // $3100 = +24% deviation
            confidence: 9800,
            timestamp: block.timestamp,
            round: 2,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs2 = new bytes[](2);
        sigs2[0] = _sign(signer1Pk, _computeReportHash(report2));
        sigs2[1] = _sign(signer2Pk, _computeReportHash(report2));

        // Should revert with PriceDeviationTooLarge
        vm.expectRevert(
            abi.encodeWithSelector(
                IReportVerifier.PriceDeviationTooLarge.selector,
                2400, // 24% deviation
                2000 // 20% max
            )
        );
        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report2, signatures: sigs2}));
    }

    function test_VerifySignatures() public view {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes32 reportHash = _computeReportHash(report);

        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(signer1Pk, reportHash);
        signatures[1] = _sign(signer2Pk, reportHash);

        (address[] memory signers, bool valid) = verifier.verifySignatures(reportHash, signatures);

        assertTrue(valid);
        assertEq(signers[0], signer1);
        assertEq(signers[1], signer2);
    }

    function test_IsPriceStale() public {
        // Submit report
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Pk, _computeReportHash(report));
        sigs[1] = _sign(signer2Pk, _computeReportHash(report));

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({report: report, signatures: sigs}));

        // Price should not be stale immediately
        assertFalse(verifier.isPriceStale(feedId));
        assertTrue(verifier.isPriceValid(feedId));

        // Advance time past heartbeat
        vm.warp(block.timestamp + 4000); // 4000s > 3600s heartbeat

        assertTrue(verifier.isPriceStale(feedId));
    }

    function test_EmergencyPriceUpdate() public {
        vm.prank(owner);
        verifier.emergencyPriceUpdate(feedId, 2600e8, 5000);

        (uint256 price, uint256 confidence,,) = verifier.getLatestPrice(feedId);
        assertEq(price, 2600e8);
        assertEq(confidence, 5000);
    }

    // ============ Helpers ============

    function _computeReportHash(IReportVerifier.PriceReport memory report) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                report.feedId, report.price, report.confidence, report.timestamp, report.round, report.sourcesHash
            )
        );
    }

    function _sign(uint256 privateKey, bytes32 reportHash) internal pure returns (bytes memory) {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}
