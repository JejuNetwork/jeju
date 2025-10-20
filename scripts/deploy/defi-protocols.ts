#!/usr/bin/env bun
import { $ } from "bun";
import { resolve } from "path";
import { getChainConfig } from "../../config";
import type { NetworkType } from "../../types";

async function main() {
  const network = (process.argv[3] || 'local') as NetworkType;
  console.log(`🚀 Deploying DeFi protocols to ${network}...`);

  const config = getChainConfig(network);
  const contractsDir = resolve(process.cwd(), "contracts");

  await $`cd ${contractsDir} && forge script script/DeployDeFi.s.sol --rpc-url ${config.rpcUrl} --broadcast --verify -vvvv`;

  console.log("\n✅ DeFi protocols deployed successfully!");
}

main().catch((err) => {
  console.error("\n❌ DeFi deployment failed:", err);
  process.exit(1);
});
