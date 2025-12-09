#!/usr/bin/env bun
/**
 * Stop Jeju localnet
 */

import { $ } from "bun";

const ENCLAVE_NAME = "jeju-localnet";

async function main() {
  console.log("🛑 Stopping Jeju Localnet...\n");

  const result = await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.nothrow();

  if (result.exitCode === 0) {
    console.log("✅ Localnet stopped\n");
  } else {
    console.log("⚠️  Enclave may not have been running\n");
  }
}

main();

