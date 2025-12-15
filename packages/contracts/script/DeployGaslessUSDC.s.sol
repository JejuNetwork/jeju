// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {Token} from "../src/tokens/Token.sol";
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";

/**
 * @title DeployGaslessUSDC
 * @notice Deploys Token as USDC (EIP-3009 compliant) for gasless x402 payments
 *
 * This script deploys:
 * 1. Token as USDC - ERC20 with transferWithAuthorization support
 * 2. Optionally updates X402Facilitator to support the new token
 *
 * Usage:
 *   # Deploy to localnet
 *   forge script script/DeployGaslessUSDC.s.sol:DeployGaslessUSDC \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast
 *
 *   # With existing facilitator
 *   X402_FACILITATOR_ADDRESS=0x... forge script script/DeployGaslessUSDC.s.sol:DeployGaslessUSDC \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast
 */
contract DeployGaslessUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        // Check for existing facilitator
        address facilitatorAddress = vm.envOr("X402_FACILITATOR_ADDRESS", address(0));

        console.log("==========================================");
        console.log("Deploying USDC Token (EIP-3009)");
        console.log("==========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        if (facilitatorAddress != address(0)) {
            console.log("Facilitator:", facilitatorAddress);
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy USDC Token
        Token usdc = new Token(
            "USD Coin",
            "USDC",
            100_000_000 * 10**18, // 100M supply
            deployer,
            0, // unlimited
            true
        );
        usdc.setConfig(0, 0, false, false, true); // Enable faucet

        // If facilitator exists, add the new token to supported tokens
        if (facilitatorAddress != address(0)) {
            X402Facilitator facilitator = X402Facilitator(facilitatorAddress);

            // Check if we're the owner
            if (facilitator.owner() == deployer) {
                facilitator.setTokenSupported(address(usdc), true);
                facilitator.setTokenDecimals(address(usdc), 18);
                console.log("Added USDC to X402Facilitator");
            } else {
                console.log("WARNING: Not owner of facilitator, skipping token registration");
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("USDC:", address(usdc));
        console.log("Name:", usdc.name());
        console.log("Symbol:", usdc.symbol());
        console.log("Decimals:", usdc.decimals());
        console.log("Initial Supply:", usdc.totalSupply() / 1e18, "USDC");
        console.log("");
        console.log("EIP-3009 Functions:");
        console.log("  - transferWithAuthorization (gasless transfers)");
        console.log("  - cancelAuthorization (cancel pending)");
        console.log("");
        console.log("Test Functions:");
        console.log("  - faucet() - Get 10,000 USDC for testing");
        console.log("  - mint(to, amount) - Owner can mint more");
        console.log("");
        console.log("Configuration:");
        console.log("  JEJU_USDC_ADDRESS=", address(usdc));
        console.log("  EIP3009_TOKEN_ADDRESS=", address(usdc));
        console.log("==========================================");
    }
}

/**
 * @title DeployX402WithGasless
 * @notice Deploys complete x402 infrastructure with gasless support
 */
contract DeployX402WithGasless is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);
        address feeRecipient = vm.envOr("FEE_RECIPIENT_ADDRESS", deployer);

        console.log("==========================================");
        console.log("Deploying Complete x402 Infrastructure");
        console.log("==========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy USDC Token
        Token usdc = new Token("USD Coin", "USDC", 100_000_000 * 10**18, deployer, 0, true);
        usdc.setConfig(0, 0, false, false, true);
        console.log("1. USDC Token deployed:", address(usdc));

        // 2. Deploy X402Facilitator with USDC
        address[] memory initialTokens = new address[](1);
        initialTokens[0] = address(usdc);

        X402Facilitator facilitator = new X402Facilitator(deployer, feeRecipient, initialTokens);
        facilitator.setTokenDecimals(address(usdc), 18);
        console.log("2. X402Facilitator deployed:", address(facilitator));

        // 3. Fund test accounts with USDC
        address testAccount1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // Anvil account 1
        address testAccount2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // Anvil account 2

        usdc.mint(testAccount1, 1_000_000 * 1e18); // 1M USDC
        usdc.mint(testAccount2, 1_000_000 * 1e18); // 1M USDC
        console.log("3. Funded test accounts with 1M USDC each");

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("");
        console.log("Contracts:");
        console.log("  USDC Token:       ", address(usdc));
        console.log("  X402Facilitator:  ", address(facilitator));
        console.log("");
        console.log("Environment Variables:");
        console.log("  JEJU_USDC_ADDRESS=", address(usdc));
        console.log("  EIP3009_TOKEN_ADDRESS=", address(usdc));
        console.log("  X402_FACILITATOR_ADDRESS=", address(facilitator));
        console.log("");
        console.log("Test Accounts (1M USDC each):");
        console.log("  Account 1:", testAccount1);
        console.log("  Account 2:", testAccount2);
        console.log("==========================================");
    }
}
