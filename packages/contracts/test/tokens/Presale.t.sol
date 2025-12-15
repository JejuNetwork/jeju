// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Presale} from "../../src/tokens/Presale.sol";
import {Token} from "../../src/tokens/Token.sol";

contract PresaleTest is Test {
    Token public token;
    Presale public presale;

    address public owner = address(1);
    address public treasury = address(2);
    address public user1 = address(3);
    address public user2 = address(4);
    address public user3 = address(5);

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 * 10**18;
    uint256 public constant PRESALE_ALLOCATION = 100_000_000 * 10**18;
    uint256 public constant SOFT_CAP = 10 ether;
    uint256 public constant HARD_CAP = 100 ether;
    uint256 public constant MIN_CONTRIBUTION = 0.1 ether;
    uint256 public constant MAX_CONTRIBUTION = 10 ether;
    uint256 public constant TOKEN_PRICE = 0.001 ether; // 1000 tokens per ETH

    uint256 public whitelistStart;
    uint256 public publicStart;
    uint256 public presaleEnd;
    uint256 public tgeTimestamp;

    function setUp() public {
        vm.startPrank(owner);

        token = new Token("Test Token", "TEST", TOKEN_SUPPLY, owner, 0, true);
        presale = new Presale(address(token), treasury, owner);

        whitelistStart = block.timestamp + 1 days;
        publicStart = block.timestamp + 2 days;
        presaleEnd = block.timestamp + 10 days;
        tgeTimestamp = block.timestamp + 15 days;

        presale.configure(
            Presale.PresaleMode.FIXED_PRICE,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            TOKEN_PRICE,
            0, 0, 0, // CCA params
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );

        // 100% TGE unlock
        presale.setVesting(10000, 0, 0);

        // Transfer tokens to presale
        token.transfer(address(presale), PRESALE_ALLOCATION);

        vm.stopPrank();

        // Fund users
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(user3, 100 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              PHASE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_InitialPhase() public view {
        assertEq(uint256(presale.currentPhase()), uint256(Presale.Phase.NOT_STARTED));
    }

    function test_WhitelistPhase() public {
        vm.warp(whitelistStart);
        assertEq(uint256(presale.currentPhase()), uint256(Presale.Phase.WHITELIST));
    }

    function test_PublicPhase() public {
        vm.warp(publicStart);
        assertEq(uint256(presale.currentPhase()), uint256(Presale.Phase.PUBLIC));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              WHITELIST TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_WhitelistContribution() public {
        address[] memory whitelist = new address[](1);
        whitelist[0] = user1;

        vm.prank(owner);
        presale.setWhitelist(whitelist, true);

        vm.warp(whitelistStart);

        vm.prank(user1);
        presale.contribute{value: 1 ether}();

        (uint256 ethAmount,,,,,,, ) = presale.getContribution(user1);
        assertEq(ethAmount, 1 ether);
    }

    function test_NonWhitelistDuringWhitelistPhase() public {
        vm.warp(whitelistStart);

        vm.prank(user1);
        vm.expectRevert(Presale.NotWhitelisted.selector);
        presale.contribute{value: 1 ether}();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CONTRIBUTION TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_PublicContribution() public {
        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 1 ether}();

        (uint256 ethAmount, uint256 tokenAllocation,,,,,, ) = presale.getContribution(user1);
        assertEq(ethAmount, 1 ether);
        // 1 ETH / 0.001 ETH per token = 1000 tokens
        assertEq(tokenAllocation, 1000 * 10**18);
    }

    function test_BelowMinContribution() public {
        vm.warp(publicStart);

        vm.prank(user1);
        vm.expectRevert(Presale.BelowMin.selector);
        presale.contribute{value: 0.05 ether}();
    }

    function test_ExceedsMaxContribution() public {
        vm.warp(publicStart);

        vm.prank(user1);
        vm.expectRevert(Presale.ExceedsMax.selector);
        presale.contribute{value: 15 ether}();
    }

    function test_MultipleContributions() public {
        vm.warp(publicStart);

        vm.startPrank(user1);
        presale.contribute{value: 1 ether}();
        presale.contribute{value: 2 ether}();
        vm.stopPrank();

        (uint256 ethAmount, uint256 tokenAllocation,,,,,, ) = presale.getContribution(user1);
        assertEq(ethAmount, 3 ether);
        assertEq(tokenAllocation, 3000 * 10**18);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              BONUS TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_WhitelistBonus() public {
        vm.prank(owner);
        presale.setBonuses(1000, 0, 0, 0, 0, address(0), 0); // 10% whitelist bonus

        address[] memory whitelist = new address[](1);
        whitelist[0] = user1;
        vm.prank(owner);
        presale.setWhitelist(whitelist, true);

        vm.warp(whitelistStart);

        vm.prank(user1);
        presale.contribute{value: 1 ether}();

        (, uint256 tokenAllocation, uint256 bonusTokens,,,,, ) = presale.getContribution(user1);
        assertEq(tokenAllocation, 1000 * 10**18);
        assertEq(bonusTokens, 100 * 10**18); // 10% bonus
    }

    function test_VolumeBonus() public {
        vm.prank(owner);
        presale.setBonuses(0, 0, 100, 300, 500, address(0), 0);

        vm.warp(publicStart);

        // 5 ETH contribution should get 3% bonus
        vm.prank(user1);
        presale.contribute{value: 5 ether}();

        (, uint256 tokenAllocation, uint256 bonusTokens,,,,, ) = presale.getContribution(user1);
        assertEq(tokenAllocation, 5000 * 10**18);
        assertEq(bonusTokens, 150 * 10**18); // 3% of 5000
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CLAIMING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ClaimTokens() public {
        vm.warp(publicStart);

        // Multiple users contribute
        vm.prank(user1);
        presale.contribute{value: 5 ether}();

        vm.prank(user2);
        presale.contribute{value: 5 ether}();

        // Total raised = 10 ETH >= soft cap
        assertEq(presale.totalRaised(), 10 ether);

        // Fast forward to TGE
        vm.warp(tgeTimestamp);

        // User claims
        vm.prank(user1);
        presale.claim();

        assertEq(token.balanceOf(user1), 5000 * 10**18);
    }

    function test_ClaimBeforeTGE() public {
        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 1 ether}();

        vm.warp(presaleEnd);

        vm.prank(user1);
        vm.expectRevert(Presale.TGENotReached.selector);
        presale.claim();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              VESTING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_VestingSchedule() public {
        vm.prank(owner);
        presale.setVesting(2000, 30 days, 90 days); // 20% TGE, 30 day cliff, 90 day vest

        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 5 ether}();

        vm.prank(user2);
        presale.contribute{value: 5 ether}();

        // At TGE
        vm.warp(tgeTimestamp);
        uint256 claimable = presale.getClaimableAmount(user1);
        assertEq(claimable, 1000 * 10**18); // 20% of 5000

        vm.prank(user1);
        presale.claim();
        assertEq(token.balanceOf(user1), 1000 * 10**18);

        // During cliff - still only TGE amount
        vm.warp(tgeTimestamp + 15 days);
        claimable = presale.getClaimableAmount(user1);
        assertEq(claimable, 0); // Already claimed TGE

        // After cliff, halfway through vest
        vm.warp(tgeTimestamp + 30 days + 45 days);
        claimable = presale.getClaimableAmount(user1);
        // 50% of remaining 4000 = 2000
        assertEq(claimable, 2000 * 10**18);

        // After full vest
        vm.warp(tgeTimestamp + 30 days + 90 days);
        claimable = presale.getClaimableAmount(user1);
        assertEq(claimable, 4000 * 10**18); // Remaining 80%
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              REFUND TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_RefundOnFailure() public {
        vm.warp(publicStart);

        // Only 5 ETH raised, soft cap is 10 ETH
        vm.prank(user1);
        presale.contribute{value: 5 ether}();

        vm.warp(presaleEnd + 1);

        assertEq(uint256(presale.currentPhase()), uint256(Presale.Phase.FAILED));

        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        presale.claimRefund();

        assertEq(user1.balance, balanceBefore + 5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              FINALIZE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Finalize() public {
        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 10 ether}();

        vm.warp(presaleEnd + 1);

        uint256 treasuryBefore = treasury.balance;

        vm.prank(owner);
        presale.finalize();

        assertEq(treasury.balance, treasuryBefore + 10 ether);
    }

    function test_WithdrawUnsold() public {
        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 1 ether}(); // Only 1000 tokens sold

        vm.prank(user2);
        presale.contribute{value: 9 ether}();

        vm.warp(tgeTimestamp);

        uint256 tokensSold = presale.totalTokensSold();
        uint256 unsold = PRESALE_ALLOCATION - tokensSold;

        vm.prank(owner);
        presale.withdrawUnsoldTokens();

        assertEq(token.balanceOf(treasury), unsold);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CCA AUCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_CCAConfiguration() public {
        Presale ccaPresale = new Presale(address(token), treasury, owner);

        vm.prank(owner);
        ccaPresale.configure(
            Presale.PresaleMode.CCA_AUCTION,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            0, // token price (unused)
            0.01 ether, // start price
            0.001 ether, // reserve price
            1e10, // decay per block
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );

        assertEq(ccaPresale.getCurrentPrice(), 0.01 ether);
    }

    function test_CCAPriceDecay() public {
        Presale ccaPresale = new Presale(address(token), treasury, owner);

        vm.prank(owner);
        ccaPresale.configure(
            Presale.PresaleMode.CCA_AUCTION,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            0,
            0.01 ether,
            0.001 ether,
            1e12, // decay per second (for testing)
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );

        // Price at start
        vm.warp(whitelistStart);
        uint256 startPrice = ccaPresale.getCurrentPrice();
        assertEq(startPrice, 0.01 ether);

        // Price should decay
        vm.warp(whitelistStart + 1000);
        uint256 laterPrice = ccaPresale.getCurrentPrice();
        assertTrue(laterPrice < startPrice);

        // Price should floor at reserve
        vm.warp(presaleEnd);
        uint256 endPrice = ccaPresale.getCurrentPrice();
        assertEq(endPrice, 0.001 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              CCA INTEGRATION TEST
    // ═══════════════════════════════════════════════════════════════════════════

    function test_CCAFullFlow() public {
        // Setup CCA auction
        Token ccaToken = new Token("CCA Token", "CCA", TOKEN_SUPPLY, owner, 0, true);
        Presale ccaPresale = new Presale(address(ccaToken), treasury, owner);

        vm.startPrank(owner);
        ccaPresale.configure(
            Presale.PresaleMode.CCA_AUCTION,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            0,
            0.01 ether, // start price
            0.001 ether, // reserve price
            1e12, // decay
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );
        ccaPresale.setVesting(10000, 0, 0); // 100% TGE
        ccaToken.transfer(address(ccaPresale), PRESALE_ALLOCATION);
        vm.stopPrank();

        // === Phase 1: Contributions ===
        vm.warp(publicStart);

        // User1 contributes 5 ETH
        vm.prank(user1);
        ccaPresale.contribute{value: 5 ether}();

        // User2 contributes 5 ETH (soft cap reached)
        vm.prank(user2);
        ccaPresale.contribute{value: 5 ether}();

        assertEq(ccaPresale.totalRaised(), 10 ether);

        // === Phase 2: Presale ends, set clearing price ===
        vm.warp(presaleEnd + 1);
        assertEq(uint256(ccaPresale.currentPhase()), uint256(Presale.Phase.CLEARING));

        address[] memory contributors = new address[](2);
        contributors[0] = user1;
        contributors[1] = user2;

        // Set clearing price at 0.002 ETH per token
        uint256 clearingPrice = 0.002 ether;
        vm.prank(owner);
        ccaPresale.setClearingPrice(clearingPrice, contributors);

        // Verify allocations calculated correctly
        (uint256 eth1, uint256 alloc1,,,,,, ) = ccaPresale.getContribution(user1);
        (uint256 eth2, uint256 alloc2,,,,,, ) = ccaPresale.getContribution(user2);

        assertEq(eth1, 5 ether);
        assertEq(eth2, 5 ether);
        // 5 ETH / 0.002 ETH per token = 2500 tokens
        assertEq(alloc1, 2500 * 10**18);
        assertEq(alloc2, 2500 * 10**18);

        // === Phase 3: TGE - Claim tokens ===
        vm.warp(tgeTimestamp);

        uint256 claimable1 = ccaPresale.getClaimableAmount(user1);
        assertEq(claimable1, 2500 * 10**18);

        vm.prank(user1);
        ccaPresale.claim();

        assertEq(ccaToken.balanceOf(user1), 2500 * 10**18);

        vm.prank(user2);
        ccaPresale.claim();

        assertEq(ccaToken.balanceOf(user2), 2500 * 10**18);

        // === Phase 4: Finalize ===
        uint256 treasuryBefore = treasury.balance;
        vm.prank(owner);
        ccaPresale.finalize();

        assertEq(treasury.balance, treasuryBefore + 10 ether);
    }

    function test_CCAWithMaxPrice() public {
        // Setup CCA auction
        Token ccaToken = new Token("CCA2 Token", "CCA2", TOKEN_SUPPLY, owner, 0, true);
        Presale ccaPresale = new Presale(address(ccaToken), treasury, owner);

        vm.startPrank(owner);
        ccaPresale.configure(
            Presale.PresaleMode.CCA_AUCTION,
            PRESALE_ALLOCATION,
            SOFT_CAP,
            HARD_CAP,
            MIN_CONTRIBUTION,
            MAX_CONTRIBUTION,
            0,
            0.01 ether,
            0.001 ether,
            1e12,
            whitelistStart,
            publicStart,
            presaleEnd,
            tgeTimestamp
        );
        ccaPresale.setVesting(10000, 0, 0);
        ccaToken.transfer(address(ccaPresale), PRESALE_ALLOCATION);
        vm.stopPrank();

        vm.warp(publicStart);

        // User1 bids without max price
        vm.prank(user1);
        ccaPresale.contribute{value: 5 ether}();

        // User2 bids with max price of 0.0015 ETH
        vm.prank(user2);
        ccaPresale.contributeWithMaxPrice{value: 5 ether}(0.0015 ether);

        // User3 bids normally
        vm.prank(user3);
        ccaPresale.contribute{value: 5 ether}();

        vm.warp(presaleEnd + 1);

        address[] memory contributors = new address[](3);
        contributors[0] = user1;
        contributors[1] = user2;
        contributors[2] = user3;

        // Set clearing at 0.002 ETH (above user2's max)
        vm.prank(owner);
        ccaPresale.setClearingPrice(0.002 ether, contributors);

        // User1 and user3 get allocation
        (, uint256 alloc1,,,,,, ) = ccaPresale.getContribution(user1);
        (, uint256 alloc3,,,,,, ) = ccaPresale.getContribution(user3);
        assertEq(alloc1, 2500 * 10**18);
        assertEq(alloc3, 2500 * 10**18);

        // User2 gets refund instead
        (,, , , , uint256 refund2, , ) = ccaPresale.getContribution(user2);
        assertEq(refund2, 5 ether);

        // User2 claims refund
        uint256 balBefore = user2.balance;
        vm.prank(user2);
        ccaPresale.claimRefund();
        assertEq(user2.balance, balBefore + 5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              VIEW TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_GetPresaleStats() public {
        vm.warp(publicStart);

        vm.prank(user1);
        presale.contribute{value: 5 ether}();

        (
            uint256 raised,
            uint256 participants,
            uint256 tokensSold,
            uint256 softCap_,
            uint256 hardCap_,
            uint256 price,
            Presale.Phase phase
        ) = presale.getPresaleStats();

        assertEq(raised, 5 ether);
        assertEq(participants, 1);
        assertEq(tokensSold, 5000 * 10**18);
        assertEq(softCap_, SOFT_CAP);
        assertEq(hardCap_, HARD_CAP);
        assertEq(price, TOKEN_PRICE);
        assertEq(uint256(phase), uint256(Presale.Phase.PUBLIC));
    }

    function test_PreviewAllocation() public view {
        uint256 preview = presale.previewAllocation(1 ether, false, false);
        assertEq(preview, 1000 * 10**18);
    }
}
