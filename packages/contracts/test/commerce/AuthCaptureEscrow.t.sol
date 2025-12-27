// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {AuthCaptureEscrow} from "../../src/commerce/AuthCaptureEscrow.sol";
import {PaymentStatus, PaymentAuthorization} from "../../src/commerce/ICommerceTypes.sol";
import {MockERC20} from "../mocks/MockTokens.sol";

contract AuthCaptureEscrowTest is Test {
    AuthCaptureEscrow public escrow;
    MockERC20 public usdc;

    address public owner = address(0x1);
    address public feeRecipient = address(0x2);
    address public merchant = address(0x3);
    address public buyer = address(0x4);
    address public operator = address(0x5);

    uint256 public buyerPk = 0xBEEF;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock USDC
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy escrow
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        escrow = new AuthCaptureEscrow(owner, feeRecipient, tokens);

        // Register merchant
        escrow.registerMerchant(merchant, true);

        vm.stopPrank();

        // Fund buyer
        usdc.mint(buyer, 10000e6);

        // Approve escrow to spend buyer's tokens
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function test_authorize() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        (bytes32 pid, address payer, address m, address token, uint256 amount,,, PaymentStatus status,) =
            escrow.authorizations(paymentId);

        assertEq(pid, paymentId);
        assertEq(payer, buyer);
        assertEq(m, merchant);
        assertEq(token, address(usdc));
        assertEq(amount, 100e6);
        assertEq(uint8(status), uint8(PaymentStatus.Authorized));

        // Funds should be in escrow
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
        assertEq(usdc.balanceOf(buyer), 9900e6);
    }

    function test_authorize_revertsInvalidMerchant() public {
        vm.prank(buyer);
        vm.expectRevert(AuthCaptureEscrow.InvalidMerchant.selector);
        escrow.authorize(
            address(0x999), // unregistered merchant
            address(usdc),
            100e6,
            7 days,
            bytes32("order-001")
        );
    }

    function test_authorize_revertsInvalidToken() public {
        vm.prank(buyer);
        vm.expectRevert(AuthCaptureEscrow.InvalidToken.selector);
        escrow.authorize(
            merchant,
            address(0x999), // unsupported token
            100e6,
            7 days,
            bytes32("order-001")
        );
    }

    function test_capture() public {
        // Authorize
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        // Capture
        vm.prank(merchant);
        escrow.capture(paymentId, 100e6, bytes32("fulfillment-001"));

        (,,,,,,, PaymentStatus status,) = escrow.authorizations(paymentId);
        assertEq(uint8(status), uint8(PaymentStatus.Captured));

        // Merchant should receive funds minus protocol fee (1%)
        assertEq(usdc.balanceOf(merchant), 99e6);
        assertEq(usdc.balanceOf(feeRecipient), 1e6);
    }

    function test_capture_partial() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        // Partial capture (50%)
        vm.prank(merchant);
        escrow.capture(paymentId, 50e6, bytes32("fulfillment-001"));

        // Check captured amount
        assertEq(escrow.capturedAmounts(paymentId), 50e6);

        // Still authorized status (partial capture)
        (,,,,,,, PaymentStatus status,) = escrow.authorizations(paymentId);
        assertEq(uint8(status), uint8(PaymentStatus.Authorized));

        // Can capture the rest
        vm.prank(merchant);
        escrow.capture(paymentId, 50e6, bytes32("fulfillment-002"));

        (,,,,,,, PaymentStatus finalStatus,) = escrow.authorizations(paymentId);
        assertEq(uint8(finalStatus), uint8(PaymentStatus.Captured));
    }

    function test_void() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        // Void (can be done by buyer or merchant before capture)
        vm.prank(buyer);
        escrow.void_(paymentId);

        (,,,,,,, PaymentStatus status,) = escrow.authorizations(paymentId);
        assertEq(uint8(status), uint8(PaymentStatus.Voided));

        // Funds returned to buyer
        assertEq(usdc.balanceOf(buyer), 10000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_void_merchantCanVoid() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        // Merchant can also void
        vm.prank(merchant);
        escrow.void_(paymentId);

        (,,,,,,, PaymentStatus status,) = escrow.authorizations(paymentId);
        assertEq(uint8(status), uint8(PaymentStatus.Voided));
    }

    function test_void_revertsAfterCapture() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        vm.prank(merchant);
        escrow.capture(paymentId, 100e6, bytes32("fulfillment-001"));

        // Can't void after full capture (status is now Captured, not Authorized)
        vm.prank(buyer);
        vm.expectRevert(AuthCaptureEscrow.InvalidPayment.selector);
        escrow.void_(paymentId);
    }

    function test_refund() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 7 days, bytes32("order-001"));

        vm.prank(merchant);
        escrow.capture(paymentId, 100e6, bytes32("fulfillment-001"));

        // Merchant needs to fund the refund
        usdc.mint(merchant, 50e6);
        vm.prank(merchant);
        usdc.approve(address(escrow), 50e6);

        // Refund 50%
        vm.prank(merchant);
        escrow.refund(paymentId, 50e6, "Customer unhappy");

        assertEq(escrow.refundedAmounts(paymentId), 50e6);
        assertEq(usdc.balanceOf(buyer), 9950e6); // 9900 + 50 refund
    }

    function test_voidExpired() public {
        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), 100e6, 1 days, bytes32("order-001"));

        // Fast forward past expiry
        vm.warp(block.timestamp + 2 days);

        // Anyone can void expired payments
        escrow.voidExpired(paymentId);

        (,,,,,,, PaymentStatus status,) = escrow.authorizations(paymentId);
        assertEq(uint8(status), uint8(PaymentStatus.Voided));

        // Funds returned to buyer
        assertEq(usdc.balanceOf(buyer), 10000e6);
    }

    function test_authorizeWithSignature() public {
        address signer = vm.addr(buyerPk);

        // Fund signer
        usdc.mint(signer, 1000e6);
        vm.prank(signer);
        usdc.approve(address(escrow), type(uint256).max);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = escrow.nonces(signer);

        bytes32 structHash = keccak256(
            abi.encode(
                escrow.AUTHORIZATION_TYPEHASH(),
                merchant,
                address(usdc),
                100e6,
                deadline,
                bytes32("order-signed"),
                nonce
            )
        );

        (,,,, address verifyingContract,,) = escrow.eip712Domain();

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Jeju Commerce Protocol"),
                keccak256("1"),
                block.chainid,
                verifyingContract
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Operator submits gasless authorization
        vm.prank(operator);
        bytes32 paymentId = escrow.authorizeWithSignature(
            signer, merchant, address(usdc), 100e6, deadline, bytes32("order-signed"), signature
        );

        (, address payer,,, uint256 amount,,,,) = escrow.authorizations(paymentId);
        assertEq(payer, signer);
        assertEq(amount, 100e6);
    }

    function test_setProtocolFee() public {
        vm.prank(owner);
        escrow.setProtocolFee(200); // 2%

        assertEq(escrow.protocolFeeBps(), 200);
    }

    function test_registerOperator() public {
        vm.prank(owner);
        escrow.registerOperator(operator, 50); // 0.5% operator fee

        (address op, uint256 fee, bool active,,) = escrow.operators(operator);
        assertEq(op, operator);
        assertEq(fee, 50);
        assertTrue(active);
    }

    function test_supportedToken() public {
        assertTrue(escrow.supportedTokens(address(usdc)));
        assertFalse(escrow.supportedTokens(address(0x999)));

        // Add new token
        MockERC20 newToken = new MockERC20("New Token", "NEW", 18);
        vm.prank(owner);
        escrow.setTokenSupported(address(newToken), true);
        assertTrue(escrow.supportedTokens(address(newToken)));
    }

    function testFuzz_authorize(uint256 amount) public {
        vm.assume(amount > 0 && amount <= 10000e6);

        vm.prank(buyer);
        bytes32 paymentId = escrow.authorize(merchant, address(usdc), amount, 7 days, bytes32("fuzz-order"));

        (,,,, uint256 authAmount,,,,) = escrow.authorizations(paymentId);
        assertEq(authAmount, amount);
    }
}
