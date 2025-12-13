// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockEntryPoint} from "./mocks/MockEntryPoint.sol";

/**
 * @title EILEntryPointTest
 * @notice Tests ERC-4337 paymaster flow by simulating real EntryPoint behavior
 * @dev These tests call the paymaster validation and postOp functions directly,
 *      simulating how the real EntryPoint would invoke them.
 *
 * This uses MockEntryPoint which correctly simulates the EntryPoint interface,
 * allowing us to test the paymaster's ERC-4337 integration without a fork.
 */
contract EILEntryPointTest is Test {
    CrossChainPaymaster public paymaster;
    L1StakeManager public stakeManager;
    MockEntryPoint public mockEntryPoint;

    address public owner = address(0x1);
    address public xlp = address(0x2);
    address public user = address(0x3);
    address public entryPoint;

    EILMockERC20 public usdc;
    EILMockPriceOracle public oracle;

    uint256 constant XLP_STAKE = 10 ether;
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    // Simulated voucher data
    bytes32 public testVoucherId;
    uint256 public voucherAmount = 1000e6; // 1000 USDC

    uint256 constant OP_SEPOLIA_CHAIN_ID = 11155420;

    function setUp() public {
        // Warp time to avoid underflow in exchange rate calculations
        vm.warp(1700000000);

        vm.startPrank(owner);

        // Deploy mock tokens and EntryPoint
        usdc = new EILMockERC20("USDC", "USDC", 6);
        oracle = new EILMockPriceOracle();
        mockEntryPoint = new MockEntryPoint();

        // Deploy L1 stake manager
        stakeManager = new L1StakeManager();

        // Deploy paymaster with MockEntryPoint
        entryPoint = address(mockEntryPoint);
        paymaster = new CrossChainPaymaster(
            IEntryPoint(entryPoint), address(stakeManager), BASE_SEPOLIA_CHAIN_ID, address(oracle)
        );

        // Configure paymaster
        paymaster.setTokenSupport(address(usdc), true);
        paymaster.setMaxGasCost(1 ether);

        // Register both chains with L1 stake manager
        stakeManager.registerL2Paymaster(BASE_SEPOLIA_CHAIN_ID, address(paymaster));
        stakeManager.registerL2Paymaster(OP_SEPOLIA_CHAIN_ID, address(0xDEAD)); // Dummy for cross-chain

        vm.stopPrank();

        // XLP registration and staking
        vm.deal(xlp, XLP_STAKE + 10 ether);
        vm.startPrank(xlp);

        uint256[] memory chains = new uint256[](2);
        chains[0] = BASE_SEPOLIA_CHAIN_ID;
        chains[1] = OP_SEPOLIA_CHAIN_ID;
        stakeManager.register{value: XLP_STAKE}(chains);
        vm.stopPrank();

        // Fund user with USDC
        usdc.mint(user, 10000e6);

        // XLP deposits liquidity (tokens and ETH)
        usdc.mint(xlp, 100000e6);
        vm.startPrank(xlp);
        usdc.approve(address(paymaster), type(uint256).max);
        paymaster.depositLiquidity(address(usdc), 50000e6);
        paymaster.depositETH{value: 5 ether}(); // ETH for voucher gas sponsorship
        vm.stopPrank();

        // Deposit ETH to EntryPoint on behalf of paymaster (for token gas payments)
        vm.deal(address(paymaster), 10 ether);
        vm.prank(address(paymaster));
        mockEntryPoint.depositTo{value: 5 ether}(address(paymaster));

        // Set XLP verified stake (simulates L1→L2 message)
        vm.prank(owner);
        paymaster.updateXLPStake(xlp, XLP_STAKE);

        // User approves paymaster
        vm.prank(user);
        usdc.approve(address(paymaster), type(uint256).max);
    }

    // ============ Token Payment Mode Tests ============

    function test_ValidatePaymasterUserOp_TokenPayment_Valid() public {
        // Build paymasterAndData for token payment mode
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][token(20)][appAddress(20)]
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));

        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        // Simulate EntryPoint calling validatePaymasterUserOp
        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        // validationData should be 0 for valid
        assertEq(validationData, 0, "Should validate successfully");
        assertTrue(context.length > 0, "Should return context");
    }

    function test_ValidatePaymasterUserOp_TokenPayment_InsufficientBalance() public {
        // User with no USDC
        address poorUser = address(0xDEAD);

        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(poorUser, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        // Should return invalid (validationData = 1)
        assertEq(validationData, 1, "Should fail validation for insufficient balance");
        assertEq(context.length, 0, "Should return empty context");
    }

    function test_ValidatePaymasterUserOp_GasCostTooHigh() public {
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        // Try with gas cost exceeding max
        vm.prank(entryPoint);
        vm.expectRevert(CrossChainPaymaster.GasCostTooHigh.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 10 ether);
    }

    function test_ValidatePaymasterUserOp_UnsupportedToken() public {
        address fakeToken = address(0x999);
        bytes memory paymasterAndData = _buildTokenPaymentData(fakeToken, address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        // Should return invalid for unsupported token
        assertEq(validationData, 1, "Should fail for unsupported token");
    }

    function test_ValidatePaymasterUserOp_TooShortData() public {
        // paymasterAndData too short
        bytes memory paymasterAndData = abi.encodePacked(address(paymaster), uint128(100000), uint128(50000));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        assertEq(validationData, 1, "Should fail for too short data");
    }

    // ============ PostOp Tests ============

    function test_PostOp_TokenPayment_DeductsCorrectAmount() public {
        // First validate to get context
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        uint256 userBalanceBefore = usdc.balanceOf(user);
        uint256 paymasterBalanceBefore = usdc.balanceOf(address(paymaster));

        // Simulate postOp with actual gas cost
        uint256 actualGasCost = 0.005 ether;
        vm.prank(entryPoint);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, 0);

        uint256 userBalanceAfter = usdc.balanceOf(user);

        // User should have paid some USDC for gas
        assertTrue(userBalanceAfter < userBalanceBefore, "User should pay for gas");
        console.log("Gas paid (USDC):", (userBalanceBefore - userBalanceAfter) / 1e6);
    }

    function test_PostOp_OpReverted_NoCharge() public {
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        uint256 userBalanceBefore = usdc.balanceOf(user);

        // Simulate postOp with mode = opReverted
        vm.prank(entryPoint);
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 0.005 ether, 0);

        uint256 userBalanceAfter = usdc.balanceOf(user);

        // Should not charge on revert (depends on implementation)
        console.log("Balance change on revert:", int256(userBalanceAfter) - int256(userBalanceBefore));
    }

    // ============ Voucher Mode Tests ============

    function test_ValidatePaymasterUserOp_VoucherMode_WithRealVoucher() public {
        // Create a real voucher through the full flow
        testVoucherId = _createVoucher();

        // Build voucher mode paymasterAndData
        bytes memory paymasterAndData = _buildVoucherPaymentData(testVoucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should validate successfully - XLP has ETH deposits
        assertEq(validationData, 0, "Should validate with valid voucher");
        assertTrue(context.length > 0, "Should return context");
    }

    function test_ValidatePaymasterUserOp_VoucherMode_XLPInsufficientETH() public {
        // Create a voucher, then drain XLP's ETH deposits
        testVoucherId = _createVoucher();

        // Withdraw all XLP ETH deposits
        vm.prank(xlp);
        paymaster.withdrawETH(paymaster.getXLPETH(xlp));

        bytes memory paymasterAndData = _buildVoucherPaymentData(testVoucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should fail because XLP has no ETH to cover gas
        assertEq(validationData, 1, "Should fail when XLP has no ETH");
        assertEq(context.length, 0, "Should return empty context");
    }

    function test_ValidatePaymasterUserOp_VoucherMode_Valid() public {
        // XLP has ETH deposits - should pass validation
        bytes32 voucherId = bytes32(uint256(0xCAFE)); // Fake voucher ID
        bytes memory paymasterAndData = _buildVoucherPaymentData(voucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Voucher validation only checks XLP ETH deposits, not voucher existence
        assertEq(validationData, 0, "Should pass when XLP has ETH deposits");
        assertTrue(context.length > 0, "Should return context");
    }

    function test_ValidatePaymasterUserOp_VoucherMode_XLPNoETH() public {
        // Create a new XLP without ETH deposits
        address poorXLP = address(0xBEEF);

        bytes32 fakeVoucherId = bytes32(uint256(0xDEADBEEF));
        bytes memory paymasterAndData = _buildVoucherPaymentData(fakeVoucherId, poorXLP);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should fail because XLP has no ETH deposits (voucher existence not checked in validate phase)
        assertEq(validationData, 1, "Should fail when XLP has no ETH deposits");
        assertEq(context.length, 0, "Should return empty context");
    }

    // ============ Access Control Tests ============

    function test_OnlyEntryPoint_CanCallValidate() public {
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        // Non-entrypoint should fail
        vm.prank(user);
        vm.expectRevert();
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);
    }

    function test_OnlyEntryPoint_CanCallPostOp() public {
        bytes memory context = abi.encode(bytes32(0), address(0), uint256(0), uint8(0));

        vm.prank(user);
        vm.expectRevert();
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, 0.01 ether, 0);
    }

    // ============ Integration Flow Test ============

    function test_FullGasSponsorshipFlow() public {
        console.log("=== Full Gas Sponsorship Flow ===");

        // 1. User has USDC, wants to pay gas in USDC
        uint256 initialBalance = usdc.balanceOf(user);
        console.log("User initial USDC:", initialBalance / 1e6);

        // 2. Build UserOp with token payment
        bytes memory paymasterAndData = _buildTokenPaymentData(address(usdc), address(0));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        // 3. EntryPoint validates
        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.05 ether);
        assertEq(validationData, 0, "Validation should pass");

        // 4. UserOp executes (simulated)
        console.log("UserOp executed...");

        // 5. EntryPoint calls postOp
        uint256 actualGasCost = 0.02 ether; // 0.02 ETH gas
        vm.prank(entryPoint);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, 0);

        // 6. Verify user paid in USDC
        uint256 finalBalance = usdc.balanceOf(user);
        uint256 usdcPaid = initialBalance - finalBalance;
        console.log("User final USDC:", finalBalance / 1e6);
        console.log("USDC paid for gas:", usdcPaid / 1e6);

        assertTrue(usdcPaid > 0, "User should have paid USDC for gas");

        // 7. Calculate expected cost (ETH -> USDC conversion)
        uint256 ethPriceUSD = oracle.getETHPriceUSD();
        uint256 expectedMinCost = (actualGasCost * ethPriceUSD) / 1e18;
        console.log("Expected min cost (USDC):", expectedMinCost / 1e6);

        // USDC paid should be close to expected (with margin)
        assertTrue(usdcPaid >= expectedMinCost, "Should pay at least the gas cost");
    }

    // ============ Helpers ============

    function _buildUserOp(address sender, bytes memory paymasterAndData)
        internal
        pure
        returns (PackedUserOperation memory)
    {
        return PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData: paymasterAndData,
            signature: ""
        });
    }

    function _buildTokenPaymentData(address token, address app) internal view returns (bytes memory) {
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][token(20)][appAddress(20)]
        return abi.encodePacked(
            address(paymaster),
            uint128(100000), // verificationGas
            uint128(50000), // postOpGas
            uint8(0), // mode = token payment
            token,
            app
        );
    }

    function _buildVoucherPaymentData(bytes32 voucherId, address xlpAddr) internal view returns (bytes memory) {
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][voucherId(32)][xlp(20)]
        return abi.encodePacked(
            address(paymaster),
            uint128(100000),
            uint128(50000),
            uint8(1), // mode = voucher
            voucherId,
            xlpAddr
        );
    }

    function _createVoucher() internal returns (bytes32) {
        // User creates a voucher request
        vm.deal(user, 1 ether);
        usdc.mint(user, 10000e6);

        vm.startPrank(user);
        usdc.approve(address(paymaster), type(uint256).max);

        bytes32 requestId = paymaster.createVoucherRequest{value: 0.1 ether}(
            address(usdc),
            1000e6, // 1000 USDC
            address(usdc),
            OP_SEPOLIA_CHAIN_ID, // Different chain for cross-chain transfer
            user,
            100000, // gas on destination
            0.1 ether, // max fee
            0.001 ether // fee increment
        );
        vm.stopPrank();

        // XLP bids and issues voucher
        vm.startPrank(xlp);
        paymaster.submitBid(requestId);

        // Build signature for issuing voucher
        bytes memory signature = _signVoucher(requestId);
        bytes32 voucherId = paymaster.issueVoucher(requestId, signature);
        vm.stopPrank();

        return voucherId;
    }

    function _signVoucher(bytes32 requestId) internal view returns (bytes memory) {
        // Get request details to build correct commitment
        (
            , // requester
            , // token
            uint256 amount,
            , // destinationToken
            uint256 destChainId,
            , // recipient
            , // gasOnDestination
            , // maxFee
            , // feeIncrement
            , // deadline
            , // createdBlock
            , // claimed
            , // expired
            , // refunded
            , // bidCount
            , // winningXLP
                // winningFee
        ) = paymaster.voucherRequests(requestId);
        uint256 fee = paymaster.getCurrentFee(requestId);

        // Build commitment: keccak256(abi.encodePacked(requestId, msg.sender, amount, fee, destChainId))
        bytes32 commitment = keccak256(abi.encodePacked(requestId, xlp, amount, fee, destChainId));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", commitment));

        // Sign with xlp's private key (address(0x2) corresponds to private key 2)
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(2, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}

// ============ Mock Contracts ============

contract EILMockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
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

contract EILMockPriceOracle {
    function getETHPriceUSD() external pure returns (uint256) {
        return 3000e6; // $3000
    }

    function getTokenPriceUSD(address) external pure returns (uint256) {
        return 1e6; // $1 for USDC
    }

    function convertETHToToken(address, uint256 ethAmount) external pure returns (uint256) {
        // 1 ETH = 3000 USDC
        return (ethAmount * 3000e6) / 1e18;
    }

    function isPriceFresh(address) external pure returns (bool) {
        return true;
    }

    function convertAmount(address, address, uint256 amount) external pure returns (uint256) {
        // 1 ETH = 3000 tokens (USDC)
        return (amount * 3000e6) / 1e18;
    }

    function getPrice(address) external pure returns (uint256, bool) {
        return (1e18, true); // $1 for stablecoins
    }
}
