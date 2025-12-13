// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/launchpad/TokenLaunchpad.sol";
import "../../src/launchpad/LaunchpadToken.sol";
import "../../src/launchpad/BondingCurve.sol";
import "../../src/launchpad/ICOPresale.sol";
import "../../src/launchpad/LPLocker.sol";

// Import AMM without interfaces
import {XLPV2Factory} from "../../src/amm/v2/XLPV2Factory.sol";
import {XLPV2Pair} from "../../src/amm/v2/XLPV2Pair.sol";

contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "Insufficient balance");
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function transfer(address dst, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "Insufficient allowance");
            allowance[src][msg.sender] -= wad;
        }
        require(balanceOf[src] >= wad, "Insufficient balance");
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }

    function approve(address guy, uint256 wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        return true;
    }
}

contract TokenLaunchpadTest is Test {
    TokenLaunchpad public launchpad;
    XLPV2Factory public xlpFactory;
    MockWETH public weth;
    LPLocker public lpLockerTemplate;

    address public owner = address(0x1);
    address public creator = address(0x2);
    address public buyer1 = address(0x3);
    address public buyer2 = address(0x4);
    address public communityVault = address(0x5);

    uint256 constant INITIAL_ETH = 100 ether;
    uint256 constant TOKEN_SUPPLY = 1_000_000_000e18; // 1B tokens
    uint256 constant VIRTUAL_ETH = 30 ether;
    uint256 constant GRADUATION_TARGET = 10 ether;

    function setUp() public {
        // Fund accounts
        vm.deal(owner, INITIAL_ETH);
        vm.deal(creator, INITIAL_ETH);
        vm.deal(buyer1, INITIAL_ETH);
        vm.deal(buyer2, INITIAL_ETH);

        // Deploy dependencies
        xlpFactory = new XLPV2Factory(owner);
        weth = new MockWETH();
        lpLockerTemplate = new LPLocker(owner);

        // Deploy launchpad
        vm.prank(owner);
        launchpad =
            new TokenLaunchpad(address(xlpFactory), address(weth), address(lpLockerTemplate), communityVault, owner);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         BONDING CURVE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_LaunchBondingCurve() public {
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Test Token",
            "TEST",
            8000, // 80% creator
            address(0), // Use default community vault
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        assertEq(launchId, 1);
        assertTrue(tokenAddress != address(0));

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        assertEq(launch.creator, creator);
        assertEq(launch.token, tokenAddress);
        assertEq(uint8(launch.launchType), uint8(TokenLaunchpad.LaunchType.BONDING_CURVE));
        assertEq(launch.feeConfig.creatorFeeBps, 8000);
        assertEq(launch.feeConfig.communityFeeBps, 2000);
        assertFalse(launch.graduated);
    }

    function test_BondingCurveBuyTokens() public {
        // Launch token
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Test Token",
            "TEST",
            8000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));

        // Initialize curve
        curve.initialize();

        // Get initial price
        uint256 initialPrice = curve.getCurrentPrice();
        assertGt(initialPrice, 0);

        // Calculate expected tokens before buying
        uint256 ethIn = 1 ether;
        uint256 expectedTokens = curve.getTokensOut(ethIn);

        // Buy tokens
        vm.prank(buyer1);
        uint256 tokensReceived = curve.buy{value: ethIn}(0);

        assertEq(tokensReceived, expectedTokens);
        assertEq(IERC20(tokenAddress).balanceOf(buyer1), tokensReceived);

        // Price should have increased
        uint256 newPrice = curve.getCurrentPrice();
        assertGt(newPrice, initialPrice);
    }

    function test_BondingCurveSellTokens() public {
        // Launch and buy first
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Test Token",
            "TEST",
            8000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Buy tokens
        vm.prank(buyer1);
        uint256 tokensReceived = curve.buy{value: 1 ether}(0);

        uint256 priceAfterBuy = curve.getCurrentPrice();
        uint256 buyer1EthBefore = buyer1.balance;

        // Sell half
        uint256 tokensToSell = tokensReceived / 2;
        vm.startPrank(buyer1);
        IERC20(tokenAddress).approve(address(curve), tokensToSell);
        uint256 ethReceived = curve.sell(tokensToSell, 0);
        vm.stopPrank();

        assertGt(ethReceived, 0);
        assertEq(buyer1.balance, buyer1EthBefore + ethReceived);

        // Price should have decreased
        uint256 priceAfterSell = curve.getCurrentPrice();
        assertLt(priceAfterSell, priceAfterBuy);
    }

    function test_BondingCurveGraduation() public {
        // Launch with lower graduation target for testing
        vm.prank(creator);
        launchpad.launchBondingCurve(
            "Test Token",
            "TEST",
            8000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 5 ether,
                graduationTarget: 3 ether, // Low target
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(1);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        assertFalse(curve.graduated());

        // Buy enough to trigger graduation
        vm.prank(buyer1);
        curve.buy{value: 3.5 ether}(0);

        assertTrue(curve.graduated());
        assertTrue(curve.lpPair() != address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         FEE CONFIGURATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_FeeConfigValidation() public {
        // Test 100% creator
        vm.prank(creator);
        (uint256 launchId1,) = launchpad.launchBondingCurve(
            "All Creator",
            "AC",
            10000, // 100% creator
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch1 = launchpad.getLaunch(launchId1);
        assertEq(launch1.feeConfig.creatorFeeBps, 10000);
        assertEq(launch1.feeConfig.communityFeeBps, 0);

        // Test 100% community
        vm.prank(creator);
        (uint256 launchId2,) = launchpad.launchBondingCurve(
            "All Community",
            "ACO",
            0, // 0% creator = 100% community
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch2 = launchpad.getLaunch(launchId2);
        assertEq(launch2.feeConfig.creatorFeeBps, 0);
        assertEq(launch2.feeConfig.communityFeeBps, 10000);
    }

    function test_InvalidFeeConfigReverts() public {
        vm.prank(creator);
        vm.expectRevert(TokenLaunchpad.InvalidFeeConfig.selector);
        launchpad.launchBondingCurve(
            "Invalid",
            "INV",
            10001, // Over 100%
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: VIRTUAL_ETH,
                graduationTarget: GRADUATION_TARGET,
                tokenSupply: TOKEN_SUPPLY
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         LP LOCKER TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_LPLockerBasics() public {
        LPLocker locker = new LPLocker(owner);

        // Deploy a mock LP token
        LaunchpadToken mockLP = new LaunchpadToken("LP Token", "LP", 1000e18, owner);

        // Authorize and lock
        vm.startPrank(owner);
        mockLP.approve(address(locker), 100e18);
        uint256 lockId = locker.lock(IERC20(address(mockLP)), 100e18, buyer1, 30 days);
        vm.stopPrank();

        LPLocker.Lock memory lockData = locker.getLock(lockId);
        assertEq(lockData.amount, 100e18);
        assertEq(lockData.beneficiary, buyer1);
        assertFalse(lockData.withdrawn);

        // Try to withdraw before unlock
        vm.prank(buyer1);
        vm.expectRevert(LPLocker.LockNotExpired.selector);
        locker.withdraw(lockId);

        // Fast forward past lock duration
        vm.warp(block.timestamp + 31 days);

        // Now withdraw should work
        vm.prank(buyer1);
        locker.withdraw(lockId);

        assertEq(mockLP.balanceOf(buyer1), 100e18);

        lockData = locker.getLock(lockId);
        assertTrue(lockData.withdrawn);
    }

    function test_LPLockerExtension() public {
        LPLocker locker = new LPLocker(owner);
        LaunchpadToken mockLP = new LaunchpadToken("LP Token", "LP", 1000e18, owner);

        vm.startPrank(owner);
        mockLP.approve(address(locker), 100e18);
        uint256 lockId = locker.lock(IERC20(address(mockLP)), 100e18, buyer1, 7 days);
        vm.stopPrank();

        LPLocker.Lock memory lockData = locker.getLock(lockId);
        uint256 originalUnlock = lockData.unlockTime;

        // Extend by 30 more days
        vm.prank(buyer1);
        locker.extendLock(lockId, 30 days);

        lockData = locker.getLock(lockId);
        assertGt(lockData.unlockTime, originalUnlock);
    }
}
