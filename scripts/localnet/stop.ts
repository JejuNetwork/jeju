#!/usr/bin/env bun

import { $ } from "bun";

const ENCLAVE_NAME = "jeju-localnet";

async function main() {
  console.log("🛑 Stopping Jeju Localnet...");
  
  const result = await $`kurtosis enclave stop ${ENCLAVE_NAME}`.nothrow();
  
  if (result.exitCode === 0) {
    console.log("✅ Localnet stopped successfully");
    console.log("\n💡 Lifecycle is managed by 'bun run dev' (Ctrl+C to stop)");
    console.log("   To completely remove the enclave:");
    console.log(`   kurtosis enclave rm ${ENCLAVE_NAME}`);
  } else {
    console.error("❌ Failed to stop localnet");
    console.error("   The enclave may not exist or already be stopped");
  }
}

main();


