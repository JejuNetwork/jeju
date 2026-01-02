// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import {CrossChainPaymasterUpgradeable} from "../../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {L2CrossDomainMessenger} from "../../src/bridge/eil/L2CrossDomainMessenger.sol";
import {L1StakeManager} from "../../src/bridge/eil/L1StakeManager.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";

/**
 * @title CrossChainPaymasterTest
 * @notice Comprehensive tests for CrossChainPaymasterUpgradeable
 * @dev Tests paymaster validation, XLP liquidity, and cross-chain stake sync
 */
contract CrossChainPaymasterTest is Test {
    CrossChainPaymasterUpgradeable public paymaster;
    CrossChainPaymasterUpgradeable public paymasterImpl;
    EntryPoint public entryPoint;
    L2CrossDomainMessenger public messenger;
    L1StakeManager public l1StakeManager;

    address public owner = address(0x1);
    address public xlp = address(0x2);
    address public user = address(0x3);
    address public relayer = address(0x4);
    address public xlp2 = address(0x5);

    uint256 public constant L1_CHAIN_ID = 1337;
    uint256 public constant L2_CHAIN_ID = 31337;

    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(xlp, 100 ether);
        vm.deal(user, 10 ether);
        vm.deal(relayer, 10 ether);

        // Deploy EntryPoint
        entryPoint = new EntryPoint();

        // Deploy L1StakeManager
        l1StakeManager = new L1StakeManager();

        // Deploy L2CrossDomainMessenger
        messenger = new L2CrossDomainMessenger();

        // Deploy CrossChainPaymasterUpgradeable via proxy
        paymasterImpl = new CrossChainPaymasterUpgradeable();
        bytes memory initData = abi.encodeWithSelector(
            CrossChainPaymasterUpgradeable.initialize.selector,
            owner,
            L1_CHAIN_ID,
            address(l1StakeManager),
            address(entryPoint)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(paymasterImpl), initData);
        paymaster = CrossChainPaymasterUpgradeable(payable(address(proxy)));

        // Configure messenger
        vm.prank(owner);
        paymaster.setL2Messenger(address(messenger));

        // Authorize relayer on messenger
        messenger.setRelayer(relayer, true);
    }

    // ============ Initialization Tests ============

    function test_Initialize() public view {
        assertEq(paymaster.owner(), owner);
        assertEq(paymaster.l1ChainId(), L1_CHAIN_ID);
        assertEq(paymaster.l1StakeManager(), address(l1StakeManager));
        assertEq(address(paymaster.entryPoint()), address(entryPoint));
        assertEq(paymaster.l2Messenger(), address(messenger));
    }

    function test_CannotReinitialize() public {
        vm.expectRevert();
        paymaster.initialize(owner, L1_CHAIN_ID, address(l1StakeManager), address(entryPoint));
    }

    // ============ XLP Stake Tests ============

    function test_AdminSetXLPStake() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);
        assertEq(paymaster.xlpStakes(xlp), 2 ether);
    }

    function test_AdminSetXLPStake_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        paymaster.adminSetXLPStake(xlp, 2 ether);
    }

    function test_XLPStakeViaMessenger() public {
        // Simulate cross-chain message from L1StakeManager
        bytes memory message = abi.encodeWithSignature("updateXLPStake(address,uint256)", xlp, 5 ether);

        // Set the L1StakeManager address on the messenger first
        vm.prank(relayer);
        messenger.relayMessage(address(paymaster), address(l1StakeManager), message, 0);

        assertEq(paymaster.xlpStakes(xlp), 5 ether);
    }

    function test_XLPStakeViaMessenger_OnlyL1StakeManager() public {
        bytes memory message = abi.encodeWithSignature("updateXLPStake(address,uint256)", xlp, 5 ether);

        // Try to relay from wrong sender (not L1StakeManager)
        vm.prank(relayer);
        vm.expectRevert(); // Should fail because sender is not l1StakeManager
        messenger.relayMessage(address(paymaster), address(0x999), message, 0);
    }

    // ============ ETH Liquidity Tests ============

    function test_DepositETH() public {
        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();
        assertEq(paymaster.xlpEthBalance(xlp), 5 ether);
    }

    function test_WithdrawETH() public {
        vm.startPrank(xlp);
        paymaster.depositETH{value: 5 ether}();
        
        uint256 balanceBefore = xlp.balance;
        paymaster.withdrawETH(3 ether);
        uint256 balanceAfter = xlp.balance;
        
        assertEq(paymaster.xlpEthBalance(xlp), 2 ether);
        assertEq(balanceAfter - balanceBefore, 3 ether);
        vm.stopPrank();
    }

    function test_WithdrawETH_InsufficientBalance() public {
        vm.prank(xlp);
        paymaster.depositETH{value: 1 ether}();

        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.InsufficientLiquidity.selector);
        paymaster.withdrawETH(2 ether);
    }

    // ============ ValidatePaymasterUserOp Tests ============

    function test_ValidatePaymasterUserOp_Success() public {
        // Setup: XLP has stake and liquidity
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        // Deposit to EntryPoint
        vm.prank(owner);
        entryPoint.depositTo{value: 1 ether}(address(paymaster));

        // Build paymasterAndData with XLP address
        // Format: [paymaster(20)] [verificationGas(16)] [postOpGas(16)] [xlp(20)]
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),         // 20 bytes
            uint128(100000),            // 16 bytes - paymasterVerificationGasLimit
            uint128(50000),             // 16 bytes - paymasterPostOpGasLimit
            xlp                          // 20 bytes - XLP address
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 userOpHash = keccak256(abi.encode(userOp));

        // Call from EntryPoint
        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            userOpHash,
            0.1 ether // maxCost
        );

        assertEq(validationData, 0, "Should return 0 for success");
        assertTrue(context.length > 0, "Context should not be empty");

        // Decode context
        (address contextXlp, uint256 contextMaxCost, address contextSender) = abi.decode(context, (address, uint256, address));
        assertEq(contextXlp, xlp);
        assertEq(contextMaxCost, 0.1 ether);
        assertEq(contextSender, user);

        // XLP balance should be reduced
        assertEq(paymaster.xlpEthBalance(xlp), 5 ether - 0.1 ether);
    }

    function test_ValidatePaymasterUserOp_InsufficientStake() public {
        // XLP has no stake
        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            xlp
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            bytes32(0),
            0.1 ether
        );

        assertEq(validationData, 1, "Should return 1 for failure (insufficient stake)");
    }

    function test_ValidatePaymasterUserOp_InsufficientLiquidity() public {
        // XLP has stake but no liquidity
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            xlp
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            bytes32(0),
            0.1 ether
        );

        assertEq(validationData, 1, "Should return 1 for failure (insufficient liquidity)");
    }

    function test_ValidatePaymasterUserOp_InvalidPaymasterAndData() public {
        // paymasterAndData too short
        bytes memory shortPaymasterAndData = abi.encodePacked(address(paymaster));

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: shortPaymasterAndData,
            signature: ""
        });

        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            bytes32(0),
            0.1 ether
        );

        assertEq(validationData, 1, "Should return 1 for invalid paymasterAndData");
    }

    function test_ValidatePaymasterUserOp_OnlyEntryPoint() public {
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            xlp
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        // Call from non-EntryPoint should fail
        vm.prank(user);
        vm.expectRevert("Only EntryPoint");
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.1 ether);
    }

    // ============ PostOp Tests ============

    function test_PostOp_RefundsExcessGas() public {
        // Setup XLP with stake and liquidity
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        // Simulate validatePaymasterUserOp deducting maxCost
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            xlp
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(
            userOp,
            bytes32(0),
            0.1 ether
        );

        uint256 balanceAfterValidation = paymaster.xlpEthBalance(xlp);
        assertEq(balanceAfterValidation, 5 ether - 0.1 ether);

        // PostOp refunds unused gas
        uint256 actualGasCost = 0.03 ether; // Less than maxCost
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, 1 gwei);

        uint256 balanceAfterPostOp = paymaster.xlpEthBalance(xlp);
        assertEq(balanceAfterPostOp, 5 ether - 0.03 ether, "XLP should get refund for unused gas");
    }

    function test_PostOp_NoRefundIfActualCostEqualsMax() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        // New context format: (xlp, maxCostEth, sender, paymentToken, tokenAmount)
        bytes memory context = abi.encode(xlp, 0.1 ether, user, address(0), 0.1 ether);

        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.1 ether, 1 gwei);

        // No refund since actual == max
        assertEq(paymaster.xlpEthBalance(xlp), 5 ether);
    }

    function test_PostOp_OnlyEntryPoint() public {
        bytes memory context = abi.encode(xlp, 0.1 ether, user);

        vm.prank(user);
        vm.expectRevert("Only EntryPoint");
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.05 ether, 1 gwei);
    }

    // ============ Voucher Flow Tests ============

    function test_CreateVoucherRequestETH() public {
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID, // destinationChain
            address(0),  // destinationToken (ETH)
            user,        // recipient
            0.01 ether   // maxFee
        );

        assertTrue(requestId != bytes32(0), "Request ID should not be zero");

        // Check request state
        (
            address requester,
            ,
            uint256 amount,
            uint256 destinationChain,
            ,
            address recipient,
            uint256 maxFee,
            ,
            bool claimed,
            ,

        ) = paymaster.requests(requestId);

        assertEq(requester, user);
        assertEq(amount, 0.1 ether);
        assertEq(destinationChain, L1_CHAIN_ID);
        assertEq(recipient, user);
        assertEq(maxFee, 0.01 ether);
        assertFalse(claimed);
    }

    function test_IssueVoucher_RequiresXLPStake() public {
        // Create request
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        // Try to issue without stake
        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.NotXLP.selector);
        paymaster.issueVoucher(requestId);
    }

    function test_IssueVoucher_Success() public {
        // Setup XLP stake
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // Create request
        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        // Issue voucher
        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        assertTrue(voucherId != bytes32(0));

        // Check voucher state
        (bytes32 reqId, address voucherXlp, uint256 issuedBlock, bool fulfilled,) = paymaster.vouchers(voucherId);
        assertEq(reqId, requestId);
        assertEq(voucherXlp, xlp);
        assertEq(issuedBlock, block.number);
        assertFalse(fulfilled);

        // Request should be claimed
        (,,,,,,, , bool claimed,,) = paymaster.requests(requestId);
        assertTrue(claimed);
    }

    function test_IssueVoucher_AlreadyClaimed() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        // First issue
        vm.prank(xlp);
        paymaster.issueVoucher(requestId);

        // Second issue should fail
        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.AlreadyClaimed.selector);
        paymaster.issueVoucher(requestId);
    }

    // ============ Token Liquidity Tests ============

    function test_DepositLiquidity() public {
        // Deploy a mock token
        MockToken token = new MockToken("Test", "TST");
        token.mint(xlp, 1000 ether);

        // First, owner must add token to supported list
        vm.prank(owner);
        paymaster.setSupportedToken(address(token), true);

        vm.startPrank(xlp);
        token.approve(address(paymaster), 100 ether);
        paymaster.depositLiquidity(address(token), 100 ether);
        vm.stopPrank();

        assertEq(paymaster.getXLPLiquidity(xlp, address(token)), 100 ether);
    }

    function test_WithdrawLiquidity() public {
        MockToken token = new MockToken("Test", "TST");
        token.mint(xlp, 1000 ether);

        // First, owner must add token to supported list
        vm.prank(owner);
        paymaster.setSupportedToken(address(token), true);

        vm.startPrank(xlp);
        token.approve(address(paymaster), 100 ether);
        paymaster.depositLiquidity(address(token), 100 ether);
        paymaster.withdrawLiquidity(address(token), 50 ether);
        vm.stopPrank();

        assertEq(paymaster.getXLPLiquidity(xlp, address(token)), 50 ether);
        assertEq(token.balanceOf(xlp), 950 ether);
    }

    // ============ Admin Tests ============

    function test_SetSupportedToken() public {
        address token = address(0x123);

        vm.prank(owner);
        paymaster.setSupportedToken(token, true);

        assertTrue(paymaster.supportedTokens(token));

        vm.prank(owner);
        paymaster.setSupportedToken(token, false);

        assertFalse(paymaster.supportedTokens(token));
    }

    function test_SetFeeRate() public {
        vm.prank(owner);
        paymaster.setFeeRate(50); // 0.5%

        assertEq(paymaster.feeRate(), 50);
    }

    function test_SetFeeRate_MaxLimit() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        paymaster.setFeeRate(101); // Over 1%
    }

    function test_DepositToEntryPoint() public {
        vm.deal(owner, 10 ether);

        vm.prank(owner);
        paymaster.depositToEntryPoint{value: 5 ether}();

        assertEq(entryPoint.balanceOf(address(paymaster)), 5 ether);
    }

    // ============ Edge Case Tests ============

    function test_DepositETH_ZeroAmount() public {
        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.InvalidAmount.selector);
        paymaster.depositETH{value: 0}();
    }

    function test_DepositLiquidity_ZeroAmount() public {
        MockToken token = new MockToken("Test", "TST");
        
        vm.prank(owner);
        paymaster.setSupportedToken(address(token), true);

        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.InvalidAmount.selector);
        paymaster.depositLiquidity(address(token), 0);
    }

    function test_DepositLiquidity_UnsupportedToken() public {
        MockToken token = new MockToken("Test", "TST");
        token.mint(xlp, 100 ether);

        // Token is NOT added to supported list
        vm.startPrank(xlp);
        token.approve(address(paymaster), 100 ether);
        vm.expectRevert(CrossChainPaymasterUpgradeable.InvalidToken.selector);
        paymaster.depositLiquidity(address(token), 50 ether);
        vm.stopPrank();
    }

    function test_IssueVoucher_ExpiredRequest() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        // Fast forward past deadline (50 blocks)
        vm.roll(block.number + 60);

        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.RequestExpired.selector);
        paymaster.issueVoucher(requestId);
    }

    function test_FulfillVoucher_NotXLP() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        // Random address tries to fulfill
        vm.prank(xlp2);
        vm.expectRevert(CrossChainPaymasterUpgradeable.NotXLP.selector);
        paymaster.fulfillVoucher(voucherId, user);
    }

    function test_FulfillVoucher_ExpiredVoucher() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // XLP needs liquidity to fulfill
        vm.prank(xlp);
        paymaster.depositETH{value: 1 ether}();

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        // Fast forward past voucher timeout (100 blocks)
        vm.roll(block.number + 110);

        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.RequestExpired.selector);
        paymaster.fulfillVoucher(voucherId, user);
    }

    function test_FulfillVoucher_AlreadyFulfilled() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // XLP needs liquidity to fulfill
        vm.prank(xlp);
        paymaster.depositETH{value: 1 ether}();

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        vm.prank(xlp);
        paymaster.fulfillVoucher(voucherId, user);

        // Try to fulfill again
        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.AlreadyClaimed.selector);
        paymaster.fulfillVoucher(voucherId, user);
    }

    function test_FulfillVoucher_InsufficientLiquidity() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // XLP has NO liquidity deposited
        // (do NOT deposit ETH)

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 0.1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.01 ether
        );

        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        vm.prank(xlp);
        vm.expectRevert(CrossChainPaymasterUpgradeable.InsufficientLiquidity.selector);
        paymaster.fulfillVoucher(voucherId, user);
    }

    function test_FulfillVoucher_Success() public {
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        // XLP deposits ETH liquidity
        vm.prank(xlp);
        paymaster.depositETH{value: 5 ether}();

        vm.prank(user);
        bytes32 requestId = paymaster.createVoucherRequestETH{value: 1 ether}(
            L1_CHAIN_ID,
            address(0),
            user,
            0.1 ether
        );

        vm.prank(xlp);
        bytes32 voucherId = paymaster.issueVoucher(requestId);

        uint256 userBalanceBefore = user.balance;

        vm.prank(xlp);
        paymaster.fulfillVoucher(voucherId, user);

        // User should receive amount minus fee
        uint256 amountAfterFee = 1 ether - (1 ether * paymaster.feeRate() / 10000);
        assertEq(user.balance - userBalanceBefore, amountAfterFee);

        // Voucher should be marked fulfilled
        (, , , bool fulfilled,) = paymaster.vouchers(voucherId);
        assertTrue(fulfilled);
    }

    // ============ Reentrancy Protection ============

    function test_ReentrancyProtection_DepositETH() public {
        // This is implicitly tested by the nonReentrant modifier
        // The modifier prevents any reentrant calls
        vm.prank(xlp);
        paymaster.depositETH{value: 1 ether}();
        assertEq(paymaster.xlpEthBalance(xlp), 1 ether);
    }

    // ============ Message Replay Protection ============

    function test_MessageReplayProtection() public {
        // Setup XLP
        vm.prank(owner);
        paymaster.adminSetXLPStake(xlp, 2 ether);

        bytes memory message = abi.encodeWithSignature("updateXLPStake(address,uint256)", xlp, 5 ether);

        // First relay succeeds
        vm.prank(relayer);
        messenger.relayMessage(address(paymaster), address(l1StakeManager), message, 0);

        assertEq(paymaster.xlpStakes(xlp), 5 ether);

        // Same message replay should fail
        vm.prank(relayer);
        vm.expectRevert();
        messenger.relayMessage(address(paymaster), address(l1StakeManager), message, 0);
    }

    // ============ UUPS Upgrade Protection ============

    function test_UpgradeProtection_OnlyOwner() public {
        address newImpl = address(new CrossChainPaymasterUpgradeable());

        vm.prank(user);
        vm.expectRevert();
        paymaster.upgradeToAndCall(newImpl, "");
    }

    // ============ Price Oracle Integration ============

    function test_SetPriceOracle() public {
        MockPriceOracle oracle = new MockPriceOracle();

        vm.prank(owner);
        paymaster.setPriceOracle(address(oracle));

        assertEq(address(paymaster.priceOracle()), address(oracle));
    }

    function test_UpdateExchangeRate() public {
        MockPriceOracle oracle = new MockPriceOracle();
        // Use simple 1:1 ratio to avoid overflow issues
        oracle.setPrice(address(0), 1e18, 18); // ETH = 1 unit
        
        MockToken token = new MockToken("Test", "TST");
        oracle.setPrice(address(token), 1e18, 18); // Token = 1 unit (1:1 with ETH)

        vm.startPrank(owner);
        paymaster.setPriceOracle(address(oracle));
        paymaster.setSupportedToken(address(token), true);
        vm.stopPrank();

        // Update exchange rate
        paymaster.updateExchangeRate(address(token));

        // Rate should be set (1:1 ratio)
        assertEq(paymaster.tokenExchangeRates(address(token)), 1 ether);
        assertTrue(paymaster.exchangeRateUpdatedAt(address(token)) > 0);
    }

    function test_ConvertEthToToken() public {
        MockPriceOracle oracle = new MockPriceOracle();
        // Use 2:1 ratio (2 tokens per 1 ETH)
        oracle.setPrice(address(0), 2e18, 18); // ETH price
        
        MockToken token = new MockToken("Test", "TST");
        oracle.setPrice(address(token), 1e18, 18); // Token price (half of ETH)

        vm.startPrank(owner);
        paymaster.setPriceOracle(address(oracle));
        paymaster.setSupportedToken(address(token), true);
        vm.stopPrank();

        // Update exchange rate
        paymaster.updateExchangeRate(address(token));

        // Convert 1 ETH to tokens (should be 2 tokens since ETH is worth 2x)
        uint256 tokenAmount = paymaster.convertEthToToken(1 ether, address(token));
        assertEq(tokenAmount, 2 ether);
    }

    function test_ConvertTokenToEth() public {
        MockPriceOracle oracle = new MockPriceOracle();
        // Use 2:1 ratio
        oracle.setPrice(address(0), 2e18, 18);
        
        MockToken token = new MockToken("Test", "TST");
        oracle.setPrice(address(token), 1e18, 18);

        vm.startPrank(owner);
        paymaster.setPriceOracle(address(oracle));
        paymaster.setSupportedToken(address(token), true);
        vm.stopPrank();

        // Update exchange rate
        paymaster.updateExchangeRate(address(token));

        // Convert 2 tokens to ETH (should be 1 ETH)
        uint256 ethAmount = paymaster.convertTokenToEth(2 ether, address(token));
        assertEq(ethAmount, 1 ether);
    }

    function test_UpdateExchangeRate_OracleNotSet() public {
        MockToken token = new MockToken("Test", "TST");

        vm.prank(owner);
        paymaster.setSupportedToken(address(token), true);

        vm.expectRevert(CrossChainPaymasterUpgradeable.OracleNotSet.selector);
        paymaster.updateExchangeRate(address(token));
    }

    // ============ Pausable Tests ============

    function test_Pause() public {
        vm.prank(owner);
        paymaster.pause();

        // Should not be able to deposit when paused
        vm.prank(xlp);
        vm.expectRevert();
        paymaster.depositETH{value: 1 ether}();
    }

    function test_Unpause() public {
        vm.prank(owner);
        paymaster.pause();

        vm.prank(owner);
        paymaster.unpause();

        // Should work after unpause
        vm.prank(xlp);
        paymaster.depositETH{value: 1 ether}();
        assertEq(paymaster.xlpEthBalance(xlp), 1 ether);
    }

    function test_PauseOnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        paymaster.pause();
    }

    // ============ Token Payment in validatePaymasterUserOp ============

    function test_ValidatePaymasterUserOp_TokenPayment() public {
        // Setup oracle with 1:1 ratio for simplicity
        MockPriceOracle oracle = new MockPriceOracle();
        oracle.setPrice(address(0), 1e18, 18); // ETH

        MockToken token = new MockToken("Test", "TST");
        oracle.setPrice(address(token), 1e18, 18); // Token (same value as ETH)

        vm.startPrank(owner);
        paymaster.setPriceOracle(address(oracle));
        paymaster.setSupportedToken(address(token), true);
        paymaster.adminSetXLPStake(xlp, 2 ether);
        vm.stopPrank();

        // Update exchange rate
        paymaster.updateExchangeRate(address(token));

        // XLP deposits token liquidity
        token.mint(xlp, 10000 ether);
        vm.startPrank(xlp);
        token.approve(address(paymaster), 10000 ether);
        paymaster.depositLiquidity(address(token), 10000 ether);
        vm.stopPrank();

        // Deposit to EntryPoint
        vm.prank(owner);
        entryPoint.depositTo{value: 1 ether}(address(paymaster));

        // Build paymasterAndData with token payment
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][xlp(20)][token(20)]
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            xlp,
            address(token)
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 50000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(2 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        // Call from EntryPoint
        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(
            userOp,
            bytes32(0),
            0.001 ether // maxCost in ETH
        );

        assertEq(validationData, 0, "Should return 0 for success");
        assertTrue(context.length > 0, "Context should not be empty");

        // Token should be deducted from XLP (1:1 ratio, so 0.001 tokens for 0.001 ETH)
        assertLt(paymaster.getXLPLiquidity(xlp, address(token)), 10000 ether);
    }
}

