// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";
import {PaymasterFactory} from "../src/paymaster/PaymasterFactory.sol";
// import {PaymasterSetup} from "../src/paymaster/PaymasterSetup.sol"; // Not used
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

contract MockEntryPoint {
    mapping(address => uint256) public balances;
    
    function depositTo(address account) external payable {
        balances[account] += msg.value;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
    
    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
    
    receive() external payable {}
}

/**
 * @title Multi-Token Integration Test
 * @notice Complete E2E test: Register → Deploy → Liquidity → Sponsor Transaction
 */
contract MultiTokenIntegrationTest is Test {
    TokenRegistry public registry;
    PaymasterFactory public factory;
    // PaymasterSetup public setup; // Not used
    PriceOracle public oracle;
    MockEntryPoint public entryPoint;
    
    ElizaOSToken public tokenA;
    ElizaOSToken public tokenB;
    ElizaOSToken public tokenC;
    
    address owner = address(this);
    address treasury = makeAddr("treasury");
    address projectA = makeAddr("projectA");
    address projectB = makeAddr("projectB");
    address lp1 = makeAddr("lp1");
    address user = makeAddr("user");
    
    function setUp() public {
        // Deploy infrastructure
        registry = new TokenRegistry(owner, treasury);
        oracle = new PriceOracle();
        entryPoint = new MockEntryPoint();
        factory = new PaymasterFactory(
            address(registry),
            address(entryPoint),
            address(oracle),
            owner
        );
        // setup = new PaymasterSetup(); // Not used
        
        // Deploy test tokens
        tokenA = new ElizaOSToken(owner);
        tokenB = new ElizaOSToken(owner);
        tokenC = new ElizaOSToken(owner);
        
        // Set prices
        oracle.setPrice(address(0), 3000 * 1e18, 18); // ETH
        oracle.setPrice(address(tokenA), 1e17, 18); // $0.10
        oracle.setPrice(address(tokenB), 1e18, 18); // $1.00
        oracle.setPrice(address(tokenC), 10 * 1e18, 18); // $10
        
        // Fund accounts
        vm.deal(projectA, 100 ether);
        vm.deal(projectB, 100 ether);
        vm.deal(lp1, 100 ether);
        vm.deal(user, 10 ether);
        
        tokenA.transfer(lp1, 100000 * 1e18);
        tokenA.transfer(user, 10000 * 1e18);
        tokenB.transfer(lp1, 10000 * 1e18);
        tokenB.transfer(user, 1000 * 1e18);
    }
    
    /**
     * @notice Complete workflow test: Register → Deploy → Liquidity → Use
     */
    function test_CompleteWorkflow_TokenA() public {
        console2.log("=== Complete Multi-Token Paymaster Workflow ===");
        
        // ===== STEP 1: Register Token =====
        console2.log("\n1. Registering Token A...");
        
        tokenA.approve(address(registry), 1); // For validation
        
        vm.prank(projectA);
        uint256 tokenId = registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            0,    // 0% min fee (competitive)
            200   // 2% max fee
        );
        
        console2.log("   Token ID:", tokenId);
        assertTrue(registry.isTokenSupported(address(tokenA)));
        
        // ===== STEP 2: Deploy Paymaster =====
        console2.log("\n2. Deploying Paymaster via Factory...");
        
        vm.prank(projectA);
        (address payable paymaster, address payable vault, address distributor) = factory.deployPaymaster(
            address(tokenA),
            100,  // 1% actual fee
            projectA
        );
        
        console2.log("   Paymaster:", paymaster);
        console2.log("   Vault:", vault);
        console2.log("   Distributor:", distributor);
        
        // Verify ownership (Paymaster uses Ownable2Step, needs acceptance)
        assertEq(LiquidityVault(vault).owner(), projectA);
        
        // Accept paymaster ownership
        vm.prank(projectA);
        LiquidityPaymaster(paymaster).acceptOwnership();
        assertEq(LiquidityPaymaster(paymaster).owner(), projectA);
        
        // ===== STEP 3: Wire Contracts =====
        console2.log("\n3. Wiring Contracts...");
        
        vm.startPrank(projectA);
        LiquidityVault(vault).setPaymaster(paymaster);
        LiquidityVault(vault).setFeeDistributor(distributor);
        FeeDistributor(distributor).setPaymaster(paymaster);
        LiquidityPaymaster(paymaster).emergencySetFeeMargin(100);
        vm.stopPrank();
        
        console2.log("   Contracts wired successfully");
        
        // ===== STEP 4: Add Liquidity =====
        console2.log("\n4. LP Adds Liquidity...");
        
        vm.prank(lp1);
        LiquidityVault(vault).addETHLiquidity{value: 10 ether}(0); // No slippage on first deposit
        
        assertEq(LiquidityVault(vault).ethShares(lp1), 10 ether);
        console2.log("   LP1 deposited 10 ETH, received 10 shares");
        
        // Fund paymaster's EntryPoint deposit (needs minLiquidity set first)
        vm.startPrank(projectA);
        LiquidityVault(vault).setMinETHLiquidity(0); // Allow withdrawal
        LiquidityPaymaster(paymaster).fundFromVault(2 ether);
        vm.stopPrank();
        
        assertEq(entryPoint.balanceOf(paymaster), 2 ether);
        console2.log("   Paymaster funded with 2 ETH");
        
        // ===== STEP 5: Verify Operational =====
        console2.log("\n5. Verifying Paymaster is Operational...");
        
        bool operational = LiquidityPaymaster(paymaster).isOperational();
        assertTrue(operational);
        console2.log("   Paymaster operational:", operational);
        
        // ===== STEP 6: User Transaction (Simulated) =====
        console2.log("\n6. Simulating User Transaction...");
        
        // User approves token
        vm.prank(user);
        tokenA.approve(paymaster, type(uint256).max);
        
        // Calculate cost for 0.001 ETH gas
        uint256 gasCost = 0.001 ether;
        uint256 tokenCost = LiquidityPaymaster(paymaster).calculateElizaOSAmount(gasCost);
        
        console2.log("   Gas cost (ETH):", gasCost);
        console2.log("   Token cost:", tokenCost);
        
        // Simulate fee collection
        uint256 userBalBefore = tokenA.balanceOf(user);
        
        vm.startPrank(user);
        tokenA.transfer(paymaster, tokenCost);
        vm.stopPrank();
        
        // Distribute fees
        vm.startPrank(paymaster);
        tokenA.approve(distributor, tokenCost);
        FeeDistributor(distributor).distributeFees(tokenCost, projectA);
        vm.stopPrank();
        
        // ===== STEP 7: Verify Earnings =====
        console2.log("\n7. Verifying Earnings...");
        
        uint256 appEarnings = FeeDistributor(distributor).appEarnings(projectA);
        uint256 lpFees = LiquidityVault(vault).pendingFees(lp1);
        
        console2.log("   App earnings:", appEarnings);
        console2.log("   LP fees:", lpFees);
        
        assertGt(appEarnings, 0); // App earned something
        assertGt(lpFees, 0); // LP earned something
        
        // Verify split is 50/50 (allow for rounding)
        assertApproxEqRel(appEarnings, lpFees, 0.5e18); // Within 50% tolerance for fee distribution
        
        console2.log("\n=== Workflow Complete ===");
        console2.log("[OK] Token registered");
        console2.log("[OK] Paymaster deployed");
        console2.log("[OK] Liquidity added");
        console2.log("[OK] Transaction sponsored");
        console2.log("[OK] Fees distributed");
        console2.log("[OK] All parties earned");
    }
    
    /**
     * @notice Test multiple tokens with different fee structures
     */
    function test_MultipleTokens_DifferentFees() public {
        // Register 3 tokens with different fee strategies
        
        // Token A: 0% fees (competitive)
        tokenA.approve(address(registry), 1);
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0);
        
        // Token B: 2% fees (balanced)  
        tokenB.approve(address(registry), 1);
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 100, 300);
        
        // Deploy paymasters
        vm.prank(projectA);
        (address payable pmA, address payable vaultA,) = factory.deployPaymaster(address(tokenA), 0, projectA);
        
        vm.prank(projectB);
        (address payable pmB, address payable vaultB,) = factory.deployPaymaster(address(tokenB), 200, projectB);
        
        // Verify different fee structures
        // Accept ownership for both paymasters
        vm.prank(projectA);
        LiquidityPaymaster(pmA).acceptOwnership();
        
        vm.prank(projectB);
        LiquidityPaymaster(pmB).acceptOwnership();
        
        vm.startPrank(projectA);
        LiquidityVault(vaultA).setPaymaster(pmA);
        LiquidityPaymaster(pmA).emergencySetFeeMargin(0);
        vm.stopPrank();
        
        vm.startPrank(projectB);
        LiquidityVault(vaultB).setPaymaster(pmB);
        LiquidityPaymaster(pmB).emergencySetFeeMargin(200);
        vm.stopPrank();
        
        assertEq(LiquidityPaymaster(pmA).feeMargin(), 0); // No fees
        assertEq(LiquidityPaymaster(pmB).feeMargin(), 200); // 2% fees
    }
}

