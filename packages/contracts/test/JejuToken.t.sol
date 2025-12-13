// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {JejuToken} from "../src/tokens/JejuToken.sol";
import {BanManager} from "../src/moderation/BanManager.sol";

/**
 * @title JejuTokenTest
 * @notice Comprehensive tests for JejuToken contract
 */
contract JejuTokenTest is Test {
    JejuToken public jeju;
    BanManager public banManager;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public carol = address(0x4);
    address public governance = address(0x5);

    function setUp() public {
        vm.startPrank(owner);

        // Deploy BanManager with owner as governance
        banManager = new BanManager(governance, owner);

        // Deploy JejuToken with BanManager and faucet enabled
        jeju = new JejuToken(owner, address(banManager), true);

        vm.stopPrank();
    }

    // ============ Basic Token Tests ============

    function test_InitialState() public view {
        assertEq(jeju.name(), "Jeju");
        assertEq(jeju.symbol(), "JEJU");
        assertEq(jeju.decimals(), 18);
        assertEq(jeju.totalSupply(), jeju.INITIAL_SUPPLY());
        assertEq(jeju.balanceOf(owner), jeju.INITIAL_SUPPLY());
        assertTrue(jeju.faucetEnabled());
        assertTrue(jeju.banEnforcementEnabled());
        assertEq(address(jeju.banManager()), address(banManager));
    }

    function test_Transfer() public {
        uint256 amount = 1000 * 1e18;

        vm.prank(owner);
        jeju.transfer(alice, amount);

        assertEq(jeju.balanceOf(alice), amount);
    }

    function test_TransferFrom() public {
        uint256 amount = 1000 * 1e18;

        vm.prank(owner);
        jeju.approve(alice, amount);

        vm.prank(alice);
        jeju.transferFrom(owner, bob, amount);

        assertEq(jeju.balanceOf(bob), amount);
    }

    // ============ Minting Tests ============

    function test_Mint() public {
        uint256 mintAmount = 1000 * 1e18;
        uint256 balanceBefore = jeju.balanceOf(alice);

        vm.prank(owner);
        jeju.mint(alice, mintAmount);

        assertEq(jeju.balanceOf(alice), balanceBefore + mintAmount);
    }

    function test_Mint_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        jeju.mint(alice, 1000 * 1e18);
    }

    function test_Mint_MaxSupply() public {
        uint256 remaining = jeju.MAX_SUPPLY() - jeju.totalSupply();

        // Should succeed at max
        vm.prank(owner);
        jeju.mint(alice, remaining);

        assertEq(jeju.totalSupply(), jeju.MAX_SUPPLY());

        // Should fail beyond max
        vm.prank(owner);
        vm.expectRevert(JejuToken.MaxSupplyExceeded.selector);
        jeju.mint(alice, 1);
    }

    // ============ Ban Enforcement Tests ============

    function test_BannedSenderCannotTransfer() public {
        uint256 amount = 1000 * 1e18;

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Alice should not be able to transfer
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, alice));
        jeju.transfer(bob, amount);
    }

    function test_BannedReceiverCannotReceive() public {
        uint256 amount = 1000 * 1e18;

        // Ban bob before receiving
        vm.prank(governance);
        banManager.applyAddressBan(bob, keccak256("test"), "Test ban");

        // Owner should not be able to send to banned bob
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, bob));
        jeju.transfer(bob, amount);
    }

    function test_UnbannedUserCanTransfer() public {
        uint256 amount = 1000 * 1e18;

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Verify banned
        assertTrue(jeju.isBanned(alice));

        // Unban alice
        vm.prank(governance);
        banManager.removeAddressBan(alice);

        // Alice should be able to transfer now
        assertFalse(jeju.isBanned(alice));

        vm.prank(alice);
        jeju.transfer(bob, amount / 2);

        assertEq(jeju.balanceOf(bob), amount / 2);
    }

    function test_DisableBanEnforcement() public {
        uint256 amount = 1000 * 1e18;

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Disable ban enforcement
        vm.prank(owner);
        jeju.setBanEnforcement(false);

        // Alice should be able to transfer now (enforcement disabled)
        vm.prank(alice);
        jeju.transfer(bob, amount);

        assertEq(jeju.balanceOf(bob), amount);
    }

    function test_MintToBannedUser() public {
        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Should not be able to mint to banned user
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, alice));
        jeju.mint(alice, 1000 * 1e18);
    }

    // ============ Faucet Tests ============

    function test_Faucet() public {
        // Warp to a time after the initial cooldown window
        vm.warp(jeju.FAUCET_COOLDOWN() + 1);

        vm.prank(alice);
        jeju.faucet();

        assertEq(jeju.balanceOf(alice), jeju.FAUCET_AMOUNT());
    }

    function test_FaucetCooldown() public {
        // Warp to a time after the initial cooldown window
        vm.warp(jeju.FAUCET_COOLDOWN() + 1);

        vm.prank(alice);
        jeju.faucet();

        // Try again immediately - should fail
        vm.prank(alice);
        vm.expectRevert();
        jeju.faucet();

        // Advance time past cooldown
        vm.warp(block.timestamp + jeju.FAUCET_COOLDOWN() + 1);

        // Should work now
        vm.prank(alice);
        jeju.faucet();

        assertEq(jeju.balanceOf(alice), jeju.FAUCET_AMOUNT() * 2);
    }

    function test_FaucetTo() public {
        // Warp to a time after the initial cooldown window
        vm.warp(jeju.FAUCET_COOLDOWN() + 1);

        vm.prank(bob);
        jeju.faucetTo(alice);

        assertEq(jeju.balanceOf(alice), jeju.FAUCET_AMOUNT());
    }

    function test_FaucetDisabled() public {
        vm.prank(owner);
        jeju.setFaucetEnabled(false);

        vm.prank(alice);
        vm.expectRevert(JejuToken.FaucetDisabled.selector);
        jeju.faucet();
    }

    function test_FaucetCooldownRemaining() public {
        // Warp to a time after the initial cooldown window
        vm.warp(jeju.FAUCET_COOLDOWN() + 1);

        // Initially zero (because we're past the cooldown window)
        assertEq(jeju.faucetCooldownRemaining(alice), 0);

        vm.prank(alice);
        jeju.faucet();

        // Should be ~1 hour
        uint256 remaining = jeju.faucetCooldownRemaining(alice);
        assertGt(remaining, 0);
        assertLe(remaining, jeju.FAUCET_COOLDOWN());
    }

    // ============ Admin Tests ============

    function test_SetBanManager() public {
        BanManager newManager = new BanManager(governance, owner);

        vm.prank(owner);
        jeju.setBanManager(address(newManager));

        assertEq(address(jeju.banManager()), address(newManager));
    }

    function test_SetBanManager_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        jeju.setBanManager(address(0x123));
    }

    function test_Version() public view {
        assertEq(jeju.version(), "1.1.0");
    }

    // ============ Ban Exemption Tests ============

    function test_BannedUserCanTransferToExemptAddress() public {
        address moderationMarketplace = address(0x999);
        uint256 amount = 1000 * 1e18;

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Set moderation marketplace as exempt
        vm.prank(owner);
        jeju.setBanExempt(moderationMarketplace, true);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Alice should be able to transfer TO the exempt address (for staking/appeals)
        vm.prank(alice);
        jeju.transfer(moderationMarketplace, amount);

        assertEq(jeju.balanceOf(moderationMarketplace), amount);
    }

    function test_BannedUserCannotTransferToNonExemptAddress() public {
        uint256 amount = 1000 * 1e18;

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Alice should NOT be able to transfer to non-exempt bob
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, alice));
        jeju.transfer(bob, amount);
    }

    function test_SetBanExempt() public {
        address moderationMarketplace = address(0x999);

        // Initially not exempt
        assertFalse(jeju.banExempt(moderationMarketplace));

        // Set exempt
        vm.prank(owner);
        jeju.setBanExempt(moderationMarketplace, true);
        assertTrue(jeju.banExempt(moderationMarketplace));

        // Remove exemption
        vm.prank(owner);
        jeju.setBanExempt(moderationMarketplace, false);
        assertFalse(jeju.banExempt(moderationMarketplace));
    }

    function test_SetBanExempt_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        jeju.setBanExempt(address(0x999), true);
    }

    // ============ Edge Cases ============

    function test_NoBanManagerSet() public {
        // Deploy without ban manager
        JejuToken jejuNoBan = new JejuToken(owner, address(0), true);

        // Should not be banned (no manager)
        assertFalse(jejuNoBan.isBanned(alice));

        // Transfers should work
        vm.prank(owner);
        jejuNoBan.transfer(alice, 1000 * 1e18);

        assertEq(jejuNoBan.balanceOf(alice), 1000 * 1e18);
    }

    function testFuzz_Transfer(uint256 amount) public {
        amount = bound(amount, 1, jeju.balanceOf(owner));

        vm.prank(owner);
        jeju.transfer(alice, amount);

        assertEq(jeju.balanceOf(alice), amount);
    }

    function testFuzz_BanDoesNotAffectBalance(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 * 1e18);

        // Fund alice
        vm.prank(owner);
        jeju.transfer(alice, amount);

        // Ban alice
        vm.prank(governance);
        banManager.applyAddressBan(alice, keccak256("test"), "Test ban");

        // Balance should remain unchanged
        assertEq(jeju.balanceOf(alice), amount);
    }
}

