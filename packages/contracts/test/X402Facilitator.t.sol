// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract X402FacilitatorTest is Test {
    X402Facilitator public facilitator;
    MockUSDC public usdc;

    address public owner = address(0x1);
    address public feeRecipient = address(0x2);
    address public payer;
    uint256 public payerKey;
    address public recipient = address(0x4);

    bytes32 constant PAYMENT_TYPEHASH = keccak256(
        "Payment(string scheme,string network,address asset,address payTo,uint256 amount,string resource,string nonce,uint256 timestamp)"
    );

    function setUp() public {
        (payer, payerKey) = makeAddrAndKey("payer");

        vm.startPrank(owner);
        usdc = new MockUSDC();

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        facilitator = new X402Facilitator(owner, feeRecipient, tokens);
        vm.stopPrank();

        // Fund payer
        vm.prank(owner);
        usdc.mint(payer, 100_000 * 10 ** 6);

        // Approve facilitator
        vm.prank(payer);
        usdc.approve(address(facilitator), type(uint256).max);
    }

    function test_settle_success() public {
        uint256 amount = 1_000_000; // 1 USDC
        string memory resource = "/api/test";
        string memory nonce = "test-nonce-123";
        uint256 timestamp = block.timestamp;

        bytes memory signature = _signPayment(address(usdc), recipient, amount, resource, nonce, timestamp);

        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 recipientBefore = usdc.balanceOf(recipient);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        bytes32 paymentId =
            facilitator.settle(payer, recipient, address(usdc), amount, resource, nonce, timestamp, signature);

        assertNotEq(paymentId, bytes32(0));

        // Check balances
        uint256 fee = (amount * 50) / 10000; // 0.5%
        assertEq(usdc.balanceOf(payer), payerBefore - amount);
        assertEq(usdc.balanceOf(recipient), recipientBefore + (amount - fee));
        assertEq(usdc.balanceOf(feeRecipient), feeBefore + fee);

        // Check stats
        assertEq(facilitator.totalSettlements(), 1);
    }

    function test_settle_revert_expired() public {
        // Warp to a reasonable timestamp
        vm.warp(1700000000);

        uint256 amount = 1_000_000;
        string memory resource = "/api/test";
        string memory nonce = "expired-nonce";
        uint256 timestamp = block.timestamp - 600; // 10 minutes ago

        bytes memory signature = _signPayment(address(usdc), recipient, amount, resource, nonce, timestamp);

        vm.expectRevert(X402Facilitator.PaymentExpired.selector);
        facilitator.settle(payer, recipient, address(usdc), amount, resource, nonce, timestamp, signature);
    }

    function test_settle_revert_nonce_reuse() public {
        uint256 amount = 1_000_000;
        string memory resource = "/api/test";
        string memory nonce = "reused-nonce";
        uint256 timestamp = block.timestamp;

        bytes memory signature = _signPayment(address(usdc), recipient, amount, resource, nonce, timestamp);

        // First settle succeeds
        facilitator.settle(payer, recipient, address(usdc), amount, resource, nonce, timestamp, signature);

        // Second settle with same nonce fails
        vm.expectRevert(X402Facilitator.NonceAlreadyUsed.selector);
        facilitator.settle(payer, recipient, address(usdc), amount, resource, nonce, timestamp, signature);
    }

    function test_settle_revert_invalid_signature() public {
        uint256 amount = 1_000_000;
        string memory resource = "/api/test";
        string memory nonce = "invalid-sig-nonce";
        uint256 timestamp = block.timestamp;

        // Sign with wrong amount
        bytes memory signature = _signPayment(address(usdc), recipient, amount + 1, resource, nonce, timestamp);

        vm.expectRevert(X402Facilitator.InvalidSignature.selector);
        facilitator.settle(payer, recipient, address(usdc), amount, resource, nonce, timestamp, signature);
    }

    function test_settle_revert_unsupported_token() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(payer, 100_000 * 10 ** 6);
        vm.prank(payer);
        otherToken.approve(address(facilitator), type(uint256).max);

        uint256 amount = 1_000_000;
        string memory resource = "/api/test";
        string memory nonce = "unsupported-token-nonce";
        uint256 timestamp = block.timestamp;

        bytes memory signature = _signPayment(address(otherToken), recipient, amount, resource, nonce, timestamp);

        vm.expectRevert(X402Facilitator.UnsupportedToken.selector);
        facilitator.settle(payer, recipient, address(otherToken), amount, resource, nonce, timestamp, signature);
    }

    function test_isNonceUsed() public {
        string memory nonce = "check-nonce";
        assertFalse(facilitator.isNonceUsed(payer, nonce));

        uint256 amount = 1_000_000;
        uint256 timestamp = block.timestamp;
        bytes memory signature = _signPayment(address(usdc), recipient, amount, "/api/test", nonce, timestamp);

        facilitator.settle(payer, recipient, address(usdc), amount, "/api/test", nonce, timestamp, signature);

        assertTrue(facilitator.isNonceUsed(payer, nonce));
    }

    function test_getStats() public {
        (uint256 settlements, uint256 volume, uint256 feeBps, address feeAddr) = facilitator.getStats();
        assertEq(settlements, 0);
        assertEq(feeBps, 50);
        assertEq(feeAddr, feeRecipient);

        // Do a settlement
        uint256 amount = 1_000_000;
        uint256 timestamp = block.timestamp;
        bytes memory signature = _signPayment(address(usdc), recipient, amount, "/api/test", "stats-nonce", timestamp);
        facilitator.settle(payer, recipient, address(usdc), amount, "/api/test", "stats-nonce", timestamp, signature);

        (settlements, volume,,) = facilitator.getStats();
        assertEq(settlements, 1);
        assertEq(volume, amount * 1e12); // 6 decimals -> 18 decimals
    }

    function test_settle_upto_scheme() public {
        uint256 actualAmount = 1_500_000; // Pay 1.5 USDC
        string memory resource = "/api/test";
        string memory nonce = "upto-nonce-123";
        uint256 timestamp = block.timestamp;

        // Sign with 'upto' scheme
        bytes memory signature = _signPaymentUpto(address(usdc), recipient, actualAmount, resource, nonce, timestamp);

        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 recipientBefore = usdc.balanceOf(recipient);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        bytes32 paymentId =
            facilitator.settle(payer, recipient, address(usdc), actualAmount, resource, nonce, timestamp, signature);

        assertNotEq(paymentId, bytes32(0));

        // Check balances - should transfer actualAmount
        uint256 fee = (actualAmount * 50) / 10000; // 0.5%
        assertEq(usdc.balanceOf(payer), payerBefore - actualAmount);
        assertEq(usdc.balanceOf(recipient), recipientBefore + (actualAmount - fee));
        assertEq(usdc.balanceOf(feeRecipient), feeBefore + fee);
    }

    function _signPayment(
        address token,
        address payTo,
        uint256 amount,
        string memory resource,
        string memory nonce,
        uint256 timestamp
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes("exact")),
                keccak256(bytes("jeju")),
                token,
                payTo,
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", facilitator.domainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPaymentUpto(
        address token,
        address payTo,
        uint256 amount,
        string memory resource,
        string memory nonce,
        uint256 timestamp
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes("upto")),
                keccak256(bytes("jeju")),
                token,
                payTo,
                amount,
                keccak256(bytes(resource)),
                keccak256(bytes(nonce)),
                timestamp
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", facilitator.domainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
