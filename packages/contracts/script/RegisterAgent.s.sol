// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";

interface IIdentityRegistry {
    function register(string calldata tokenURI) external payable returns (uint256);
    function addTag(uint256 agentId, string calldata tag) external;
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory);
}

contract RegisterAgent is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address identityRegistry = 0x0165878A594ca255338adfa4d48449f69242Eb8F;
        
        vm.startBroadcast(deployerPrivateKey);
        
        IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
        
        // Register agent
        uint256 agentId = registry.register("http://localhost:4030/agent");
        console.log("Agent registered with ID:", agentId);
        
        // Add tag
        registry.addTag(agentId, "dws-worker-node");
        console.log("Tag 'dws-worker-node' added");
        
        vm.stopBroadcast();
        
        // Verify
        uint256[] memory agents = registry.getAgentsByTag("dws-worker-node");
        console.log("Agents with tag:", agents.length);
    }
}
