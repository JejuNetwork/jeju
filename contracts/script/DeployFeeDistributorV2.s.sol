// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {FeeDistributorV2} from "../src/distributor/FeeDistributorV2.sol";

/**
 * @title DeployFeeDistributorV2
 * @notice Deployment script for FeeDistributorV2 contract
 * 
 * Usage:
 *   forge script script/DeployFeeDistributorV2.s.sol \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify
 * 
 * Required env vars:
 *   - REWARD_TOKEN_ADDRESS (elizaOS token address)
 *   - LIQUIDITY_VAULT_ADDRESS (vault address)
 *   - PAYMASTER_ADDRESS (paymaster address)
 *   - ORACLE_ADDRESS (oracle bot address)
 *   - DEPLOYER_PRIVATE_KEY (for deployment)
 */
contract DeployFeeDistributorV2 is Script {
    function run() external {
        address rewardToken = vm.envAddress("REWARD_TOKEN_ADDRESS");
        address liquidityVault = vm.envAddress("LIQUIDITY_VAULT_ADDRESS");
        address paymaster = vm.envAddress("PAYMASTER_ADDRESS");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address deployer = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        
        console.log("Deploying FeeDistributorV2...");
        console.log("  Deployer:", deployer);
        console.log("  Reward Token:", rewardToken);
        console.log("  Liquidity Vault:", liquidityVault);
        console.log("  Paymaster:", paymaster);
        console.log("  Oracle:", oracle);
        
        vm.startBroadcast();
        
        FeeDistributorV2 distributor = new FeeDistributorV2(
            rewardToken,
            liquidityVault,
            deployer
        );
        
        // Configure
        distributor.setPaymaster(paymaster);
        distributor.setContributorOracle(oracle);
        
        vm.stopBroadcast();
        
        console.log("Deployment complete!");
        console.log("  FeeDistributorV2:", address(distributor));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update AIRDROP_MANAGER deployment with this address");
        console.log("2. Update apps/leaderboard .env with FEE_DISTRIBUTOR_ADDRESS");
        console.log("3. Deploy AirdropManager: forge script script/DeployAirdropManager.s.sol");
    }
}


