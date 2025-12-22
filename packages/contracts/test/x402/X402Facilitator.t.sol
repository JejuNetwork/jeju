// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {X402Facilitator} from "../../src/x402/X402Facilitator.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1000000 * 10**6);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract X402FacilitatorTest is Test {
    X402Facilitator public facilitator;
    MockUSDC public usdc;
    
    address public owner;
    address public feeRecipient;
    address public service;
    address public recipient;
    address public payer;
    
    function setUp() public {
        owner = makeAddr("owner");
        feeRecipient = makeAddr("feeRecipient");
        service = makeAddr("service");
        recipient = makeAddr("recipient");
        payer = makeAddr("payer");
        
        vm.deal(owner, 100 ether);
        vm.deal(payer, 100 ether);
        
        // Deploy USDC
        vm.prank(owner);
        usdc = new MockUSDC();
        
        // Transfer USDC to payer
        vm.prank(owner);
        usdc.transfer(payer, 10000 * 10**6);
        
        // Deploy facilitator with USDC as initial token
        address[] memory initialTokens = new address[](1);
        initialTokens[0] = address(usdc);
        
        vm.prank(owner);
        facilitator = new X402Facilitator(owner, feeRecipient, initialTokens);
    }
    
    // ============ Basic Tests ============
    
    function test_Constructor() public view {
        assertEq(facilitator.feeRecipient(), feeRecipient);
        assertTrue(facilitator.supportedTokens(address(usdc)));
    }
    
    function test_SettlePayment_RevertIfUnsupportedToken() public {
        address unsupportedToken = makeAddr("unsupportedToken");
        
        vm.expectRevert(X402Facilitator.UnsupportedToken.selector);
        facilitator.settle(
            payer,
            recipient,
            unsupportedToken,
            100,
            "/api/data",
            "nonce",
            block.timestamp,
            ""
        );
    }
    
    function test_SettlePayment_RevertIfInvalidAmount() public {
        vm.expectRevert(X402Facilitator.InvalidAmount.selector);
        facilitator.settle(
            payer,
            recipient,
            address(usdc),
            0, // Invalid amount
            "/api/data",
            "nonce",
            block.timestamp,
            ""
        );
    }
    
    function test_SettlePayment_RevertIfInvalidRecipient() public {
        vm.expectRevert(X402Facilitator.InvalidRecipient.selector);
        facilitator.settle(
            payer,
            address(0), // Invalid recipient
            address(usdc),
            100,
            "/api/data",
            "nonce",
            block.timestamp,
            ""
        );
    }
    
    function test_SettlePayment_RevertIfExpired() public {
        uint256 amount = 100 * 10**6;
        uint256 timestamp = block.timestamp - 400; // More than 5 minutes ago
        
        vm.expectRevert(X402Facilitator.PaymentExpired.selector);
        facilitator.settle(
            payer,
            recipient,
            address(usdc),
            amount,
            "/api/data",
            "nonce",
            timestamp,
            ""
        );
    }
    
    // ============ Token Management Tests ============
    
    function test_AddSupportedToken() public {
        address newToken = makeAddr("newToken");
        
        vm.startPrank(owner);
        facilitator.setTokenSupported(newToken, true);
        facilitator.setTokenDecimals(newToken, 18);
        vm.stopPrank();
        
        assertTrue(facilitator.supportedTokens(newToken));
        assertEq(facilitator.tokenDecimals(newToken), 18);
    }
    
    function test_RemoveSupportedToken() public {
        assertTrue(facilitator.supportedTokens(address(usdc)));
        
        vm.prank(owner);
        facilitator.setTokenSupported(address(usdc), false);
        
        assertFalse(facilitator.supportedTokens(address(usdc)));
    }
    
    function test_SetSupportedToken_RevertIfNotOwner() public {
        address newToken = makeAddr("newToken");
        
        vm.prank(payer);
        vm.expectRevert();
        facilitator.setTokenSupported(newToken, true);
    }
    
    // ============ Fee Management Tests ============
    
    function test_SetProtocolFee() public {
        vm.prank(owner);
        facilitator.setProtocolFee(100); // 1%
        
        assertEq(facilitator.protocolFeeBps(), 100);
    }
    
    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        facilitator.setProtocolFee(1001); // > 10%
    }
    
    function test_SetFeeRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        
        vm.prank(owner);
        facilitator.setFeeRecipient(newRecipient);
        
        assertEq(facilitator.feeRecipient(), newRecipient);
    }
    
    function test_SetFeeRecipient_RevertIfNotOwner() public {
        address newRecipient = makeAddr("newRecipient");
        
        vm.prank(payer);
        vm.expectRevert();
        facilitator.setFeeRecipient(newRecipient);
    }
    
    // ============ View Functions Tests ============
    
    function test_GetStats_Initial() public view {
        assertEq(facilitator.totalSettlements(), 0);
        assertEq(facilitator.totalVolumeUSD(), 0);
        assertEq(facilitator.totalProtocolFees(), 0);
    }
    
    // ============ Nonce Tests ============
    
    function test_UsedNonces() public view {
        bytes32 nonceHash = keccak256(abi.encodePacked(payer, "nonce123"));
        assertFalse(facilitator.usedNonces(nonceHash));
    }
}
