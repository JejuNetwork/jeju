// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../src/oracle/ReportVerifier.sol";
import {CommitteeManager} from "../../src/oracle/CommitteeManager.sol";
import {OracleFeeRouter} from "../../src/oracle/OracleFeeRouter.sol";
import {DisputeGame} from "../../src/oracle/DisputeGame.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../src/oracle/interfaces/IReportVerifier.sol";
import {ICommitteeManager} from "../../src/oracle/interfaces/ICommitteeManager.sol";
import {IDisputeGame} from "../../src/oracle/interfaces/IDisputeGame.sol";
import {IOracleFeeRouter} from "../../src/oracle/interfaces/IOracleFeeRouter.sol";

/**
 * @title OracleIntegrationTest
 * @notice End-to-end integration test for the Jeju Oracle Network
 */
contract OracleIntegrationTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    CommitteeManager public committee;
    OracleFeeRouter public feeRouter;
    DisputeGame public disputeGame;

    address public owner = address(0x1);
    address public operator1 = address(0x10);
    address public operator2 = address(0x20);
    address public operator3 = address(0x30);
    address public subscriber = address(0x100);
    address public disputer = address(0x200);

    // Signers
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
        vm.warp(1700000000);

        signer1 = vm.addr(signer1Pk);
        signer2 = vm.addr(signer2Pk);
        signer3 = vm.addr(signer3Pk);

        // Fund accounts
        vm.deal(subscriber, 100 ether);
        vm.deal(disputer, 100 ether);

        // Deploy all contracts
        vm.startPrank(owner);

        registry = new FeedRegistry(owner);
        committee = new CommitteeManager(address(registry), owner);
        // Note: Not setting committee manager to allow any signer for testing
        verifier = new ReportVerifier(address(registry), address(0), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);

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

    function test_EndToEndPriceFlow() public {
        // 1. Create and submit a price report
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,  // $2500
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes32 reportHash = _computeReportHash(report);

        // Sign with multiple signers
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(signer1Pk, reportHash);
        signatures[1] = _sign(signer2Pk, reportHash);

        vm.prank(owner);
        bool accepted = verifier.submitReport(IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        }));
        assertTrue(accepted);

        // 2. Verify price is stored correctly
        (uint256 price, uint256 confidence, uint256 timestamp, bool isValid) = verifier.getLatestPrice(feedId);
        assertEq(price, 2500e8);
        assertEq(confidence, 9800);
        assertTrue(isValid);

        // 3. Submit updated price
        vm.warp(block.timestamp + 60);

        IReportVerifier.PriceReport memory report2 = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2505e8,  // Small change
            confidence: 9750,
            timestamp: block.timestamp,
            round: 2,
            sourcesHash: keccak256("uniswap-v3")
        });

        bytes32 reportHash2 = _computeReportHash(report2);
        bytes[] memory sigs2 = new bytes[](2);
        sigs2[0] = _sign(signer1Pk, reportHash2);
        sigs2[1] = _sign(signer2Pk, reportHash2);

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({
            report: report2,
            signatures: sigs2
        }));

        // Verify updated
        (price,,,) = verifier.getLatestPrice(feedId);
        assertEq(price, 2505e8);
        assertEq(verifier.getCurrentRound(feedId), 2);
    }

    function test_SubscriptionAndFeeFlow() public {
        // 1. Get subscription price
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);
        assertTrue(price > 0);

        // 2. Subscribe
        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        // 3. Verify subscription
        assertTrue(feeRouter.isSubscribed(subscriber, feedId));

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.subscriber, subscriber);
        assertTrue(sub.isActive);
        assertEq(sub.feedIds.length, 1);
    }

    function test_DisputeFlow() public {
        // 1. Submit a report first
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

        vm.prank(owner);
        verifier.submitReport(IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        }));

        // 2. Open a dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        // 3. Verify dispute is open
        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(dispute.disputer, disputer);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.OPEN));

        // 4. Resolve dispute
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_VALID, "Price verified correct");

        // 5. Verify resolution
        dispute = disputeGame.getDispute(disputeId);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.RESOLVED_VALID));
    }

    function test_MultipleFeeds() public {
        // Create additional feeds
        vm.startPrank(owner);

        IFeedRegistry.FeedCreateParams memory btcParams = IFeedRegistry.FeedCreateParams({
            symbol: "BTC-USD",
            baseToken: address(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599),
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
        bytes32 btcFeedId = registry.createFeed(btcParams);

        IFeedRegistry.FeedCreateParams memory usdcParams = IFeedRegistry.FeedCreateParams({
            symbol: "USDC-USD",
            baseToken: USDC,
            quoteToken: address(0),
            decimals: 8,
            heartbeatSeconds: 86400,
            twapWindowSeconds: 3600,
            minLiquidityUSD: 50_000 ether,
            maxDeviationBps: 50,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: false,
            category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
        });
        bytes32 usdcFeedId = registry.createFeed(usdcParams);

        vm.stopPrank();

        // Verify feeds
        assertEq(registry.totalFeeds(), 3);
        bytes32[] memory allFeeds = registry.getAllFeeds();
        assertEq(allFeeds.length, 3);

        // Get by category
        bytes32[] memory spotFeeds = registry.getFeedsByCategory(IFeedRegistry.FeedCategory.SPOT_PRICE);
        assertEq(spotFeeds.length, 2);

        bytes32[] memory pegFeeds = registry.getFeedsByCategory(IFeedRegistry.FeedCategory.STABLECOIN_PEG);
        assertEq(pegFeeds.length, 1);
    }

    function test_PriceHistory() public {
        // Submit multiple reports over time
        for (uint256 i = 1; i <= 5; i++) {
            // Warp time before creating report so timestamp is current
            if (i > 1) {
                vm.warp(block.timestamp + 15); // Past MIN_REPORT_INTERVAL (10s)
            }

            IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
                feedId: feedId,
                price: (2500 + i * 5) * 1e8,  // Incrementing price
                confidence: 9800,
                timestamp: block.timestamp,
                round: i,
                sourcesHash: keccak256("uniswap-v3")
            });

            bytes32 reportHash = _computeReportHash(report);
            bytes[] memory sigs = new bytes[](2);
            sigs[0] = _sign(signer1Pk, reportHash);
            sigs[1] = _sign(signer2Pk, reportHash);

            vm.prank(owner);
            bool accepted = verifier.submitReport(IReportVerifier.ReportSubmission({
                report: report,
                signatures: sigs
            }));
            assertTrue(accepted, "Report should be accepted");
        }

        // Verify history
        assertEq(verifier.getCurrentRound(feedId), 5);

        IReportVerifier.ConsensusPrice memory round1 = verifier.getHistoricalPrice(feedId, 1);
        assertEq(round1.price, 2505e8);

        IReportVerifier.ConsensusPrice memory round5 = verifier.getHistoricalPrice(feedId, 5);
        assertEq(round5.price, 2525e8);
    }

    // ============ Helpers ============

    function _computeReportHash(IReportVerifier.PriceReport memory report) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            report.feedId,
            report.price,
            report.confidence,
            report.timestamp,
            report.round,
            report.sourcesHash
        ));
    }

    function _sign(uint256 privateKey, bytes32 reportHash) internal pure returns (bytes memory) {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}
