// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PaymasterFactory} from "../src/paymaster/PaymasterFactory.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 1e18);
    }
}

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
    
    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
    
    receive() external payable {}
}

/**
 * @title PaymasterFactory Test Suite
 * @notice Comprehensive tests for multi-token paymaster factory
 */
contract PaymasterFactoryTest is Test {
    PaymasterFactory public factory;
    TokenRegistry public registry;
    PriceOracle public oracle;
    MockEntryPoint public entryPoint;
    
    MockToken public tokenA;
    MockToken public tokenB;
    MockToken public tokenC;
    
    address owner = address(this);
    address treasury = makeAddr("treasury");
    address projectA = makeAddr("projectA");
    address projectB = makeAddr("projectB");
    address attacker = makeAddr("attacker");
    
    event PaymasterDeployed(
        address indexed token,
        address indexed operator,
        address paymaster,
        address vault,
        address distributor,
        uint256 feeMargin,
        uint256 timestamp
    );
    
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
        
        // Deploy test tokens
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        tokenC = new MockToken("Token C", "TKC");
        
        // Set prices in oracle
        oracle.setPrice(address(0), 3000 * 1e18, 18); // ETH = $3000
        oracle.setPrice(address(tokenA), 1e17, 18);   // TokenA = $0.10
        oracle.setPrice(address(tokenB), 1e18, 18);   // TokenB = $1.00
        oracle.setPrice(address(tokenC), 10 * 1e18, 18); // TokenC = $10
        
        // Fund accounts
        vm.deal(projectA, 10 ether);
        vm.deal(projectB, 10 ether);
    }
    
    // ============ Constructor Tests ============
    
    function test_Constructor_SetsCorrectAddresses() public view {
        assertEq(address(factory.registry()), address(registry));
        assertEq(address(factory.entryPoint()), address(entryPoint));
        assertEq(address(factory.oracle()), address(oracle));
    }
    
    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert("Invalid registry");
        new PaymasterFactory(address(0), address(entryPoint), address(oracle), owner);
        
        vm.expectRevert("Invalid entry point");
        new PaymasterFactory(address(registry), address(0), address(oracle), owner);
        
        vm.expectRevert("Invalid oracle");
        new PaymasterFactory(address(registry), address(entryPoint), address(0), owner);
    }
    
    // ============ Deployment Tests ============
    
    function test_DeployPaymaster_Success() public {
        // Register token first
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            0,    // 0% min
            200   // 2% max
        );
        
        // Deploy paymaster
        vm.expectEmit(true, true, false, false);
        emit PaymasterDeployed(
            address(tokenA),
            projectA,
            address(0), // We don't know addresses yet
            address(0),
            address(0),
            100,
            block.timestamp
        );
        
        vm.prank(projectA);
        (address paymaster, address vault, address distributor) = factory.deployPaymaster(
            address(tokenA),
            100,  // 1% fee
            projectA
        );
        
        // Verify addresses are non-zero
        assertTrue(paymaster != address(0));
        assertTrue(vault != address(0));
        assertTrue(distributor != address(0));
        
        // Verify contracts are actually deployed (have code)
        assertGt(paymaster.code.length, 0);
        assertGt(vault.code.length, 0);
        assertGt(distributor.code.length, 0);
    }
    
    function test_DeployPaymaster_StoresDeploymentInfo() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        (address paymaster, address vault, address distributor) = factory.deployPaymaster(
            address(tokenA),
            100,
            projectA
        );
        
        PaymasterFactory.Deployment memory deployment = factory.getDeployment(address(tokenA));
        
        assertEq(deployment.paymaster, paymaster);
        assertEq(deployment.vault, vault);
        assertEq(deployment.distributor, distributor);
        assertEq(deployment.token, address(tokenA));
        assertEq(deployment.operator, projectA);
        assertEq(deployment.feeMargin, 100);
        assertGt(deployment.deployedAt, 0);
    }
    
    function test_DeployPaymaster_ConfiguresContractsCorrectly() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        (address paymaster, address vault, address distributor) = factory.deployPaymaster(
            address(tokenA),
            100,
            projectA
        );
        
        // Verify vault is configured
        assertEq(LiquidityVault(payable(vault)).paymaster(), paymaster);
        assertEq(LiquidityVault(payable(vault)).feeDistributor(), distributor);
        
        // Verify distributor is configured
        assertEq(FeeDistributor(distributor).paymaster(), paymaster);
        
        // Verify paymaster fee margin
        assertEq(LiquidityPaymaster(payable(paymaster)).feeMargin(), 100);
    }
    
    function test_DeployPaymaster_TransfersOwnership() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        (address paymaster, address vault, address distributor) = factory.deployPaymaster(
            address(tokenA),
            100,
            projectA
        );
        
        // Paymaster uses Ownable2Step, so operator must accept ownership
        vm.prank(projectA);
        LiquidityPaymaster(payable(paymaster)).acceptOwnership();
        
        // All contracts should be owned by operator, not factory
        assertEq(LiquidityVault(payable(vault)).owner(), projectA);
        assertEq(FeeDistributor(distributor).owner(), projectA);
        assertEq(LiquidityPaymaster(payable(paymaster)).owner(), projectA);
    }
    
    function test_DeployPaymaster_IncrementsTotalDeployments() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        assertEq(factory.totalDeployments(), 0);
        
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        assertEq(factory.totalDeployments(), 1);
    }
    
    // ============ Validation Tests ============
    
    function test_RevertDeployPaymaster_TokenNotRegistered() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.TokenNotRegistered.selector, address(tokenA)));
        factory.deployPaymaster(address(tokenA), 100, projectA);
    }
    
    function test_RevertDeployPaymaster_AlreadyDeployed() public {
        // Register and deploy once
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        // Try to deploy again
        vm.prank(projectB);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.AlreadyDeployed.selector, address(tokenA)));
        factory.deployPaymaster(address(tokenA), 150, projectB);
    }
    
    function test_RevertDeployPaymaster_InvalidFeeMargin() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            100,  // min 1%
            300   // max 3%
        );
        
        // Try to deploy with fee below min
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.InvalidFeeMargin.selector, 50, 100, 300));
        factory.deployPaymaster(address(tokenA), 50, projectA);
        
        // Try to deploy with fee above max
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.InvalidFeeMargin.selector, 400, 100, 300));
        factory.deployPaymaster(address(tokenA), 400, projectA);
    }
    
    function test_RevertDeployPaymaster_InvalidOperator() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.InvalidOperator.selector, address(0)));
        factory.deployPaymaster(address(tokenA), 100, address(0));
    }
    
    function test_RevertDeployPaymaster_TokenNotActive() public {
        // Register token
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        // Deactivate token
        registry.deactivateToken(address(tokenA));
        
        // Try to deploy paymaster
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(PaymasterFactory.TokenNotRegistered.selector, address(tokenA)));
        factory.deployPaymaster(address(tokenA), 100, projectA);
    }
    
    // ============ Multi-Token Deployment Tests ============
    
    function test_DeployMultiplePaymasters_DifferentTokens() public {
        // Register 3 tokens
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0);
        
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 100, 300);
        
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 400, 500);
        
        // Deploy paymasters
        vm.prank(projectA);
        (address pmA,,) = factory.deployPaymaster(address(tokenA), 0, projectA);
        
        vm.prank(projectB);
        (address pmB,,) = factory.deployPaymaster(address(tokenB), 200, projectB);
        
        vm.prank(projectA);
        (address pmC,,) = factory.deployPaymaster(address(tokenC), 500, projectA);
        
        // Verify all deployed
        assertTrue(factory.isDeployed(address(tokenA)));
        assertTrue(factory.isDeployed(address(tokenB)));
        assertTrue(factory.isDeployed(address(tokenC)));
        
        // Verify unique addresses
        assertTrue(pmA != pmB && pmB != pmC && pmA != pmC);
        
        assertEq(factory.totalDeployments(), 3);
    }
    
    function test_DeployMultiplePaymasters_SameOperator() public {
        // Register 2 tokens
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);
        
        // Same operator deploys both
        vm.startPrank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        factory.deployPaymaster(address(tokenB), 150, projectA);
        vm.stopPrank();
        
        // Verify operator owns both
        address[] memory operatorTokens = factory.getDeploymentsByOperator(projectA);
        assertEq(operatorTokens.length, 2);
        assertEq(operatorTokens[0], address(tokenA));
        assertEq(operatorTokens[1], address(tokenB));
    }
    
    // ============ View Function Tests ============
    
    function test_GetPaymaster() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        (address paymaster,,) = factory.deployPaymaster(address(tokenA), 100, projectA);
        
        assertEq(factory.getPaymaster(address(tokenA)), paymaster);
    }
    
    function test_GetVault() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        (, address vault,) = factory.deployPaymaster(address(tokenA), 100, projectA);
        
        assertEq(factory.getVault(address(tokenA)), vault);
    }
    
    function test_GetAllDeployments() public {
        // Register and deploy 3 tokens
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);
        vm.prank(projectB);
        factory.deployPaymaster(address(tokenB), 150, projectB);
        
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 0, 200);
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenC), 50, projectA);
        
        address[] memory allTokens = factory.getAllDeployments();
        
        assertEq(allTokens.length, 3);
        assertEq(allTokens[0], address(tokenA));
        assertEq(allTokens[1], address(tokenB));
        assertEq(allTokens[2], address(tokenC));
    }
    
    function test_GetDeploymentsByOperator() public {
        // ProjectA deploys for 2 tokens
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenB), 150, projectA);
        
        // ProjectB deploys for 1 token
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 0, 200);
        vm.prank(projectB);
        factory.deployPaymaster(address(tokenC), 50, projectB);
        
        address[] memory aTokens = factory.getDeploymentsByOperator(projectA);
        address[] memory bTokens = factory.getDeploymentsByOperator(projectB);
        
        assertEq(aTokens.length, 2);
        assertEq(bTokens.length, 1);
    }
    
    function test_IsDeployed() public {
        assertFalse(factory.isDeployed(address(tokenA)));
        
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        assertTrue(factory.isDeployed(address(tokenA)));
    }
    
    function test_GetStats() public {
        // Deploy 2 paymasters
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        vm.prank(projectA);
        factory.deployPaymaster(address(tokenA), 100, projectA);
        
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);
        vm.prank(projectB);
        factory.deployPaymaster(address(tokenB), 150, projectB);
        
        (uint256 total, uint256 active) = factory.getStats();
        
        assertEq(total, 2);
        assertEq(active, 2); // Both tokens active
        
        // Deactivate one token
        registry.deactivateToken(address(tokenA));
        
        (total, active) = factory.getStats();
        assertEq(total, 2);
        assertEq(active, 1); // Only tokenB active
    }
    
    // ============ Integration Scenarios ============
    
    function test_CompleteWorkflow_RegisterDeployFund() public {
        // Give projectA enough ETH for registration + liquidity
        vm.deal(projectA, 20 ether);

        // 1. ProjectA registers their token
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            0,    // Allow 0% fees (competitive)
            200   // Max 2% fees
        );
        
        // 2. Deploy paymaster with 1% fee
        vm.prank(projectA);
        (address paymaster, address vault,) = factory.deployPaymaster(
            address(tokenA),
            100,  // 1% fee
            projectA
        );

        // 2b. Accept ownership of paymaster (2-step transfer)
        vm.prank(projectA);
        LiquidityPaymaster(payable(paymaster)).acceptOwnership();

        // 3. ProjectA adds ETH liquidity (for gas sponsorship - needs > 10 ETH minimum)
        vm.prank(projectA);
        LiquidityVault(payable(vault)).addETHLiquidity{value: 15 ether}(0);

        // 4. Verify vault has liquidity shares
        uint256 ethShares = LiquidityVault(payable(vault)).ethShares(projectA);
        assertEq(ethShares, 15 ether);

        // 5. Verify vault has available ETH (15 ETH - 10 ETH min = 5 ETH available)
        assertEq(LiquidityVault(payable(vault)).availableETH(), 5 ether);

        // 6. Fund EntryPoint from vault to make paymaster operational
        vm.prank(projectA);
        LiquidityPaymaster(payable(paymaster)).fundFromVault(1 ether);

        // 7. Verify vault now has 4 ETH available (14 total - 10 min = 4 available)
        assertEq(LiquidityVault(payable(vault)).availableETH(), 4 ether);

        // 8. Check operational status (needs EntryPoint balance + vault liquidity)
        assertTrue(LiquidityPaymaster(payable(paymaster)).isOperational());
    }
    
    function test_MultipleProjects_DifferentFeeStrategies() public {
        // ProjectA: No fees (competitive strategy)
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0);
        vm.prank(projectA);
        (address pmA,,) = factory.deployPaymaster(address(tokenA), 0, projectA);
        
        // ProjectB: 2% fees (balanced strategy)
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 100, 300);
        vm.prank(projectB);
        (address pmB,,) = factory.deployPaymaster(address(tokenB), 200, projectB);
        
        // Verify different fee margins
        assertEq(LiquidityPaymaster(payable(pmA)).feeMargin(), 0);
        assertEq(LiquidityPaymaster(payable(pmB)).feeMargin(), 200);
    }
    
    // ============ Gas Benchmarks ============
    
    function test_Gas_DeployPaymaster() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        
        vm.prank(projectA);
        uint256 gasBefore = gasleft();
        factory.deployPaymaster(address(tokenA), 100, projectA);
        uint256 gasUsed = gasBefore - gasleft();
        
        console2.log("Gas used for deployPaymaster():", gasUsed);

        // Should be expensive (deploys 3 contracts + wiring + contributor oracle config) but reasonable
        assertLt(gasUsed, 7300000); // <7.3M gas (increased for contributor features)
    }
    
    // ============ Edge Cases ============
    
    function test_DeployPaymaster_WithZeroFee() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0);
        
        vm.prank(projectA);
        (address paymaster,,) = factory.deployPaymaster(address(tokenA), 0, projectA);
        
        assertEq(LiquidityPaymaster(payable(paymaster)).feeMargin(), 0);
    }
    
    function test_DeployPaymaster_WithMaxFee() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 500, 500);
        
        vm.prank(projectA);
        (address paymaster,,) = factory.deployPaymaster(address(tokenA), 500, projectA);
        
        assertEq(LiquidityPaymaster(payable(paymaster)).feeMargin(), 500); // 5% max
    }
    
    function test_GetDeploymentsByOperator_EmptyForNewOperator() public {
        address[] memory tokens = factory.getDeploymentsByOperator(makeAddr("nobody"));
        assertEq(tokens.length, 0);
    }
    
    // ============ Version ============
    
    function test_Version() public view {
        assertEq(factory.version(), "1.0.0");
    }
}

