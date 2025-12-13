// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {AutocratTreasury} from "../src/autocrat/AutocratTreasury.sol";
import {BlockBuilderMarketplace} from "../src/autocrat/BlockBuilderMarketplace.sol";

/**
 * @title DeployAutocrat
 * @notice Deployment script for Autocrat MEV system contracts
 *
 * Usage:
 *   forge script script/DeployAutocrat.s.sol:DeployAutocrat --rpc-url $RPC_URL --broadcast
 */
contract DeployAutocrat is Script {
    // Deployment addresses
    address public treasury;
    address public builderMarketplace;

    // Configuration
    address public deployer;
    address public protocolTreasury;
    address public stakersRewardsPool;
    address public insuranceFund;
    address public identityRegistry;
    address public reputationRegistry;
    address public sequencer;

    function setUp() public {
        // Load from environment or use defaults for localnet
        deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        protocolTreasury = vm.envOr("PROTOCOL_TREASURY", address(0));
        stakersRewardsPool = vm.envOr("STAKERS_REWARDS_POOL", address(0));
        insuranceFund = vm.envOr("INSURANCE_FUND", address(0));
        identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        sequencer = vm.envOr("SEQUENCER_ADDRESS", address(0));
    }

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying Autocrat contracts...");
        console2.log("Deployer:", deployer);

        // Use deployer as fallback for all addresses
        if (protocolTreasury == address(0)) protocolTreasury = deployer;
        if (stakersRewardsPool == address(0)) stakersRewardsPool = deployer;
        if (insuranceFund == address(0)) insuranceFund = deployer;
        if (sequencer == address(0)) sequencer = deployer;

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy AutocratTreasury
        AutocratTreasury autocratTreasury = new AutocratTreasury(
            protocolTreasury,
            stakersRewardsPool,
            insuranceFund,
            deployer
        );
        treasury = address(autocratTreasury);
        console2.log("AutocratTreasury deployed at:", treasury);

        // 2. Deploy BlockBuilderMarketplace (if registries are available)
        if (identityRegistry != address(0) && reputationRegistry != address(0)) {
            BlockBuilderMarketplace marketplace = new BlockBuilderMarketplace(
                identityRegistry,
                reputationRegistry,
                treasury,
                sequencer,
                deployer
            );
            builderMarketplace = address(marketplace);
            console2.log("BlockBuilderMarketplace deployed at:", builderMarketplace);
        } else {
            console2.log("Skipping BlockBuilderMarketplace: IdentityRegistry or ReputationRegistry not configured");
        }

        vm.stopBroadcast();

        // Log deployment summary
        console2.log("\n=== Autocrat Deployment Summary ===");
        console2.log("Treasury:", treasury);
        console2.log("BuilderMarketplace:", builderMarketplace);
        console2.log("Owner:", deployer);
    }
}

/**
 * @title DeployAutocratLocalnet
 * @notice Simplified deployment for localnet testing
 */
contract DeployAutocratLocalnet is Script {
    function run() public {
        // Use first anvil account
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying Autocrat contracts to localnet...");
        console2.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Treasury with deployer as all recipients
        AutocratTreasury treasury = new AutocratTreasury(
            deployer,
            deployer,
            deployer,
            deployer
        );
        console2.log("AutocratTreasury:", address(treasury));

        // For localnet, we skip BlockBuilderMarketplace as it requires registries

        vm.stopBroadcast();

        // Output for scripts to parse
        console2.log("\nAUTOCRAT_TREASURY=%s", address(treasury));
    }
}
