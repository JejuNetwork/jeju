// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/names/JNSRegistry.sol";
import "../src/names/JNSResolver.sol";
import "../src/names/JNSRegistrar.sol";
import "../src/names/JNSReverseRegistrar.sol";

/**
 * @title DeployJNS
 * @notice Deploy Jeju Name Service contracts
 *
 * Run: forge script script/DeployJNS.s.sol:DeployJNS --rpc-url jeju_testnet --broadcast
 */
contract DeployJNS is Script {
    function run() external {
        address deployer = msg.sender;
        address treasury = deployer;

        console.log("==================================================");
        console.log("Deploying JNS (Jeju Name Service)");
        console.log("==================================================");
        console.log("Deployer:", deployer);

        vm.startBroadcast();

        // 1. Deploy JNS Registry
        JNSRegistry registry = new JNSRegistry();
        console.log("JNSRegistry:", address(registry));

        // 2. Deploy JNS Resolver
        JNSResolver resolver = new JNSResolver(address(registry));
        console.log("JNSResolver:", address(resolver));

        // 3. Deploy JNS Registrar
        JNSRegistrar registrar = new JNSRegistrar(
            address(registry),
            address(resolver),
            treasury
        );
        console.log("JNSRegistrar:", address(registrar));

        // 4. Deploy JNS Reverse Registrar
        JNSReverseRegistrar reverseRegistrar = new JNSReverseRegistrar(
            address(registry),
            address(resolver)
        );
        console.log("JNSReverseRegistrar:", address(reverseRegistrar));

        // 5. Setup: Give registrar control of .jeju TLD
        bytes32 jejuLabel = keccak256("jeju");
        registry.setSubnodeOwner(bytes32(0), jejuLabel, address(registrar));
        console.log("Set .jeju TLD owner to registrar");

        // 6. Setup: Give reverse registrar control of .addr.reverse
        bytes32 reverseLabel = keccak256("reverse");
        bytes32 addrLabel = keccak256("addr");
        registry.setSubnodeOwner(bytes32(0), reverseLabel, deployer);
        bytes32 reverseNode = keccak256(abi.encodePacked(bytes32(0), reverseLabel));
        registry.setSubnodeOwner(reverseNode, addrLabel, address(reverseRegistrar));
        console.log("Set addr.reverse owner to reverse registrar");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("JNS Deployment Complete");
        console.log("==================================================");
        console.log("JNSRegistry:", address(registry));
        console.log("JNSResolver:", address(resolver));
        console.log("JNSRegistrar:", address(registrar));
        console.log("JNSReverseRegistrar:", address(reverseRegistrar));
        console.log("");
        console.log("Update contracts.json testnet.jns section with these addresses");
    }
}
