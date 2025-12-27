// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RiskSleeve} from "../src/liquidity/RiskSleeve.sol";
import {LiquidityRouter} from "../src/liquidity/LiquidityRouter.sol";

/**
 * @title DeployLiquidity
 * @notice Deploys RiskSleeve and LiquidityRouter contracts
 * @dev Run with: forge script script/DeployLiquidity.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployLiquidity is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Configuration - adjust as needed
        address rewardToken = vm.envOr("REWARD_TOKEN", address(0));
        address liquidityVault = vm.envOr("LIQUIDITY_VAULT", address(0));
        address stakeManager = vm.envOr("STAKE_MANAGER", address(0));
        address stakingToken = vm.envOr("STAKING_TOKEN", address(0));

        console.log("Deploying liquidity contracts...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy RiskSleeve
        RiskSleeve riskSleeve = new RiskSleeve(rewardToken, deployer);
        console.log("RiskSleeve deployed at:", address(riskSleeve));

        // Deploy LiquidityRouter (requires dependencies)
        if (liquidityVault != address(0) && stakeManager != address(0) && stakingToken != address(0)) {
            LiquidityRouter liquidityRouter = new LiquidityRouter(liquidityVault, stakeManager, stakingToken, deployer);
            console.log("LiquidityRouter deployed at:", address(liquidityRouter));
        } else {
            console.log("Skipping LiquidityRouter - dependencies not set");
            console.log("Set LIQUIDITY_VAULT, STAKE_MANAGER, and STAKING_TOKEN to deploy");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("RiskSleeve:", address(riskSleeve));
        console.log("");
        console.log("Next steps:");
        console.log("1. Add addresses to packages/config/contracts.json under liquidity category");
        console.log("2. Set token risk scores: riskSleeve.setTokenRiskScore(token, score)");
        console.log("3. Approve consumers: riskSleeve.setApprovedConsumer(consumer, true, tier)");
    }
}
