// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {JejuUSDC} from "../src/tokens/JejuUSDC.sol";
import {CloudPaymaster} from "../src/services/ServicePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title DeployUSDCAndPaymaster
 * @notice Deploys USDC and CloudPaymaster with x402 support on Jeju
 * @dev Usage:
 *      
 *      # Testnet:
 *      forge script script/DeployUSDCAndPaymaster.s.sol:DeployUSDCAndPaymaster \
 *        --rpc-url $JEJU_TESTNET_RPC \
 *        --broadcast \
 *        --verify
 *      
 *      # Mainnet:
 *      forge script script/DeployUSDCAndPaymaster.s.sol:DeployUSDCAndPaymaster \
 *        --rpc-url $JEJU_RPC \
 *        --broadcast \
 *        --verify
 */
contract DeployUSDCAndPaymaster is Script {
    // Known addresses (update these for your deployment)
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032; // Same on all chains
    
    function run() external {
        // Load configuration from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        bool isTestnet = vm.envBool("IS_TESTNET");
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address revenueWallet = vm.envOr("REVENUE_WALLET", deployer);
        
        // Existing contracts (if already deployed)
        address ElizaOSToken = vm.envOr("ELIZAOS_TOKEN_ADDRESS", address(0));
        address serviceRegistry = vm.envOr("SERVICE_REGISTRY_ADDRESS", address(0));
        address priceOracle = vm.envOr("PRICE_ORACLE_ADDRESS", address(0));

        console2.log("=== Jeju USDC & CloudPaymaster Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Network:", isTestnet ? "Testnet" : "Mainnet");
        console2.log("Treasury:", treasury);
        console2.log("Revenue Wallet:", revenueWallet);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Deploy USDC ============
        console2.log("Step 1: Deploying Jeju USDC...");
        
        uint256 initialSupply = isTestnet ? 1_000_000 * 1e6 : 0; // 1M USDC on testnet, 0 on mainnet
        bool enableFaucet = isTestnet; // Only enable faucet on testnet
        
        JejuUSDC usdc = new JejuUSDC(
            treasury,
            initialSupply,
            enableFaucet
        );
        
        console2.log("  USDC deployed at:", address(usdc));
        console2.log("  Initial supply:", initialSupply / 1e6, "USDC");
        console2.log("  Faucet enabled:", enableFaucet);
        console2.log("");

        // ============ Step 2: Deploy CloudPaymaster (if dependencies exist) ============
        
        if (ElizaOSToken != address(0) && serviceRegistry != address(0) && priceOracle != address(0)) {
            console2.log("Step 2: Deploying CloudPaymaster...");
            
            CloudPaymaster paymaster = new CloudPaymaster(
                IEntryPoint(ENTRYPOINT_V07),
                ElizaOSToken,
                address(usdc),
                serviceRegistry,
                priceOracle,
                revenueWallet
            );
            
            console2.log("  CloudPaymaster deployed at:", address(paymaster));
            console2.log("  EntryPoint:", ENTRYPOINT_V07);
            console2.log("  ElizaOS token:", ElizaOSToken);
            console2.log("  USDC token:", address(usdc));
            console2.log("  Service Registry:", serviceRegistry);
            console2.log("  Price Oracle:", priceOracle);
            console2.log("  Revenue Wallet:", revenueWallet);
            console2.log("");

            // ============ Step 3: Fund paymaster with ETH ============
            console2.log("Step 3: Funding paymaster with ETH...");
            
            uint256 initialDeposit = isTestnet ? 1 ether : 10 ether;
            paymaster.depositToEntryPoint{value: initialDeposit}();
            
            console2.log("  Deposited:", initialDeposit / 1e18, "ETH to EntryPoint");
            console2.log("");

            // ============ Step 4: Grant minting permissions (testnet only) ============
            if (isTestnet) {
                console2.log("Step 4: Configuring testnet faucet...");
                usdc.configureFaucet(true, 100 * 1e6, 24 hours); // 100 USDC, 24h cooldown
                console2.log("  Faucet configured: 100 USDC per 24 hours");
                console2.log("");
            }

            // ============ Output Addresses ============
            console2.log("=== DEPLOYMENT COMPLETE ===");
            console2.log("");
            console2.log("Add these to your .env file:");
            console2.log("");
            console2.log("# Jeju USDC");
            if (isTestnet) {
                console2.log("JEJU_TESTNET_USDC_ADDRESS=%s", address(usdc));
            } else {
                console2.log("JEJU_USDC_ADDRESS=%s", address(usdc));
            }
            console2.log("");
            console2.log("# Cloud Paymaster");
            if (isTestnet) {
                console2.log("CLOUD_PAYMASTER_TESTNET_ADDRESS=%s", address(paymaster));
            } else {
                console2.log("CLOUD_PAYMASTER_ADDRESS=%s", address(paymaster));
            }
            console2.log("");
            console2.log("=== Next Steps ===");
            console2.log("1. Update .env with addresses above");
            console2.log("2. Configure x402 facilitator to support Jeju network");
            console2.log("3. Update MCP Gateway config with Jeju USDC address");
            console2.log("4. Test payment flow with:");
            console2.log("   cast call %s \"faucet()\" --rpc-url $JEJU_TESTNET_RPC --private-key $TEST_KEY", address(usdc));
            console2.log("");
        } else {
            console2.log("WARNING: Skipping CloudPaymaster deployment - missing dependencies:");
            if (ElizaOSToken == address(0)) console2.log("  - ELIZAOS_TOKEN_ADDRESS not set");
            if (serviceRegistry == address(0)) console2.log("  - SERVICE_REGISTRY_ADDRESS not set");
            if (priceOracle == address(0)) console2.log("  - PRICE_ORACLE_ADDRESS not set");
            console2.log("");
            console2.log("USDC deployed at:", address(usdc));
            console2.log("Deploy CloudPaymaster later with:");
            console2.log("  export ELIZAOS_TOKEN_ADDRESS=<address>");
            console2.log("  export SERVICE_REGISTRY_ADDRESS=<address>");
            console2.log("  export PRICE_ORACLE_ADDRESS=<address>");
            console2.log("  forge script script/DeployUSDCAndPaymaster.s.sol --broadcast");
        }

        vm.stopBroadcast();
    }
}

