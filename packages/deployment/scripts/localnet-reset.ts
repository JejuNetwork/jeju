#!/usr/bin/env bun
/**
 * Reset network localnet (stop and start fresh)
 */

import { $ } from "bun";

async function main(): Promise<void> {
  console.log("🔄 Resetting Network Localnet...\n");

  await $`bun run ${import.meta.dir}/localnet-stop.ts`.quiet();
  await $`bun run ${import.meta.dir}/localnet-start.ts`;
}

main();

