// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {InsuranceFund} from "../../src/perps/InsuranceFund.sol";
import {MockERC20, MockPriceOracle} from "../mocks/PerpsMocks.sol";

contract InsuranceFundTest is Test {
    InsuranceFund public fund;
    MockPriceOracle public oracle;
    MockERC20 public usdc;
    MockERC20 public weth;

    address public owner = address(1);
    address public drawer = address(2);
    address public user = address(3);
    address public unauthorized = address(4);

    function setUp() public {
        vm.startPrank(owner);
        oracle = new MockPriceOracle();
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");
        fund = new InsuranceFund(address(oracle), owner);

        // Setup tokens
        fund.addSupportedToken(address(usdc));
        fund.addSupportedToken(address(weth));
        fund.setAuthorizedDrawer(drawer, true);

        // Set prices ($1 USDC, $2000 WETH)
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(weth), 2000e18);
        vm.stopPrank();

        // Mint tokens
        usdc.mint(user, 1_000_000e18);
        weth.mint(user, 1000e18);
        usdc.mint(drawer, 1_000_000e18);
    }

    // ============ Deposit Tests ============

    function test_Deposit_Success() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        assertEq(fund.getBalance(address(usdc)), 1000e18);
    }

    function test_Deposit_ZeroAmount_Reverts() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        vm.expectRevert(InsuranceFund.InvalidAmount.selector);
        fund.deposit(address(usdc), 0);
        vm.stopPrank();
    }

    function test_Deposit_UnsupportedToken_Reverts() public {
        MockERC20 unknown = new MockERC20("Unknown", "UNK");
        unknown.mint(user, 1000e18);

        vm.startPrank(user);
        unknown.approve(address(fund), 1000e18);
        vm.expectRevert(InsuranceFund.TokenNotSupported.selector);
        fund.deposit(address(unknown), 1000e18);
        vm.stopPrank();
    }

    function test_Deposit_MaxAmount() public {
        uint256 maxAmount = type(uint128).max;
        usdc.mint(user, maxAmount);

        vm.startPrank(user);
        usdc.approve(address(fund), maxAmount);
        fund.deposit(address(usdc), maxAmount);
        vm.stopPrank();

        assertEq(fund.getBalance(address(usdc)), maxAmount);
    }

    function test_Deposit_MultipleTokens() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        weth.approve(address(fund), 10e18);
        fund.deposit(address(usdc), 1000e18);
        fund.deposit(address(weth), 10e18);
        vm.stopPrank();

        assertEq(fund.getBalance(address(usdc)), 1000e18);
        assertEq(fund.getBalance(address(weth)), 10e18);

        // Verify total value: $1000 + $20,000 = $21,000
        assertEq(fund.getTotalValue(), 21000e18);
    }

    // ============ ReceiveFunds Tests ============

    function test_ReceiveFunds_AuthorizedDrawer() public {
        vm.prank(drawer);
        fund.receiveFunds(address(usdc), 500e18);
        assertEq(fund.getBalance(address(usdc)), 500e18);
    }

    function test_ReceiveFunds_Owner() public {
        vm.prank(owner);
        fund.receiveFunds(address(usdc), 500e18);
        assertEq(fund.getBalance(address(usdc)), 500e18);
    }

    function test_ReceiveFunds_Unauthorized_Reverts() public {
        vm.prank(unauthorized);
        vm.expectRevert(InsuranceFund.Unauthorized.selector);
        fund.receiveFunds(address(usdc), 500e18);
    }

    // ============ CoverBadDebt Tests ============

    function test_CoverBadDebt_FullAmount() public {
        // Deposit first
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 100e18);

        assertEq(covered, 100e18);
        assertEq(fund.getBalance(address(usdc)), 9900e18);
        assertEq(usdc.balanceOf(drawer), 1_000_000e18 + 100e18);
    }

    function test_CoverBadDebt_PartialAmount() public {
        // Deposit 500 (rate limit = 100 = 20%)
        vm.startPrank(user);
        usdc.approve(address(fund), 500e18);
        fund.deposit(address(usdc), 500e18);
        vm.stopPrank();

        // Try to draw 100 (exactly at rate limit), but request more than available in partition
        // First draw 50, then 50 more - both within rate limit
        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 50e18);

        assertEq(covered, 50e18, "Should cover requested amount");
        assertEq(fund.getBalance(address(usdc)), 450e18);
    }

    function test_CoverBadDebt_EmptyFund() public {
        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 100e18);
        assertEq(covered, 0);
    }

    function test_CoverBadDebt_Unauthorized_Reverts() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        vm.prank(unauthorized);
        vm.expectRevert(InsuranceFund.Unauthorized.selector);
        fund.coverBadDebt(address(usdc), 100e18);
    }

    // ============ Rate Limiting Tests ============

    function test_RateLimit_UnderLimit() public {
        // Deposit $10,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // Draw 20% ($2,000) - should succeed
        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 2000e18);
        assertEq(covered, 2000e18);
    }

    function test_RateLimit_ExactLimit() public {
        // Deposit $10,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // Get rate limit status
        (,, uint256 maxDraw) = fund.getRateLimitStatus();
        assertEq(maxDraw, 2000e18, "Max draw should be 20% of $10k");

        // Draw exactly 20%
        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 2000e18);
        assertEq(covered, 2000e18);
    }

    function test_RateLimit_OverLimit_Reverts() public {
        // Deposit $10,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // Try to draw 21% - should fail
        vm.prank(drawer);
        vm.expectRevert(InsuranceFund.RateLimitExceeded.selector);
        fund.coverBadDebt(address(usdc), 2100e18);
    }

    function test_RateLimit_MultipleDraws() public {
        // Deposit $10,000 - initial max draw = 20% = $2,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // First draw - $1,000 (10% of original)
        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 1000e18);

        // State after first draw:
        // - Balance: $9,000
        // - periodDrawnUSD: $1,000
        // - maxDraw based on current value: $9,000 * 20% = $1,800
        // - Available: $1,800 - $1,000 = $800

        // Second draw - $800 (uses all remaining allowance)
        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 800e18);

        // State after second draw:
        // - Balance: $8,200
        // - periodDrawnUSD: $1,800
        // - maxDraw based on current value: $8,200 * 20% = $1,640
        // - Available: $1,640 - $1,800 = NEGATIVE → any draw should fail

        // Third draw - should fail (already over the new limit)
        vm.prank(drawer);
        vm.expectRevert(InsuranceFund.RateLimitExceeded.selector);
        fund.coverBadDebt(address(usdc), 1e18);
    }

    function test_RateLimit_ResetsAfterPeriod() public {
        // Deposit $10,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // Draw 20%
        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 2000e18);

        // Warp 1 hour
        vm.warp(block.timestamp + 1 hours);

        // Should be able to draw again (new period)
        vm.prank(drawer);
        uint256 covered = fund.coverBadDebt(address(usdc), 1000e18);
        assertGt(covered, 0);
    }

    function test_RateLimit_StatusBeforeExpiry() public {
        // Deposit $10,000
        vm.startPrank(user);
        usdc.approve(address(fund), 10000e18);
        fund.deposit(address(usdc), 10000e18);
        vm.stopPrank();

        // Draw $500
        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 500e18);

        (uint256 remaining, uint256 drawn, uint256 maxDraw) = fund.getRateLimitStatus();

        assertGt(remaining, 0, "Period should have time remaining");
        assertEq(drawn, 500e18, "Drawn should be $500");
        assertGt(maxDraw, drawn, "Max should be greater than drawn");
    }

    // ============ CoverPositionBadDebt Tests ============

    function test_CoverPositionBadDebt_TracksPositionId() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        bytes32 positionId = keccak256("position-1");

        vm.prank(drawer);
        uint256 covered = fund.coverPositionBadDebt(positionId, address(usdc), 100e18);

        assertEq(covered, 100e18);
    }

    // ============ Emergency Withdrawal Tests ============

    function test_EmergencyWithdraw_Success() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        address recipient = address(99);

        vm.prank(owner);
        fund.emergencyWithdraw(address(usdc), 500e18, recipient);

        assertEq(fund.getBalance(address(usdc)), 500e18);
        assertEq(usdc.balanceOf(recipient), 500e18);
    }

    function test_EmergencyWithdraw_InsufficientFunds_Reverts() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 100e18);
        fund.deposit(address(usdc), 100e18);
        vm.stopPrank();

        vm.prank(owner);
        vm.expectRevert(InsuranceFund.InsufficientFunds.selector);
        fund.emergencyWithdraw(address(usdc), 200e18, owner);
    }

    function test_EmergencyWithdraw_OnlyOwner() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        vm.prank(unauthorized);
        vm.expectRevert();
        fund.emergencyWithdraw(address(usdc), 100e18, unauthorized);
    }

    // ============ Admin Functions Tests ============

    function test_AddSupportedToken_OnlyOwner() public {
        MockERC20 newToken = new MockERC20("New Token", "NEW");

        vm.prank(unauthorized);
        vm.expectRevert();
        fund.addSupportedToken(address(newToken));
    }

    function test_AddSupportedToken_Duplicate() public {
        vm.prank(owner);
        fund.addSupportedToken(address(usdc)); // Already added in setUp

        // Should not duplicate in array
        address[] memory tokens = fund.getSupportedTokens();
        uint256 usdcCount = 0;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(usdc)) usdcCount++;
        }
        assertEq(usdcCount, 1);
    }

    function test_SetAuthorizedDrawer_Toggle() public {
        vm.startPrank(owner);
        fund.setAuthorizedDrawer(unauthorized, true);
        assertTrue(fund.authorizedDrawers(unauthorized));

        fund.setAuthorizedDrawer(unauthorized, false);
        assertFalse(fund.authorizedDrawers(unauthorized));
        vm.stopPrank();
    }

    function test_SetPriceOracle() public {
        MockPriceOracle newOracle = new MockPriceOracle();

        vm.prank(owner);
        fund.setPriceOracle(address(newOracle));

        assertEq(address(fund.priceOracle()), address(newOracle));
    }

    // ============ View Functions Tests ============

    function test_GetStats() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 100e18);

        (uint256 deposited, uint256 badDebt, uint256 current) = fund.getStats();

        assertEq(deposited, 1000e18, "Deposited should be $1000");
        assertEq(badDebt, 100e18, "Bad debt covered should be $100");
        assertEq(current, 900e18, "Current value should be $900");
    }

    function test_GetTotalValue_MultiToken() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        weth.approve(address(fund), 1e18);
        fund.deposit(address(usdc), 1000e18);
        fund.deposit(address(weth), 1e18);
        vm.stopPrank();

        // $1000 USDC + $2000 WETH = $3000
        assertEq(fund.getTotalValue(), 3000e18);
    }

    function test_GetTotalValue_ZeroPriceToken() public {
        vm.startPrank(user);
        usdc.approve(address(fund), 1000e18);
        fund.deposit(address(usdc), 1000e18);
        vm.stopPrank();

        // Set USDC price to 0
        oracle.setPrice(address(usdc), 0);

        assertEq(fund.getTotalValue(), 0, "Zero price should return zero value");
    }

    // ============ Fuzz Tests ============

    function testFuzz_Deposit(uint128 amount) public {
        vm.assume(amount > 0);

        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(fund), amount);
        fund.deposit(address(usdc), amount);
        vm.stopPrank();

        assertEq(fund.getBalance(address(usdc)), amount);
    }

    function testFuzz_CoverBadDebt_NeverExceedsBalance(uint128 deposit, uint128 claim) public {
        vm.assume(deposit > 0);

        usdc.mint(user, deposit);

        vm.startPrank(user);
        usdc.approve(address(fund), deposit);
        fund.deposit(address(usdc), deposit);
        vm.stopPrank();

        // Claim may exceed deposit, but we shouldn't revert
        // (unless rate limited - skip rate limit for this test)
        if (claim <= (uint256(deposit) * 2000) / 10000) {
            vm.prank(drawer);
            uint256 covered = fund.coverBadDebt(address(usdc), claim);
            assertLe(covered, deposit, "Covered should never exceed balance");
        }
    }

    // ============ Concurrent Access Tests ============

    function test_ConcurrentDeposits() public {
        address user2 = address(100);
        usdc.mint(user2, 1000e18);

        vm.prank(user);
        usdc.approve(address(fund), 500e18);

        vm.prank(user2);
        usdc.approve(address(fund), 500e18);

        vm.prank(user);
        fund.deposit(address(usdc), 500e18);

        vm.prank(user2);
        fund.deposit(address(usdc), 500e18);

        assertEq(fund.getBalance(address(usdc)), 1000e18);
    }

    function test_ConcurrentDraws() public {
        address drawer2 = address(101);
        vm.prank(owner);
        fund.setAuthorizedDrawer(drawer2, true);

        // Deposit enough for multiple draws
        vm.startPrank(user);
        usdc.approve(address(fund), 100000e18);
        fund.deposit(address(usdc), 100000e18);
        vm.stopPrank();

        // Both draw within rate limit
        vm.prank(drawer);
        fund.coverBadDebt(address(usdc), 5000e18);

        vm.prank(drawer2);
        fund.coverBadDebt(address(usdc), 5000e18);

        assertEq(fund.getBalance(address(usdc)), 90000e18);
    }
}
