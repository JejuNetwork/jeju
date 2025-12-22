#!/usr/bin/env bun

/**
 * Reset Local Development Environment
 *
 * Stops all services, clears state, and restarts fresh
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

async function main(): Promise<void> {
  console.log('🔄 Resetting EVMSol Local Development Environment\n')

  // Stop all services first
  console.log('Stopping services...')
  await $`bun run src/local-dev/stop-local-env.ts`.quiet()

  // Clear Anvil state
  const anvilDir = join(process.env.HOME || '~', '.anvil')
  if (existsSync(anvilDir)) {
    console.log('Clearing Anvil state...')
    rmSync(anvilDir, { recursive: true, force: true })
  }

  // Clear Solana test ledger
  const solanaLedger = join(process.cwd(), 'test-ledger')
  if (existsSync(solanaLedger)) {
    console.log('Clearing Solana ledger...')
    rmSync(solanaLedger, { recursive: true, force: true })
  }

  // Clear local deployment artifacts
  const deployments = join(process.cwd(), '.local-deployments')
  if (existsSync(deployments)) {
    console.log('Clearing deployment artifacts...')
    rmSync(deployments, { recursive: true, force: true })
  }

  console.log('\n✅ Environment reset complete')
  console.log('Run `bun run local:start` to start fresh\n')
}

main().catch(console.error)
