/**
 * DWS Frontend E2E Test Setup
 *
 * Sets up the full decentralized stack:
 * 1. Localnet (anvil)
 * 2. Contract deployment
 * 3. DWS backend services
 * 4. Frontend dev server
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const LOCALNET_PORT = parseInt(process.env.LOCALNET_PORT || '9545', 10)
const DWS_PORT = parseInt(process.env.DWS_PORT || '4030', 10)
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4033', 10)
const TEST_WALLET = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
}

let processes: ChildProcess[] = []

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
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return true
    } catch {
      // Keep trying
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function checkRpc(): Promise<boolean> {
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
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function startLocalnet(): Promise<boolean> {
  if (await checkRpc()) {
    console.log('[E2E Setup] Localnet already running')
    return true
  }

  console.log('[E2E Setup] Starting localnet (anvil)...')
  const anvil = spawn(
    'anvil',
    ['--port', String(LOCALNET_PORT), '--chain-id', '1337'],
    {
      stdio: 'pipe',
    },
  )
  processes.push(anvil)

  for (let i = 0; i < 30; i++) {
    if (await checkRpc()) {
      console.log('[E2E Setup] Localnet ready')
      return true
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function bootstrapContracts(rootDir: string): Promise<boolean> {
  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts')
  if (!existsSync(bootstrapScript)) {
    console.log('[E2E Setup] No bootstrap script found, skipping')
    return true
  }

  console.log('[E2E Setup] Bootstrapping contracts...')
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', bootstrapScript], {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}` },
    })

    proc.on('exit', (code) => {
      resolve(code === 0)
    })
  })
}

async function startDwsBackend(rootDir: string): Promise<boolean> {
  const dwsDir = join(rootDir, 'apps', 'dws')

  console.log('[E2E Setup] Starting DWS backend...')
  const dws = spawn('bun', ['run', 'src/server/index.ts'], {
    cwd: dwsDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_NETWORK: 'localnet',
    },
  })
  processes.push(dws)

  if (await waitForService(`http://127.0.0.1:${DWS_PORT}/health`, 30)) {
    console.log('[E2E Setup] DWS backend ready')
    return true
  }
  return false
}

async function startFrontend(frontendDir: string): Promise<boolean> {
  console.log('[E2E Setup] Starting frontend...')
  const frontend = spawn('bun', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      VITE_DWS_API_URL: `http://127.0.0.1:${DWS_PORT}`,
      VITE_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  })
  processes.push(frontend)

  if (await waitForService(`http://127.0.0.1:${FRONTEND_PORT}`, 30)) {
    console.log('[E2E Setup] Frontend ready')
    return true
  }
  return false
}

export async function globalSetup(): Promise<void> {
  const rootDir = findMonorepoRoot()
  const frontendDir = join(rootDir, 'apps', 'dws', 'frontend')

  console.log('\n=== DWS E2E Test Setup ===\n')
  console.log(`Root: ${rootDir}`)

  // 1. Start localnet
  if (!(await startLocalnet())) {
    throw new Error('Failed to start localnet')
  }

  // 2. Bootstrap contracts
  if (!(await bootstrapContracts(rootDir))) {
    console.warn('[E2E Setup] Contract bootstrap failed, continuing anyway')
  }

  // 3. Start DWS backend
  if (!(await startDwsBackend(rootDir))) {
    throw new Error('Failed to start DWS backend')
  }

  // 4. Start frontend
  if (!(await startFrontend(frontendDir))) {
    throw new Error('Failed to start frontend')
  }

  console.log('\n[E2E Setup] All services ready\n')
}

export async function globalTeardown(): Promise<void> {
  console.log('\n[E2E Teardown] Stopping services...')

  for (const proc of processes) {
    try {
      proc.kill('SIGTERM')
    } catch {
      // Ignore
    }
  }
  processes = []

  console.log('[E2E Teardown] Complete\n')
}

export const testConfig = {
  localnetPort: LOCALNET_PORT,
  dwsPort: DWS_PORT,
  frontendPort: FRONTEND_PORT,
  testWallet: TEST_WALLET,
  dwsUrl: `http://127.0.0.1:${DWS_PORT}`,
  frontendUrl: `http://127.0.0.1:${FRONTEND_PORT}`,
  rpcUrl: `http://127.0.0.1:${LOCALNET_PORT}`,
}
