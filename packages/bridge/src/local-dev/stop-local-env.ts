#!/usr/bin/env bun
/**
 * Stop Local Development Environment
 *
 * Cleanly stops all local services started by start-local-env.ts
 */

import { $ } from 'bun';

async function main(): Promise<void> {
  console.log('🛑 Stopping EVMSol Local Development Environment\n');

  // Kill Anvil
  console.log('Stopping Anvil...');
  await $`pkill -f "anvil" || true`.quiet();

  // Kill Solana validator
  console.log('Stopping Solana validator...');
  await $`pkill -f "solana-test-validator" || true`.quiet();

  // Kill any mock servers
  console.log('Stopping mock services...');
  await $`pkill -f "experimental-evmsol" || true`.quiet();

  console.log('\n✅ All services stopped');
}

main().catch(console.error);
