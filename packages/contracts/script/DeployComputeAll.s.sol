// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ComputeRegistry} from "../src/compute/ComputeRegistry.sol";
import {LedgerManager} from "../src/compute/LedgerManager.sol";
import {InferenceServing} from "../src/compute/InferenceServing.sol";

contract DeployComputeAll is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Use existing ComputeRegistry if set, otherwise deploy new
        address computeRegistry = vm.envOr("COMPUTE_REGISTRY", address(0));
        
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy LedgerManager
        LedgerManager ledger = new LedgerManager(computeRegistry, deployer);
        console.log("LedgerManager:", address(ledger));
        
        // Deploy InferenceServing
        InferenceServing inference = new InferenceServing(computeRegistry, address(ledger), deployer);
        console.log("InferenceServing:", address(inference));

        vm.stopBroadcast();
    }
}
