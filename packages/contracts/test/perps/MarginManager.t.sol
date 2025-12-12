// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MarginManager} from "../../src/perps/MarginManager.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20Token is ERC20 {
    uint8 private _decimals;
    
    constructor(uint8 decimals_) ERC20("Mock", "MOCK") {
        _decimals = decimals_;
    }
    
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    
    function decimals() public view override returns (uint8) { return _decimals; }
}

contract MockPriceOracle {
    mapping(address => uint256) public prices;
    
    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }
    
    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}

contract MockTokenRegistry {}

contract MarginManagerTest is Test {
    MarginManager public manager;
    MockPriceOracle public oracle;
    MockTokenRegistry public registry;
    MockERC20Token public usdc;
    MockERC20Token public weth;
    MockERC20Token public wbtc;
    
    address public owner = address(1);
    address public trader1 = address(2);
    address public trader2 = address(3);
    address public perpMarket = address(4);
    address public insuranceFund = address(5);
    
    uint256 public constant USDC_PRICE = 1e18; // $1
    uint256 public constant ETH_PRICE = 2000e18; // $2000
    uint256 public constant BTC_PRICE = 50000e18; // $50000
    
    function setUp() public {
        vm.startPrank(owner);
        
        oracle = new MockPriceOracle();
        registry = new MockTokenRegistry();
        
        usdc = new MockERC20Token(6); // 6 decimals
        weth = new MockERC20Token(18); // 18 decimals
        wbtc = new MockERC20Token(8); // 8 decimals
        
        oracle.setPrice(address(usdc), USDC_PRICE);
        oracle.setPrice(address(weth), ETH_PRICE);
        oracle.setPrice(address(wbtc), BTC_PRICE);
        
        manager = new MarginManager(
            address(oracle),
            address(registry),
            owner
        );
        
        // Add collateral tokens (weight in bps, 10000 = 100%)
        manager.addCollateralToken(address(usdc), 10000, 0); // 100% weight, no max
        manager.addCollateralToken(address(weth), 9500, 0); // 95% weight
        manager.addCollateralToken(address(wbtc), 9000, 100e8); // 90% weight, max 100 BTC
        
        // Authorize perpMarket
        manager.setAuthorizedContract(perpMarket, true);
        
        vm.stopPrank();
        
        // Fund traders
        usdc.mint(trader1, 100000e6);
        weth.mint(trader1, 100e18);
        wbtc.mint(trader1, 10e8);
        
        usdc.mint(trader2, 50000e6);
        weth.mint(trader2, 50e18);
    }
    
    // ============ Deposit Tests ============
    
    function test_Deposit_Success() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 1000e6);
        assertEq(manager.totalDeposits(address(usdc)), 1000e6);
    }
    
    function test_Deposit_MultipleTokens() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        weth.approve(address(manager), 2e18);
        
        manager.deposit(address(usdc), 5000e6);
        manager.deposit(address(weth), 2e18);
        vm.stopPrank();
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 5000e6);
        assertEq(manager.getCollateralBalance(trader1, address(weth)), 2e18);
    }
    
    function test_Deposit_ZeroAmount_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        
        vm.expectRevert(MarginManager.InvalidAmount.selector);
        manager.deposit(address(usdc), 0);
        vm.stopPrank();
    }
    
    function test_Deposit_TokenNotAccepted_Reverts() public {
        MockERC20Token unknown = new MockERC20Token(18);
        unknown.mint(trader1, 1000e18);
        
        vm.startPrank(trader1);
        unknown.approve(address(manager), 1000e18);
        
        vm.expectRevert(MarginManager.TokenNotAccepted.selector);
        manager.deposit(address(unknown), 1000e18);
        vm.stopPrank();
    }
    
    function test_Deposit_ExceedsMaxDeposit_Reverts() public {
        // wbtc has max 100 BTC per user
        vm.startPrank(trader1);
        wbtc.mint(trader1, 200e8); // Extra BTC
        wbtc.approve(address(manager), 150e8);
        
        vm.expectRevert(MarginManager.ExceedsMaxDeposit.selector);
        manager.deposit(address(wbtc), 150e8);
        vm.stopPrank();
    }
    
    function test_Deposit_WhenPaused_Reverts() public {
        vm.prank(owner);
        manager.pause();
        
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        
        vm.expectRevert();
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
    }
    
    // ============ Withdraw Tests ============
    
    function test_Withdraw_Success() public {
        // Deposit first
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        
        uint256 balanceBefore = usdc.balanceOf(trader1);
        manager.withdraw(address(usdc), 500e6);
        vm.stopPrank();
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 500e6);
        assertEq(usdc.balanceOf(trader1), balanceBefore + 500e6);
    }
    
    function test_Withdraw_FullAmount() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        
        manager.withdraw(address(usdc), 1000e6);
        vm.stopPrank();
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 0);
    }
    
    function test_Withdraw_ZeroAmount_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        
        vm.expectRevert(MarginManager.InvalidAmount.selector);
        manager.withdraw(address(usdc), 0);
        vm.stopPrank();
    }
    
    function test_Withdraw_InsufficientAvailable_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        // Reserve some margin
        vm.prank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 600e6);
        
        // Try to withdraw more than available (1000 - 600 = 400 available)
        vm.prank(trader1);
        vm.expectRevert(MarginManager.InsufficientAvailableMargin.selector);
        manager.withdraw(address(usdc), 500e6);
    }
    
    function test_Withdraw_WithReserved_PartialSuccess() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        // Reserve 300
        vm.prank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 300e6);
        
        // Withdraw up to available (700)
        vm.prank(trader1);
        manager.withdraw(address(usdc), 700e6);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 300e6);
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 300e6);
    }
    
    // ============ Reserve/Release Margin Tests ============
    
    function test_ReserveMargin_Success() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.prank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 500e6);
        
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 500e6);
        assertEq(manager.getAvailableCollateral(trader1, address(usdc)), 500e6);
    }
    
    function test_ReserveMargin_InsufficientAvailable_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.prank(perpMarket);
        vm.expectRevert(MarginManager.InsufficientAvailableMargin.selector);
        manager.reserveMargin(trader1, address(usdc), 1500e6);
    }
    
    function test_ReserveMargin_Unauthorized_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        
        vm.expectRevert(MarginManager.Unauthorized.selector);
        manager.reserveMargin(trader1, address(usdc), 500e6);
        vm.stopPrank();
    }
    
    function test_ReleaseMargin_Success() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.startPrank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 500e6);
        manager.releaseMargin(trader1, address(usdc), 200e6);
        vm.stopPrank();
        
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 300e6);
        assertEq(manager.getAvailableCollateral(trader1, address(usdc)), 700e6);
    }
    
    function test_ReleaseMargin_MoreThanReserved() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.startPrank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 500e6);
        
        // Release more than reserved - should cap at reserved amount
        manager.releaseMargin(trader1, address(usdc), 1000e6);
        vm.stopPrank();
        
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 0);
    }
    
    // ============ Transfer Margin Tests ============
    
    function test_TransferMargin_ToTrader() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.prank(perpMarket);
        manager.transferMargin(trader1, trader2, address(usdc), 300e6);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 700e6);
        assertEq(manager.getCollateralBalance(trader2, address(usdc)), 300e6);
    }
    
    function test_TransferMargin_ToContract() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        // Use a real contract (oracle) as the recipient
        uint256 oracleBalanceBefore = usdc.balanceOf(address(oracle));
        
        vm.prank(perpMarket);
        manager.transferMargin(trader1, address(oracle), address(usdc), 300e6);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 700e6);
        assertEq(usdc.balanceOf(address(oracle)), oracleBalanceBefore + 300e6);
    }
    
    function test_TransferMargin_InsufficientBalance_Reverts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.prank(perpMarket);
        vm.expectRevert(MarginManager.InsufficientBalance.selector);
        manager.transferMargin(trader1, trader2, address(usdc), 1500e6);
    }
    
    // ============ Deduct/Credit Margin Tests ============
    
    function test_DeductMargin_Success() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        uint256 fundBalanceBefore = usdc.balanceOf(insuranceFund);
        
        vm.prank(perpMarket);
        manager.deductMargin(trader1, address(usdc), 100e6, insuranceFund);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 900e6);
        assertEq(usdc.balanceOf(insuranceFund), fundBalanceBefore + 100e6);
    }
    
    function test_DeductMargin_MoreThanBalance() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        // Deduct more than balance - should cap at balance
        vm.prank(perpMarket);
        manager.deductMargin(trader1, address(usdc), 1500e6, insuranceFund);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 0);
    }
    
    function test_CreditMargin_Success() public {
        vm.prank(perpMarket);
        manager.creditMargin(trader1, address(usdc), 500e6);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 500e6);
    }
    
    // ============ View Function Tests ============
    
    function test_GetTotalCollateralValue() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        weth.approve(address(manager), 2e18);
        
        manager.deposit(address(usdc), 5000e6); // $5000
        manager.deposit(address(weth), 2e18); // $4000
        vm.stopPrank();
        
        // USDC: 5000e6 * 1e12 = 5000e18 normalized * 1e18 / 1e18 = $5000 * 100% weight = $5000
        // ETH: 2e18 * 2000e18 / 1e18 = $4000 * 95% weight = $3800
        // Total weighted: $8800
        uint256 total = manager.getTotalCollateralValue(trader1);
        assertGt(total, 0);
    }
    
    function test_GetAvailableCollateralValue() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        manager.deposit(address(usdc), 5000e6);
        vm.stopPrank();
        
        vm.prank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 2000e6);
        
        uint256 available = manager.getAvailableCollateralValue(trader1);
        // 3000e6 available at 100% weight
        assertGt(available, 0);
    }
    
    function test_GetCollateralInfo() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        manager.deposit(address(usdc), 5000e6);
        vm.stopPrank();
        
        MarginManager.CollateralInfo memory info = manager.getCollateralInfo(trader1, address(usdc));
        
        assertEq(info.token, address(usdc));
        assertEq(info.balance, 5000e6);
        assertEq(info.weight, 10000);
        assertGt(info.valueUSD, 0);
    }
    
    function test_GetAllCollateralInfo() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        weth.approve(address(manager), 2e18);
        
        manager.deposit(address(usdc), 5000e6);
        manager.deposit(address(weth), 2e18);
        vm.stopPrank();
        
        MarginManager.CollateralInfo[] memory infos = manager.getAllCollateralInfo(trader1);
        
        assertEq(infos.length, 3); // USDC, WETH, WBTC
    }
    
    function test_IsCollateralAccepted() public view {
        (bool accepted, uint256 weight) = manager.isCollateralAccepted(address(usdc));
        assertTrue(accepted);
        assertEq(weight, 10000);
        
        (bool accepted2, ) = manager.isCollateralAccepted(address(0xdead));
        assertFalse(accepted2);
    }
    
    function test_GetAcceptedTokens() public view {
        address[] memory tokens = manager.getAcceptedTokens();
        assertEq(tokens.length, 3);
        assertEq(tokens[0], address(usdc));
        assertEq(tokens[1], address(weth));
        assertEq(tokens[2], address(wbtc));
    }
    
    function test_GetGlobalStats() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        manager.deposit(address(usdc), 5000e6);
        vm.stopPrank();
        
        (uint256 totalUSD, uint256 tokenCount) = manager.getGlobalStats();
        assertGt(totalUSD, 0);
        assertEq(tokenCount, 3);
    }
    
    // ============ Admin Tests ============
    
    function test_AddCollateralToken() public {
        MockERC20Token newToken = new MockERC20Token(18);
        oracle.setPrice(address(newToken), 10e18);
        
        vm.prank(owner);
        manager.addCollateralToken(address(newToken), 8500, 1000e18);
        
        (bool accepted, uint256 weight) = manager.isCollateralAccepted(address(newToken));
        assertTrue(accepted);
        assertEq(weight, 8500);
    }
    
    function test_AddCollateralToken_AlreadyAccepted_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(MarginManager.TokenAlreadyAccepted.selector);
        manager.addCollateralToken(address(usdc), 10000, 0);
    }
    
    function test_AddCollateralToken_InvalidWeight_Reverts() public {
        MockERC20Token newToken = new MockERC20Token(18);
        
        vm.startPrank(owner);
        vm.expectRevert(MarginManager.InvalidWeight.selector);
        manager.addCollateralToken(address(newToken), 0, 0);
        
        vm.expectRevert(MarginManager.InvalidWeight.selector);
        manager.addCollateralToken(address(newToken), 15000, 0); // > 100%
        vm.stopPrank();
    }
    
    function test_UpdateCollateralToken() public {
        vm.prank(owner);
        manager.updateCollateralToken(address(usdc), 9500, 50000e6);
        
        (bool accepted, uint256 weight) = manager.isCollateralAccepted(address(usdc));
        assertTrue(accepted);
        assertEq(weight, 9500);
    }
    
    function test_RemoveCollateralToken() public {
        vm.prank(owner);
        manager.removeCollateralToken(address(wbtc));
        
        (bool accepted, ) = manager.isCollateralAccepted(address(wbtc));
        assertFalse(accepted);
    }
    
    function test_SetAuthorizedContract() public {
        address newContract = address(100);
        
        vm.prank(owner);
        manager.setAuthorizedContract(newContract, true);
        
        assertTrue(manager.authorizedContracts(newContract));
    }
    
    function test_SetPriceOracle() public {
        MockPriceOracle newOracle = new MockPriceOracle();
        
        vm.prank(owner);
        manager.setPriceOracle(address(newOracle));
        
        assertEq(address(manager.priceOracle()), address(newOracle));
    }
    
    function test_Pause_Unpause() public {
        vm.prank(owner);
        manager.pause();
        
        vm.startPrank(trader1);
        usdc.approve(address(manager), 1000e6);
        vm.expectRevert();
        manager.deposit(address(usdc), 1000e6);
        vm.stopPrank();
        
        vm.prank(owner);
        manager.unpause();
        
        vm.prank(trader1);
        manager.deposit(address(usdc), 1000e6);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 1000e6);
    }
    
    // ============ Edge Cases ============
    
    function test_MultipleTraders_IndependentAccounts() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 5000e6);
        manager.deposit(address(usdc), 5000e6);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        usdc.approve(address(manager), 3000e6);
        manager.deposit(address(usdc), 3000e6);
        vm.stopPrank();
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 5000e6);
        assertEq(manager.getCollateralBalance(trader2, address(usdc)), 3000e6);
        assertEq(manager.totalDeposits(address(usdc)), 8000e6);
    }
    
    function test_SequentialReserveRelease() public {
        vm.startPrank(trader1);
        usdc.approve(address(manager), 10000e6);
        manager.deposit(address(usdc), 10000e6);
        vm.stopPrank();
        
        // Multiple reserves
        vm.startPrank(perpMarket);
        manager.reserveMargin(trader1, address(usdc), 2000e6);
        manager.reserveMargin(trader1, address(usdc), 3000e6);
        vm.stopPrank();
        
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 5000e6);
        
        // Partial releases
        vm.startPrank(perpMarket);
        manager.releaseMargin(trader1, address(usdc), 1000e6);
        manager.releaseMargin(trader1, address(usdc), 2000e6);
        vm.stopPrank();
        
        assertEq(manager.getReservedBalance(trader1, address(usdc)), 2000e6);
        assertEq(manager.getAvailableCollateral(trader1, address(usdc)), 8000e6);
    }
    
    function testFuzz_DepositWithdraw(uint256 depositAmount) public {
        vm.assume(depositAmount > 0 && depositAmount <= 50000e6);
        
        vm.startPrank(trader1);
        usdc.approve(address(manager), depositAmount);
        manager.deposit(address(usdc), depositAmount);
        
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), depositAmount);
        
        manager.withdraw(address(usdc), depositAmount);
        assertEq(manager.getCollateralBalance(trader1, address(usdc)), 0);
        vm.stopPrank();
    }
}
