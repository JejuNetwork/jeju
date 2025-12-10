#!/usr/bin/env bun
/**
 * Jeju Token Localnet Deployment Script
 * 
 * Deploys JejuToken with full ecosystem setup for local development:
 * - JejuToken with faucet enabled
 * - BanManager integration
 * - TokenRegistry registration
 * - Liquidity pool setup (if available)
 * - Test wallet funding
 * 
 * Usage:
 *   bun run scripts/deploy-localnet-jeju.ts
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

// Default anvil private key
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Test accounts (anvil defaults)
const TEST_ACCOUNTS = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];

// Contracts directory
const CONTRACTS_DIR = "/Users/shawwalters/jeju/packages/contracts";

// Load compiled contract artifacts
function loadArtifact(name: string): { abi: readonly object[]; bytecode: `0x${string}` } {
  const artifactPath = path.join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  };
}

interface DeploymentResult {
  jejuToken: string;
  banManager: string;
  tokenRegistry: string | null;
  testAccountsFunded: string[];
  faucetEnabled: boolean;
  banEnforcementEnabled: boolean;
}

async function main() {
  console.log("🏝️  Jeju Token Localnet Deployment");
  console.log("=".repeat(50));
  
  // Setup clients
  const account = privateKeyToAccount(DEPLOYER_KEY);
  
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http("http://localhost:8545"),
  });
  
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http("http://localhost:8545"),
  });
  
  console.log(`\n👤 Deployer: ${account.address}`);
  
  // Check connection
  const chainId = await publicClient.getChainId();
  console.log(`🔗 Chain ID: ${chainId}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance: ${formatEther(balance)} ETH`);
  
  // Load artifacts
  console.log("\n📦 Loading contract artifacts...");
  const jejuTokenArtifact = loadArtifact("JejuToken");
  const banManagerArtifact = loadArtifact("BanManager");
  
  // Deploy BanManager
  console.log("\n🚀 Deploying BanManager...");
  const banManagerHash = await walletClient.deployContract({
    abi: banManagerArtifact.abi,
    bytecode: banManagerArtifact.bytecode,
    args: [account.address, account.address], // governance, owner
  });
  
  const banManagerReceipt = await publicClient.waitForTransactionReceipt({ hash: banManagerHash });
  const banManagerAddress = banManagerReceipt.contractAddress;
  console.log(`   BanManager: ${banManagerAddress}`);
  
  // Deploy JejuToken
  console.log("\n🚀 Deploying JejuToken...");
  const jejuTokenHash = await walletClient.deployContract({
    abi: jejuTokenArtifact.abi,
    bytecode: jejuTokenArtifact.bytecode,
    args: [
      account.address, // owner
      banManagerAddress, // ban manager
      true, // enable faucet
    ],
  });
  
  const jejuTokenReceipt = await publicClient.waitForTransactionReceipt({ hash: jejuTokenHash });
  const jejuTokenAddress = jejuTokenReceipt.contractAddress;
  console.log(`   JejuToken: ${jejuTokenAddress}`);
  
  // Get JejuToken contract
  const jeju = getContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });
  
  // Verify deployment
  const name = await publicClient.readContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    functionName: "name",
  });
  
  const symbol = await publicClient.readContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    functionName: "symbol",
  });
  
  const totalSupply = await publicClient.readContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    functionName: "totalSupply",
  }) as bigint;
  
  const faucetEnabled = await publicClient.readContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    functionName: "faucetEnabled",
  }) as boolean;
  
  const banEnforcement = await publicClient.readContract({
    address: jejuTokenAddress as `0x${string}`,
    abi: jejuTokenArtifact.abi,
    functionName: "banEnforcementEnabled",
  }) as boolean;
  
  console.log("\n📊 Token Info:");
  console.log(`   Name: ${name}`);
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Total Supply: ${formatEther(totalSupply)} ${symbol}`);
  console.log(`   Faucet Enabled: ${faucetEnabled}`);
  console.log(`   Ban Enforcement: ${banEnforcement}`);
  
  // Fund test accounts
  console.log("\n💸 Funding test accounts...");
  const fundAmount = parseEther("100000"); // 100k JEJU
  
  for (const testAccount of TEST_ACCOUNTS) {
    const hash = await walletClient.writeContract({
      address: jejuTokenAddress as `0x${string}`,
      abi: jejuTokenArtifact.abi,
      functionName: "transfer",
      args: [testAccount as `0x${string}`, fundAmount],
    });
    
    await publicClient.waitForTransactionReceipt({ hash });
    
    const testBalance = await publicClient.readContract({
      address: jejuTokenAddress as `0x${string}`,
      abi: jejuTokenArtifact.abi,
      functionName: "balanceOf",
      args: [testAccount as `0x${string}`],
    }) as bigint;
    
    console.log(`   ${testAccount}: ${formatEther(testBalance)} JEJU`);
  }
  
  // Save deployment info
  const deploymentResult: DeploymentResult = {
    jejuToken: jejuTokenAddress!,
    banManager: banManagerAddress!,
    tokenRegistry: null,
    testAccountsFunded: TEST_ACCOUNTS,
    faucetEnabled,
    banEnforcementEnabled: banEnforcement,
  };
  
  // Update localnet deployment file
  const deploymentPath = path.join(CONTRACTS_DIR, "deployments/localnet/deployment.json");
  let deployment: Record<string, unknown> = {};
  
  if (existsSync(deploymentPath)) {
    deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  }
  
  deployment.tokens = {
    ...((deployment.tokens as Record<string, unknown>) || {}),
    jeju: jejuTokenAddress,
  };
  
  deployment.moderation = {
    ...((deployment.moderation as Record<string, unknown>) || {}),
    banManager: banManagerAddress,
  };
  
  deployment.deployedAt = new Date().toISOString();
  
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n💾 Updated: ${deploymentPath}`);
  
  // Create jeju-specific deployment file
  const jejuDeploymentPath = path.join(CONTRACTS_DIR, "deployments/localnet/jeju-token.json");
  writeFileSync(jejuDeploymentPath, JSON.stringify(deploymentResult, null, 2));
  console.log(`💾 Created: ${jejuDeploymentPath}`);
  
  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("✅ Jeju Token Deployment Complete!");
  console.log("=".repeat(50));
  console.log("\nAddresses:");
  console.log(`  JejuToken: ${jejuTokenAddress}`);
  console.log(`  BanManager: ${banManagerAddress}`);
  console.log("\nTest Commands:");
  console.log(`  # Get faucet tokens:`);
  console.log(`  cast send ${jejuTokenAddress} "faucet()" --rpc-url http://localhost:8545 --private-key <KEY>`);
  console.log(`\n  # Check balance:`);
  console.log(`  cast call ${jejuTokenAddress} "balanceOf(address)(uint256)" <ADDRESS> --rpc-url http://localhost:8545`);
  console.log(`\n  # Ban a user (as governance):`);
  console.log(`  cast send ${banManagerAddress} "applyAddressBan(address,bytes32,string)" <USER> 0x0...1 "reason" --rpc-url http://localhost:8545 --private-key ${DEPLOYER_KEY}`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
