// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SolverRegistry} from "../src/oif/SolverRegistry.sol";
import {SimpleOracle} from "../src/oif/OracleAdapter.sol";
import {InputSettler} from "../src/oif/InputSettler.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";

contract DeployOIFFixed is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);
        uint256 localChainId = block.chainid;

        console2.log("=== OIF DEPLOYMENT ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", localChainId);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy SolverRegistry
        SolverRegistry solverRegistry = new SolverRegistry();
        console2.log("SolverRegistry:", address(solverRegistry));

        // 2. Deploy SimpleOracle
        SimpleOracle oracle = new SimpleOracle();
        console2.log("SimpleOracle:", address(oracle));

        // 3. Authorize deployer as attester
        oracle.setAttester(deployer, true);

        // 4. Deploy InputSettler
        InputSettler inputSettler = new InputSettler(localChainId, address(oracle), address(solverRegistry));
        console2.log("InputSettler:", address(inputSettler));

        // 5. Deploy OutputSettler
        OutputSettler outputSettler = new OutputSettler(localChainId);
        console2.log("OutputSettler:", address(outputSettler));

        // 6. Register deployer as solver with correct stake (0.5 ETH)
        solverRegistry.register{value: 0.5 ether}(new uint256[](0));
        console2.log("Registered deployer as solver with 0.5 ETH stake");

        vm.stopBroadcast();
    }
}
