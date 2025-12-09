#!/usr/bin/env bun
/**
 * Full Testnet Deployment Script
 * 
 * Deploys all contracts to both Sepolia and Base Sepolia for cross-chain OIF testing.
 * 
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy-testnet-full.ts
 */

import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

// Configuration
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const SEPOLIA_CHAIN_ID = 11155111;
const BASE_SEPOLIA_CHAIN_ID = 84532;

// Get private key from env
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.MAINNET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY or MAINNET_PRIVATE_KEY environment variable required");
  process.exit(1);
}

interface DeploymentResult {
  chainId: number;
  network: string;
  contracts: Record<string, string>;
  txHashes: string[];
}

const results: DeploymentResult[] = [];

function runForgeScript(script: string, rpcUrl: string, additionalArgs: string[] = []): string {
  const cmd = [
    "forge", "script", script,
    "--rpc-url", rpcUrl,
    "--broadcast",
    "--legacy", // Some RPCs don't support EIP-1559
    "-vvv",
    ...additionalArgs,
  ].join(" ");
  
  console.log(`\n📝 Running: ${cmd}\n`);
  
  try {
    const output = execSync(cmd, {
      cwd: "/Users/shawwalters/jeju/packages/contracts",
      env: {
        ...process.env,
        PRIVATE_KEY: PRIVATE_KEY,
        DEPLOYER_PRIVATE_KEY: PRIVATE_KEY,
      },
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch (error: any) {
    console.error("Script failed:", error.message);
    if (error.stdout) console.log("Stdout:", error.stdout);
    if (error.stderr) console.error("Stderr:", error.stderr);
    throw error;
  }
}

function parseAddresses(output: string): Record<string, string> {
  const addresses: Record<string, string> = {};
  
  // Parse "ContractName: 0x..." or "ContractName deployed to: 0x..."
  const patterns = [
    /(\w+):\s*(0x[a-fA-F0-9]{40})/g,
    /(\w+)\s+deployed\s+to:\s*(0x[a-fA-F0-9]{40})/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      addresses[match[1]] = match[2];
    }
  }
  
  return addresses;
}

async function checkBalance(rpcUrl: string, address: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });
  const data = await response.json();
  return BigInt(data.result || "0");
}

