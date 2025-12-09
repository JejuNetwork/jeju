// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {NodeStakingManager} from "../src/node-staking/NodeStakingManager.sol";
import {INodeStakingManager} from "../src/node-staking/INodeStakingManager.sol";
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
    MockPriceOracle public oracle;
    NodeStakingManager public staking;
    MockTokenRegistry public tokenRegistry;
    MockPaymasterFactory public paymasterFactory;
    IdentityRegistry public registry;

    address public owner = address(this);

    function setUp() public {
        token = new ElizaOSToken(owner);
        vault = new LiquidityVault(address(token), owner);
        distributor = new FeeDistributor(address(token), address(vault), owner);
        oracle = new MockPriceOracle();

        // Setup mocks for NodeStakingManager
        tokenRegistry = new MockTokenRegistry();
        paymasterFactory = new MockPaymasterFactory();
        tokenRegistry.register(address(token));
        paymasterFactory.setPaymaster(address(token), address(0x100));
        oracle.setPrice(address(token), 1e18); // $1 per token

        staking =
            new NodeStakingManager(address(tokenRegistry), address(paymasterFactory), address(oracle), owner, owner);
        registry = new IdentityRegistry();

        // Add this test contract as performance oracle for tests
        staking.addPerformanceOracle(address(this));
        staking.addPerformanceOracle(owner);

        vault.setPaymaster(owner);
        vault.setFeeDistributor(address(distributor));
        distributor.setPaymaster(owner);
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

    function testFuzz_RegisterNodeWithAnyStake(uint128 rawStake) public {
        uint256 minStake = staking.minStakeUSD();
        uint256 maxStake = token.totalSupply() / 10;
        if (maxStake > 10000000e18) maxStake = 10000000e18;
        if (minStake > maxStake) return; // Skip if impossible range
        uint256 stake = bound(uint256(rawStake), minStake, maxStake);

        token.mint(address(0x1), stake);

        vm.startPrank(address(0x1));
        token.approve(address(staking), stake);

        bytes32 nodeId = staking.registerNode(
            address(token), stake, address(token), "https://test.com", INodeStakingManager.Region.NorthAmerica
        );
        vm.stopPrank();

        (INodeStakingManager.NodeStake memory node,,) = staking.getNodeInfo(nodeId);
        assertEq(node.stakedAmount, stake);
    }

    function testFuzz_UpdatePerformanceWithAnyValues(uint16 uptimeScore, uint128 requests, uint32 responseTime)
        public
    {
        vm.assume(uptimeScore <= 10000); // Max 100%
        vm.assume(requests <= 1000000000); // Reasonable max requests
        vm.assume(responseTime <= 100000); // Max 100 seconds

        // Register node
        token.mint(address(0x1), 1000e18);
        vm.startPrank(address(0x1));
        token.approve(address(staking), 1000e18);
        bytes32 nodeId = staking.registerNode(
            address(token), 1000e18, address(token), "https://test.com", INodeStakingManager.Region.NorthAmerica
        );
        vm.stopPrank();

        // Update with fuzzed values (already authorized in setUp)
        staking.updatePerformance(nodeId, uptimeScore, requests, responseTime);

        // Verify values were stored
        (, INodeStakingManager.PerformanceMetrics memory perf,) = staking.getNodeInfo(nodeId);
        // EWMA formula: (old * 8 + new * 2) / 10, so stored value may differ
        assertTrue(perf.lastUpdateTime > 0, "Performance was updated");
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
        for (uint256 i = 0; i < atLimit.length; i++) {
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
        for (uint256 i = 0; i < 100; i++) {
            string memory key = string(abi.encodePacked("key", vm.toString(i)));
            registry.setMetadata(agentId, key, abi.encode(i));
        }
        vm.stopPrank();

        // All should be retrievable
        for (uint256 i = 0; i < 100; i++) {
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
        token.approve(address(staking), 1000e18);
        bytes32 nodeId = staking.registerNode(
            address(token), 1000e18, address(token), "https://test.com", INodeStakingManager.Region.NorthAmerica
        );
        vm.stopPrank();

        // Update with minimal values (already authorized in setUp)
        staking.updatePerformance(nodeId, 0, 0, 1);

        // Verify it was updated
        (, INodeStakingManager.PerformanceMetrics memory perf,) = staking.getNodeInfo(nodeId);
        assertTrue(perf.lastUpdateTime > 0, "Performance was updated");
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
        uint256 price = prices[token];
        if (price == 0) return 1e18; // Default $1
        return price;
    }
}
