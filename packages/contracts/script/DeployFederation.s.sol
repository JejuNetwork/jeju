// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {NetworkRegistry} from "../src/federation/NetworkRegistry.sol";
import {FederatedIdentity} from "../src/federation/FederatedIdentity.sol";
import {FederatedSolver} from "../src/federation/FederatedSolver.sol";
import {FederatedLiquidity} from "../src/federation/FederatedLiquidity.sol";

/**
 * @title DeployFederation
 * @notice Deploys the complete federation stack
 * 
 * Usage:
 *   # Hub chain (NetworkRegistry)
 *   forge script script/DeployFederation.s.sol:DeployNetworkRegistry \
 *     --rpc-url $HUB_RPC_URL --broadcast
 *   
 *   # Local chain (Federation contracts)
 *   NETWORK_REGISTRY=$REGISTRY_ADDR forge script script/DeployFederation.s.sol:DeployFederationLocal \
 *     --rpc-url $LOCAL_RPC_URL --broadcast
 */

contract DeployNetworkRegistry is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying NetworkRegistry...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        NetworkRegistry registry = new NetworkRegistry(deployer);

        vm.stopBroadcast();

        console.log("NetworkRegistry deployed to:", address(registry));
        return address(registry);
    }
}

contract DeployFederationLocal is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        address networkRegistry = vm.envAddress("NETWORK_REGISTRY");
        address localIdentityRegistry = vm.envOr("LOCAL_IDENTITY_REGISTRY", address(0));
        address localSolverRegistry = vm.envOr("LOCAL_SOLVER_REGISTRY", address(0));
        address localLiquidityVault = vm.envOr("LOCAL_LIQUIDITY_VAULT", address(0));

        uint256 localChainId = block.chainid;

        console.log("Deploying Federation contracts...");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", localChainId);
        console.log("Network Registry:", networkRegistry);

        vm.startBroadcast(deployerPrivateKey);

        FederatedIdentity identity = new FederatedIdentity(
            localChainId,
            deployer,
            deployer,
            networkRegistry,
            localIdentityRegistry
        );
        console.log("FederatedIdentity deployed to:", address(identity));

        FederatedSolver solver = new FederatedSolver(
            localChainId,
            deployer,
            deployer,
            networkRegistry,
            localSolverRegistry
        );
        console.log("FederatedSolver deployed to:", address(solver));

        FederatedLiquidity liquidity = new FederatedLiquidity(
            localChainId,
            deployer,
            deployer,
            networkRegistry,
            localLiquidityVault
        );
        console.log("FederatedLiquidity deployed to:", address(liquidity));

        vm.stopBroadcast();

        console.log("\nFederation deployment complete");
    }
}

contract DeployFederationFull is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 localChainId = block.chainid;

        console.log("Full Federation deployment...");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", localChainId);

        vm.startBroadcast(deployerPrivateKey);

        NetworkRegistry registry = new NetworkRegistry(deployer);
        console.log("NetworkRegistry:", address(registry));

        FederatedIdentity identity = new FederatedIdentity(
            localChainId,
            deployer,
            deployer,
            address(registry),
            address(0)
        );
        console.log("FederatedIdentity:", address(identity));

        FederatedSolver solver = new FederatedSolver(
            localChainId,
            deployer,
            deployer,
            address(registry),
            address(0)
        );
        console.log("FederatedSolver:", address(solver));

        FederatedLiquidity liquidity = new FederatedLiquidity(
            localChainId,
            deployer,
            deployer,
            address(registry),
            address(0)
        );
        console.log("FederatedLiquidity:", address(liquidity));

        vm.stopBroadcast();
    }
}

