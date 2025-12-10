// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {L1StakeManagerUpgradeable} from "../src/eil/L1StakeManagerUpgradeable.sol";

/**
 * @title DeployUpgradeable
 * @notice Deploys upgradeable EIL contracts with deterministic addresses
 * 
 * Usage:
 *   forge script script/DeployUpgradeable.s.sol:DeployL1 \
 *     --rpc-url $SEPOLIA_RPC --broadcast --verify
 */
contract DeployL1 is Script {
    bytes32 constant SALT = keccak256("jeju-v1-l1-stake-manager");
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying L1StakeManager (Upgradeable)");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy implementation with CREATE2
        L1StakeManagerUpgradeable implementation = new L1StakeManagerUpgradeable{salt: SALT}();
        console.log("Implementation:", address(implementation));
        
        // Deploy proxy with CREATE2
        bytes memory initData = abi.encodeCall(L1StakeManagerUpgradeable.initialize, (deployer));
        ERC1967Proxy proxy = new ERC1967Proxy{salt: keccak256(abi.encodePacked(SALT, "proxy"))}(
            address(implementation),
            initData
        );
        console.log("Proxy:", address(proxy));
        
        vm.stopBroadcast();
        
        console.log("\n========== L1 DEPLOYMENT ==========");
        console.log("L1_STAKE_MANAGER_IMPL=%s", address(implementation));
        console.log("L1_STAKE_MANAGER=%s", address(proxy));
    }
}

/// @notice Configure L1 with L2 paymasters
contract ConfigureL1 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");
        
        vm.startBroadcast(deployerPrivateKey);
        
        L1StakeManagerUpgradeable manager = L1StakeManagerUpgradeable(l1StakeManager);
        
        // Register testnet chain paymasters
        address jejuPaymaster = vm.envOr("JEJU_PAYMASTER", address(0));
        if (jejuPaymaster != address(0)) {
            manager.registerPaymaster(420690, jejuPaymaster);
            console.log("Registered Jeju Testnet");
        }
        
        address basePaymaster = vm.envOr("BASE_PAYMASTER", address(0));
        if (basePaymaster != address(0)) {
            manager.registerPaymaster(84532, basePaymaster);
            console.log("Registered Base Sepolia");
        }
        
        address arbPaymaster = vm.envOr("ARB_PAYMASTER", address(0));
        if (arbPaymaster != address(0)) {
            manager.registerPaymaster(421614, arbPaymaster);
            console.log("Registered Arbitrum Sepolia");
        }
        
        address opPaymaster = vm.envOr("OP_PAYMASTER", address(0));
        if (opPaymaster != address(0)) {
            manager.registerPaymaster(11155420, opPaymaster);
            console.log("Registered Optimism Sepolia");
        }
        
        vm.stopBroadcast();
    }
}
