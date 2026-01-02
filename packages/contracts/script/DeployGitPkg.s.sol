// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/git/RepoRegistry.sol";
import "../src/pkg/PackageRegistry.sol";

/**
 * @title DeployGitPkg
 * @notice Deploys Git and Package registries
 */
contract DeployGitPkg is Script {
    function run() external {
        address deployer = msg.sender;
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", deployer);

        console.log("==================================================");
        console.log("Deploying Git and Package Registries");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Identity Registry:", identityRegistry);
        console.log("");

        vm.startBroadcast();

        // Git Repository Registry
        console.log("--- Git Repository Registry ---");
        RepoRegistry repoRegistry = new RepoRegistry(deployer, identityRegistry);
        console.log("RepoRegistry:", address(repoRegistry));

        // Package Registry
        console.log("--- Package Registry ---");
        PackageRegistry packageRegistry = new PackageRegistry(deployer, identityRegistry);
        console.log("PackageRegistry:", address(packageRegistry));

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("Deployment Complete");
        console.log("==================================================");
        console.log("RepoRegistry:", address(repoRegistry));
        console.log("PackageRegistry:", address(packageRegistry));
    }
}






