// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/moderation/BanManager.sol";
import "../src/moderation/ModerationMarketplace.sol";
import "../src/moderation/ReportingSystem.sol";
import "../src/moderation/ReputationLabelManager.sol";

/**
 * @title DeployModeration
 * @notice Deploys the Moderation Marketplace system
 *
 * Deploys:
 * - BanManager (network bans)
 * - ModerationMarketplace (stake-based futarchy moderation)
 * - ReportingSystem (legacy report system - optional)
 * - ReputationLabelManager (labels - optional)
 *
 * The ModerationMarketplace enables:
 * - Staked users to immediately flag unstaked users
 * - Futarchy markets for ban decisions
 * - Stake-weighted voting with flash loan protection
 * - 10x stake re-review mechanism
 * - Economic rewards for correct moderation
 *
 * Usage:
 *   forge script script/DeployModeration.s.sol:DeployModeration \
 *     --rpc-url $RPC_URL \
 *     --broadcast
 */
contract DeployModeration is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Optional: Use existing contracts
        address existingBanManager = vm.envOr("BAN_MANAGER_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        console.log("==================================================");
        console.log("Deploying Moderation Marketplace System");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy or use existing BanManager
        BanManager banManager;
        if (existingBanManager != address(0)) {
            banManager = BanManager(payable(existingBanManager));
            console.log("Using existing BanManager:", existingBanManager);
        } else {
            banManager = new BanManager(deployer, deployer);
            console.log("Deployed BanManager:", address(banManager));
        }

        // 2. Deploy ModerationMarketplace
        ModerationMarketplace marketplace = new ModerationMarketplace(
            address(banManager),
            address(0), // ETH staking (no ERC20)
            treasury,
            deployer
        );
        console.log("Deployed ModerationMarketplace:", address(marketplace));

        // 3. Authorize ModerationMarketplace as a moderator in BanManager
        if (existingBanManager == address(0)) {
            banManager.setModerator(address(marketplace), true);
            console.log("Authorized ModerationMarketplace as moderator");
        } else {
            console.log("NOTE: Manually authorize ModerationMarketplace in BanManager:");
            console.log("  banManager.setModerator(", address(marketplace), ", true)");
        }

        console.log("");
        console.log("Deployment Summary:");
        console.log("  BanManager:", address(banManager));
        console.log("  ModerationMarketplace:", address(marketplace));
        console.log("  Treasury:", treasury);
        console.log("");
        console.log("Configuration:");
        console.log("  Min Reporter Stake: 0.01 ETH");
        console.log("  Min Challenge Stake: 0.01 ETH");
        console.log("  Min Stake Age: 24 hours");
        console.log("  Default Voting Period: 3 days");
        console.log("  Re-Review Multiplier: 10x");
        console.log("  Max Appeals: 3");
        console.log("");
        console.log("Reward Distribution:");
        console.log("  Winner: 90%");
        console.log("  Treasury: 5%");
        console.log("  Market Makers: 5%");

        vm.stopBroadcast();

        console.log("Deployment complete. Update deployments/moderation-system.json manually.");
    }
}

/**
 * @title DeployModerationFull
 * @notice Deploys the full moderation stack including legacy systems
 */
contract DeployModerationFull is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address predimarket = vm.envOr("PREDIMARKET_ADDRESS", address(0));
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", address(0));

        require(predimarket != address(0), "PREDIMARKET_ADDRESS required");
        require(identityRegistry != address(0), "IDENTITY_REGISTRY_ADDRESS required");

        console.log("==================================================");
        console.log("Deploying Full Moderation Stack");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Predimarket:", predimarket);
        console.log("Identity Registry:", identityRegistry);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy BanManager
        BanManager banManager = new BanManager(deployer, deployer);
        console.log("Deployed BanManager:", address(banManager));

        // 2. Deploy ReputationLabelManager
        ReputationLabelManager labelManager =
            new ReputationLabelManager(address(banManager), predimarket, deployer, deployer);
        console.log("Deployed ReputationLabelManager:", address(labelManager));

        // 3. Deploy ReportingSystem
        ReportingSystem reportingSystem = new ReportingSystem(
            address(banManager), address(labelManager), predimarket, identityRegistry, deployer, deployer
        );
        console.log("Deployed ReportingSystem:", address(reportingSystem));

        // 4. Deploy ModerationMarketplace
        ModerationMarketplace marketplace = new ModerationMarketplace(
            address(banManager),
            address(0), // ETH staking
            treasury,
            deployer
        );
        console.log("Deployed ModerationMarketplace:", address(marketplace));

        // 5. Configure permissions
        banManager.setModerator(address(marketplace), true);
        banManager.setModerator(address(reportingSystem), true);
        banManager.setGovernance(deployer);
        console.log("Configured permissions");

        vm.stopBroadcast();

        console.log("Full deployment complete. Update deployments/moderation-system-full.json manually.");
    }
}
