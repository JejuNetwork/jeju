// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {BanManager} from "../../src/moderation/BanManager.sol";
import {ModerationMarketplace} from "../../src/moderation/ModerationMarketplace.sol";
import {CommitRevealVoting} from "../../src/moderation/CommitRevealVoting.sol";
import {VoterSlashing} from "../../src/moderation/VoterSlashing.sol";
import {Token} from "../../src/tokens/Token.sol";

/**
 * @title ModerationIntegrationTest
 * @notice Integration tests for the complete moderation system
 */
contract ModerationIntegrationTest is Test {
    BanManager public banManager;
    ModerationMarketplace public marketplace;
    CommitRevealVoting public commitReveal;
    VoterSlashing public voterSlashing;
    Token public token;

    address public owner = address(1);
    address public treasury = address(2);
    address public reporter = address(3);
    address public target = address(4);
    address public voter1 = address(5);
    address public voter2 = address(6);
    address public voter3 = address(7);

    function setUp() public {
        vm.startPrank(owner);

        // Deploy BanManager
        banManager = new BanManager(owner, owner);

        // Deploy ModerationMarketplace
        marketplace = new ModerationMarketplace(
            address(banManager),
            address(0), // ETH staking
            treasury,
            owner
        );

        // Deploy CommitRevealVoting
        commitReveal = new CommitRevealVoting(
            address(marketplace),
            treasury,
            owner
        );

        // Deploy VoterSlashing
        voterSlashing = new VoterSlashing(
            address(marketplace),
            treasury,
            owner
        );

        // Deploy Token with ban enforcement
        token = new Token(
            "Jeju Token",
            "JEJU",
            1_000_000 ether,
            owner,
            0, // unlimited supply
            true // home chain
        );

        // Configure Token with BanManager
        token.setBanManager(address(banManager));
        token.setConfig(0, 0, true, false, true); // Enable ban enforcement

        // Set marketplace as authorized moderator on BanManager
        banManager.setModerator(address(marketplace), true);

        vm.stopPrank();

        // Fund accounts
        vm.deal(reporter, 100 ether);
        vm.deal(target, 100 ether);
        vm.deal(voter1, 100 ether);
        vm.deal(voter2, 100 ether);
        vm.deal(voter3, 100 ether);

        // Distribute tokens
        vm.startPrank(owner);
        token.transfer(reporter, 10000 ether);
        token.transfer(target, 10000 ether);
        token.transfer(voter1, 10000 ether);
        token.transfer(voter2, 10000 ether);
        token.transfer(voter3, 10000 ether);
        vm.stopPrank();
    }

    // ============ BAN MANAGER TESTS ============

    function test_BanManager_DirectBan() public {
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Test ban");

        assertTrue(banManager.isAddressBanned(target));
    }

    function test_BanManager_DirectUnban() public {
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Test ban");
        
        assertTrue(banManager.isAddressBanned(target));

        vm.prank(owner);
        banManager.removeAddressBan(target);

        assertFalse(banManager.isAddressBanned(target));
    }

    function test_BanManager_OnNotice() public {
        vm.prank(owner);
        banManager.placeOnNotice(target, reporter, bytes32(0), "Suspicious activity");

        assertTrue(banManager.isOnNotice(target));
        assertFalse(banManager.isPermanentlyBanned(target));
    }

    // ============ TOKEN BAN ENFORCEMENT TESTS ============

    function test_Token_BlocksTransfersFromBanned() public {
        // Ban target
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Banned user");

        // Try to transfer - should fail
        vm.prank(target);
        vm.expectRevert(abi.encodeWithSelector(Token.BannedUser.selector, target));
        token.transfer(voter1, 100 ether);
    }

    function test_Token_BlocksTransfersToBanned() public {
        // Ban voter1 as recipient
        vm.prank(owner);
        banManager.applyAddressBan(voter1, bytes32(0), "Banned recipient");

        // Try to transfer to banned - should fail
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(Token.BannedUser.selector, voter1));
        token.transfer(voter1, 100 ether);
    }

    function test_Token_AllowsTransfersWhenUnbanned() public {
        // Ban and unban
        vm.startPrank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Temp ban");
        banManager.removeAddressBan(target);
        vm.stopPrank();

        // Transfer should succeed
        vm.prank(target);
        token.transfer(voter1, 100 ether);

        assertEq(token.balanceOf(voter1), 10100 ether);
    }

    function test_Token_ExemptAddressCanReceiveFromBanned() public {
        // Make voter1 ban exempt (can receive from anyone, even banned)
        vm.prank(owner);
        token.setBanExempt(voter1, true);

        // Ban target
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Banned");

        // Transfer should SUCCEED because recipient is ban-exempt
        // This is intentional - ban-exempt addresses can receive from banned users
        // (e.g., treasury can confiscate funds from banned accounts)
        vm.prank(target);
        token.transfer(voter1, 100 ether);

        assertEq(token.balanceOf(voter1), 10100 ether);
        assertEq(token.balanceOf(target), 9900 ether);
    }

    // ============ MARKETPLACE STAKING TESTS ============

    function test_Marketplace_Stake() public {
        vm.prank(reporter);
        marketplace.stake{value: 1 ether}();

        (uint256 amount, , , , bool isStaked) = marketplace.stakes(reporter);
        assertEq(amount, 1 ether);
        assertTrue(isStaked);
    }

    function test_Marketplace_Unstake() public {
        // Stake first
        vm.prank(reporter);
        marketplace.stake{value: 1 ether}();

        // Wait for minimum stake period
        vm.warp(block.timestamp + 25 hours);

        // Unstake
        vm.prank(reporter);
        marketplace.unstake(0.5 ether);

        (uint256 amount, , , , bool isStaked) = marketplace.stakes(reporter);
        assertEq(amount, 0.5 ether);
        assertTrue(isStaked);
    }

    // ============ COMMIT-REVEAL VOTING TESTS ============

    function test_CommitReveal_CommitPhase() public {
        // Initialize voting
        bytes32 caseId = keccak256("test-case-1");
        vm.prank(address(marketplace));
        commitReveal.initializeVoting(caseId);

        // Generate commit hash
        bytes32 salt = keccak256("secret-salt");
        bytes32 commitHash = commitReveal.generateCommitHash(caseId, 0, salt, voter1);

        // Commit vote
        vm.prank(voter1);
        commitReveal.commitVote{value: 0.1 ether}(caseId, commitHash);

        (bool hasCommitted, bool hasRevealed, uint256 stakeAmount,) = 
            commitReveal.getCommitStatus(caseId, voter1);

        assertTrue(hasCommitted);
        assertFalse(hasRevealed);
        assertEq(stakeAmount, 0.1 ether);
    }

    function test_CommitReveal_RevealPhase() public {
        bytes32 caseId = keccak256("test-case-2");
        bytes32 salt = keccak256("secret-salt");
        uint8 position = 0; // YES vote

        // Initialize and commit
        vm.prank(address(marketplace));
        commitReveal.initializeVoting(caseId);

        bytes32 commitHash = commitReveal.generateCommitHash(caseId, position, salt, voter1);
        
        vm.prank(voter1);
        commitReveal.commitVote{value: 0.1 ether}(caseId, commitHash);

        // Advance to reveal phase
        vm.warp(block.timestamp + 3 days);

        // Reveal vote
        vm.prank(voter1);
        commitReveal.revealVote(caseId, position, salt);

        (, bool hasRevealed,,) = commitReveal.getCommitStatus(caseId, voter1);
        assertTrue(hasRevealed);
    }

    function test_CommitReveal_CannotRevealWithWrongSalt() public {
        bytes32 caseId = keccak256("test-case-3");
        bytes32 salt = keccak256("correct-salt");
        bytes32 wrongSalt = keccak256("wrong-salt");
        uint8 position = 0;

        vm.prank(address(marketplace));
        commitReveal.initializeVoting(caseId);

        bytes32 commitHash = commitReveal.generateCommitHash(caseId, position, salt, voter1);
        
        vm.prank(voter1);
        commitReveal.commitVote{value: 0.1 ether}(caseId, commitHash);

        vm.warp(block.timestamp + 3 days);

        vm.prank(voter1);
        vm.expectRevert(CommitRevealVoting.InvalidCommitHash.selector);
        commitReveal.revealVote(caseId, position, wrongSalt);
    }

    // ============ VOTER SLASHING TESTS ============

    function test_VoterSlashing_TrackWins() public {
        bytes32 caseId = keccak256("case-win");

        vm.prank(address(marketplace));
        voterSlashing.recordVoteOutcome(voter1, caseId, true, 1 ether);

        (uint256 totalVotes, uint256 winningVotes,,,,,, ) = 
            voterSlashing.getVoterRecord(voter1);

        assertEq(totalVotes, 1);
        assertEq(winningVotes, 1);
    }

    function test_VoterSlashing_TrackLosses() public {
        bytes32 caseId = keccak256("case-loss");

        vm.prank(address(marketplace));
        voterSlashing.recordVoteOutcome(voter1, caseId, false, 1 ether);

        (uint256 totalVotes, uint256 winningVotes, uint256 losingVotes, uint256 consecutiveLosses,,,,) = 
            voterSlashing.getVoterRecord(voter1);

        assertEq(totalVotes, 1);
        assertEq(winningVotes, 0);
        assertEq(losingVotes, 1);
        assertEq(consecutiveLosses, 1);
    }

    function test_VoterSlashing_SlashAfterConsecutiveLosses() public {
        // Record 4 consecutive losses (threshold for tier 1 slashing)
        for (uint i = 0; i < 4; i++) {
            bytes32 caseId = keccak256(abi.encodePacked("case-loss-", i));
            
            vm.prank(address(marketplace));
            uint256 slashAmount = voterSlashing.recordVoteOutcome(voter1, caseId, false, 1 ether);
            
            if (i == 3) {
                // 4th loss should trigger slashing (5% of 1 ether = 0.05 ether)
                assertEq(slashAmount, 0.05 ether);
            }
        }

        (,,,, uint256 penaltyTier,,,) = voterSlashing.getVoterRecord(voter1);
        assertEq(penaltyTier, 1);
    }

    function test_VoterSlashing_VotingBanAfterManyLosses() public {
        // Record 10 consecutive losses (threshold for ban)
        for (uint i = 0; i < 10; i++) {
            bytes32 caseId = keccak256(abi.encodePacked("case-loss-", i));
            
            vm.prank(address(marketplace));
            voterSlashing.recordVoteOutcome(voter1, caseId, false, 1 ether);
        }

        (bool canVote, string memory reason) = voterSlashing.canVote(voter1);
        assertFalse(canVote);
        assertEq(reason, "VOTING_BANNED");
    }

    function test_VoterSlashing_RecoveryAfterWins() public {
        // First lose 5 times to get to tier 1
        for (uint i = 0; i < 5; i++) {
            bytes32 caseId = keccak256(abi.encodePacked("loss-", i));
            vm.prank(address(marketplace));
            voterSlashing.recordVoteOutcome(voter1, caseId, false, 1 ether);
        }

        (,,,, uint256 penaltyTierBefore,,,) = voterSlashing.getVoterRecord(voter1);
        assertGt(penaltyTierBefore, 0);

        // Win 5 times to recover
        for (uint i = 0; i < 5; i++) {
            bytes32 caseId = keccak256(abi.encodePacked("win-", i));
            vm.prank(address(marketplace));
            voterSlashing.recordVoteOutcome(voter1, caseId, true, 1 ether);
        }

        (,,,, uint256 penaltyTierAfter,,,) = voterSlashing.getVoterRecord(voter1);
        assertLt(penaltyTierAfter, penaltyTierBefore);
    }

    // ============ END-TO-END FLOW TEST ============

    function test_E2E_ReportBanAndTokenBlock() public {
        // 1. Reporter stakes
        vm.prank(reporter);
        marketplace.stake{value: 1 ether}();

        // 2. Wait for stake age requirement
        vm.warp(block.timestamp + 25 hours);

        // 3. Ban the target through BanManager (simulating marketplace resolution)
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "Spam bot detected");

        // 4. Verify ban is active
        assertTrue(banManager.isAddressBanned(target));

        // 5. Verify token transfers are blocked
        vm.prank(target);
        vm.expectRevert(abi.encodeWithSelector(Token.BannedUser.selector, target));
        token.transfer(voter1, 1000 ether);

        // 6. Verify target's balance is unchanged
        assertEq(token.balanceOf(target), 10000 ether);
    }

    function test_E2E_AppealAndUnban() public {
        // 1. Initial ban
        vm.prank(owner);
        banManager.applyAddressBan(target, bytes32(0), "False positive");

        assertTrue(banManager.isAddressBanned(target));

        // 2. Admin review and unban
        vm.prank(owner);
        banManager.removeAddressBan(target);

        assertFalse(banManager.isAddressBanned(target));

        // 3. Verify token transfers work again
        vm.prank(target);
        token.transfer(voter1, 1000 ether);

        assertEq(token.balanceOf(voter1), 11000 ether);
        assertEq(token.balanceOf(target), 9000 ether);
    }
}

