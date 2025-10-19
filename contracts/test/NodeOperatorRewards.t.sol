// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/node-staking/NodeStakingManager.sol";
import "../src/node-staking/INodeStakingManager.sol";
import "../src/tokens/ElizaOSToken.sol";

/**
 * @title NodeStakingManager Test Suite
 * @notice Comprehensive tests for multi-token node staking system
 */
contract NodeStakingManagerTest is Test {
    NodeStakingManager public staking;
    ElizaOSToken public elizaToken;
    ElizaOSToken public usdcToken;
    
    MockTokenRegistry public tokenRegistry;
    MockPaymasterFactory public paymasterFactory;
    MockPriceOracle public priceOracle;
    
    address public owner = address(this);
    address public oracle = address(0x1);
    address public operator1 = address(0x2);
    address public operator2 = address(0x3);
    
    bytes32 public nodeId1;
    bytes32 public nodeId2;
    
    function setUp() public {
        // Deploy tokens
        elizaToken = new ElizaOSToken(owner);
        usdcToken = new ElizaOSToken(owner);
        
        // Deploy mocks
        tokenRegistry = new MockTokenRegistry();
        paymasterFactory = new MockPaymasterFactory();
        priceOracle = new MockPriceOracle();
        
        // Register tokens
        tokenRegistry.register(address(elizaToken));
        tokenRegistry.register(address(usdcToken));
        
        // Setup paymasters
        paymasterFactory.setPaymaster(address(elizaToken), address(0x100));
        paymasterFactory.setPaymaster(address(usdcToken), address(0x101));
        
        // Set prices: ELIZA = $1, USDC = $1
        priceOracle.setPrice(address(elizaToken), 1e18);
        priceOracle.setPrice(address(usdcToken), 1e18);
        priceOracle.setPrice(address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2), 3000e18); // ETH = $3000
        
        // Deploy staking manager
        staking = new NodeStakingManager(
            address(tokenRegistry),
            address(paymasterFactory),
            address(priceOracle),
            oracle,
            owner
        );
        
        // Mint tokens to operators
        elizaToken.mint(operator1, 10000 ether);
        elizaToken.mint(operator2, 10000 ether);
        usdcToken.mint(operator1, 10000 ether);
        usdcToken.mint(operator2, 10000 ether);
        
        // Fund staking contract with ETH and reward tokens
        vm.deal(address(staking), 100 ether);
        elizaToken.mint(address(staking), 1_000_000 ether);
        usdcToken.mint(address(staking), 1_000_000 ether);
    }
    
    // ============ Registration Tests ============
    
    function testRegisterNode() public {
        vm.startPrank(operator1);
        
        // Approve tokens
        elizaToken.approve(address(staking), 1000 ether);
        
        // Register node (stake ELIZA, earn ELIZA)
        nodeId1 = staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
        
        // Verify registration
        (
            INodeStakingManager.NodeStake memory node,
            INodeStakingManager.PerformanceMetrics memory perf,
        ) = staking.getNodeInfo(nodeId1);
        
        assertEq(node.operator, operator1);
        assertEq(node.rpcUrl, "https://node1.example.com:8545");
        assertEq(node.stakedToken, address(elizaToken));
        assertEq(node.stakedAmount, 1000 ether);
        assertEq(node.rewardToken, address(elizaToken));
        assertTrue(node.isActive);
        assertFalse(node.isSlashed);
        assertEq(uint256(node.geographicRegion), uint256(INodeStakingManager.Region.NorthAmerica));
        assertEq(perf.uptimeScore, 10000); // Starts at 100%
    }
    
    function testRegisterNodeMultiToken() public {
        vm.startPrank(operator1);
        
        // Stake USDC, earn ELIZA
        usdcToken.approve(address(staking), 1000 ether);
        
        nodeId1 = staking.registerNode(
            address(usdcToken),   // Stake USDC
            1000 ether,
            address(elizaToken),  // Earn ELIZA
            "https://node1.example.com:8545",
            INodeStakingManager.Region.Asia
        );
        
        vm.stopPrank();
        
        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId1);
        
        assertEq(node.stakedToken, address(usdcToken));
        assertEq(node.rewardToken, address(elizaToken));
    }
    
    function testRegisterNodeInsufficientStake() public {
        vm.startPrank(operator1);
        
        elizaToken.approve(address(staking), 500 ether);
        
        // Should fail - need $1000 USD minimum
        vm.expectRevert();
        staking.registerNode(
            address(elizaToken),
            500 ether, // Only $500
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
    }
    
    // ============ Performance Update Tests ============
    
    function testUpdatePerformance() public {
        // Setup: Register a node
        vm.prank(operator1);
        elizaToken.approve(address(staking), 1000 ether);
        
        vm.prank(operator1);
        nodeId1 = staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        // Update performance as oracle
        vm.prank(oracle);
        staking.updatePerformance(
            nodeId1,
            9950, // 99.50% uptime
            1000000, // 1M requests
            50 // 50ms avg response
        );
        
        // Verify update
        (, INodeStakingManager.PerformanceMetrics memory perf,) = staking.getNodeInfo(nodeId1);
        
        // EWMA: 80% old (10000) + 20% new (9950) = 9990
        assertEq(perf.uptimeScore, 9990);
        assertEq(perf.requestsServed, 1000000);
        assertEq(perf.avgResponseTime, 50);
    }
    
    // ============ Reward Claiming Tests ============
    
    function testClaimRewardsSingleToken() public {
        vm.prank(operator1);
        elizaToken.approve(address(staking), 1000 ether);
        
        vm.prank(operator1);
        nodeId1 = staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        // Fast forward past minimum staking period (7 days)
        vm.warp(block.timestamp + 7 days + 1);
        
        // Update performance
        vm.prank(oracle);
        staking.updatePerformance(nodeId1, 9950, 1000000, 50);
        
        uint256 balanceBefore = elizaToken.balanceOf(operator1);
        uint256 pending = staking.calculatePendingRewards(nodeId1);
        
        // Claim rewards
        vm.prank(operator1);
        staking.claimRewards(nodeId1);
        
        uint256 balanceAfter = elizaToken.balanceOf(operator1);
        
        // Verify tokens received (convert from USD)
        assertGt(balanceAfter, balanceBefore);
    }
    
    function testClaimRewardsMultiToken() public {
        vm.prank(operator1);
        usdcToken.approve(address(staking), 1000 ether);
        
        vm.prank(operator1);
        nodeId1 = staking.registerNode(
            address(usdcToken),   // Stake USDC
            1000 ether,
            address(elizaToken),  // Earn ELIZA
            "https://node1.example.com:8545",
            INodeStakingManager.Region.Asia
        );
        
        // Fast forward
        vm.warp(block.timestamp + 7 days + 1);
        
        vm.prank(oracle);
        staking.updatePerformance(nodeId1, 9900, 500000, 100);
        
        uint256 elizaBalanceBefore = elizaToken.balanceOf(operator1);
        
        // Claim rewards
        vm.prank(operator1);
        staking.claimRewards(nodeId1);
        
        uint256 elizaBalanceAfter = elizaToken.balanceOf(operator1);
        
        // Should receive ELIZA (not USDC)
        assertGt(elizaBalanceAfter, elizaBalanceBefore);
    }
    
    // ============ Deregistration Tests ============
    
    function testDeregisterNode() public {
        vm.prank(operator1);
        elizaToken.approve(address(staking), 1000 ether);
        
        vm.prank(operator1);
        nodeId1 = staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        // Fast forward past minimum period
        vm.warp(block.timestamp + 7 days + 1);
        
        uint256 balanceBefore = elizaToken.balanceOf(operator1);
        
        // Deregister
        vm.prank(operator1);
        staking.deregisterNode(nodeId1);
        
        uint256 balanceAfter = elizaToken.balanceOf(operator1);
        
        // Verify stake returned
        assertEq(balanceAfter - balanceBefore, 1000 ether);
        
        // Verify node is inactive
        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId1);
        assertFalse(node.isActive);
    }
    
    // ============ Slashing Tests ============
    
    function testSlashNode() public {
        vm.prank(operator1);
        elizaToken.approve(address(staking), 1000 ether);
        
        vm.prank(operator1);
        nodeId1 = staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        uint256 ownerBalanceBefore = elizaToken.balanceOf(owner);
        
        // Slash 50%
        vm.prank(owner);
        staking.slashNode(nodeId1, 5000, "Extended downtime");
        
        uint256 ownerBalanceAfter = elizaToken.balanceOf(owner);
        
        // Verify slash amount transferred to owner
        assertEq(ownerBalanceAfter - ownerBalanceBefore, 500 ether);
        
        // Verify node status
        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId1);
        assertEq(node.stakedAmount, 500 ether);
        assertTrue(node.isSlashed);
        assertFalse(node.isActive);
    }
    
    // ============ View Function Tests ============
    
    function testGetNetworkStats() public {
        // Register multiple nodes
        vm.startPrank(operator1);
        elizaToken.approve(address(staking), 2000 ether);
        
        staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node1.example.com:8545",
            INodeStakingManager.Region.NorthAmerica
        );
        
        staking.registerNode(
            address(elizaToken),
            1000 ether,
            address(elizaToken),
            "https://node2.example.com:8545",
            INodeStakingManager.Region.Europe
        );
        vm.stopPrank();
        
        (uint256 totalNodes, uint256 totalStaked, uint256 totalRewards) = staking.getNetworkStats();
        
        assertEq(totalNodes, 2);
        assertEq(totalStaked, 2000 ether); // $2000 USD
        assertEq(totalRewards, 0); // No rewards claimed yet
    }
}

// ============ Mock Contracts ============

contract MockTokenRegistry {
    mapping(address => bool) public registered;
    
    function register(address token) external {
        registered[token] = true;
    }
    
    function isRegistered(address token) external view returns (bool) {
        return registered[token];
    }
}

contract MockPaymasterFactory {
    mapping(address => address) public paymasters;
    
    function setPaymaster(address token, address paymaster) external {
        paymasters[token] = paymaster;
    }
    
    function hasPaymaster(address token) external view returns (bool) {
        return paymasters[token] != address(0);
    }
    
    function getPaymaster(address token) external view returns (address) {
        return paymasters[token];
    }
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
