// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {BridgedBAT} from "../src/tokens/BridgedBAT.sol";

/**
 * @title BridgedBATTest
 * @notice Tests for BridgedBAT token contract
 */
contract BridgedBATTest is Test {
    BridgedBAT public bridgedBAT;

    address public owner = address(0x1);
    address public minter = address(0x2);
    address public user = address(0x3);

    function setUp() public {
        vm.prank(owner);
        bridgedBAT = new BridgedBAT(owner);
    }

    function test_Deploy() public view {
        assertEq(bridgedBAT.name(), "Bridged Basic Attention Token");
        assertEq(bridgedBAT.symbol(), "BAT");
        assertEq(bridgedBAT.decimals(), 18);
        assertEq(bridgedBAT.owner(), owner);
        assertEq(bridgedBAT.l1Token(), 0x0D8775F648430679A709E98d2b0Cb6250d2887EF);
    }

    function test_SetMinter() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);
        assertTrue(bridgedBAT.isMinter(minter));
    }

    function test_SetMinter_RevertNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        bridgedBAT.setMinter(minter, true);
    }

    function test_Mint() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        uint256 amount = 1000 * 1e18;
        vm.prank(minter);
        bridgedBAT.mint(user, amount);

        assertEq(bridgedBAT.balanceOf(user), amount);
        assertEq(bridgedBAT.totalSupply(), amount);
        assertEq(bridgedBAT.totalBridged(), amount);
    }

    function test_MintWithVoucher() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        uint256 amount = 500 * 1e18;
        bytes32 voucherId = keccak256("test-voucher");

        vm.prank(minter);
        bridgedBAT.mintWithVoucher(user, amount, voucherId);

        assertEq(bridgedBAT.balanceOf(user), amount);
    }

    function test_Mint_RevertUnauthorized() public {
        vm.prank(user);
        vm.expectRevert(BridgedBAT.NotAuthorizedMinter.selector);
        bridgedBAT.mint(user, 1000 * 1e18);
    }

    function test_Mint_RevertExceedsMaxSupply() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        uint256 maxSupply = bridgedBAT.MAX_SUPPLY();
        vm.prank(minter);
        bridgedBAT.mint(user, maxSupply - 1000);

        vm.prank(minter);
        vm.expectRevert(BridgedBAT.ExceedsMaxSupply.selector);
        bridgedBAT.mint(user, 2000);
    }

    function test_BridgeOut() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        uint256 amount = 1000 * 1e18;
        vm.prank(minter);
        bridgedBAT.mint(user, amount);

        address l1Recipient = address(0x999);
        uint256 bridgeAmount = 500 * 1e18;

        vm.prank(user);
        bridgedBAT.bridgeOut(bridgeAmount, l1Recipient);

        assertEq(bridgedBAT.balanceOf(user), amount - bridgeAmount);
        assertEq(bridgedBAT.totalBridgedBack(), bridgeAmount);
    }

    function test_Pause() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        vm.prank(owner);
        bridgedBAT.pause();

        vm.prank(minter);
        vm.expectRevert();
        bridgedBAT.mint(user, 1000 * 1e18);
    }

    function test_GetBridgeStats() public {
        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        uint256 mintAmount = 1000 * 1e18;
        vm.prank(minter);
        bridgedBAT.mint(user, mintAmount);

        uint256 bridgeOutAmount = 300 * 1e18;
        vm.prank(user);
        bridgedBAT.bridgeOut(bridgeOutAmount, address(0x999));

        (uint256 bridgedIn, uint256 bridgedOut, uint256 netBridged) = bridgedBAT.getBridgeStats();
        assertEq(bridgedIn, mintAmount);
        assertEq(bridgedOut, bridgeOutAmount);
        assertEq(netBridged, mintAmount - bridgeOutAmount);
    }

    function testFuzz_Mint(uint256 amount) public {
        amount = bound(amount, 1, bridgedBAT.MAX_SUPPLY());

        vm.prank(owner);
        bridgedBAT.setMinter(minter, true);

        vm.prank(minter);
        bridgedBAT.mint(user, amount);

        assertEq(bridgedBAT.balanceOf(user), amount);
    }
}
