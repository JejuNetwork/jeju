// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OAuth3IdentityRegistry} from "../src/oauth3/OAuth3IdentityRegistry.sol";
import {OAuth3AppRegistry} from "../src/oauth3/OAuth3AppRegistry.sol";
import {OAuth3TEEVerifier} from "../src/oauth3/OAuth3TEEVerifier.sol";
import {AccountFactory} from "../src/oauth3/AccountFactory.sol";

/**
 * @title DeployOAuth3
 * @notice Deploys the complete OAuth3 authentication infrastructure
 * @dev Run with: forge script script/DeployOAuth3.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployOAuth3 is Script {
    // ERC-4337 EntryPoint v0.6
    address constant ENTRY_POINT = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);
        
        console2.log("=== OAuth3 Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TEE Verifier first (no dependencies)
        console2.log("\n1. Deploying OAuth3TEEVerifier...");
        OAuth3TEEVerifier teeVerifier = new OAuth3TEEVerifier(address(0)); // identityRegistry set later
        console2.log("   TEEVerifier:", address(teeVerifier));

        // 2. Deploy Account Factory (depends on EntryPoint)
        console2.log("\n2. Deploying AccountFactory...");
        AccountFactory accountFactory = new AccountFactory(
            ENTRY_POINT,
            address(0), // identityRegistry set later
            address(0)  // defaultValidator - can be set later
        );
        console2.log("   AccountFactory:", address(accountFactory));

        // 3. Deploy Identity Registry (depends on TEEVerifier and AccountFactory)
        console2.log("\n3. Deploying OAuth3IdentityRegistry...");
        OAuth3IdentityRegistry identityRegistry = new OAuth3IdentityRegistry(
            address(teeVerifier),
            address(accountFactory)
        );
        console2.log("   IdentityRegistry:", address(identityRegistry));

        // 4. Deploy App Registry (depends on IdentityRegistry and TEEVerifier)
        console2.log("\n4. Deploying OAuth3AppRegistry...");
        OAuth3AppRegistry appRegistry = new OAuth3AppRegistry(
            address(identityRegistry),
            address(teeVerifier)
        );
        console2.log("   AppRegistry:", address(appRegistry));

        // 5. Update TEEVerifier with IdentityRegistry address
        console2.log("\n5. Configuring TEEVerifier...");
        teeVerifier.setIdentityRegistry(address(identityRegistry));

        // 6. Add a trusted measurement for simulated TEE (for testing)
        console2.log("\n6. Adding simulated TEE measurement...");
        bytes32 simulatedMeasurement = keccak256("oauth3-demo-measurement");
        teeVerifier.addTrustedMeasurement(simulatedMeasurement);
        console2.log("   Simulated measurement added:", vm.toString(simulatedMeasurement));

        vm.stopBroadcast();

        // Print summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("TEEVerifier:      ", address(teeVerifier));
        console2.log("AccountFactory:   ", address(accountFactory));
        console2.log("IdentityRegistry: ", address(identityRegistry));
        console2.log("AppRegistry:      ", address(appRegistry));
        
        console2.log("\n=== Environment Variables ===");
        console2.log("TEE_VERIFIER_ADDRESS=", vm.toString(address(teeVerifier)));
        console2.log("ACCOUNT_FACTORY_ADDRESS=", vm.toString(address(accountFactory)));
        console2.log("IDENTITY_REGISTRY_ADDRESS=", vm.toString(address(identityRegistry)));
        console2.log("APP_REGISTRY_ADDRESS=", vm.toString(address(appRegistry)));
    }
}
