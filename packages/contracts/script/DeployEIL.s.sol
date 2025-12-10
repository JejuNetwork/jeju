// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";

/**
 * @title DeployEIL
 * @notice Deploys EIL L1StakeManager on Sepolia
 * 
 * Usage:
 *   PRIVATE_KEY=... forge script script/DeployEIL.s.sol:DeployEIL \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast
 */
contract DeployEIL is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying EIL L1StakeManager");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        L1StakeManager stakeManager = new L1StakeManager();
        
        console.log("L1StakeManager deployed:", address(stakeManager));
        
        vm.stopBroadcast();
        
        console.log("\n========== EIL DEPLOYMENT COMPLETE ==========");
        console.log("L1_STAKE_MANAGER=%s", address(stakeManager));
        console.log("==============================================");
    }
}