/**
 * @title JejuTokenIntegrationTest
 * @notice Integration tests with multiple contracts
 */
contract JejuTokenIntegrationTest is Test {
    JejuToken public jeju;
    BanManager public banManager;

    address public owner = address(0x1);
    address public governance = address(0x5);

    function setUp() public {
        vm.startPrank(owner);
        banManager = new BanManager(governance, owner);
        jeju = new JejuToken(owner, address(banManager), true);
        vm.stopPrank();
    }

    function test_MultipleUsersInteraction() public {
        address[] memory users = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            users[i] = address(uint160(100 + i));
        }

        // Fund all users
        uint256 amount = 10_000 * 1e18;
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(owner);
            jeju.transfer(users[i], amount);
        }

        // Ban user 2
        vm.prank(governance);
        banManager.applyAddressBan(users[2], keccak256("test"), "Banned");

        // User 0 can transfer to user 1
        vm.prank(users[0]);
        jeju.transfer(users[1], 1000 * 1e18);

        // User 1 cannot transfer to banned user 2
        vm.prank(users[1]);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, users[2]));
        jeju.transfer(users[2], 1000 * 1e18);

        // Banned user 2 cannot transfer to user 3
        vm.prank(users[2]);
        vm.expectRevert(abi.encodeWithSelector(JejuToken.BannedUser.selector, users[2]));
        jeju.transfer(users[3], 1000 * 1e18);

        // User 3 can transfer to user 4
        vm.prank(users[3]);
        jeju.transfer(users[4], 1000 * 1e18);
    }
}
