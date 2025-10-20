// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {NodeStakingManager} from "../src/node-staking/NodeStakingManager.sol";
import {INodeStakingManager} from "../src/node-staking/INodeStakingManager.sol";

/**
 * @title Fuzz Tests for NodeStakingManager
 * @notice Tests numeric edge cases and overflow scenarios
 */
contract NodeStakingFuzzTest is Test {
    NodeStakingManager public staking;
    MockERC20 public token;
    MockTokenRegistry public registry;
    MockPaymasterFactory public factory;
    MockPriceOracle public oracle;
    
    address public alice = address(0xA11CE);
    address public oracleAddr = address(0x04AC1E);
    
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
            address(this)
        );
        
        token.mint(alice, type(uint128).max);
        token.mint(address(staking), type(uint128).max);
        vm.deal(address(staking), 1000 ether);
    }
    
    function testFuzz_RegisterWithVariousAmounts(uint256 amount) public {
        vm.assume(amount > 0 && amount < type(uint128).max);
        vm.assume((amount * 1 ether) / 1e18 >= 1000 ether); // Meets min stake
        
        vm.startPrank(alice);
        token.approve(address(staking), amount);
        
        bytes32 nodeId = staking.registerNode(
            address(token),
            amount,
            address(token),
            "https://fuzz-test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        
        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId);
        assertEq(node.stakedAmount, amount);
        
        vm.stopPrank();
    }
    
    function testFuzz_UptimeMultiplier(uint256 uptimeScore) public {
        vm.assume(uptimeScore <= 10000); // Max 100%
        
        vm.startPrank(alice);
        token.approve(address(staking), 10000 ether);
        bytes32 nodeId = staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://uptime-test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        vm.stopPrank();
        
        // Update with fuzzed uptime
        vm.prank(oracleAddr);
        staking.updatePerformance(nodeId, uptimeScore, 1000000, 50);
        
        // Should not revert
        vm.warp(block.timestamp + 30 days);
        uint256 rewards = staking.calculatePendingRewards(nodeId);
        
        // Rewards should be reasonable
        assertGe(rewards, 50 ether); // At least $50 (0.5x multiplier)
        assertLe(rewards, 400 ether); // At most $400 (2x + bonuses)
    }
    
    function testFuzz_TimeElapsed(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 1 days && timeElapsed <= 365 days);
        
        vm.startPrank(alice);
        token.approve(address(staking), 10000 ether);
        bytes32 nodeId = staking.registerNode(
            address(token),
            10000 ether,
            address(token),
            "https://time-test.com",
            INodeStakingManager.Region.NorthAmerica
        );
        vm.stopPrank();
        
        // Simulate performance
        vm.prank(oracleAddr);
        staking.updatePerformance(nodeId, 10000, 1000000, 50);
        
        // Fast forward
        vm.warp(block.timestamp + timeElapsed);
        
        // Should calculate rewards proportionally
        uint256 rewards = staking.calculatePendingRewards(nodeId);
        
        // Rewards should scale with time
        uint256 expectedMin = (100 ether * timeElapsed) / 30 days;
        assertGe(rewards, expectedMin / 2); // At least half (accounting for multipliers)
    }
}

// Reuse mocks
contract MockERC20 {
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    
    string public name;
    string public symbol;
    uint8 public decimals;
    
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
        registered[token] = true;
        tokens.push(token);
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

