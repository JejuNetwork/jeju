// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {CreditPurchaseContract} from "../src/services/CreditPurchaseContract.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {IElizaOSToken} from "../src/services/CreditPurchaseContract.sol";
import {IPriceOracle} from "../src/services/CreditPurchaseContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CreditPurchaseContract AGGRESSIVE Tests
 * @notice Tests MUST crash on bugs - no defensive code
 * @dev EVERY function tested with EXACT assertions
 */
contract CreditPurchaseContractTest is Test {
    CreditPurchaseContract public purchase;
    MockElizaOSToken public elizaToken;
    PriceOracle public oracle;
    MockERC20 public usdc;
    
    address public owner = address(this);
    address public treasury = address(0x1);
    address public user = address(0x2);
    address public attacker = address(0x666);
    
    // Allow contract to receive ETH
    receive() external payable {}
    
    function setUp() public {
        elizaToken = new MockElizaOSToken();
        oracle = new PriceOracle();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        
        purchase = new CreditPurchaseContract(
            elizaToken,
            IPriceOracle(address(oracle)),
            treasury
        );
        
        // Setup oracle prices (using 18 decimals to match constructor defaults)
        oracle.setPrice(address(0), 2000 * 1e18, 18); // ETH = $2000
        oracle.setPrice(address(elizaToken), 10 * 1e16, 18); // elizaOS = $0.10
        oracle.setPrice(address(usdc), 1 * 1e18, 18); // USDC = $1.00
        
        // Enable USDC
        purchase.setTokenSupport(address(usdc), true, 6);
        
        // Fund test addresses
        vm.deal(user, 100 ether);
        usdc.mint(user, 100000 * 1e6); // 100k USDC
    }
    
    // ============ Constructor - MUST set EXACT values ============
    
    function testConstructor_SetsAddresses() public view {
        assertEq(address(purchase.ElizaOSToken()), address(elizaToken));
        assertEq(address(purchase.priceOracle()), address(oracle));
        assertEq(purchase.treasury(), treasury);
    }
    
    function testConstructor_SetsDefaults() public view {
        assertEq(purchase.platformFeeBps(), 300); // 3%
        assertEq(purchase.minPurchaseUSD(), 10 * 1e18);
        assertEq(purchase.maxPurchaseUSD(), 100000 * 1e18);
        assertEq(purchase.maxSlippageBps(), 500); // 5%
    }
    
    function testConstructor_EnablesETH() public view {
        assertTrue(purchase.supportedTokens(address(0)));
        assertEq(purchase.tokenDecimals(address(0)), 18);
    }
    
    function testConstructor_RevertsOnZeroElizaOS() public {
        vm.expectRevert(CreditPurchaseContract.InvalidElizaOSToken.selector);
        new CreditPurchaseContract(
            MockElizaOSToken(address(0)),
            IPriceOracle(address(oracle)),
            treasury
        );
    }
    
    function testConstructor_RevertsOnZeroOracle() public {
        vm.expectRevert(CreditPurchaseContract.InvalidPriceOracle.selector);
        new CreditPurchaseContract(
            elizaToken,
            IPriceOracle(address(0)),
            treasury
        );
    }
    
    function testConstructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(CreditPurchaseContract.InvalidTreasury.selector);
        new CreditPurchaseContract(
            elizaToken,
            IPriceOracle(address(oracle)),
            address(0)
        );
    }
    
    // ============ getQuote - MUST calculate EXACT amounts ============
    
    function testGetQuote_CalculatesCorrectCredits() public view {
        // Paying 100 USDC ($100)
        // Platform fee 3% = $97 net
        // elizaOS at $0.10 = 970 elizaOS tokens
        // Formula: netUsdValue * 1e18 / elizaPriceUSD
        // = 97e18 * 1e18 / 0.1e18 = 970e18

        (uint256 creditsOut, , , uint256 usdValue) = purchase.getQuote(address(usdc), 100 * 1e6);

        assertEq(usdValue, 100 * 1e18); // MUST be $100
        assertEq(creditsOut, 970 * 1e18); // MUST be 970 elizaOS tokens
    }
    
    function testGetQuote_RevertsOnUnsupportedToken() public {
        address unsupported = address(0x999);
        
        vm.expectRevert(abi.encodeWithSelector(
            CreditPurchaseContract.UnsupportedToken.selector,
            unsupported
        ));
        purchase.getQuote(unsupported, 100 * 1e18);
    }
    
    // ============ purchaseCredits - MUST execute EXACT flow ============
    
    function testPurchaseCredits_WithETH() public {
        uint256 paymentAmount = 1 ether;
        
        vm.prank(user);
        uint256 creditsReceived = purchase.purchaseCredits{value: paymentAmount}(
            address(0),  // ETH
            paymentAmount,
            0,  // No slippage check
            user
        );
        
        // Verify credits minted
        assertEq(elizaToken.balanceOf(user), creditsReceived);
        
        // Verify exact ETH amount transferred to treasury (after 3% platform fee)
        uint256 expectedTreasuryAmount = (paymentAmount * 97) / 100;
        assertEq(treasury.balance, expectedTreasuryAmount, "Treasury should receive payment minus platform fee");
    }
    
    function testPurchaseCredits_WithUSDC() public {
        uint256 paymentAmount = 100 * 1e6; // 100 USDC
        
        vm.startPrank(user);
        usdc.approve(address(purchase), paymentAmount);
        
        uint256 creditsReceived = purchase.purchaseCredits(
            address(usdc),
            paymentAmount,
            0,
            user
        );
        vm.stopPrank();
        
        // Verify credits minted
        assertEq(elizaToken.balanceOf(user), creditsReceived);
        
        // Verify exact USDC amount transferred to treasury (after 3% platform fee)
        uint256 expectedTreasuryAmount = (paymentAmount * 97) / 100;
        assertEq(usdc.balanceOf(treasury), expectedTreasuryAmount, "Treasury should receive payment minus platform fee");
    }
    
    function testPurchaseCredits_RevertsOnSlippageExceeded() public {
        vm.prank(user);
        vm.expectRevert(); // SlippageExceeded
        purchase.purchaseCredits{value: 1 ether}(
            address(0),
            1 ether,
            1000000 * 1e18,  // Unrealistic minimum
            user
        );
    }
    
    function testPurchaseCredits_RevertsWhenPaused() public {
        purchase.pause();
        
        vm.prank(user);
        vm.expectRevert(); // Pausable: paused
        purchase.purchaseCredits{value: 1 ether}(
            address(0),
            1 ether,
            0,
            user
        );
    }
    
    function testPurchaseCredits_RevertsOnZeroRecipient() public {
        vm.prank(user);
        vm.expectRevert(CreditPurchaseContract.InvalidRecipient.selector);
        purchase.purchaseCredits{value: 1 ether}(
            address(0),
            1 ether,
            0,
            address(0)  // Zero recipient
        );
    }
    
    // ============ Admin Functions ============
    
    function testSetPriceOracle_Updates() public {
        PriceOracle newOracle = new PriceOracle();
        
        purchase.setPriceOracle(IPriceOracle(address(newOracle)));
        
        assertEq(address(purchase.priceOracle()), address(newOracle));
    }
    
    function testSetTreasury_Updates() public {
        address newTreasury = address(0x888);
        
        purchase.setTreasury(newTreasury);
        
        assertEq(purchase.treasury(), newTreasury);
    }
    
    function testSetPlatformFee_Updates() public {
        uint256 newFee = 500; // 5%
        
        purchase.setPlatformFee(newFee);
        
        assertEq(purchase.platformFeeBps(), newFee);
    }
    
    function testSetPlatformFee_RevertsIfTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(
            CreditPurchaseContract.InvalidFee.selector,
            1001
        ));
        purchase.setPlatformFee(1001); // Over 10%
    }
    
    // Events
    event ServiceRegistered(string indexed serviceName, uint256 basePriceElizaOS, uint256 minPrice, uint256 maxPrice);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
}

// ============ Mocks ============

contract MockElizaOSToken is IElizaOSToken {
    mapping(address => uint256) public balanceOf;
    
    function decimals() external pure returns (uint8) {
        return 18;
    }
    
    function mint(address to, uint256 amount) external override {
        balanceOf[to] += amount;
    }
}

contract MockPriceOracleForTest is IPriceOracle {
    struct PriceData {
        uint256 price;
        uint256 decimals;
        bool isFresh;
    }
    
    mapping(address => PriceData) public prices;
    
    function setPrice(address token, uint256 price, uint256 decimals) external {
        prices[token] = PriceData(price, decimals, true);
    }
    
    function getPrice(address token) external view override returns (uint256, uint256) {
        return (prices[token].price, prices[token].decimals);
    }
    
    function isPriceFresh(address) external pure override returns (bool) {
        return true;
    }
}

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply += amount;
    }
    
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }
    
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }
}

