#!/usr/bin/env bun

/**
 * DWS Development Server with Full Infrastructure
 *
 * Starts:
 * 1. Local blockchain (anvil) if not running
 * 2. Deploys all DWS contracts
 * 3. Starts SQLit in-memory mode (no Docker required)
 * 4. Starts the DWS API server
 * 5. Starts the frontend dev server
 */

import { join } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const _ROOT_DIR = join(import.meta.dir, '../../..')
const DWS_DIR = join(import.meta.dir, '..')

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false
const isTestMode = process.env.JEJU_TEST_MODE === '1'

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Dev] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Dev] Stopping ${name}...`)
    try {
      process.kill()
    } catch {
      // Process may have already exited
    }
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function isPortInUse(port: number): Promise<boolean> {
  const host = getLocalhostHost()
  try {
    const _response = await fetch(`http://${host}:${port}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(500),
    })
    return true
  } catch {
    return false
  }
}

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await isPortInUse(port)) {
      return true
    }
    await Bun.sleep(500)
  }
  return false
}

function killProcessesOnPort(port: number): void {
  const result = Bun.spawnSync({
    cmd: ['lsof', '-ti', `tcp:${port}`],
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(`Unable to identify process on port ${port}`)
  }

  const output = new TextDecoder().decode(result.stdout).trim()
  if (!output) {
    throw new Error(`No process found on port ${port}`)
  }

  for (const pidStr of output.split('\n')) {
    const pid = Number.parseInt(pidStr, 10)
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, 'SIGTERM')
    }
  }
}

async function startAnvil(): Promise<boolean> {
  // Check if anvil is already running
  const host = getLocalhostHost()
  try {
    const response = await fetch(`http://${host}:6546`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })
    const data = (await response.json()) as { result?: string }
    if (data.result === '0x7a69') {
      console.log('[Dev] Anvil already running on port 6546')
      return true
    }
    if (isTestMode && data.result) {
      console.log(
        `[Dev] Test mode: using existing chain ${data.result} on port 6546`,
      )
      return true
    }
    console.log(
      `[Dev] Found chain ${data.result ?? 'unknown'} on port 6546; restarting Anvil...`,
    )
    killProcessesOnPort(6546)
  } catch {
    // Not running, start it
  }

  console.log('[Dev] Starting anvil...')

  const proc = Bun.spawn(
    ['anvil', '--port', '6546', '--chain-id', '31337', '--block-time', '1'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  processes.push({ name: 'anvil', process: proc })

  // Wait for anvil to be ready
  const ready = await waitForPort(6546, 10000)
  if (!ready) {
    console.error('[Dev] Failed to start anvil')
    return false
  }

  console.log('[Dev] Anvil started')
  return true
}

async function deployContracts(): Promise<boolean> {
  if (isTestMode) {
    console.log('[Dev] Test mode: skipping contract deployment')
    return true
  }
  console.log('[Dev] Deploying contracts...')

  const host = getLocalhostHost()
  const proc = Bun.spawn(['bun', 'run', 'scripts/deploy-contracts.ts'], {
    cwd: DWS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      RPC_URL: `http://${host}:6546`,
    },
  })

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.error('[Dev] Contract deployment failed')
    return false
  }

  console.log('[Dev] Contracts deployed')
  return true
}

async function startDWSServer(): Promise<boolean> {
  console.log('[Dev] Starting DWS API server...')

  // Check if already running
  if (await isPortInUse(4030)) {
    console.log('[Dev] DWS already running on port 4030')
    return true
  }

  const host = getLocalhostHost()
  const proc = Bun.spawn(['bun', 'run', 'api/server/index.ts'], {
    cwd: DWS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      NETWORK: 'localnet',
      PORT: '4030',
      RPC_URL: process.env.RPC_URL ?? `http://${host}:6546`,
      ...(isTestMode
        ? {}
        : {
            // Use in-memory SQLit mode
            SQLIT_MODE: 'memory',
            // Disable Docker for dev
            SKIP_DOCKER: 'true',
          }),
    },
  })

  processes.push({ name: 'dws-server', process: proc })

  // Wait for server to be ready
  const ready = await waitForPort(4030, 30000)
  if (!ready) {
    console.error('[Dev] Failed to start DWS server')
    return false
  }

  console.log('[Dev] DWS server started on port 4030')
  return true
}

async function startFrontend(): Promise<boolean> {
  console.log('[Dev] Starting frontend dev server...')

  // Check if already running
  if (await isPortInUse(4031)) {
    console.log('[Dev] Frontend already running on port 4031')
    return true
  }

  const host = getLocalhostHost()
  const proc = Bun.spawn(['bun', 'run', 'scripts/dev-frontend.ts'], {
    cwd: DWS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: '4031',
      API_URL: `http://${host}:4030`,
    },
  })

  processes.push({ name: 'frontend', process: proc })

  // Wait for server to be ready
  const ready = await waitForPort(4031, 15000)
  if (!ready) {
    console.error('[Dev] Failed to start frontend')
    return false
  }

  console.log('[Dev] Frontend started on port 4031')
  return true
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           DWS Development Server with Infrastructure       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Step 1: Start anvil
  if (!(await startAnvil())) {
    console.error('[Dev] Failed to start blockchain. Is foundry installed?')
    console.log(
      '[Dev] Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup',
    )
    process.exit(1)
  }

  // Step 2: Deploy contracts
  if (!(await deployContracts())) {
    console.error('[Dev] Failed to deploy contracts')
    process.exit(1)
  }

  // Step 3: Start DWS server
  if (!(await startDWSServer())) {
    console.error('[Dev] Failed to start DWS server')
    cleanup()
    process.exit(1)
  }

  // Step 4: Start frontend
  if (!(await startFrontend())) {
    console.error('[Dev] Failed to start frontend')
    cleanup()
    process.exit(1)
  }

  console.log('')
  const host = getLocalhostHost()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    DWS is ready                             ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend:  http://${host}:4031                          ║`)
  console.log(`║  API:       http://${host}:4030                          ║`)
  console.log(`║  Blockchain: http://${host}:6546                         ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Keep the process running
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('[Dev] Error:', err)
  cleanup()
  process.exit(1)
})
