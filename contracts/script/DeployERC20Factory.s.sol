// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {SimpleERC20Factory} from "../src/token/SimpleERC20Factory.sol";

contract DeployERC20Factory is Script {
    function run() external {
        vm.startBroadcast();
        
        SimpleERC20Factory factory = new SimpleERC20Factory();
        
        console.log("========================================");
        console.log("SimpleERC20Factory deployed at:", address(factory));
        console.log("========================================");
        
        vm.stopBroadcast();
    }
}

