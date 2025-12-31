// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SolverRegistry} from "../src/oif/SolverRegistry.sol";
import {SimpleOracle} from "../src/oif/OracleAdapter.sol";
import {InputSettler} from "../src/oif/InputSettler.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";

/**
 * @title DeployOIFLocalnet
 * @notice Deploys Open Intents Framework (OIF) contracts for local development
 * @dev Usage: forge script script/DeployOIFLocalnet.s.sol --rpc-url http://localhost:6546 --broadcast
 *
 * This deploys the complete OIF stack for testing cross-chain intent flows locally.
 * For testing purposes, this uses SimpleOracle which trusts authorized attesters.
 *
 * Components:
 * - SolverRegistry: Tracks registered solvers with staking
 * - SimpleOracle: Trusted attester oracle for testing (production uses Hyperlane/Superchain)
 * - InputSettler: Origin chain - locks user funds, creates intents
 * - OutputSettler: Destination chain - solver fills, releases funds
 */
contract DeployOIFLocalnet is Script {
    function run() external {
        // Default to Anvil's first test account if no key provided
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        uint256 localChainId = block.chainid;

        console2.log("=== OIF LOCALNET DEPLOYMENT ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", localChainId);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy SolverRegistry - tracks solver stakes and reputation
        SolverRegistry solverRegistry = new SolverRegistry();
        console2.log("SolverRegistry:", address(solverRegistry));

        // 2. Deploy SimpleOracle - trusted attestation for testing
        SimpleOracle oracle = new SimpleOracle();
        console2.log("SimpleOracle:", address(oracle));

        // 3. Authorize deployer as attester for testing
        oracle.setAttester(deployer, true);
        console2.log("Authorized deployer as attester");

        // 4. Deploy InputSettler (origin chain component)
        InputSettler inputSettler = new InputSettler(localChainId, address(oracle), address(solverRegistry));
        console2.log("InputSettler:", address(inputSettler));

        // 5. Deploy OutputSettler (destination chain component)
        OutputSettler outputSettler = new OutputSettler(localChainId);
        console2.log("OutputSettler:", address(outputSettler));

        // 6. Register deployer as a solver for testing
        solverRegistry.register{value: 0.05 ether}(new uint256[](0));
        console2.log("Registered deployer as solver with 0.05 ETH stake");

        vm.stopBroadcast();

        // Output JSON for deployment tracking
        console2.log("");
        console2.log("=== DEPLOYMENT OUTPUT ===");
        console2.log("{");
        console2.log('  "solverRegistry": "%s",', address(solverRegistry));
        console2.log('  "oifOracle": "%s",', address(oracle));
        console2.log('  "inputSettler": "%s",', address(inputSettler));
        console2.log('  "outputSettler": "%s"', address(outputSettler));
        console2.log("}");
    }
}
