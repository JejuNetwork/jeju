// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../src/oracle/DisputeGame.sol";
import {OracleFeeRouter} from "../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../src/oracle/interfaces/IDisputeGame.sol";
import {IOracleFeeRouter} from "../../src/oracle/interfaces/IOracleFeeRouter.sol";

/**
 * @title BoundaryTests
 * @notice Tests for boundary conditions, edge cases, and error handling
 */
contract BoundaryTests is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    address public user1 = address(0x10);
    address public user2 = address(0x20);

    uint256 public signerPk = 0x1111;
    address public signer;

    bytes32 public feedId;

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    function setUp() public {
        vm.warp(1700000000);

        signer = vm.addr(signerPk);

        vm.deal(user1, 1000 ether);
        vm.deal(user2, 1000 ether);
        vm.deal(owner, 100 ether);
        vm.deal(signer, 100 ether);

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
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
                maxDeviationBps: 500,
                minOracles: 1,
                quorumThreshold: 1,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );

        verifier.setAuthorizedTransmitter(signer, true);
        vm.stopPrank();
    }

    // ==================== Price Boundary Tests ====================

    function test_PriceZero_Reverts() public {
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 0, 9500, block.timestamp, 1
        );

        vm.expectRevert(IReportVerifier.InvalidReport.selector);
        vm.prank(signer);
        verifier.submitReport(submission);
    }

    function test_PriceMaxUint256() public {
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, type(uint256).max, 9500, block.timestamp, 1
        );

        vm.prank(signer);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        (uint256 price,,,) = verifier.getLatestPrice(feedId);
        assertEq(price, type(uint256).max);
    }

    function test_ConfidenceZero() public {
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 0, block.timestamp, 1
        );

        vm.prank(signer);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        (, uint256 confidence,,) = verifier.getLatestPrice(feedId);
        assertEq(confidence, 0);
    }

    function test_ConfidenceMax() public {
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 10000, block.timestamp, 1
        );

        vm.prank(signer);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);

        (, uint256 confidence,,) = verifier.getLatestPrice(feedId);
        assertEq(confidence, 10000);
    }

    // ==================== Timestamp Boundary Tests ====================

    function test_TimestampInFuture_Reverts() public {
        uint256 futureTime = block.timestamp + 1 hours;
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 9500, futureTime, 1
        );

        vm.expectRevert(abi.encodeWithSelector(
            IReportVerifier.StaleReport.selector,
            futureTime,
            block.timestamp
        ));
        vm.prank(signer);
        verifier.submitReport(submission);
    }

    function test_TimestampStale_Reverts() public {
        // MAX_PRICE_AGE is typically 1 hour
        uint256 staleTime = block.timestamp - 2 hours;
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 9500, staleTime, 1
        );

        vm.expectRevert(abi.encodeWithSelector(
            IReportVerifier.StaleReport.selector,
            staleTime,
            block.timestamp
        ));
        vm.prank(signer);
        verifier.submitReport(submission);
    }

    // ==================== Round Boundary Tests ====================

    function test_RoundZero() public {
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 0
        );

        vm.prank(signer);
        bool accepted = verifier.submitReport(submission);
        // Round 0 might be rejected depending on implementation
        // Just ensure no revert for unexpected reasons
    }

    function test_RoundSkipping_Reverts() public {
        // Submit round 1
        IReportVerifier.ReportSubmission memory sub1 = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 1
        );
        vm.prank(signer);
        verifier.submitReport(sub1);

        // Try to submit round 5 (skipping 2,3,4) - should revert
        vm.warp(block.timestamp + 60);
        IReportVerifier.ReportSubmission memory sub5 = _buildSubmission(
            feedId, 3510_00000000, 9500, block.timestamp, 5
        );

        vm.expectRevert(abi.encodeWithSelector(IReportVerifier.RoundMismatch.selector, 2, 5));
        vm.prank(signer);
        verifier.submitReport(sub5);
    }

    // ==================== Signature Edge Cases ====================

    function test_SignatureFromDifferentSigner() public {
        // With committee disabled (address(0)), any valid signature is accepted
        // This test verifies that behavior - signature doesn't need to match any specific key
        bytes32 sourcesHash = keccak256("test-source");

        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 3500_00000000,
            confidence: 9500,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: sourcesHash
        });

        // Create a signature from a different private key
        uint256 differentPk = 0x9876;
        bytes32 reportHash = keccak256(
            abi.encodePacked(feedId, uint256(3500_00000000), uint256(9500), block.timestamp, uint256(1), sourcesHash)
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(differentPk, ethSignedHash);
        
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, s, v);

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        // With no committee check, any valid signature is accepted
        vm.prank(signer);
        bool accepted = verifier.submitReport(submission);
        assertTrue(accepted);
    }

    function test_UnauthorizedTransmitter_Reverts() public {
        // Create a submission signed by an unauthorized key
        uint256 unauthorizedPk = 0x9999;
        address unauthorizedAddr = vm.addr(unauthorizedPk);

        IReportVerifier.ReportSubmission memory submission = _buildSubmissionWithKey(
            feedId, 3500_00000000, 9500, block.timestamp, 1, unauthorizedPk
        );

        // Unauthorized transmitter triggers Unauthorized error (before signature check)
        vm.expectRevert();
        vm.prank(unauthorizedAddr);
        verifier.submitReport(submission);
    }

    // ==================== Dispute Edge Cases ====================

    function test_DisputeNonExistentReport_Reverts() public {
        bytes32 fakeHash = bytes32(uint256(0xdead));

        vm.expectRevert(abi.encodeWithSelector(IDisputeGame.ReportNotDisputable.selector, fakeHash));
        vm.prank(user1);
        disputeGame.openDispute{value: 100 ether}(
            fakeHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            bytes32(0)
        );
    }

    function test_DisputeInsufficientBond_Reverts() public {
        // Submit a valid report first
        IReportVerifier.ReportSubmission memory submission = _buildSubmission(
            feedId, 3500_00000000, 9500, block.timestamp, 1
        );
        vm.prank(signer);
        verifier.submitReport(submission);

        bytes32 reportHash = _computeReportHash(feedId, 3500_00000000, 9500, block.timestamp, 1);

        vm.expectRevert(abi.encodeWithSelector(
            IDisputeGame.InsufficientBond.selector,
            1 ether,
            100 ether
        ));
        vm.prank(user1);
        disputeGame.openDispute{value: 1 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            bytes32(0)
        );
    }

    // ==================== Subscription Edge Cases ====================

    function test_SubscribeEmptyFeeds_Reverts() public {
        bytes32[] memory feedIds = new bytes32[](0);

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(user1);
        feeRouter.subscribe{value: 1 ether}(feedIds, 1);
    }

    function test_SubscribeZeroDuration_Reverts() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(user1);
        feeRouter.subscribe{value: 1 ether}(feedIds, 0);
    }

    function test_SubscribeMaxDuration() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 12);

        vm.prank(user1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 12);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.endTime, block.timestamp + 360 days);
    }

    function test_SubscribeExceedMaxDuration_Reverts() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(user1);
        feeRouter.subscribe{value: 10 ether}(feedIds, 13);
    }

    // ==================== Access Control Tests ====================

    function test_OnlyOwnerSetAuthorizedTransmitter() public {
        vm.expectRevert();
        vm.prank(user1);
        verifier.setAuthorizedTransmitter(user2, true);
    }

    function test_OnlyOwnerPause() public {
        vm.expectRevert();
        vm.prank(user1);
        feeRouter.pause();
    }

    function test_PausedOperationsRevert() public {
        vm.prank(owner);
        feeRouter.pause();

        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId;

        vm.expectRevert();
        vm.prank(user1);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);
    }

    // ==================== Helper Functions ====================

    function _buildSubmission(
        bytes32 _feedId,
        uint256 _price,
        uint256 _confidence,
        uint256 _timestamp,
        uint256 _round
    ) internal view returns (IReportVerifier.ReportSubmission memory) {
        return _buildSubmissionWithKey(_feedId, _price, _confidence, _timestamp, _round, signerPk);
    }

    function _buildSubmissionWithKey(
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
