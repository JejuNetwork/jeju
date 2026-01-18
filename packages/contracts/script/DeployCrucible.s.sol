// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/agents/AgentVault.sol";
import "../src/agents/RoomRegistry.sol";
import "../src/compute/TriggerRegistry.sol";

/**
 * @title DeployCrucible
 * @notice Deploy Crucible-specific contracts (AgentVault, RoomRegistry, TriggerRegistry)
 */
contract DeployCrucible is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy AgentVault with deployer as fee recipient
        AgentVault vault = new AgentVault(deployer);
        console.log("AgentVault deployed at:", address(vault));

        // Deploy RoomRegistry (no constructor args)
        RoomRegistry roomRegistry = new RoomRegistry();
        console.log("RoomRegistry deployed at:", address(roomRegistry));

        // Deploy TriggerRegistry
        TriggerRegistry triggerRegistry = new TriggerRegistry();
        console.log("TriggerRegistry deployed at:", address(triggerRegistry));

        vm.stopBroadcast();
    }
}

