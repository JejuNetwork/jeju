#!/usr/bin/env bun
/**
 * Helmfile wrapper for Kubernetes deployments
 * 
 * Usage:
 *   NETWORK=testnet bun run scripts/helmfile.ts sync
 *   NETWORK=testnet bun run scripts/helmfile.ts diff
 *   NETWORK=mainnet bun run scripts/helmfile.ts destroy
 */

import { $ } from "bun";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const NETWORK = process.env.NETWORK || "testnet";
const COMMAND = process.argv[2] || "diff";

const VALID_COMMANDS = ["diff", "sync", "apply", "destroy", "status", "list"];
const VALID_NETWORKS = ["localnet", "testnet", "mainnet"];

async function main() {
  if (!VALID_COMMANDS.includes(COMMAND)) {
    console.error(`❌ Invalid command: ${COMMAND}`);
    console.error(`   Valid: ${VALID_COMMANDS.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_NETWORKS.includes(NETWORK)) {
    console.error(`❌ Invalid network: ${NETWORK}`);
    console.error(`   Valid: ${VALID_NETWORKS.join(", ")}`);
    process.exit(1);
  }

  const helmfileDir = join(ROOT, "kubernetes/helmfile");
  console.log(`☸️  Helmfile ${COMMAND} for ${NETWORK}\n`);

  const result = await $`cd ${helmfileDir} && helmfile -e ${NETWORK} ${COMMAND}`.nothrow();

  if (result.exitCode !== 0) {
    console.error(`\n❌ Helmfile ${COMMAND} failed`);
    process.exit(1);
  }

  console.log(`\n✅ Helmfile ${COMMAND} complete\n`);
}

main();