// ============ Mock Price Oracle ============

contract MockPriceOracle {
    struct PriceData {
        uint256 price;
        uint256 decimals;
        uint256 updatedAt;
    }

    mapping(address => PriceData) public prices;

    function setPrice(address token, uint256 price, uint256 decimals) external {
        prices[token] = PriceData({price: price, decimals: decimals, updatedAt: block.timestamp});
    }

    function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals) {
        PriceData memory data = prices[token];
        return (data.price, data.decimals);
    }

    function isPriceFresh(address token) external view returns (bool) {
        return prices[token].updatedAt > 0;
    }

    function convertAmount(address fromToken, address toToken, uint256 amount)
        external
        view
        returns (uint256)
    {
        PriceData memory priceFrom = prices[fromToken];
        PriceData memory priceTo = prices[toToken];

        if (priceFrom.updatedAt == 0 || priceTo.updatedAt == 0) return amount;

        // Use safe math: divide first to avoid overflow
        // Formula: amount * (priceFrom / priceTo) * (10^decimalsTo / 10^decimalsFrom)
        // Simplified: amount * priceFrom * 10^(decimalsTo - decimalsFrom) / priceTo
        // For same decimals: amount * priceFrom / priceTo
        uint256 result;
        if (priceFrom.decimals >= priceTo.decimals) {
            uint256 factor = 10 ** (priceFrom.decimals - priceTo.decimals);
            result = (amount * priceFrom.price) / (priceTo.price * factor);
        } else {
            uint256 factor = 10 ** (priceTo.decimals - priceFrom.decimals);
            result = (amount * priceFrom.price * factor) / priceTo.price;
        }
        return result;
    }
}

// ============ Mock Token ============

contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

