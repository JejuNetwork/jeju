#!/usr/bin/env bun
/**
 * Reset Jeju localnet (stop and start fresh)
 */

import { $ } from "bun";

async function main() {
  console.log("🔄 Resetting Jeju Localnet...\n");

  await $`bun run ${import.meta.dir}/localnet-stop.ts`.quiet();
  await $`bun run ${import.meta.dir}/localnet-start.ts`;
}

main();

