/**
 * Dev Startup - Ensures infrastructure is running before app starts
 *
 * Usage:
 *   bun run dev-startup.ts && bun run src/server.ts
 *
 * Or import and call:
 *   import { ensureInfra } from '@jejunetwork/tests/dev-startup';
 *   await ensureInfra();
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import {
  checkContractsDeployed as checkContracts,
  findJejuWorkspaceRoot,
  isRpcAvailable,
  isServiceAvailable,
} from './utils'

const LOCALNET_PORT = 9545
const DWS_PORT = 4030

let localnetProcess: Subprocess | null = null
let dwsProcess: Subprocess | null = null

async function startLocalnet(rootDir: string): Promise<boolean> {
  const anvil = Bun.which('anvil')
  if (!anvil) {
    console.log(
      '⚠️  Anvil not found. Install foundry: curl -L https://foundry.paradigm.xyz | bash',
    )
    return false
  }

  console.log('🔗 Starting localnet (anvil)...')
  localnetProcess = Bun.spawn(
    [anvil, '--port', String(LOCALNET_PORT), '--chain-id', '1337'],
    {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  for (let i = 0; i < 30; i++) {
    if (await isRpcAvailable(`http://127.0.0.1:${LOCALNET_PORT}`)) {
      console.log('✅ Localnet ready')
      return true
    }
    await Bun.sleep(500)
  }

  console.log('❌ Localnet failed to start')
  return false
}

async function bootstrapContractsLocal(rootDir: string): Promise<boolean> {
  const rpcUrl = `http://127.0.0.1:${LOCALNET_PORT}`

  if (await checkContracts(rpcUrl)) {
    console.log('✅ Contracts already deployed')
    return true
  }

  console.log('📦 Bootstrapping contracts...')
  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts')

  if (!existsSync(bootstrapScript)) {
    console.log('⚠️  Bootstrap script not found, skipping')
    return false
  }

  const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      L2_RPC_URL: rpcUrl,
      JEJU_RPC_URL: rpcUrl,
    },
  })

  const exitCode = await proc.exited
  if (exitCode === 0) {
    console.log('✅ Contracts bootstrapped')
    return true
  }

  return false
}

async function startDws(rootDir: string): Promise<boolean> {
  console.log('🌐 Starting DWS...')

  const dwsPath = join(rootDir, 'apps', 'dws')
  if (!existsSync(dwsPath)) {
    console.log('⚠️  DWS app not found')
    return false
  }

  dwsProcess = Bun.spawn(['bun', 'run', 'src/server/index.ts'], {
    cwd: dwsPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  })

  for (let i = 0; i < 30; i++) {
    if (await isServiceAvailable(`http://127.0.0.1:${DWS_PORT}/health`)) {
      console.log('✅ DWS ready')
      return true
    }
    await Bun.sleep(500)
  }

  console.log('❌ DWS failed to start')
  return false
}

function setEnvVars(): void {
  process.env.L2_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`
  process.env.JEJU_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`
  process.env.DWS_URL = `http://127.0.0.1:${DWS_PORT}`
  process.env.STORAGE_API_URL = `http://127.0.0.1:${DWS_PORT}/storage`
  process.env.COMPUTE_MARKETPLACE_URL = `http://127.0.0.1:${DWS_PORT}/compute`
  process.env.IPFS_GATEWAY = `http://127.0.0.1:${DWS_PORT}/cdn`
  process.env.CDN_URL = `http://127.0.0.1:${DWS_PORT}/cdn`
}

export async function ensureInfra(): Promise<{
  rpc: boolean
  contracts: boolean
  dws: boolean
}> {
  const rootDir = findJejuWorkspaceRoot()
  const result = { rpc: false, contracts: false, dws: false }

  console.log('\n=== Jeju Dev Environment ===\n')

  // Check/start RPC
  if (await isRpcAvailable(`http://127.0.0.1:${LOCALNET_PORT}`)) {
    console.log('✅ Localnet already running')
    result.rpc = true
  } else {
    result.rpc = await startLocalnet(rootDir)
  }

  if (!result.rpc) {
    console.log('\n❌ Cannot proceed without RPC\n')
    return result
  }

  // Bootstrap contracts (default true, set BOOTSTRAP_CONTRACTS=false to skip)
  if (process.env.BOOTSTRAP_CONTRACTS !== 'false') {
    result.contracts = await bootstrapContractsLocal(rootDir)
  } else {
    result.contracts = await checkContracts(`http://127.0.0.1:${LOCALNET_PORT}`)
    console.log(
      result.contracts
        ? '✅ Contracts deployed'
        : '⚠️  No contracts (BOOTSTRAP_CONTRACTS=false)',
    )
  }

  // Check/start DWS
  if (await isServiceAvailable(`http://127.0.0.1:${DWS_PORT}/health`)) {
    console.log('✅ DWS already running')
    result.dws = true
  } else {
    result.dws = await startDws(rootDir)
  }

  // Set environment variables
  setEnvVars()

  console.log('\n=== Environment Ready ===')
  console.log(`  RPC:      http://127.0.0.1:${LOCALNET_PORT}`)
  console.log(`  DWS:      http://127.0.0.1:${DWS_PORT}`)
  console.log(`  Contracts: ${result.contracts ? 'deployed' : 'not deployed'}`)
  console.log('')

  return result
}

export async function cleanup(): Promise<void> {
  if (dwsProcess) {
    dwsProcess.kill()
    await dwsProcess.exited
  }
  if (localnetProcess) {
    localnetProcess.kill()
    await localnetProcess.exited
  }
}

// Handle process exit
process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})

process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(143)
})

// Run if executed directly
if (import.meta.main) {
  const result = await ensureInfra()
  if (!result.rpc) {
    process.exit(1)
  }
}

export default { ensureInfra, cleanup }
