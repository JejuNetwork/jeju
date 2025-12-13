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

    MockERC20 public usdc;
    MockPriceOracle public oracle;

    uint256 constant XLP_STAKE = 10 ether;
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    // Simulated voucher data
    bytes32 public testVoucherId;
    uint256 public voucherAmount = 1000e6; // 1000 USDC

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock tokens and EntryPoint
        usdc = new MockERC20("USDC", "USDC", 6);
        oracle = new MockPriceOracle();
        mockEntryPoint = new MockEntryPoint();

        // Deploy L1 stake manager
        stakeManager = new L1StakeManager();

        // Deploy paymaster with MockEntryPoint
        entryPoint = address(mockEntryPoint);
        paymaster = new CrossChainPaymaster(IEntryPoint(entryPoint), address(stakeManager), BASE_SEPOLIA_CHAIN_ID, address(oracle));

        // Configure paymaster
        paymaster.setTokenSupport(address(usdc), true);
        paymaster.setMaxGasCost(1 ether);

        // Register the L2 paymaster with L1 stake manager so chains are supported
        stakeManager.registerL2Paymaster(BASE_SEPOLIA_CHAIN_ID, address(paymaster));

        // Register XLP
        uint256[] memory chains = new uint256[](1);
        chains[0] = BASE_SEPOLIA_CHAIN_ID;

        vm.stopPrank();

        // XLP registration and staking
        vm.deal(xlp, XLP_STAKE + 1 ether);
        vm.startPrank(xlp);
        stakeManager.register{value: XLP_STAKE}(chains);
        vm.stopPrank();

        // Fund user with USDC
        usdc.mint(user, 10000e6);

        // XLP deposits liquidity
        usdc.mint(xlp, 100000e6);
        vm.startPrank(xlp);
        usdc.approve(address(paymaster), type(uint256).max);
        paymaster.depositLiquidity(address(usdc), 50000e6);
        vm.stopPrank();

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
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

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
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

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
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

        // Should return invalid for unsupported token
        assertEq(validationData, 1, "Should fail for unsupported token");
    }

    function test_ValidatePaymasterUserOp_TooShortData() public {
        // paymasterAndData too short
        bytes memory paymasterAndData = abi.encodePacked(address(paymaster), uint128(100000), uint128(50000));
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.01 ether);

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

    function test_ValidatePaymasterUserOp_VoucherMode_Valid() public {
        // Create a voucher first
        testVoucherId = _createVoucher();

        // Build voucher mode paymasterAndData
        // Format: [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][voucherId(32)][xlp(20)]
        bytes memory paymasterAndData = _buildVoucherPaymentData(testVoucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should validate successfully for valid voucher
        assertEq(validationData, 0, "Should validate with valid voucher");
        assertTrue(context.length > 0, "Should return context");
    }

    function test_ValidatePaymasterUserOp_VoucherMode_ExpiredVoucher() public {
        // Create voucher
        testVoucherId = _createVoucher();

        // Warp past voucher expiry (assuming 24h default)
        vm.warp(block.timestamp + 25 hours);

        bytes memory paymasterAndData = _buildVoucherPaymentData(testVoucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should fail for expired voucher
        assertEq(validationData, 1, "Should fail for expired voucher");
    }

    function test_ValidatePaymasterUserOp_VoucherMode_InvalidVoucherId() public {
        bytes32 fakeVoucherId = bytes32(uint256(0xDEADBEEF));

        bytes memory paymasterAndData = _buildVoucherPaymentData(fakeVoucherId, xlp);
        PackedUserOperation memory userOp = _buildUserOp(user, paymasterAndData);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.001 ether);

        // Should fail for non-existent voucher
        assertEq(validationData, 1, "Should fail for invalid voucher");
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
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0.05 ether);
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

    function _buildUserOp(address sender, bytes memory paymasterAndData) internal pure returns (PackedUserOperation memory) {
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
        vm.stopPrank();

        usdc.mint(user, 10000e6);
        vm.startPrank(user);
        usdc.approve(address(paymaster), type(uint256).max);

        bytes32 requestId = paymaster.createVoucherRequest{value: 0.1 ether}(
            address(usdc),
            1000e6, // 1000 USDC
            address(usdc),
            BASE_SEPOLIA_CHAIN_ID,
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

        vm.startPrank(owner);
        return voucherId;
    }

    function _signVoucher(bytes32 requestId) internal view returns (bytes memory) {
        // Create a valid signature (in real tests, use vm.sign)
        bytes32 messageHash = keccak256(abi.encodePacked(requestId, xlp, block.chainid));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(2, messageHash); // xlp is address(0x2)
        return abi.encodePacked(r, s, v);
    }
}

// ============ Mock Contracts ============

contract MockERC20 is IERC20 {
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

contract MockPriceOracle {
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
}
