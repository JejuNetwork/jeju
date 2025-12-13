// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {CrossChainMessagingPaymaster} from "../src/eil/CrossChainMessagingPaymaster.sol";
import {L2OutputVerifier, IL2OutputOracle} from "../src/eil/L2OutputVerifier.sol";
import {MockEntryPoint} from "./mocks/MockEntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MockCrossDomainMessenger
 * @notice Simulates OP Stack cross-domain messaging for integration tests
 */
contract MockCrossDomainMessenger {
    address public xDomainMsgSender;
    address public targetContract;
    bytes public lastMessage;
    uint32 public lastGasLimit;

    event MessageSent(address indexed target, bytes message, uint32 gasLimit);
    event MessageRelayed(address indexed target, bool success);

    function sendMessage(address _target, bytes calldata _message, uint32 _gasLimit) external {
        targetContract = _target;
        lastMessage = _message;
        lastGasLimit = _gasLimit;
        emit MessageSent(_target, _message, _gasLimit);
    }

    function xDomainMessageSender() external view returns (address) {
        return xDomainMsgSender;
    }

    /// @notice Simulate receiving a message from another chain
    function relayMessage(address _sender, address _target, bytes calldata _message) external {
        xDomainMsgSender = _sender;
        (bool success,) = _target.call(_message);
        emit MessageRelayed(_target, success);
        xDomainMsgSender = address(0);
    }
}

/**
 * @title MockL2OutputOracle
 * @notice Simulates OP Stack L2OutputOracle for integration tests
 */
contract MockL2OutputOracle {
    mapping(uint256 => IL2OutputOracle.OutputProposal) public outputs;
    uint256 public outputCount;
    uint256 public _latestBlockNumber = 1000;

    function addOutput(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber) external {
        outputs[outputCount] =
            IL2OutputOracle.OutputProposal({outputRoot: outputRoot, timestamp: timestamp, l2BlockNumber: l2BlockNumber});
        outputCount++;
        if (l2BlockNumber > _latestBlockNumber) {
            _latestBlockNumber = l2BlockNumber;
        }
    }

    function getL2Output(uint256 _l2OutputIndex) external view returns (IL2OutputOracle.OutputProposal memory) {
        return outputs[_l2OutputIndex];
    }

    function getL2OutputIndexAfter(uint256 _l2BlockNumber) external view returns (uint256) {
        for (uint256 i = 0; i < outputCount; i++) {
            if (outputs[i].l2BlockNumber >= _l2BlockNumber) {
                return i;
            }
        }
        revert("Block not found");
    }

    function latestOutputIndex() external view returns (uint256) {
        return outputCount > 0 ? outputCount - 1 : 0;
    }

    function startingBlockNumber() external pure returns (uint256) {
        return 1000;
    }

    function latestBlockNumber() external view returns (uint256) {
        return _latestBlockNumber;
    }
}

/**
 * @title EILIntegrationTest
 * @notice End-to-end integration tests for EIL cross-chain flow
 * @dev Tests the complete lifecycle:
 *      1. XLP registration on L1
 *      2. Stake sync to L2 via cross-chain message
 *      3. User creates voucher request on L2
 *      4. XLP issues and fulfills voucher
 *      5. XLP claims source funds after fraud proof window
 *      6. Dispute resolution with L2 state verification
 */
