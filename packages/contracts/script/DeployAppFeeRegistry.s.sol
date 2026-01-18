// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {AppFeeRegistry} from "../src/distributor/AppFeeRegistry.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";

/**
 * @title DeployAppFeeRegistry
 * @notice Deploys AppFeeRegistry and connects it to FeeDistributor
 * @dev Run with: forge script script/DeployAppFeeRegistry.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Core Principle: Network gets 0% - fees go to apps and community
 */
contract DeployAppFeeRegistry is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Get required contract addresses from env
        address daoRegistry = vm.envAddress("DAO_REGISTRY");
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address feeDistributor = vm.envAddress("FEE_DISTRIBUTOR");

        console.log("Deploying AppFeeRegistry...");
        console.log("Deployer:", deployer);
        console.log("DAO Registry:", daoRegistry);
        console.log("Identity Registry:", identityRegistry);
        console.log("Fee Distributor:", feeDistributor);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy AppFeeRegistry
        AppFeeRegistry appFeeRegistry = new AppFeeRegistry(
            daoRegistry,
            identityRegistry,
            deployer
        );
        console.log("AppFeeRegistry deployed at:", address(appFeeRegistry));

        // Set the fee distributor as authorized
        appFeeRegistry.setFeeDistributor(feeDistributor);
        console.log("Fee distributor authorized");

        // FeeDistributor integration is handled via AppFeeRegistry.setFeeDistributor().
        // The FeeDistributor will call AppFeeRegistry to get app splits during fee distribution.
        console.log("AppFeeRegistry ready for use");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("AppFeeRegistry:", address(appFeeRegistry));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update packages/config/contracts.json:");
        console.log('   "distributor": {');
        console.log('     "appFeeRegistry": "', address(appFeeRegistry), '"');
        console.log("   }");
        console.log("2. Apps can now register via registerApp()");
        console.log("3. Verify paymaster is passing appAddress to distributeFees()");
    }
}


