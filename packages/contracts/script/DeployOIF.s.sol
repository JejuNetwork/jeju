// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/oif/InputSettler.sol";
import "../src/oif/OutputSettler.sol";
import "../src/oif/SolverRegistry.sol";
import "../src/oif/OracleAdapter.sol";

/**
 * @title DeployOIF
 * @notice Deploys the Open Intents Framework contracts
 *
 * Usage:
 *   forge script script/DeployOIF.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 *   CHAIN_ID - Chain ID for this deployment
 *   ORACLE_TYPE - "simple", "hyperlane", or "superchain"
 *   HYPERLANE_MAILBOX - (optional) Hyperlane mailbox address
 */
contract DeployOIF is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 chainId = block.chainid;

        console.log("Deploying OIF contracts to chain:", chainId);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy SolverRegistry
        SolverRegistry solverRegistry = new SolverRegistry();
        console.log("SolverRegistry deployed to:", address(solverRegistry));

        // 2. Deploy Oracle (based on env)
        string memory oracleType = vm.envOr("ORACLE_TYPE", string("simple"));
        address oracleAddr;

        if (keccak256(bytes(oracleType)) == keccak256(bytes("hyperlane"))) {
            HyperlaneOracle oracle = new HyperlaneOracle();
            address mailbox = vm.envAddress("HYPERLANE_MAILBOX");
            oracle.setMailbox(mailbox);
            oracleAddr = address(oracle);
            console.log("HyperlaneOracle deployed to:", oracleAddr);
        } else if (keccak256(bytes(oracleType)) == keccak256(bytes("superchain"))) {
            SuperchainOracle oracle = new SuperchainOracle();
            oracleAddr = address(oracle);
            console.log("SuperchainOracle deployed to:", oracleAddr);
        } else {
            SimpleOracle oracle = new SimpleOracle();
            // Set deployer as initial attester
            oracle.setAttester(vm.addr(deployerPrivateKey), true);
            oracleAddr = address(oracle);
            console.log("SimpleOracle deployed to:", oracleAddr);
        }

        // 3. Deploy InputSettler
        InputSettler inputSettler = new InputSettler(chainId, oracleAddr, address(solverRegistry));
        console.log("InputSettler deployed to:", address(inputSettler));

        // 4. Deploy OutputSettler
        OutputSettler outputSettler = new OutputSettler(chainId);
        console.log("OutputSettler deployed to:", address(outputSettler));

        vm.stopBroadcast();

        // Output deployment addresses for configuration
        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("Add these to your .env:");
        console.log("");
        console.log(
            string.concat("OIF_SOLVER_REGISTRY_", vm.toString(chainId), "=", vm.toString(address(solverRegistry)))
        );
        console.log(string.concat("OIF_ORACLE_", vm.toString(chainId), "=", vm.toString(oracleAddr)));
        console.log(string.concat("OIF_INPUT_SETTLER_", vm.toString(chainId), "=", vm.toString(address(inputSettler))));
        console.log(
            string.concat("OIF_OUTPUT_SETTLER_", vm.toString(chainId), "=", vm.toString(address(outputSettler)))
        );
    }
}

/**
 * @title ConfigureOIFRoutes
 * @notice Configures cross-chain routes after deployment
 */
contract ConfigureOIFRoutes is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Load deployed addresses from env
        address oracleAddr = vm.envAddress("OIF_ORACLE");
        // solverRegistry used for future multi-solver configuration
        vm.envAddress("OIF_SOLVER_REGISTRY"); // Load but don't store - for validation only

        vm.startBroadcast(deployerPrivateKey);

        // Configure oracle attesters for trusted solvers
        // In production, this would be done via governance

        OracleAdapter oracle = OracleAdapter(oracleAddr);

        // Add aggregator as attester
        address aggregator = vm.envOr("OIF_AGGREGATOR", address(0));
        if (aggregator != address(0)) {
            oracle.setAttester(aggregator, true);
            console.log("Added aggregator as attester:", aggregator);
        }

        vm.stopBroadcast();

        console.log("Routes configured successfully");
    }
}
