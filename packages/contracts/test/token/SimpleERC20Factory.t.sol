// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SimpleERC20Factory, SimpleERC20} from "../../src/token/SimpleERC20Factory.sol";

contract SimpleERC20FactoryTest is Test {
    SimpleERC20Factory public factory;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint8 decimals,
        uint256 initialSupply
    );

    function setUp() public {
        factory = new SimpleERC20Factory();
    }

    function test_CreateToken() public {
        vm.startPrank(alice);

        address tokenAddr = factory.createToken("Test Token", "TEST", 18, 1000000 * 1e18);

        assertTrue(tokenAddr != address(0), "Token address should not be zero");

        SimpleERC20 token = SimpleERC20(tokenAddr);
        assertEq(token.name(), "Test Token");
        assertEq(token.symbol(), "TEST");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1000000 * 1e18);
        assertEq(token.balanceOf(alice), 1000000 * 1e18);
        assertEq(token.owner(), alice);
        assertEq(token.creator(), alice);

        vm.stopPrank();
    }

    function test_CreateTokenEmitsEvent() public {
        vm.expectEmit(false, true, false, true);
        emit TokenCreated(
            address(0), // We don't know the address yet
            alice,
            "Test Token",
            "TEST",
            18,
            1000000 * 1e18
        );

        vm.prank(alice);
        factory.createToken("Test Token", "TEST", 18, 1000000 * 1e18);
    }

    function test_CreateMultipleTokens() public {
        vm.startPrank(alice);

        address token1 = factory.createToken("Token 1", "TK1", 18, 1e24);
        address token2 = factory.createToken("Token 2", "TK2", 6, 1e12);

        address[] memory aliceTokens = factory.getCreatorTokens(alice);
        assertEq(aliceTokens.length, 2);
        assertEq(aliceTokens[0], token1);
        assertEq(aliceTokens[1], token2);

        vm.stopPrank();

        // Different creator
        vm.prank(bob);
        address token3 = factory.createToken("Token 3", "TK3", 18, 1e24);

        address[] memory bobTokens = factory.getCreatorTokens(bob);
        assertEq(bobTokens.length, 1);
        assertEq(bobTokens[0], token3);

        assertEq(factory.tokenCount(), 3);
    }

    function test_GetAllTokensPagination() public {
        vm.startPrank(alice);

        for (uint256 i = 0; i < 5; i++) {
            factory.createToken(string.concat("Token ", vm.toString(i)), string.concat("TK", vm.toString(i)), 18, 1e24);
        }

        vm.stopPrank();

        // Get first 3 tokens
        address[] memory page1 = factory.getAllTokens(0, 3);
        assertEq(page1.length, 3);

        // Get next 2 tokens
        address[] memory page2 = factory.getAllTokens(3, 3);
        assertEq(page2.length, 2);

        // Beyond total
        address[] memory page3 = factory.getAllTokens(10, 10);
        assertEq(page3.length, 0);
    }

    function test_RevertEmptyName() public {
        vm.expectRevert("Name cannot be empty");
        factory.createToken("", "TEST", 18, 1e24);
    }

    function test_RevertEmptySymbol() public {
        vm.expectRevert("Invalid symbol");
        factory.createToken("Test", "", 18, 1e24);
    }

    function test_RevertSymbolTooLong() public {
        vm.expectRevert("Invalid symbol");
        factory.createToken("Test", "VERYLONGSYM", 18, 1e24);
    }

    function test_RevertDecimalsTooHigh() public {
        vm.expectRevert("Decimals too high");
        factory.createToken("Test", "TEST", 19, 1e24);
    }

    function test_TokenOwnership() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken("Test", "TEST", 18, 1e24);

        SimpleERC20 token = SimpleERC20(tokenAddr);

        // Creator is owner
        assertEq(token.owner(), alice);

        // Owner can mint
        vm.prank(alice);
        token.mint(bob, 1000 * 1e18);
        assertEq(token.balanceOf(bob), 1000 * 1e18);

        // Non-owner cannot mint
        vm.expectRevert();
        vm.prank(bob);
        token.mint(bob, 1000 * 1e18);
    }

    function test_TokenBurn() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken("Test", "TEST", 18, 1000 * 1e18);

        SimpleERC20 token = SimpleERC20(tokenAddr);
        assertEq(token.balanceOf(alice), 1000 * 1e18);

        vm.prank(alice);
        token.burn(100 * 1e18);

        assertEq(token.balanceOf(alice), 900 * 1e18);
        assertEq(token.totalSupply(), 900 * 1e18);
    }

    function test_CreateTokenWithZeroSupply() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken("Test", "TEST", 18, 0);

        SimpleERC20 token = SimpleERC20(tokenAddr);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);

        // Owner can still mint later
        vm.prank(alice);
        token.mint(alice, 1000 * 1e18);
        assertEq(token.totalSupply(), 1000 * 1e18);
    }

    function test_CreateTokenWithCustomDecimals() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken("USDC", "USDC", 6, 1000000 * 1e6);

        SimpleERC20 token = SimpleERC20(tokenAddr);
        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 1000000 * 1e6);
    }
}
