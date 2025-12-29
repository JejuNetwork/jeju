// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {MultiChainRPCRegistry} from "../src/rpc/MultiChainRPCRegistry.sol";
import {BandwidthRewards} from "../src/bandwidth/BandwidthRewards.sol";
import {UsageRewardDistributor} from "../src/rewards/UsageRewardDistributor.sol";

/**
 * @title DeployDecentralizedRPC
 * @notice Deploys the decentralized RPC and bandwidth sharing infrastructure
 * 
 * Usage:
 *   forge script script/DeployDecentralizedRPC.s.sol:DeployDecentralizedRPC --rpc-url $RPC_URL --broadcast
 *
 * Environment Variables:
 *   PRIVATE_KEY          - Deployer's private key
 *   JEJU_TOKEN           - JEJU token address
 *   IDENTITY_REGISTRY    - ERC-8004 identity registry (optional)
 *   BAN_MANAGER          - Moderation ban manager (optional)
 *   TREASURY             - Treasury address for fees and slashing
 */
contract DeployDecentralizedRPC is Script {
    // Configuration
    uint256 public constant MIN_RPC_STAKE = 0.1 ether;
    uint256 public constant MIN_BANDWIDTH_STAKE = 0.01 ether;
    
    // Deployed addresses
    MultiChainRPCRegistry public rpcRegistry;
    BandwidthRewards public bandwidthRewards;
    UsageRewardDistributor public rewardDistributor;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Get external dependencies from environment
        address jejuToken = vm.envAddress("JEJU_TOKEN");
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address banManager = vm.envOr("BAN_MANAGER", address(0));
        address treasury = vm.envOr("TREASURY", deployer);

        console.log("Deploying Decentralized RPC Infrastructure...");
        console.log("Deployer:", deployer);
        console.log("JEJU Token:", jejuToken);
        console.log("Identity Registry:", identityRegistry);
        console.log("Ban Manager:", banManager);
        console.log("Treasury:", treasury);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MultiChainRPCRegistry
        rpcRegistry = new MultiChainRPCRegistry(
            jejuToken,
            identityRegistry,
            banManager,
            deployer
        );
        console.log("MultiChainRPCRegistry deployed at:", address(rpcRegistry));

        // 2. Deploy BandwidthRewards
        bandwidthRewards = new BandwidthRewards(
            jejuToken,
            treasury,
            deployer
        );
        console.log("BandwidthRewards deployed at:", address(bandwidthRewards));

        // 3. Deploy UsageRewardDistributor
        rewardDistributor = new UsageRewardDistributor(
            jejuToken,
            treasury,
            deployer
        );
        console.log("UsageRewardDistributor deployed at:", address(rewardDistributor));

        // 4. Configure services in reward distributor
        rewardDistributor.configureService(
            UsageRewardDistributor.ServiceType.RPC,
            address(rpcRegistry),
            4000, // 40% of rewards
            true
        );
        rewardDistributor.configureService(
            UsageRewardDistributor.ServiceType.Bandwidth,
            address(bandwidthRewards),
            3000, // 30% of rewards
            true
        );
        console.log("Service configurations set");

        // 5. Set treasury on RPC registry
        rpcRegistry.setTreasury(treasury);
        console.log("Treasury configured");

        vm.stopBroadcast();

        // Output deployment info
        console.log("\n=== Decentralized RPC Deployment Complete ===");
        console.log("\nCore Contracts:");
        console.log("- MultiChainRPCRegistry:", address(rpcRegistry));
        console.log("- BandwidthRewards:", address(bandwidthRewards));
        console.log("- UsageRewardDistributor:", address(rewardDistributor));
        console.log("\nConfiguration:");
        console.log("- Min RPC Stake:", MIN_RPC_STAKE);
        console.log("- Min Bandwidth Stake:", MIN_BANDWIDTH_STAKE);
        console.log("- Treasury:", treasury);
        console.log("\nNext Steps:");
        console.log("1. Fund the BandwidthRewards contract with JEJU tokens");
        console.log("2. Fund the UsageRewardDistributor contract with JEJU tokens");
        console.log("3. Start epochs for each service type");
        console.log("4. Authorize QoS monitoring relayers");
    }
}
