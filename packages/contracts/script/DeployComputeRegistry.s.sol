// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ComputeRegistry} from "../src/compute/ComputeRegistry.sol";

/**
 * @title DeployComputeRegistry
 * @notice Deploys the ComputeRegistry for AI inference and database providers
 * @dev Run with: forge script script/DeployComputeRegistry.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 * - DEPLOYER_PRIVATE_KEY or PRIVATE_KEY: Deployer private key
 * - IDENTITY_REGISTRY: Existing IdentityRegistry address (optional)
 * - BAN_MANAGER: Existing BanManager address (optional)
 * - MIN_PROVIDER_STAKE: Minimum stake required (default: 0)
 */
contract DeployComputeRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", vm.envUint("PRIVATE_KEY"));
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        // Check for existing dependencies
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address banManager = vm.envOr("BAN_MANAGER", address(0));
        uint256 minProviderStake = vm.envOr("MIN_PROVIDER_STAKE", uint256(0));

        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);
        console.log("Min Provider Stake:", minProviderStake);

        vm.startBroadcast(deployerPrivateKey);

        ComputeRegistry computeRegistry = new ComputeRegistry(
            deployer,
            identityRegistry,
            banManager,
            minProviderStake
        );

        console.log("\n=== Deployment Complete ===");
        console.log("ComputeRegistry:", address(computeRegistry));

        vm.stopBroadcast();
    }
}
