#!/usr/bin/env bun
/**
 * Deployment Script
 * 
 * Deploys the complete Jeju stack to testnet or mainnet:
 * - Smart contracts (L1 + L2)
 * - DeFi protocols  
 * - Account abstraction
 * - Oracle system
 * - Automatic verification
 * 
 * For specific components, CI/CD can call individual deploy-*.ts scripts directly.
 * 
 * Usage:
 *   bun run deploy:testnet    # Deploy to testnet
 *   bun run deploy:mainnet    # Deploy to mainnet
 */

import { $ } from "bun";
import { existsSync } from "fs";

const network = process.argv.find(arg => arg === "--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : "testnet";

if (network !== "testnet" && network !== "mainnet") {
  console.error("❌ Invalid network. Use: testnet or mainnet");
  process.exit(1);
}

const isMainnet = network === "mainnet";
const l1RpcUrl = isMainnet ? "https://eth.llamarpc.com" : "https://ethereum-sepolia-rpc.publicnode.com";
const l1ChainId = isMainnet ? "1" : "11155111";

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 JEJU - ${isMainnet ? 'MAINNET' : 'TESTNET'} DEPLOYMENT                    ║
║   Complete Stack                                          ║
║   Settlement Layer: Ethereum ${isMainnet ? 'Mainnet' : 'Sepolia'}                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

// Mainnet safety check
if (isMainnet) {
  console.log("⚠️  MAINNET DEPLOYMENT - This will use real funds!");
  console.log("\nRequired environment variables:");
  console.log("  - DEPLOYER_PRIVATE_KEY");
  console.log("  - ETHERSCAN_API_KEY");
  
  const requiredVars = ["DEPLOYER_PRIVATE_KEY", "ETHERSCAN_API_KEY"];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  
  console.log("\n✅ All required environment variables found\n");
  console.log("Press Ctrl+C within 10 seconds to cancel...\n");
  await new Promise(resolve => setTimeout(resolve, 10000));
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Step 1: Build contracts
console.log("1️⃣  Building Smart Contracts...\n");
const buildResult = await $`cd packages/contracts && forge build`.nothrow();

if (buildResult.exitCode !== 0) {
  console.error("\n❌ Contract build failed");
  process.exit(1);
}

console.log("✅ Contracts built successfully\n");

// Step 2: Deploy L1 contracts
console.log("2️⃣  Deploying L1 Contracts to Ethereum...\n");

const deployCmd = await $`bun run scripts/deploy/l1-contracts.ts --network ${network}`.env({
  L1_RPC_URL: l1RpcUrl,
  L1_CHAIN_ID: l1ChainId,
  ...process.env,
}).nothrow();

if (deployCmd.exitCode !== 0) {
  console.error("\n❌ L1 contract deployment failed");
  process.exit(1);
}

console.log("✅ L1 contracts deployed successfully\n");

// Step 3: Deploy L2 genesis
console.log("3️⃣  Configuring L2 Genesis...\n");
const genesisResult = await $`NETWORK=${network} bun run --cwd packages/deployment scripts/l2-genesis.ts`.env({
  ...process.env,
}).nothrow();

if (genesisResult.exitCode !== 0) {
  console.warn("⚠️  L2 genesis configuration failed (continuing anyway)");
} else {
  console.log("✅ L2 genesis configured\n");
}

// Step 4: Deploy DeFi protocols
console.log("4️⃣  Deploying DeFi Protocols...\n");
const defiResult = await $`bun run scripts/deploy/defi-protocols.ts`.env({
  NETWORK: network,
  ...process.env,
}).nothrow();

if (defiResult.exitCode !== 0) {
  console.warn("⚠️  DeFi protocol deployment failed (continuing anyway)");
} else {
  console.log("✅ DeFi protocols deployed\n");
}

// Step 5: Deploy account abstraction
console.log("5️⃣  Deploying Account Abstraction...\n");
const aaResult = await $`bun run scripts/deploy/account-abstraction.ts`.env({
  NETWORK: network,
  ...process.env,
}).nothrow();

if (aaResult.exitCode !== 0) {
  console.warn("⚠️  Account abstraction deployment failed (continuing anyway)");
} else {
  console.log("✅ Account abstraction deployed\n");
}

// Step 6: Verify contracts
console.log("6️⃣  Verifying Contracts on Etherscan...\n");
const verifyResult = await $`bun run scripts/verify-contracts.ts ${network}`.env({
  ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || "",
  ...process.env,
}).nothrow();

if (verifyResult.exitCode !== 0) {
  console.warn("⚠️  Contract verification failed (continuing anyway)");
} else {
  console.log("✅ Contracts verified\n");
}

// Step 7: Generate deployment report
console.log("7️⃣  Generating Deployment Report...\n");

const deploymentFile = `packages/contracts/deployments/${network}/deployment.json`;
if (existsSync(deploymentFile)) {
  const deploymentData = await Bun.file(deploymentFile).json();
  
  console.log("📋 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Network:           ${network.toUpperCase()}`);
  console.log(`Settlement Layer:  Ethereum ${isMainnet ? 'Mainnet' : 'Sepolia'} (Chain ID ${l1ChainId})`);
  console.log(`L2 Chain ID:       ${isMainnet ? '420691' : '420690'}`);
  console.log(`Timestamp:         ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  console.log("\n📦 Deployed Contracts:");
  for (const [name, address] of Object.entries(deploymentData)) {
    console.log(`  ${name.padEnd(30)} ${address}`);
  }
  console.log("");
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(`🎉 ${network.toUpperCase()} deployment complete!\n`);

console.log("📚 Next Steps:");
console.log(`  - Start services:   bun run start`);
console.log(`  - Run tests:        bun run test`);
console.log(`  - View deployments: ls packages/contracts/deployments/${network}/`);
console.log("");

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
