// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "forge-std/console.sol";

/**
 * @title GenerateGenesis
 * @notice Generates genesis.json and rollup.json for L2
 *
 * This script helps generate the genesis configuration for your L2.
 * It requires L1 contracts to be deployed first.
 *
 * Usage:
 *   forge script script/Genesis.s.sol:GenerateGenesis \
 *     --sig "run(string)" testnet
 *
 * Prerequisites:
 *   - L1 contracts deployed to Ethereum
 *   - Addresses saved in deployments/<network>/addresses.json
 *
 * Note: For production, use op-node genesis command:
 *   op-node genesis l2 \
 *     --deploy-config deploy-config/testnet.json \
 *     --l1-deployments deployments/testnet/addresses.json \
 *     --outfile.l2 genesis.json \
 *     --outfile.rollup rollup.json
 */
contract GenerateGenesis is Script {
    function run(string memory network) external pure {
        console.log("==================================================");
        console.log("Generating L2 Genesis Configuration");
        console.log("==================================================");
        console.log("Network:", network);
        console.log("");

        string memory deployConfigPath = string.concat("deploy-config/", network, ".json");
        string memory addressesPath = string.concat("deployments/", network, "/addresses.json");

        console.log("Deploy Config:", deployConfigPath);
        console.log("L1 Addresses:", addressesPath);
        console.log("");

        console.log("IMPORTANT: Use op-node to generate genesis files.");
        console.log("");
        console.log("Command:");
        console.log("  op-node genesis l2 \\");
        console.log("    --deploy-config", deployConfigPath, "\\");
        console.log("    --l1-deployments", addressesPath, "\\");
        console.log("    --outfile.l2 deployments/", network, "/genesis.json \\");
        console.log("    --outfile.rollup deployments/", network, "/rollup.json");
        console.log("");
        console.log("After generation:");
        console.log("  1. Copy genesis.json to your sequencer node");
        console.log("  2. Copy rollup.json to your op-node ConfigMap");
        console.log("  3. Update Kubernetes configs");
        console.log("  4. Deploy: bun run start");
        console.log("");
    }
}
