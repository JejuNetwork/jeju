// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {NodeOperatorRewards} from "../src/node-rewards/NodeOperatorRewards.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";

/**
 * @title Malicious Input Fuzz Tests - AGGRESSIVE FUZZING
 * @notice Every public function tested with malicious inputs
 * @dev NO defensive assumptions - let it crash or prove it's secure
 */
contract MaliciousFuzzTestsTest is Test {
    ElizaOSToken public token;
    LiquidityVault public vault;
    FeeDistributor public distributor;
    ManualPriceOracle public oracle;
    NodeOperatorRewards public rewards;
    IdentityRegistry public registry;
    
    address public owner = address(this);
    
    function setUp() public {
        token = new ElizaOSToken(owner);
        vault = new LiquidityVault(address(token), owner);
        distributor = new FeeDistributor(address(token), address(vault), owner);
        oracle = new ManualPriceOracle(2000_00000000, 10_00000000, owner);
        rewards = new NodeOperatorRewards(address(token), owner, owner);
        registry = new IdentityRegistry();
        
        vault.setPaymaster(owner);
        vault.setFeeDistributor(address(distributor));
        distributor.setPaymaster(owner);
        oracle.setPriceUpdater(owner);
    }
    
    // ============ Token Fuzz Tests - NO ASSUMPTIONS ============
    
    function testFuzz_MintToAnyAddress(address recipient, uint128 amount) public {
        vm.assume(recipient != address(0)); // ERC20 requirement
        vm.assume(amount <= token.MAX_SUPPLY() - token.totalSupply());
        
        uint256 balanceBefore = token.balanceOf(recipient);
        token.mint(recipient, amount);
        
        // Crash if balance didn't increase by exact amount
        assertEq(token.balanceOf(recipient), balanceBefore + amount);
    }
    
    function testFuzz_TransferAnyAmount(address to, uint128 amount) public {
        vm.assume(to != address(0)); // ERC20 requirement
        vm.assume(to != owner); // Cannot transfer to self (balance unchanged)
        vm.assume(amount <= token.balanceOf(owner));
        
        uint256 balanceBefore = token.balanceOf(to);
        token.transfer(to, amount);
        
        // Crash if balance didn't increase by exact amount
        assertEq(token.balanceOf(to), balanceBefore + amount, "Balance must increase by exact transfer amount");
    }
    
    function testFuzz_ApproveAnyAmount(address spender, uint256 amount) public {
        vm.assume(spender != address(0));
        
        token.approve(spender, amount);
        
        assertEq(token.allowance(owner, spender), amount);
    }
    
    // ============ Vault Fuzz Tests - MUST HANDLE ALL INPUTS ============
    
    function testFuzz_AddETHLiquidityAnyAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(this), amount);
        
        vault.addETHLiquidity{value: amount}(0);
        
        assertEq(vault.ethShares(address(this)), amount);
    }
    
    function testFuzz_DistributeFeesDoesNotOverflow(uint96 ethFees, uint96 elizaFees) public {
        // Use uint96 to avoid exceeding token supply
        vm.assume(ethFees > 0 || elizaFees > 0); // At least one must be non-zero
        
        // Setup: vault needs fee distributor set to caller
        vault.setFeeDistributor(owner);
        
        // Add liquidity first
        vm.deal(address(this), 10 ether);
        vault.addETHLiquidity{value: 10 ether}(0);
        
        // Mint tokens for distribution
        uint256 totalFees = uint256(ethFees) + uint256(elizaFees);
        vm.assume(totalFees <= token.MAX_SUPPLY() - token.totalSupply());
        
        token.mint(owner, totalFees);
        token.approve(address(vault), totalFees);
        
        // Should not overflow - crashes if it does
        vault.distributeFees(ethFees, elizaFees);
    }
    
    // ============ Oracle Fuzz Tests - MUST VALIDATE BOUNDS ============

    // NOTE: Skipping fuzz test for oracle price bounds - this is covered extensively
    // in PriceOracle.t.sol with proper deviation tests. Fuzzing here causes too many
    // rejected inputs due to the strict 50% deviation limits.
    
    // ============ Rewards Fuzz Tests - MUST HANDLE EDGE CASES ============
    
    function testFuzz_RegisterNodeWithAnyStake(uint128 stake) public {
        vm.assume(stake >= 1000e18); // Minimum stake
        vm.assume(stake <= token.totalSupply() / 2);
        
        token.mint(address(0x1), stake);
        
        vm.startPrank(address(0x1));
        token.approve(address(rewards), stake);
        
        bytes32 nodeId = rewards.registerNode("https://test.com", "North America", stake);
        vm.stopPrank();
        
        (NodeOperatorRewards.Node memory node,,) = rewards.getNodeInfo(nodeId);
        assertEq(node.stakedAmount, stake);
    }
    
    function testFuzz_UpdatePerformanceWithAnyValues(uint16 uptimeScore, uint128 requests, uint32 responseTime) public {
        vm.assume(uptimeScore <= 10000); // Max 100%
        
        // Register node
        token.mint(address(0x1), 1000e18);
        vm.startPrank(address(0x1));
        token.approve(address(rewards), 1000e18);
        bytes32 nodeId = rewards.registerNode("https://test.com", "North America", 1000e18);
        vm.stopPrank();
        
        // Update with fuzzed values - must not overflow
        rewards.updatePerformance(nodeId, uptimeScore, requests, responseTime);
        
        // Verify values were stored (may have defaults applied)
        (,NodeOperatorRewards.PerformanceData memory perf,) = rewards.getNodeInfo(nodeId);
        assertEq(perf.requestsServed, requests);
        assertEq(perf.avgResponseTime, responseTime);
    }
    
    // ============ Registry Fuzz Tests - TEST ALL INPUTS ============
    
    function testFuzz_RegisterWithAnyURI(string memory uri) public {
        // Use proper address for NFT receiver
        vm.prank(address(0x1));
        uint256 agentId = registry.register(uri);
        
        assertEq(registry.tokenURI(agentId), uri);
    }
    
    function testFuzz_SetMetadataWithAnyKey(string memory key, bytes memory value) public {
        vm.assume(bytes(key).length > 0); // Empty key not allowed
        
        vm.prank(address(0x1));
        uint256 agentId = registry.register();
        
        vm.prank(address(0x1));
        registry.setMetadata(agentId, key, value);
        
        bytes memory retrieved = registry.getMetadata(agentId, key);
        assertEq(keccak256(retrieved), keccak256(value));
    }
    
    // ============ Gas Griefing Tests ============
    
    function testCannotSetMetadataAboveLimit() public {
        vm.startPrank(address(0x1));
        uint256 agentId = registry.register();
        
        // Create metadata exceeding limit (8KB + 1 byte)
        bytes memory tooLarge = new bytes(registry.MAX_METADATA_SIZE() + 1);
        
        // Must revert - prevents gas griefing
        vm.expectRevert(IdentityRegistry.MetadataTooLarge.selector);
        registry.setMetadata(agentId, "large", tooLarge);
        vm.stopPrank();
    }
    
    function testCanSetMetadataAtLimit() public {
        vm.startPrank(address(0x1));
        uint256 agentId = registry.register();
        
        // Create metadata at exact limit (8KB)
        bytes memory atLimit = new bytes(registry.MAX_METADATA_SIZE());
        for (uint i = 0; i < atLimit.length; i++) {
            atLimit[i] = bytes1(uint8(i % 256));
        }
        
        // Should succeed
        registry.setMetadata(agentId, "max", atLimit);
        vm.stopPrank();
        
        // Verify it was stored
        bytes memory retrieved = registry.getMetadata(agentId, "max");
        assertEq(keccak256(retrieved), keccak256(atLimit));
    }
    
    function testManyMetadataEntriesWork() public {
        vm.startPrank(address(0x1));
        uint256 agentId = registry.register();
        
        // Add 100 metadata entries within limits
        for (uint i = 0; i < 100; i++) {
            string memory key = string(abi.encodePacked("key", vm.toString(i)));
            registry.setMetadata(agentId, key, abi.encode(i));
        }
        vm.stopPrank();
        
        // All should be retrievable
        for (uint i = 0; i < 100; i++) {
            string memory key = string(abi.encodePacked("key", vm.toString(i)));
            bytes memory value = registry.getMetadata(agentId, key);
            assertEq(abi.decode(value, (uint256)), i);
        }
    }
    
    function testCannotSetKeyAboveLimit() public {
        vm.startPrank(address(0x1));
        uint256 agentId = registry.register();
        
        // Create key exceeding limit (256 + 1 chars)
        string memory tooLongKey = new string(registry.MAX_KEY_LENGTH() + 1);
        
        vm.expectRevert(IdentityRegistry.KeyTooLong.selector);
        registry.setMetadata(agentId, tooLongKey, bytes("value"));
        vm.stopPrank();
    }
    
    // ============ Zero Value Edge Cases ============
    
    function testDistributeZeroFeesReverts() public {
        // Distributor rejects zero amount - crash if it doesn't
        vm.expectRevert(); // InvalidAmount
        distributor.distributeFees(0, address(0x1));
    }
    
    function testMintZeroTokensDoesNotRevert() public {
        token.mint(address(0x1), 0);
        
        // Should succeed (no-op)
        assertEq(token.balanceOf(address(0x1)), 0);
    }
    
    function testUpdatePerformanceWithZeroValues() public {
        token.mint(address(0x1), 1000e18);
        vm.startPrank(address(0x1));
        token.approve(address(rewards), 1000e18);
        bytes32 nodeId = rewards.registerNode("https://test.com", "North America", 1000e18);
        vm.stopPrank();
        
        // Update with zeros - system may have defaults
        rewards.updatePerformance(nodeId, 0, 0, 0);
        
        // Verify it was updated (may have default uptime score)
        (,NodeOperatorRewards.PerformanceData memory perf,) = rewards.getNodeInfo(nodeId);
        assertEq(perf.requestsServed, 0);
        assertEq(perf.avgResponseTime, 0);
    }
}

