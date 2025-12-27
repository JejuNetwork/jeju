// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {NetworkRegistry} from "../src/federation/NetworkRegistry.sol";
import {RegistryHub} from "../src/federation/RegistryHub.sol";
import {RegistrySyncOracle} from "../src/federation/RegistrySyncOracle.sol";
import {SolanaVerifier} from "../src/federation/SolanaVerifier.sol";
import {FederatedIdentity} from "../src/federation/FederatedIdentity.sol";
import {FederatedLiquidity} from "../src/federation/FederatedLiquidity.sol";
import {FederatedSolver} from "../src/federation/FederatedSolver.sol";

/**
 * @title DeployFederation
 * @notice Deploy all federation contracts
 *
 * Usage:
 *   forge script script/DeployFederation.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment:
 *   PRIVATE_KEY - Deployer private key
 *   VERIFICATION_AUTHORITY - Address for network verification (optional)
 *   WORMHOLE_RELAYER - Wormhole relayer address (optional)
 *   WORMHOLE_EMITTER - Trusted Solana emitter (optional)
 */
contract DeployFederation is Script {
    // Deployed addresses
    NetworkRegistry public networkRegistry;
    RegistryHub public registryHub;
    RegistrySyncOracle public syncOracle;
    SolanaVerifier public solanaVerifier;
    FederatedIdentity public federatedIdentity;
    FederatedLiquidity public federatedLiquidity;
    FederatedSolver public federatedSolver;

    function run() external {
        uint256 deployerKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);

        address verificationAuthority = vm.envOr("VERIFICATION_AUTHORITY", deployer);
        address wormholeRelayer = vm.envOr("WORMHOLE_RELAYER", deployer);
        bytes32 wormholeEmitter = vm.envOr("WORMHOLE_EMITTER", bytes32(0));

        console2.log("Deploying Federation contracts...");
        console2.log("Deployer:", deployer);
        console2.log("Verification Authority:", verificationAuthority);

        vm.startBroadcast(deployerKey);

        // 1. Deploy NetworkRegistry (L1 hub for all networks)
        networkRegistry = new NetworkRegistry(verificationAuthority);
        console2.log("NetworkRegistry deployed:", address(networkRegistry));

        // 2. Deploy RegistryHub (meta-registry for all registries)
        registryHub = new RegistryHub(wormholeRelayer);
        console2.log("RegistryHub deployed:", address(registryHub));

        // 3. Deploy RegistrySyncOracle (event-driven sync)
        syncOracle = new RegistrySyncOracle();
        console2.log("RegistrySyncOracle deployed:", address(syncOracle));

        // 4. Deploy SolanaVerifier (Wormhole integration)
        solanaVerifier = new SolanaVerifier(wormholeRelayer, wormholeEmitter);
        console2.log("SolanaVerifier deployed:", address(solanaVerifier));

        // 5. Deploy FederatedIdentity
        federatedIdentity = new FederatedIdentity(
            block.chainid,
            deployer, // oracle
            deployer, // governance
            address(networkRegistry),
            address(0) // local identity registry (set later)
        );
        console2.log("FederatedIdentity deployed:", address(federatedIdentity));

        // 6. Deploy FederatedLiquidity
        federatedLiquidity = new FederatedLiquidity(
            block.chainid,
            deployer, // oracle
            deployer, // governance
            address(networkRegistry),
            address(0) // local vault (set later)
        );
        console2.log("FederatedLiquidity deployed:", address(federatedLiquidity));

        // 7. Deploy FederatedSolver
        federatedSolver = new FederatedSolver(
            block.chainid,
            deployer, // oracle
            deployer, // governance
            address(networkRegistry),
            address(0) // local solver registry (set later)
        );
        console2.log("FederatedSolver deployed:", address(federatedSolver));

        vm.stopBroadcast();

        // Log all addresses
        console2.log("\n=== Federation Contracts Deployed ===");
        console2.log("NetworkRegistry:     ", address(networkRegistry));
        console2.log("RegistryHub:         ", address(registryHub));
        console2.log("RegistrySyncOracle:  ", address(syncOracle));
        console2.log("SolanaVerifier:      ", address(solanaVerifier));
        console2.log("FederatedIdentity:   ", address(federatedIdentity));
        console2.log("FederatedLiquidity:  ", address(federatedLiquidity));
        console2.log("FederatedSolver:     ", address(federatedSolver));
        console2.log("=====================================\n");
    }
}

/**
 * @title RegisterJejuNetwork
 * @notice Register Jeju as the first network in the federation
 */
contract RegisterJejuNetwork is Script {
    function run() external {
        uint256 deployerKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address networkRegistryAddr = vm.envAddress("NETWORK_REGISTRY");

        NetworkRegistry registry = NetworkRegistry(payable(networkRegistryAddr));

        vm.startBroadcast(deployerKey);

        // Register Jeju Network with VERIFIED stake (10 ETH)
        NetworkRegistry.NetworkContracts memory contracts = NetworkRegistry.NetworkContracts({
            identityRegistry: vm.envOr("IDENTITY_REGISTRY", address(0)),
            solverRegistry: vm.envOr("SOLVER_REGISTRY", address(0)),
            inputSettler: vm.envOr("INPUT_SETTLER", address(0)),
            outputSettler: vm.envOr("OUTPUT_SETTLER", address(0)),
            liquidityVault: vm.envOr("LIQUIDITY_VAULT", address(0)),
            governance: vm.envOr("GOVERNANCE", address(0)),
            oracle: vm.envOr("ORACLE", address(0)),
            registryHub: vm.envOr("REGISTRY_HUB", address(0))
        });

        registry.registerNetwork{value: 10 ether}(
            420690, // Jeju testnet chain ID
            "Jeju Network",
            "https://testnet-rpc.jejunetwork.org",
            "https://testnet-explorer.jejunetwork.org",
            "wss://testnet-ws.jejunetwork.org",
            contracts,
            bytes32(0) // genesis hash
        );

        console2.log("Jeju Network registered with VERIFIED status!");

        vm.stopBroadcast();
    }
}
