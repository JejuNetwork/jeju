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
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20Thorough
contract MockERC20Thorough is ERC20 {
    constructor() ERC20("Test Token", "TEST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title MockMessenger
contract MockMessengerThorough {
    address public xDomainMessageSender;

    function sendMessage(address, bytes calldata, uint32) external {}

    function setXDomainMessageSender(address _sender) external {
        xDomainMessageSender = _sender;
    }
}

/// @title MockL2OutputOracleThorough
contract MockL2OutputOracleThorough {
    mapping(uint256 => IL2OutputOracle.OutputProposal) public outputs;
    uint256 public outputCount;
    uint256 public _latestBlockNumber = 1000;

    function addOutput(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber) external {
        outputs[outputCount] = IL2OutputOracle.OutputProposal({
            outputRoot: outputRoot,
            timestamp: timestamp,
            l2BlockNumber: l2BlockNumber
        });
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
 * @title EIL Thorough Tests
 * @notice Comprehensive testing for boundary conditions, concurrent behavior, and data verification
 */
contract EILThoroughTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Contracts
    L1StakeManager public l1StakeManager;
    CrossChainPaymaster public paymaster;
    CrossChainMessagingPaymaster public messagingPaymaster;
    L2OutputVerifier public verifier;
    MockEntryPoint public entryPoint;
    MockERC20Thorough public token;
    MockMessengerThorough public messenger;
    MockL2OutputOracleThorough public oracle;

    // Accounts - create array for concurrent testing
    address public deployer;
    address[5] public xlps;
    uint256[5] public xlpPrivateKeys;
    address public user;
    uint256 public userPrivateKey;

    // Chain IDs
    uint256 constant L1_CHAIN_ID = 1337;
    uint256 constant L2_CHAIN_ID = 420691;
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function setUp() public {
        vm.warp(1_700_000_000); // Reasonable timestamp

        deployer = address(this);
        userPrivateKey = 0xDEAD;
        user = vm.addr(userPrivateKey);

        // Setup 5 XLPs for concurrent testing
        for (uint256 i = 0; i < 5; i++) {
            xlpPrivateKeys[i] = 0x1000 + i;
            xlps[i] = vm.addr(xlpPrivateKeys[i]);
            vm.deal(xlps[i], 1000 ether);
        }

        vm.deal(user, 100 ether);

        // Deploy contracts
        entryPoint = new MockEntryPoint();
        messenger = new MockMessengerThorough();
        oracle = new MockL2OutputOracleThorough();
        token = new MockERC20Thorough();

        l1StakeManager = new L1StakeManager();
        l1StakeManager.setMessenger(address(messenger));

        verifier = new L2OutputVerifier();
        verifier.registerOracle(L2_CHAIN_ID, address(oracle), false);
        l1StakeManager.setStateRootVerifier(address(verifier));

        paymaster = new CrossChainPaymaster(
            IEntryPoint(address(entryPoint)), address(l1StakeManager), L2_CHAIN_ID, address(0)
        );
        paymaster.setMessenger(address(messenger));
        paymaster.setTokenSupport(address(0), true);
        paymaster.setTokenSupport(address(token), true);

        messagingPaymaster = new CrossChainMessagingPaymaster(L2_CHAIN_ID);
        messagingPaymaster.setMessenger(address(messenger));
        messagingPaymaster.setTokenSupport(address(0), true);

        l1StakeManager.registerL2Paymaster(L2_CHAIN_ID, address(paymaster));
        l1StakeManager.registerL2Paymaster(L1_CHAIN_ID, address(messagingPaymaster));

        // Mint tokens
        for (uint256 i = 0; i < 5; i++) {
            token.mint(xlps[i], 1000 ether);
        }
        token.mint(user, 100 ether);
    }

    // ============ Configurable Unbonding Period Tests ============

    function test_ChainUnbondingPeriod_DefaultValue() public view {
        // Unregistered chain should use default
        uint256 period = l1StakeManager.getChainUnbondingPeriod(99999);
        assertEq(period, 7 days, "Default should be 7 days");
    }

    function test_ChainUnbondingPeriod_SetMinimum() public {
        // Set to minimum (1 hour for ZK chains)
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 1 hours);
        uint256 period = l1StakeManager.chainUnbondingPeriods(L2_CHAIN_ID);
        assertEq(period, 1 hours, "Should be set to 1 hour");
    }

    function test_ChainUnbondingPeriod_SetMaximum() public {
        // Set to maximum (14 days)
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 14 days);
        uint256 period = l1StakeManager.chainUnbondingPeriods(L2_CHAIN_ID);
        assertEq(period, 14 days, "Should be set to 14 days");
    }

    function test_ChainUnbondingPeriod_RevertBelowMinimum() public {
        vm.expectRevert(L1StakeManager.InvalidUnbondingPeriod.selector);
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 59 minutes);
    }

    function test_ChainUnbondingPeriod_RevertAboveMaximum() public {
        vm.expectRevert(L1StakeManager.InvalidUnbondingPeriod.selector);
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 15 days);
    }

    function test_ChainUnbondingPeriod_ExactBoundaryMin() public {
        // Exactly 1 hour should succeed
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 1 hours);
        assertEq(l1StakeManager.chainUnbondingPeriods(L2_CHAIN_ID), 1 hours);
    }

    function test_ChainUnbondingPeriod_ExactBoundaryMax() public {
        // Exactly 14 days should succeed
        l1StakeManager.setChainUnbondingPeriod(L2_CHAIN_ID, 14 days);
        assertEq(l1StakeManager.chainUnbondingPeriods(L2_CHAIN_ID), 14 days);
    }

    function test_XLPUnbondingPeriod_MultiChain() public {
        // Register chain-specific periods
        uint256 zkChainId = 1001;
        uint256 opChainId = 1002;

        l1StakeManager.registerL2Paymaster(zkChainId, address(0x1));
        l1StakeManager.registerL2Paymaster(opChainId, address(0x2));

        l1StakeManager.setChainUnbondingPeriod(zkChainId, 2 hours);
        l1StakeManager.setChainUnbondingPeriod(opChainId, 10 days);

        // Register XLP on both chains
        vm.startPrank(xlps[0]);
        uint256[] memory chains = new uint256[](2);
        chains[0] = zkChainId;
        chains[1] = opChainId;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        // XLP should have maximum unbonding period (10 days)
        uint256 xlpPeriod = l1StakeManager.getXLPUnbondingPeriod(xlps[0]);
        assertEq(xlpPeriod, 10 days, "Should use max across all chains");
    }

    function test_XLPUnbondingPeriod_SingleZKChain() public {
        uint256 zkChainId = 1001;
        l1StakeManager.registerL2Paymaster(zkChainId, address(0x1));
        l1StakeManager.setChainUnbondingPeriod(zkChainId, 2 hours);

        vm.startPrank(xlps[0]);
        uint256[] memory chains = new uint256[](1);
        chains[0] = zkChainId;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        uint256 xlpPeriod = l1StakeManager.getXLPUnbondingPeriod(xlps[0]);
        assertEq(xlpPeriod, 7 days, "Should use default since 2 hours < 7 days default");
    }

    // ============ Concurrent XLP Operations Tests ============

    function test_Concurrent_MultipleXLPsRegister() public {
        // Register all 5 XLPs concurrently
        for (uint256 i = 0; i < 5; i++) {
            vm.startPrank(xlps[i]);
            uint256[] memory chains = new uint256[](1);
            chains[0] = L2_CHAIN_ID;
            l1StakeManager.register{value: (i + 1) * 2 ether}(chains);
            vm.stopPrank();
        }

        // Verify all registered correctly
        uint256 expectedTotal;
        for (uint256 i = 0; i < 5; i++) {
            L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlps[i]);
            assertEq(stake.stakedAmount, (i + 1) * 2 ether, "Stake amount mismatch");
            assertTrue(stake.isActive, "XLP should be active");
            expectedTotal += (i + 1) * 2 ether;
        }

        assertEq(l1StakeManager.totalStaked(), expectedTotal, "Total staked mismatch");
        assertEq(l1StakeManager.activeXLPCount(), 5, "Active count mismatch");
    }

    function test_Concurrent_MultipleBidsOnSameRequest() public {
        // Setup 3 XLPs
        for (uint256 i = 0; i < 3; i++) {
            _registerXLP(xlps[i], 10 ether);
        }

        // User creates request
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // All 3 XLPs bid
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(xlps[i]);
            paymaster.submitBid(requestId);
        }

        // Verify all bids recorded
        (uint256 bidCount,,, bool hasAllowlist) = paymaster.getRequestCompetition(requestId);
        assertEq(bidCount, 3, "Should have 3 bids");
        assertFalse(hasAllowlist, "No allowlist");
    }

    function test_Concurrent_RaceToIssueVoucher() public {
        // Setup 2 XLPs
        _registerXLP(xlps[0], 10 ether);
        _registerXLP(xlps[1], 10 ether);

        // User creates request
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Both XLPs prepare signatures
        uint256 fee = paymaster.getCurrentFee(requestId);

        bytes32 commitment0 = keccak256(abi.encodePacked(requestId, xlps[0], uint256(1 ether), fee, uint256(L1_CHAIN_ID)));
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(xlpPrivateKeys[0], commitment0.toEthSignedMessageHash());
        bytes memory sig0 = abi.encodePacked(r0, s0, v0);

        bytes32 commitment1 = keccak256(abi.encodePacked(requestId, xlps[1], uint256(1 ether), fee, uint256(L1_CHAIN_ID)));
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(xlpPrivateKeys[1], commitment1.toEthSignedMessageHash());
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);

        // XLP[0] issues first - should succeed
        vm.prank(xlps[0]);
        bytes32 voucherId = paymaster.issueVoucher(requestId, sig0);
        assertTrue(voucherId != bytes32(0), "Should issue voucher");

        // XLP[1] tries to issue same request - should fail
        vm.prank(xlps[1]);
        vm.expectRevert(CrossChainPaymaster.RequestAlreadyClaimed.selector);
        paymaster.issueVoucher(requestId, sig1);

        // Verify stats: XLP[0] won, XLP[1] lost
        CrossChainPaymaster.XLPStats memory stats0 = paymaster.getXLPStats(xlps[0]);
        CrossChainPaymaster.XLPStats memory stats1 = paymaster.getXLPStats(xlps[1]);

        assertEq(stats0.wonBids, 1, "XLP[0] should have won");
        assertEq(stats1.lostBids, 0, "XLP[1] shouldn't have lost since they didn't bid");
    }

    function test_Concurrent_SimultaneousUnbonding() public {
        // Register 3 XLPs
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(xlps[i]);
            uint256[] memory chains = new uint256[](1);
            chains[0] = L2_CHAIN_ID;
            l1StakeManager.register{value: 10 ether}(chains);
            vm.stopPrank();
        }

        // All start unbonding simultaneously
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(xlps[i]);
            l1StakeManager.startUnbonding(5 ether);
        }

        // Verify all are unbonding
        for (uint256 i = 0; i < 3; i++) {
            L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlps[i]);
            assertEq(stake.unbondingAmount, 5 ether, "Unbonding amount mismatch");
            assertEq(stake.stakedAmount, 5 ether, "Remaining stake mismatch");
        }

        // Fast forward and complete all unbonding
        vm.warp(block.timestamp + 8 days);

        for (uint256 i = 0; i < 3; i++) {
            uint256 balBefore = xlps[i].balance;
            vm.prank(xlps[i]);
            l1StakeManager.completeUnbonding();
            uint256 balAfter = xlps[i].balance;
            assertEq(balAfter - balBefore, 5 ether, "Should receive unbonded amount");
        }
    }

    // ============ Fee Calculation Precision Tests ============

    function test_Fee_CalculationPrecision() public view {
        // Test fee calculation doesn't lose precision
        uint256 amount = 1 ether;
        uint256 fee = messagingPaymaster.calculateFee(amount);

        // Fee should be exactly 10 bps = 0.1%
        uint256 expected = (amount * 10) / 10000;
        assertEq(fee, expected, "Fee calculation mismatch");
        assertEq(fee, 0.001 ether, "Should be 0.001 ETH for 1 ETH");
    }

    function test_Fee_VerySmallAmount() public view {
        // Very small amount - 0.01 ETH
        uint256 amount = 0.01 ether;
        uint256 fee = messagingPaymaster.calculateFee(amount);

        // Should still be accurate
        // 0.01 ETH = 10^16 wei, * 10 / 10000 = 10^13 wei = 0.00001 ETH
        uint256 expected = (amount * 10) / 10000;
        assertEq(fee, expected, "Small amount fee mismatch");
        assertEq(fee, 0.00001 ether, "Should be 0.00001 ETH for 0.01 ETH at 10 bps");
    }

    function test_Fee_LargeAmount() public view {
        // Large amount - 1000 ETH
        uint256 amount = 1000 ether;
        uint256 fee = messagingPaymaster.calculateFee(amount);

        uint256 expected = (amount * 10) / 10000;
        assertEq(fee, expected, "Large amount fee mismatch");
        assertEq(fee, 1 ether, "Should be 1 ETH for 1000 ETH");
    }

    function testFuzz_Fee_NoOverflow(uint128 amount) public view {
        vm.assume(amount > 0);

        uint256 fee = messagingPaymaster.calculateFee(amount);
        uint256 expected = (uint256(amount) * 10) / 10000;
        assertEq(fee, expected, "Fuzz: fee mismatch");
    }

    // ============ Data Verification Tests ============

    function test_Data_VoucherContainsCorrectData() public {
        _registerXLP(xlps[0], 10 ether);

        uint256 transferAmount = 2.5 ether;
        uint256 maxFee = 0.05 ether;
        uint256 feeIncrement = 0.001 ether;
        uint256 gasOnDest = 0.01 ether;

        // Create request
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: transferAmount + maxFee}(
            address(0), transferAmount, address(0), L1_CHAIN_ID, user, gasOnDest, maxFee, feeIncrement
        );

        // Verify request data
        CrossChainPaymaster.VoucherRequest memory request = paymaster.getRequest(requestId);
        assertEq(request.requester, user, "Wrong requester");
        assertEq(request.amount, transferAmount, "Wrong amount");
        assertEq(request.token, address(0), "Wrong token");
        assertEq(request.destinationToken, address(0), "Wrong dest token");
        assertEq(request.destinationChainId, L1_CHAIN_ID, "Wrong dest chain");
        assertEq(request.recipient, user, "Wrong recipient");
        assertEq(request.maxFee, maxFee, "Wrong max fee");
        assertEq(request.feeIncrement, feeIncrement, "Wrong fee increment");
        assertFalse(request.claimed, "Should not be claimed");
        assertFalse(request.expired, "Should not be expired");
        assertFalse(request.refunded, "Should not be refunded");

        // Issue voucher
        uint256 fee = paymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(
            abi.encodePacked(requestId, xlps[0], transferAmount, fee, uint256(L1_CHAIN_ID))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKeys[0], commitment.toEthSignedMessageHash());

        vm.prank(xlps[0]);
        bytes32 voucherId = paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));

        // Verify voucher data
        CrossChainPaymaster.Voucher memory voucher = paymaster.getVoucher(voucherId);
        assertEq(voucher.xlp, xlps[0], "Wrong XLP");
        assertEq(voucher.amount, transferAmount, "Wrong voucher amount");
        assertEq(voucher.fee, fee, "Wrong voucher fee");
        assertEq(voucher.requestId, requestId, "Wrong request ID");
        assertFalse(voucher.fulfilled, "Should not be fulfilled");
        assertFalse(voucher.claimed, "Should not be claimed");
        assertFalse(voucher.slashed, "Should not be slashed");
    }

    function test_Data_XLPStatsAccurate() public {
        _registerXLP(xlps[0], 10 ether);

        // Issue 3 vouchers
        uint256 totalVolume;
        for (uint256 i = 0; i < 3; i++) {
            uint256 amount = 0.5 ether + (i * 0.1 ether);
            totalVolume += amount;

            vm.prank(user);
            bytes32 requestId = paymaster.createVoucherRequest{value: amount + 0.1 ether}(
                address(0), amount, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.1 ether, 0.001 ether
            );

            uint256 fee = paymaster.getCurrentFee(requestId);
            bytes32 commitment = keccak256(
                abi.encodePacked(requestId, xlps[0], amount, fee, uint256(L1_CHAIN_ID))
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKeys[0], commitment.toEthSignedMessageHash());

            vm.prank(xlps[0]);
            paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));
        }

        // Verify stats
        CrossChainPaymaster.XLPStats memory stats = paymaster.getXLPStats(xlps[0]);
        assertEq(stats.wonBids, 3, "Wrong won bids count");
        assertEq(stats.totalVolume, totalVolume, "Wrong total volume");
        assertTrue(stats.totalFeesEarned > 0, "Should have earned fees");
    }

    function test_Data_L2OutputVerifierCachesCorrectly() public {
        // Create valid output root
        bytes32 stateRoot = keccak256("state-root-1");
        bytes32 messagePasserRoot = keccak256("message-passer-1");
        bytes32 blockHash = keccak256("block-hash-1");
        bytes32 outputRoot = keccak256(abi.encode(bytes32(0), stateRoot, messagePasserRoot, blockHash));

        // Add finalized output
        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        oracle.addOutput(outputRoot, oldTimestamp, 2000);

        // Verify
        bool valid = verifier.verifyStateRoot(L2_CHAIN_ID, 2000, stateRoot, messagePasserRoot, blockHash);
        assertTrue(valid, "Should be valid");

        // Check cache
        assertTrue(
            verifier.isOutputVerified(L2_CHAIN_ID, 2000, outputRoot), "Should be cached"
        );

        // Different block number should not be cached
        assertFalse(
            verifier.isOutputVerified(L2_CHAIN_ID, 2001, outputRoot), "Different block should not be cached"
        );
    }

    // ============ Signature Edge Cases ============

    function test_Signature_WrongChainId() public {
        _registerXLP(xlps[0], 10 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.1 ether, 0.01 ether
        );

        uint256 fee = paymaster.getCurrentFee(requestId);

        // Sign with wrong chain ID
        bytes32 wrongCommitment = keccak256(
            abi.encodePacked(requestId, xlps[0], uint256(1 ether), fee, uint256(9999))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKeys[0], wrongCommitment.toEthSignedMessageHash());

        vm.prank(xlps[0]);
        vm.expectRevert(CrossChainPaymaster.InvalidVoucherSignature.selector);
        paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));
    }

    function test_Signature_WrongAmount() public {
        _registerXLP(xlps[0], 10 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.1 ether, 0.01 ether
        );

        uint256 fee = paymaster.getCurrentFee(requestId);

        // Sign with wrong amount
        bytes32 wrongCommitment = keccak256(
            abi.encodePacked(requestId, xlps[0], uint256(2 ether), fee, uint256(L1_CHAIN_ID))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKeys[0], wrongCommitment.toEthSignedMessageHash());

        vm.prank(xlps[0]);
        vm.expectRevert(CrossChainPaymaster.InvalidVoucherSignature.selector);
        paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));
    }

    function test_Signature_WrongFee() public {
        _registerXLP(xlps[0], 10 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.1 ether, 0.01 ether
        );

        // Sign with wrong fee
        bytes32 wrongCommitment = keccak256(
            abi.encodePacked(requestId, xlps[0], uint256(1 ether), uint256(0.999 ether), uint256(L1_CHAIN_ID))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKeys[0], wrongCommitment.toEthSignedMessageHash());

        vm.prank(xlps[0]);
        vm.expectRevert(CrossChainPaymaster.InvalidVoucherSignature.selector);
        paymaster.issueVoucher(requestId, abi.encodePacked(r, s, v));
    }

    function test_Signature_TruncatedSignature() public {
        _registerXLP(xlps[0], 10 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.1 ether, 0.01 ether
        );

        // Truncated signature (should be 65 bytes)
        bytes memory truncatedSig = hex"1234567890";

        vm.prank(xlps[0]);
        vm.expectRevert(); // ECDSA will revert on invalid length
        paymaster.issueVoucher(requestId, truncatedSig);
    }

    // ============ ERC20 Token Transfer Tests ============

    function test_Token_ERC20VoucherRequest() public {
        _registerXLP(xlps[0], 10 ether);

        // Approve and create token request
        uint256 tokenAmount = 100 ether;
        vm.startPrank(user);
        token.approve(address(paymaster), tokenAmount);

        bytes32 requestId = paymaster.createVoucherRequest{value: 0.1 ether}(
            address(token),
            tokenAmount,
            address(token),
            L1_CHAIN_ID,
            user,
            0.001 ether,
            0.1 ether,
            0.01 ether
        );
        vm.stopPrank();

        // Verify tokens locked
        assertEq(token.balanceOf(address(paymaster)), tokenAmount, "Tokens should be locked");

        // Verify request data
        CrossChainPaymaster.VoucherRequest memory request = paymaster.getRequest(requestId);
        assertEq(request.token, address(token), "Wrong token");
        assertEq(request.amount, tokenAmount, "Wrong amount");
    }

    function test_Token_XLPDepositsAndWithdraws() public {
        // XLP deposits tokens
        vm.startPrank(xlps[0]);
        token.approve(address(paymaster), 500 ether);
        paymaster.depositLiquidity(address(token), 500 ether);
        vm.stopPrank();

        // Note: getXLPLiquidity(xlp, token) - xlp first, then token
        uint256 liquidity = paymaster.getXLPLiquidity(xlps[0], address(token));
        assertEq(liquidity, 500 ether, "Deposit failed");

        // XLP withdraws half
        vm.prank(xlps[0]);
        paymaster.withdrawLiquidity(address(token), 250 ether);

        liquidity = paymaster.getXLPLiquidity(xlps[0], address(token));
        assertEq(liquidity, 250 ether, "Withdraw failed");
        assertEq(token.balanceOf(xlps[0]), 750 ether, "Token balance wrong");
    }

    // ============ Messaging Paymaster Liquidity Tests ============

    function test_Messaging_MultipleLPsDeposit() public {
        // Multiple LPs deposit
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(xlps[i]);
            messagingPaymaster.depositETH{value: (i + 1) * 5 ether}();
        }

        // Verify total liquidity: 5 + 10 + 15 = 30 ETH
        uint256 total = messagingPaymaster.getTotalLiquidity(address(0));
        assertEq(total, 30 ether, "Total liquidity mismatch");

        // Verify individual positions
        for (uint256 i = 0; i < 3; i++) {
            uint256 pos = messagingPaymaster.getLiquidityPosition(address(0), xlps[i]);
            assertEq(pos, (i + 1) * 5 ether, "Position mismatch");
        }
    }

    function test_Messaging_CanCompleteLargeTransfer() public {
        // Large liquidity pool
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(xlps[i]);
            messagingPaymaster.depositETH{value: 100 ether}();
        }

        // 500 ETH total liquidity
        assertEq(messagingPaymaster.getTotalLiquidity(address(0)), 500 ether);

        // Can complete 400 ETH transfer
        assertTrue(messagingPaymaster.canComplete(address(0), 400 ether));

        // Cannot complete 600 ETH transfer
        assertFalse(messagingPaymaster.canComplete(address(0), 600 ether));
    }

    // ============ State Root Verification Edge Cases ============

    function test_StateRoot_MultipleChains() public {
        // Register oracles for multiple chains
        MockL2OutputOracleThorough oracle2 = new MockL2OutputOracleThorough();
        verifier.registerOracle(BASE_SEPOLIA_CHAIN_ID, address(oracle2), true); // ZK chain

        // Add outputs to both
        bytes32 outputRoot1 = keccak256("output1");
        bytes32 outputRoot2 = keccak256("output2");

        uint128 oldTimestamp = uint128(block.timestamp - 8 days);
        oracle.addOutput(outputRoot1, oldTimestamp, 2000);
        oracle2.addOutput(outputRoot2, uint128(block.timestamp - 2 hours), 3000);

        // Verify both chains
        (bool exists1, bool finalized1,) = verifier.verifyBlockExists(L2_CHAIN_ID, 2000);
        (bool exists2, bool finalized2,) = verifier.verifyBlockExists(BASE_SEPOLIA_CHAIN_ID, 3000);

        assertTrue(exists1 && finalized1, "Chain 1 should be finalized (OP)");
        assertTrue(exists2 && finalized2, "Chain 2 should be finalized (ZK, 1hr delay)");
    }

    function test_StateRoot_FinalityDelayUpdate() public {
        // Register with default delay
        verifier.registerOracle(BASE_SEPOLIA_CHAIN_ID, address(oracle), false);
        assertEq(verifier.getFinalityDelay(BASE_SEPOLIA_CHAIN_ID), 7 days);

        // Update delay
        verifier.setFinalityDelay(BASE_SEPOLIA_CHAIN_ID, 3 days);
        assertEq(verifier.getFinalityDelay(BASE_SEPOLIA_CHAIN_ID), 3 days);
    }

    // ============ Stress Tests ============

    function test_Stress_ManyRequestsFromSameUser() public {
        _registerXLP(xlps[0], 100 ether);

        // Create 10 requests with different amounts to ensure unique IDs
        // (request ID includes amount in the hash)
        bytes32[] memory requestIds = new bytes32[](10);
        for (uint256 i = 0; i < 10; i++) {
            uint256 amount = 0.1 ether + (i * 0.001 ether);
            vm.prank(user);
            requestIds[i] = paymaster.createVoucherRequest{value: amount + 0.01 ether}(
                address(0), amount, address(0), L1_CHAIN_ID, user, 0.001 ether, 0.01 ether, 0.001 ether
            );
        }

        // Verify all requests are unique
        for (uint256 i = 0; i < 10; i++) {
            for (uint256 j = i + 1; j < 10; j++) {
                assertTrue(requestIds[i] != requestIds[j], "Request IDs should be unique");
            }
        }
    }

    function testFuzz_Stake_RandomAmounts(uint96 stakeAmount) public {
        vm.assume(stakeAmount >= 1 ether);
        vm.assume(stakeAmount <= 500 ether);

        vm.deal(xlps[0], stakeAmount + 1 ether);

        vm.startPrank(xlps[0]);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: stakeAmount}(chains);
        vm.stopPrank();

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlps[0]);
        assertEq(stake.stakedAmount, stakeAmount, "Stake amount mismatch");
        assertTrue(stake.isActive, "Should be active");
    }

    // ============ Helper Functions ============

    function _registerXLP(address xlp, uint256 stake) internal {
        vm.deal(xlp, stake * 3);

        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: stake}(chains);
        vm.stopPrank();

        paymaster.updateXLPStake(xlp, stake);

        vm.prank(xlp);
        paymaster.depositETH{value: stake * 2}();
    }
}
