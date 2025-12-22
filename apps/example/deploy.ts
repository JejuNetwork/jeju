/**
 * Deploy Script
 *
 * Deploys the example app to the Jeju network.
 * Uses typed clients for all service interactions.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import { createJNSClient, type JNSRecords } from './src/services/jns'
import { createStorageClient } from './src/services/storage'
import type { DeployResult } from './src/types'

// ============================================================================
// Configuration
// ============================================================================

const NETWORK = process.env.NETWORK || 'localnet'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const GATEWAY_API = process.env.GATEWAY_API || `${DWS_URL}/cdn`
const STORAGE_API = process.env.STORAGE_API || `${DWS_URL}/storage`
const COMPUTE_API = process.env.COMPUTE_API || `${DWS_URL}/compute`
const CQL_ENDPOINT = process.env.CQL_ENDPOINT || 'http://localhost:4300'
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://localhost:4180'

// ============================================================================
// Typed Clients
// ============================================================================

const jnsClient = createJNSClient(GATEWAY_API)
const storageClient = createStorageClient(STORAGE_API, IPFS_GATEWAY)

// ============================================================================
// Compute Client (typed wrapper)
// ============================================================================

interface ComputeClient {
  registerService(config: ServiceConfig): Promise<{ success: boolean }>
  registerCron(config: CronConfig): Promise<{ triggerId: Hex }>
  health(): Promise<boolean>
}

interface ServiceConfig {
  name: string
  endpoint: string
  type: 'http' | 'grpc' | 'websocket'
  ports: Record<string, number>
}

interface CronConfig {
  name: string
  type: 'cron'
  expression: string
  webhook: string
}

function createComputeClient(baseUrl: string): ComputeClient {
  const url = baseUrl.replace(/\/$/, '')

  return {
    async registerService(
      config: ServiceConfig,
    ): Promise<{ success: boolean }> {
      const response = await fetch(`${url}/register-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      })
      return { success: response.ok }
    },

    async registerCron(config: CronConfig): Promise<{ triggerId: Hex }> {
      const response = await fetch(`${url}/cron/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        throw new Error(`Cron registration failed: ${response.status}`)
      }
      return (await response.json()) as { triggerId: Hex }
    },

    async health(): Promise<boolean> {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    },
  }
}

const computeClient = createComputeClient(COMPUTE_API)

// ============================================================================
// Wallet Setup
// ============================================================================

async function getDeployerWallet(): Promise<PrivateKeyAccount> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    // Only allow default dev key in localnet - this is Anvil account #0
    // WARNING: This key is publicly known - NEVER use in production
    if (NETWORK === 'localnet') {
      console.warn(
        '[Deploy] Using default Anvil dev key - DO NOT USE IN PRODUCTION',
      )
      // Anvil account #0 - well-known test key
      const ANVIL_DEV_KEY =
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      return privateKeyToAccount(ANVIL_DEV_KEY as `0x${string}`)
    }
    throw new Error(
      'DEPLOYER_PRIVATE_KEY environment variable is required for non-localnet deployment',
    )
  }

  // Validate the provided key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x',
    )
  }

  return privateKeyToAccount(privateKey as `0x${string}`)
}

// ============================================================================
// Database Deployment
// ============================================================================

async function deployDatabase(): Promise<string> {
  console.log('📦 Deploying database schema...')

  const schemaPath = join(import.meta.dir, 'src/db/migrate.ts')

  // Run migration
  const proc = Bun.spawn(['bun', 'run', schemaPath], {
    env: { ...process.env, CQL_BLOCK_PRODUCER_ENDPOINT: CQL_ENDPOINT },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited

  const databaseId = process.env.CQL_DATABASE_ID || 'todo-experimental'
  console.log(`   Database ID: ${databaseId}`)

  return databaseId
}

// ============================================================================
// Frontend Build & Deploy
// ============================================================================

async function buildFrontend(): Promise<string> {
  console.log('🏗️  Building frontend...')

  const frontendDir = join(import.meta.dir, 'src/frontend')

  // Bundle with Bun
  const result = await Bun.build({
    entrypoints: [join(frontendDir, 'app.ts')],
    outdir: join(import.meta.dir, 'dist/frontend'),
    target: 'browser',
    minify: true,
  })

  if (!result.success) {
    throw new Error('Frontend build failed')
  }

  console.log('   Frontend built successfully')
  return join(import.meta.dir, 'dist/frontend')
}

async function deployFrontendToIPFS(
  buildDir: string,
  account: PrivateKeyAccount,
): Promise<string> {
  console.log('📤 Uploading frontend to IPFS...')

  // Collect all files
  const files: Array<{ name: string; content: Uint8Array }> = []

  const addFilesFromDir = (dir: string, basePath = '') => {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const filePath = join(dir, entry)
      const stat = statSync(filePath)

      if (stat.isDirectory()) {
        addFilesFromDir(filePath, `${basePath}${entry}/`)
      } else {
        const content = readFileSync(filePath)
        files.push({
          name: `${basePath}${entry}`,
          content: new Uint8Array(content),
        })
      }
    }
  }

  // Add HTML
  const indexHtml = readFileSync(
    join(import.meta.dir, 'src/frontend/index.html'),
  )
  files.push({ name: 'index.html', content: new Uint8Array(indexHtml) })

  // Add built JS files
  addFilesFromDir(buildDir)

  // Upload primary file (index.html with bundled JS reference)
  const cid = await storageClient.upload(
    files[0].content,
    files[0].name,
    account.address,
    'hot',
  )

  console.log(`   Frontend CID: ${cid}`)
  return cid
}

// ============================================================================
// Backend Deployment
// ============================================================================

async function deployBackendToCompute(
  _account: PrivateKeyAccount,
): Promise<string> {
  console.log('🚀 Deploying backend to compute network...')

  // For now, we'll use the local backend endpoint
  // In production, this would deploy to a compute provider
  const backendEndpoint = process.env.BACKEND_URL || 'http://localhost:4500'

  // Register with compute network (if available)
  const result = await computeClient.registerService({
    name: 'todo-dapp-backend',
    endpoint: backendEndpoint,
    type: 'http',
    ports: { main: 4500 },
  })

  if (result.success) {
    console.log('   Backend registered with compute network')
  }

  return backendEndpoint
}

// ============================================================================
// JNS Registration
// ============================================================================

async function registerJNS(
  account: PrivateKeyAccount,
  config: { name: string; frontendCid: string; backendUrl: string },
): Promise<void> {
  console.log('🌐 Registering JNS name...')

  // Check availability and get existing records
  const isAvailable = await jnsClient.isAvailable(config.name)

  const records: JNSRecords = {
    address: account.address,
    contentHash: `ipfs://${config.frontendCid}`,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description: 'Decentralized Todo Application',
  }

  if (isAvailable) {
    // Register name
    const price = await jnsClient.getPrice(config.name, 1)
    if (price > 0n) {
      await jnsClient.register(config.name, account.address, 1, price)
    }
  }

  // Set records
  await jnsClient.setRecords(config.name, records)

  console.log(`   Registered ${config.name}`)
}

// ============================================================================
// Cron Triggers
// ============================================================================

async function setupCronTriggers(
  _account: PrivateKeyAccount,
  backendUrl: string,
): Promise<Hex | null> {
  console.log('⏰ Setting up cron triggers...')

  const result = await computeClient.registerCron({
    name: 'todo-cleanup',
    type: 'cron',
    expression: '0 0 * * *', // Daily at midnight
    webhook: `${backendUrl}/webhooks/cleanup`,
  })

  console.log(`   Trigger ID: ${result.triggerId}`)
  return result.triggerId
}

// ============================================================================
// OAuth3 Seeding
// ============================================================================

async function seedOAuth3Registry(): Promise<boolean> {
  console.log('🔐 Seeding OAuth3 registry...')

  // Run the seed script
  const seedPath = join(import.meta.dir, 'scripts/seed.ts')

  const proc = Bun.spawn(['bun', 'run', seedPath], {
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    console.log('   OAuth3 registry seeded successfully')
    return true
  }

  console.log('   OAuth3 seeding skipped or failed')
  return false
}

// ============================================================================
// Main Deploy Function
// ============================================================================

async function deploy(): Promise<DeployResult> {
  console.log('\n🚀 DEPLOYING DECENTRALIZED APP TEMPLATE\n')
  console.log(`Network: ${NETWORK}`)
  console.log('')

  const account = await getDeployerWallet()
  console.log(`Deployer: ${account.address}\n`)

  // Deploy database
  const databaseId = await deployDatabase()

  // Build and deploy frontend
  const buildDir = await buildFrontend()
  const frontendCid = await deployFrontendToIPFS(buildDir, account)

  // Deploy backend
  const backendEndpoint = await deployBackendToCompute(account)

  // Register JNS
  const jnsName = process.env.JNS_NAME || 'template.jeju'
  await registerJNS(account, {
    name: jnsName,
    frontendCid,
    backendUrl: backendEndpoint,
  })

  // Setup cron triggers
  const triggerId = await setupCronTriggers(account, backendEndpoint)

  // Seed OAuth3 registry (for localnet/testnet)
  if (NETWORK === 'localnet' || NETWORK === 'testnet') {
    await seedOAuth3Registry()
  }

  const result: DeployResult = {
    jnsName,
    frontendCid,
    backendEndpoint,
    a2aEndpoint: `${backendEndpoint}/a2a`,
    mcpEndpoint: `${backendEndpoint}/mcp`,
    databaseId,
    triggerId: triggerId || ('0x0' as Hex),
  }

  console.log('\n✅ DEPLOYMENT COMPLETE\n')
  console.log('📊 Deployment Summary:')
  console.log('═══════════════════════════════════════')
  console.log(`JNS Name:        ${result.jnsName}`)
  console.log(`Frontend CID:    ${result.frontendCid}`)
  console.log(`Backend:         ${result.backendEndpoint}`)
  console.log(`A2A Endpoint:    ${result.a2aEndpoint}`)
  console.log(`MCP Endpoint:    ${result.mcpEndpoint}`)
  console.log(`Auth Endpoint:   ${result.backendEndpoint}/auth`)
  console.log(`Database ID:     ${result.databaseId}`)
  console.log(`Trigger ID:      ${result.triggerId}`)
  console.log('═══════════════════════════════════════\n')

  if (NETWORK === 'localnet') {
    console.log('🔗 Access your dApp:')
    console.log(`   Frontend: http://localhost:4180/ipfs/${result.frontendCid}`)
    console.log(`   API:      ${result.backendEndpoint}`)
    console.log(
      `   A2A:      ${result.a2aEndpoint}/.well-known/agent-card.json`,
    )
    console.log(`   MCP:      ${result.mcpEndpoint}`)
    console.log(`   Auth:     ${result.backendEndpoint}/auth/providers`)
  }

  return result
}

deploy().catch(console.error)
