#!/usr/bin/env bun

/**
 * Deploy to Mainnet
 * 
 * Deploys all contracts to Jeju Mainnet.
 * Config loaded from packages/config/chain/mainnet.json
 * 
 * Requirements:
 *   - DEPLOYER_PRIVATE_KEY set
 *   - Mainnet ETH in deployer wallet
 *   - Security checklist complete
 * 
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   bun run scripts/deploy/mainnet.ts
 */

import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { loadChainConfig, getDeployerConfig } from "@jejunetwork/config/network";
import { checkNetworkOrSkip } from "../shared/network-check";

const NETWORK = "mainnet";
const CONTRACTS_DIR = join(process.cwd(), "packages", "contracts");
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, "deployments", NETWORK);

async function main() {
  console.log("\n🚀 Jeju MAINNET Deployment\n");
  
  // Security checklist
  console.log("⚠️  MAINNET CHECKLIST:\n");
  const checklist = [
    "Testnet stable 4+ weeks",
    "Security audit complete",
    "Bug bounty active",
    "Multisig configured",
    "Monitoring deployed",
    "Sufficient ETH"
  ];
  
  for (const item of checklist) {
    console.log(`  [ ] ${item}`);
  }
  
  console.log("\n❌ DO NOT PROCEED unless all items checked\n");
  
  const confirm = prompt("Type 'DEPLOY' to continue: ");
  if (confirm !== "DEPLOY") {
    console.log("\nDeployment cancelled");
    process.exit(0);
  }
  
  // Load config
  const config = loadChainConfig(NETWORK);
  console.log(`\nChain ID: ${config.chainId}`);
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`L1: ${config.l1Name} (${config.l1ChainId})`);
  
  // Check network
  const available = await checkNetworkOrSkip(NETWORK, "deployment");
  if (!available) {
    process.exit(1);
  }
  
  // Check deployer
  const deployer = getDeployerConfig();
  console.log(`\nDeployer: ${deployer.address}`);
  
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("\n❌ DEPLOYER_PRIVATE_KEY not set");
    process.exit(1);
  }
  
  // Ensure directory exists
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  
  console.log("\n📦 Deploying...\n");
  
  // Dry run first
  console.log("Running dry run...");
  const dryRun = await $`cd ${CONTRACTS_DIR} && forge script script/Deploy.s.sol \
    --rpc-url ${config.rpcUrl} \
    --private-key ${process.env.DEPLOYER_PRIVATE_KEY}`.nothrow();
  
  if (dryRun.exitCode !== 0) {
    console.error("\n❌ Dry run failed");
    process.exit(1);
  }
  
  console.log("Dry run passed. Broadcasting...\n");
  
  // Deploy
  const result = await $`cd ${CONTRACTS_DIR} && forge script script/Deploy.s.sol \
    --rpc-url ${config.rpcUrl} \
    --private-key ${process.env.DEPLOYER_PRIVATE_KEY} \
    --broadcast \
    --verify \
    --slow`.nothrow();
  
  if (result.exitCode !== 0) {
    console.error("\n❌ Deployment failed");
    process.exit(1);
  }
  
  // Save deployment
  const deployment = {
    network: NETWORK,
    chainId: config.chainId,
    l1ChainId: config.l1ChainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };
  
  writeFileSync(
    join(DEPLOYMENTS_DIR, "deployment.json"),
    JSON.stringify(deployment, null, 2)
  );
  
  console.log("\n✅ Mainnet deployment complete");
  console.log(`📄 Saved to: ${DEPLOYMENTS_DIR}/deployment.json`);
  console.log("\n⚠️  Monitor closely for 48 hours");
}

main();
