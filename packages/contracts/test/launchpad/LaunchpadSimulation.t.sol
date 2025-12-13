// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/launchpad/TokenLaunchpad.sol";
import "../../src/launchpad/LaunchpadToken.sol";
import "../../src/launchpad/BondingCurve.sol";
import "../../src/launchpad/ICOPresale.sol";
import "../../src/launchpad/LPLocker.sol";
import {XLPV2Factory} from "../../src/amm/v2/XLPV2Factory.sol";
import {XLPV2Pair} from "../../src/amm/v2/XLPV2Pair.sol";

contract MockWETH9 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable { deposit(); }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad);
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
    }

    function transfer(address dst, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad);
            allowance[src][msg.sender] -= wad;
        }
        require(balanceOf[src] >= wad);
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        return true;
    }

    function approve(address guy, uint256 wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        return true;
    }
}

/// @title Comprehensive Launchpad Simulation Tests
/// @notice Tests all launch modes, AMM/LP interactions, and full lifecycle flows
contract LaunchpadSimulationTest is Test {
    TokenLaunchpad public launchpad;
    XLPV2Factory public xlpFactory;
    MockWETH9 public weth;
    LPLocker public lpLockerTemplate;

    address public owner = address(0x1);
    address public creator = address(0x2);
    address public communityVault = address(0x5);
    
    // Multiple participants for realistic simulation
    address[] public buyers;
    uint256 constant NUM_BUYERS = 10;
    uint256 constant INITIAL_ETH = 100 ether;
    uint256 constant TOKEN_SUPPLY = 1_000_000_000e18;

    function setUp() public {
        // Fund owner and creator
        vm.deal(owner, INITIAL_ETH);
        vm.deal(creator, INITIAL_ETH);

        // Create and fund multiple buyers
        for (uint256 i = 0; i < NUM_BUYERS; i++) {
            address buyer = address(uint160(0x100 + i));
            buyers.push(buyer);
            vm.deal(buyer, INITIAL_ETH);
        }

        // Deploy infrastructure
        xlpFactory = new XLPV2Factory(owner);
        weth = new MockWETH9();
        lpLockerTemplate = new LPLocker(owner);

        vm.prank(owner);
        launchpad = new TokenLaunchpad(
            address(xlpFactory),
            address(weth),
            address(lpLockerTemplate),
            communityVault,
            owner
        );
    }

    // =========================================================================
    //                    BONDING CURVE FULL SIMULATION
    // =========================================================================

    function test_BondingCurveFullLifecycle() public {
        // 1. Creator launches token with bonding curve
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Pump Token",
            "PUMP",
            8000, // 80% creator fees
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 30 ether,
                graduationTarget: 10 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // 2. Multiple buyers participate
        uint256 totalBought;
        for (uint256 i = 0; i < 5; i++) {
            uint256 buyAmount = (i + 1) * 0.5 ether;
            vm.prank(buyers[i]);
            uint256 tokens = curve.buy{value: buyAmount}(0);
            totalBought += tokens;
            assertGt(IERC20(tokenAddress).balanceOf(buyers[i]), 0);
        }

        // 3. One buyer sells some tokens
        address seller = buyers[0];
        uint256 sellerBalance = IERC20(tokenAddress).balanceOf(seller);
        uint256 toSell = sellerBalance / 2;
        
        vm.startPrank(seller);
        IERC20(tokenAddress).approve(address(curve), toSell);
        uint256 ethReceived = curve.sell(toSell, 0);
        vm.stopPrank();
        
        assertGt(ethReceived, 0);

        // 4. More buying to trigger graduation
        uint256 remaining = curve.graduationTarget() - curve.realEthReserves();
        vm.prank(buyers[5]);
        curve.buy{value: remaining + 1 ether}(0);

        // 5. Verify graduation happened
        assertTrue(curve.graduated());
        address lpPair = curve.lpPair();
        assertFalse(lpPair == address(0));

        // 6. Verify LP pair has liquidity
        uint256 lpTotalSupply = IERC20(lpPair).totalSupply();
        assertGt(lpTotalSupply, 0);
    }

    function test_BondingCurveMultipleBuyers() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchBondingCurve(
            "Multi Buyer",
            "MULTI",
            5000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 20 ether,
                graduationTarget: 15 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Simulate realistic trading - each buyer buys incrementally
        uint256[] memory tokensHeld = new uint256[](NUM_BUYERS);
        
        for (uint256 round = 0; round < 3; round++) {
            for (uint256 i = 0; i < NUM_BUYERS && !curve.graduated(); i++) {
                uint256 buyAmount = 0.5 ether + (i * 0.1 ether);
                if (buyers[i].balance >= buyAmount) {
                    vm.prank(buyers[i]);
                    uint256 tokens = curve.buy{value: buyAmount}(0);
                    tokensHeld[i] += tokens;
                }
            }
        }

        // Verify all buyers got tokens
        for (uint256 i = 0; i < NUM_BUYERS; i++) {
            assertGt(tokensHeld[i], 0, "Buyer should have tokens");
        }
    }

    function test_BondingCurvePriceImpact() public {
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Price Test",
            "PRICE",
            8000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 50 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        uint256 price1 = curve.getCurrentPrice();

        // Buy 1 ETH worth
        vm.prank(buyers[0]);
        curve.buy{value: 1 ether}(0);
        uint256 price2 = curve.getCurrentPrice();
        assertGt(price2, price1, "Price should increase after buy");

        // Buy 5 ETH worth
        vm.prank(buyers[1]);
        curve.buy{value: 5 ether}(0);
        uint256 price3 = curve.getCurrentPrice();
        assertGt(price3, price2, "Price should increase more");

        // Sell should decrease price
        uint256 toSell = IERC20(tokenAddress).balanceOf(buyers[0]) / 2;
        vm.startPrank(buyers[0]);
        IERC20(tokenAddress).approve(address(curve), toSell);
        curve.sell(toSell, 0);
        vm.stopPrank();
        
        uint256 price4 = curve.getCurrentPrice();
        assertLt(price4, price3, "Price should decrease after sell");
    }

    // =========================================================================
    //                    ICO PRESALE FULL SIMULATION
    // =========================================================================

    function test_ICOPresaleFullLifecycle() public {
        // 1. Launch ICO
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchICO(
            "ICO Token",
            "ICO",
            TOKEN_SUPPLY,
            8000,
            address(0),
            TokenLaunchpad.ICOConfig({
                presaleAllocationBps: 5000, // 50%
                presalePrice: 0.000001 ether,
                lpFundingBps: 8000, // 80% to LP
                lpLockDuration: 30 days,
                buyerLockDuration: 7 days,
                softCap: 5 ether,
                hardCap: 20 ether,
                presaleDuration: 7 days
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        ICOPresale presale = ICOPresale(payable(launch.presale));

        // 2. Creator starts presale
        vm.prank(creator);
        presale.startPresale();

        // 3. Multiple buyers contribute
        for (uint256 i = 0; i < 5; i++) {
            uint256 contribution = (i + 1) * 1 ether;
            vm.prank(buyers[i]);
            presale.contribute{value: contribution}();
        }

        // Verify contributions
        (uint256 raised, uint256 participants,,,,,) = presale.getStatus();
        assertEq(raised, 15 ether); // 1+2+3+4+5 = 15
        assertEq(participants, 5);

        // 4. Wait for presale to end (need to pass presaleDuration of 7 days)
        uint256 presaleEndTime = block.timestamp + 8 days;
        vm.warp(presaleEndTime);

        // 5. Finalize - should create LP
        uint256 creatorBalanceBefore = creator.balance;
        presale.finalize();

        // Creator should receive ETH (20% of 15 ETH = 3 ETH)
        assertGt(creator.balance, creatorBalanceBefore);

        // LP pair should exist
        assertFalse(presale.lpPair() == address(0));

        // 6. Wait for buyer lock duration (7 days as configured) - need to warp PAST buyerClaimStart
        // buyerClaimStart = finalize timestamp + buyerLockDuration
        vm.warp(presaleEndTime + 8 days);

        // 7. Buyers claim tokens
        for (uint256 i = 0; i < 5; i++) {
            uint256 balanceBefore = IERC20(tokenAddress).balanceOf(buyers[i]);
            vm.prank(buyers[i]);
            presale.claim();
            assertGt(IERC20(tokenAddress).balanceOf(buyers[i]), balanceBefore);
        }
    }

    function test_ICOPresaleRefundOnFailure() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchICO(
            "Failed ICO",
            "FAIL",
            TOKEN_SUPPLY,
            8000,
            address(0),
            TokenLaunchpad.ICOConfig({
                presaleAllocationBps: 3000,
                presalePrice: 0.000001 ether,
                lpFundingBps: 8000,
                lpLockDuration: 30 days,
                buyerLockDuration: 7 days,
                softCap: 50 ether, // High soft cap
                hardCap: 100 ether,
                presaleDuration: 7 days
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        ICOPresale presale = ICOPresale(payable(launch.presale));

        vm.prank(creator);
        presale.startPresale();

        // Only 10 ETH contributed - below soft cap
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(buyers[i]);
            presale.contribute{value: 2 ether}();
        }

        // End presale
        vm.warp(block.timestamp + 8 days);
        presale.finalize();

        // Should be failed
        (,,,,,, bool isFailed) = presale.getStatus();
        assertTrue(isFailed);

        // Buyers can get refunds
        for (uint256 i = 0; i < 5; i++) {
            uint256 balanceBefore = buyers[i].balance;
            vm.prank(buyers[i]);
            presale.refund();
            assertEq(buyers[i].balance, balanceBefore + 2 ether);
        }
    }

    // =========================================================================
    //                    AMM LP TRADING SIMULATION
    // =========================================================================

    function test_PostGraduationAMMTrading() public {
        // Launch and graduate bonding curve
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "AMM Test",
            "AMM",
            8000,
            address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 5 ether,
                graduationTarget: 5 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Graduate immediately
        vm.prank(buyers[0]);
        curve.buy{value: 6 ether}(0);

        assertTrue(curve.graduated());
        address lpPairAddr = curve.lpPair();
        XLPV2Pair lpPair = XLPV2Pair(lpPairAddr);

        // Get reserves
        (uint112 reserve0, uint112 reserve1,) = lpPair.getReserves();
        assertGt(reserve0, 0);
        assertGt(reserve1, 0);

        // Verify LP tokens minted
        uint256 lpBalance = lpPair.balanceOf(address(curve));
        assertGt(lpBalance, 0);
    }

    // =========================================================================
    //                    FEE DISTRIBUTION TESTS
    // =========================================================================

    function test_FeeConfigurations() public {
        // 100% creator
        vm.prank(creator);
        (uint256 id1,) = launchpad.launchBondingCurve(
            "All Creator", "AC", 10000, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 20 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );
        TokenLaunchpad.Launch memory l1 = launchpad.getLaunch(id1);
        assertEq(l1.feeConfig.creatorFeeBps, 10000);
        assertEq(l1.feeConfig.communityFeeBps, 0);

        // 100% community
        vm.prank(creator);
        (uint256 id2,) = launchpad.launchBondingCurve(
            "All Community", "ACO", 0, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 20 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );
        TokenLaunchpad.Launch memory l2 = launchpad.getLaunch(id2);
        assertEq(l2.feeConfig.creatorFeeBps, 0);
        assertEq(l2.feeConfig.communityFeeBps, 10000);

        // 50/50 split
        vm.prank(creator);
        (uint256 id3,) = launchpad.launchBondingCurve(
            "Half Half", "HH", 5000, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 20 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );
        TokenLaunchpad.Launch memory l3 = launchpad.getLaunch(id3);
        assertEq(l3.feeConfig.creatorFeeBps, 5000);
        assertEq(l3.feeConfig.communityFeeBps, 5000);
    }

    function test_CustomCommunityVault() public {
        address customVault = address(0x999);

        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchBondingCurve(
            "Custom Vault", "CV", 5000, customVault,
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 20 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        assertEq(launch.feeConfig.communityVault, customVault);
    }

    // =========================================================================
    //                    LP LOCKER TESTS
    // =========================================================================

    function test_LPLockerWithICO() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchICO(
            "Locked ICO", "LOCK", TOKEN_SUPPLY, 8000, address(0),
            TokenLaunchpad.ICOConfig({
                presaleAllocationBps: 3000,
                presalePrice: 0.000001 ether,
                lpFundingBps: 8000,
                lpLockDuration: 60 days,
                buyerLockDuration: 14 days,
                softCap: 1 ether,
                hardCap: 10 ether,
                presaleDuration: 7 days
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        ICOPresale presale = ICOPresale(payable(launch.presale));
        LPLocker locker = LPLocker(launch.lpLocker);

        vm.prank(creator);
        presale.startPresale();

        // Contribute enough to meet soft cap
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(buyers[i]);
            presale.contribute{value: 2 ether}();
        }

        vm.warp(block.timestamp + 8 days);
        presale.finalize();

        // LP should be locked
        uint256[] memory lockIds = locker.getBeneficiaryLocks(creator);
        assertGt(lockIds.length, 0);

        LPLocker.Lock memory lockData = locker.getLock(lockIds[0]);
        assertGt(lockData.amount, 0);
        assertEq(lockData.beneficiary, creator);
        assertFalse(lockData.withdrawn);

        // Try to withdraw early - should fail
        vm.prank(creator);
        vm.expectRevert(LPLocker.LockNotExpired.selector);
        locker.withdraw(lockIds[0]);

        // Wait for lock to expire
        vm.warp(block.timestamp + 61 days);

        // Now should be able to withdraw
        vm.prank(creator);
        locker.withdraw(lockIds[0]);

        lockData = locker.getLock(lockIds[0]);
        assertTrue(lockData.withdrawn);
    }

    // =========================================================================
    //                    EDGE CASES
    // =========================================================================

    function test_MinMaxContributions() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchICO(
            "Limits Test", "LIM", TOKEN_SUPPLY, 8000, address(0),
            TokenLaunchpad.ICOConfig({
                presaleAllocationBps: 3000,
                presalePrice: 0.000001 ether,
                lpFundingBps: 8000,
                lpLockDuration: 30 days,
                buyerLockDuration: 7 days,
                softCap: 1 ether,
                hardCap: 100 ether,
                presaleDuration: 7 days
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        ICOPresale presale = ICOPresale(payable(launch.presale));

        vm.prank(creator);
        presale.startPresale();

        // Very small contribution should work
        vm.prank(buyers[0]);
        presale.contribute{value: 0.01 ether}();

        // Large contribution should work
        vm.prank(buyers[1]);
        presale.contribute{value: 50 ether}();

        (uint256 raised,,,,,,) = presale.getStatus();
        assertEq(raised, 50.01 ether);
    }

    function test_HardCapEnforced() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchICO(
            "Hard Cap", "HARD", TOKEN_SUPPLY, 8000, address(0),
            TokenLaunchpad.ICOConfig({
                presaleAllocationBps: 3000,
                presalePrice: 0.000001 ether,
                lpFundingBps: 8000,
                lpLockDuration: 30 days,
                buyerLockDuration: 7 days,
                softCap: 1 ether,
                hardCap: 10 ether,
                presaleDuration: 7 days
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        ICOPresale presale = ICOPresale(payable(launch.presale));

        vm.prank(creator);
        presale.startPresale();

        // Contribute up to hard cap
        vm.prank(buyers[0]);
        presale.contribute{value: 9 ether}();

        // Trying to exceed hard cap should revert
        vm.prank(buyers[1]);
        vm.expectRevert(ICOPresale.HardCapReached.selector);
        presale.contribute{value: 5 ether}();

        // Exact remaining should work
        vm.prank(buyers[1]);
        presale.contribute{value: 1 ether}();
    }

    function test_MultipleTokenLaunches() public {
        // Launch multiple tokens in sequence
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(creator);
            (uint256 launchId,) = launchpad.launchBondingCurve(
                string.concat("Token ", vm.toString(i)),
                string.concat("TK", vm.toString(i)),
                uint16(5000 + i * 1000),
                address(0),
                TokenLaunchpad.BondingCurveConfig({
                    virtualEthReserves: 10 ether,
                    graduationTarget: 20 ether,
                    tokenSupply: TOKEN_SUPPLY
                })
            );
            assertEq(launchId, i + 1);
        }

        assertEq(launchpad.launchCount(), 5);

        uint256[] memory creatorLaunches = launchpad.getCreatorLaunches(creator);
        assertEq(creatorLaunches.length, 5);
    }

    // =========================================================================
    //                    SLIPPAGE PROTECTION
    // =========================================================================

    function test_BuySlippageProtection() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchBondingCurve(
            "Slippage Test", "SLIP", 8000, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 50 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Get expected tokens
        uint256 expectedTokens = curve.getTokensOut(1 ether);

        // Set min higher than expected - should revert
        vm.prank(buyers[0]);
        vm.expectRevert(BondingCurve.InsufficientOutput.selector);
        curve.buy{value: 1 ether}(expectedTokens + 1);

        // Set min at expected - should work
        vm.prank(buyers[0]);
        curve.buy{value: 1 ether}(expectedTokens);
    }

    function test_SellSlippageProtection() public {
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "Slippage Test", "SLIP", 8000, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 50 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Buy tokens first
        vm.prank(buyers[0]);
        curve.buy{value: 5 ether}(0);

        uint256 tokensToSell = IERC20(tokenAddress).balanceOf(buyers[0]) / 2;
        uint256 expectedEth = curve.getEthOut(tokensToSell);

        vm.startPrank(buyers[0]);
        IERC20(tokenAddress).approve(address(curve), tokensToSell);

        // Set min higher than expected - should revert
        vm.expectRevert(BondingCurve.InsufficientOutput.selector);
        curve.sell(tokensToSell, expectedEth + 1);

        // Set min at expected - should work
        curve.sell(tokensToSell, expectedEth);
        vm.stopPrank();
    }

    // =========================================================================
    //                    CONCURRENT OPERATIONS
    // =========================================================================

    function test_ConcurrentBuysSameBlock() public {
        vm.prank(creator);
        (uint256 launchId,) = launchpad.launchBondingCurve(
            "Concurrent", "CONC", 8000, address(0),
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 20 ether,
                graduationTarget: 50 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        BondingCurve curve = BondingCurve(payable(launch.bondingCurve));
        curve.initialize();

        // Multiple buys in same block (sequential but same block.timestamp)
        for (uint256 i = 0; i < NUM_BUYERS; i++) {
            vm.prank(buyers[i]);
            curve.buy{value: 0.5 ether}(0);
        }

        // All should succeed
        (uint256 price, uint256 progress,,, bool graduated) = curve.getStats();
        assertGt(price, 0);
        assertGt(progress, 0);
        assertFalse(graduated);
    }

    // =========================================================================
    //                    GETTER FUNCTIONS
    // =========================================================================

    function test_ViewFunctions() public {
        vm.prank(creator);
        (uint256 launchId, address tokenAddress) = launchpad.launchBondingCurve(
            "View Test", "VIEW", 7500, communityVault,
            TokenLaunchpad.BondingCurveConfig({
                virtualEthReserves: 10 ether,
                graduationTarget: 20 ether,
                tokenSupply: TOKEN_SUPPLY
            })
        );

        // Test getLaunch
        TokenLaunchpad.Launch memory launch = launchpad.getLaunch(launchId);
        assertEq(launch.id, launchId);
        assertEq(launch.creator, creator);
        assertEq(launch.token, tokenAddress);

        // Test getTokenFeeConfig
        TokenLaunchpad.FeeConfig memory feeConfig = launchpad.getTokenFeeConfig(tokenAddress);
        assertEq(feeConfig.creatorFeeBps, 7500);
        assertEq(feeConfig.communityFeeBps, 2500);
        assertEq(feeConfig.communityVault, communityVault);

        // Test getCreatorLaunches
        uint256[] memory launches = launchpad.getCreatorLaunches(creator);
        assertEq(launches.length, 1);
        assertEq(launches[0], launchId);

        // Test launchCount
        assertEq(launchpad.launchCount(), 1);
    }
}
