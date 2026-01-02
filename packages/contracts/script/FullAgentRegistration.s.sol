// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";

interface IIdentityRegistry {
    function register(string calldata tokenURI) external payable returns (uint256);
    function updateTags(uint256 agentId, string[] calldata tags) external;
    function getAgentsByTag(string calldata tag) external view returns (uint256[] memory);
}

contract FullAgentRegistration is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address identityRegistry = 0xf5059a5D33d5853360D16C683c16e67980206f36;
        
        vm.startBroadcast(deployerPrivateKey);
        
        IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
        
        uint256 agentId = registry.register{value: 0}("http://localhost:4030/agent");
        console.log("Agent registered with ID:", agentId);
        
        string[] memory tags = new string[](1);
        tags[0] = "dws-worker-node";
        registry.updateTags(agentId, tags);
        console.log("Tags updated");
        
        vm.stopBroadcast();
        
        uint256[] memory agents = registry.getAgentsByTag("dws-worker-node");
        console.log("Agents with dws-worker-node tag:", agents.length);
    }
}
