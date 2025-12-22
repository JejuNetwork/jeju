#!/usr/bin/env bun
/**
 * Fund and Deploy Script
 * 
 * Checks balances, provides faucet links, and deploys when funded.
 * 
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/fund-and-deploy.ts
 */

import { createPublicClient, http, formatEther, parseEther, type Address } from "viem";
import { sepolia, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

const PRIVATE_KEY_RAW = process.env.PRIVATE_KEY ?? process.env.MAINNET_PRIVATE_KEY;
if (!PRIVATE_KEY_RAW) {
  console.error("❌ PRIVATE_KEY required");
  process.exit(1);
}

// Type guard ensures PRIVATE_KEY is valid hex string after validation
const PRIVATE_KEY = PRIVATE_KEY_RAW as `0x${string}`;

/**
 * Execute a shell command and return the output
 * @throws Error with command output on failure
 */
function exec(command: string, cwd: string, env?: Record<string, string>): string {
  return execSync(command, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Extract an address from command output using a pattern
 */
function extractAddress(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1];
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log("\n🔑 Deployer Address:", account.address);

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

async function checkBalances() {
  const sepoliaBalance = await sepoliaClient.getBalance({ address: account.address });
  const baseSepoliaBalance = await baseSepoliaClient.getBalance({ address: account.address });
  
  console.log("\n💰 Balances:");
  console.log(`   Sepolia:      ${formatEther(sepoliaBalance)} ETH`);
  console.log(`   Base Sepolia: ${formatEther(baseSepoliaBalance)} ETH`);
  
  return { sepoliaBalance, baseSepoliaBalance };
}

function printFaucetLinks() {
  console.log("\n💧 Get testnet ETH from these faucets:");
  console.log(`   Address to fund: ${account.address}`);
  console.log("");
  console.log("   Sepolia Faucets:");
  console.log("   - https://sepoliafaucet.com");
  console.log("   - https://sepolia-faucet.pk910.de");
  console.log("   - https://www.alchemy.com/faucets/ethereum-sepolia");
  console.log("");
  console.log("   Base Sepolia Faucets:");
  console.log("   - https://www.coinbase.com/faucets/base-ethereum-goerli-faucet");
  console.log("   - https://bwarelabs.com/faucets/base-testnet");
}

const CONTRACTS_DIR = "/Users/shawwalters/jeju/packages/contracts";

interface DeploymentResult {
  name: string;
  address?: string;
  error?: string;
}

/**
 * Deploy a contract using forge script
 */
function deployWithForgeScript(
  scriptPath: string,
  rpcUrl: string,
  addressPattern: RegExp,
  env: Record<string, string>
): DeploymentResult[] {
  const results: DeploymentResult[] = [];
  const output = exec(
    `forge script ${scriptPath} --rpc-url ${rpcUrl} --broadcast --legacy`,
    CONTRACTS_DIR,
    { PRIVATE_KEY, ...env }
  );
  
  // Handle both single and multiple patterns
  if (Array.isArray(addressPattern)) {
    for (const { name, pattern } of addressPattern) {
      const address = extractAddress(output, pattern);
      results.push({ name, address });
    }
  } else {
    const address = extractAddress(output, addressPattern);
    results.push({ name: scriptPath, address });
  }
  
  return results;
}

/**
 * Deploy a contract using forge create
 */
function deployWithForgeCreate(
  contractPath: string,
  rpcUrl: string,
  constructorArgs: string[]
): string | undefined {
  const output = exec(
    `forge create ${contractPath} --rpc-url ${rpcUrl} --private-key ${PRIVATE_KEY} --constructor-args ${constructorArgs.join(" ")} --legacy`,
    CONTRACTS_DIR
  );
  return extractAddress(output, /Deployed to:\s*(0x[a-fA-F0-9]{40})/);
}

async function deployToChain(chainName: string, rpcUrl: string): Promise<Record<string, string>> {
  console.log(`\n📦 Deploying to ${chainName}...`);
  
  const contracts: Record<string, string> = {};
  
  // Deploy IdentityRegistry
  console.log("   1. Deploying IdentityRegistry...");
  try {
    const output = exec(
      `forge script script/DeployIdentityRegistry.s.sol:DeployIdentityRegistry --rpc-url ${rpcUrl} --broadcast --legacy`,
      CONTRACTS_DIR,
      { PRIVATE_KEY, DEPLOYER_PRIVATE_KEY: PRIVATE_KEY, BASESCAN_API_KEY: "dummy", ETHERSCAN_API_KEY: "dummy" }
    );
    const address = extractAddress(output, /IdentityRegistry:\s*(0x[a-fA-F0-9]{40})/);
    if (address) {
      contracts.IdentityRegistry = address;
      console.log(`      ✅ IdentityRegistry: ${address}`);
    }
  } catch (e: Error | unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("      ❌ Failed:", message);
  }
  
  // Deploy OIF
  console.log("   2. Deploying OIF Contracts...");
  try {
    const output = exec(
      `forge script script/DeployOIF.s.sol:DeployOIF --rpc-url ${rpcUrl} --broadcast --legacy`,
      CONTRACTS_DIR,
      { PRIVATE_KEY, ORACLE_TYPE: "simple", BASESCAN_API_KEY: "dummy", ETHERSCAN_API_KEY: "dummy" }
    );
    
    const oifPatterns = [
      { name: "SolverRegistry", pattern: /SolverRegistry deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "SimpleOracle", pattern: /SimpleOracle deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "InputSettler", pattern: /InputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "OutputSettler", pattern: /OutputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/ },
    ];
    
    for (const { name, pattern } of oifPatterns) {
      const address = extractAddress(output, pattern);
      if (address) {
        contracts[name] = address;
        console.log(`      ✅ ${name}: ${address}`);
      }
    }
  } catch (e: Error | unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("      ❌ OIF deployment failed:", message);
  }
  
  // Deploy MockUSDC - try cast first, fall back to forge create
  console.log("   3. Deploying Test USDC...");
  try {
    const castOutput = exec(
      `cast send --rpc-url ${rpcUrl} --private-key ${PRIVATE_KEY} --create $(cat out/MockNetworkUSDC.sol/MockNetworkUSDC.json | jq -r '.bytecode.object')$(cast abi-encode "constructor(address)" ${account.address}) 2>&1`,
      CONTRACTS_DIR
    );
    const address = extractAddress(castOutput, /contractAddress\s+(0x[a-fA-F0-9]{40})/);
    if (address) {
      contracts.USDC = address;
      console.log(`      ✅ USDC: ${address}`);
    }
  } catch {
    // Fall back to forge create
    try {
      const address = deployWithForgeCreate(
        "src/tokens/MockNetworkUSDC.sol:MockNetworkUSDC",
        rpcUrl,
        [account.address]
      );
      if (address) {
        contracts.USDC = address;
        console.log(`      ✅ USDC: ${address}`);
      }
    } catch (e: Error | unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("      ❌ USDC deployment failed:", message);
    }
  }
  
  // Deploy ElizaOSToken
  console.log("   4. Deploying ElizaOS Token...");
  try {
    const address = deployWithForgeCreate(
      "src/tokens/ElizaOSToken.sol:ElizaOSToken",
      rpcUrl,
      [account.address]
    );
    if (address) {
      contracts.ElizaOSToken = address;
      console.log(`      ✅ ElizaOSToken: ${address}`);
    }
  } catch (e: Error | unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("      ❌ ElizaOSToken deployment failed:", message);
  }
  
  return contracts;
}

async function main() {
  console.log("🚀 Testnet Deployment Helper");
  console.log("=".repeat(50));
  
  const { sepoliaBalance, baseSepoliaBalance } = await checkBalances();
  
  const MIN_BALANCE = parseEther("0.01");
  
  if (sepoliaBalance < MIN_BALANCE && baseSepoliaBalance < MIN_BALANCE) {
    printFaucetLinks();
    console.log("\n⏳ Waiting for funds... Run this script again after funding.");
    console.log("   Need at least 0.01 ETH on each chain for deployment.\n");
    
    // Poll for funds
    console.log("   Auto-checking every 30 seconds...");
    while (true) {
      await new Promise(r => setTimeout(r, 30000));
      const { sepoliaBalance: newSep, baseSepoliaBalance: newBase } = await checkBalances();
      if (newSep >= MIN_BALANCE || newBase >= MIN_BALANCE) {
        console.log("\n✅ Funds received! Starting deployment...");
        break;
      }
    }
  }
  
  const results: Record<string, Record<string, string>> = {};
  
  // Deploy to Sepolia
  const newSepoliaBalance = await sepoliaClient.getBalance({ address: account.address });
  if (newSepoliaBalance >= MIN_BALANCE) {
    results.sepolia = await deployToChain("Sepolia", "https://ethereum-sepolia-rpc.publicnode.com");
  } else {
    console.log("\n⚠️  Skipping Sepolia (insufficient funds)");
  }
  
  // Deploy to Base Sepolia
  const newBaseBalance = await baseSepoliaClient.getBalance({ address: account.address });
  if (newBaseBalance >= MIN_BALANCE) {
    results["base-sepolia"] = await deployToChain("Base Sepolia", "https://sepolia.base.org");
  } else {
    console.log("\n⚠️  Skipping Base Sepolia (insufficient funds)");
  }
  
  // Save results
  console.log("\n" + "=".repeat(50));
  console.log("📝 DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  
  console.log(JSON.stringify(results, null, 2));
  
  writeFileSync(
    "/Users/shawwalters/jeju/packages/contracts/deployments/testnet-deployment.json",
    JSON.stringify(results, null, 2)
  );
  
  console.log("\n💾 Saved to: deployments/testnet-deployment.json");
  
  // Generate cloud config updates
  if (Object.keys(results).length > 0) {
    console.log("\n📋 Update these in cloud config:");
    for (const [network, contracts] of Object.entries(results)) {
      console.log(`\n${network}:`);
      for (const [name, addr] of Object.entries(contracts)) {
        console.log(`  ${name}: "${addr}"`);
      }
    }
  }
}

main().catch(console.error);

