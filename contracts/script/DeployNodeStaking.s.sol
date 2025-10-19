// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {NodeStakingManager} from "../src/node-staking/NodeStakingManager.sol";

/**
 * @title Deploy Node Staking System
 * @notice Deploys NodeStakingManager with multi-token support
 */
contract DeployNodeStaking is Script {
    function run() external returns (address stakingManager) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get dependency addresses from environment
        address tokenRegistry = vm.envAddress("TOKEN_REGISTRY_ADDRESS");
        address paymasterFactory = vm.envAddress("PAYMASTER_FACTORY_ADDRESS");
        address priceOracle = vm.envAddress("PRICE_ORACLE_ADDRESS");
        address performanceOracle = vm.envOr("PERFORMANCE_ORACLE_ADDRESS", deployer);
        
        console.log("============================================================");
        console.log("Deploying Node Staking System");
        console.log("============================================================");
        console.log("Deployer:", deployer);
        console.log("Token Registry:", tokenRegistry);
        console.log("Paymaster Factory:", paymasterFactory);
        console.log("Price Oracle:", priceOracle);
        console.log("Performance Oracle:", performanceOracle);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy NodeStakingManager
        NodeStakingManager staking = new NodeStakingManager(
            tokenRegistry,
            paymasterFactory,
            priceOracle,
            performanceOracle,
            deployer
        );
        
        stakingManager = address(staking);
        
        console.log("\nDeployed:");
        console.log("  NodeStakingManager:", stakingManager);
        console.log("\nConfiguration:");
        console.log("  Min Stake USD:", staking.minStakeUSD() / 1 ether);
        console.log("  Base Reward/Month USD:", staking.baseRewardPerMonthUSD() / 1 ether);
        console.log("  Paymaster Reward Cut:", staking.paymasterRewardCutBPS(), "bps");
        console.log("  Paymaster Stake Cut:", staking.paymasterStakeCutBPS(), "bps");
        console.log("  Max Nodes Per Operator:", staking.maxNodesPerOperator());
        console.log("  Max Network Ownership:", staking.maxNetworkOwnershipBPS(), "bps");
        
        vm.stopBroadcast();
        
        console.log("Deployment complete!");
        console.log("\nNext steps:");
        console.log("1. Fund contract with reward tokens");
        console.log("2. Fund contract with ETH for paymaster fees (send at least 10 ETH)");
        console.log("3. Update .env.local with NODE_STAKING_MANAGER_ADDRESS");
        console.log("4. Run: bun run scripts/verify-node-staking.ts");
    }
}

