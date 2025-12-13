// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {JejuToken} from "../src/tokens/JejuToken.sol";
import {BanManager} from "../src/moderation/BanManager.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";

/**
 * @title DeployJejuToken
 * @notice Deployment script for JejuToken - the native Jeju Network token
 * @dev Deploys JejuToken and optionally integrates with BanManager and TokenRegistry
 *
 * Usage:
 *   # Localnet (with faucet)
 *   forge script script/DeployJejuToken.s.sol:DeployJejuToken --rpc-url http://localhost:8545 --broadcast
 *
 *   # Testnet (with faucet)
 *   ENABLE_FAUCET=true forge script script/DeployJejuToken.s.sol:DeployJejuToken --rpc-url $RPC_URL --broadcast
 *
 *   # Mainnet (no faucet)
 *   forge script script/DeployJejuToken.s.sol:DeployJejuToken --rpc-url $RPC_URL --broadcast --verify
 *
 * Environment Variables:
 *   PRIVATE_KEY or DEPLOYER_PRIVATE_KEY - Deployer private key
 *   BAN_MANAGER - Optional BanManager address
 *   TOKEN_REGISTRY - Optional TokenRegistry address (registers for paymaster)
 *   PRICE_ORACLE - Oracle address for token registration
 *   ENABLE_FAUCET - Set to "true" for testnet/localnet
 */
contract DeployJejuToken is Script {
    // Deployment config
    address banManager;
    address tokenRegistry;
    address priceOracle;
    bool enableFaucet;

    function setUp() public {
        banManager = vm.envOr("BAN_MANAGER", address(0));
        tokenRegistry = vm.envOr("TOKEN_REGISTRY", address(0));
        priceOracle = vm.envOr("PRICE_ORACLE", address(0));
        enableFaucet = vm.envOr("ENABLE_FAUCET", true); // Default true for dev
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0)));

        // If no private key, use default anvil key for localnet
        if (deployerPrivateKey == 0) {
            // First anvil account private key
            deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        }

        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== Jeju Token Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("Enable Faucet:", enableFaucet);
        console2.log("BanManager:", banManager);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy JejuToken
        JejuToken jeju = new JejuToken(deployer, banManager, enableFaucet);

        console2.log("JejuToken deployed:", address(jeju));
        console2.log("  Name:", jeju.name());
        console2.log("  Symbol:", jeju.symbol());
        console2.log("  Initial Supply:", jeju.totalSupply() / 1e18, "JEJU");
        console2.log("  Max Supply:", jeju.MAX_SUPPLY() / 1e18, "JEJU");
        console2.log("  Faucet Enabled:", jeju.faucetEnabled());
        console2.log("  Ban Enforcement:", jeju.banEnforcementEnabled());

        // If TokenRegistry is available, register JEJU for paymaster
        if (tokenRegistry != address(0) && priceOracle != address(0)) {
            console2.log("\nRegistering with TokenRegistry...");

            // Calculate registration fee
            TokenRegistry registry = TokenRegistry(tokenRegistry);
            uint256 registrationFee = registry.registrationFee();

            // Register token with 0-2% fee range (competitive)
            registry.registerToken{value: registrationFee}(
                address(jeju),
                priceOracle,
                0, // min 0% fee
                200, // max 2% fee
                bytes32(0)
            );

            console2.log("  Registered in TokenRegistry");
            console2.log("  Registration Fee Paid:", registrationFee / 1e18, "ETH");
        }

        vm.stopBroadcast();

        // Output summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("JejuToken:", address(jeju));
        console2.log("Owner:", deployer);

        if (enableFaucet) {
            console2.log("\nFaucet Commands:");
            console2.log("  cast send", address(jeju), '"faucet()" --rpc-url $RPC_URL');
        }
    }
}

/**
 * @title DeployJejuTokenFull
 * @notice Full deployment with BanManager, TokenRegistry, and liquidity pool setup
 */
contract DeployJejuTokenFull is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0)));

        if (deployerPrivateKey == 0) {
            deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        }

        address deployer = vm.addr(deployerPrivateKey);
        bool enableFaucet = vm.envOr("ENABLE_FAUCET", true);
        address treasury = vm.envOr("TREASURY", deployer);

        console2.log("=== Full Jeju Token System Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy BanManager (governance = deployer initially)
        BanManager banManagerContract = new BanManager(deployer, deployer);
        console2.log("BanManager deployed:", address(banManagerContract));

        // 2. Deploy JejuToken with BanManager
        JejuToken jeju = new JejuToken(deployer, address(banManagerContract), enableFaucet);
        console2.log("JejuToken deployed:", address(jeju));

        // 3. Deploy TokenRegistry
        TokenRegistry registryContract = new TokenRegistry(deployer, treasury);
        console2.log("TokenRegistry deployed:", address(registryContract));

        // 4. Set registration fee to 0 for initial tokens
        registryContract.setRegistrationFee(0);

        // 5. For localnet, transfer tokens to test accounts
        if (block.chainid == 1337 || block.chainid == 31337) {
            // Anvil test accounts
            address[] memory testAccounts = new address[](5);
            testAccounts[0] = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
            testAccounts[1] = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
            testAccounts[2] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
            testAccounts[3] = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
            testAccounts[4] = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

            uint256 testAmount = 100_000 * 1e18; // 100k JEJU per account

            for (uint256 i = 0; i < testAccounts.length; i++) {
                jeju.transfer(testAccounts[i], testAmount);
                console2.log("Funded test account:", testAccounts[i]);
            }
        }

        vm.stopBroadcast();

        // Summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("BanManager:", address(banManagerContract));
        console2.log("JejuToken:", address(jeju));
        console2.log("TokenRegistry:", address(registryContract));
        console2.log("\nJejuToken Settings:");
        console2.log("  Faucet:", enableFaucet);
        console2.log("  Ban Enforcement:", jeju.banEnforcementEnabled());
    }
}
