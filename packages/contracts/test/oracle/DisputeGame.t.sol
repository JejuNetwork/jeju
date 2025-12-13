// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../src/oracle/DisputeGame.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../src/oracle/interfaces/IDisputeGame.sol";

contract DisputeGameTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    DisputeGame public disputeGame;

    address public owner = address(0x1);
    address public disputer = address(0x2);
    address public challenger = address(0x3);

    // Test signers
    uint256 public signer1Pk = 0x1111;
    uint256 public signer2Pk = 0x2222;
    address public signer1;
    address public signer2;

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    bytes32 public feedId;
    bytes32 public reportHash;

    function setUp() public {
        // Set realistic timestamp
        vm.warp(1700000000);

        signer1 = vm.addr(signer1Pk);
        signer2 = vm.addr(signer2Pk);

        // Fund accounts
        vm.deal(disputer, 1000 ether);
        vm.deal(challenger, 1000 ether);

        // Deploy contracts
        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
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

        // Submit a report to dispute
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: 2500e8,
            confidence: 9800,
            timestamp: block.timestamp,
            round: 1,
            sourcesHash: keccak256("uniswap-v3")
        });

        reportHash = _computeReportHash(report);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Pk, reportHash);
        sigs[1] = _sign(signer2Pk, reportHash);

        verifier.submitReport(IReportVerifier.ReportSubmission({
            report: report,
            signatures: sigs
        }));

        vm.stopPrank();
    }

    function test_OpenDispute() public {
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence-ipfs-hash")
        );

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(dispute.disputer, disputer);
        assertEq(dispute.reportHash, reportHash);
        assertEq(dispute.bond, 100 ether);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.OPEN));

        assertTrue(disputeGame.isReportDisputed(reportHash));
    }

    function test_ChallengeDispute() public {
        // Open dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        // Challenge
        vm.prank(challenger);
        disputeGame.challengeDispute{value: 100 ether}(disputeId);

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.CHALLENGED));
        assertEq(dispute.bond, 200 ether); // Both bonds combined
    }

    function test_ResolveDisputeValid() public {
        // Open dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        uint256 disputerBalanceBefore = disputer.balance;

        // Resolve as valid (disputer loses)
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_VALID, "Report verified correct");

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.RESOLVED_VALID));

        // Disputer should not get bond back
        assertEq(disputer.balance, disputerBalanceBefore);
    }

    function test_ResolveDisputeInvalid() public {
        // Open dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        uint256 disputerBalanceBefore = disputer.balance;

        // Resolve as invalid (disputer wins)
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_INVALID, "Report verified incorrect");

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.RESOLVED_INVALID));

        // Disputer should get bond back plus reward
        assertTrue(disputer.balance > disputerBalanceBefore);
    }

    function test_ExpireDispute() public {
        // Open dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        uint256 disputerBalanceBefore = disputer.balance;

        // Advance past deadline
        vm.warp(block.timestamp + 96 hours + 1);

        // Expire dispute
        disputeGame.expireDispute(disputeId);

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(uint256(dispute.status), uint256(IDisputeGame.DisputeStatus.EXPIRED));

        // Disputer gets bond back on expiry
        assertEq(disputer.balance, disputerBalanceBefore + 100 ether);
    }

    function test_RevertInsufficientBond() public {
        vm.prank(disputer);
        vm.expectRevert(abi.encodeWithSelector(
            IDisputeGame.InsufficientBond.selector,
            10 ether,
            100 ether
        ));
        disputeGame.openDispute{value: 10 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );
    }

    function test_RevertDuplicateDispute() public {
        vm.prank(disputer);
        disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        vm.prank(disputer);
        vm.expectRevert(abi.encodeWithSelector(
            IDisputeGame.DisputeAlreadyExists.selector,
            reportHash
        ));
        disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence2")
        );
    }

    function test_RevertChallengeWindowClosed() public {
        // Open dispute
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        // Advance past challenge window
        vm.warp(block.timestamp + 25 hours);

        // Try to challenge
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(
            IDisputeGame.ChallengeWindowClosed.selector,
            disputeId
        ));
        disputeGame.challengeDispute{value: 100 ether}(disputeId);
    }

    function test_GetActiveDisputes() public {
        vm.prank(disputer);
        bytes32 disputeId1 = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        bytes32[] memory active = disputeGame.getActiveDisputes();
        assertEq(active.length, 1);
        assertEq(active[0], disputeId1);

        // Resolve and check removal
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId1, IDisputeGame.ResolutionOutcome.REPORT_VALID, "valid");

        active = disputeGame.getActiveDisputes();
        assertEq(active.length, 0);
    }

    function test_GetDisputesByDisputer() public {
        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        bytes32[] memory disputes = disputeGame.getDisputesByDisputer(disputer);
        assertEq(disputes.length, 1);
        assertEq(disputes[0], disputeId);
    }

    function test_CanDispute() public view {
        assertTrue(disputeGame.canDispute(reportHash));
    }

    function test_GetMinBond() public view {
        assertEq(disputeGame.getMinBond(), 100 ether);
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

    function _sign(uint256 privateKey, bytes32 hash) internal pure returns (bytes memory) {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}
