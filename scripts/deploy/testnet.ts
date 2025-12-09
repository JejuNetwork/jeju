#!/usr/bin/env bun

/**
 * Deploy to Testnet
 * 
 * Deploys all contracts to Jeju Testnet.
 * Config loaded from packages/config/chain/testnet.json
 * 
 * Requirements:
 *   - DEPLOYER_PRIVATE_KEY set
 *   - Testnet ETH in deployer wallet
 * 
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   bun run scripts/deploy/testnet.ts
 */

import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { loadChainConfig, getDeployerConfig } from "@jejunetwork/config/network";
import { checkNetworkOrSkip } from "../shared/network-check";

const NETWORK = "testnet";
const CONTRACTS_DIR = join(process.cwd(), "packages", "contracts");
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, "deployments", NETWORK);

async function main() {
  console.log(`\n🚀 Deploying to Jeju ${NETWORK.toUpperCase()}\n`);
  
  // Load config from JSON
  const config = loadChainConfig(NETWORK);
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`L1: ${config.l1Name} (${config.l1ChainId})`);
  
  // Check network is available
  const available = await checkNetworkOrSkip(NETWORK, "deployment");
  if (!available) {
    process.exit(1);
  }
  
  // Check deployer
  const deployer = getDeployerConfig();
  console.log(`\nDeployer: ${deployer.address}`);
  
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("\n❌ DEPLOYER_PRIVATE_KEY not set");
    console.log("   export DEPLOYER_PRIVATE_KEY=0x...");
    process.exit(1);
  }
  
  // Ensure deployments directory exists
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  
  console.log("\n📦 Deploying contracts...\n");
  
  // Deploy core contracts
  const result = await $`cd ${CONTRACTS_DIR} && forge script script/Deploy.s.sol \
    --rpc-url ${config.rpcUrl} \
    --private-key ${process.env.DEPLOYER_PRIVATE_KEY} \
    --broadcast \
    --json`.nothrow();
  
  if (result.exitCode !== 0) {
    console.error("\n❌ Deployment failed");
    console.log(result.stderr.toString());
    process.exit(1);
  }
  
  // Update deployment file
  const deployment = {
    network: NETWORK,
    chainId: config.chainId,
    l1ChainId: config.l1ChainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    // Contract addresses populated by forge script
  };
  
  writeFileSync(
    join(DEPLOYMENTS_DIR, "deployment.json"),
    JSON.stringify(deployment, null, 2)
  );
  
  console.log("\n✅ Deployment complete");
  console.log(`📄 Saved to: ${DEPLOYMENTS_DIR}/deployment.json`);
  
  // Verify if API key available
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("\n📝 Verifying contracts...");
    await $`bun run scripts/verify-contracts.ts --network ${NETWORK}`.nothrow();
  } else {
    console.log("\n💡 Set ETHERSCAN_API_KEY to auto-verify contracts");
  }
}

main();
