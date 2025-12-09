// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";

/**
 * @title DeployIdentityRegistry
 * @notice Deploys IdentityRegistry contract for ERC-8004 agent/app registration
 *
 * Usage:
 *   forge script script/DeployIdentityRegistry.s.sol:DeployIdentityRegistry \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast
 */
contract DeployIdentityRegistry is Script {
    function run() external {
        // Get deployer key
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Deploying IdentityRegistry");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy IdentityRegistry
        IdentityRegistry registry = new IdentityRegistry();

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("IdentityRegistry:", address(registry));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Save address to .env:");
        console.log("     IDENTITY_REGISTRY_ADDRESS=", address(registry));
        console.log("");
        console.log("  2. Register your first agent:");
        console.log("     forge script script/RegisterAgent.s.sol:RegisterAgent \\");
        console.log("       --rpc-url http://localhost:8545 \\");
        console.log("       --broadcast");
        console.log("==========================================");
    }
}