async function main() {
  console.log("🚀 Full Testnet Deployment - Sepolia + Base Sepolia");
  console.log("=".repeat(60));
  
  // Get deployer address from private key
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`\n👤 Deployer: ${account.address}`);
  
  // Check balances
  console.log("\n💰 Checking balances...");
  const sepoliaBalance = await checkBalance(SEPOLIA_RPC, account.address);
  const baseSepoliaBalance = await checkBalance(BASE_SEPOLIA_RPC, account.address);
  
  console.log(`   Sepolia: ${Number(sepoliaBalance) / 1e18} ETH`);
  console.log(`   Base Sepolia: ${Number(baseSepoliaBalance) / 1e18} ETH`);
  
  if (sepoliaBalance < BigInt(1e16)) {
    console.log("⚠️  Low Sepolia balance. Get testnet ETH from https://sepoliafaucet.com");
  }
  if (baseSepoliaBalance < BigInt(1e16)) {
    console.log("⚠️  Low Base Sepolia balance. Get testnet ETH from https://www.coinbase.com/faucets/base-ethereum-goerli-faucet");
  }
  
  // ========================================
  // Deploy to Sepolia
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("📦 DEPLOYING TO SEPOLIA (Chain ID: 11155111)");
  console.log("=".repeat(60));
  
  let sepoliaContracts: Record<string, string> = {};
  
  // Deploy Cloud Integration (tokens + registries)
  console.log("\n1️⃣ Deploying Cloud Integration (Tokens + Registries)...");
  try {
    const cloudOutput = runForgeScript(
      "script/DeployCloudIntegration.s.sol:DeployCloudIntegration",
      SEPOLIA_RPC
    );
    const cloudAddresses = parseAddresses(cloudOutput);
    sepoliaContracts = { ...sepoliaContracts, ...cloudAddresses };
    console.log("✅ Cloud Integration deployed");
  } catch (e) {
    console.error("❌ Cloud Integration deployment failed");
  }
  
  // Deploy OIF (Solver Registry, Settlers)
  console.log("\n2️⃣ Deploying OIF Contracts...");
  try {
    const oifOutput = runForgeScript(
      "script/DeployOIF.s.sol:DeployOIF",
      SEPOLIA_RPC,
      ["--env", "ORACLE_TYPE=simple"]
    );
    const oifAddresses = parseAddresses(oifOutput);
    sepoliaContracts = { ...sepoliaContracts, ...oifAddresses };
    console.log("✅ OIF deployed");
  } catch (e) {
    console.error("❌ OIF deployment failed");
  }
  
  results.push({
    chainId: SEPOLIA_CHAIN_ID,
    network: "sepolia",
    contracts: sepoliaContracts,
    txHashes: [],
  });
  
  // ========================================
  // Deploy to Base Sepolia
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("📦 DEPLOYING TO BASE SEPOLIA (Chain ID: 84532)");
  console.log("=".repeat(60));
  
  let baseSepoliaContracts: Record<string, string> = {};
  
  // Deploy Cloud Integration
  console.log("\n1️⃣ Deploying Cloud Integration (Tokens + Registries)...");
  try {
    const cloudOutput = runForgeScript(
      "script/DeployCloudIntegration.s.sol:DeployCloudIntegration",
      BASE_SEPOLIA_RPC
    );
    const cloudAddresses = parseAddresses(cloudOutput);
    baseSepoliaContracts = { ...baseSepoliaContracts, ...cloudAddresses };
    console.log("✅ Cloud Integration deployed");
  } catch (e) {
    console.error("❌ Cloud Integration deployment failed");
  }
  
  // Deploy OIF
  console.log("\n2️⃣ Deploying OIF Contracts...");
  try {
    const oifOutput = runForgeScript(
      "script/DeployOIF.s.sol:DeployOIF",
      BASE_SEPOLIA_RPC,
      ["--env", "ORACLE_TYPE=simple"]
    );
    const oifAddresses = parseAddresses(oifOutput);
    baseSepoliaContracts = { ...baseSepoliaContracts, ...oifAddresses };
    console.log("✅ OIF deployed");
  } catch (e) {
    console.error("❌ OIF deployment failed");
  }
  
  results.push({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    network: "base-sepolia",
    contracts: baseSepoliaContracts,
    txHashes: [],
  });
  
  // ========================================
  // Save Results
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("📝 DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  
  for (const result of results) {
    console.log(`\n${result.network.toUpperCase()} (${result.chainId}):`);
    for (const [name, address] of Object.entries(result.contracts)) {
      console.log(`  ${name}: ${address}`);
    }
  }
  
  // Save to deployment files
  const deploymentsDir = path.join("/Users/shawwalters/jeju/packages/contracts/deployments/testnet");
  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }
  
  for (const result of results) {
    const filePath = path.join(deploymentsDir, `${result.network}.json`);
    writeFileSync(filePath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved: ${filePath}`);
  }
  
  // Generate env file for Cloud
  const envContent = [
    "# Auto-generated from deploy-testnet-full.ts",
    `# Deployed at: ${new Date().toISOString()}`,
    "",
    "# Sepolia",
    ...Object.entries(results[0]?.contracts || {}).map(
      ([k, v]) => `${k.toUpperCase()}_SEPOLIA=${v}`
    ),
    "",
    "# Base Sepolia",
    ...Object.entries(results[1]?.contracts || {}).map(
      ([k, v]) => `${k.toUpperCase()}_BASE_SEPOLIA=${v}`
    ),
  ].join("\n");
  
  const envPath = path.join(deploymentsDir, "contracts.env");
  writeFileSync(envPath, envContent);
  console.log(`\n💾 Saved env: ${envPath}`);
  
  console.log("\n✅ Deployment complete!");
  console.log("\nNext steps:");
  console.log("1. Update cloud config with deployed addresses");
  console.log("2. Register Eliza Cloud as agent on both networks");
  console.log("3. Configure OIF routes for cross-chain intents");
}

main().catch(console.error);

