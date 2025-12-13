// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CrossChainPaymaster} from "../src/eil/CrossChainPaymaster.sol";
import {CrossChainMessagingPaymaster} from "../src/eil/CrossChainMessagingPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployEILL2Only
 * @notice Deploy EIL L2 contracts for testing (no L1 dependency)
 *
 * Usage:
 *   source .env.local && export PRIVATE_KEY=$EVM_PRIVATE_KEY
 *   forge script script/DeployEILL2Only.s.sol:DeployEILL2Only \
 *     --rpc-url https://sepolia.base.org --broadcast -vvvv
 */
contract DeployEILL2Only is Script {
    // Base Sepolia chain ID
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    // ERC-4337 EntryPoint v0.6 (canonical on all chains - used by account-abstraction lib)
    address constant ENTRYPOINT_V06 = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== EIL L2-Only Deployment (Base Sepolia) ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("Chain ID:", block.chainid);

        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Must be on Base Sepolia");

        vm.startBroadcast(deployerPrivateKey);

        // Use deployer as mock L1 stake manager (for testing)
        address mockL1StakeManager = deployer;

        // Deploy CrossChainPaymaster
        CrossChainPaymaster paymaster = new CrossChainPaymaster(
            IEntryPoint(ENTRYPOINT_V06),
            mockL1StakeManager,
            BASE_SEPOLIA_CHAIN_ID,
            address(0) // No price oracle for initial deployment
        );
        console.log("CrossChainPaymaster deployed:", address(paymaster));

        // Deploy CrossChainMessagingPaymaster
        CrossChainMessagingPaymaster messagingPaymaster = new CrossChainMessagingPaymaster(
            BASE_SEPOLIA_CHAIN_ID
        );
        console.log("CrossChainMessagingPaymaster deployed:", address(messagingPaymaster));

        // Configure - add Base Sepolia testnet USDC as supported token
        address baseSepoliaUSDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        paymaster.setTokenSupport(baseSepoliaUSDC, true);
        console.log("USDC support enabled:", baseSepoliaUSDC);

        // Register OP Sepolia as destination chain counterpart
        uint256 opSepoliaChainId = 11155420;
        messagingPaymaster.registerCounterpart(opSepoliaChainId, address(0xDEAD)); // Placeholder
        console.log("OP Sepolia chain registered");

        vm.stopBroadcast();

        console.log("\n========== DEPLOYMENT COMPLETE ==========");
        console.log("CROSS_CHAIN_PAYMASTER=%s", address(paymaster));
        console.log("MESSAGING_PAYMASTER=%s", address(messagingPaymaster));
        console.log("ENTRYPOINT=%s", ENTRYPOINT_V06);
        console.log("USDC=%s", baseSepoliaUSDC);
    }
}
