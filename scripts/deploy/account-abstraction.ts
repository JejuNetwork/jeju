#!/usr/bin/env bun
import { $ } from "bun";
import { resolve } from "path";
import { getChainConfig } from "@jejunetwork/config";
import type { NetworkType } from "@jejunetwork/types";

async function main() {
  const network = (process.argv[3] || 'local') as NetworkType;
  console.log(`🚀 Deploying Account Abstraction contracts to ${network}...`);

  const config = getChainConfig(network);
  const contractsDir = resolve(process.cwd(), "packages/contracts");

  await $`cd ${contractsDir} && forge script script/DeployAA.s.sol --rpc-url ${config.rpcUrl} --broadcast --verify -vvvv`;

  console.log("\n✅ AA contracts deployed successfully!");
}

main().catch((err) => {
  console.error("\n❌ AA deployment failed:", err);
  process.exit(1);
});


