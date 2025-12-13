// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/crucible/AgentVault.sol";
import "../src/crucible/RoomRegistry.sol";

/**
 * @title DeployCrucible
 * @notice Deploys the Crucible agent orchestration contracts
 * @dev Usage: forge script script/DeployCrucible.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployCrucible is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Crucible Contracts");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy AgentVault with deployer as fee recipient
        AgentVault agentVault = new AgentVault(deployer);
        console.log("AgentVault deployed at:", address(agentVault));

        // Deploy RoomRegistry
        RoomRegistry roomRegistry = new RoomRegistry();
        console.log("RoomRegistry deployed at:", address(roomRegistry));

        vm.stopBroadcast();

        // Write deployment info
        string memory json = string.concat(
            '{"network":"',
            vm.toString(block.chainid),
            '",',
            '"deployer":"',
            vm.toString(deployer),
            '",',
            '"contracts":{',
            '"agentVault":"',
            vm.toString(address(agentVault)),
            '",',
            '"roomRegistry":"',
            vm.toString(address(roomRegistry)),
            '"',
            "}}"
        );

        console.log("\nDeployment JSON:");
        console.log(json);
    }
}
