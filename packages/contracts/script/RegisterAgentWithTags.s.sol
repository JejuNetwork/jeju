// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";

interface IIdentityRegistry {
    function register(string calldata tokenURI) external payable returns (uint256);
    function updateTags(uint256 agentId, string[] calldata tags) external;
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory);
}

contract RegisterAgentWithTags is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address identityRegistry = 0x0165878A594ca255338adfa4d48449f69242Eb8F;
        
        vm.startBroadcast(deployerPrivateKey);
        
        IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
        
        // Agent 1 is already registered, just update tags
        string[] memory tags = new string[](1);
        tags[0] = "dws-worker-node";
        
        registry.updateTags(1, tags);
        console.log("Tags updated for agent 1");
        
        vm.stopBroadcast();
        
        // Verify
        uint256[] memory agents = registry.getAgentsByTag("dws-worker-node");
        console.log("Agents with dws-worker-node tag:", agents.length);
    }
}
