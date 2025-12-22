/**
 * Playwright Global Setup for E2E Tests
 *
 * Sets up:
 * 1. Localnet (anvil)
 * 2. Contract deployment
 * 3. DWS backend
 * 4. Frontend dev server
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const LOCALNET_PORT = 9545
const DWS_PORT = 4030
const FRONTEND_PORT = 4031

const STATE_FILE = join(dirname(__dirname), '.e2e-state.json')

interface E2EState {
  pids: number[]
  ports: {
    localnet: number
    dws: number
    frontend: number
  }
}

function findMonorepoRoot(): string {
  let dir = dirname(dirname(dirname(dirname(__dirname))))
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return dir
}

async function waitForService(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (response.ok) return true
    } catch {
      clearTimeout(timeoutId)
      // Keep trying
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function checkRpc(): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 2000)
  try {
    const response = await fetch(`http://127.0.0.1:${LOCALNET_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    clearTimeout(timeoutId)
    return false
  }
}

async function startLocalnet(): Promise<ChildProcess | null> {
  if (await checkRpc()) {
    console.log('[E2E] Localnet already running')
    return null
  }

  console.log('[E2E] Starting localnet (anvil)...')
  const anvil = spawn(
    'anvil',
    ['--port', String(LOCALNET_PORT), '--chain-id', '1337'],
    {
      stdio: 'pipe',
      detached: true,
    },
  )

  for (let i = 0; i < 30; i++) {
    if (await checkRpc()) {
      console.log('[E2E] Localnet ready')
      return anvil
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  anvil.kill()
  throw new Error('Failed to start localnet')
}

async function bootstrapContracts(rootDir: string): Promise<void> {
  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts')
  if (!existsSync(bootstrapScript)) {
    console.log('[E2E] No bootstrap script found, skipping')
    return
  }

  console.log('[E2E] Bootstrapping contracts...')
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['run', bootstrapScript], {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}` },
    })

    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Bootstrap failed with code ${code}`))
    })
  })
}

async function startDwsBackend(rootDir: string): Promise<ChildProcess | null> {
  const dwsDir = join(rootDir, 'apps', 'dws')

  // Check if already running
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 1000)
  try {
    const res = await fetch(`http://127.0.0.1:${DWS_PORT}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (res.ok) {
      console.log('[E2E] DWS backend already running')
      return null
    }
  } catch {
    clearTimeout(timeoutId)
    // Not running, start it
  }

  console.log('[E2E] Starting DWS backend...')
  const dws = spawn('bun', ['run', 'src/server/index.ts'], {
    cwd: dwsDir,
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_NETWORK: 'localnet',
    },
  })

  if (await waitForService(`http://127.0.0.1:${DWS_PORT}/health`, 30)) {
    console.log('[E2E] DWS backend ready')
    return dws
  }

  dws.kill()
  throw new Error('Failed to start DWS backend')
}

async function startFrontend(
  frontendDir: string,
): Promise<ChildProcess | null> {
  // Check if already running
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 1000)
  try {
    const res = await fetch(`http://127.0.0.1:${FRONTEND_PORT}`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (res.ok) {
      console.log('[E2E] Frontend already running')
      return null
    }
  } catch {
    clearTimeout(timeoutId)
    // Not running, start it
  }

  console.log('[E2E] Starting frontend...')
  const frontend = spawn('bun', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      VITE_DWS_API_URL: `http://127.0.0.1:${DWS_PORT}`,
      VITE_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  })

  if (await waitForService(`http://127.0.0.1:${FRONTEND_PORT}`, 30)) {
    console.log('[E2E] Frontend ready')
    return frontend
  }

  frontend.kill()
  throw new Error('Failed to start frontend')
}

export default async function globalSetup() {
  const rootDir = findMonorepoRoot()
  const frontendDir = join(rootDir, 'apps', 'dws', 'frontend')

  console.log('\n=== DWS E2E Test Setup ===\n')
  console.log(`Root: ${rootDir}`)

  const pids: number[] = []

  // 1. Start localnet
  const anvilProc = await startLocalnet()
  if (anvilProc?.pid) pids.push(anvilProc.pid)

  // 2. Bootstrap contracts (non-fatal)
  try {
    await bootstrapContracts(rootDir)
  } catch (e) {
    console.warn('[E2E] Contract bootstrap failed:', e)
  }

  // 3. Start DWS backend
  const dwsProc = await startDwsBackend(rootDir)
  if (dwsProc?.pid) pids.push(dwsProc.pid)

  // 4. Start frontend
  const frontendProc = await startFrontend(frontendDir)
  if (frontendProc?.pid) pids.push(frontendProc.pid)

  // Save state for teardown
  const state: E2EState = {
    pids,
    ports: {
      localnet: LOCALNET_PORT,
      dws: DWS_PORT,
      frontend: FRONTEND_PORT,
    },
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

  console.log('\n[E2E] All services ready\n')
  console.log(`  Localnet: http://127.0.0.1:${LOCALNET_PORT}`)
  console.log(`  DWS API:  http://127.0.0.1:${DWS_PORT}`)
  console.log(`  Frontend: http://127.0.0.1:${FRONTEND_PORT}`)
  console.log('\n')
}
