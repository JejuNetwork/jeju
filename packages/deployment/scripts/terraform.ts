#!/usr/bin/env bun
/**
 * Terraform wrapper for infrastructure management
 * 
 * Usage:
 *   NETWORK=testnet bun run scripts/terraform.ts plan
 *   NETWORK=testnet bun run scripts/terraform.ts apply
 *   NETWORK=mainnet bun run scripts/terraform.ts destroy
 */

import { $ } from "bun";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const NETWORK = process.env.NETWORK || "testnet";
const COMMAND = process.argv[2] || "plan";

const VALID_COMMANDS = ["init", "plan", "apply", "destroy", "output"];
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

  const tfDir = join(ROOT, "terraform/environments", NETWORK);
  console.log(`🏗️  Terraform ${COMMAND} for ${NETWORK}\n`);

  // Always init first
  if (COMMAND !== "init") {
    await $`cd ${tfDir} && terraform init`.quiet();
  }

  let result;
  switch (COMMAND) {
    case "init":
      result = await $`cd ${tfDir} && terraform init`.nothrow();
      break;
    case "plan":
      result = await $`cd ${tfDir} && terraform plan -out=tfplan`.nothrow();
      break;
    case "apply":
      result = await $`cd ${tfDir} && terraform apply -auto-approve tfplan`.nothrow();
      break;
    case "destroy":
      console.log("⚠️  This will destroy all infrastructure!");
      result = await $`cd ${tfDir} && terraform destroy -auto-approve`.nothrow();
      break;
    case "output":
      result = await $`cd ${tfDir} && terraform output -json`.nothrow();
      break;
  }

  if (result?.exitCode !== 0) {
    console.error(`\n❌ Terraform ${COMMAND} failed`);
    process.exit(1);
  }

  console.log(`\n✅ Terraform ${COMMAND} complete\n`);
}

main();

