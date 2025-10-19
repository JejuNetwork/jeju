// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {NodeStakingManager} from "../src/node-staking/NodeStakingManager.sol";
import {INodeStakingManager} from "../src/node-staking/INodeStakingManager.sol";

/**
 * @title Edge Case Tests
 * @notice Tests for division by zero, first stake, oracle failures, etc.
 */
contract NodeStakingEdgeCasesTest is Test {
    NodeStakingManager public staking;
    MockERC20 public token;
    MockTokenRegistry public registry;
    MockPaymasterFactory public factory;
    MockPriceOracle public oracle;
    
    address public alice = address(0xA11CE);
    address public oracleAddr = address(0x04AC1E);
    address public owner = address(this);
    
    function setUp() public {
        token = new MockERC20("TEST", "TEST", 18);
        registry = new MockTokenRegistry();
        factory = new MockPaymasterFactory();
        oracle = new MockPriceOracle();
        
        registry.register(address(token));
        factory.setPaymaster(address(token), address(0xF4ED));
        oracle.setPrice(address(token), 1 ether);
        
        staking = new NodeStakingManager(
            address(registry),
            address(factory),
            address(oracle),
            oracleAddr,
            owner
        );
        
        token.mint(alice, 100000 ether);
        token.mint(address(staking), 1000000 ether);
        vm.deal(address(staking), 100 ether);
    }
    
    function testFirstStakeWithZeroTotalStaked() public {
        // First registration when totalStakedUSD = 0
        vm.startPrank(alice);
        
        token.approve(address(staking), 10000 ether);
        
        // Should not revert on division by zero
        bytes32 nodeId = staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://first-node.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId);
        assertTrue(node.isActive);
        
        vm.stopPrank();
    }
    
    function testDiversityBonusWithZeroTotalStaked() public {
        // Enable diversity bonus with no stakes
        vm.prank(owner);
        staking.enableTokenDiversityBonus(true);
        
        vm.startPrank(alice);
        token.approve(address(staking), 10000 ether);
        
        // Should not revert even with diversity bonus enabled
        bytes32 nodeId = staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://test.com",
            INodeStakingManager.Region.Asia
        );
        
        // Should calculate rewards without division by zero
        vm.warp(block.timestamp + 30 days);
        uint256 rewards = staking.calculatePendingRewards(nodeId);
        assertGt(rewards, 0);
        
        vm.stopPrank();
    }
    
    function testOracleReturnsZeroPrice() public {
        vm.startPrank(alice);
        
        token.approve(address(staking), 10000 ether);
        
        // Set price to zero
        oracle.setPrice(address(token), 0);
        
        // Should revert with proper error
        vm.expectRevert();
        staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
    }
    
    function testZeroStakeAmount() public {
        vm.startPrank(alice);
        token.approve(address(staking), 0);
        
        vm.expectRevert();
        staking.registerNode(
            address(token),
            0, // Zero amount
            address(token),
            "https://test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
    }
    
    function testZeroAddressToken() public {
        vm.startPrank(alice);
        
        vm.expectRevert();
        staking.registerNode(
            address(0), // Zero address
            10000 ether,
            address(token),
            "https://test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
    }
    
    function testInternalClaimPaysFees() public {
        vm.startPrank(alice);
        
        token.approve(address(staking), 10000 ether);
        bytes32 nodeId = staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        vm.stopPrank();
        
        // Simulate time + performance
        vm.warp(block.timestamp + 30 days);
        vm.prank(oracleAddr);
        staking.updatePerformance(nodeId, 10000, 1000000, 50);
        
        // Deregister (calls internal claim)
        address paymaster = factory.getPaymaster(address(token));
        uint256 paymasterBalBefore = paymaster.balance;
        
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        staking.deregisterNode(nodeId);
        
        uint256 paymasterBalAfter = paymaster.balance;
        
        // Paymaster should have received ETH from internal claim
        assertGt(paymasterBalAfter, paymasterBalBefore, "Paymaster should receive fees from internal claim");
    }
    
    function testGetNetworkStatsNoDOS() public {
        // Register many nodes
        for (uint i = 0; i < 50; i++) {
            token.mint(address(uint160(0x1000 + i)), 100000 ether);
            vm.startPrank(address(uint160(0x1000 + i)));
            token.approve(address(staking), 10000 ether);
            staking.registerNode(
                address(token),
                10000 ether,
                address(token),
                string(abi.encodePacked("https://node-", vm.toString(i), ".com")),
                INodeStakingManager.Region.NorthAmerica
            );
            vm.stopPrank();
        }
        
        // Should not run out of gas
        (uint256 totalNodes,,) = staking.getNetworkStats();
        assertEq(totalNodes, 50);
    }
}

// Mock contracts (reuse from main test file)
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowances[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract MockTokenRegistry {
    mapping(address => bool) public registered;
    address[] public tokens;
    
    function register(address token) external {
        if (!registered[token]) {
            registered[token] = true;
            tokens.push(token);
        }
    }
    
    function isRegistered(address token) external view returns (bool) {
        return registered[token];
    }
    
    function getAllTokens() external view returns (address[] memory) {
        return tokens;
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

