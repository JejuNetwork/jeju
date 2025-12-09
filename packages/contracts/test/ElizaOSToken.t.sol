// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";

/**
 * @title ElizaOSToken AGGRESSIVE Unit Tests
 * @notice Tests MUST crash and find bugs - no defensive code
 * @dev Tests EVERY function with EXACT assertions
 */
contract ElizaOSTokenTest is Test {
    ElizaOSToken public token;

    address public owner = address(this);
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public attacker = address(0x666);

    uint256 constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18; // 1 billion
    uint256 constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18; // 10 billion

    function setUp() public {
        token = new ElizaOSToken(owner);
    }

    // ============ Constructor - MUST set EXACT values ============

    function testConstructor_SetsNameAndSymbol() public view {
        assertEq(token.name(), "ElizaOS Token"); // MUST be exact
        assertEq(token.symbol(), "ELIZA"); // MUST be exact
    }

    function testConstructor_SetsDecimals() public view {
        assertEq(token.decimals(), 18); // MUST be 18
    }

    function testConstructor_MintsInitialSupply() public view {
        assertEq(token.totalSupply(), INITIAL_SUPPLY); // MUST be exact
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY); // MUST be exact
    }

    function testConstructor_SetsMaxSupply() public view {
        assertEq(token.MAX_SUPPLY(), MAX_SUPPLY); // MUST be exact
    }

    // ============ mint - MUST mint EXACT amount ============

    function testMint_MintsCorrectAmount() public {
        uint256 mintAmount = 1000e18;

        uint256 supplyBefore = token.totalSupply();
        uint256 balanceBefore = token.balanceOf(user1);

        token.mint(user1, mintAmount);

        assertEq(token.totalSupply(), supplyBefore + mintAmount); // MUST increase by exact amount
        assertEq(token.balanceOf(user1), balanceBefore + mintAmount); // MUST receive exact amount
    }

    function testMint_RevertsWhenExceedingMaxSupply() public {
        // Mint up to near max
        uint256 remaining = MAX_SUPPLY - INITIAL_SUPPLY;
        token.mint(user1, remaining);

        // Try to mint 1 more - should revert
        vm.expectRevert(ElizaOSToken.MaxSupplyExceeded.selector);
        token.mint(user1, 1);
    }

    function testMint_RevertsExactlyAtMaxSupply() public {
        uint256 remaining = MAX_SUPPLY - INITIAL_SUPPLY;

        // Mint exactly to max - should work
        token.mint(user1, remaining);
        assertEq(token.totalSupply(), MAX_SUPPLY);

        // Try to mint even 1 wei more - should revert
        vm.expectRevert(ElizaOSToken.MaxSupplyExceeded.selector);
        token.mint(user1, 1);
    }

    function testMint_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert(); // Ownable: caller is not the owner
        token.mint(attacker, 1000e18);
    }

    // ============ transfer - Standard ERC20 (OpenZeppelin) ============

    function testTransfer_TransfersCorrectAmount() public {
        uint256 amount = 100e18;

        uint256 senderBefore = token.balanceOf(owner);
        uint256 recipientBefore = token.balanceOf(user1);

        token.transfer(user1, amount);

        assertEq(token.balanceOf(owner), senderBefore - amount); // MUST decrease by exact amount
        assertEq(token.balanceOf(user1), recipientBefore + amount); // MUST increase by exact amount
    }

    function testTransfer_RevertsOnInsufficientBalance() public {
        vm.prank(user1);
        vm.expectRevert(); // ERC20InsufficientBalance
        token.transfer(user2, 1); // user1 has 0 balance
    }

    function testTransfer_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(owner, user1, 100e18);

        token.transfer(user1, 100e18);
    }

    // ============ approve - Standard ERC20 ============

    function testApprove_SetsAllowance() public {
        uint256 amount = 500e18;

        token.approve(user1, amount);

        assertEq(token.allowance(owner, user1), amount); // MUST be exact
    }

    function testApprove_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit Approval(owner, user1, 500e18);

        token.approve(user1, 500e18);
    }

    // ============ transferFrom - Standard ERC20 ============

    function testTransferFrom_TransfersWithAllowance() public {
        uint256 amount = 100e18;

        token.approve(user1, amount);

        vm.prank(user1);
        token.transferFrom(owner, user2, amount);

        assertEq(token.balanceOf(user2), amount); // MUST receive exact amount
        assertEq(token.allowance(owner, user1), 0); // MUST be consumed
    }

    function testTransferFrom_RevertsOnInsufficientAllowance() public {
        token.approve(user1, 50e18);

        vm.prank(user1);
        vm.expectRevert(); // ERC20InsufficientAllowance
        token.transferFrom(owner, user2, 100e18); // Trying to transfer more than allowed
    }

    // ============ Edge Cases - MUST handle correctly ============

    function testMint_CanMintZero() public {
        uint256 supplyBefore = token.totalSupply();

        token.mint(user1, 0);

        assertEq(token.totalSupply(), supplyBefore); // MUST not change
    }

    function testTransfer_CanTransferZero() public {
        uint256 balanceBefore = token.balanceOf(user1);

        token.transfer(user1, 0);

        assertEq(token.balanceOf(user1), balanceBefore); // MUST not change
    }

    function testTransfer_ToSelfWorks() public {
        uint256 balanceBefore = token.balanceOf(owner);

        token.transfer(owner, 100e18);

        assertEq(token.balanceOf(owner), balanceBefore); // MUST stay same
    }

    // ============ Supply Limits - MUST enforce exactly ============

    function testMaxSupply_IsCorrect() public view {
        assertEq(token.MAX_SUPPLY(), 10_000_000_000 * 10 ** 18); // MUST be exact
    }

    function testInitialSupply_IsCorrect() public view {
        assertEq(token.totalSupply(), 1_000_000_000 * 10 ** 18); // MUST be exact
    }

    function testMaxSupply_Is10xInitial() public view {
        assertEq(token.MAX_SUPPLY(), INITIAL_SUPPLY * 10); // MUST be exactly 10x
    }

    // ============ Version ============

    function testVersion() public view {
        assertEq(token.version(), "1.0.0");
    }

    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
