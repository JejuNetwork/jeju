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

const PRIVATE_KEY = (process.env.PRIVATE_KEY || process.env.MAINNET_PRIVATE_KEY) as `0x${string}`;
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY required");
  process.exit(1);
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

async function deployToChain(chainName: string, rpcUrl: string): Promise<Record<string, string>> {
  console.log(`\n📦 Deploying to ${chainName}...`);
  
  const contracts: Record<string, string> = {};
  
  // Deploy IdentityRegistry
  console.log("   1. Deploying IdentityRegistry...");
  try {
    const output = execSync(
      `forge script script/DeployIdentityRegistry.s.sol:DeployIdentityRegistry --rpc-url ${rpcUrl} --broadcast --legacy`,
      {
        cwd: "/Users/shawwalters/jeju/packages/contracts",
        env: {
          ...process.env,
          PRIVATE_KEY,
          DEPLOYER_PRIVATE_KEY: PRIVATE_KEY,
          BASESCAN_API_KEY: "dummy",
          ETHERSCAN_API_KEY: "dummy",
        },
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    
    const match = output.match(/IdentityRegistry:\s*(0x[a-fA-F0-9]{40})/);
    if (match) {
      contracts.IdentityRegistry = match[1];
      console.log(`      ✅ IdentityRegistry: ${match[1]}`);
    }
  } catch (e: any) {
    console.error("      ❌ Failed:", e.message);
  }
  
  // Deploy OIF
  console.log("   2. Deploying OIF Contracts...");
  try {
    const output = execSync(
      `forge script script/DeployOIF.s.sol:DeployOIF --rpc-url ${rpcUrl} --broadcast --legacy`,
      {
        cwd: "/Users/shawwalters/jeju/packages/contracts",
        env: {
          ...process.env,
          PRIVATE_KEY,
          ORACLE_TYPE: "simple",
          BASESCAN_API_KEY: "dummy",
          ETHERSCAN_API_KEY: "dummy",
        },
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    
    // Parse OIF addresses
    const patterns = [
      { name: "SolverRegistry", pattern: /SolverRegistry deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "SimpleOracle", pattern: /SimpleOracle deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "InputSettler", pattern: /InputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/ },
      { name: "OutputSettler", pattern: /OutputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/ },
    ];
    
    for (const { name, pattern } of patterns) {
      const match = output.match(pattern);
      if (match) {
        contracts[name] = match[1];
        console.log(`      ✅ ${name}: ${match[1]}`);
      }
    }
  } catch (e: any) {
    console.error("      ❌ OIF deployment failed:", e.message);
  }
  
  // Deploy MockUSDC
  console.log("   3. Deploying Test USDC...");
  try {
    // Create a simple deploy script inline
    const output = execSync(
      `cast send --rpc-url ${rpcUrl} --private-key ${PRIVATE_KEY} --create $(cat out/MockJejuUSDC.sol/MockJejuUSDC.json | jq -r '.bytecode.object')$(cast abi-encode "constructor(address)" ${account.address}) 2>&1`,
      {
        cwd: "/Users/shawwalters/jeju/packages/contracts",
        encoding: "utf-8",
      }
    );
    
    const match = output.match(/contractAddress\s+(0x[a-fA-F0-9]{40})/);
    if (match) {
      contracts.USDC = match[1];
      console.log(`      ✅ USDC: ${match[1]}`);
    }
  } catch (e: any) {
    // Try forge create instead
    try {
      const output = execSync(
        `forge create src/tokens/MockJejuUSDC.sol:MockJejuUSDC --rpc-url ${rpcUrl} --private-key ${PRIVATE_KEY} --constructor-args ${account.address} --legacy`,
        {
          cwd: "/Users/shawwalters/jeju/packages/contracts",
          encoding: "utf-8",
        }
      );
      
      const match = output.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/);
      if (match) {
        contracts.USDC = match[1];
        console.log(`      ✅ USDC: ${match[1]}`);
      }
    } catch (e2: any) {
      console.error("      ❌ USDC deployment failed");
    }
  }
  
  // Deploy ElizaOSToken
  console.log("   4. Deploying ElizaOS Token...");
  try {
    const output = execSync(
      `forge create src/tokens/ElizaOSToken.sol:ElizaOSToken --rpc-url ${rpcUrl} --private-key ${PRIVATE_KEY} --constructor-args ${account.address} --legacy`,
      {
        cwd: "/Users/shawwalters/jeju/packages/contracts",
        encoding: "utf-8",
      }
    );
    
    const match = output.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/);
    if (match) {
      contracts.ElizaOSToken = match[1];
      console.log(`      ✅ ElizaOSToken: ${match[1]}`);
    }
  } catch (e: any) {
    console.error("      ❌ ElizaOSToken deployment failed");
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

