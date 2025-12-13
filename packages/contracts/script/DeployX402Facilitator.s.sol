// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {X402Facilitator} from "../src/x402/X402Facilitator.sol";

/**
 * @title DeployX402Facilitator
 * @notice Deploys X402Facilitator contract for x402 HTTP 402 payment settlement
 *
 * The X402Facilitator handles:
 * - EIP-712 payment signature verification
 * - EIP-3009 transferWithAuthorization for gasless USDC transfers
 * - Settlement tracking and replay prevention
 * - Protocol fee collection (0.5% default)
 *
 * Usage:
 *   # Deploy to localnet
 *   forge script script/DeployX402Facilitator.s.sol:DeployX402Facilitator \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast
 *
 *   # Deploy to testnet
 *   DEPLOYER_PRIVATE_KEY=0x... forge script script/DeployX402Facilitator.s.sol:DeployX402Facilitator \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast \
 *     --verify
 */
contract DeployX402Facilitator is Script {
    // Default USDC addresses per network
    address constant USDC_JEJU = 0x0165878A594ca255338adfa4d48449f69242Eb8F;
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDC_SEPOLIA = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant USDC_ETHEREUM = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    function run() external {
        // Get deployer key (defaults to anvil account 0)
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        // Get fee recipient (defaults to deployer)
        address feeRecipient = vm.envOr("FEE_RECIPIENT_ADDRESS", deployer);

        console.log("==========================================");
        console.log("Deploying X402Facilitator");
        console.log("==========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Fee Recipient:", feeRecipient);
        console.log("");

        // Determine USDC address based on chain
        address usdcAddress = _getUsdcAddress(block.chainid);
        console.log("USDC Address:", usdcAddress);

        // Initial supported tokens
        address[] memory initialTokens = new address[](1);
        initialTokens[0] = usdcAddress;

        vm.startBroadcast(deployerPrivateKey);

        // Deploy X402Facilitator
        X402Facilitator facilitator = new X402Facilitator(deployer, feeRecipient, initialTokens);

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("X402Facilitator:", address(facilitator));
        console.log("Protocol Fee (bps):", facilitator.protocolFeeBps());
        console.log("");
        console.log("Configuration:");
        console.log("  Owner:", deployer);
        console.log("  Fee Recipient:", feeRecipient);
        console.log("  USDC Supported:", facilitator.supportedTokens(usdcAddress) ? "true" : "false");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Update .env with:");
        console.log("     X402_FACILITATOR_ADDRESS=", address(facilitator));
        console.log("");
        console.log("  2. Start the facilitator service:");
        console.log("     cd apps/facilitator && bun run dev");
        console.log("");
        console.log("  3. Verify on block explorer (if on testnet/mainnet):");
        console.log("     forge verify-contract", address(facilitator), "X402Facilitator");
        console.log("==========================================");
    }

    function _getUsdcAddress(uint256 chainId) internal pure returns (address) {
        if (chainId == 420691) return USDC_JEJU; // Jeju
        if (chainId == 84532) return USDC_BASE_SEPOLIA; // Base Sepolia
        if (chainId == 8453) return USDC_BASE; // Base Mainnet
        if (chainId == 11155111) return USDC_SEPOLIA; // Sepolia
        if (chainId == 1) return USDC_ETHEREUM; // Ethereum Mainnet

        // Default to Jeju USDC for local/unknown chains
        return USDC_JEJU;
    }
}
