// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/tokens/ElizaOSToken.sol";

/**
 * Deploy all contracts to localnet
 *
 * Usage:
 *   forge script script/DeployLocalnet.s.sol:DeployLocalnet \
 *     --rpc-url http://localhost:8545 \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
 *     --broadcast \
 *     --legacy
 */
contract DeployLocalnet is Script {
    function run() external {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", address(deployer).balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy ElizaOS Token
        ElizaOSToken elizaOS = new ElizaOSToken(deployer);
        console.log("ElizaOS Token deployed to:", address(elizaOS));

        // Could deploy more contracts here...

        vm.stopBroadcast();

        // Save deployment info
        console.log("\n=== Deployment Summary ===");
        console.log("ElizaOS Token:", address(elizaOS));
    }
}
