// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {AirdropManager} from "../src/distributor/AirdropManager.sol";

/**
 * @title DeployAirdropManager
 * @notice Deployment script for AirdropManager contract
 * 
 * Usage:
 *   forge script script/DeployAirdropManager.s.sol \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify
 * 
 * Required env vars:
 *   - FEE_DISTRIBUTOR_V2_ADDRESS (deployed FeeDistributorV2 address)
 *   - DEPLOYER_PRIVATE_KEY (for deployment)
 */
contract DeployAirdropManager is Script {
    function run() external {
        address feeDistributor = vm.envAddress("FEE_DISTRIBUTOR_V2_ADDRESS");
        address deployer = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        
        console.log("Deploying AirdropManager...");
        console.log("  Deployer:", deployer);
        console.log("  FeeDistributorV2:", feeDistributor);
        
        vm.startBroadcast();
        
        AirdropManager manager = new AirdropManager(
            feeDistributor,
            deployer
        );
        
        vm.stopBroadcast();
        
        console.log("Deployment complete!");
        console.log("  AirdropManager:", address(manager));
        console.log("");
        console.log("Configuration:");
        console.log("  Minimum Airdrop:", manager.minimumAirdropAmount());
        console.log("  Max Contributors:", manager.MAX_CONTRIBUTORS());
        console.log("");
        console.log("Next steps:");
        console.log("1. Update apps/leaderboard .env with AIRDROP_MANAGER_ADDRESS");
        console.log("2. Run leaderboard migration: cd apps/leaderboard && bun run db:migrate");
        console.log("3. Test snapshot generation: bun run scripts/leaderboard/monthly-distribution.ts --dry-run");
    }
}


