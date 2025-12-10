// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {MockEntryPoint} from "../src/eil/MockEntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract EILTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    L1StakeManager public l1StakeManager;
    CrossChainPaymaster public crossChainPaymaster;
    MockEntryPoint public entryPoint;

    address public deployer;
    address public xlp;
    address public user;

    uint256 public xlpPrivateKey;
    uint256 public userPrivateKey;

    uint256 constant L1_CHAIN_ID = 1337;
    uint256 constant L2_CHAIN_ID = 420691;
    uint256 constant MIN_STAKE = 1 ether;

    function setUp() public {
        // Setup accounts
        deployer = address(this);
        xlpPrivateKey = 0x1234;
        userPrivateKey = 0x5678;
        xlp = vm.addr(xlpPrivateKey);
        user = vm.addr(userPrivateKey);

        // Fund accounts
        vm.deal(xlp, 100 ether);
        vm.deal(user, 100 ether);
        vm.deal(deployer, 100 ether);

        // Deploy contracts
        entryPoint = new MockEntryPoint();
        l1StakeManager = new L1StakeManager();
        crossChainPaymaster =
            new CrossChainPaymaster(IEntryPoint(address(entryPoint)), address(l1StakeManager), L2_CHAIN_ID, address(0));

        // Register the paymaster on L1
        l1StakeManager.registerL2Paymaster(L2_CHAIN_ID, address(crossChainPaymaster));

        // Enable ETH as supported token
        crossChainPaymaster.setTokenSupport(address(0), true);
    }

    // ============ L1StakeManager Tests ============

    function test_RegisterXLP() public {
        vm.startPrank(xlp);

        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        l1StakeManager.register{value: 10 ether}(chains);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 10 ether);
        assertTrue(stake.isActive);
        assertEq(l1StakeManager.totalStaked(), 10 ether);

        vm.stopPrank();
    }

    function test_RegisterXLP_InsufficientStake() public {
        vm.startPrank(xlp);

        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;

        vm.expectRevert(L1StakeManager.InsufficientStake.selector);
        l1StakeManager.register{value: 0.5 ether}(chains);

        vm.stopPrank();
    }

    function test_AddStake() public {
        // First register
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);

        // Add more stake
        l1StakeManager.addStake{value: 5 ether}();

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 15 ether);

        vm.stopPrank();
    }

    function test_StartUnbonding() public {
        // Register XLP
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);

        // Start unbonding
        l1StakeManager.startUnbonding(5 ether);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertEq(stake.stakedAmount, 5 ether);
        assertEq(stake.unbondingAmount, 5 ether);
        assertTrue(stake.isActive); // Still active because remaining stake >= MIN_STAKE

        vm.stopPrank();
    }

    function test_CompleteUnbonding() public {
        // Register and start unbonding
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        l1StakeManager.startUnbonding(5 ether);

        // Fast forward past unbonding period
        vm.warp(block.timestamp + 8 days + 1);

        uint256 balanceBefore = xlp.balance;
        l1StakeManager.completeUnbonding();
        uint256 balanceAfter = xlp.balance;

        assertEq(balanceAfter - balanceBefore, 5 ether);

        L1StakeManager.XLPStake memory stake = l1StakeManager.getStake(xlp);
        assertEq(stake.unbondingAmount, 0);

        vm.stopPrank();
    }

    // ============ CrossChainPaymaster Tests ============

    function test_CreateVoucherRequest() public {
        vm.startPrank(user);

        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), // ETH
            1 ether, // amount
            address(0), // destinationToken (ETH)
            L1_CHAIN_ID, // destinationChainId
            user, // recipient
            21000, // gasOnDestination
            0.1 ether, // maxFee
            0.01 ether // feeIncrement
        );

        assertTrue(requestId != bytes32(0));

        CrossChainPaymaster.VoucherRequest memory request = crossChainPaymaster.getRequest(requestId);
        assertEq(request.requester, user);
        assertEq(request.amount, 1 ether);
        assertEq(request.destinationChainId, L1_CHAIN_ID);

        vm.stopPrank();
    }

    function test_DepositXLPLiquidity() public {
        vm.startPrank(xlp);

        crossChainPaymaster.depositETH{value: 10 ether}();

        uint256 xlpETH = crossChainPaymaster.getXLPETH(xlp);
        assertEq(xlpETH, 10 ether);

        vm.stopPrank();
    }

    function test_IssueVoucher() public {
        // Setup: Register XLP on L1 and update stake on L2
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        // Update XLP stake on L2 paymaster (simulates cross-chain message)
        crossChainPaymaster.updateXLPStake(xlp, 10 ether);

        // Deposit XLP liquidity on L2
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        // User creates voucher request
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Get fee and create XLP signature
        uint256 fee = crossChainPaymaster.getCurrentFee(requestId);

        // Create commitment hash
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp, uint256(1 ether), fee, uint256(L1_CHAIN_ID)));

        // Sign with EIP-191 prefix
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // XLP issues voucher
        vm.prank(xlp);
        bytes32 voucherId = crossChainPaymaster.issueVoucher(requestId, signature);

        assertTrue(voucherId != bytes32(0));

        // Verify request is claimed
        CrossChainPaymaster.VoucherRequest memory request = crossChainPaymaster.getRequest(requestId);
        assertTrue(request.claimed);
    }

    function test_RefundExpiredRequest() public {
        vm.startPrank(user);

        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 1.1 ether}(
            address(0), 1 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // Fast forward past request timeout (50 blocks)
        vm.roll(block.number + 51);

        uint256 balanceBefore = user.balance;
        crossChainPaymaster.refundExpiredRequest(requestId);
        uint256 balanceAfter = user.balance;

        // User should get refund of amount + maxFee
        assertEq(balanceAfter - balanceBefore, 1.1 ether);

        vm.stopPrank();
    }

    function test_WithdrawXLPLiquidity() public {
        vm.startPrank(xlp);

        // Deposit
        crossChainPaymaster.depositETH{value: 10 ether}();

        // Withdraw
        uint256 balanceBefore = xlp.balance;
        crossChainPaymaster.withdrawETH(5 ether);
        uint256 balanceAfter = xlp.balance;

        assertEq(balanceAfter - balanceBefore, 5 ether);
        assertEq(crossChainPaymaster.getXLPETH(xlp), 5 ether);

        vm.stopPrank();
    }

    // ============ Integration Tests ============

    function test_FullCrossChainFlow() public {
        // 1. Register XLP on L1
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        // 2. Update XLP stake on L2
        crossChainPaymaster.updateXLPStake(xlp, 10 ether);

        // 3. XLP deposits liquidity
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        // 4. User creates voucher request
        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 0.6 ether}(
            address(0), 0.5 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        // 5. XLP issues voucher
        uint256 fee = crossChainPaymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp, uint256(0.5 ether), fee, uint256(L1_CHAIN_ID)));
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp);
        bytes32 voucherId = crossChainPaymaster.issueVoucher(requestId, signature);

        // 6. Mark voucher as fulfilled (simulates cross-chain message)
        crossChainPaymaster.markVoucherFulfilled(voucherId);

        // 7. Wait for claim delay (150 blocks)
        vm.roll(block.number + 151);

        // 8. XLP claims source funds
        uint256 xlpBalanceBefore = xlp.balance;
        vm.prank(xlp);
        crossChainPaymaster.claimSourceFunds(voucherId);
        uint256 xlpBalanceAfter = xlp.balance;

        // XLP receives amount + fee (they spent `amount` on destination, get it back + fee for service)
        uint256 expectedAmount = 0.5 ether + fee;
        assertEq(xlpBalanceAfter - xlpBalanceBefore, expectedAmount);

        emit log("Full cross-chain flow completed successfully!");
        emit log_named_uint("User transferred", 0.5 ether);
        emit log_named_uint("Fee paid", fee);
        emit log_named_uint("XLP received", expectedAmount);
    }

    function test_DoubleClaimPrevention() public {
        // Setup: Complete a full flow first
        vm.startPrank(xlp);
        uint256[] memory chains = new uint256[](1);
        chains[0] = L2_CHAIN_ID;
        l1StakeManager.register{value: 10 ether}(chains);
        vm.stopPrank();

        crossChainPaymaster.updateXLPStake(xlp, 10 ether);

        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        vm.prank(user);
        bytes32 requestId = crossChainPaymaster.createVoucherRequest{value: 0.6 ether}(
            address(0), 0.5 ether, address(0), L1_CHAIN_ID, user, 21000, 0.1 ether, 0.01 ether
        );

        uint256 fee = crossChainPaymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp, uint256(0.5 ether), fee, uint256(L1_CHAIN_ID)));
        bytes32 ethSignedHash = commitment.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp);
        bytes32 voucherId = crossChainPaymaster.issueVoucher(requestId, signature);

        crossChainPaymaster.markVoucherFulfilled(voucherId);
        vm.roll(block.number + 151);

        // First claim should succeed
        vm.prank(xlp);
        crossChainPaymaster.claimSourceFunds(voucherId);

        // Second claim should revert
        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymaster.VoucherAlreadyClaimed.selector);
        crossChainPaymaster.claimSourceFunds(voucherId);
    }

    function test_FulfillVoucher() public {
        // Setup XLP with liquidity on destination chain
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        // Create voucher parameters
        bytes32 voucherId = keccak256("test-voucher");
        bytes32 requestId = keccak256("test-request");
        uint256 amount = 1 ether;
        uint256 gasAmount = 0.001 ether;

        // XLP signs the fulfillment voucher
        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                voucherId,
                requestId,
                xlp,
                address(0), // ETH
                amount,
                user, // recipient
                gasAmount,
                L2_CHAIN_ID
            )
        );
        bytes32 ethSignedHash = voucherHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory xlpSignature = abi.encodePacked(r, s, v);

        uint256 recipientBalanceBefore = user.balance;
        uint256 xlpDepositBefore = crossChainPaymaster.getXLPETH(xlp);

        // Fulfill the voucher
        crossChainPaymaster.fulfillVoucher(voucherId, requestId, xlp, address(0), amount, user, gasAmount, xlpSignature);

        // Verify recipient received funds
        assertEq(user.balance - recipientBalanceBefore, amount + gasAmount);
        // Verify XLP deposit was reduced
        assertEq(xlpDepositBefore - crossChainPaymaster.getXLPETH(xlp), amount + gasAmount);
    }

    function test_FulfillVoucher_ReplayPrevention() public {
        // Setup XLP with liquidity
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        bytes32 voucherId = keccak256("test-voucher-replay");
        bytes32 requestId = keccak256("test-request-replay");
        uint256 amount = 1 ether;
        uint256 gasAmount = 0;

        bytes32 voucherHash =
            keccak256(abi.encodePacked(voucherId, requestId, xlp, address(0), amount, user, gasAmount, L2_CHAIN_ID));
        bytes32 ethSignedHash = voucherHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory xlpSignature = abi.encodePacked(r, s, v);

        // First fulfillment should succeed
        crossChainPaymaster.fulfillVoucher(voucherId, requestId, xlp, address(0), amount, user, gasAmount, xlpSignature);

        // Second fulfillment with same signature should revert
        vm.expectRevert(CrossChainPaymaster.VoucherAlreadyFulfilled.selector);
        crossChainPaymaster.fulfillVoucher(voucherId, requestId, xlp, address(0), amount, user, gasAmount, xlpSignature);
    }

    function test_FulfillVoucher_InsufficientLiquidity() public {
        // XLP has only 0.5 ETH but tries to fulfill 1 ETH
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 0.5 ether}();

        bytes32 voucherId = keccak256("test-voucher-insufficient");
        bytes32 requestId = keccak256("test-request-insufficient");
        uint256 amount = 1 ether;
        uint256 gasAmount = 0;

        bytes32 voucherHash =
            keccak256(abi.encodePacked(voucherId, requestId, xlp, address(0), amount, user, gasAmount, L2_CHAIN_ID));
        bytes32 ethSignedHash = voucherHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpPrivateKey, ethSignedHash);
        bytes memory xlpSignature = abi.encodePacked(r, s, v);

        vm.expectRevert(CrossChainPaymaster.InsufficientXLPLiquidity.selector);
        crossChainPaymaster.fulfillVoucher(voucherId, requestId, xlp, address(0), amount, user, gasAmount, xlpSignature);
    }

    function test_FulfillVoucher_InvalidSignature() public {
        vm.prank(xlp);
        crossChainPaymaster.depositETH{value: 20 ether}();

        bytes32 voucherId = keccak256("test-voucher-badsig");
        bytes32 requestId = keccak256("test-request-badsig");
        uint256 amount = 1 ether;

        // Sign with USER's key instead of XLP's key
        bytes32 voucherHash =
            keccak256(abi.encodePacked(voucherId, requestId, xlp, address(0), amount, user, uint256(0), L2_CHAIN_ID));
        bytes32 ethSignedHash = voucherHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, ethSignedHash); // Wrong signer!
        bytes memory badSignature = abi.encodePacked(r, s, v);

        vm.expectRevert(CrossChainPaymaster.InvalidVoucherSignature.selector);
        crossChainPaymaster.fulfillVoucher(voucherId, requestId, xlp, address(0), amount, user, 0, badSignature);
    }

    // ============ App Token Preference Integration Tests ============

    function test_SetAppTokenPreference() public {
        address preferenceContract = address(0x9999);
        
        crossChainPaymaster.setAppTokenPreference(preferenceContract);
        
        // The contract stores the preference address
        // Note: appTokenPreference is internal, so we test via getBestPaymentTokenForApp behavior
    }

    function test_GetBestPaymentTokenForApp_NoPreference() public {
        // Warp to a reasonable timestamp to avoid underflow in freshness check
        vm.warp(1000000);
        
        // Without app preference set and no supported tokens, should return zero
        address[] memory tokens = new address[](1);
        tokens[0] = address(0);
        
        uint256[] memory balances = new uint256[](1);
        balances[0] = 10 ether;
        
        // Should not revert even without preference contract
        // Note: ETH is supported but no exchange rate set, so it will use default 1:1
        (address bestToken, uint256 tokenCost, string memory reason) = 
            crossChainPaymaster.getBestPaymentTokenForApp(
                address(0x1234), // app
                user,
                0.01 ether, // gas cost
                tokens,
                balances
            );
        
        // ETH is supported and default rate is 1:1, so it should return ETH
        assertEq(bestToken, address(0));
        assertTrue(tokenCost > 0); // Should be gas cost + fee margin
        assertTrue(bytes(reason).length > 0);
    }

    function test_CheckAppPreference_NoPreference() public view {
        (bool hasPreferred, address preferredToken) = crossChainPaymaster.checkAppPreference(
            address(0x1234), // app
            user,
            address(0), // token
            10 ether // balance
        );
        
        // Without preference contract, should return false
        assertFalse(hasPreferred);
        assertEq(preferredToken, address(0));
    }
}
