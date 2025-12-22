#!/usr/bin/env bun

/**
 * DWS E2E Test Setup
 *
 * This script sets up the complete environment for E2E testing:
 * 1. Checks/starts Jeju localnet (L2: 9545, L1: 8545)
 * 2. Deploys all contracts if needed
 * 3. Starts DWS server with proper config
 * 4. Registers test worker nodes
 * 5. Runs E2E tests
 *
 * Usage: bun run scripts/e2e-setup.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'

// ============================================================================
// Configuration
// ============================================================================

const JEJU_L2_RPC = 'http://127.0.0.1:9545'
const JEJU_L1_RPC = 'http://127.0.0.1:8545'
const DWS_PORT = 4030

const TEST_ACCOUNTS = [
  {
    name: 'Deployer',
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    name: 'Node 1',
    key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    name: 'Node 2',
    key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  {
    name: 'User',
    key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  },
]

const processes: Map<string, Subprocess> = new Map()

// ============================================================================
// Chain Check
// ============================================================================

async function checkJejuLocalnet(): Promise<boolean> {
  try {
    const response = await fetch(JEJU_L2_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    })

    if (!response.ok) return false

    const data = (await response.json()) as { result?: string }
    if (data.result) {
      const blockNumber = parseInt(data.result, 16)
      console.log(`[E2E Setup] Jeju localnet running at block ${blockNumber}`)
      return true
    }
    return false
  } catch {
    return false
  }
}

// ============================================================================
// Contract Deployment Check
// ============================================================================

interface DeployedContracts {
  identityRegistry?: string
  computeRegistry?: string
  ledgerManager?: string
  [key: string]: string | undefined
}

async function getDeployedContracts(): Promise<DeployedContracts | null> {
  const deploymentPath = join(
    process.cwd(),
    '..',
    '..',
    'packages',
    'contracts',
    'deployments',
    'localnet-complete.json',
  )

  if (!existsSync(deploymentPath)) {
    return null
  }

  try {
    const content = readFileSync(deploymentPath, 'utf-8')
    const data = JSON.parse(content) as { contracts: DeployedContracts }
    return data.contracts
  } catch {
    return null
  }
}

async function ensureContractsDeployed(): Promise<DeployedContracts> {
  let contracts = await getDeployedContracts()

  if (contracts?.identityRegistry) {
    console.log(`[E2E Setup] Contracts already deployed`)
    console.log(`  IdentityRegistry: ${contracts.identityRegistry}`)
    return contracts
  }

  console.log('[E2E Setup] Deploying contracts via bootstrap...')

  const proc = spawn({
    cmd: [
      'bun',
      'run',
      'packages/deployment/scripts/bootstrap-localnet-complete.ts',
    ],
    cwd: join(process.cwd(), '..', '..'),
    env: {
      ...process.env,
      JEJU_RPC_URL: JEJU_L2_RPC,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Contract deployment failed with exit code ${exitCode}`)
  }

  contracts = await getDeployedContracts()
  if (!contracts) {
    throw new Error('Contracts not found after deployment')
  }

  return contracts
}

// ============================================================================
// DWS Server
// ============================================================================

async function startDWSServer(contracts: DeployedContracts): Promise<void> {
  console.log('[E2E Setup] Starting DWS server...')

  const proc = spawn({
    cmd: ['bun', 'run', 'src/server/index.ts'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      DWS_PORT: String(DWS_PORT),
      RPC_URL: JEJU_L2_RPC,
      L1_RPC_URL: JEJU_L1_RPC,
      NETWORK: 'localnet',
      IDENTITY_REGISTRY_ADDRESS: contracts.identityRegistry ?? '',
      COMPUTE_REGISTRY_ADDRESS: contracts.computeRegistry ?? '',
      LEDGER_MANAGER_ADDRESS: contracts.ledgerManager ?? '',
      DWS_PRIVATE_KEY: TEST_ACCOUNTS[0].key,
      DSTACK_SIMULATOR: 'true',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  processes.set('dws', proc)

  // Wait for server to be ready
  const timeout = Date.now() + 30000
  while (Date.now() < timeout) {
    try {
      const res = await fetch(`http://localhost:${DWS_PORT}/health`)
      if (res.ok) {
        console.log(`[E2E Setup] DWS server running on port ${DWS_PORT}`)
        return
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500)
  }

  throw new Error('DWS server failed to start')
}

// ============================================================================
// Worker Node Registration
// ============================================================================

async function registerTestNodes(): Promise<void> {
  console.log('[E2E Setup] Registering test worker nodes...')

  for (let i = 1; i <= 2; i++) {
    const account = TEST_ACCOUNTS[i]
    const nodePort = DWS_PORT + 100 + i

    try {
      const res = await fetch(
        `http://localhost:${DWS_PORT}/edge/nodes/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': await getAddress(account.key),
          },
          body: JSON.stringify({
            endpoint: `http://localhost:${nodePort}`,
            capabilities: ['compute', 'storage'],
            specs: {
              cpuCores: 4,
              memoryMb: 8192,
              storageMb: 102400,
              bandwidthMbps: 1000,
            },
            pricing: {
              pricePerHour: '1000000000000000',
              pricePerGb: '100000000000000',
              pricePerRequest: '1000000000000',
            },
          }),
        },
      )

      if (res.ok) {
        console.log(`  Node ${i} registered`)
      } else {
        console.log(
          `  Node ${i} registration: ${res.status} (may already exist)`,
        )
      }
    } catch (err) {
      console.log(`  Node ${i} registration skipped: ${err}`)
    }
  }
}

async function getAddress(privateKey: string): Promise<string> {
  // Simple address derivation using viem-style logic
  // For now, use hardcoded addresses from anvil defaults
  const addresses: Record<string, string> = {
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80':
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d':
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a':
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6':
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  }
  return addresses[privateKey] ?? '0x0000000000000000000000000000000000000000'
}

// ============================================================================
// Run E2E Tests
// ============================================================================

async function runE2ETests(): Promise<boolean> {
  console.log('\n[E2E Setup] Running E2E tests...\n')

  const proc = spawn({
    cmd: ['bun', 'test', 'tests/real-e2e.test.ts'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      DWS_URL: `http://localhost:${DWS_PORT}`,
      RPC_URL: JEJU_L2_RPC,
      NETWORK: 'localnet',
      E2E_MODE: 'true',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited
  return exitCode === 0
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(): Promise<void> {
  console.log('\n[E2E Setup] Cleaning up...')

  for (const [name, proc] of processes) {
    console.log(`  Stopping ${name}...`)
    proc.kill()
  }

  processes.clear()
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 DWS E2E Test Setup                           ║
║                                                               ║
║  This script runs REAL E2E tests against Jeju localnet       ║
║  L2 RPC: ${JEJU_L2_RPC.padEnd(40)}     ║
║  DWS: http://localhost:${String(DWS_PORT).padEnd(38)} ║
╚══════════════════════════════════════════════════════════════╝
`)

  // Handle shutdown
  process.on('SIGINT', async () => {
    await cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await cleanup()
    process.exit(0)
  })

  try {
    // 1. Check chain is running
    const chainRunning = await checkJejuLocalnet()
    if (!chainRunning) {
      console.log('[E2E Setup] Jeju localnet not running.')
      console.log('  Start with: jeju dev  OR  bun run localnet:start')
      console.log('  Then run this script again.')
      process.exit(1)
    }

    // 2. Ensure contracts are deployed
    const contracts = await ensureContractsDeployed()

    // 3. Start DWS server
    await startDWSServer(contracts)

    // 4. Register test nodes
    await registerTestNodes()

    // 5. Run E2E tests
    const success = await runE2ETests()

    // 6. Cleanup
    await cleanup()

    process.exit(success ? 0 : 1)
  } catch (err) {
    console.error('[E2E Setup] Error:', err)
    await cleanup()
    process.exit(1)
  }
}

// Export for use as module
export { checkJejuLocalnet, ensureContractsDeployed, startDWSServer, cleanup }

// Run if executed directly
if (import.meta.main) {
  main()
}
