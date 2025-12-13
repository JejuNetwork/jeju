// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/autocrat/AutocratTreasury.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AutocratTreasuryTest is Test {
    AutocratTreasury public treasury;
    MockERC20 public token;

    address public admin = address(0x1);
    address public operator1 = address(0x2);
    address public operator2 = address(0x3);
    address public protocolTreasuryAddr = address(0x4);
    address public stakersPool = address(0x5);
    address public insuranceFund = address(0x6);
    address public attacker = address(0x7);

    function setUp() public {
        vm.startPrank(admin);
        treasury = new AutocratTreasury(protocolTreasuryAddr, stakersPool, insuranceFund, admin);

        // Authorize operators
        treasury.authorizeOperator(operator1);
        treasury.authorizeOperator(operator2);

        vm.stopPrank();

        // Deploy mock token and fund operator
        token = new MockERC20();
        token.transfer(operator1, 100_000 ether);
        token.transfer(operator2, 100_000 ether);

        // Fund operators with ETH
        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);
    }

    // =========================================================================
    // Authorization Tests
    // =========================================================================

    function test_AuthorizeOperator() public {
        address newOperator = address(0x100);

        vm.prank(admin);
        treasury.authorizeOperator(newOperator);

        assertTrue(treasury.authorizedOperators(newOperator));
    }

    function test_RevokeOperator() public {
        vm.prank(admin);
        treasury.revokeOperator(operator1);

        assertFalse(treasury.authorizedOperators(operator1));
    }

    function testRevert_AuthorizeOperator_NotAdmin() public {
        vm.prank(attacker);
        vm.expectRevert();
        treasury.authorizeOperator(attacker);
    }

    function testRevert_AuthorizeOperator_ZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(AutocratTreasury.InvalidRecipient.selector);
        treasury.authorizeOperator(address(0));
    }

    // =========================================================================
    // ETH Deposit Tests
    // =========================================================================

    function test_DepositETHProfit() public {
        uint256 amount = 10 ether;

        vm.prank(operator1);
        treasury.depositProfit{value: amount}(
            address(0), amount, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx1")
        );

        // Verify total deposited
        assertEq(treasury.totalProfitsByToken(address(0)), amount);

        // Verify profit by source
        assertEq(treasury.totalProfitsBySource(AutocratTreasury.ProfitSource.DEX_ARBITRAGE), amount);
    }

    function test_DepositETHProfit_MultipleSources() public {
        vm.startPrank(operator1);

        treasury.depositProfit{value: 5 ether}(
            address(0), 5 ether, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx1")
        );

        treasury.depositProfit{value: 3 ether}(
            address(0), 3 ether, AutocratTreasury.ProfitSource.SANDWICH, keccak256("tx2")
        );

        treasury.depositProfit{value: 2 ether}(
            address(0), 2 ether, AutocratTreasury.ProfitSource.LIQUIDATION, keccak256("tx3")
        );

        vm.stopPrank();

        assertEq(treasury.totalProfitsByToken(address(0)), 10 ether);
        assertEq(treasury.totalProfitsBySource(AutocratTreasury.ProfitSource.DEX_ARBITRAGE), 5 ether);
        assertEq(treasury.totalProfitsBySource(AutocratTreasury.ProfitSource.SANDWICH), 3 ether);
        assertEq(treasury.totalProfitsBySource(AutocratTreasury.ProfitSource.LIQUIDATION), 2 ether);
    }

    function testRevert_DepositETH_NotAuthorized() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(AutocratTreasury.UnauthorizedOperator.selector);
        treasury.depositProfit{value: 1 ether}(
            address(0), 1 ether, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx")
        );
    }

    function testRevert_DepositETH_ZeroAmount() public {
        vm.prank(operator1);
        vm.expectRevert(AutocratTreasury.ZeroAmount.selector);
        treasury.depositProfit{value: 0}(address(0), 0, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx"));
    }

    // =========================================================================
    // ERC20 Deposit Tests
    // =========================================================================

    function test_DepositERC20Profit() public {
        uint256 amount = 1000 ether;

        vm.startPrank(operator1);
        token.approve(address(treasury), amount);
        treasury.depositProfit(
            address(token), amount, AutocratTreasury.ProfitSource.CROSS_CHAIN_ARBITRAGE, keccak256("tx")
        );
        vm.stopPrank();

        assertEq(treasury.totalProfitsByToken(address(token)), amount);
        assertEq(token.balanceOf(address(treasury)), amount);
    }

    function testRevert_DepositERC20_NoApproval() public {
        vm.prank(operator1);
        vm.expectRevert();
        treasury.depositProfit(
            address(token), 1000 ether, AutocratTreasury.ProfitSource.CROSS_CHAIN_ARBITRAGE, keccak256("tx")
        );
    }

    // =========================================================================
    // Operator Earnings Tests
    // =========================================================================

    function test_OperatorEarnings() public {
        uint256 amount = 100 ether;

        vm.prank(operator1);
        treasury.depositProfit{value: amount}(
            address(0), amount, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx")
        );

        // Default operator share is 5%
        uint256 expectedEarnings = (amount * 500) / 10000;
        assertEq(treasury.operatorEarnings(operator1, address(0)), expectedEarnings);
    }

    function test_WithdrawOperatorEarnings() public {
        uint256 amount = 100 ether;

        vm.prank(operator1);
        treasury.depositProfit{value: amount}(
            address(0), amount, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx")
        );

        uint256 earnings = treasury.pendingOperatorWithdrawals(operator1, address(0));
        uint256 balanceBefore = operator1.balance;

        vm.prank(operator1);
        treasury.withdrawOperatorEarnings(address(0));

        assertEq(operator1.balance, balanceBefore + earnings);
        assertEq(treasury.pendingOperatorWithdrawals(operator1, address(0)), 0);
    }

    function testRevert_WithdrawEarnings_NothingToWithdraw() public {
        vm.prank(operator1);
        vm.expectRevert(AutocratTreasury.InsufficientBalance.selector);
        treasury.withdrawOperatorEarnings(address(0));
    }

    // =========================================================================
    // Distribution Tests
    // =========================================================================

    function test_DistributeProfits() public {
        uint256 amount = 100 ether;

        vm.prank(operator1);
        treasury.depositProfit{value: amount}(
            address(0), amount, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx")
        );

        // Contract balance = 100 ETH
        // Note: _getTotalPendingOperatorWithdrawals returns 0 for gas efficiency
        // So distributable = 100 ETH
        // Distribution: 50% protocol, 30% stakers, 15% insurance = 95% total
        // Remaining 5% stays in contract for operator withdrawals
        uint256 distributable = amount; // 100 ETH

        uint256 expectedProtocol = (distributable * 5000) / 10000; // 50 ETH
        uint256 expectedStakers = (distributable * 3000) / 10000; // 30 ETH
        uint256 expectedInsurance = (distributable * 1500) / 10000; // 15 ETH

        uint256 protocolBefore = protocolTreasuryAddr.balance;
        uint256 stakersBefore = stakersPool.balance;
        uint256 insuranceBefore = insuranceFund.balance;

        treasury.distributeProfits(address(0));

        assertEq(protocolTreasuryAddr.balance, protocolBefore + expectedProtocol);
        assertEq(stakersPool.balance, stakersBefore + expectedStakers);
        assertEq(insuranceFund.balance, insuranceBefore + expectedInsurance);
    }

    // =========================================================================
    // Configuration Tests
    // =========================================================================

    function test_SetDistribution() public {
        vm.prank(admin);
        treasury.setDistribution(6000, 2000, 1500, 500);

        (uint16 protocolBps, uint16 stakersBps, uint16 insuranceBps, uint16 operatorBps) = treasury.distribution();
        assertEq(protocolBps, 6000);
        assertEq(stakersBps, 2000);
        assertEq(insuranceBps, 1500);
        assertEq(operatorBps, 500);
    }

    function testRevert_SetDistribution_InvalidTotal() public {
        vm.prank(admin);
        vm.expectRevert(AutocratTreasury.InvalidDistributionConfig.selector);
        treasury.setDistribution(5000, 3000, 1500, 1000); // 105%
    }

    function test_SetRecipients() public {
        address newProtocol = address(0x200);
        address newStakers = address(0x201);
        address newInsurance = address(0x202);

        vm.startPrank(admin);
        treasury.setProtocolTreasury(newProtocol);
        treasury.setStakersRewardsPool(newStakers);
        treasury.setInsuranceFund(newInsurance);
        vm.stopPrank();

        assertEq(treasury.protocolTreasury(), newProtocol);
        assertEq(treasury.stakersRewardsPool(), newStakers);
        assertEq(treasury.insuranceFund(), newInsurance);
    }

    // =========================================================================
    // Receive ETH Tests
    // =========================================================================

    function test_ReceiveETH() public {
        vm.deal(address(this), 5 ether);
        (bool success,) = address(treasury).call{value: 5 ether}("");
        assertTrue(success);
        assertEq(address(treasury).balance, 5 ether);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_DepositProfit(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(operator1, amount);

        vm.prank(operator1);
        treasury.depositProfit{value: amount}(
            address(0), amount, AutocratTreasury.ProfitSource.DEX_ARBITRAGE, keccak256("tx")
        );

        assertEq(treasury.totalProfitsByToken(address(0)), amount);
    }
}
