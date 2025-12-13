// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {L1StakeManager} from "../src/eil/L1StakeManager.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {CrossChainMessagingPaymaster} from "../src/eil/CrossChainMessagingPaymaster.sol";
import {MockEntryPoint} from "../test/mocks/MockEntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployEIL
 * @notice Deploys EIL L1StakeManager on L1 (Sepolia/Mainnet)
 *
 * Usage:
 *   PRIVATE_KEY=... forge script script/DeployEIL.s.sol:DeployEIL \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast
 */
contract DeployEIL is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying EIL L1StakeManager");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        L1StakeManager stakeManager = new L1StakeManager();

        console.log("L1StakeManager deployed:", address(stakeManager));

        vm.stopBroadcast();

        console.log("\n========== EIL DEPLOYMENT COMPLETE ==========");
        console.log("L1_STAKE_MANAGER=%s", address(stakeManager));
        console.log("==============================================");
    }
}

/**
 * @title DeployEILL2
 * @notice Deploys EIL CrossChainPaymaster on L2 (Base Sepolia, etc.)
 *
 * Environment variables:
 *   PRIVATE_KEY - Deployer private key
 *   L1_STAKE_MANAGER - Address of L1StakeManager (from DeployEIL)
 *   ENTRYPOINT - (optional) ERC-4337 EntryPoint address
 *   SWAP_ROUTER - (optional) Uniswap swap router address
 *
 * Usage:
 *   PRIVATE_KEY=... L1_STAKE_MANAGER=0x... forge script script/DeployEIL.s.sol:DeployEILL2 \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast
 */
contract DeployEILL2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 chainId = block.chainid;

        address l1StakeManager = vm.envOr("L1_STAKE_MANAGER", address(0));
        address entryPoint = vm.envOr("ENTRYPOINT", address(0));
        address swapRouter = vm.envOr("SWAP_ROUTER", address(0));

        console.log("Deploying EIL CrossChainPaymaster on L2");
        console.log("Chain ID:", chainId);
        console.log("Deployer:", deployer);
        console.log("L1StakeManager:", l1StakeManager);

        vm.startBroadcast(deployerPrivateKey);

        // EntryPoint handling: MockEntryPoint only allowed on localnet
        IEntryPoint ep;
        if (entryPoint == address(0)) {
            // Only allow mock on localnet (chainId 31337 or < 1000)
            require(chainId == 31337 || chainId < 1000, "ENTRYPOINT required for non-local chains");
            MockEntryPoint mockEp = new MockEntryPoint();
            ep = IEntryPoint(address(mockEp));
            console.log("WARNING: MockEntryPoint deployed (localnet only):", address(ep));
        } else {
            ep = IEntryPoint(entryPoint);
        }

        // Deploy CrossChainPaymaster (active XLP path)
        CrossChainPaymaster paymaster = new CrossChainPaymaster(ep, l1StakeManager, chainId, swapRouter);
        console.log("CrossChainPaymaster deployed:", address(paymaster));

        // Deploy CrossChainMessagingPaymaster (passive fallback path)
        CrossChainMessagingPaymaster messagingPaymaster = new CrossChainMessagingPaymaster(chainId);
        console.log("CrossChainMessagingPaymaster deployed:", address(messagingPaymaster));

        // Enable ETH as supported token
        paymaster.setTokenSupport(address(0), true);
        messagingPaymaster.setTokenSupport(address(0), true);

        vm.stopBroadcast();

        console.log("\n========== EIL L2 DEPLOYMENT COMPLETE ==========");
        console.log("CHAIN_ID=%s", chainId);
        console.log("CROSS_CHAIN_PAYMASTER=%s", address(paymaster));
        console.log("CROSS_CHAIN_MESSAGING_PAYMASTER=%s", address(messagingPaymaster));
        console.log("ENTRYPOINT=%s", address(ep));
        console.log("================================================");
    }
}
