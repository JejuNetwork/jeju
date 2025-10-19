// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {MockCLANKER} from "../src/tokens/MockCLANKER.sol";
import {MockVIRTUAL} from "../src/tokens/MockVIRTUAL.sol";
import {MockClankermon} from "../src/tokens/MockClankermon.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title MultiTokenPaymaster Test Suite
 * @notice Tests multi-token paymaster system where ETH LPs get paid in tokens
 * @dev AGGRESSIVE tests - MUST crash on bugs
 * 
 * Test Coverage:
 * - elizaOS, CLANKER, VIRTUAL, CLANKERMON paymasters
 * - ETH LPs depositing to each token's vault
 * - Users paying gas with each token
 * - Proportional fee distribution in tokens to ETH LPs
 * - LP claiming token rewards
 */
contract MultiTokenPaymasterTest is Test {
    // Mock EntryPoint
    MockEntryPoint public entryPoint;
    
    // Oracle (shared)
    ManualPriceOracle public oracle;
    
    // Tokens
    ElizaOSToken public elizaOS;
    MockCLANKER public clanker;
    MockVIRTUAL public virtualToken;
    MockClankermon public clankermon;
    
    // elizaOS System
    LiquidityVault public elizaVault;
    FeeDistributor public elizaDistributor;
    LiquidityPaymaster public elizaPaymaster;
    
    // CLANKER System
    LiquidityVault public clankerVault;
    FeeDistributor public clankerDistributor;
    LiquidityPaymaster public clankerPaymaster;
    
    // VIRTUAL System
    LiquidityVault public virtualVault;
    FeeDistributor public virtualDistributor;
    LiquidityPaymaster public virtualPaymaster;
    
    // CLANKERMON System
    LiquidityVault public clankermonVault;
    FeeDistributor public clankermonDistributor;
    LiquidityPaymaster public clankermonPaymaster;
    
    // Test accounts
    address public owner = address(this);
    address public lp1 = address(0x1);
    address public lp2 = address(0x2);
    address public lp3 = address(0x3);
    address public user = address(0x4);
    address public app = address(0x5);
    
    function setUp() public {
        // Deploy EntryPoint
        entryPoint = new MockEntryPoint();
        
        // Deploy Oracle with realistic prices
        oracle = new ManualPriceOracle(
            350000000000,  // ETH = $3500
            10000000,      // elizaOS = $0.10
            owner
        );
        
        // Deploy Tokens
        elizaOS = new ElizaOSToken(owner);
        clanker = new MockCLANKER(owner);
        virtualToken = new MockVIRTUAL(owner);
        clankermon = new MockClankermon(owner);
        
        // Deploy elizaOS System
        elizaVault = new LiquidityVault(address(elizaOS), owner);
        elizaDistributor = new FeeDistributor(address(elizaOS), address(elizaVault), owner);
        elizaPaymaster = new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(elizaOS),
            address(elizaVault),
            address(elizaDistributor),
            address(oracle)
        );
        elizaVault.setPaymaster(address(elizaPaymaster));
        elizaVault.setFeeDistributor(address(elizaDistributor));
        elizaDistributor.setPaymaster(address(elizaPaymaster));
        
        // Deploy CLANKER System
        clankerVault = new LiquidityVault(address(clanker), owner);
        clankerDistributor = new FeeDistributor(address(clanker), address(clankerVault), owner);
        clankerPaymaster = new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(clanker),
            address(clankerVault),
            address(clankerDistributor),
            address(oracle)
        );
        clankerVault.setPaymaster(address(clankerPaymaster));
        clankerVault.setFeeDistributor(address(clankerDistributor));
        clankerDistributor.setPaymaster(address(clankerPaymaster));
        
        // Deploy VIRTUAL System
        virtualVault = new LiquidityVault(address(virtualToken), owner);
        virtualDistributor = new FeeDistributor(address(virtualToken), address(virtualVault), owner);
        virtualPaymaster = new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(virtualToken),
            address(virtualVault),
            address(virtualDistributor),
            address(oracle)
        );
        virtualVault.setPaymaster(address(virtualPaymaster));
        virtualVault.setFeeDistributor(address(virtualDistributor));
        virtualDistributor.setPaymaster(address(virtualPaymaster));
        
        // Deploy CLANKERMON System
        clankermonVault = new LiquidityVault(address(clankermon), owner);
        clankermonDistributor = new FeeDistributor(address(clankermon), address(clankermonVault), owner);
        clankermonPaymaster = new LiquidityPaymaster(
            IEntryPoint(address(entryPoint)),
            address(clankermon),
            address(clankermonVault),
            address(clankermonDistributor),
            address(oracle)
        );
        clankermonVault.setPaymaster(address(clankermonPaymaster));
        clankermonVault.setFeeDistributor(address(clankermonDistributor));
        clankermonDistributor.setPaymaster(address(clankermonPaymaster));
        
        // Set oracle prices for all tokens
        oracle.updatePrices(350000000000, 10000000); // ETH + elizaOS
        oracle.setPriceUpdater(owner);
        // Note: PriceOracle.sol already supports multi-token via setPrice()
        
        // Fund LPs
        vm.deal(lp1, 1000 ether);
        vm.deal(lp2, 1000 ether);
        vm.deal(lp3, 1000 ether);
        
        // Fund user with tokens
        elizaOS.transfer(user, 100000e18);
        clanker.transfer(user, 1000e18);
        virtualToken.transfer(user, 10000e18);
        clankermon.transfer(user, 50000e18);
    }
    
    // ============ CLANKER Paymaster Tests ============
    
    function testCLANKER_ETHLPDepositsAndEarnsCLANKERFees() public {
        // LP1 deposits 10 ETH to CLANKER vault
        vm.prank(lp1);
        clankerVault.addETHLiquidity{value: 10 ether}(0);
        
        assertEq(clankerVault.ethShares(lp1), 10 ether);
        assertEq(clankerVault.totalETHLiquidity(), 10 ether);
        
        // Fund paymaster
        clankerPaymaster.fundFromVault(5 ether);
        
        // User approves CLANKER for paymaster
        uint256 tokensToSpend = 1000e18; // 1000 CLANKER
        vm.prank(user);
        clanker.approve(address(clankerPaymaster), tokensToSpend);
        
        // Simulate transaction: user pays 100 CLANKER for gas
        uint256 feeAmount = 100e18;
        vm.prank(user);
        clanker.transfer(address(clankerPaymaster), feeAmount);
        
        // Paymaster approves distributor
        vm.prank(address(clankerPaymaster));
        clanker.approve(address(clankerDistributor), feeAmount);
        
        // Distribute fees
        vm.prank(address(clankerPaymaster));
        clankerDistributor.distributeFees(feeAmount, app);
        
        // Verify: LP1 should have pending CLANKER fees
        uint256 pendingFees = clankerVault.pendingFees(lp1);
        
        // 50% to LPs, 70% of that to ETH LPs = 35 CLANKER
        assertEq(pendingFees, 35e18, "LP should have 35 CLANKER fees");
    }
    
    function testCLANKER_MultipleETHLPsGetProportionalCLANKERRewards() public {
        // LP1 deposits 10 ETH, LP2 deposits 5 ETH
        vm.prank(lp1);
        clankerVault.addETHLiquidity{value: 10 ether}(0);
        
        vm.prank(lp2);
        clankerVault.addETHLiquidity{value: 5 ether}(0);
        
        // Total: 15 ETH. LP1 has 10/15 (66.67%), LP2 has 5/15 (33.33%)
        
        // Fund paymaster and simulate fee
        clankerPaymaster.fundFromVault(5 ether);
        
        uint256 feeAmount = 150e18; // 150 CLANKER fee
        
        vm.prank(user);
        clanker.transfer(address(clankerPaymaster), feeAmount);
        
        vm.prank(address(clankerPaymaster));
        clanker.approve(address(clankerDistributor), feeAmount);
        
        vm.prank(address(clankerPaymaster));
        clankerDistributor.distributeFees(feeAmount, app);
        
        // LP portion: 75 CLANKER (50% of 150)
        // ETH LP portion: 52.5 CLANKER (70% of 75)
        // LP1 gets: 35 CLANKER (66.67% of 52.5)
        // LP2 gets: 17.5 CLANKER (33.33% of 52.5)
        
        uint256 lp1Fees = clankerVault.pendingFees(lp1);
        uint256 lp2Fees = clankerVault.pendingFees(lp2);
        
        assertApproxEqRel(lp1Fees, 35e18, 0.01e18); // Within 1%
        assertApproxEqRel(lp2Fees, 175e17, 0.01e18); // 17.5 CLANKER
    }
    
    // ============ VIRTUAL Paymaster Tests ============
    
    function testVIRTUAL_ETHLPDepositsAndEarnsVIRTUALFees() public {
        vm.prank(lp1);
        virtualVault.addETHLiquidity{value: 10 ether}(0);
        
        virtualPaymaster.fundFromVault(5 ether);
        
        uint256 feeAmount = 500e18; // 500 VIRTUAL
        vm.prank(user);
        virtualToken.transfer(address(virtualPaymaster), feeAmount);
        
        vm.prank(address(virtualPaymaster));
        virtualToken.approve(address(virtualDistributor), feeAmount);
        
        vm.prank(address(virtualPaymaster));
        virtualDistributor.distributeFees(feeAmount, app);
        
        uint256 pendingFees = virtualVault.pendingFees(lp1);
        
        // 35% of 500 = 175 VIRTUAL
        assertEq(pendingFees, 175e18);
    }
    
    // ============ CLANKERMON Paymaster Tests ============
    
    function testCLANKERMON_ETHLPDepositsAndEarnsCLANKERMONFees() public {
        vm.prank(lp1);
        clankermonVault.addETHLiquidity{value: 10 ether}(0);
        
        clankermonPaymaster.fundFromVault(5 ether);
        
        uint256 feeAmount = 10000e18; // 10000 CLANKERMON
        vm.prank(user);
        clankermon.transfer(address(clankermonPaymaster), feeAmount);
        
        vm.prank(address(clankermonPaymaster));
        clankermon.approve(address(clankermonDistributor), feeAmount);
        
        vm.prank(address(clankermonPaymaster));
        clankermonDistributor.distributeFees(feeAmount, app);
        
        uint256 pendingFees = clankermonVault.pendingFees(lp1);
        
        // 35% of 10000 = 3500 CLANKERMON
        assertEq(pendingFees, 3500e18);
    }
    
    // ============ Cross-Token Tests ============
    
    function testMultiToken_LPCanEarnDifferentTokensSimultaneously() public {
        // LP1 provides ETH to ALL vaults
        vm.startPrank(lp1);
        elizaVault.addETHLiquidity{value: 10 ether}(0);
        clankerVault.addETHLiquidity{value: 10 ether}(0);
        virtualVault.addETHLiquidity{value: 10 ether}(0);
        clankermonVault.addETHLiquidity{value: 10 ether}(0);
        vm.stopPrank();
        
        // Fund all paymasters
        elizaPaymaster.fundFromVault(5 ether);
        clankerPaymaster.fundFromVault(5 ether);
        virtualPaymaster.fundFromVault(5 ether);
        clankermonPaymaster.fundFromVault(5 ether);
        
        // Users pay gas with each token
        simulatePayment(elizaOS, address(elizaPaymaster), address(elizaDistributor), 100e18);
        simulatePayment(clanker, address(clankerPaymaster), address(clankerDistributor), 50e18);
        simulatePayment(virtualToken, address(virtualPaymaster), address(virtualDistributor), 200e18);
        simulatePayment(clankermon, address(clankermonPaymaster), address(clankermonDistributor), 5000e18);
        
        // LP1 should have pending fees in ALL tokens
        assertEq(elizaVault.pendingFees(lp1), 35e18); // 35 elizaOS
        assertEq(clankerVault.pendingFees(lp1), 175e17); // 17.5 CLANKER
        assertEq(virtualVault.pendingFees(lp1), 70e18); // 70 VIRTUAL
        assertEq(clankermonVault.pendingFees(lp1), 1750e18); // 1750 CLANKERMON
    }
    
    function testMultiToken_LPClaimsAllTokenRewards() public {
        // Setup from previous test
        vm.startPrank(lp1);
        elizaVault.addETHLiquidity{value: 10 ether}(0);
        clankerVault.addETHLiquidity{value: 10 ether}(0);
        virtualVault.addETHLiquidity{value: 10 ether}(0);
        clankermonVault.addETHLiquidity{value: 10 ether}(0);
        vm.stopPrank();
        
        elizaPaymaster.fundFromVault(5 ether);
        clankerPaymaster.fundFromVault(5 ether);
        virtualPaymaster.fundFromVault(5 ether);
        clankermonPaymaster.fundFromVault(5 ether);
        
        simulatePayment(elizaOS, address(elizaPaymaster), address(elizaDistributor), 100e18);
        simulatePayment(clanker, address(clankerPaymaster), address(clankerDistributor), 100e18);
        simulatePayment(virtualToken, address(virtualPaymaster), address(virtualDistributor), 100e18);
        simulatePayment(clankermon, address(clankermonPaymaster), address(clankermonDistributor), 10000e18);
        
        // Balances before claiming
        uint256 elizaBefore = elizaOS.balanceOf(lp1);
        uint256 clankerBefore = clanker.balanceOf(lp1);
        uint256 virtualBefore = virtualToken.balanceOf(lp1);
        uint256 clankermonBefore = clankermon.balanceOf(lp1);
        
        // Claim from all vaults
        vm.startPrank(lp1);
        elizaVault.claimFees();
        clankerVault.claimFees();
        virtualVault.claimFees();
        clankermonVault.claimFees();
        vm.stopPrank();
        
        // Verify LP1 received tokens
        assertEq(elizaOS.balanceOf(lp1), elizaBefore + 35e18);
        assertEq(clanker.balanceOf(lp1), clankerBefore + 35e18);
        assertEq(virtualToken.balanceOf(lp1), virtualBefore + 35e18);
        assertEq(clankermon.balanceOf(lp1), clankermonBefore + 3500e18);
    }
    
    // ============ Helper Functions ============
    
    function simulatePayment(
        IERC20 token,
        address paymaster,
        address distributor,
        uint256 amount
    ) internal {
        vm.prank(user);
        token.transfer(paymaster, amount);
        
        vm.prank(paymaster);
        token.approve(distributor, amount);
        
        vm.prank(paymaster);
        FeeDistributor(distributor).distributeFees(amount, app);
    }
}

// Mock EntryPoint
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
    
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
    receive() external payable {}
}
