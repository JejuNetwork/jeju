// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {NodeStakingManager} from "../src/node-staking/NodeStakingManager.sol";
import {INodeStakingManager} from "../src/node-staking/INodeStakingManager.sol";

/**
 * @title Deploy Node Staking System
 * @notice Deploys the multi-token node staking system for node operators
 * @dev Requires TokenRegistry, PaymasterFactory, and PriceOracle to be deployed first
 */
contract DeployRewards is Script {
    function run() external returns (address stakingManager) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        string memory network = vm.envOr("NETWORK", string("localnet"));
        
        console.log("============================================================");
        console.log("Deploying Node Staking System (Multi-Token)");
        console.log("============================================================");
        console.log("Network:", network);
        console.log("Deployer:", deployer);
        
        // Get required addresses from environment
        address tokenRegistry = vm.envAddress("TOKEN_REGISTRY_ADDRESS");
        address paymasterFactory = vm.envAddress("PAYMASTER_FACTORY_ADDRESS");
        address priceOracle = vm.envAddress("PRICE_ORACLE_ADDRESS");
        address performanceOracle = vm.envOr("PERFORMANCE_ORACLE_ADDRESS", deployer);
        
        console.log("\nDependencies:");
        console.log("  TokenRegistry:", tokenRegistry);
        console.log("  PaymasterFactory:", paymasterFactory);
        console.log("  PriceOracle:", priceOracle);
        console.log("  PerformanceOracle:", performanceOracle);
        
        require(tokenRegistry != address(0), "TOKEN_REGISTRY_ADDRESS required");
        require(paymasterFactory != address(0), "PAYMASTER_FACTORY_ADDRESS required");
        require(priceOracle != address(0), "PRICE_ORACLE_ADDRESS required");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy NodeStakingManager
        console.log("\n[1/1] Deploying NodeStakingManager...");
        NodeStakingManager staking = new NodeStakingManager(
            tokenRegistry,
            paymasterFactory,
            priceOracle,
            performanceOracle,
            deployer
        );
        stakingManager = address(staking);
        console.log("   NodeStakingManager deployed:", stakingManager);
        
        vm.stopBroadcast();
        
        // Print summary
        console.log("\n============================================================");
        console.log("Deployment Complete!");
        console.log("============================================================");
        console.log("Network:", network);
        console.log("NodeStakingManager:", stakingManager);
        console.log("\nNext steps:");
        console.log("1. Fund contract with ETH for paymaster fees");
        console.log("2. Operators can stake ANY registered token");
        console.log("3. Operators choose reward token (can differ from staking token)");
        console.log("4. Start performance oracle: bun run scripts/rewards/rewards-oracle.ts");
        
        console.log("\nSave this address:");
        console.log("export NODE_STAKING_MANAGER=", stakingManager);
    }
}
