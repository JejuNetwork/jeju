// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {ElizaOSToken} from "../src/tokens/ElizaOSToken.sol";
import {PredictionOracle} from "../src/prediction-markets/PredictionOracle.sol";
import {Predimarket} from "../src/prediction-markets/Predimarket.sol";
import {MarketFactory} from "../src/prediction-markets/MarketFactory.sol";

/**
 * @title DeployPredimarketFull
 * @notice Complete deployment script for the Predimarket system
 * @dev Deploys: ElizaOS Token, PredictionOracle, Predimarket, and MarketFactory
 */
contract DeployPredimarketFull is Script {
    function run() external returns (address elizaToken, address oracle, address market, address factory) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Deploying Complete Predimarket System");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ElizaOS Token
        console.log("1/4 Deploying ElizaOS Token...");
        ElizaOSToken elizaOSToken = new ElizaOSToken(deployer);
        elizaToken = address(elizaOSToken);
        console.log("   ElizaOS Token:", elizaToken);

        // Mint some initial tokens for testing (100M tokens)
        elizaOSToken.mint(deployer, 100_000_000 * 10 ** 18);
        console.log("   Minted 100M tokens to deployer");
        console.log("");

        // 2. Deploy PredictionOracle
        console.log("2/4 Deploying PredictionOracle...");
        PredictionOracle predictionOracle = new PredictionOracle(deployer);
        oracle = address(predictionOracle);
        console.log("   PredictionOracle:", oracle);
        console.log("");

        // 3. Deploy Predimarket
        console.log("3/4 Deploying Predimarket...");
        Predimarket predimarket = new Predimarket(
            elizaToken,
            oracle,
            deployer, // treasury
            deployer // owner
        );
        market = address(predimarket);
        console.log("   Predimarket:", market);
        console.log("");

        // 4. Deploy MarketFactory
        console.log("4/4 Deploying MarketFactory...");
        uint256 defaultLiquidity = 1000 * 10 ** 18; // 1000 ELIZA default liquidity
        MarketFactory marketFactory = new MarketFactory(market, oracle, defaultLiquidity, deployer);
        factory = address(marketFactory);
        console.log("   MarketFactory:", factory);
        console.log("   Default Liquidity:", defaultLiquidity / 10 ** 18, "ELIZA");
        console.log("");

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("Deployment Complete!");
        console.log("==========================================");
        console.log("ElizaOS Token:     ", elizaToken);
        console.log("PredictionOracle:  ", oracle);
        console.log("Predimarket:       ", market);
        console.log("MarketFactory:     ", factory);
        console.log("==========================================");
        console.log("");

        // Save deployment info to JSON
        string memory deploymentJson = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "deployer": "',
            vm.toString(deployer),
            '",\n',
            '  "elizaOSToken": "',
            vm.toString(elizaToken),
            '",\n',
            '  "predictionOracle": "',
            vm.toString(oracle),
            '",\n',
            '  "predimarket": "',
            vm.toString(market),
            '",\n',
            '  "marketFactory": "',
            vm.toString(factory),
            '",\n',
            '  "deployedAt": ',
            vm.toString(block.timestamp),
            "\n",
            "}"
        );

        string memory filename = string.concat("deployments/predimarket-", vm.toString(block.chainid), ".json");
        vm.writeFile(filename, deploymentJson);
        console.log("Deployment info saved to:", filename);
        console.log("");

        return (elizaToken, oracle, market, factory);
    }
}
