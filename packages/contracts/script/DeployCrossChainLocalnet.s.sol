// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {L1StakeManager} from "../src/bridge/eil/L1StakeManager.sol";
import {CrossChainPaymasterUpgradeable} from "../src/bridge/eil/CrossChainPaymasterUpgradeable.sol";
import {L1CrossDomainMessenger} from "../src/bridge/eil/L1CrossDomainMessenger.sol";
import {L2CrossDomainMessenger} from "../src/bridge/eil/L2CrossDomainMessenger.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployCrossChainLocalnet
 * @notice Deploys EIL contracts across L1 and L2 for local cross-chain testing
 * 
 * Run this script TWICE:
 * 1. First on L1: L1_DEPLOY=true forge script ... --rpc-url $L1_RPC_URL --broadcast
 * 2. Then on L2: L2_DEPLOY=true L1_MESSENGER=<addr> L1_STAKE_MANAGER=<addr> forge script ... --rpc-url $L2_RPC_URL --broadcast
 */
contract DeployCrossChainLocalnet is Script {
    // Chain IDs
    uint256 constant L1_CHAIN_ID = 1337;
    uint256 constant L2_CHAIN_ID = 31337;

    function run() external {
        bool deployL1 = vm.envOr("L1_DEPLOY", false);
        bool deployL2 = vm.envOr("L2_DEPLOY", false);

        if (deployL1) {
            deployToL1();
        } else if (deployL2) {
            deployToL2();
        } else {
            console2.log("Set L1_DEPLOY=true or L2_DEPLOY=true");
        }
    }

    function deployToL1() internal {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== L1 DEPLOYMENT ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy L1CrossDomainMessenger
        L1CrossDomainMessenger l1Messenger = new L1CrossDomainMessenger();
        console2.log("L1Messenger:", address(l1Messenger));

        // 2. Deploy L1StakeManager
        L1StakeManager l1StakeManager = new L1StakeManager();
        console2.log("L1StakeManager:", address(l1StakeManager));

        // 3. Configure L1StakeManager with messenger
        l1StakeManager.setMessenger(address(l1Messenger));

        // 4. Register L2 chain
        l1StakeManager.registerChain(L2_CHAIN_ID);
        console2.log("Registered L2 chain:", L2_CHAIN_ID);

        vm.stopBroadcast();

        // Output for L2 deployment
        console2.log("");
        console2.log("=== L1 DEPLOYMENT COMPLETE ===");
        console2.log("Export these for L2 deployment:");
        console2.log("  export L1_MESSENGER=%s", address(l1Messenger));
        console2.log("  export L1_STAKE_MANAGER=%s", address(l1StakeManager));
    }

    function deployToL2() internal {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        // Get L1 contract addresses from environment
        address l1Messenger = vm.envAddress("L1_MESSENGER");
        address l1StakeManager = vm.envAddress("L1_STAKE_MANAGER");

        console2.log("=== L2 DEPLOYMENT ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("L1 Messenger:", l1Messenger);
        console2.log("L1 StakeManager:", l1StakeManager);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy EntryPoint
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:", address(entryPoint));

        // 2. Deploy L2CrossDomainMessenger
        L2CrossDomainMessenger l2Messenger = new L2CrossDomainMessenger();
        console2.log("L2Messenger:", address(l2Messenger));

        // 3. Link L1 and L2 messengers
        l2Messenger.setL1Messenger(l1Messenger);

        // 4. Deploy CrossChainPaymasterUpgradeable (implementation)
        CrossChainPaymasterUpgradeable paymasterImpl = new CrossChainPaymasterUpgradeable();
        console2.log("PaymasterImpl:", address(paymasterImpl));

        // 5. Deploy proxy and initialize
        bytes memory initData = abi.encodeCall(
            CrossChainPaymasterUpgradeable.initialize,
            (deployer, L1_CHAIN_ID, l1StakeManager, address(entryPoint))
        );
        ERC1967Proxy paymasterProxy = new ERC1967Proxy(address(paymasterImpl), initData);
        CrossChainPaymasterUpgradeable paymaster = CrossChainPaymasterUpgradeable(payable(address(paymasterProxy)));
        console2.log("CrossChainPaymaster:", address(paymaster));

        // 6. Configure paymaster with L2 messenger
        paymaster.setL2Messenger(address(l2Messenger));

        vm.stopBroadcast();

        // Output for relay service
        console2.log("");
        console2.log("=== L2 DEPLOYMENT COMPLETE ===");
        console2.log("Export these for message relay:");
        console2.log("  export L2_MESSENGER=%s", address(l2Messenger));
        console2.log("  export ENTRY_POINT=%s", address(entryPoint));
        console2.log("  export CROSS_CHAIN_PAYMASTER=%s", address(paymaster));
    }
}
