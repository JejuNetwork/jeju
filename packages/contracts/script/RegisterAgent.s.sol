// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IdentityRegistry} from "../src/registry/IdentityRegistry.sol";
import {IIdentityRegistry} from "../src/registry/interfaces/IIdentityRegistry.sol";

/**
 * @title RegisterAgent
 * @notice Helper script to register agents with metadata
 * @dev Makes it easy to register agents from command line
 *
 * Usage:
 *   forge script script/RegisterAgent.s.sol:RegisterAgent \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast
 */
contract RegisterAgent is Script {
    function run() external {
        // Get parameters
        address payable registryAddress = payable(vm.envOr("IDENTITY_REGISTRY", address(0)));
        string memory agentUri = vm.envOr("AGENT_URI", string("ipfs://QmDefaultAgent"));
        string memory agentName = vm.envOr("AGENT_NAME", string("My AI Agent"));
        string memory agentType = vm.envOr("AGENT_TYPE", string("general"));

        // Get deployer key
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Registering AI Agent");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("Registry:", registryAddress);
        console.log("Agent URI:", agentUri);
        console.log("Agent Name:", agentName);
        console.log("Agent Type:", agentType);
        console.log("");

        // Load registry from deployment if not provided
        if (registryAddress == address(0)) {
            string memory network = vm.envOr("NETWORK", string("localnet"));
            string memory path = string.concat("deployments/", network, "/liquidity-system.json");

            try vm.readFile(path) returns (string memory json) {
                registryAddress = payable(vm.parseJsonAddress(json, ".identityRegistry"));
                console.log("Loaded registry from deployment:", registryAddress);
            } catch {
                revert("Registry address not found. Set IDENTITY_REGISTRY env var.");
            }
        }

        IdentityRegistry registry = IdentityRegistry(registryAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Register agent with metadata
        IIdentityRegistry.MetadataEntry[] memory metadata = new IIdentityRegistry.MetadataEntry[](3);
        metadata[0] = IIdentityRegistry.MetadataEntry({key: "name", value: abi.encode(agentName)});
        metadata[1] = IIdentityRegistry.MetadataEntry({key: "type", value: abi.encode(agentType)});
        metadata[2] = IIdentityRegistry.MetadataEntry({key: "owner", value: abi.encode(deployer)});

        uint256 agentId = registry.register(agentUri, metadata);

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("AGENT REGISTERED!");
        console.log("==========================================");
        console.log("Agent ID:", agentId);
        console.log("Owner:", deployer);
        console.log("URI:", agentUri);
        console.log("");
        console.log("Metadata:");
        console.log("  name:", agentName);
        console.log("  type:", agentType);
        console.log("");
        console.log("View in registry viewer:");
        console.log("  http://localhost:3000/registry-viewer.html");
        console.log("==========================================");
    }
}

/**
 * @title QueryAgent
 * @notice Helper script to query agent information
 */
contract QueryAgent is Script {
    function run() external view {
        address payable registryAddress = payable(vm.envAddress("IDENTITY_REGISTRY"));
        uint256 agentId = vm.envUint("AGENT_ID");

        IdentityRegistry registry = IdentityRegistry(registryAddress);

        console.log("==========================================");
        console.log("Agent Information");
        console.log("==========================================");
        console.log("Registry:", registryAddress);
        console.log("Agent ID:", agentId);
        console.log("");

        // Basic info
        address owner = registry.ownerOf(agentId);
        string memory uri = registry.tokenURI(agentId);

        console.log("Owner:", owner);
        console.log("Token URI:", uri);
        console.log("");

        // Try to get common metadata
        console.log("Metadata:");
        string[] memory keys = new string[](5);
        keys[0] = "name";
        keys[1] = "description";
        keys[2] = "type";
        keys[3] = "model";
        keys[4] = "version";

        for (uint256 i = 0; i < keys.length; i++) {
            try registry.getMetadata(agentId, keys[i]) returns (bytes memory value) {
                if (value.length > 0) {
                    string memory decoded = abi.decode(value, (string));
                    console.log("  ", keys[i], ":", decoded);
                }
            } catch {}
        }

        console.log("==========================================");
    }
}
