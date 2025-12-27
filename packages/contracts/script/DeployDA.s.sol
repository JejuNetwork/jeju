// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DAOperatorRegistry} from "../src/da/DAOperatorRegistry.sol";
import {DABlobRegistry} from "../src/da/DABlobRegistry.sol";
import {DAAttestationManager} from "../src/da/DAAttestationManager.sol";

/**
 * @title DeployDA
 * @notice Deploys the Jeju Data Availability Layer contracts
 *
 * Usage:
 *   forge script script/DeployDA.s.sol:DeployDA --rpc-url $RPC_URL --broadcast
 */
contract DeployDA is Script {
    // Configuration
    uint256 public constant MIN_OPERATOR_STAKE = 0.1 ether;
    uint256 public constant SUBMISSION_FEE = 0.001 ether;

    // Deployed addresses
    DAOperatorRegistry public operatorRegistry;
    DABlobRegistry public blobRegistry;
    DAAttestationManager public attestationManager;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Get external dependencies from environment
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address banManager = vm.envOr("BAN_MANAGER", address(0));

        console.log("Deploying DA Layer contracts...");
        console.log("Deployer:", deployer);
        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Operator Registry
        operatorRegistry = new DAOperatorRegistry(deployer, identityRegistry, banManager, MIN_OPERATOR_STAKE);
        console.log("DAOperatorRegistry deployed at:", address(operatorRegistry));

        // 2. Deploy Blob Registry
        blobRegistry = new DABlobRegistry(address(operatorRegistry), SUBMISSION_FEE, deployer);
        console.log("DABlobRegistry deployed at:", address(blobRegistry));

        // 3. Deploy Attestation Manager
        attestationManager = new DAAttestationManager(address(operatorRegistry), address(blobRegistry), deployer);
        console.log("DAAttestationManager deployed at:", address(attestationManager));

        vm.stopBroadcast();

        // Output deployment info
        console.log("\n=== DA Layer Deployment Complete ===");
        console.log("DAOperatorRegistry:", address(operatorRegistry));
        console.log("DABlobRegistry:", address(blobRegistry));
        console.log("DAAttestationManager:", address(attestationManager));
        console.log("\nConfiguration:");
        console.log("- Min Operator Stake:", MIN_OPERATOR_STAKE);
        console.log("- Submission Fee:", SUBMISSION_FEE);
    }
}
