// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ContentRegistry} from "../src/storage/ContentRegistry.sol";

contract DeployContentRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address seedingOracle = vm.envOr("SEEDING_ORACLE_ADDRESS", deployer);
        address moderationMarketplace = vm.envOr("MODERATION_MARKETPLACE_ADDRESS", address(0));

        console.log("Deploying ContentRegistry...");
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Seeding Oracle:", seedingOracle);

        vm.startBroadcast(deployerPrivateKey);

        ContentRegistry registry = new ContentRegistry(deployer);

        // Configure
        registry.setTreasury(treasury);
        registry.setSeedingOracle(seedingOracle);

        if (moderationMarketplace != address(0)) {
            registry.setModerationMarketplace(moderationMarketplace);
        }

        vm.stopBroadcast();

        console.log("ContentRegistry deployed at:", address(registry));
        console.log("");
        console.log("Set these environment variables:");
        console.log("CONTENT_REGISTRY_ADDRESS=%s", address(registry));
    }
}
