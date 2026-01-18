// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/dws/DWSMarketplace.sol";

/**
 * @title DeployDWSMarketplace
 * @notice Deploys DWS Marketplace contract for Oracles and Indexers
 * @dev Run: forge script script/DeployDWSMarketplace.s.sol:DeployDWSMarketplace --rpc-url jeju_testnet --broadcast
 */
contract DeployDWSMarketplace is Script {
    function run() external {
        address deployer = msg.sender;

        // Get dependencies from env or use defaults
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", deployer);
        address banManager = vm.envOr("BAN_MANAGER_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        console.log("==================================================");
        console.log("Deploying DWS Marketplace");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);
        console.log("Treasury:", treasury);
        console.log("");

        vm.startBroadcast();

        // ============================================================
        // DWS Marketplace (Oracles + Indexers)
        // ============================================================
        console.log("--- DWS Marketplace ---");

        DWSMarketplace marketplace = new DWSMarketplace(
            deployer,           // owner
            identityRegistry,   // identity registry for ERC-8004
            banManager,         // ban manager for moderation
            treasury           // treasury for protocol fees
        );
        console.log("DWSMarketplace:", address(marketplace));
        console.log("");

        vm.stopBroadcast();

        // ============================================================
        // Deployment Summary
        // ============================================================
        console.log("==================================================");
        console.log("DWS Marketplace Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("DWS Marketplace:", address(marketplace));
        console.log("  - Supports: Oracle, Indexer, Compute, Storage, Database, DA, Auth, Messaging");
        console.log("  - Platform Fee: 2.5%");
        console.log("  - Min Provider Stake: 1000 ETH");
        console.log("");
        console.log("Next Steps:");
        console.log("  1. Providers list services via marketplace.createListing()");
        console.log("  2. Users subscribe via marketplace.subscribe()");
        console.log("  3. Track usage via marketplace.recordUsage()");

        console.log("");
        console.log("To save deployment:");
        console.log("  echo '{ \"dwsMarketplace\": \"", vm.toString(address(marketplace)), "\" }' > deployments/jeju-testnet-dws-marketplace.json");
    }
}
