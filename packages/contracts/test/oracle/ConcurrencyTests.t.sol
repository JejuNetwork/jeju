// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../src/oracle/ReportVerifier.sol";
import {CommitteeManager} from "../../src/oracle/CommitteeManager.sol";
import {DisputeGame} from "../../src/oracle/DisputeGame.sol";
import {OracleFeeRouter} from "../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../src/oracle/interfaces/IDisputeGame.sol";
import {IOracleFeeRouter} from "../../src/oracle/interfaces/IOracleFeeRouter.sol";

/**
 * @title ConcurrencyTests
 * @notice Tests for concurrent operations and race conditions
 */
contract ConcurrencyTests is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    CommitteeManager public committee;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    address[] public oracles;
    uint256[] public oraclePks;

    bytes32 public feedId;

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    function setUp() public {
        vm.warp(1700000000);

        // Create 5 oracle signers
        for (uint256 i = 1; i <= 5; i++) {
            uint256 pk = i * 0x1111;
            oraclePks.push(pk);
            oracles.push(vm.addr(pk));
            vm.deal(oracles[i - 1], 100 ether);
        }

        vm.deal(owner, 100 ether);

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        committee = new CommitteeManager(address(registry), owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);

        feedId = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "ETH-USD",
                baseToken: WETH,
                quoteToken: USDC,
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 500, // 5% to allow some deviation
                minOracles: 1,
                quorumThreshold: 1,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );

        // Setup committee
        committee.setGlobalAllowlist(oracles, true);
        for (uint256 i = 0; i < oracles.length; i++) {
            verifier.setAuthorizedTransmitter(oracles[i], true);
        }
        vm.stopPrank();
    }

    // ==================== Concurrent Report Submission ====================

    function test_ConcurrentReportSubmission_SameRound() public {
        // Two oracles try to submit for the same round
        uint256 round = 1;
        uint256 price1 = 3500_00000000;
        uint256 price2 = 3501_00000000;

        IReportVerifier.ReportSubmission memory submission1 = _buildSubmission(
            feedId, price1, 9500, block.timestamp, round, oraclePks[0]
        );

        // First submission should succeed
        vm.prank(oracles[0]);
        bool accepted1 = verifier.submitReport(submission1);
        assertTrue(accepted1);

        // Second submission for same round should be rejected
        IReportVerifier.ReportSubmission memory submission2 = _buildSubmission(
            feedId, price2, 9500, block.timestamp, round, oraclePks[1]
        );

        vm.prank(oracles[1]);
        bool accepted2 = verifier.submitReport(submission2);
        assertFalse(accepted2); // Round already processed
    }

    function test_ConcurrentReportSubmission_DifferentRounds() public {
        // Submit round 1
        IReportVerifier.ReportSubmission memory submission1 = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 1, oraclePks[0]
        );
        vm.prank(oracles[0]);
        assertTrue(verifier.submitReport(submission1));

        // Wait a bit and submit round 2
        vm.warp(block.timestamp + 60);

        IReportVerifier.ReportSubmission memory submission2 = _buildSubmission(
            feedId, 3510_00000000, 9500, block.timestamp, 2, oraclePks[1]
        );
        vm.prank(oracles[1]);
        assertTrue(verifier.submitReport(submission2));

        // Verify latest price
        (uint256 price,,, bool valid) = verifier.getLatestPrice(feedId);
        assertEq(price, 3510_00000000);
        assertTrue(valid);
    }

    // ==================== Rapid Succession Tests ====================

    function test_RapidSuccessionReports() public {
        uint256 currentTime = block.timestamp;
        // Submit multiple reports in rapid succession
        for (uint256 i = 1; i <= 10; i++) {
            currentTime += 60;
            vm.warp(currentTime);

            uint256 price = 3500_00000000 + (i * 1000000);

            IReportVerifier.ReportSubmission memory submission = _buildSubmission(
                feedId, price, 9500, currentTime, i, oraclePks[i % 5]
            );

            vm.prank(oracles[i % 5]);
            bool accepted = verifier.submitReport(submission);
            assertTrue(accepted, "Report should be accepted");
        }

        // Verify final state
        uint256 currentRound = verifier.getCurrentRound(feedId);
        assertEq(currentRound, 10);
    }

    // ==================== Multiple Feed Concurrent Operations ====================

    function test_ConcurrentOperationsMultipleFeeds() public {
        // Create additional feeds
        bytes32 feedId2;
        bytes32 feedId3;

        vm.startPrank(owner);
        feedId2 = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "BTC-USD",
                baseToken: address(0x100),
                quoteToken: USDC,
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 500,
                minOracles: 1,
                quorumThreshold: 1,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );

        feedId3 = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "DAI-USD",
                baseToken: address(0x200),
                quoteToken: USDC,
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 50_000 ether,
                maxDeviationBps: 100,
                minOracles: 1,
                quorumThreshold: 1,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
            })
        );
        vm.stopPrank();

        // Submit to all three feeds concurrently
        IReportVerifier.ReportSubmission memory sub1 = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 1, oraclePks[0]
        );
        IReportVerifier.ReportSubmission memory sub2 = _buildSubmission(
            feedId2, 45000_00000000, 9500, block.timestamp, 1, oraclePks[1]
        );
        IReportVerifier.ReportSubmission memory sub3 = _buildSubmission(
            feedId3, 1_00000000, 9900, block.timestamp, 1, oraclePks[2]
        );

        vm.prank(oracles[0]);
        assertTrue(verifier.submitReport(sub1));

        vm.prank(oracles[1]);
        assertTrue(verifier.submitReport(sub2));

        vm.prank(oracles[2]);
        assertTrue(verifier.submitReport(sub3));

        // Verify all feeds have correct prices
        (uint256 p1,,,) = verifier.getLatestPrice(feedId);
        (uint256 p2,,,) = verifier.getLatestPrice(feedId2);
        (uint256 p3,,,) = verifier.getLatestPrice(feedId3);

        assertEq(p1, 3500_00000000);
        assertEq(p2, 45000_00000000);
        assertEq(p3, 1_00000000);
    }

    // ==================== Dispute During Report Submission ====================

    function test_DisputeWhileNewReportSubmitted() public {
        // Submit initial report
        IReportVerifier.ReportSubmission memory submission1 = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 1, oraclePks[0]
        );
        vm.prank(oracles[0]);
        verifier.submitReport(submission1);

        // Open dispute on round 1
        bytes32 reportHash = _computeReportHash(feedId, 3500_00000000, 9500, block.timestamp, 1);

        vm.prank(oracles[1]);
        disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            bytes32(0)
        );

        // Submit new report while dispute is open
        vm.warp(block.timestamp + 60);
        IReportVerifier.ReportSubmission memory submission2 = _buildSubmission(
            feedId, 3510_00000000, 9500, block.timestamp, 2, oraclePks[2]
        );

        vm.prank(oracles[2]);
        bool accepted = verifier.submitReport(submission2);
        assertTrue(accepted);

        // Both dispute and new report should be independent
        (uint256 price,,,) = verifier.getLatestPrice(feedId);
        assertEq(price, 3510_00000000);
    }

    // ==================== Subscription Expiry Edge Cases ====================

    function test_SubscriptionExpiryBoundary() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        vm.prank(oracles[0]);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        // Check 1 second before expiry - should still be valid
        vm.warp(block.timestamp + 30 days - 1);
        assertTrue(feeRouter.isSubscribed(oracles[0], feedId));

        // Check at exact expiry time - subscription uses > not >=, so expired
        vm.warp(block.timestamp + 1);
        assertFalse(feeRouter.isSubscribed(oracles[0], feedId));
    }

    // ==================== Price History Integrity ====================

    function test_PriceHistoryIntegrity() public {
        uint256[] memory prices = new uint256[](5);
        prices[0] = 3500_00000000;
        prices[1] = 3510_00000000;
        prices[2] = 3495_00000000;
        prices[3] = 3520_00000000;
        prices[4] = 3480_00000000;

        uint256 currentTime = block.timestamp;
        // Submit 5 sequential reports
        for (uint256 i = 0; i < 5; i++) {
            currentTime += 60;
            vm.warp(currentTime);

            IReportVerifier.ReportSubmission memory submission = _buildSubmission(
                feedId, prices[i], 9500, currentTime, i + 1, oraclePks[i]
            );

            vm.prank(oracles[i]);
            bool accepted = verifier.submitReport(submission);
            assertTrue(accepted, "Report should be accepted");
        }

        // Verify we can retrieve historical prices
        for (uint256 i = 0; i < 5; i++) {
            IReportVerifier.ConsensusPrice memory historical = verifier.getHistoricalPrice(feedId, i + 1);
            assertEq(historical.price, prices[i]);
            assertEq(historical.round, i + 1);
        }
    }

    // ==================== Epoch Boundary Tests ====================

    function test_EpochBoundaryFeeAccumulation() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        // Subscribe in epoch 1
        vm.prank(oracles[0]);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        uint256 epoch1 = feeRouter.getCurrentEpoch();
        assertEq(epoch1, 1);

        // Cross epoch boundary
        vm.warp(block.timestamp + 1 days + 1);

        // Epoch advances when distributeEpochRewards is called (not on subscribe)
        feeRouter.distributeEpochRewards(1);

        // Now epoch should be 2
        uint256 epoch2 = feeRouter.getCurrentEpoch();
        assertEq(epoch2, 2);

        // Subscribe in epoch 2
        vm.prank(oracles[1]);
        feeRouter.subscribe{value: 0.2 ether}(feedIds, 1);

        IOracleFeeRouter.EpochRewards memory rewards = feeRouter.getEpochRewards(1);
        assertEq(rewards.totalFees, 0.1 ether);
        assertTrue(rewards.finalized);
    }

    // ==================== Helper Functions ====================

    function _buildSubmission(
        bytes32 _feedId,
        uint256 _price,
        uint256 _confidence,
        uint256 _timestamp,
        uint256 _round,
        uint256 _signerPk
    ) internal view returns (IReportVerifier.ReportSubmission memory) {
        bytes32 sourcesHash = keccak256("test-source");

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: _feedId,
            price: _price,
            confidence: _confidence,
            timestamp: _timestamp,
            round: _round,
            sourcesHash: sourcesHash
        });

        bytes32 reportHash = keccak256(
            abi.encodePacked(
                _feedId,
                _price,
                _confidence,
                _timestamp,
                _round,
                sourcesHash
            )
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_signerPk, ethSignedHash);
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, s, v);

        return IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });
    }

    function _computeReportHash(
        bytes32 _feedId,
        uint256 _price,
        uint256 _confidence,
        uint256 _timestamp,
        uint256 _round
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                _feedId,
                _price,
                _confidence,
                _timestamp,
                _round,
                keccak256("test-source")
            )
        );
    }
}

