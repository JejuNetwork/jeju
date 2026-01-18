// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {ServiceRegistry} from "../src/services/ServiceRegistry.sol";

contract DeployServiceRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        vm.startBroadcast(deployerPrivateKey);
        
        ServiceRegistry registry = new ServiceRegistry(deployer); // deployer as treasury
        console.log("ServiceRegistry deployed at:", address(registry));
        
        vm.stopBroadcast();
    }
}
