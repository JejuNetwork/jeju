// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/tokens/Token.sol";

/**
 * @title DeployTokens
 * @notice Deploys test tokens using the canonical Token contract
 */
contract DeployTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying tokens to chain:", block.chainid);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy test USDC (100M supply, 6 decimals simulated via lower initial supply)
        Token usdc = new Token(
            "USD Coin",
            "USDC",
            100_000_000 * 10**18,
            deployer,
            0, // unlimited
            true
        );
        // Enable faucet for testing
        usdc.setConfig(0, 0, false, false, true);
        console.log("Test USDC deployed to:", address(usdc));

        // Deploy test governance token (1B supply)
        Token govToken = new Token(
            "Governance Token",
            "GOV",
            1_000_000_000 * 10**18,
            deployer,
            10_000_000_000 * 10**18, // 10B max
            true
        );
        govToken.setConfig(0, 0, false, false, true);
        console.log("Governance Token deployed to:", address(govToken));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Token Deployment Complete ===");
        console.log("USDC:", address(usdc));
        console.log("GOV:", address(govToken));
    }
}
