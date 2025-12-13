// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/keepalive/KeepaliveRegistry.sol";
import "../src/names/ENSMirror.sol";

/**
 * @title DeployKeepalive
 * @notice Deploys the Jeju Keepalive and ENS Mirror contracts
 * @dev Usage: forge script script/DeployKeepalive.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployKeepalive is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Get dependencies from env or use defaults
        address triggerRegistry = vm.envOr("TRIGGER_REGISTRY", address(0));
        address agentVault = vm.envOr("AGENT_VAULT", address(0));
        address jnsRegistry = vm.envOr("JNS_REGISTRY", address(0));
        address jnsResolver = vm.envOr("JNS_RESOLVER", address(0));

        console.log("Deploying Jeju Keepalive System");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("TriggerRegistry:", triggerRegistry);
        console.log("JNSRegistry:", jnsRegistry);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy KeepaliveRegistry
        KeepaliveRegistry keepalive = new KeepaliveRegistry(
            triggerRegistry,
            agentVault,
            jnsRegistry
        );
        console.log("KeepaliveRegistry deployed at:", address(keepalive));

        // Authorize deployer as executor initially
        keepalive.setExecutorAuthorized(deployer, true);
        console.log("Deployer authorized as executor");

        // Deploy ENSMirror
        ENSMirror ensMirror = new ENSMirror(jnsRegistry, jnsResolver);
        console.log("ENSMirror deployed at:", address(ensMirror));

        // Authorize deployer as oracle initially
        ensMirror.setOracleAuthorized(deployer, true);
        console.log("Deployer authorized as oracle");

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
            '"keepaliveRegistry":"',
            vm.toString(address(keepalive)),
            '",',
            '"ensMirror":"',
            vm.toString(address(ensMirror)),
            '"',
            "}}"
        );

        console.log("\nDeployment JSON:");
        console.log(json);
    }
}
