#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, rmSync } from "fs";
import { join } from "path";

const ENCLAVE_NAME = "jeju-localnet";
const OUTPUT_DIR = join(process.cwd(), ".kurtosis");

async function main() {
  console.log("🔄 Resetting Jeju Localnet...");
  
  // Remove the enclave
  console.log("🧹 Removing existing enclave...");
  await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.quiet().nothrow();
  
  // Clean up output directory
  if (existsSync(OUTPUT_DIR)) {
    console.log("🗑️  Cleaning up local data...");
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  
  console.log("✅ Reset complete!");
  console.log("\n💡 Localnet lifecycle is managed by:");
  console.log("   bun run dev              # Starts everything including localnet");
  console.log("   bun run dev -- --minimal # Starts only localnet");
}

main();


