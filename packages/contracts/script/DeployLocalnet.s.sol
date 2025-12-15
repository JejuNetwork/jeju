// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/tokens/Token.sol";

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

        // Deploy JEJU Token
        Token jeju = new Token(
            "Jeju",
            "JEJU",
            1_000_000_000 * 10**18,
            deployer,
            10_000_000_000 * 10**18,
            true
        );
        jeju.setConfig(0, 0, false, false, true); // Enable faucet
        console.log("JEJU Token deployed to:", address(jeju));

        // Deploy test USDC
        Token usdc = new Token(
            "USD Coin",
            "USDC",
            100_000_000 * 10**18,
            deployer,
            0,
            true
        );
        usdc.setConfig(0, 0, false, false, true);
        console.log("Test USDC deployed to:", address(usdc));

        vm.stopBroadcast();

        // Save deployment info
        console.log("\n=== Deployment Summary ===");
        console.log("JEJU Token:", address(jeju));
        console.log("Test USDC:", address(usdc));
    }
}
