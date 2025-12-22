#!/usr/bin/env bun
/**
 * Stop network localnet
 */

import { $ } from "bun";

const ENCLAVE_NAME = "jeju-localnet";

async function main(): Promise<void> {
  console.log("🛑 Stopping Network Localnet...\n");

  const result = await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.nothrow();

  if (result.exitCode === 0) {
    console.log("✅ Localnet stopped\n");
  } else {
    console.log("⚠️  Enclave may not have been running\n");
  }
}

main();

