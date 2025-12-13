// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {CrossChainMessagingPaymaster} from "../src/eil/CrossChainMessagingPaymaster.sol";
import {MockEntryPoint} from "./mocks/MockEntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title EIL Enhanced Tests
 * @notice Comprehensive tests for Multi-XLP Competition, Dispute Resolution, and Passive Fallback
 */
contract EILEnhancedTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    L1StakeManager public l1StakeManager;
    CrossChainPaymaster public crossChainPaymaster;
    CrossChainMessagingPaymaster public messagingPaymaster;
    MockEntryPoint public entryPoint;

    address public deployer;
    address public xlp1;
    address public xlp2;
    address public xlp3;
    address public user;
    address public arbitrator1;
    address public arbitrator2;

    uint256 public xlp1PrivateKey;
    uint256 public xlp2PrivateKey;
    uint256 public xlp3PrivateKey;
    uint256 public userPrivateKey;

    uint256 constant L1_CHAIN_ID = 1337;
    uint256 constant L2_CHAIN_ID = 420691;
    uint256 constant MIN_STAKE = 1 ether;

    function setUp() public {
        // Setup accounts
        deployer = address(this);
        xlp1PrivateKey = 0x1234;
        xlp2PrivateKey = 0x5678;
        xlp3PrivateKey = 0x9abc;
        userPrivateKey = 0xdef0;

        xlp1 = vm.addr(xlp1PrivateKey);
        xlp2 = vm.addr(xlp2PrivateKey);
        xlp3 = vm.addr(xlp3PrivateKey);
        user = vm.addr(userPrivateKey);
        arbitrator1 = address(0x100);
        arbitrator2 = address(0x101);

        // Fund accounts
        vm.deal(xlp1, 100 ether);
        vm.deal(xlp2, 100 ether);
        vm.deal(xlp3, 100 ether);
        vm.deal(user, 100 ether);
        vm.deal(arbitrator1, 100 ether);
        vm.deal(arbitrator2, 100 ether);

        // Deploy contracts
        entryPoint = new MockEntryPoint();
        l1StakeManager = new L1StakeManager();
        crossChainPaymaster =
            new CrossChainPaymaster(IEntryPoint(address(entryPoint)), address(l1StakeManager), L2_CHAIN_ID, address(0));
        messagingPaymaster = new CrossChainMessagingPaymaster(L2_CHAIN_ID);

        // Setup
        l1StakeManager.registerL2Paymaster(L2_CHAIN_ID, address(crossChainPaymaster));
        l1StakeManager.registerL2Paymaster(L1_CHAIN_ID, address(messagingPaymaster));
        crossChainPaymaster.setTokenSupport(address(0), true);
        messagingPaymaster.setTokenSupport(address(0), true);
    }

    // ============ Multi-XLP Competition Tests ============

    function test_MultiXLP_CreateRequestWithAllowlist() public {
        // Register XLPs
        _registerXLP(xlp1, 10 ether);
        _registerXLP(xlp2, 10 ether);
        _registerXLP(xlp3, 10 ether);

        // User creates request with allowlist (only xlp1 and xlp2)
        address[] memory allowedXLPs = new address[](2);
        allowedXLPs[0] = xlp1;
        allowedXLPs[1] = xlp2;

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequestWithAllowlist{value: 1.1 ether}(
            address(0), // ETH
            1 ether,
            address(0),
            L1_CHAIN_ID,
            user,
            21000,
            0.1 ether,
            0.01 ether,
            allowedXLPs
        );

        // Verify allowlist is set
        assertTrue(crossChainPaymaster.isXLPAllowed(requestId, xlp1));
        assertTrue(crossChainPaymaster.isXLPAllowed(requestId, xlp2));
        assertFalse(crossChainPaymaster.isXLPAllowed(requestId, xlp3));
    }

    function test_MultiXLP_BidSubmission() public {
        _registerXLP(xlp1, 10 ether);
        _registerXLP(xlp2, 10 ether);

        // Create request
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Both XLPs submit bids
        vm.prank(xlp1);
        crossChainPaymaster.submitBid(requestId);

        vm.prank(xlp2);
        crossChainPaymaster.submitBid(requestId);

        // Check competition info
        (uint256 bidCount, uint256 currentFee, address[] memory bidders, bool hasAllowlist) =
            crossChainPaymaster.getRequestCompetition(requestId);

        assertEq(bidCount, 2);
        assertEq(bidders.length, 2);
        assertFalse(hasAllowlist);
        assertTrue(currentFee >= 0.0001 ether); // MIN_FEE
    }

    function test_MultiXLP_AllowlistBlocksUnauthorizedXLP() public {
        _registerXLP(xlp1, 10 ether);
        _registerXLP(xlp3, 10 ether);

        // Create request with allowlist (only xlp1)
        address[] memory allowedXLPs = new address[](1);
        allowedXLPs[0] = xlp1;

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequestWithAllowlist{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether, allowedXLPs
        );

        // xlp1 can bid
        vm.prank(xlp1);
        crossChainPaymaster.submitBid(requestId);

        // xlp3 cannot bid (not in allowlist)
        vm.prank(xlp3);
        vm.expectRevert(CrossChainPaymaster.XLPNotInAllowlist.selector);
        crossChainPaymaster.submitBid(requestId);
    }

    function test_MultiXLP_CompetitionStatsTracked() public {
        _registerXLP(xlp1, 10 ether);
        _registerXLP(xlp2, 10 ether);

        uint256 numRequests = 3;

        // Create and fulfill multiple requests
        for (uint256 i = 0; i < numRequests; i++) {
            // Use slightly different timestamps to get unique request IDs
            vm.warp(block.timestamp + i + 1);

            vm.prank(user);
            bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 0.2 ether}(
                address(0), 0.1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
            );

            // xlp1 wins without bidding first (direct issue voucher)
            // This tests that issueVoucher still works without explicit bid
            uint256 fee = crossChainPaymaster.getCurrentFee(requestId);
            bytes32 commitment =
                keccak256(abi.encodePacked(requestId, xlp1, uint256(0.1 ether), fee, uint256(L1_CHAIN_ID)));
            bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlp1PrivateKey, ethSignedHash);
            bytes memory signature = abi.encodePacked(r, s, v);

            vm.prank(xlp1);
            crossChainPaymaster.issueVoucher(requestId, signature);
        }

        // Check stats
        CrossChainPaymaster.XLPStats memory xlp1Stats = crossChainPaymaster.getXLPStats(xlp1);

        assertEq(xlp1Stats.wonBids, numRequests);
        assertTrue(xlp1Stats.totalVolume > 0);
    }

    // ============ Dispute Resolution Tests ============

    function test_Dispute_FileWithEvidence() public {
        // Setup: Register XLP and create a slash record
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("test-voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);

        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        // Create dispute evidence
        L1StakeManager.DisputeEvidence memory evidence = L1StakeManager.DisputeEvidence({
            slashId: slashId,
            fulfillmentProof: hex"1234",
            l2StateRoot: keccak256("state-root"),
            l2BlockNumber: 12345,
            merkleProof: hex"5678"
        });

        // File dispute with evidence
        vm.prank(xlp1);
        l1StakeManager.disputeSlashWithEvidence(slashId, evidence);

        // Verify dispute status
        (L1StakeManager.DisputeStatus status, uint256 votesFor, uint256 votesAgainst, uint256 deadline) =
            l1StakeManager.getDisputeDetails(slashId);

        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Pending));
        assertEq(votesFor, 0);
        assertEq(votesAgainst, 0);
        assertTrue(deadline > block.timestamp);
    }

    function test_Dispute_ArbitratorVoting() public {
        // Setup slash and dispute
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("test-voucher-arb");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);

        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        // Register arbitrators
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator2);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        // Arbitrators vote
        vm.prank(arbitrator1);
        l1StakeManager.voteOnDispute(slashId, true); // In favor of XLP

        vm.prank(arbitrator2);
        l1StakeManager.voteOnDispute(slashId, false); // Against XLP

        // Check votes
        (L1StakeManager.DisputeStatus status, uint256 votesFor, uint256 votesAgainst,) =
            l1StakeManager.getDisputeDetails(slashId);

        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Pending));
        assertEq(votesFor, 1);
        assertEq(votesAgainst, 1);
    }

    function test_Dispute_Resolution_XLPWins() public {
        // Setup
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        uint256 xlpStakeBefore = l1StakeManager.getStake(xlp1).stakedAmount;

        bytes32 voucherId = keccak256("test-voucher-win");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);

        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        // Register arbitrators and vote in favor of XLP
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator2);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator1);
        l1StakeManager.voteOnDispute(slashId, true);

        vm.prank(arbitrator2);
        l1StakeManager.voteOnDispute(slashId, true);

        // Fast forward past dispute deadline
        vm.warp(block.timestamp + 2 days);

        // Resolve dispute
        l1StakeManager.resolveDispute(slashId);

        // XLP should get funds back
        uint256 xlpStakeAfter = l1StakeManager.getStake(xlp1).stakedAmount;
        assertEq(xlpStakeAfter, xlpStakeBefore);

        (L1StakeManager.DisputeStatus status,,,) = l1StakeManager.getDisputeDetails(slashId);
        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Resolved));
    }

    // ============ CrossChainMessagingPaymaster Tests ============

    function test_MessagingPaymaster_DepositLiquidity() public {
        vm.startPrank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();
        vm.stopPrank();

        assertEq(messagingPaymaster.getTotalLiquidity(address(0)), 10 ether);
        assertEq(messagingPaymaster.getLiquidityPosition(address(0), xlp1), 10 ether);
    }

    function test_MessagingPaymaster_WithdrawLiquidity() public {
        vm.startPrank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        uint256 balanceBefore = xlp1.balance;
        messagingPaymaster.withdrawLiquidity(address(0), 5 ether);
        uint256 balanceAfter = xlp1.balance;

        vm.stopPrank();

        assertEq(balanceAfter - balanceBefore, 5 ether);
        assertEq(messagingPaymaster.getTotalLiquidity(address(0)), 5 ether);
    }

    function test_MessagingPaymaster_InitiateTransfer() public {
        // Deploy a mock messenger to avoid revert
        MockMessenger mockMessenger = new MockMessenger();
        messagingPaymaster.setMessenger(address(mockMessenger));

        // Setup counterpart
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        // Deposit liquidity
        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        // Initiate transfer
        vm.prank(user);
        bytes32 transferId = messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, L1_CHAIN_ID, user);

        assertTrue(transferId != bytes32(0));

        CrossChainMessagingPaymaster.PendingTransfer memory transfer = messagingPaymaster.getTransfer(transferId);

        assertEq(transfer.sender, user);
        assertEq(transfer.amount, 1 ether);
        assertEq(transfer.destinationChainId, L1_CHAIN_ID);
    }

    function test_MessagingPaymaster_FeeCalculation() public view {
        uint256 amount = 10 ether;
        uint256 fee = messagingPaymaster.calculateFee(amount);

        // Default fee is 10 bps = 0.1%
        assert(fee == amount * 10 / 10000);
    }

    // ============ Helper Functions ============

    function _registerXLP(address xlp, uint256 stake) internal {
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: stake}(chains);
        vm.stopPrank();

        // Update stake on paymaster
        crossChainPaymaster.updateXLPStake(xlp, stake);

        // Deposit liquidity
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: stake * 2}();
    }
}

/**
 * @title MockMessenger
 * @notice Mock cross-domain messenger for testing
 */
contract MockMessenger {
    address public xDomainMessageSender;

    function sendMessage(address, bytes calldata, uint32) external {
        // Do nothing - just accept the call
    }

    function setXDomainMessageSender(address _sender) external {
        xDomainMessageSender = _sender;
    }
}
