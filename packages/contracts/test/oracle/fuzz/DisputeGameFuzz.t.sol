// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../../src/oracle/DisputeGame.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../../src/oracle/interfaces/IDisputeGame.sol";

/// @title DisputeGame Fuzz Tests
/// @notice Comprehensive fuzz testing for dispute mechanics and bond economics
contract DisputeGameFuzzTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    DisputeGame public disputeGame;

    address public owner = address(0x1);
    bytes32 public feedId;
    bytes32 public reportHash;

    uint256[] public signerPks;
    address[] public signers;

    function setUp() public {
        vm.warp(1700000000);

        for (uint256 i = 1; i <= 5; i++) {
            signerPks.push(i * 0x1111);
            signers.push(vm.addr(i * 0x1111));
        }

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);

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

        // Submit initial report
        vm.warp(block.timestamp + 60);
        reportHash = _submitReport(2000e8, 1);
    }

    // ==================== Bond Amount Fuzz Tests ====================

    function testFuzz_OpenDispute_BondAmount(uint256 bondAmount) public {
        bondAmount = bound(bondAmount, 0, 1000 ether);

        address disputer = address(0x100);
        vm.deal(disputer, bondAmount + 1 ether);

        uint256 minBond = disputeGame.getMinBond();

        vm.prank(disputer);

        if (bondAmount < minBond) {
            vm.expectRevert(abi.encodeWithSelector(
                IDisputeGame.InsufficientBond.selector,
                bondAmount,
                minBond
            ));
            disputeGame.openDispute{value: bondAmount}(
                reportHash,
                IDisputeGame.DisputeReason.PRICE_DEVIATION,
                keccak256("evidence")
            );
        } else {
            bytes32 disputeId = disputeGame.openDispute{value: bondAmount}(
                reportHash,
                IDisputeGame.DisputeReason.PRICE_DEVIATION,
                keccak256("evidence")
            );
            
            IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
            assertEq(dispute.bond, bondAmount);
        }
    }

    function testFuzz_OpenDispute_ExcessBond(uint256 excessAmount) public {
        excessAmount = bound(excessAmount, 0, 500 ether);
        uint256 minBond = disputeGame.getMinBond();
        uint256 totalBond = minBond + excessAmount;

        address disputer = address(0x101);
        vm.deal(disputer, totalBond + 1 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: totalBond}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(dispute.bond, totalBond);
    }

    // ==================== Challenge Fuzz Tests ====================

    function testFuzz_ChallengeDispute_BondAmount(uint256 challengeBond) public {
        // First open a dispute
        address disputer = address(0x102);
        uint256 disputeBond = 100 ether;
        vm.deal(disputer, disputeBond + 1 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: disputeBond}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        // Challenge
        challengeBond = bound(challengeBond, 0, 500 ether);
        address challenger = address(0x103);
        vm.deal(challenger, challengeBond + 1 ether);

        vm.prank(challenger);

        if (challengeBond < disputeBond) {
            vm.expectRevert(abi.encodeWithSelector(
                IDisputeGame.InsufficientBond.selector,
                challengeBond,
                disputeBond
            ));
            disputeGame.challengeDispute{value: challengeBond}(disputeId);
        } else {
            disputeGame.challengeDispute{value: challengeBond}(disputeId);

            IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
            assertEq(uint8(dispute.status), uint8(IDisputeGame.DisputeStatus.CHALLENGED));
            assertEq(dispute.bond, disputeBond + challengeBond);
        }
    }

    // ==================== Timing Fuzz Tests ====================

    function testFuzz_ChallengeDispute_Timing(uint256 timePassed) public {
        timePassed = bound(timePassed, 0, 48 hours);

        address disputer = address(0x104);
        vm.deal(disputer, 200 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        vm.warp(block.timestamp + timePassed);

        address challenger = address(0x105);
        vm.deal(challenger, 200 ether);

        vm.prank(challenger);

        // Challenge window is 24 hours
        if (timePassed > 24 hours) {
            vm.expectRevert(abi.encodeWithSelector(
                IDisputeGame.ChallengeWindowClosed.selector,
                disputeId
            ));
            disputeGame.challengeDispute{value: 100 ether}(disputeId);
        } else {
            disputeGame.challengeDispute{value: 100 ether}(disputeId);
            IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
            assertEq(uint8(dispute.status), uint8(IDisputeGame.DisputeStatus.CHALLENGED));
        }
    }

    function testFuzz_ExpireDispute_Timing(uint256 timePassed) public {
        timePassed = bound(timePassed, 0, 120 hours);

        address disputer = address(0x106);
        vm.deal(disputer, 200 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        uint256 deadline = dispute.deadline;

        vm.warp(block.timestamp + timePassed);

        if (block.timestamp < deadline) {
            vm.expectRevert();
            disputeGame.expireDispute(disputeId);
        } else {
            uint256 disputerBalanceBefore = disputer.balance;
            disputeGame.expireDispute(disputeId);
            
            // Disputer should get bond back
            assertGt(disputer.balance, disputerBalanceBefore);
        }
    }

    // ==================== Multiple Disputes Fuzz Tests ====================

    function testFuzz_MultipleDisputes_SameReport(uint8 attemptCount) public {
        attemptCount = uint8(bound(attemptCount, 1, 5));

        for (uint256 i = 0; i < attemptCount; i++) {
            address disputer = address(uint160(0x200 + i));
            vm.deal(disputer, 200 ether);

            vm.prank(disputer);

            if (i == 0) {
                bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
                    reportHash,
                    IDisputeGame.DisputeReason.PRICE_DEVIATION,
                    keccak256("evidence")
                );
                assertTrue(disputeId != bytes32(0));
            } else {
                vm.expectRevert(abi.encodeWithSelector(
                    IDisputeGame.DisputeAlreadyExists.selector,
                    reportHash
                ));
                disputeGame.openDispute{value: 100 ether}(
                    reportHash,
                    IDisputeGame.DisputeReason.PRICE_DEVIATION,
                    keccak256("evidence")
                );
            }
        }
    }

    function testFuzz_DisputeTracking_Count(uint8 disputeCount) public {
        disputeCount = uint8(bound(disputeCount, 1, 5));

        bytes32[] memory feedIds = new bytes32[](disputeCount);
        bytes32[] memory reportHashes = new bytes32[](disputeCount);

        // Create separate feeds to allow independent disputes
        for (uint256 i = 0; i < disputeCount; i++) {
            vm.prank(owner);
            feedIds[i] = registry.createFeed(IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("MULTI-", vm.toString(i))),
                baseToken: address(uint160(0x7000 + i)),
                quoteToken: address(uint160(0x8000 + i)),
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

            // Submit report for each feed
            vm.warp(block.timestamp + 60);
            IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
                feedId: feedIds[i],
                price: 2000e8,
                confidence: 100,
                timestamp: block.timestamp,
                round: 1,
                sourcesHash: keccak256(abi.encodePacked("multi", i))
            });

            bytes32 hash = keccak256(abi.encodePacked(
                report.feedId, report.price, report.confidence,
                report.timestamp, report.round, report.sourcesHash
            ));

            bytes[] memory sigs = new bytes[](2);
            for (uint256 j = 0; j < 2; j++) {
                (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                    signerPks[j],
                    keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash))
                );
                sigs[j] = abi.encodePacked(r, s, v);
            }

            vm.prank(owner);
            verifier.submitReport(IReportVerifier.ReportSubmission({report: report, signatures: sigs}));
            reportHashes[i] = hash;

            // Open dispute
            address disputer = address(uint160(0x500 + i));
            vm.deal(disputer, 200 ether);
            vm.prank(disputer);
            disputeGame.openDispute{value: 100 ether}(
                reportHashes[i],
                IDisputeGame.DisputeReason.PRICE_DEVIATION,
                keccak256(abi.encodePacked("ev", i))
            );
        }

        bytes32[] memory activeDisputes = disputeGame.getActiveDisputes();
        assertEq(activeDisputes.length, disputeCount);
    }

    // ==================== Resolution Fuzz Tests ====================

    function testFuzz_ResolveDispute_Outcomes(bool isValid) public {
        address disputer = address(0x107);
        vm.deal(disputer, 200 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        uint256 disputerBalanceBefore = disputer.balance;

        vm.prank(owner);
        disputeGame.resolveDispute(
            disputeId,
            isValid ? IDisputeGame.ResolutionOutcome.REPORT_VALID : IDisputeGame.ResolutionOutcome.REPORT_INVALID,
            "Resolution note"
        );

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);

        if (isValid) {
            assertEq(uint8(dispute.status), uint8(IDisputeGame.DisputeStatus.RESOLVED_VALID));
            // Disputer loses bond when report is valid
        } else {
            assertEq(uint8(dispute.status), uint8(IDisputeGame.DisputeStatus.RESOLVED_INVALID));
            // Disputer gets bond + reward when report is invalid
            assertGt(disputer.balance, disputerBalanceBefore);
        }
    }

    // ==================== Dispute Reason Fuzz Tests ====================

    function testFuzz_OpenDispute_AllReasons(uint8 reasonRaw) public {
        reasonRaw = uint8(bound(reasonRaw, 0, 6)); // Valid reason range

        // Submit new report with proper round sequencing
        vm.warp(block.timestamp + 60);
        uint256 currentRound = verifier.getCurrentRound(feedId);
        bytes32 newReportHash = _submitReport(2001e8, currentRound + 1);

        IDisputeGame.DisputeReason reason = IDisputeGame.DisputeReason(reasonRaw);

        address disputer = address(0x108);
        vm.deal(disputer, 200 ether);

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: 100 ether}(
            newReportHash,
            reason,
            keccak256("evidence")
        );

        IDisputeGame.Dispute memory dispute = disputeGame.getDispute(disputeId);
        assertEq(uint8(dispute.reason), reasonRaw);
    }

    // ==================== Economic Invariant Tests ====================

    function testFuzz_DisputeEconomics_DisputerProfit(uint256 bondAmount, bool reportInvalid) public {
        bondAmount = bound(bondAmount, 100 ether, 500 ether);

        address disputer = address(0x109);
        vm.deal(disputer, bondAmount + 1 ether);

        uint256 initialBalance = disputer.balance;

        vm.prank(disputer);
        bytes32 disputeId = disputeGame.openDispute{value: bondAmount}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("evidence")
        );

        uint256 afterOpenBalance = disputer.balance;
        assertEq(afterOpenBalance, initialBalance - bondAmount);

        vm.prank(owner);
        disputeGame.resolveDispute(
            disputeId,
            reportInvalid ? IDisputeGame.ResolutionOutcome.REPORT_INVALID : IDisputeGame.ResolutionOutcome.REPORT_VALID,
            "test"
        );

        uint256 finalBalance = disputer.balance;

        if (reportInvalid) {
            // Disputer should profit (bond + 30% reward)
            assertGt(finalBalance, initialBalance - bondAmount);
        } else {
            // Disputer loses bond
            assertEq(finalBalance, afterOpenBalance);
        }
    }

    // ==================== Helper Functions ====================

    function _submitReport(uint256 price, uint256 round) internal returns (bytes32) {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: price,
            confidence: 100,
            timestamp: block.timestamp,
            round: round,
            sourcesHash: keccak256(abi.encodePacked("sources", round))
        });

        bytes32 hash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        verifier.submitReport(submission);

        return hash;
    }

    receive() external payable {}
}

