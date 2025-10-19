// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/prediction-markets/Predimarket.sol";

contract DeployPredimarket is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        // Get deployed addresses from environment or use localnet defaults
        address elizaOS = vm.envOr("ELIZA_TOKEN_ADDRESS", address(0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512));
        address oracle = vm.envOr("PREDICTION_ORACLE_ADDRESS", address(0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f));
        address treasury = deployer; // Use deployer as treasury for localnet

        console.log("==========================================");
        console.log("Deploying Predimarket");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("ElizaOS Token:", elizaOS);
        console.log("PredictionOracle:", oracle);
        console.log("Treasury:", treasury);

        vm.startBroadcast(deployerPrivateKey);

        Predimarket market = new Predimarket(
            elizaOS,
            oracle,
            treasury,
            deployer
        );

        vm.stopBroadcast();

        console.log("\n==========================================");
        console.log("Predimarket deployed at:", address(market));
        console.log("==========================================\n");

        return address(market);
    }
}
