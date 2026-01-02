// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";

contract DeployIdentityRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        IdentityRegistry registry = new IdentityRegistry();
        console.log("IdentityRegistry deployed at:", address(registry));
        
        vm.stopBroadcast();
    }
}
