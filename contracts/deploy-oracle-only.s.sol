// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Script, console} from "forge-std/Script.sol";
import {PredictionOracle} from "./src/prediction-markets/PredictionOracle.sol";
import {Predimarket} from "./src/prediction-markets/Predimarket.sol";
import {MarketFactory} from "./src/prediction-markets/MarketFactory.sol";

contract DeployForEhorse is Script {
    function run() external {
        address deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        address elizaOS = 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512;
        
        vm.startBroadcast();
        
        PredictionOracle oracle = new PredictionOracle(deployer);
        Predimarket market = new Predimarket(elizaOS, address(oracle), deployer, deployer);
        MarketFactory factory = new MarketFactory(address(market), address(oracle), 1000e18, deployer);
        
        vm.stopBroadcast();
        
        // Configure
        vm.startBroadcast();
        oracle.setGameServer(deployer);
        market.transferOwnership(address(factory));
        vm.stopBroadcast();
        
        // Output
        console.log("Oracle:", address(oracle));
        console.log("Predimarket:", address(market));
        console.log("Factory:", address(factory));
    }
}
