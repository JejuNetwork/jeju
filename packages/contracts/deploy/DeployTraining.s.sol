// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {TrainingCoordinator} from "../src/training/TrainingCoordinator.sol";
import {TrainingRewards} from "../src/training/TrainingRewards.sol";
import {TrainingRegistry} from "../src/training/TrainingRegistry.sol";
import {NodePerformanceOracle} from "../src/training/NodePerformanceOracle.sol";
import {ComputeRegistry} from "../src/compute/ComputeRegistry.sol";
import {MPCKeyRegistry} from "../src/kms/MPCKeyRegistry.sol";

/**
 * @title DeployTraining
 * @notice Deploys the decentralized training infrastructure contracts
 * @dev Run with: forge script deploy/DeployTraining.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 * - PRIVATE_KEY: Deployer private key
 * - COMPUTE_REGISTRY: Existing ComputeRegistry address (optional)
 * - MPC_KEY_REGISTRY: Existing MPCKeyRegistry address (optional)
 * - IDENTITY_REGISTRY: Existing IdentityRegistry address (optional)
 * - BAN_MANAGER: Existing BanManager address (optional)
 */
contract DeployTraining is Script {
    // Deployed addresses
    TrainingCoordinator public coordinator;
    TrainingRewards public rewards;
    TrainingRegistry public registry;
    NodePerformanceOracle public oracle;

    // Dependencies (deploy if not provided)
    ComputeRegistry public computeRegistry;
    MPCKeyRegistry public mpcKeyRegistry;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Check for existing dependencies or deploy new ones
        address existingCompute = vm.envOr("COMPUTE_REGISTRY", address(0));
        address existingMPC = vm.envOr("MPC_KEY_REGISTRY", address(0));
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address banManager = vm.envOr("BAN_MANAGER", address(0));

        // Deploy ComputeRegistry if not provided
        if (existingCompute != address(0)) {
            computeRegistry = ComputeRegistry(existingCompute);
            console.log("Using existing ComputeRegistry:", existingCompute);
        } else {
            computeRegistry = new ComputeRegistry(
                deployer,
                identityRegistry,
                banManager,
                0.1 ether // minProviderStake
            );
            console.log("Deployed ComputeRegistry:", address(computeRegistry));
        }

        // Deploy MPCKeyRegistry if not provided
        if (existingMPC != address(0)) {
            mpcKeyRegistry = MPCKeyRegistry(existingMPC);
            console.log("Using existing MPCKeyRegistry:", existingMPC);
        } else {
            mpcKeyRegistry = new MPCKeyRegistry(deployer);
            console.log("Deployed MPCKeyRegistry:", address(mpcKeyRegistry));
        }

        // Deploy TrainingCoordinator
        coordinator = new TrainingCoordinator(
            address(computeRegistry),
            address(mpcKeyRegistry),
            deployer
        );
        console.log("Deployed TrainingCoordinator:", address(coordinator));

        // Deploy TrainingRewards
        rewards = new TrainingRewards(address(coordinator), deployer);
        console.log("Deployed TrainingRewards:", address(rewards));

        // Deploy TrainingRegistry
        registry = new TrainingRegistry(address(coordinator), deployer);
        console.log("Deployed TrainingRegistry:", address(registry));

        // Deploy NodePerformanceOracle
        oracle = new NodePerformanceOracle(address(coordinator), deployer);
        console.log("Deployed NodePerformanceOracle:", address(oracle));

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("TrainingCoordinator:", address(coordinator));
        console.log("TrainingRewards:", address(rewards));
        console.log("TrainingRegistry:", address(registry));
        console.log("NodePerformanceOracle:", address(oracle));
        console.log("ComputeRegistry:", address(computeRegistry));
        console.log("MPCKeyRegistry:", address(mpcKeyRegistry));
    }
}

