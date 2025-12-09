#!/usr/bin/env bun
/**
 * Start Jeju localnet using Kurtosis
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const KURTOSIS_PACKAGE = join(ROOT, "kurtosis/main.star");
const ENCLAVE_NAME = "jeju-localnet";
const OUTPUT_DIR = join(process.cwd(), ".kurtosis");

async function checkDocker(): Promise<boolean> {
  const result = await $`docker info`.quiet().nothrow();
  return result.exitCode === 0;
}

async function checkKurtosis(): Promise<boolean> {
  const result = await $`which kurtosis`.quiet().nothrow();
  return result.exitCode === 0;
}

async function main() {
  console.log("🚀 Starting Jeju Localnet...\n");

  if (!await checkDocker()) {
    console.error("❌ Docker is not running. Start Docker and try again.");
    process.exit(1);
  }

  if (!await checkKurtosis()) {
    console.error("❌ Kurtosis not installed. Run: brew install kurtosis-tech/tap/kurtosis");
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Clean up existing enclave
  console.log("🧹 Cleaning up existing enclave...");
  await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.quiet().nothrow();

  // Start localnet
  console.log("📦 Deploying Jeju stack...\n");
  const result = await $`kurtosis run ${KURTOSIS_PACKAGE} --enclave ${ENCLAVE_NAME}`.nothrow();

  if (result.exitCode !== 0) {
    console.error("❌ Failed to start localnet");
    process.exit(1);
  }

  // Get ports
  const l1Port = await $`kurtosis port print ${ENCLAVE_NAME} geth-l1 rpc`.text().then(s => s.trim().split(":").pop());
  const l2Port = await $`kurtosis port print ${ENCLAVE_NAME} op-geth rpc`.text().then(s => s.trim().split(":").pop());

  const portsConfig = {
    l1Rpc: `http://127.0.0.1:${l1Port}`,
    l2Rpc: `http://127.0.0.1:${l2Port}`,
    chainId: 1337,
    timestamp: new Date().toISOString()
  };

  await Bun.write(join(OUTPUT_DIR, "ports.json"), JSON.stringify(portsConfig, null, 2));

  console.log("\n✅ Jeju Localnet running");
  console.log(`   L1 RPC: http://127.0.0.1:${l1Port}`);
  console.log(`   L2 RPC: http://127.0.0.1:${l2Port}`);
  console.log(`\n💾 Config: ${join(OUTPUT_DIR, "ports.json")}\n`);
}

main();

