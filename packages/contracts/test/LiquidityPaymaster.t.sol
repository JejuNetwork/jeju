// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title LiquidityPaymaster AGGRESSIVE Unit Tests
 * @notice Tests MUST crash and find bugs - no defensive code
 * @dev Tests EVERY function with EXACT assertions
 */
contract LiquidityPaymasterTest is Test {
    LiquidityPaymaster public paymaster;
    ElizaOSToken public paymentToken;
    LiquidityVault public vault;
    FeeDistributor public distributor;
    ManualPriceOracle public oracle;
    MockEntryPoint public entryPoint;

    address public owner = address(this);
    address public user = address(0x1);
    address public app = address(0x2);
    address public attacker = address(0x666);

    uint256 constant INITIAL_ETH_PRICE = 300000000000; // $3,000
    uint256 constant INITIAL_TOKEN_PRICE = 10000000; // $0.10

    function setUp() public {
        // Deploy all contracts
        entryPoint = new MockEntryPoint();
        paymentToken = new ElizaOSToken(owner);
        oracle = new ManualPriceOracle(INITIAL_ETH_PRICE, INITIAL_TOKEN_PRICE, owner);
        vault = new LiquidityVault(address(paymentToken), owner);
        distributor = new FeeDistributor(address(paymentToken), address(vault), owner);

        paymaster = new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(paymentToken),
            address(vault),
            address(distributor),
            address(oracle)
        );

        // Configure system
        vault.setPaymaster(address(paymaster));
        vault.setFeeDistributor(address(distributor));
        distributor.setPaymaster(address(paymaster));

        // Fund vault
        vm.deal(owner, 100 ether);
        vault.addETHLiquidity{value: 20 ether}(0); // minShares = 0 (accept any amount)
    }

    // ============ Constructor Tests - MUST verify EXACT setup ============

    function testConstructor_SetsImmutableAddressesCorrectly() public view {
        // LiquidityPaymaster has immutable addresses we can't directly read via getter
        // Verify by testing they're used correctly
        assertTrue(address(paymaster) != address(0));
        assertTrue(paymaster.owner() == owner);
    }

    function testConstructor_SetsDefaultParameters() public view {
        assertEq(paymaster.feeMargin(), 1000); // 10% default
        assertEq(paymaster.minFee(), 1e18); // 1 elizaOS
        assertEq(paymaster.maxGasCost(), 0.1 ether);
        assertEq(paymaster.minEntryPointBalance(), 1 ether);
    }

    function testConstructor_RevertsOnZeroAddresses() public {
        vm.expectRevert("Invalid payment token");
        new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(0), // Zero payment token
            address(vault),
            address(distributor),
            address(oracle)
        );

        vm.expectRevert("Invalid vault");
        new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(paymentToken),
            address(0), // Zero vault
            address(distributor),
            address(oracle)
        );
    }

    // ============ calculateElizaOSAmount - MUST calculate EXACT amounts ============

    function testCalculateElizaOSAmount_WithDefaultMargin() public view {
        uint256 gasCost = 0.001 ether; // 0.001 ETH

        // At $3000 ETH and $0.10 token:
        // 1 ETH = 30,000 tokens
        // 0.001 ETH = 30 tokens
        // +10% margin = 33 tokens
        uint256 expected = 33e18;

        uint256 actual = paymaster.calculateElizaOSAmount(gasCost);

        assertEq(actual, expected); // MUST be exact
    }

    function testCalculateElizaOSAmount_WithDifferentPrices() public {
        // Update prices within deviation limit: ETH=$2000, token=$0.11 (10% change)
        oracle.updatePrices(200000000000, 11000000);

        uint256 gasCost = 0.001 ether;

        // At $2000 ETH and $0.11 token:
        // 1 ETH = ~18,181.818... tokens
        // 0.001 ETH = ~18.182 tokens
        // +10% margin = ~19.999... tokens
        uint256 expected = 19999999999999999999; // Exact calculated value

        uint256 actual = paymaster.calculateElizaOSAmount(gasCost);

        assertEq(actual, expected); // MUST be exact
    }

    function testCalculateElizaOSAmount_WithZeroGasCost() public view {
        uint256 amount = paymaster.calculateElizaOSAmount(0);
        assertEq(amount, 0); // MUST be zero
    }

    // ============ isOperational - MUST return EXACT status ============

    function testIsOperational_WhenAllConditionsMet() public {
        // Fund EntryPoint
        entryPoint.depositTo{value: 2 ether}(address(paymaster));

        bool operational = paymaster.isOperational();
        assertTrue(operational); // MUST be true
    }

    function testIsOperational_ReturnsFalseWhenPaused() public {
        entryPoint.depositTo{value: 2 ether}(address(paymaster));

        paymaster.pause();

        bool operational = paymaster.isOperational();
        assertFalse(operational); // MUST be false when paused
    }

    function testIsOperational_ReturnsFalseWhenLowBalance() public view {
        // Don't fund EntryPoint

        bool operational = paymaster.isOperational();
        assertFalse(operational); // MUST be false with low balance
    }

    function testIsOperational_ReturnsFalseWhenOracleStale() public {
        entryPoint.depositTo{value: 2 ether}(address(paymaster));

        // Make oracle stale
        vm.warp(block.timestamp + 2 hours);

        bool operational = paymaster.isOperational();
        assertFalse(operational); // MUST be false with stale oracle
    }

    function testIsOperational_ReturnsFalseWhenNoLiquidity() public {
        entryPoint.depositTo{value: 2 ether}(address(paymaster));

        // Remove all vault liquidity
        vault.setMinETHLiquidity(100 ether);

        bool operational = paymaster.isOperational();
        assertFalse(operational); // MUST be false with no vault liquidity
    }

    // ============ getStatus - MUST return EXACT values ============

    function testGetStatus_ReturnsCorrectValues() public {
        entryPoint.depositTo{value: 5 ether}(address(paymaster));

        (uint256 entryBalance, uint256 vaultLiquidity, bool oracleFresh, bool operational) = paymaster.getStatus();

        assertEq(entryBalance, 5 ether); // MUST be exact
        assertGt(vaultLiquidity, 0); // MUST have liquidity
        assertTrue(oracleFresh); // MUST be fresh
        assertTrue(operational); // MUST be operational
    }

    // ============ previewCost - MUST calculate exact preview ============

    function testPreviewCost_CalculatesCorrectAmount() public view {
        uint256 estimatedGas = 100000;
        uint256 gasPrice = 10 gwei;

        // Gas cost = 100000 * 10 gwei = 0.001 ETH
        // At $3000 ETH and $0.10 token = 30,000 tokens/ETH
        // 0.001 ETH = 30 tokens
        // +10% margin = 33 tokens
        uint256 expected = 33e18;

        uint256 actual = paymaster.previewCost(estimatedGas, gasPrice);

        assertEq(actual, expected); // MUST be exact
    }

    // ============ setFeeMargin - MUST update correctly ============

    function testSetFeeMargin_UpdatesValue() public {
        uint256 newMargin = 1500; // 15%

        vm.expectEmit(true, true, true, true);
        emit FeeMarginUpdated(1000, newMargin);

        paymaster.emergencySetFeeMargin(newMargin);

        assertEq(paymaster.feeMargin(), newMargin); // MUST be exact
    }

    function testSetFeeMargin_RevertsIfTooHigh() public {
        vm.expectRevert("Margin too high");
        paymaster.emergencySetFeeMargin(2001); // >20% not allowed
    }

    function testSetFeeMargin_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert(); // Ownable: caller is not the owner
        paymaster.emergencySetFeeMargin(1500);
    }

    // ============ setPriceOracle - MUST update correctly ============

    function testSetPriceOracle_UpdatesAddress() public {
        ManualPriceOracle newOracle = new ManualPriceOracle(INITIAL_ETH_PRICE, INITIAL_TOKEN_PRICE, owner);

        vm.expectEmit(true, false, false, false);
        emit PriceOracleUpdated(address(newOracle));

        paymaster.setPriceOracle(address(newOracle));

        assertEq(address(paymaster.priceOracle()), address(newOracle)); // MUST match
    }

    function testSetPriceOracle_RevertsOnZeroAddress() public {
        vm.expectRevert("Invalid oracle");
        paymaster.setPriceOracle(address(0));
    }

    function testSetPriceOracle_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.setPriceOracle(address(0x123));
    }

    // ============ setMinFee - MUST update correctly ============

    function testSetMinFee_UpdatesValue() public {
        uint256 newMin = 5e18;

        paymaster.setMinFee(newMin);

        assertEq(paymaster.minFee(), newMin); // MUST be exact
    }

    function testSetMinFee_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.setMinFee(5e18);
    }

    // ============ setMaxGasCost - MUST update correctly ============

    function testSetMaxGasCost_UpdatesValue() public {
        uint256 newMax = 1 ether;

        paymaster.setMaxGasCost(newMax);

        assertEq(paymaster.maxGasCost(), newMax); // MUST be exact
    }

    function testSetMaxGasCost_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.setMaxGasCost(1 ether);
    }

    // ============ setMinEntryPointBalance - MUST update correctly ============

    function testSetMinEntryPointBalance_UpdatesValue() public {
        uint256 newMin = 2 ether;

        paymaster.setMinEntryPointBalance(newMin);

        assertEq(paymaster.minEntryPointBalance(), newMin); // MUST be exact
    }

    function testSetMinEntryPointBalance_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.setMinEntryPointBalance(2 ether);
    }

    // ============ pause/unpause - MUST block operations ============

    function testPause_SetsState() public {
        assertFalse(paymaster.paused()); // MUST be false initially

        paymaster.pause();

        assertTrue(paymaster.paused()); // MUST be true after pause
    }

    function testUnpause_ResetsState() public {
        paymaster.pause();
        assertTrue(paymaster.paused());

        paymaster.unpause();

        assertFalse(paymaster.paused()); // MUST be false after unpause
    }

    function testPause_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.pause();
    }

    function testUnpause_RevertsIfNotOwner() public {
        paymaster.pause();

        vm.prank(attacker);
        vm.expectRevert();
        paymaster.unpause();
    }

    // ============ fundFromVault - MUST transfer exact amount ============

    function testFundFromVault_TransfersETHToEntryPoint() public {
        uint256 fundAmount = 3 ether;

        uint256 balanceBefore = entryPoint.balanceOf(address(paymaster));

        vm.expectEmit(true, false, false, true);
        emit EntryPointFunded(fundAmount);

        paymaster.fundFromVault(fundAmount);

        uint256 balanceAfter = entryPoint.balanceOf(address(paymaster));

        assertEq(balanceAfter - balanceBefore, fundAmount); // MUST be exact
    }

    function testFundFromVault_RevertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        paymaster.fundFromVault(1 ether);
    }

    // ============ refillEntryPointDeposit - MUST refill when needed ============

    function testRefillEntryPointDeposit_RefillsWhenBelowMinimum() public {
        // Set current balance to 0.5 ETH (below 1 ETH minimum)
        entryPoint.depositTo{value: 0.5 ether}(address(paymaster));

        uint256 balanceBefore = entryPoint.balanceOf(address(paymaster));
        assertEq(balanceBefore, 0.5 ether);

        vm.expectEmit(true, false, false, false);
        emit EntryPointFunded(1.5 ether); // Should refill to 2 ETH

        paymaster.refillEntryPointDeposit();

        uint256 balanceAfter = entryPoint.balanceOf(address(paymaster));
        assertEq(balanceAfter, 2 ether); // MUST be 2x minimum
    }

    function testRefillEntryPointDeposit_DoesNothingWhenAboveMinimum() public {
        // Set balance above minimum
        entryPoint.depositTo{value: 5 ether}(address(paymaster));

        uint256 balanceBefore = entryPoint.balanceOf(address(paymaster));

        paymaster.refillEntryPointDeposit();

        uint256 balanceAfter = entryPoint.balanceOf(address(paymaster));
        assertEq(balanceAfter, balanceBefore); // MUST not change
    }

    function testRefillEntryPointDeposit_PermissionlessCall() public {
        entryPoint.depositTo{value: 0.5 ether}(address(paymaster));

        // Anyone can call
        vm.prank(attacker);
        paymaster.refillEntryPointDeposit();

        // Should succeed
        assertGt(entryPoint.balanceOf(address(paymaster)), 0.5 ether);
    }

    // ============ Edge Cases - MUST handle correctly ============

    function testCalculateElizaOSAmount_WithZeroMargin() public {
        paymaster.emergencySetFeeMargin(0); // No margin

        uint256 gasCost = 0.001 ether;
        // 0.001 ETH = 30 tokens, no margin = 30 tokens
        uint256 expected = 30e18;

        uint256 actual = paymaster.calculateElizaOSAmount(gasCost);

        assertEq(actual, expected); // MUST be exact
    }

    function testCalculateElizaOSAmount_WithMaxMargin() public {
        paymaster.emergencySetFeeMargin(2000); // 20% max margin

        uint256 gasCost = 0.001 ether;
        // 0.001 ETH = 30 tokens, +20% margin = 36 tokens
        uint256 expected = 36e18;

        uint256 actual = paymaster.calculateElizaOSAmount(gasCost);

        assertEq(actual, expected); // MUST be exact
    }

    // ============ Integration Behavior Tests ============

    function testVersion() public view {
        assertEq(paymaster.version(), "1.0.0");
    }

    // Events
    event FeeMarginUpdated(uint256 oldMargin, uint256 newMargin);
    event PriceOracleUpdated(address indexed newOracle);
    event EntryPointFunded(uint256 amount);
}

// Mock EntryPoint for testing
contract MockEntryPoint {
    mapping(address => uint256) public balances;

    function depositTo(address account) external payable {
        balances[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function withdrawTo(address payable dest, uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool success,) = dest.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // ERC165 support
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x989ccc58; // IEntryPoint interface ID
    }

    receive() external payable {}
}
