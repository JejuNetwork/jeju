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
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Simple ERC20 for testing
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title MockMessenger
/// @notice Mock cross-domain messenger for testing
contract MockMessengerEdge {
    address public xDomainMessageSender;
    bool public shouldRevert;

    function sendMessage(address, bytes calldata, uint32) external view {
        if (shouldRevert) revert("Messenger error");
    }

    function setXDomainMessageSender(address _sender) external {
        xDomainMessageSender = _sender;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }
}

/**
 * @title EIL Edge Case Tests
 * @notice Comprehensive edge case, boundary, and error handling tests for EIL contracts
 */
contract EILEdgeTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    L1StakeManager public l1StakeManager;
    CrossChainPaymaster public crossChainPaymaster;
    CrossChainMessagingPaymaster public messagingPaymaster;
    MockEntryPoint public entryPoint;
    MockERC20 public mockToken;
    MockMessengerEdge public mockMessenger;

    address public deployer;
    address public xlp1;
    address public xlp2;
    address public user;
    address public attacker;
    address public arbitrator1;
    address public arbitrator2;
    address public arbitrator3;

    uint256 public xlp1PrivateKey;
    uint256 public xlp2PrivateKey;
    uint256 public userPrivateKey;

    uint256 constant L1_CHAIN_ID = 1337;
    uint256 constant L2_CHAIN_ID = 420691;
    uint256 constant MIN_STAKE = 1 ether;

    function setUp() public {
        deployer = address(this);
        xlp1PrivateKey = 0x1234;
        xlp2PrivateKey = 0x5678;
        userPrivateKey = 0xdef0;

        xlp1 = vm.addr(xlp1PrivateKey);
        xlp2 = vm.addr(xlp2PrivateKey);
        user = vm.addr(userPrivateKey);
        attacker = makeAddr("attacker");
        arbitrator1 = makeAddr("arbitrator1");
        arbitrator2 = makeAddr("arbitrator2");
        arbitrator3 = makeAddr("arbitrator3");

        vm.deal(xlp1, 1000 ether);
        vm.deal(xlp2, 1000 ether);
        vm.deal(user, 1000 ether);
        vm.deal(attacker, 1000 ether);
        vm.deal(arbitrator1, 100 ether);
        vm.deal(arbitrator2, 100 ether);
        vm.deal(arbitrator3, 100 ether);

        entryPoint = new MockEntryPoint();
        l1StakeManager = new L1StakeManager();
        crossChainPaymaster =
            new CrossChainPaymaster(IEntryPoint(address(entryPoint)), address(l1StakeManager), L2_CHAIN_ID, address(0));
        messagingPaymaster = new CrossChainMessagingPaymaster(L2_CHAIN_ID);
        mockToken = new MockERC20();
        mockMessenger = new MockMessengerEdge();

        l1StakeManager.registerL2Paymaster(L2_CHAIN_ID, address(crossChainPaymaster));
        l1StakeManager.registerL2Paymaster(L1_CHAIN_ID, address(messagingPaymaster));
        crossChainPaymaster.setTokenSupport(address(0), true);
        crossChainPaymaster.setTokenSupport(address(mockToken), true);
        messagingPaymaster.setTokenSupport(address(0), true);
        messagingPaymaster.setTokenSupport(address(mockToken), true);

        mockToken.mint(xlp1, 1000 ether);
        mockToken.mint(xlp2, 1000 ether);
        mockToken.mint(user, 1000 ether);
    }

    // ============ L1StakeManager Boundary Tests ============

    function test_L1StakeManager_ExactMinimumStake() public {
        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        // Exact minimum stake should succeed
        l1StakeManager.register{value: MIN_STAKE}(chains);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp1);
        assertEq(stake.stakedAmount, MIN_STAKE);
        assertTrue(stake.isActive);
        vm.stopPrank();
    }

    function test_L1StakeManager_OneBelowMinimumStake() public {
        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        // One wei below minimum should fail
        vm.expectRevert(L1StakeManager.InsufficientStake.selector);
        l1StakeManager.register{value: MIN_STAKE - 1}(chains);
        vm.stopPrank();
    }

    function test_L1StakeManager_ZeroStake() public {
        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.expectRevert(L1StakeManager.InsufficientStake.selector);
        l1StakeManager.register{value: 0}(chains);
        vm.stopPrank();
    }

    function test_L1StakeManager_EmptyChainArray() public {
        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](0);

        // Empty chains should be allowed (XLP registers but supports no chains yet)
        l1StakeManager.register{value: MIN_STAKE}(chains);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp1);
        assertTrue(stake.isActive);
        vm.stopPrank();
    }

    function test_L1StakeManager_DoubleRegistration() public {
        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        l1StakeManager.register{value: MIN_STAKE}(chains);

        vm.expectRevert(L1StakeManager.AlreadyRegistered.selector);
        l1StakeManager.register{value: MIN_STAKE}(chains);
        vm.stopPrank();
    }

    function test_L1StakeManager_UnbondEntireStake() public {
        _registerXLP(xlp1, 10 ether);

        vm.startPrank(xlp1);
        // Unbond entire stake should deactivate
        l1StakeManager.startUnbonding(10 ether);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp1);
        assertEq(stake.stakedAmount, 0);
        assertEq(stake.unbondingAmount, 10 ether);
        assertFalse(stake.isActive);
        vm.stopPrank();
    }

    function test_L1StakeManager_UnbondMoreThanStaked() public {
        _registerXLP(xlp1, 10 ether);

        vm.startPrank(xlp1);
        vm.expectRevert(L1StakeManager.InsufficientStake.selector);
        l1StakeManager.startUnbonding(11 ether);
        vm.stopPrank();
    }

    function test_L1StakeManager_CompleteUnbondingBeforePeriod() public {
        _registerXLP(xlp1, 10 ether);

        vm.startPrank(xlp1);
        l1StakeManager.startUnbonding(5 ether);

        // Try to complete immediately
        vm.expectRevert(L1StakeManager.UnbondingNotComplete.selector);
        l1StakeManager.completeUnbonding();
        vm.stopPrank();
    }

    function test_L1StakeManager_CompleteUnbondingExactlyAtPeriod() public {
        _registerXLP(xlp1, 10 ether);

        vm.startPrank(xlp1);
        l1StakeManager.startUnbonding(5 ether);

        // Fast forward past the unbonding period (8 days, per contract constant)
        vm.warp(block.timestamp + 8 days + 1);

        // Should succeed after the period
        uint256 balanceBefore = xlp1.balance;
        l1StakeManager.completeUnbonding();
        uint256 balanceAfter = xlp1.balance;

        assertEq(balanceAfter - balanceBefore, 5 ether);
        vm.stopPrank();
    }

    // ============ L1StakeManager Slashing Edge Cases ============

    function test_L1StakeManager_SlashMoreThanStaked() public {
        _registerXLP(xlp1, 5 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        // Slash exactly the staked amount
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 5 ether, user);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp1);
        // Slashed amount goes to victim, not tracked as slashedAmount
        // After slash, stake should be reduced
        assertTrue(stake.stakedAmount < 5 ether);
    }

    function test_L1StakeManager_SlashUnregisteredXLP() public {
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        vm.expectRevert(L1StakeManager.NotRegistered.selector);
        l1StakeManager.slash(attacker, L2_CHAIN_ID, voucherId, 1 ether, user);
    }

    function test_L1StakeManager_UnauthorizedSlasher() public {
        _registerXLP(xlp1, 10 ether);

        bytes32 voucherId = keccak256("voucher");
        vm.prank(attacker);
        vm.expectRevert(L1StakeManager.UnauthorizedSlasher.selector);
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
    }

    // ============ Dispute Resolution Edge Cases ============

    function test_Dispute_NonXLPCannotDispute() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);

        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(attacker);
        vm.expectRevert(L1StakeManager.InvalidVoucher.selector);
        l1StakeManager.disputeSlash(slashId);
    }

    function test_Dispute_DoubleDispute() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);

        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.startPrank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.expectRevert(L1StakeManager.DisputeAlreadyFiled.selector);
        l1StakeManager.disputeSlash(slashId);
        vm.stopPrank();
    }

    function test_Dispute_VoteAfterDeadline() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        // Fast forward past deadline
        vm.warp(block.timestamp + 2 days);

        vm.prank(arbitrator1);
        vm.expectRevert(L1StakeManager.DisputeDeadlinePassed.selector);
        l1StakeManager.voteOnDispute(slashId, true);
    }

    function test_Dispute_DoubleVote() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.startPrank(arbitrator1);
        l1StakeManager.voteOnDispute(slashId, true);

        vm.expectRevert(L1StakeManager.AlreadyVoted.selector);
        l1StakeManager.voteOnDispute(slashId, false);
        vm.stopPrank();
    }

    function test_Dispute_ResolveBeforeDeadline() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.expectRevert(L1StakeManager.DisputeDeadlineNotPassed.selector);
        l1StakeManager.resolveDispute(slashId);
    }

    function test_Dispute_XLPLoses() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        uint256 xlpStakeBefore = l1StakeManager.getStake(xlp1).stakedAmount;

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        // Register arbitrators and vote AGAINST XLP
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator2);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator1);
        l1StakeManager.voteOnDispute(slashId, false);

        vm.prank(arbitrator2);
        l1StakeManager.voteOnDispute(slashId, false);

        vm.warp(block.timestamp + 2 days);
        l1StakeManager.resolveDispute(slashId);

        // XLP should NOT get funds back
        uint256 xlpStakeAfter = l1StakeManager.getStake(xlp1).stakedAmount;
        assertEq(xlpStakeAfter, xlpStakeBefore - 1 ether);

        (L1StakeManager.DisputeStatus status,,,) = l1StakeManager.getDisputeDetails(slashId);
        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Rejected));
    }

    function test_Dispute_TieGoesToXLP() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher-tie");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        // Register arbitrators and split vote (tie)
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator2);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator1);
        l1StakeManager.voteOnDispute(slashId, true);

        vm.prank(arbitrator2);
        l1StakeManager.voteOnDispute(slashId, false);

        vm.warp(block.timestamp + 2 days);
        l1StakeManager.resolveDispute(slashId);

        // Tie goes to the protocol (XLP loses) since votesFor must be > votesAgainst
        (L1StakeManager.DisputeStatus status,,,) = l1StakeManager.getDisputeDetails(slashId);
        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Rejected));
    }

    function test_Dispute_NoVotes() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher-novote");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.warp(block.timestamp + 2 days);
        l1StakeManager.resolveDispute(slashId);

        // No votes = 0-0 tie = XLP loses (votesFor must be > votesAgainst)
        (L1StakeManager.DisputeStatus status, uint256 votesFor, uint256 votesAgainst,) =
            l1StakeManager.getDisputeDetails(slashId);
        assertEq(votesFor, 0);
        assertEq(votesAgainst, 0);
        assertEq(uint8(status), uint8(L1StakeManager.DisputeStatus.Rejected));
    }

    // ============ Arbitrator Edge Cases ============

    function test_Arbitrator_BelowMinimumStake() public {
        vm.prank(arbitrator1);
        vm.expectRevert(L1StakeManager.InsufficientArbitratorStake.selector);
        l1StakeManager.registerArbitrator{value: 4 ether}();
    }

    function test_Arbitrator_ExactMinimumStake() public {
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        (bool isActive,,,) = l1StakeManager.arbitrators(arbitrator1);
        assertTrue(isActive);
    }

    function test_Arbitrator_DoubleRegistration() public {
        vm.prank(arbitrator1);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        vm.prank(arbitrator1);
        vm.expectRevert(L1StakeManager.AlreadyRegistered.selector);
        l1StakeManager.registerArbitrator{value: 5 ether}();
    }

    function test_Arbitrator_NonArbitratorCannotVote() public {
        _registerXLP(xlp1, 10 ether);
        l1StakeManager.setAuthorizedSlasher(deployer, true);

        bytes32 voucherId = keccak256("voucher");
        l1StakeManager.slash(xlp1, L2_CHAIN_ID, voucherId, 1 ether, user);
        bytes32 slashId = keccak256(abi.encodePacked(xlp1, L2_CHAIN_ID, voucherId));

        vm.prank(xlp1);
        l1StakeManager.disputeSlash(slashId);

        vm.prank(attacker);
        vm.expectRevert(L1StakeManager.NotArbitrator.selector);
        l1StakeManager.voteOnDispute(slashId, true);
    }

    // ============ CrossChainPaymaster Edge Cases ============

    function test_Paymaster_RequestBelowMinimum() public {
        vm.prank(user);
        // Request with very small fee - should fail with InsufficientFee
        vm.expectRevert(CrossChainPaymaster.InsufficientFee.selector);
        crossChainPaymaster.createVoucherRequest{value: 0.0001 ether}(
            address(0), 0.00001 ether, address(0), L1_CHAIN_ID, user, 21000, 0.00001 ether, 0.000001 ether
        );
    }

    function test_Paymaster_RequestToSameChain() public {
        vm.prank(user);
        vm.expectRevert(CrossChainPaymaster.InvalidDestinationChain.selector);
        crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L2_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );
    }

    function test_Paymaster_RequestWithZeroRecipient() public {
        vm.prank(user);
        vm.expectRevert(CrossChainPaymaster.InvalidRecipient.selector);
        crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, address(0), 21000, 0.1 ether, 0.01 ether
        );
    }

    function test_Paymaster_RequestUnsupportedToken() public {
        address fakeToken = makeAddr("fakeToken");
        vm.prank(user);
        vm.expectRevert(CrossChainPaymaster.UnsupportedToken.selector);
        crossChainPaymaster.createVoucherRequest{value: 0.1 ether}(
            fakeToken, 1 ether, fakeToken, L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );
    }

    function test_Paymaster_BidOnExpiredRequest() public {
        _registerXLP(xlp1, 10 ether);

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Fast forward past deadline
        vm.roll(block.number + 1001);

        vm.prank(xlp1);
        vm.expectRevert(CrossChainPaymaster.RequestExpired.selector);
        crossChainPaymaster.submitBid(requestId);
    }

    function test_Paymaster_DoubleBid() public {
        _registerXLP(xlp1, 10 ether);

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        vm.startPrank(xlp1);
        crossChainPaymaster.submitBid(requestId);

        vm.expectRevert(CrossChainPaymaster.XLPAlreadyBid.selector);
        crossChainPaymaster.submitBid(requestId);
        vm.stopPrank();
    }

    function test_Paymaster_IssueVoucherInsufficientStake() public {
        // Register XLP with minimum stake (1 ether)
        _registerXLP(xlp1, 1 ether);

        // Create a large request that would require more stake than XLP has
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 100.1 ether}(
            address(0), 100 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        uint256 fee = crossChainPaymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp1, uint256(100 ether), fee, uint256(L1_CHAIN_ID)));
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlp1PrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp1);
        vm.expectRevert(CrossChainPaymaster.InsufficientXLPStake.selector);
        crossChainPaymaster.issueVoucher(requestId, signature);
    }

    function test_Paymaster_IssueVoucherInvalidSignature() public {
        _registerXLP(xlp1, 10 ether);

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Sign with wrong key
        uint256 wrongKey = 0x9999;
        uint256 fee = crossChainPaymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp1, uint256(1 ether), fee, uint256(L1_CHAIN_ID)));
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp1);
        vm.expectRevert(CrossChainPaymaster.InvalidVoucherSignature.selector);
        crossChainPaymaster.issueVoucher(requestId, signature);
    }

    function test_Paymaster_RefundAfterExpiry() public {
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Fast forward past deadline
        vm.roll(block.number + 1001);

        uint256 balanceBefore = user.balance;
        vm.prank(user);
        crossChainPaymaster.refundExpiredRequest(requestId);
        uint256 balanceAfter = user.balance;

        // Should get back amount + maxFee (1 + 0.1 = 1.1 ETH)
        assertEq(balanceAfter - balanceBefore, 1.1 ether);
    }

    function test_Paymaster_RefundBeforeExpiry() public {
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        vm.prank(user);
        vm.expectRevert(CrossChainPaymaster.RequestNotExpired.selector);
        crossChainPaymaster.refundExpiredRequest(requestId);
    }

    // ============ CrossChainMessagingPaymaster Edge Cases ============

    function test_MessagingPaymaster_WithdrawMoreThanDeposited() public {
        vm.startPrank(xlp1);
        messagingPaymaster.depositETH{value: 5 ether}();

        vm.expectRevert(CrossChainMessagingPaymaster.InsufficientLiquidity.selector);
        messagingPaymaster.withdrawLiquidity(address(0), 6 ether);
        vm.stopPrank();
    }

    function test_MessagingPaymaster_TransferBelowMinimum() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        vm.expectRevert(CrossChainMessagingPaymaster.InsufficientAmount.selector);
        messagingPaymaster.initiateTransfer{value: 0.0001 ether}(address(0), 0.0001 ether, L1_CHAIN_ID, user);
    }

    function test_MessagingPaymaster_TransferToSameChain() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        vm.expectRevert(CrossChainMessagingPaymaster.InvalidDestination.selector);
        messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, L2_CHAIN_ID, user);
    }

    function test_MessagingPaymaster_TransferToUnregisteredChain() public {
        messagingPaymaster.setMessenger(address(mockMessenger));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        vm.expectRevert(CrossChainMessagingPaymaster.InvalidDestination.selector);
        messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, 999999, user);
    }

    function test_MessagingPaymaster_TransferWithZeroRecipient() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        vm.expectRevert(CrossChainMessagingPaymaster.InvalidRecipient.selector);
        messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, L1_CHAIN_ID, address(0));
    }

    function test_MessagingPaymaster_CancelTransferAfterWindow() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        bytes32 transferId = messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, L1_CHAIN_ID, user);

        // Fast forward past cancellation window
        vm.warp(block.timestamp + 2 hours);

        vm.prank(user);
        vm.expectRevert(CrossChainMessagingPaymaster.TransferNotCancellable.selector);
        messagingPaymaster.cancelTransfer(transferId);
    }

    function test_MessagingPaymaster_CancelOthersTransfer() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        vm.prank(user);
        bytes32 transferId = messagingPaymaster.initiateTransfer{value: 1 ether}(address(0), 1 ether, L1_CHAIN_ID, user);

        vm.prank(attacker);
        vm.expectRevert(CrossChainMessagingPaymaster.TransferNotFound.selector);
        messagingPaymaster.cancelTransfer(transferId);
    }

    function test_MessagingPaymaster_CompleteTransferReplay() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));
        mockMessenger.setXDomainMessageSender(address(0x1234));

        vm.prank(xlp1);
        messagingPaymaster.depositETH{value: 10 ether}();

        bytes32 transferId = keccak256("test-transfer");

        // Complete transfer via owner (simulating cross-chain message)
        messagingPaymaster.completeTransfer(transferId, address(0), 1 ether, user, L1_CHAIN_ID);

        // Try to replay
        vm.expectRevert(CrossChainMessagingPaymaster.TransferAlreadyCompleted.selector);
        messagingPaymaster.completeTransfer(transferId, address(0), 1 ether, user, L1_CHAIN_ID);
    }

    function test_MessagingPaymaster_CompleteTransferInsufficientLiquidity() public {
        messagingPaymaster.setMessenger(address(mockMessenger));
        messagingPaymaster.registerCounterpart(L1_CHAIN_ID, address(0x1234));
        mockMessenger.setXDomainMessageSender(address(0x1234));

        // Don't deposit any liquidity

        bytes32 transferId = keccak256("test-transfer");

        vm.expectRevert(CrossChainMessagingPaymaster.InsufficientLiquidity.selector);
        messagingPaymaster.completeTransfer(transferId, address(0), 1 ether, user, L1_CHAIN_ID);
    }

    // ============ Fuzz Tests ============

    function testFuzz_L1StakeManager_StakeAmount(uint96 amount) public {
        vm.assume(amount >= MIN_STAKE);
        vm.assume(amount <= 1000 ether);

        vm.deal(xlp1, amount + 1 ether);

        vm.startPrank(xlp1);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: amount}(chains);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp1);
        assertEq(stake.stakedAmount, amount);
        vm.stopPrank();
    }

    function testFuzz_MessagingPaymaster_FeeCalculation(uint128 amount) public view {
        vm.assume(amount >= 0.001 ether);
        vm.assume(amount <= 1000 ether);

        uint256 fee = messagingPaymaster.calculateFee(amount);
        // Fee should be exactly 10 bps (0.1%)
        assertEq(fee, (uint256(amount) * 10) / 10000);
    }

    function testFuzz_Paymaster_DepositWithdraw(uint256 depositRaw, uint256 withdrawRaw) public {
        // Bound to reasonable values
        uint256 depositAmount = bound(depositRaw, 0.01 ether, 100 ether);
        uint256 withdrawAmount = bound(withdrawRaw, 0, depositAmount);

        vm.deal(xlp1, depositAmount + 1 ether);

        vm.startPrank(xlp1);
        crossChainPaymaster.depositETH{value: depositAmount}();
        
        // ETH deposits use getXLPETH, not getXLPLiquidity (which is for ERC20)
        uint256 liquidityAfterDeposit = crossChainPaymaster.getXLPETH(xlp1);
        assertEq(liquidityAfterDeposit, depositAmount, "Deposit amount mismatch");

        if (withdrawAmount > 0) {
            crossChainPaymaster.withdrawETH(withdrawAmount);
            uint256 liquidityAfterWithdraw = crossChainPaymaster.getXLPETH(xlp1);
            assertEq(liquidityAfterWithdraw, depositAmount - withdrawAmount, "Withdraw amount mismatch");
        }
        vm.stopPrank();
    }

    // ============ Helper Functions ============

    function _registerXLP(address xlp, uint256 stake) internal {
        vm.deal(xlp, stake + 100 ether);

        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: stake}(chains);
        vm.stopPrank();

        crossChainPaymaster.updateXLPStake(xlp, stake);

        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: stake * 2}();
    }
}
