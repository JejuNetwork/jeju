#!/usr/bin/env bun
/**
 * Generate L2 genesis files using op-node
 * 
 * Usage:
 *   NETWORK=testnet bun run scripts/l2-genesis.ts
 * 
 * Prerequisites:
 *   - op-node installed: go install github.com/ethereum-optimism/optimism/op-node/cmd/...@latest
 *   - L1 contracts deployed (l1-deployment.json)
 *   - Deploy config updated with operator addresses
 */

import { $ } from "bun";
import { existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";

const NETWORK = process.env.NETWORK || "testnet";
const PROJECT_ROOT = join(import.meta.dir, "../../..");
const CONTRACTS_DIR = join(PROJECT_ROOT, "packages/contracts");
const HELM_CONFIG_DIR = join(PROJECT_ROOT, "packages/deployment/kubernetes/helm");

async function checkOpNode(): Promise<boolean> {
  const result = await $`which op-node`.quiet().nothrow();
  return result.exitCode === 0;
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Jeju Network - L2 Genesis Generation                                ║
║  Network: ${NETWORK.padEnd(59)}║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Check prerequisites
  if (!await checkOpNode()) {
    console.error("❌ op-node not found");
    console.error("   Install: go install github.com/ethereum-optimism/optimism/op-node/cmd/...@latest");
    console.error("   Or download from: https://github.com/ethereum-optimism/optimism/releases");
    process.exit(1);
  }
  console.log("✅ op-node found");

  const deploymentsDir = join(CONTRACTS_DIR, "deployments", NETWORK);
  const l1DeploymentsPath = join(deploymentsDir, "l1-deployment.json");
  const deployConfigPath = join(CONTRACTS_DIR, "deploy-config", `${NETWORK}.json`);

  if (!existsSync(l1DeploymentsPath)) {
    console.error(`❌ L1 deployments not found: ${l1DeploymentsPath}`);
    console.error("   Deploy L1 contracts first:");
    console.error("   bun run scripts/deploy/deploy-l1-contracts.ts");
    process.exit(1);
  }
  console.log("✅ L1 deployments found");

  if (!existsSync(deployConfigPath)) {
    console.error(`❌ Deploy config not found: ${deployConfigPath}`);
    process.exit(1);
  }

  const deployConfig = JSON.parse(readFileSync(deployConfigPath, "utf-8"));
  if (deployConfig.p2pSequencerAddress === "0x0000000000000000000000000000000000000000") {
    console.error("❌ Deploy config not updated with operator addresses");
    console.error("   Run: bun run scripts/deploy/update-deploy-config.ts");
    process.exit(1);
  }
  console.log("✅ Deploy config has operator addresses");

  const l1Deployment = JSON.parse(readFileSync(l1DeploymentsPath, "utf-8"));

  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }

  const genesisPath = join(deploymentsDir, "genesis.json");
  const rollupPath = join(deploymentsDir, "rollup.json");

  // Create L1 deployments file in format expected by op-node
  const l1DeploymentsFormatted = join(deploymentsDir, "l1-deployments-formatted.json");
  writeFileSync(l1DeploymentsFormatted, JSON.stringify(l1Deployment.contracts || l1Deployment, null, 2));

  console.log("\n🔧 Generating L2 genesis...");

  const result = await $`op-node genesis l2 \
    --deploy-config ${deployConfigPath} \
    --l1-deployments ${l1DeploymentsFormatted} \
    --outfile.l2 ${genesisPath} \
    --outfile.rollup ${rollupPath}`.nothrow();

  if (result.exitCode !== 0) {
    console.error("❌ L2 genesis generation failed");
    console.error("   Check that op-node version matches the L1 contract deployment");
    process.exit(1);
  }

  console.log("✅ L2 genesis generated");
  console.log(`   genesis.json: ${genesisPath}`);
  console.log(`   rollup.json: ${rollupPath}`);

  // Copy rollup config to Helm chart directories for Kubernetes deployment
  const helmDirs = [
    join(HELM_CONFIG_DIR, "op-node/files"),
    join(HELM_CONFIG_DIR, "op-batcher/files"),
    join(HELM_CONFIG_DIR, "op-proposer/files"),
  ];

  for (const dir of helmDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    copyFileSync(rollupPath, join(dir, "rollup.json"));
  }
  console.log("✅ Copied rollup.json to Helm chart directories");

  // Generate JWT secret for engine API
  const jwtSecret = Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  
  const jwtSecretPath = join(deploymentsDir, "jwt-secret.txt");
  writeFileSync(jwtSecretPath, jwtSecret);
  console.log(`✅ Generated JWT secret: ${jwtSecretPath}`);

  console.log(`
═══════════════════════════════════════════════════════════════════════
GENESIS GENERATION COMPLETE
═══════════════════════════════════════════════════════════════════════

Files created:
  - ${genesisPath}
  - ${rollupPath}
  - ${jwtSecretPath}

Next steps:
  1. Create Kubernetes secrets from these files
  2. Deploy OP Stack services:
     NETWORK=${NETWORK} bun run packages/deployment/scripts/helmfile.ts sync

═══════════════════════════════════════════════════════════════════════
`);
}

main();

