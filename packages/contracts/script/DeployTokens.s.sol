// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/tokens/MockJejuUSDC.sol";
import "../src/tokens/ElizaOSToken.sol";

/**
 * @title DeployTokens
 * @notice Deploys test USDC and ElizaOS tokens
 */
contract DeployTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying tokens to chain:", block.chainid);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Mock USDC
        MockJejuUSDC usdc = new MockJejuUSDC(deployer);
        console.log("MockJejuUSDC deployed to:", address(usdc));

        // Deploy ElizaOS Token
        ElizaOSToken elizaOS = new ElizaOSToken(deployer);
        console.log("ElizaOSToken deployed to:", address(elizaOS));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Token Deployment Complete ===");
        console.log("USDC:", address(usdc));
        console.log("ElizaOS:", address(elizaOS));
    }
}