contract EILIntegrationTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Contracts
    L1StakeManager public l1StakeManager;
    CrossChainPaymaster public l2Paymaster;
    CrossChainMessagingPaymaster public l2MessagingPaymaster;
    L2OutputVerifier public l2OutputVerifier;
    MockEntryPoint public entryPoint;
    MockCrossDomainMessenger public l1Messenger;
    MockCrossDomainMessenger public l2Messenger;
    MockL2OutputOracle public l2OutputOracle;

    // Accounts
    address public deployer;
    address public xlp;
    address public user;
    address public arbitrator;

    uint256 public xlpPrivateKey;
    uint256 public userPrivateKey;

    // Chain IDs
    uint256 constant L1_CHAIN_ID = 11155111; // Sepolia
    uint256 constant L2_CHAIN_ID = 84532; // Base Sepolia

    function setUp() public {
        // Warp to reasonable timestamp
        vm.warp(1_700_000_000);

        // Setup accounts
        deployer = address(this);
        xlpPrivateKey = 0xA11CE;
        userPrivateKey = 0xB0B;
        xlp = vm.addr(xlpPrivateKey);
        user = vm.addr(userPrivateKey);
        arbitrator = address(0xABCD);

        // Fund accounts
        vm.deal(xlp, 100 ether);
        vm.deal(user, 100 ether);
        vm.deal(arbitrator, 10 ether);

        // Deploy mock messengers
        l1Messenger = new MockCrossDomainMessenger();
        l2Messenger = new MockCrossDomainMessenger();

        // Deploy mock L2OutputOracle
        l2OutputOracle = new MockL2OutputOracle();

        // Deploy L1 contracts
        l1StakeManager = new L1StakeManager();
        l1StakeManager.setMessenger(address(l1Messenger));

        // Deploy L2OutputVerifier and configure
        l2OutputVerifier = new L2OutputVerifier();
        l2OutputVerifier.registerOracle(L2_CHAIN_ID, address(l2OutputOracle), false);
        l1StakeManager.setStateRootVerifier(address(l2OutputVerifier));

        // Deploy L2 contracts
        entryPoint = new MockEntryPoint();
        l2Paymaster =
            new CrossChainPaymaster(IEntryPoint(address(entryPoint)), address(l1StakeManager), L2_CHAIN_ID, address(0));
        l2Paymaster.setMessenger(address(l2Messenger));
        l2Paymaster.setTokenSupport(address(0), true);

        l2MessagingPaymaster = new CrossChainMessagingPaymaster(L2_CHAIN_ID);
        l2MessagingPaymaster.setMessenger(address(l2Messenger));
        l2MessagingPaymaster.setTokenSupport(address(0), true);

        // Configure L1→L2 bridge
        l1StakeManager.registerL2Paymaster(L2_CHAIN_ID, address(l2Paymaster));

        // Set chain-specific unbonding period
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 7 days);
    }

    // ============ Full Cross-Chain Flow Test ============

    function test_FullCrossChainFlow() public {
        // === Step 1: XLP registers on L1 ===
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        assertEq(l1StakeManager.totalStaked(), 10 ether);
        assertTrue(l1StakeManager.isXLPActive(xlp));

        // === Step 2: Sync stake to L2 ===
        vm.prank(xlp);
        l1StakeManager.syncStakeToL2(L2_CHAIN_ID, xlp);

        // Verify message was sent
        assertEq(l1Messenger.targetContract(), address(l2Paymaster));

        // Simulate L1→L2 message relay
        l2Messenger.relayMessage(address(l1StakeManager), address(l2Paymaster), l1Messenger.lastMessage());

        // Verify stake is now synced on L2
        assertEq(l2Paymaster.xlpVerifiedStake(xlp), 10 ether);

        // === Step 3: XLP deposits liquidity on L2 ===
        vm.prank(xlp);
        l2Paymaster.depositETH{value: 5 ether}();
        assertEq(l2Paymaster.getXLPETH(xlp), 5 ether);

        // === Step 4: User creates voucher request ===
        uint256 transferAmount = 1 ether;
        uint256 maxFee = 0.01 ether;
        uint256 feeIncrement = 0.0001 ether;

        vm.prank(user);
        bytes32 requestId = l2Paymaster.createVoucherRequest{value: transferAmount + maxFee}(
            address(0), // ETH
            transferAmount,
            address(0), // destination ETH
            L1_CHAIN_ID, // destination chain (pretend cross-chain)
            user, // recipient
            0.001 ether, // gas on destination
            maxFee,
            feeIncrement
        );

        // Verify request created
        CrossChainPaymaster.VoucherRequest memory request = l2Paymaster.getRequest(requestId);
        assertEq(request.requester, user);
        assertEq(request.amount, transferAmount);

        // === Step 5: XLP submits bid ===
        vm.prank(xlp);
        l2Paymaster.submitBid(requestId);

        // Check bid recorded
        CrossChainPaymaster.XLPStats memory stats = l2Paymaster.getXLPStats(xlp);
        assertEq(stats.totalBids, 1);

        // === Step 6: XLP issues voucher ===
        uint256 currentFee = l2Paymaster.getCurrentFee(requestId);

        // Create XLP signature
        bytes32 commitment =
            keccak256(abi.encodePacked(requestId, xlp, request.amount, currentFee, request.destinationChainId));
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp);
        bytes32 voucherId = l2Paymaster.issueVoucher(requestId, signature);

        // Verify voucher issued
        CrossChainPaymaster.Voucher memory voucher = l2Paymaster.getVoucher(voucherId);
        assertEq(voucher.xlp, xlp);
        assertEq(voucher.amount, transferAmount);
        assertFalse(voucher.fulfilled);

        // === Step 7: Simulate fulfillment on destination chain ===
        // In reality, this happens on destination L2
        // Here we manually mark as fulfilled (simulating cross-chain relay)
        l2Paymaster.markVoucherFulfilled(voucherId);
        assertTrue(l2Paymaster.getVoucher(voucherId).fulfilled);

        // === Step 8: Wait for claim delay and claim source funds ===
        vm.warp(block.timestamp + 200); // Past CLAIM_DELAY blocks worth of time
        vm.roll(block.number + 200);

        uint256 xlpBalanceBefore = xlp.balance;
        vm.prank(xlp);
        l2Paymaster.claimSourceFunds(voucherId);

        // XLP received: amount + fee
        uint256 expectedReceived = transferAmount + currentFee;
        assertEq(xlp.balance - xlpBalanceBefore, expectedReceived);

        // Verify voucher marked as claimed
        assertTrue(l2Paymaster.getVoucher(voucherId).claimed);
    }

    // ============ Dispute Resolution Flow Test ============

    function test_DisputeResolutionFlow() public {
        // Setup: XLP registered and slashed
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        // Authorize a slasher
        l1StakeManager.setAuthorizedSlasher(address(this), true);

        // Create slash record
        bytes32 voucherId = keccak256("test-voucher");
        l1StakeManager.slash(xlp, L2_CHAIN_ID, voucherId, 2 ether, user);

        // Verify slash executed
        bytes32 slashId = keccak256(abi.encodePacked(xlp, L2_CHAIN_ID, voucherId));
        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertTrue(stake.slashedAmount > 0);

        // === XLP disputes the slash ===
        vm.prank(xlp);
        l1StakeManager.disputeSlash(slashId);

        // Verify dispute filed
        (L1StakeManager.DisputeStatus status,,,) = l1StakeManager.getDisputeDetails(slashId);
        assertEq(uint256(status), uint256(L1StakeManager.DisputeStatus.Pending));

        // === Register arbitrator ===
        vm.prank(arbitrator);
        l1StakeManager.registerArbitrator{value: 5 ether}();

        // === Arbitrator votes in favor of XLP ===
        vm.prank(arbitrator);
        l1StakeManager.voteOnDispute(slashId, true); // In favor of XLP

        // === Wait for dispute deadline and resolve ===
        vm.warp(block.timestamp + 2 days);

        l1StakeManager.resolveDispute(slashId);

        // Verify dispute resolved in XLP's favor
        (status,,,) = l1StakeManager.getDisputeDetails(slashId);
        assertEq(uint256(status), uint256(L1StakeManager.DisputeStatus.Resolved));

        // XLP's stake should be restored
        stake = l1StakeManager.getStake(xlp);
        assertEq(stake.slashedAmount, 0);
    }

    // ============ State Root Verification Test ============

    function test_L2StateRootVerification() public {
        // Setup: Add a finalized output to the mock oracle
        bytes32 stateRoot = keccak256("state-root");
        bytes32 messagePasserRoot = keccak256("message-passer-root");
        bytes32 blockHash = keccak256("block-hash");
        bytes32 outputRoot = keccak256(abi.encode(bytes32(0), stateRoot, messagePasserRoot, blockHash));

        // Add output from 8 days ago (finalized)
        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        l2OutputOracle.addOutput(outputRoot, oldTimestamp, 2000);

        // Verify block exists and is finalized
        (bool exists, bool finalized, bytes32 root) = l2OutputVerifier.verifyBlockExists(L2_CHAIN_ID, 2000);
        assertTrue(exists);
        assertTrue(finalized);
        assertEq(root, outputRoot);

        // Verify full state root
        bool valid = l2OutputVerifier.verifyStateRoot(L2_CHAIN_ID, 2000, stateRoot, messagePasserRoot, blockHash);
        assertTrue(valid);
    }

    // ============ Chain-Specific Unbonding Test ============

    function test_ChainSpecificUnbondingPeriod() public {
        // Register XLP
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);

        // Start unbonding
        l1StakeManager.startUnbonding(5 ether);
        vm.stopPrank();

        // Get effective unbonding period (should be 7 days for Base Sepolia)
        uint256 unbondingPeriod = l1StakeManager.getXLPUnbondingPeriod(xlp);
        assertEq(unbondingPeriod, 7 days);

        // Cannot complete before period
        vm.warp(block.timestamp + 6 days);
        vm.prank(xlp);
        vm.expectRevert(L1StakeManager.UnbondingNotComplete.selector);
        l1StakeManager.completeUnbonding();

        // Can complete after period
        vm.warp(block.timestamp + 2 days); // Now 8 days total
        vm.prank(xlp);
        l1StakeManager.completeUnbonding();

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertEq(stake.unbondingAmount, 0);
    }

    // ============ Multi-XLP Competition Test ============

    function test_MultiXLPCompetition() public {
        address xlp2 = address(0x2222);
        vm.deal(xlp2, 100 ether);

        // Register both XLPs on L1
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        vm.startPrank(xlp2);
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        // Sync stakes to L2
        vm.prank(xlp);
        l1StakeManager.syncStakeToL2(L2_CHAIN_ID, xlp);
        l2Messenger.relayMessage(address(l1StakeManager), address(l2Paymaster), l1Messenger.lastMessage());

        vm.prank(xlp2);
        l1StakeManager.syncStakeToL2(L2_CHAIN_ID, xlp2);
        l2Messenger.relayMessage(address(l1StakeManager), address(l2Paymaster), l1Messenger.lastMessage());

        // User creates request
        vm.prank(user);
        bytes32 requestId = l2Paymaster.createVoucherRequest{value: 1.01 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.01 ether, 0.0001 ether
        );

        // Both XLPs bid
        vm.prank(xlp);
        l2Paymaster.submitBid(requestId);

        vm.prank(xlp2);
        l2Paymaster.submitBid(requestId);

        // Check competition stats
        (uint256 bidCount, uint256 currentFee, address[] memory bidders, bool hasAllowlist) =
            l2Paymaster.getRequestCompetition(requestId);

        assertEq(bidCount, 2);
        assertEq(bidders.length, 2);
        assertFalse(hasAllowlist);
        assertTrue(currentFee > 0);

        // First XLP to issue voucher wins
        bytes32 commitment =
            keccak256(abi.encodePacked(requestId, xlp, uint256(1 ether), currentFee, uint256(L1_CHAIN_ID)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, commitment.toEthSignedMessageHash());

        vm.prank(xlp);
        l2Paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));

        // Check XLP stats updated
        CrossChainPaymaster.XLPStats memory winnerStats = l2Paymaster.getXLPStats(xlp);
        assertEq(winnerStats.wonBids, 1);

        CrossChainPaymaster.XLPStats memory loserStats = l2Paymaster.getXLPStats(xlp2);
        assertEq(loserStats.lostBids, 1);
    }

    // ============ Messaging Paymaster Fallback Test ============

    function test_MessagingPaymasterFallback() public {
        // Setup: Register counterpart first (required for transfer)
        address counterpart = address(0x1234);
        l2MessagingPaymaster.registerCounterpart(L1_CHAIN_ID, counterpart);

        // Setup: Add liquidity to messaging paymaster
        vm.prank(xlp);
        l2MessagingPaymaster.depositETH{value: 10 ether}();

        // User initiates transfer via messaging paymaster (slower but trustless)
        uint256 transferAmount = 1 ether;
        vm.prank(user);
        bytes32 transferId = l2MessagingPaymaster.initiateTransfer{value: transferAmount}(
            address(0), // ETH
            transferAmount,
            L1_CHAIN_ID, // destination
            user // recipient
        );

        // Verify transfer recorded
        CrossChainMessagingPaymaster.PendingTransfer memory transfer = l2MessagingPaymaster.getTransfer(transferId);
        assertEq(transfer.sender, user);
        assertEq(transfer.amount, transferAmount);
        assertFalse(transfer.completed);

        // Verify cross-chain message was sent to counterpart
        assertEq(l2Messenger.targetContract(), counterpart);

        uint256 fee = l2MessagingPaymaster.calculateFee(transferAmount);
        assertTrue(fee > 0);
        assertTrue(l2MessagingPaymaster.canComplete(address(0), transferAmount - fee));
    }
}
