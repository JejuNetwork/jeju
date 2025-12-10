// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {JejuPresale} from "../src/tokens/JejuPresale.sol";
import {JejuToken} from "../src/tokens/JejuToken.sol";

contract JejuPresaleTest is Test {
    JejuPresale public presale;
    JejuToken public token;
    
    address public owner = address(1);
    address public treasury = address(2);
    address public alice = address(3);
    address public bob = address(4);
    address public charlie = address(5);
    
    uint256 public constant SOFT_CAP = 100 ether;
    uint256 public constant HARD_CAP = 1000 ether;
    uint256 public constant MIN_CONTRIBUTION = 0.01 ether;
    uint256 public constant MAX_CONTRIBUTION = 50 ether;
    uint256 public constant TOKEN_PRICE = 0.00005 ether; // $0.15 at $3k ETH
    
    uint256 public whitelistStart;
    uint256 public publicStart;
    uint256 public presaleEnd;
    uint256 public tgeTimestamp;
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy token
        token = new JejuToken(owner, address(0), false);
        
        // Deploy presale
        presale = new JejuPresale(address(token), treasury, owner);
        
        // Configure timing
        whitelistStart = block.timestamp + 1 hours;
        publicStart = block.timestamp + 8 days;
        presaleEnd = block.timestamp + 22 days;
        tgeTimestamp = block.timestamp + 29 days;
        
        presale.configure(
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            TOKEN_PRICE,
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );
        
        // Configure vesting: 20% TGE, no cliff, 180 days linear
        presale.setVesting(2000, 0, 180 days);
        
        // Transfer tokens to presale contract
        token.transfer(address(presale), 1_000_000_000 ether);
        
        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        
        vm.stopPrank();
    }
    
    function test_InitialState() public view {
        assertEq(address(presale.jejuToken()), address(token));
        assertEq(presale.treasury(), treasury);
        assertEq(presale.totalRaised(), 0);
        assertEq(presale.totalParticipants(), 0);
    }
    
    function test_PhaseTransitions() public {
        assertEq(uint(presale.currentPhase()), uint(JejuPresale.PresalePhase.NOT_STARTED));
        
        vm.warp(whitelistStart);
        assertEq(uint(presale.currentPhase()), uint(JejuPresale.PresalePhase.WHITELIST));
        
        vm.warp(publicStart);
        assertEq(uint(presale.currentPhase()), uint(JejuPresale.PresalePhase.PUBLIC));
        
        vm.warp(presaleEnd);
        assertEq(uint(presale.currentPhase()), uint(JejuPresale.PresalePhase.FAILED)); // No contributions yet
    }
    
    function test_WhitelistContribution() public {
        // Add alice to whitelist
        address[] memory accounts = new address[](1);
        accounts[0] = alice;
        vm.prank(owner);
        presale.setWhitelist(accounts, true);
        
        // Warp to whitelist phase
        vm.warp(whitelistStart);
        
        // Alice contributes
        vm.prank(alice);
        presale.contribute{value: 1 ether}();
        
        assertEq(presale.totalRaised(), 1 ether);
        assertEq(presale.totalParticipants(), 1);
        
        // Check contribution details
        (uint256 ethAmount, uint256 tokenAllocation, uint256 bonusTokens, , , ) = presale.getContribution(alice);
        assertEq(ethAmount, 1 ether);
        
        uint256 expectedTokens = (1 ether * 1e18) / TOKEN_PRICE;
        assertEq(tokenAllocation, expectedTokens);
        
        // 10% whitelist bonus
        uint256 expectedBonus = (expectedTokens * 1000) / 10000;
        assertEq(bonusTokens, expectedBonus);
    }
    
    function test_PublicContribution() public {
        // Warp to public phase
        vm.warp(publicStart);
        
        // Bob contributes 10 ETH (should get 5% volume bonus)
        vm.prank(bob);
        presale.contribute{value: 10 ether}();
        
        (uint256 ethAmount, uint256 tokenAllocation, uint256 bonusTokens, , , ) = presale.getContribution(bob);
        assertEq(ethAmount, 10 ether);
        
        uint256 expectedTokens = (10 ether * 1e18) / TOKEN_PRICE;
        assertEq(tokenAllocation, expectedTokens);
        
        // 5% volume bonus for 10+ ETH
        uint256 expectedBonus = (expectedTokens * 500) / 10000;
        assertEq(bonusTokens, expectedBonus);
    }
    
    function test_RevertNotWhitelisted() public {
        vm.warp(whitelistStart);
        
        vm.prank(alice);
        vm.expectRevert(JejuPresale.NotWhitelisted.selector);
        presale.contribute{value: 1 ether}();
    }
    
    function test_RevertBelowMinContribution() public {
        vm.warp(publicStart);
        
        vm.prank(alice);
        vm.expectRevert(JejuPresale.BelowMinContribution.selector);
        presale.contribute{value: 0.001 ether}();
    }
    
    function test_RevertExceedsMaxContribution() public {
        vm.warp(publicStart);
        
        vm.prank(alice);
        vm.expectRevert(JejuPresale.ExceedsMaxContribution.selector);
        presale.contribute{value: 51 ether}();
    }
    
    function test_MultipleContributions() public {
        vm.warp(publicStart);
        
        vm.startPrank(alice);
        presale.contribute{value: 1 ether}();
        presale.contribute{value: 2 ether}();
        vm.stopPrank();
        
        (uint256 ethAmount, , , , , ) = presale.getContribution(alice);
        assertEq(ethAmount, 3 ether);
        assertEq(presale.totalParticipants(), 1); // Still one participant
    }
    
    function test_ClaimAfterTGE() public {
        // Setup: successful presale
        vm.warp(publicStart);
        
        // Multiple contributors to reach soft cap
        vm.prank(alice);
        presale.contribute{value: 50 ether}();
        vm.prank(bob);
        presale.contribute{value: 50 ether}();
        
        assertGe(presale.totalRaised(), SOFT_CAP);
        
        // Warp to TGE
        vm.warp(tgeTimestamp);
        
        // Alice claims
        uint256 aliceBalanceBefore = token.balanceOf(alice);
        vm.prank(alice);
        presale.claim();
        uint256 aliceBalanceAfter = token.balanceOf(alice);
        
        // Should have received 20% TGE unlock
        (uint256 ethAmount, uint256 tokenAllocation, uint256 bonusTokens, uint256 claimed, , ) = presale.getContribution(alice);
        uint256 totalAllocation = tokenAllocation + bonusTokens;
        uint256 expectedTGE = (totalAllocation * 2000) / 10000; // 20%
        
        assertEq(claimed, expectedTGE);
        assertEq(aliceBalanceAfter - aliceBalanceBefore, expectedTGE);
    }
    
    function test_VestingSchedule() public {
        // Setup: successful presale
        vm.warp(publicStart);
        vm.prank(alice);
        presale.contribute{value: 50 ether}();
        vm.prank(bob);
        presale.contribute{value: 50 ether}();
        
        // Get alice's allocation
        (, uint256 tokenAllocation, uint256 bonusTokens, , , ) = presale.getContribution(alice);
        uint256 totalAllocation = tokenAllocation + bonusTokens;
        
        // At TGE: 20% available
        vm.warp(tgeTimestamp);
        uint256 claimableAtTGE = presale.getClaimableAmount(alice);
        uint256 expectedTGE = (totalAllocation * 2000) / 10000;
        assertEq(claimableAtTGE, expectedTGE);
        
        // At 90 days: 20% TGE + 50% of remaining (since 180 day vesting)
        vm.warp(tgeTimestamp + 90 days);
        uint256 claimableAt90Days = presale.getClaimableAmount(alice);
        uint256 vestingAmount = totalAllocation - expectedTGE;
        uint256 expectedAt90Days = expectedTGE + (vestingAmount * 90 days) / 180 days;
        assertEq(claimableAt90Days, expectedAt90Days);
        
        // At 180 days: 100% available
        vm.warp(tgeTimestamp + 180 days);
        uint256 claimableAt180Days = presale.getClaimableAmount(alice);
        assertEq(claimableAt180Days, totalAllocation);
    }
    
    function test_RefundOnFailure() public {
        // Small contribution that doesn't reach soft cap
        vm.warp(publicStart);
        vm.prank(alice);
        presale.contribute{value: 1 ether}();
        
        // Warp past presale end (failed because soft cap not reached)
        vm.warp(presaleEnd + 1);
        assertEq(uint(presale.currentPhase()), uint(JejuPresale.PresalePhase.FAILED));
        
        // Alice requests refund
        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        presale.refund();
        uint256 aliceBalanceAfter = alice.balance;
        
        assertEq(aliceBalanceAfter - aliceBalanceBefore, 1 ether);
        
        // Check refund status
        (, , , , , bool refunded) = presale.getContribution(alice);
        assertTrue(refunded);
    }
    
    function test_Finalize() public {
        // Successful presale
        vm.warp(publicStart);
        vm.prank(alice);
        presale.contribute{value: 50 ether}();
        vm.prank(bob);
        presale.contribute{value: 50 ether}();
        
        // Warp past presale end
        vm.warp(presaleEnd + 1);
        
        // Finalize
        uint256 treasuryBalanceBefore = treasury.balance;
        vm.prank(owner);
        presale.finalize();
        uint256 treasuryBalanceAfter = treasury.balance;
        
        assertEq(treasuryBalanceAfter - treasuryBalanceBefore, 100 ether);
    }
    
    function test_RevertFinalizeBeforeEnd() public {
        vm.warp(publicStart);
        vm.prank(alice);
        presale.contribute{value: 50 ether}();
        vm.prank(bob);
        presale.contribute{value: 50 ether}();
        
        vm.prank(owner);
        vm.expectRevert(JejuPresale.PresaleNotEnded.selector);
        presale.finalize();
    }
    
    function test_Pause() public {
        vm.warp(publicStart);
        
        vm.prank(owner);
        presale.pause();
        
        vm.prank(alice);
        vm.expectRevert();
        presale.contribute{value: 1 ether}();
    }
    
    function test_GetPresaleStats() public {
        vm.warp(publicStart);
        vm.prank(alice);
        presale.contribute{value: 10 ether}();
        vm.prank(bob);
        presale.contribute{value: 20 ether}();
        
        (uint256 raised, uint256 participants, uint256 tokensSold, uint256 softCap, uint256 hardCap, JejuPresale.PresalePhase phase) = presale.getPresaleStats();
        
        assertEq(raised, 30 ether);
        assertEq(participants, 2);
        assertGt(tokensSold, 0);
        assertEq(softCap, SOFT_CAP);
        assertEq(hardCap, HARD_CAP);
        assertEq(uint(phase), uint(JejuPresale.PresalePhase.PUBLIC));
    }
}
