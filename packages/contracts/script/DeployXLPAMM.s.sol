// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {XLPV2Factory} from "../src/amm/v2/XLPV2Factory.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPRouter} from "../src/amm/XLPRouter.sol";
import {XLPPositionManager} from "../src/amm/v3/XLPPositionManager.sol";

/// @title Deploy XLP AMM Infrastructure
/// @author Jeju Network
/// @notice Deploys the complete V2 + V3 AMM system
contract DeployXLPAMM is Script {
    function run() external {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // WETH address - use canonical addresses per network
        address weth = vm.envOr("WETH_ADDRESS", address(0));

        console.log("Deploying XLP AMM infrastructure...");
        console.log("Deployer:", deployer);
        console.log("WETH:", weth);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy V2 Factory
        XLPV2Factory v2Factory = new XLPV2Factory(deployer);
        console.log("XLPV2Factory deployed:", address(v2Factory));

        // 2. Deploy V3 Factory
        XLPV3Factory v3Factory = new XLPV3Factory();
        console.log("XLPV3Factory deployed:", address(v3Factory));

        // 3. Deploy Router
        XLPRouter router = new XLPRouter(address(v2Factory), address(v3Factory), weth, deployer);
        console.log("XLPRouter deployed:", address(router));

        // 4. Deploy Position Manager
        XLPPositionManager positionManager = new XLPPositionManager(address(v3Factory), weth);
        console.log("XLPPositionManager deployed:", address(positionManager));

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== XLP AMM Deployment Summary ===");
        console.log("V2 Factory:        ", address(v2Factory));
        console.log("V3 Factory:        ", address(v3Factory));
        console.log("Router:            ", address(router));
        console.log("Position Manager:  ", address(positionManager));
        console.log("==================================\n");
    }
}
