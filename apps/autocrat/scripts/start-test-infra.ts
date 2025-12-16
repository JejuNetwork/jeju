#!/usr/bin/env bun
/**
 * Start Test Infrastructure
 * 
 * Starts all services needed for UI and integration tests:
 * 1. Anvil (local blockchain)
 * 2. Council backend (if not already running)
 * 
 * The Next.js frontend is started by Playwright's webServer config.
 */

import { $ } from 'bun'

const ANVIL_PORT = 8545
const COUNCIL_PORT = 8010

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const result = await $`lsof -i :${port} -t`.quiet()
    return result.stdout.toString().trim().length > 0
  } catch {
    return false
  }
}

async function waitForService(url: string, timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function startAnvil(): Promise<void> {
  if (await isPortInUse(ANVIL_PORT)) {
    console.log(`✓ Anvil already running on port ${ANVIL_PORT}`)
    return
  }

  console.log('Starting Anvil...')
  
  // Start anvil in background
  Bun.spawn(['anvil', '--port', String(ANVIL_PORT), '--chain-id', '31337'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

  // Wait for it to be ready
  const ready = await waitForService(`http://localhost:${ANVIL_PORT}`, 10000)
  if (!ready) {
    throw new Error('Anvil failed to start')
  }
  
  console.log(`✓ Anvil started on port ${ANVIL_PORT}`)
}

async function checkCouncilServer(): Promise<void> {
  if (await isPortInUse(COUNCIL_PORT)) {
    console.log(`✓ Council server already running on port ${COUNCIL_PORT}`)
    return
  }

  console.log(`⚠ Council server not running on port ${COUNCIL_PORT}`)
  console.log('  It will be started by Playwright webServer config')
}

async function main() {
  console.log('\n╔════════════════════════════════════════════╗')
  console.log('║     STARTING TEST INFRASTRUCTURE           ║')
  console.log('╚════════════════════════════════════════════╝\n')

  await startAnvil()
  await checkCouncilServer()

  console.log('\n✓ Infrastructure ready for tests\n')
}

main().catch((err) => {
  console.error('Failed to start infrastructure:', err.message)
  process.exit(1)
})

