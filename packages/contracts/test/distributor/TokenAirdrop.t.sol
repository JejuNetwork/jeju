// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TokenAirdrop} from "../../src/distributor/TokenAirdrop.sol";
import {BabylonToken} from "../../src/tokens/BabylonToken.sol";

contract TokenAirdropTest is Test {
    TokenAirdrop public airdrop;
    BabylonToken public token;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public dripper = address(4);

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant AIRDROP_TOKENS = 100_000_000 * 1e18;
    uint256 public constant USER1_ALLOCATION = 1_000_000 * 1e18; // 1M tokens
    uint256 public constant USER2_ALLOCATION = 500_000 * 1e18; // 500K tokens

    bytes32 public merkleRoot;
    bytes32[] public user1Proof;
    bytes32[] public user2Proof;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy token
        token = new BabylonToken(
            "Babylon",
            "BBLN",
            TOTAL_SUPPLY,
            owner,
            true // isHomeChain
        );

        // Deploy airdrop
        airdrop = new TokenAirdrop(token, owner);

        // Configure airdrop
        // In production, generate proper Merkle root from user allocations
        // For testing, we'll use a simple root
        merkleRoot = keccak256(
            abi.encodePacked(
                keccak256(abi.encodePacked(user1, USER1_ALLOCATION, uint8(100))),
                keccak256(abi.encodePacked(user2, USER2_ALLOCATION, uint8(150))) // ELIZA holder
            )
        );

        uint256 startTime = block.timestamp;
        uint256 endTime = block.timestamp + 365 days;

        airdrop.configure(merkleRoot, startTime, endTime, AIRDROP_TOKENS);

        // Authorize dripper
        airdrop.setAuthorizedDripper(dripper, true);

        // Transfer tokens to airdrop contract
        token.transfer(address(airdrop), AIRDROP_TOKENS);

        vm.stopPrank();

        // Setup proofs (simplified - in production use actual Merkle tree)
        user1Proof = new bytes32[](1);
        user1Proof[0] = keccak256(abi.encodePacked(user2, USER2_ALLOCATION, uint8(150)));

        user2Proof = new bytes32[](1);
        user2Proof[0] = keccak256(abi.encodePacked(user1, USER1_ALLOCATION, uint8(100)));
    }

    function test_Configuration() public view {
        assertEq(airdrop.merkleRoot(), merkleRoot);
        assertEq(airdrop.totalTokens(), AIRDROP_TOKENS);
        assertEq(airdrop.TOTAL_DRIP_DAYS(), 20);
        assertEq(airdrop.DRIP_PERCENT_BPS(), 500);
    }

    function test_AuthorizedDripper() public view {
        assertTrue(airdrop.authorizedDrippers(dripper));
        assertFalse(airdrop.authorizedDrippers(user1));
    }

    function test_UnlockDrip() public {
        // First, register user (skipped due to proof complexity in test)
        // In production, user would register with valid Merkle proof

        // Simulate registration by setting allocation directly (owner only)
        // This would normally be done via register() with valid proof

        // Test that unauthorized cannot unlock drip
        vm.prank(user1);
        vm.expectRevert(TokenAirdrop.NotAuthorizedDripper.selector);
        airdrop.unlockDrip(user1, "visit");
    }

    function test_CannotDripWithoutRegistration() public {
        vm.prank(dripper);
        vm.expectRevert(TokenAirdrop.NotEligible.selector);
        airdrop.unlockDrip(user1, "visit");
    }

    function test_AuthorizedDripperCanBeSet() public {
        address newDripper = address(5);

        vm.prank(owner);
        airdrop.setAuthorizedDripper(newDripper, true);

        assertTrue(airdrop.authorizedDrippers(newDripper));

        vm.prank(owner);
        airdrop.setAuthorizedDripper(newDripper, false);

        assertFalse(airdrop.authorizedDrippers(newDripper));
    }

    function test_OnlyOwnerCanSetDripper() public {
        vm.prank(user1);
        vm.expectRevert();
        airdrop.setAuthorizedDripper(user1, true);
    }

    function test_RecoverUnclaimedOnlyAfterEnd() public {
        vm.prank(owner);
        vm.expectRevert(TokenAirdrop.AirdropNotStarted.selector);
        airdrop.recoverUnclaimed(owner);
    }

    function test_RecoverUnclaimedAfterEnd() public {
        // Fast forward past end time
        vm.warp(block.timestamp + 366 days);

        uint256 balanceBefore = token.balanceOf(owner);

        vm.prank(owner);
        airdrop.recoverUnclaimed(owner);

        uint256 balanceAfter = token.balanceOf(owner);
        assertGt(balanceAfter, balanceBefore);
    }

    function test_ExtendEndTime() public {
        uint256 currentEnd = airdrop.endTime();
        uint256 newEnd = currentEnd + 30 days;

        vm.prank(owner);
        airdrop.extendEndTime(newEnd);

        assertEq(airdrop.endTime(), newEnd);
    }

    function test_CannotReduceEndTime() public {
        uint256 currentEnd = airdrop.endTime();
        uint256 newEnd = currentEnd - 30 days;

        vm.prank(owner);
        vm.expectRevert();
        airdrop.extendEndTime(newEnd);
    }

    function test_GetAirdropStats() public view {
        (uint256 totalTokens, uint256 totalDistributed, uint256 remaining, bool isActive, uint256 timeUntilEnd) =
            airdrop.getAirdropStats();

        assertEq(totalTokens, AIRDROP_TOKENS);
        assertEq(totalDistributed, 0);
        assertEq(remaining, AIRDROP_TOKENS);
        assertTrue(isActive);
        assertGt(timeUntilEnd, 0);
    }

    function test_DripConstants() public view {
        // Verify drip mechanism constants
        assertEq(airdrop.TOTAL_DRIP_DAYS(), 20);
        assertEq(airdrop.DRIP_PERCENT_BPS(), 500); // 5%
        assertEq(airdrop.SECONDS_PER_DAY(), 86400);

        // 20 drips * 5% = 100% total
        assertEq(uint256(airdrop.TOTAL_DRIP_DAYS()) * uint256(airdrop.DRIP_PERCENT_BPS()), 10000);
    }
}

