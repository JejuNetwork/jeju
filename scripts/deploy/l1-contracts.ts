#!/usr/bin/env bun
import { $ } from "bun";
import { resolve } from "path";
import { getChainConfig } from "../../config";
import type { NetworkType } from "../../types";

async function main() {
  const network = (process.argv[3] || 'local') as NetworkType;
  console.log(`🚀 Deploying L1 contracts to ${network}...`);

  const config = getChainConfig(network);
  const contractsDir = resolve(process.cwd(), "contracts");

  await $`cd ${contractsDir} && forge script script/Deploy.s.sol --rpc-url ${config.l1RpcUrl} --broadcast --verify -vvvv`;

  console.log("\n✅ L1 contracts deployed successfully!");
  console.log("📝 Next steps: Update config/chain/mainnet.json with deployed addresses");
}

main().catch((err) => {
  console.error("\n❌ L1 deployment failed:", err);
  process.exit(1);
});


